# {{name}} server {{version}} (without Docker)

The {{name}} server, ready to run with plain Node.js: the API, the WebSocket and the web window it serves. Everything is bundled: no `npm install`, no build step.

The Docker image (`{{image}}:{{version}}`) is the recommended way to run it ([docs/SELF-HOSTING.md]({{repoUrl}}/blob/v{{version}}/docs/SELF-HOSTING.md)). Use this archive when you would rather not use Docker.

## Contents

| Path           | What it is                                                                |
| -------------- | ------------------------------------------------------------------------- |
| `dist/`        | The server, bundled with esbuild (`main.js`) and the migration runner     |
| `web/`         | The built web window and site, served by the server (`WEB_DIST_DIR`)      |
| `drizzle/`     | Database migrations (`MIGRATIONS_DIR`)                                    |
| `config/`      | Game rules and instance texts (`GAME_CONFIG_PATH`, `SITE_CONFIG_PATH`)    |
| `.env.example` | Every environment variable, documented (it is the Docker one: see step 2) |
| `package.json` | Only `start` and `migrate` scripts; there are no dependencies to install  |

## Requirements

- Node.js {{node}} (`node --version`).
- PostgreSQL 17 with an empty database and a user that owns it.
- A reverse proxy with HTTPS in front of it (Caddy, nginx, Traefik…), with WebSockets enabled.
- A GitHub OAuth App with _Enable Device Flow_ checked ([how]({{repoUrl}}/blob/v{{version}}/docs/DESPLIEGUE.md)).

## Install

1. Check the download and unpack it:

   ```sh
   sha256sum --check --ignore-missing SHA256SUMS
   tar -xzf {{archive}}.tar.gz
   cd {{archive}}
   ```

2. Create `.env` from the example and fill it in. The server validates every variable at startup and refuses to start, naming the culprit, if one is missing or wrong. Outside Docker, change at least:

   ```sh
   cp .env.example .env
   ```

   | Variable                                                                 | Value outside Docker                                                      |
   | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
   | `DATABASE_URL`                                                           | `postgres://USER:PASSWORD@HOST:5432/DB` (uncomment it)                    |
   | `HOST` / `PORT`                                                          | `127.0.0.1` and a free port, so only the reverse proxy can reach it       |
   | `PUBLIC_URL`                                                             | Your public origin, e.g. `https://vibe.example.com`                       |
   | `GITHUB_CLIENT_ID`                                                       | The Client ID of your OAuth App                                           |
   | `MIGRATIONS_DIR`, `WEB_DIST_DIR`, `GAME_CONFIG_PATH`, `SITE_CONFIG_PATH` | `./drizzle`, `./web`, `./config/game.json`, `./config/site.json`          |
   | `TRUST_PROXY_CIDRS` / `REAL_IP_HEADER`                                   | The proxy's address (`127.0.0.1/32`) and the header it sets (`X-Real-IP`) |
   | `INSTANCE_NAME`, `IS_OFFICIAL`, and `instance` in `config/site.json`     | Your instance's name, `false`, and who runs it (shown on `/privacy`)      |

   `IMAGE_TAG`, `DOCKER_SUBNET`, `POSTGRES_*`, `BACKUP_*` and `SITE_ADDRESS` are only for Docker Compose: the server ignores them.

3. Start it from this folder (relative paths are resolved from the working directory). Pending migrations are applied at startup while `MIGRATE_ON_START=true`; otherwise run `npm run migrate` first.

   ```sh
   npm start        # node --env-file=.env --enable-source-maps dist/main.js
   curl -fsS http://127.0.0.1:8787/healthz
   ```

4. Keep it running with your service manager. A systemd unit, for example:

   ```ini
   [Unit]
   Description={{name}} server
   After=network-online.target postgresql.service

   [Service]
   User={{name}}
   WorkingDirectory=/opt/{{archive}}
   ExecStart=/usr/bin/node --env-file=.env --enable-source-maps dist/main.js
   Restart=on-failure
   NoNewPrivileges=true
   ProtectSystem=strict
   PrivateTmp=true

   [Install]
   WantedBy=multi-user.target
   ```

5. Point the reverse proxy at `HOST:PORT` (with WebSockets on `/ws`), then, in Claude Code: `/vibe-server https://vibe.example.com` and `/vibe-login`.

## Upgrading

Unpack the new version next to the old one, copy your `.env` (and any change to `config/`), stop the old one and start the new one: migrations run on startup. Read the [changelog]({{repoUrl}}/blob/v{{version}}/CHANGELOG.md) first.

## License

AGPL-3.0-or-later, with the attribution terms at the end of `LICENSE`. If you run a modified version for other people, you must offer them its source code.
