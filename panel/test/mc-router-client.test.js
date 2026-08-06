// 测试 mc-router-client：Prometheus 文本解析 + 输入校验
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrometheusText, validateServerAddress, validateBackend } from '../server/mc-router-client.js';

test('parsePrometheusText: 解析无标签指标', () => {
  const text = `# HELP mc_router_active_connections 活跃连接
# TYPE mc_router_active_connections gauge
mc_router_active_connections 3`;
  const out = parsePrometheusText(text);
  assert.deepEqual(out.mc_router_active_connections, [{ value: 3, labels: {} }]);
});

test('parsePrometheusText: 解析带标签指标', () => {
  const text = `mc_router_backend_connections{host="mc-1:25565",side="backend"} 12`;
  const out = parsePrometheusText(text);
  assert.deepEqual(out.mc_router_backend_connections, [
    { value: 12, labels: { host: 'mc-1:25565', side: 'backend' } },
  ]);
});

test('parsePrometheusText: 科学计数法数值', () => {
  const text = `mc_router_bytes 1.842341e+06`;
  const out = parsePrometheusText(text);
  assert.equal(out.mc_router_bytes[0].value, 1842341);
});

test('parsePrometheusText: 跳过注释与空行', () => {
  const text = `
# HELP foo
# TYPE foo counter

mc_router_active_connections 5
`;
  const out = parsePrometheusText(text);
  assert.deepEqual(Object.keys(out), ['mc_router_active_connections']);
});

test('parsePrometheusText: 多玩家指标（高基数 label）', () => {
  const text = `
mc_router_server_active_player{player_name="Steve",player_uuid="abc",server_address="mc.example.com"} 1
mc_router_server_active_player{player_name="Alex",player_uuid="def",server_address="mc.example.com"} 1
`;
  const out = parsePrometheusText(text);
  assert.equal(out.mc_router_server_active_player.length, 2);
  assert.equal(out.mc_router_server_active_player[0].labels.player_name, 'Steve');
});

test('validateServerAddress: 合法域名', () => {
  assert.equal(validateServerAddress('mc.example.com'), true);
  assert.equal(validateServerAddress('play.sub.domain.example.com'), true);
});

test('validateServerAddress: 非法输入', () => {
  assert.equal(validateServerAddress(''), false);
  assert.equal(validateServerAddress('has space'), false);
  assert.equal(validateServerAddress('a..b'), false);
  assert.equal(validateServerAddress(null), false);
});

test('validateBackend: 合法 host:port', () => {
  assert.equal(validateBackend('127.0.0.1:25575'), true);
  assert.equal(validateBackend('mc-1:25565'), true);
  assert.equal(validateBackend('example.com:25565'), true);
});

test('validateBackend: 非法', () => {
  assert.equal(validateBackend('127.0.0.1'), false);       // 无端口
  assert.equal(validateBackend('host:99999'), false);         // 端口越界
  assert.equal(validateBackend('host:0'), false);             // 端口 0
  assert.equal(validateBackend(''), false);
  assert.equal(validateBackend('host:abc'), false);
});
