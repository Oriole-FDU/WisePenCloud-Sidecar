# Stage 1: Builder
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /build
RUN pnpm config set registry https://repo.huaweicloud.com/repository/npm/

# 拷贝依赖配置文件
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./ 
COPY patches ./patches

# 执行依赖安装
RUN pnpm install --frozen-lockfile

# 拷贝剩余源码并构建
COPY . .
RUN pnpm run build

# Stage 2: Runner
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
RUN pnpm config set registry https://repo.huaweicloud.com/repository/npm/
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

# 拷贝依赖配置文件
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY patches ./patches

# 安装生产依赖
RUN pnpm install --prod --frozen-lockfile

# 拷贝构建产物
COPY --from=builder /build/dist ./dist

EXPOSE 9700
CMD ["node", "dist/index.js"]