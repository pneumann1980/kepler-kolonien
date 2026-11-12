# syntax=docker/dockerfile:1
# ---------- Build: Client bündeln, Tests laufen lassen ----------
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
# Optionales CA-Bundle (nur für Builds hinter TLS-inspizierenden Proxys): --secret id=ca,src=<bundle>
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY content ./content
COPY scripts ./scripts
COPY src ./src
COPY tests ./tests
RUN npx tsc --noEmit \
 && node --disable-warning=ExperimentalWarning --test tests/engine.test.ts \
 && npm run build \
 && npm prune --omit=dev

# ---------- Laufzeit ----------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8210 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/dist/public \
    TZ=Europe/Berlin
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/content ./content
COPY --from=build /src/src/engine ./src/engine
COPY --from=build /src/src/server ./src/server
COPY --from=build /src/dist/public ./dist/public
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8210
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:8210/healthz || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/start.ts"]
