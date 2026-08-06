import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';

export default function RoutesPage() {
  const [routes, setRoutes] = useState(null);
  const [defaultServer, setDefaultServer] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  // 新增表单
  const [newAddr, setNewAddr] = useState('');
  const [newBackend, setNewBackend] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api.getRoutes();
      // mc-router 返回格式：{ mappings?: {...}, "default-server"?: ..., 以及扁平的 域名:{backend} }
      // 兼容两种结构：直接键 = 域名→{backend}，或嵌套在 mappings
      const flat = {};
      let def = null;
      for (const [k, v] of Object.entries(data)) {
        if (k === 'default-server') { def = v; continue; }
        if (k === 'mappings') {
          for (const [mk, mv] of Object.entries(v)) flat[mk] = typeof mv === 'string' ? mv : mv.backend;
          continue;
        }
        // 域名 → {backend} 或字符串
        flat[k] = typeof v === 'string' ? v : v?.backend ?? String(v);
      }
      setRoutes(flat);
      setDefaultServer(def);
    } catch (e) {
      setError(e.message);
      setRoutes({});
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const addRoute = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.createRoute(newAddr.trim(), newBackend.trim());
      setNewAddr(''); setNewBackend('');
      flash(`已添加 ${newAddr}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (addr) => {
    if (!confirm(`确定删除路由 ${addr}？`)) return;
    try {
      await api.deleteRoute(addr);
      flash(`已删除 ${addr}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const setDefault = async (backend) => {
    try {
      await api.setDefaultRoute(backend);
      flash(`默认路由已设为 ${backend}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const entries = routes ? Object.entries(routes) : null;

  return (
    <div>
      <h2>路由管理</h2>
      <p className="muted">客户端连接域名 → 后端服务器。保存即时生效，玩家无需重连。</p>

      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}

      <form className="card add-form" onSubmit={addRoute}>
        <h3>添加 / 更新路由</h3>
        <div className="form-row">
          <input
            placeholder="域名 (如 mc.example.com)"
            value={newAddr}
            onChange={(e) => setNewAddr(e.target.value)}
            required
          />
          <input
            placeholder="后端 (如 127.0.0.1:25575)"
            value={newBackend}
            onChange={(e) => setNewBackend(e.target.value)}
            required
          />
          <button type="submit">添加</button>
        </div>
      </form>

      <div className="card">
        <h3>当前路由 {entries && <span className="count">({entries.length})</span>}</h3>
        {routes === null ? (
          <p className="muted">加载中…</p>
        ) : entries.length === 0 ? (
          <p className="muted">暂无路由</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>域名</th><th>后端</th><th>默认</th><th></th></tr>
            </thead>
            <tbody>
              {entries.map(([addr, backend]) => (
                <tr key={addr}>
                  <td className="mono">{addr}</td>
                  <td className="mono">{backend}</td>
                  <td>
                    {defaultServer === backend
                      ? <span className="badge badge-green">默认</span>
                      : <button className="btn-link" onClick={() => setDefault(backend)}>设为默认</button>}
                  </td>
                  <td>
                    <button className="btn-danger" onClick={() => remove(addr)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
