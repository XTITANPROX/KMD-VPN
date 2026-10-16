# KalFetela Panel — Railway / Docker image
# Stage 1: build (TypeScript → dist, native modules compiled)
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* .npmrc* ./
RUN npm install --no-audit --no-fund --legacy-peer-deps

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: runtime
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    XRAY_DIR=/data/xray

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data /data/xray

COPY package.json package-lock.json* .npmrc* ./
RUN npm install --omit=dev --no-audit --no-fund --legacy-peer-deps && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY public ./public
COPY agent ./agent
COPY scripts ./scripts

# Panel HTTP port + default embedded Xray inbounds
EXPOSE 8080 10001 10002 10003 10004

VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=4 CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
