// ============================================================
// 鉴权模块
// ------------------------------------------------------------
// - 密码登录：常数时间比对（防时序攻击）
// - Session：HMAC(时间戳) cookie，HttpOnly + SameSite=Strict，24h 过期
// - PANEL_SECRET：首启随机生成，持久化到 data/.panel_secret
// ============================================================
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 小时
const COOKIE_NAME = 'mc_session';

/**
 * 管理面板鉴权状态。
 * 持有 HMAC 密钥与密码哈希，签发/校验 session cookie。
 */
export class Auth {
  constructor({ password, dataDir }) {
    if (!password) throw new Error('PANEL_PASSWORD 未设置');
    this.dataDir = dataDir;

    // 先加载/生成 secret，因为下方 hmac() 依赖它
    // 持久化 panel secret（HMAC 签名密钥），重启后保持 cookie 有效
    this.secret = this.loadOrCreateSecret();

    // 密码本身不存明文，存 HMAC（固定盐），用于常数时间比对
    // 注意：HMAC 不是密码哈希算法，但此处仅用于「等值比较的常数时间化」，
    // 真正的密码来源是 .env，安全性取决于 .env 的保管。
    this.passwordHmac = this.hmac(password);
  }

  /** HMAC 工具：用当前 secret 对任意字符串签名 */
  hmac(value) {
    return crypto.createHmac('sha256', this.secret ?? PANEL_SECRET_PLACEHOLDER).update(value).digest('hex');
  }

  /** 加载或首次生成 panel secret */
  loadOrCreateSecret() {
    const secretFile = path.join(this.dataDir, '.panel_secret');
    try {
      if (fs.existsSync(secretFile)) {
        const s = fs.readFileSync(secretFile, 'utf8').trim();
        if (s.length >= 32) return s;
      }
    } catch {
      /* fallthrough to generate */
    }
    const generated = crypto.randomBytes(32).toString('hex');
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    } catch (e) {
      console.error('[auth] 无法持久化 panel secret:', e.message);
    }
    return generated;
  }

  /** 校验登录密码（常数时间比较，防时序攻击） */
  verifyPassword(input) {
    const inputHmac = this.hmac(input);
    const a = Buffer.from(inputHmac);
    const b = Buffer.from(this.passwordHmac);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /** 签发 session cookie 值：timestamp.signature */
  issueSession() {
    const ts = Date.now();
    return `${ts}.${this.hmac(String(ts))}`;
  }

  /** 校验 session cookie 值，返回是否有效 */
  verifySession(cookieValue) {
    if (!cookieValue || typeof cookieValue !== 'string') return false;
    const dot = cookieValue.lastIndexOf('.');
    if (dot < 1) return false;
    const tsStr = cookieValue.slice(0, dot);
    const sig = cookieValue.slice(dot + 1);
    const ts = Number(tsStr);
    if (!Number.isFinite(ts)) return false;
    // 过期检查
    if (Date.now() - ts > SESSION_MAX_AGE_MS) return false;
    // 签名校验（常数时间）
    const expected = this.hmac(tsStr);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /** Express 中间件：保护路由，未登录返回 401 */
  requireAuth(req, res, next) {
    const cookie = parseCookie(req.headers.cookie || '', COOKIE_NAME);
    if (this.verifySession(cookie)) return next();
    return res.status(401).json({ error: '未登录或会话已过期' });
  }

  get cookieName() {
    return COOKIE_NAME;
  }
  get sessionMaxAge() {
    return SESSION_MAX_AGE_MS;
  }
}

// 加载 secret 之前用作 HMAC 密钥的占位（仅密码比对阶段，secret 实际在构造时即加载）
const PANEL_SECRET_PLACEHOLDER = crypto.randomBytes(32).toString('hex');

/** 简易 cookie 解析 */
export function parseCookie(header, name) {
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
