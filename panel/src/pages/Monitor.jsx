import { useEffect, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { api } from '../api.js';

const POLL_MS = 4000;
const HISTORY = 30; // 保留最近 N 个采样点

export default function Monitor() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]); // [{t, active, bytes, perServer:{}}]
  const [prevBytes, setPrevBytes] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const m = await api.getMetrics();
        if (cancelled) return;
        setMetrics(m);
        setError('');

        const now = new Date();
        const t = now.toLocaleTimeString();

        // 活跃连接
        const active = sumMetric(m, 'mc_router_active_connections');
        // 总流量（counter）
        const bytes = sumMetric(m, 'mc_router_bytes');
        // 每服活跃连接
        const perServer = {};
        for (const item of (m.mc_router_server_active_connections || [])) {
          const addr = item.labels.server_address;
          if (addr) perServer[addr] = (perServer[addr] || 0) + item.value;
        }
        // 瞬时流量速率（bytes/s）
        let rate = 0;
        if (prevBytes != null && bytes >= prevBytes) {
          rate = (bytes - prevBytes) / (POLL_MS / 1000);
        }
        setPrevBytes(bytes);

        setHistory((h) => [...h.slice(-(HISTORY - 1)), { t, active, bytes, rate, perServer }]);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };

    poll();
    timerRef.current = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 派生数据
  const totalConnections = sumMetric(metrics, 'mc_router_frontend_connections');
  const totalBackend = sumMetric(metrics, 'mc_router_backend_connections');
  const activePlayers = (metrics?.mc_router_server_active_player || []).filter((p) => p.value === 1);
  const errors = metrics?.mc_router_errors || [];

  // 错误按 type 聚合
  const errorByType = {};
  for (const e of errors) {
    const k = e.labels?.type || 'unknown';
    errorByType[k] = (errorByType[k] || 0) + e.value;
  }

  const latestActive = history.length ? history[history.length - 1].active : 0;
  const latestRate = history.length ? history[history.length - 1].rate : 0;

  // 图表数据：每服活跃连接的时间序列
  const allServers = new Set();
  history.forEach((h) => Object.keys(h.perServer).forEach((s) => allServers.add(s)));
  const chartData = history.map((h) => {
    const row = { t: h.t };
    for (const s of allServers) row[s] = h.perServer[s] ?? 0;
    return row;
  });
  const colors = ['#09add3', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

  return (
    <div>
      <h2>实时监控</h2>
      <p className="muted">每 {POLL_MS / 1000}s 采样一次，来自 mc-router 的 Prometheus 指标。</p>

      {error && <div className="error">无法获取指标：{error}</div>}

      <div className="stat-grid">
        <StatCard label="活跃连接" value={latestActive} />
        <StatCard label="瞬时流量" value={fmtRate(latestRate)} />
        <StatCard label="累计连接" value={fmtNum(totalConnections)} />
        <StatCard label="后端连接" value={fmtNum(totalBackend)} />
        <StatCard label="在线玩家" value={activePlayers.length} />
      </div>

      <div className="card">
        <h3>每服活跃连接</h3>
        {chartData.length < 2 ? (
          <p className="muted">采集中…</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} />
              <Tooltip />
              <Legend />
              {[...allServers].map((s, i) => (
                <Line key={s} type="monotone" dataKey={s} stroke={colors[i % colors.length]} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>在线玩家</h3>
          {activePlayers.length === 0 ? (
            <p className="muted">暂无在线玩家</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>玩家</th><th>所在服</th></tr></thead>
              <tbody>
                {activePlayers.map((p) => (
                  <tr key={p.labels.player_uuid || p.labels.player_name}>
                    <td className="mono">{p.labels.player_name}</td>
                    <td className="mono">{p.labels.server_address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3>错误统计</h3>
          {Object.keys(errorByType).length === 0 ? (
            <p className="muted">无错误 🎉</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>类型</th><th>次数</th></tr></thead>
              <tbody>
                {Object.entries(errorByType).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
                  <tr key={type}><td className="mono">{type}</td><td>{n}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// --- 工具 ---
function sumMetric(metrics, name) {
  if (!metrics || !metrics[name]) return 0;
  return metrics[name].reduce((s, m) => s + m.value, 0);
}
function fmtNum(n) {
  if (n == null) return '-';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}
function fmtRate(bytesPerSec) {
  if (!bytesPerSec) return '0 B/s';
  if (bytesPerSec >= 1e6) return (bytesPerSec / 1e6).toFixed(2) + ' MB/s';
  if (bytesPerSec >= 1e3) return (bytesPerSec / 1e3).toFixed(1) + ' KB/s';
  return bytesPerSec.toFixed(0) + ' B/s';
}
