// API 封装：统一 fetch，401 自动跳登录
const BASE = '';

async function request(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    // 登录接口的 401（密码错误）必须把错误体原样抛给登录页展示，
    // 不能被 401 拦截器吞掉跳转。只有「非登录接口」的 401 才视为会话失效。
    if (res.status === 401 && !path.endsWith('/login')) {
      window.location.hash = '#/login';
    }
    const err = new Error(data?.error || `请求失败 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  login: (password) => request('/api/login', { method: 'POST', body: { password } }),
  logout: () => request('/api/logout', { method: 'POST' }),
  getRoutes: () => request('/api/routes'),
  createRoute: (serverAddress, backend) =>
    request('/api/routes', { method: 'POST', body: { serverAddress, backend } }),
  deleteRoute: (serverAddress) =>
    request(`/api/routes/${encodeURIComponent(serverAddress)}`, { method: 'DELETE' }),
  setDefaultRoute: (backend) =>
    request('/api/default-route', { method: 'POST', body: { backend } }),
  getMetrics: () => request('/api/metrics'),
};
