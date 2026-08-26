FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production \
    AI_FF_HOST=0.0.0.0 \
    AI_FF_PORT=8080 \
    AI_FF_DB_PATH=/data/app.sqlite \
    AI_FF_WEB_ROOT=/app/apps/web/dist
COPY --from=build /app /app
VOLUME ["/data"]
EXPOSE 8080
CMD ["pnpm", "--filter", "@ai-ff/daemon", "start"]
