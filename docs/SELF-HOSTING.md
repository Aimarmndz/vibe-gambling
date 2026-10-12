# Self-hosting

Monta tu propia instancia de vibe-gambling (para tu equipo, tu empresa o tu grupo de amigos arruinados) y apunta el plugin a ella. El servidor es el mismo que el oficial; lo único que cambia es la configuración.

> La instancia oficial (`https://vibe.aimar.dev`) se despliega con [DESPLIEGUE.md](DESPLIEGUE.md): detrás de Cloudflare y de un reverse proxy que ya existía. Esta guía es para **una máquina vacía**, sin Cloudflare.

## Qué necesitas

- Una máquina Linux con IP pública, **Docker** y el plugin **Compose v2.24 o posterior** (el compose de Caddy usa `!reset`).
- Un dominio (o subdominio) con un registro `A`/`AAAA` apuntando a esa máquina, y los puertos **80 y 443** abiertos (Caddy pide el certificado a Let's Encrypt él solo).
- Tu propia **OAuth App de GitHub** (la de la instancia oficial solo vale para su dominio).

Nada más: el compose trae Postgres 17, el servidor (que también sirve la web) y un Caddy con HTTPS automático.

## 1. La OAuth App de GitHub

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App** (o en una organización: _Organization settings → Developer settings_).
2. _Homepage URL_ y _Authorization callback URL_: `https://tu.dominio` (el callback es obligatorio en el formulario, pero el Device Flow no lo usa).
3. **Register application** y después marca **Enable Device Flow** y guarda.
4. Copia el **Client ID**. No generes _client secret_: no hace falta.

El servidor pide el login sin scopes (solo perfil público) y descarta el token de GitHub nada más leer el id, el login y el avatar.

## 2. Los archivos

```sh
git clone https://github.com/Aimarmndz/vibe-gambling.git
cd vibe-gambling/deploy
cp .env.example .env
chmod 600 .env
```

Necesitas, en la misma carpeta: `docker-compose.yml`, `docker-compose.caddy.yml`, `Caddyfile`, `.env` y, si quieres copias de seguridad, `backup.sh`.

## 3. El `.env`

Todas las variables están explicadas en [`deploy/.env.example`](../deploy/.env.example) y el servidor las valida al arrancar (si falta o sobra algo, no arranca y dice qué). Para una instancia propia con el Caddy del compose, cambia:

| Variable            | Valor                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`        | `https://tu.dominio` (origen exacto, sin barra final)                                                                                 |
| `SITE_ADDRESS`      | `tu.dominio` (lo usa el `Caddyfile`)                                                                                                  |
| `INSTANCE_NAME`     | El nombre de tu instancia (sale en `/api/meta`, en la web y en `/vibe-server`)                                                        |
| `IS_OFFICIAL`       | `false`                                                                                                                               |
| `GITHUB_CLIENT_ID`  | El Client ID de tu OAuth App                                                                                                          |
| `POSTGRES_PASSWORD` | `openssl rand -hex 32`                                                                                                                |
| `IMAGE_TAG`         | La versión de `ghcr.io/aimarmndz/vibe-gambling` que quieras (p. ej. `0.1.0`)                                                          |
| `REAL_IP_HEADER`    | `X-Real-IP` (el `Caddyfile` la pone con la IP de la conexión, machacando la que mande el cliente)                                     |
| `TRUST_PROXY_CIDRS` | **El mismo valor que `DOCKER_SUBNET`**, escrito literal (p. ej. `172.29.0.0/24`): así solo se cree `X-Real-IP` cuando llega del Caddy |

### Sin Cloudflare: de dónde sale la IP real

El rate limit por IP necesita la IP real del cliente. El servidor **solo** lee `REAL_IP_HEADER` si la conexión llega desde un rango de `TRUST_PROXY_CIDRS`; si no, usa la IP de la conexión. Según cómo lo montes:

| Montaje                                                                      | `REAL_IP_HEADER`   | `TRUST_PROXY_CIDRS`                                                                   |
| ---------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| Caddy del compose (`docker-compose.caddy.yml`), esta guía                    | `X-Real-IP`        | `DOCKER_SUBNET`                                                                       |
| Tu propio proxy en el host que **sobrescribe** `X-Real-IP` con la IP del par | `X-Real-IP`        | `DOCKER_SUBNET` (el proxy entra por el puerto publicado en `127.0.0.1`)               |
| Nada delante (solo en local, `http://localhost:8787`)                        | (cualquiera)       | **vacío**: se usa siempre la IP de la conexión                                        |
| Detrás de Cloudflare                                                         | `CF-Connecting-IP` | Ver [DESPLIEGUE.md](DESPLIEGUE.md): firewall con los rangos de Cloudflare obligatorio |

Nunca pongas en `TRUST_PROXY_CIDRS` un rango desde el que pueda conectar cualquiera: quien llegue desde ahí podría inventarse la IP.

El resto (sesiones, rate limits, WebSocket, cachés) puede quedarse como viene. `EXTRA_ALLOWED_ORIGINS` se queda vacío.

## 4. Arrancar

```sh
docker compose -f docker-compose.yml -f docker-compose.caddy.yml pull
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
docker compose -f docker-compose.yml -f docker-compose.caddy.yml ps
curl -fsS https://tu.dominio/healthz      # {"ok":true}
curl -fsS https://tu.dominio/api/meta     # {"v":1,"protocol":1,"name":"…","isOfficial":false,…}
```

Con el override de Caddy, el servidor **no** publica ningún puerto: solo Caddy escucha en 80/443. Las migraciones de la base de datos se aplican solas al arrancar.

## 5. Apuntar el plugin a tu servidor

Instala el plugin como cualquiera (`/plugin install vibe-gambling --marketplace Aimarmndz/vibe-gambling`) y, en Claude Code:

```text
/vibe-server https://tu.dominio
/vibe-login
```

`/vibe-server` comprueba `GET /api/meta` antes de cambiar nada: si no responde o habla otra versión del protocolo, no cambia de servidor. Responde con algo como `🎰 Now playing at https://tu.dominio — Mi Casino (self-hosted). Log in there with /vibe-login.` La sesión se guarda **por servidor**: volver a la oficial con `/vibe-server default` conserva el login que tuvieras allí. Sin argumento, `/vibe-server` enseña el actual.

También puedes cambiar `serverUrl` en `/config` (opciones del plugin). El plugin solo acepta `https`, salvo `http` hacia esta misma máquina (`localhost`, `127.0.0.1`, `[::1]`): con `http` el token de sesión viajaría en claro.

## Probarlo en local antes

La pila de desarrollo lo trae todo, incluido un **GitHub falso** que autoriza el login solo (no hace falta ninguna OAuth App):

```sh
docker compose -f deploy/docker-compose.dev.yml up -d --build
# Postgres en 127.0.0.1:5436, servidor en http://localhost:8787, GitHub falso en http://localhost:8788
```

En Claude Code: `/vibe-server http://localhost:8787`, `/vibe-login` (el GitHub falso lo aprueba a la segunda consulta) y manda un prompt. Los valores salen de [`deploy/dev.env`](../deploy/dev.env).

## Cambiar el juego o los textos

`config/game.json` (saldo inicial, fichas, préstamo y su TAE, jackpot, temporadas…) y `config/site.json` (repo, enlaces de ayuda, otros proyectos, los datos de tu instancia para `/privacy`) van **dentro de la imagen**. Para usar los tuyos sin construir nada, móntalos encima con un `docker-compose.override.yml` (Compose lo lee solo; con el de Caddy, añádelo como tercer `-f`):

```yaml
services:
  server:
    volumes:
      - ./game.json:/app/config/game.json:ro
      - ./site.json:/app/config/site.json:ro
```

Se validan con zod al arrancar; un valor fuera de rango impide arrancar con un mensaje claro.

> [!IMPORTANT]
> **Licencia.** vibe-gambling es AGPL-3.0-or-later con un término adicional 7(b) ([LICENSE](../LICENSE)): las versiones que pongas a disposición de otros tienen que **seguir mostrando** "Created by Aimar (github.com/Aimarmndz)" en el pie y en la pantalla de arranque. Ese texto sale de `author` en `site.json`: **no lo cambies** (puedes añadir tu propio crédito al lado). Y como es AGPL, si modificas el código y lo sirves a otros por red, tienes que ofrecerles el código fuente de tu versión.

¿Prefieres construir tu propia imagen? `docker build -t vibe-gambling:local .` en la raíz del repo y, en el override, `image: vibe-gambling:local` para el servicio `server`.

## Privacidad de tu instancia

Tú eres el responsable de los datos de tu instancia (logins y avatares de GitHub de tus usuarios, sus partidas y sus sesiones; ver [PRIVACIDAD.md](PRIVACIDAD.md) para el detalle de qué se guarda). La página `/privacy` que sirve la web cuenta lo que hace **tu** instancia, no la oficial: lo que cambia de una a otra sale de la configuración.

En `site.json`, el bloque `instance` (obligatorio: sin él el servidor no arranca):

| Campo                 | Qué es                                                                                  | Instancia oficial                                                             |
| --------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `operator`            | Quién la opera, el responsable de los datos (`name` y `url`)                            | `Aimar`, `https://github.com/Aimarmndz`                                       |
| `hosting`             | Dónde está alojada, en cada idioma (`en`, `es`); se lee tras "hosted on" / "alojada en" | `an IONOS VPS in the European Union` / `una VPS de IONOS en la Unión Europea` |
| `networkProxy`        | El proxy o CDN que hay delante (ve la IP de quien entra), o `null` si no hay ninguno    | `Cloudflare`                                                                  |
| `contact`             | Dónde escribir sobre privacidad (`label` y `url`)                                       | Las issues del repositorio                                                    |
| `backupRetentionDays` | Días que guardas las copias de seguridad, o `null` si no haces copias                   | `14`                                                                          |

`backupRetentionDays` tiene que coincidir con `BACKUP_KEEP_DAYS` del `.env` (lo que de verdad borra [`backup.sh`](../deploy/backup.sh)) y con la retención de las copias que saques fuera de la máquina. Si usas el Caddy propio sin Cloudflare, pon `networkProxy: null`.

El resto lo pone el servidor desde su `.env`, así que no puede desincronizarse: de dónde carga el navegador los avatares (`CSP_IMG_ORIGINS`) cuánto duran las sesiones y el enlace de la ventana (`MOD_SESSION_TTL_SECONDS`, `WEB_SESSION_TTL_SECONDS`, `LINK_CODE_TTL_SECONDS`) y cuánto se queda la IP en memoria para el límite de peticiones (`RATE_LIMIT_IP_WINDOW_MS`). Todas las URLs de `site.json` tienen que ser `http` o `https`.

Si tu instancia es pública y la tratas de otra forma (más proveedores, analíticas, otra retención), publica también tu propia política: la página solo describe lo que hace este código.

## Copias de seguridad y actualizaciones

Lo mismo que en la instancia oficial: [`backup.sh`](../deploy/backup.sh) con cron (ver [DESPLIEGUE.md §12](DESPLIEGUE.md#12-copias-de-seguridad)) y, para actualizar, cambia `IMAGE_TAG` en el `.env` y repite `pull` + `up -d` con los dos `-f`. `backup.sh` usa solo `docker-compose.yml`, que basta para parar y arrancar el servidor y hablar con Postgres.
