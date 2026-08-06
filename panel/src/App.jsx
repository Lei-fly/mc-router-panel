import { HashRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import RoutesPage from './pages/Routes.jsx';
import Monitor from './pages/Monitor.jsx';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/routes" element={<RequireAuth><RoutesPage /></RequireAuth>} />
        <Route path="/monitor" element={<RequireAuth><Monitor /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/routes" replace />} />
      </Routes>
    </HashRouter>
  );
}

/** 路由守卫：未登录则跳 /login（基于一次 API 探测） */
function RequireAuth({ children }) {
  // 简化方案：靠后端 401 兜底。这里仅渲染布局 + 导航。
  // 真正未登录时，任意 API 调用会触发 api.js 里的 401 跳转。
  return (
    <div className="layout">
      <Nav />
      <main className="content">{children}</main>
    </div>
  );
}

function Nav() {
  const loc = useLocation();
  const item = (to, label) => (
    <Link to={to} className={loc.pathname === to ? 'nav-item active' : 'nav-item'}>{label}</Link>
  );
  const logout = async (e) => {
    e.preventDefault();
    try {
      await api.logout();
    } catch { /* ignore */ }
    window.location.hash = '#/login';
  };
  return (
    <nav className="nav">
      <div className="nav-brand">mc-router</div>
      <div className="nav-links">
        {item('/routes', '路由管理')}
        {item('/monitor', '实时监控')}
      </div>
      <a href="#/login" className="nav-item" onClick={logout}>登出</a>
    </nav>
  );
}
