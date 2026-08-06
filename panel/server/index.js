// ============================================================
// Panel 后端入口
// ------------------------------------------------------------
// 职责：
//   1. 提供登录/鉴权 API
//   2. 代理 mc-router 的 REST API（路由 CRUD）
//   3. 提供 /api/metrics（解析后的 Prometheus 指标）
//   4. 服务 React 构建产物（dist/）—— 同源，无 CORS
// ============================================================
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Auth } from './auth.js';
import { McRouterClient } from './mc-router-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 配置 ----
const PORT = Number(process.env.PORT) || 8080;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;
const ROUTER_API = process.env.ROUTER_API || 'http://localhost:25566';
const DATA_DIR = process.env.PANEL_DATA_DIR || path.join(__dirname, '..', 'data');
const SEED_CONFIG = path.join(__dirname, '..', 'config', 'default-routes.json');

if (!PANEL_PASSWORD) {
  console.error('[panel] 致命：环境变量 PANEL_PASSWORD 未设置');
  process.exit(1);
}

// ---- 首次启动：拷贝种子路由配置（若 mc-router 的配置文件不存在）----
// 这样 mc-router 启动时即有可用配置，避免空配置导致无法连接面板
function ensureSeedRoutes() {
  const target = path.join(DATA_DIR, 'routes-config.json');
  try {
    if (!fs.existsSync(target) && fs.existsSync(SEED_CONFIG)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.copyFileSync(SEED_CONFIG, target);
      console.log('[panel] 已拷贝种子路由配置到', target);
    }
  } catch (e) {
    console.warn('[panel] 拷贝种子配置失败（可忽略）:', e.message);
  }
}
ensureSeedRoutes();

// ---- 初始化 auth 与 mc-router client ----
const auth = new Auth({ password: PANEL_PASSWORD, dataDir: DATA_DIR });
const router = new McRouterClient({ baseUrl: ROUTER_API });

const app = express();
app.use(express.json());

// ---- 登录 ----
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string') {
    return res.status(400).json({ error: '缺少 password 字段' });
  }
  if (!auth.verifyPassword(password)) {
    return res.status(401).json({ error: '密码错误' });
  }
  const session = auth.issueSession();
  res.cookie(auth.cookieName, session, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: auth.sessionMaxAge,
    path: '/',
  });
  res.json({ ok: true });
});

// ---- 登出 ----
app.post('/api/logout', (req, res) => {
  res.clearCookie(auth.cookieName, { path: '/' });
  res.json({ ok: true });
});

// ---- 以下 /api/* 全部需要登录 ----
app.use('/api', (req, res, next) => {
  // login/logout 已在上面处理，此处保护其余 API
  if (req.path === '/login' || req.path === '/logout') return next();
  return auth.requireAuth(req, res, next);
});

// ---- 路由列表 ----
app.get('/api/routes', async (req, res) => {
  try {
    const routes = await router.listRoutes();
    res.json(routes);
  } catch (e) {
    res.status(502).json({ error: '无法获取路由', detail: e.message });
  }
});

// ---- 创建/更新路由 ----
app.post('/api/routes', async (req, res) => {
  try {
    const { serverAddress, backend } = req.body || {};
    await router.createRoute(serverAddress, backend);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// ---- 删除路由 ----
app.delete('/api/routes/:serverAddress', async (req, res) => {
  try {
    await router.deleteRoute(req.params.serverAddress);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// ---- 默认路由 ----
app.post('/api/default-route', async (req, res) => {
  try {
    const { backend } = req.body || {};
    await router.setDefaultRoute(backend);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// ---- 指标（解析后的 Prometheus）----
app.get('/api/metrics', async (req, res) => {
  try {
    const metrics = await router.getMetrics();
    res.json(metrics);
  } catch (e) {
    res.status(502).json({ error: '无法获取指标', detail: e.message });
  }
});

// ---- 健康检查（供 docker healthcheck / compose 依赖判断）----
app.get('/health', (req, res) => res.json({ ok: true }));

// ---- 服务 React 构建产物 ----
const DIST_DIR = path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // SPA history fallback：非 /api、非 /health 的 GET 一律回 index.html
  app.get(/^(?!\/api|\/health).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} else {
  console.warn('[panel] dist/ 不存在，仅 API 模式（开发态请先 npm run build）');
}

app.listen(PORT, () => {
  console.log(`[panel] 监听 :${PORT}，mc-router API=${ROUTER_API}`);
});
