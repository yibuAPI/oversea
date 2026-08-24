# 多阶段构建：Node 编译静态产物 -> nginx 托管 + 反代后端
#
# 用法（单容器）：
#   docker build -t onestep-web .
#   docker run -d -p 8080:80 -e BACKEND_ORIGIN=http://host.docker.internal:3000 onestep-web
# 推荐直接用 docker-compose up -d（见 docker-compose.yml）。

# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /app

# 先拷依赖清单利用层缓存；bun.lock 仅作参考，容器内统一用 npm 安装
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
# 只跑 vite build，不跑 vue-tsc —— 类型检查在 CI/本地做，
# 不该让历史遗留的类型报错卡住部署
RUN npx vite build

# ---------- 运行阶段 ----------
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
# 模板里的 ${BACKEND_ORIGIN} 由 nginx 官方镜像的 envsubst 入口脚本
# 在启动时渲染到 /etc/nginx/conf.d/default.conf
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template

ENV BACKEND_ORIGIN=http://backend:3000

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
