// ============================================================
// mc-router REST + Prometheus 客户端
// ------------------------------------------------------------
// 封装对 mc-router 内部 API (http://mc-router:25566) 的调用：
//   - 路由 CRUD：GET/POST/DELETE /routes、POST /defaultRoute
//   - 指标解析：抓 /metrics（Prometheus 文本格式）→ 结构化 JSON
// 同时承担输入校验。
// ============================================================

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * 校验 serverAddress（客户端连接用的域名）
 * 允许：域名（含子域）、SRV 风格，禁止空与明显非法字符
 */
export function validateServerAddress(addr) {
  if (typeof addr !== 'string' || addr.length === 0 || addr.length > 253) return false;
  // 域名标签：字母数字-，点分隔；允许末尾 .
  return /^[a-z0-9_.-]+\.?[a-z0-9_-]+$/i.test(addr) && !addr.includes('..');
}

/**
 * 校验 backend（host:port 形式）
 * 允许 IPv4、域名、容器服务名 + 端口
 */
export function validateBackend(backend) {
  if (typeof backend !== 'string' || backend.length === 0) return false;
  const m = backend.match(/^(.+):(\d{1,5})$/);
  if (!m) return false;
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return false;
  const host = m[1];
  if (host.length === 0 || host.length > 253) return false;
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split('.').every((o) => Number(o) <= 255);
  }
  // 域名/服务名
  return /^[a-z0-9_.-]+$/i.test(host);
}

export class McRouterClient {
  constructor({ baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (!baseUrl) throw new Error('ROUTER_API 未设置');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  /** 内部 fetch 封装：统一超时与错误处理 */
  async _fetch(path, { method = 'GET', body } = {}) {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const opts = { method, signal: controller.signal };
      if (body !== undefined) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(url, opts);
      const text = await res.text();
      if (!res.ok) {
        let detail = text;
        try { detail = JSON.parse(text); } catch { /* keep raw */ }
        const err = new Error(`mc-router 返回 ${res.status}`);
        err.status = res.status;
        err.detail = detail;
        throw err;
      }
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET /routes → { serverAddress: { backend, scalingTarget } } 或带 default */
  async listRoutes() {
    const data = await this._fetch('/routes');
    return data || {};
  }

  /** POST /routes —— 创建/更新路由（含输入校验） */
  async createRoute(serverAddress, backend) {
    if (!validateServerAddress(serverAddress)) {
      const err = new Error('域名格式不合法'); err.status = 400; throw err;
    }
    if (!validateBackend(backend)) {
      const err = new Error('后端格式不合法（应为 host:port）'); err.status = 400; throw err;
    }
    return this._fetch('/routes', { method: 'POST', body: { serverAddress, backend } });
  }

  /** DELETE /routes/{serverAddress} */
  async deleteRoute(serverAddress) {
    if (!validateServerAddress(serverAddress)) {
      const err = new Error('域名格式不合法'); err.status = 400; throw err;
    }
    return this._fetch(`/routes/${encodeURIComponent(serverAddress)}`, { method: 'DELETE' });
  }

  /** POST /defaultRoute —— 设置默认后端 */
  async setDefaultRoute(backend) {
    if (!validateBackend(backend)) {
      const err = new Error('后端格式不合法（应为 host:port）'); err.status = 400; throw err;
    }
    return this._fetch('/defaultRoute', { method: 'POST', body: { backend } });
  }

  /**
   * 抓取 /metrics（Prometheus 文本格式）并解析为结构化 JSON
   * 提取面板关心的指标
   */
  async getMetrics() {
    const url = `${this.baseUrl}/metrics`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`/metrics 返回 ${res.status}`);
      const text = await res.text();
      return parsePrometheusText(text);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 解析 Prometheus exposition 文本为结构化对象
 * 纯函数，可独立测试
 *
 * 输入样例：
 *   mc_router_active_connections 3
 *   mc_router_bytes 1.8e+06
 *   mc_router_backend_connections{host="mc-1:25565",side="backend"} 12
 *
 * 输出：
 *   {
 *     mc_router_active_connections: [{ value: 3, labels: {} }],
 *     mc_router_bytes: [{ value: 1840000, labels: {} }],
 *     mc_router_backend_connections: [{ value: 12, labels: { host: "mc-1:25565", side: "backend" } }]
 *   }
 */
export function parsePrometheusText(text) {
  const result = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parsed = parseMetricLine(line);
    if (!parsed) continue;
    if (!result[parsed.name]) result[parsed.name] = [];
    result[parsed.name].push({ value: parsed.value, labels: parsed.labels });
  }
  return result;
}

/** 解析单行：name{labels} value 或 name value */
function parseMetricLine(line) {
  // 先分离 value（最后一个空白后的数字）
  const lastSpace = line.lastIndexOf(' ');
  if (lastSpace < 0) return null;
  const nameLabelsPart = line.slice(0, lastSpace);
  const valueStr = line.slice(lastSpace + 1).trim();
  // 跳过带标签的辅助列如 mc_router_x_total 1.0 (时间戳) —— 仅取首个数字
  if (valueStr.includes(' ')) return null;
  const value = Number(valueStr);
  if (!Number.isFinite(value)) return null;

  // 分离 name 与 {labels}
  const braceIdx = nameLabelsPart.indexOf('{');
  let name, labels;
  if (braceIdx < 0) {
    name = nameLabelsPart;
    labels = {};
  } else {
    const labelsStr = nameLabelsPart.slice(braceIdx + 1, nameLabelsPart.lastIndexOf('}'));
    name = nameLabelsPart.slice(0, braceIdx);
    labels = parseLabels(labelsStr);
  }
  // 去掉 prometheus 的 _total/_count/_sum 等后缀不影响这里的原始名（保留原样）
  return { name, value, labels };
}

/** 解析 label="value",label2="value2" */
function parseLabels(str) {
  const labels = {};
  if (!str) return labels;
  const re = /(\w+)="((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    labels[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return labels;
}
