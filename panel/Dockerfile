# ============================================================
# Panel 镜像 —— 多阶段构建
# ------------------------------------------------------------
# Stage 1: 构建 React 前端 (Vite)
# Stage 2: 运行时 —— 仅 Express + 静态产物
# ============================================================

# ---- Stage 1: 构建前端 ----
FROM node:22-alpine AS build
WORKDIR /app

# 先拷依赖清单，利用 docker 层缓存
COPY package.json package-lock.json* ./
RUN npm ci

# 拷源码并构建
COPY . .
RUN npm run build

# ---- Stage 2: 运行时 ----
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# 仅装生产依赖
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# 拷前端产物与后端
COPY --from=build /app/dist ./dist
COPY server ./server
COPY config ./config

EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -q --spider http://localhost:8080/health || exit 1

CMD ["node", "server/index.js"]
