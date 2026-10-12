<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# @vibe-gambling/server

Fastify + `@fastify/websocket` + Drizzle/Postgres. Es la única autoridad del juego: tira la
ruleta (`crypto.randomInt`), lleva el saldo, hace el login con GitHub (Device Flow) y sirve la web.

## Arrancar en local

```sh
# Pila completa en Docker: Postgres (5436), GitHub falso (8788) y servidor (8787)
docker compose -f deploy/docker-compose.dev.yml up -d --build
#   DEV_SKIP_WEB=true …  → solo la API, si la web todavía no compila
curl localhost:8787/healthz

# O el servidor desde el código (con el Postgres y el GitHub falso del compose levantados)
pnpm --filter @vibe-gambling/server dev
```

`dev`, `dev:fake-github` y `db:migrate` leen `deploy/dev.env` (valores de desarrollo, sin
secretos). Las variables que ya existan en el entorno tienen prioridad.

Login de prueba con `curl` contra el GitHub falso (autoriza en el segundo poll):

```sh
curl -s -XPOST localhost:8787/api/auth/device/start -H 'content-type: application/json' -d '{"v":1}'
curl -s -XPOST localhost:8787/api/auth/device/poll  -H 'content-type: application/json' -d '{"v":1,"pollId":"…"}'
# …repite el poll y usa el `token` como `Authorization: Bearer …`
```

## Scripts

| Script                    | Qué hace                                                                 |
| ------------------------- | ------------------------------------------------------------------------ |
| `typecheck`               | `tsc` sin emitir                                                         |
| `test`                    | Unitarios (Vitest, sin Docker)                                           |
| `test:integration`        | Integración contra Postgres real: `TEST_DATABASE_URL` o testcontainers   |
| `build`                   | esbuild → `dist/main.js`, `dist/migrate.js`, `dist/fake-github.js`       |
| `dev` / `dev:fake-github` | Servidor / GitHub falso con recarga (tsx)                                |
| `start`                   | `node dist/main.js`                                                      |
| `db:generate`             | Genera una migración en `drizzle/` a partir de `src/db/schema.ts`        |
| `db:migrate`              | Aplica las migraciones pendientes (en la imagen: `node dist/migrate.js`) |

## Configuración

Todo sale del entorno, validado con zod en `src/config.ts`; si falta algo, el proceso no arranca
y dice qué. **Todas las variables están documentadas en [`deploy/.env.example`](../../deploy/.env.example)**
(producción) y tienen valores de desarrollo en [`deploy/dev.env`](../../deploy/dev.env). Los
números del juego están en `config/game.json` y los textos del sitio en `config/site.json`.

## Estructura

```
src/
  main.ts            arranque, migraciones y apagado ordenado
  app.ts             construye Fastify (sin escuchar): plugins, rutas, WebSocket
  config.ts          único lector del entorno (y del GitHub falso)
  db/                esquema Drizzle, cliente y migraciones con cerrojo
  services/          juego (turnos, boleto, préstamo), auth (sesiones, enlaces, Device Flow),
                     rankings, temporadas (job) y cliente de GitHub
  http/              rutas /api, públicas (/config.json, /healthz, estáticos), seguridad, errores
  ws/                hub en memoria y ruta /ws
  fake-github/       GitHub falso para desarrollo, tests y E2E (nunca en producción)
drizzle/             migraciones versionadas (generadas, no se editan a mano)
test/unit/           sin base de datos
test/integration/    Postgres real, una base de datos por archivo
```

Las decisiones de diseño (cerrojos, idempotencia, logs sin datos personales…) están en
[`docs/DECISIONES.md`](../../docs/DECISIONES.md), secciones _Servidor_ y _Despliegue_.
