// 测试 auth：密码校验、session 签发/校验、过期、防伪造
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Auth } from '../server/auth.js';

// 每个测试用独立临时目录，互不干扰 secret
function tmpDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-auth-'));
  return dir;
}

test('Auth: 正确密码通过校验', () => {
  const dir = tmpDataDir();
  const auth = new Auth({ password: 's3cret-pass', dataDir: dir });
  assert.equal(auth.verifyPassword('s3cret-pass'), true);
});

test('Auth: 错误密码拒绝', () => {
  const dir = tmpDataDir();
  const auth = new Auth({ password: 's3cret-pass', dataDir: dir });
  assert.equal(auth.verifyPassword('wrong'), false);
  assert.equal(auth.verifyPassword(''), false);
});

test('Auth: 缺密码抛错', () => {
  const dir = tmpDataDir();
  assert.throws(() => new Auth({ password: '', dataDir: dir }), /PANEL_PASSWORD/);
});

test('Auth: session 签发并校验通过', () => {
  const dir = tmpDataDir();
  const auth = new Auth({ password: 'p', dataDir: dir });
  const session = auth.issueSession();
  assert.equal(auth.verifySession(session), true);
});

test('Auth: 伪造签名拒绝', () => {
  const dir = tmpDataDir();
  const auth = new Auth({ password: 'p', dataDir: dir });
  const session = auth.issueSession();
  // 篡改签名尾段
  const tampered = session.slice(0, -2) + '00';
  assert.equal(auth.verifySession(tampered), false);
  // 完全乱写
  assert.equal(auth.verifySession('garbage'), false);
  assert.equal(auth.verifySession(''), false);
  assert.equal(auth.verifySession(null), false);
});

test('Auth: secret 持久化 —— 重启后旧 session 仍有效', () => {
  const dir = tmpDataDir();
  const auth1 = new Auth({ password: 'p', dataDir: dir });
  const session = auth1.issueSession();
  // 用同目录重建（模拟重启，复用 .panel_secret）
  const auth2 = new Auth({ password: 'p', dataDir: dir });
  assert.equal(auth2.verifySession(session), true, '旧 session 应在重启后仍有效');
});

test('Auth: 不同 secret 的实例互相拒绝（密钥隔离）', () => {
  const dir1 = tmpDataDir();
  const dir2 = tmpDataDir();
  const auth1 = new Auth({ password: 'p', dataDir: dir1 });
  const auth2 = new Auth({ password: 'p', dataDir: dir2 });
  const session = auth1.issueSession();
  assert.equal(auth2.verifySession(session), false, '不同 secret 应拒绝对方的 session');
});

test('requireAuth: 未登录返回 401', () => {
  const dir = tmpDataDir();
  const auth = new Auth({ password: 'p', dataDir: dir });
  const req = { headers: {} };
  let status = null, jsonBody = null;
  const res = {
    status(s) { status = s; return this; },
    json(b) { jsonBody = b; return this; },
  };
  auth.requireAuth(req, res, () => {});
  assert.equal(status, 401);
});

test('requireAuth: 有效 cookie 放行', () => {
  const dir = tmpDataDir();
  const auth = new Auth({ password: 'p', dataDir: dir });
  const session = auth.issueSession();
  const req = { headers: { cookie: `${auth.cookieName}=${session}` } };
  let called = false;
  const res = { status() { return this; }, json() { return this; } };
  auth.requireAuth(req, res, () => { called = true; });
  assert.equal(called, true);
});
