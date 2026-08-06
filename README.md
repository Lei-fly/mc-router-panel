# mc-router 面板

基于 [itzg/mc-router](https://github.com/itzg/mc-router) 的 Minecraft 域名路由方案,附带 Web 管理面板。

## 工作原理

mc-router 根据玩家连接时使用的**域名**将流量转发到对应后端服务器(类似 Nginx 虚拟主机)。Web 面板通过 REST API 管理路由配置,并提供实时连接监控。

```
玩家 ──:25565──▶ mc-router ──按域名转发──▶ 后端服务器
浏览器 ──:8080──▶ 面板 ──REST──▶ mc-router 内部 API(:25566,不对外)
```

公网仅暴露 `25565`(游戏)与 `8080`(面板)两个端口。

## 部署

**前置**：Docker 与 Docker Compose v2

```bash
git clone https://github.com/Lei-fly/mc-router-panel.git && cd mc-router-panel
cd docker
cp .env.example .env
# 编辑 .env,设置 PANEL_PASSWORD
docker compose up -d
```

浏览器访问 `http://<服务器IP>:8080`,使用 `.env` 中的密码登录。

## 配置

编辑 `docker/.env`：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PANEL_PORT` | 面板端口 | `8080` |
| `PANEL_PASSWORD` | 面板登录密码 | — |
| `ROUTER_PORT` | Minecraft 连接端口 | `25565` |
| `USE_PROXY_PROTOCOL` | PROXY protocol 透传开关 | `false` |

### PROXY protocol

默认关闭。开启后(`USE_PROXY_PROTOCOL=true`)mc-router 会向**所有**后端插入 PROXY v2 头以透传玩家真实 IP,需所有后端同步开启解析,否则玩家无法连接:

- 原版:不支持 PROXY protocol,需在前端放置 Velocity/BungeeCord 或安装 HAProxy 解析 mod
- Paper:`config/paper-global.yml` 设 `proxies.proxy-protocol=true`
- Velocity:`velocity.toml` 设 `[advanced] haproxy-protocol=true`

## 目录结构

```
docker/     编排(.env + docker-compose.yml)
panel/      React + Express 面板
  server/   鉴权 + REST 代理 + 指标解析
  src/      登录 / 路由管理 / 实时监控
config/     路由种子配置
data/       运行时数据卷(路由配置、密钥,gitignore)
.github/    CI(自动构建并发布镜像到 GHCR)
```

## 许可证

MIT。核心组件 [mc-router](https://github.com/itzg/mc-router) 同为 MIT。

## 致谢

- [itzg/mc-router](https://github.com/itzg/mc-router) —— 轻量 Minecraft 连接路由器
- [React](https://react.dev/) / [Express](https://expressjs.com/) / [Vite](https://vitejs.dev/)
