# SPDX-License-Identifier: AGPL-3.0-or-later
# Imagen única de vibe-gambling: servidor (Fastify) + estáticos de la web + migraciones.
# Multi-stage: se compila todo con pnpm y el runtime solo lleva JavaScript empaquetado por
# esbuild (sin node_modules, sin TypeScript), con usuario sin privilegios.
# El mismo binario incluye el GitHub falso (`node dist/fake-github.js`), que solo se arranca en
# el compose de desarrollo; producción ejecuta `node dist/main.js`.

ARG NODE_VERSION=26

# ---------------------------------------------------------------- build
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /repo
ENV CI=true

# pnpm en la versión exacta de `packageManager` del package.json raíz.
COPY package.json ./
RUN npm install --global --no-fund --no-audit \
      "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"

# Primero solo los manifiestos: la capa de dependencias se reutiliza mientras no cambien.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile \
      --filter "@vibe-gambling/server..." --filter "@vibe-gambling/web..."

COPY tsconfig.base.json ./
COPY config ./config
# Textos y banderas de cada idioma: la web los empaqueta (import.meta.glob) en la build.
COPY locales ./locales
# La web importa el logo de docs/brand (fuente única de la marca).
COPY docs/brand ./docs/brand
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
COPY packages/web ./packages/web
# `--build-arg SKIP_WEB=true` construye solo la API (el servidor arranca igual sin la web).
ARG SKIP_WEB=false
RUN if [ "${SKIP_WEB}" != "true" ]; then pnpm --filter @vibe-gambling/web run --if-present build; fi \
    && mkdir -p packages/web/dist \
    && pnpm --filter @vibe-gambling/server build

# ---------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=root:root /repo/packages/server/dist ./dist
COPY --from=build --chown=root:root /repo/packages/server/drizzle ./drizzle
COPY --from=build --chown=root:root /repo/packages/web/dist ./web
COPY --from=build --chown=root:root /repo/config ./config

# Todo es de root y de solo lectura para el proceso; corre como `node` (uid 1000).
# Compatible con `read_only: true`: no escribe nada fuera de /tmp.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "--enable-source-maps", "dist/main.js"]
