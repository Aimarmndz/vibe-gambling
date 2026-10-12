# Protocolo

Contrato entre el **mod** (plugin de Claude Code), el **servidor** y la **ventana** (web). Se define una sola vez en [`packages/shared`](../packages/shared/src/protocol) con zod y se valida en los dos extremos: el servidor valida cada entrada y cada respuesta 200 antes de mandarla; la web valida todo lo que recibe por HTTP y por WebSocket; el mod (que no puede importar `shared`) usa una copia generada de las constantes y un test comprueba que sus cuerpos pasan los esquemas estrictos.

> **Este documento está comprobado automáticamente.** Los bloques entre `<!-- BEGIN GENERATED … -->` y `<!-- END GENERATED … -->` (tablas de campos y JSON Schema) los escribe [`scripts/gen-protocol-docs.ts`](../scripts/gen-protocol-docs.ts) a partir de los esquemas zod, y cada ejemplo marcado con `<!-- example: … -->` se valida contra su esquema. `pnpm docs:protocol` los regenera; `pnpm lint` y `packages/shared/test/protocol-docs.test.ts` fallan si el documento se ha quedado atrás. El resto del texto está escrito a mano. En los JSON Schema, cada `"$ref": "#/$defs/<Nombre>"` es la sección [<Nombre>](#piezas-comunes) de "Piezas comunes", al final.

Diagramas de los flujos en [ARQUITECTURA.md](ARQUITECTURA.md).

## Índice

- [Versión](#versión)
- [Convenciones](#convenciones)
- [Errores](#errores)
- [Límites](#límites)
- [Rutas HTTP](#rutas-http)
- [Idempotencia de los turnos](#idempotencia-de-los-turnos)
- [Tiradas pendientes](#tiradas-pendientes)
- [Espectáculo, bancarrota y logros](#espectáculo-bancarrota-y-logros)
- [Enlace de un solo uso](#enlace-de-un-solo-uso)
- [WebSocket `/ws`](#websocket-ws)
- [Rutas fuera de `/api`](#rutas-fuera-de-api)
- [Piezas comunes](#piezas-comunes)

## Versión

<!-- BEGIN GENERATED version -->

Versión actual del protocolo: **`v: 1`** (`PROTOCOL_VERSION`).

<!-- END GENERATED version -->

- **Todos** los mensajes, en los dos sentidos y en HTTP y WebSocket, llevan `v`. Un mensaje con otra versión no pasa la validación (`400 invalid_request` en HTTP, `error` en WebSocket).
- `GET /api/meta` devuelve `protocol`. El mod lo comprueba antes de cambiar de servidor con `/vibe-server` y se niega si no coincide con el suyo, así que un servidor autoalojado viejo nunca recibe peticiones que no entiende.
- Un cambio incompatible del contrato sube `PROTOCOL_VERSION` en `shared`; los cambios compatibles (un campo opcional nuevo en una petición, un tipo de mensaje nuevo que el cliente ignora) no.

## Convenciones

- **JSON** en los dos sentidos (`Content-Type: application/json`). Los objetos son **estrictos**: un campo de más es un `400`. Esto es también una garantía de privacidad: `turn/start` y `turn/end` rechazan cualquier campo que no sea de la lista.
- **Tamaño máximo** del cuerpo: `BODY_LIMIT_BYTES` (16 KiB en los `.env` de ejemplo). Más grande: `413 payload_too_large`.
- **Autenticación** (columna _Auth_ de la tabla de rutas):
  - `public`: sin sesión.
  - `mod`: `Authorization: Bearer <token>` de una sesión creada por el Device Flow. Una cookie de la web en una ruta `mod` recibe `403 forbidden`.
  - `web`: la cookie de sesión (`SESSION_COOKIE_NAME`, `HttpOnly; Secure; SameSite=Strict`) que crea `POST /api/auth/redeem`.
  - `any`: cualquiera de las dos. Una sesión web enviada como Bearer (o una del mod como cookie) recibe `403`.
  - Sin credencial, con un token desconocido, caducado o revocado: `401 unauthorized`.
- **Tokens**: 256 bits aleatorios en base64url (43 caracteres). El servidor solo guarda su SHA-256.
- **CSRF**: además de `SameSite=Strict`, las mutaciones autenticadas con cookie y `POST /api/auth/redeem` rechazan un `Origin` que no sea `PUBLIC_URL` (o uno de `EXTRA_ALLOWED_ORIGINS`, solo para el Vite de desarrollo). Los clientes que no mandan `Origin` (el mod, `curl`) no se ven afectados.
- **Rate limit** de `/api/*`: dos cupos independientes, por IP real (`RATE_LIMIT_IP_*`; las IPv6 cuentan por prefijo `/RATE_LIMIT_IPV6_PREFIX`) y por token (`RATE_LIMIT_TOKEN_*`). Al pasarse: `429 rate_limited` con cabecera `Retry-After` (segundos). La IP real sale de `REAL_IP_HEADER` (`CF-Connecting-IP` detrás de Cloudflare) **solo** si la conexión llega desde `TRUST_PROXY_CIDRS`; si no, es la IP de la conexión.
- **Caché**: todas las respuestas de `/api/*` llevan `Cache-Control: no-store`.
- **Alias REST**: además de las rutas canónicas de la tabla, el servidor acepta `PATCH /api/me/settings` (igual que `POST /api/me/settings`) y `DELETE /api/me` (igual que `POST /api/me/delete`), con los mismos cuerpos.
- **Fechas** en ISO 8601 UTC (`2026-10-12T19:30:00.000Z`). **Monedas** como enteros (pueden ser negativos en `netWorth`; la deuda tiene un tope, `loan.maxDebt`, para no salir de `Number.MAX_SAFE_INTEGER`).

## Errores

Toda respuesta que no es 2xx tiene el cuerpo [`ErrorResponse`](#errorresponse): `{ v, error, message }`. `error` es un código estable (para programar contra él) y `message` un texto en inglés para personas (nunca lleva datos personales).

<!-- example: errorResponseSchema -->

```json
{ "v": 1, "error": "insufficient_funds", "message": "Not enough coins for that bet." }
```

<!-- BEGIN GENERATED errors -->

| `error`              | Estado HTTP |
| -------------------- | ----------- |
| `invalid_request`    | 400         |
| `unauthorized`       | 401         |
| `forbidden`          | 403         |
| `not_found`          | 404         |
| `conflict`           | 409         |
| `rate_limited`       | 429         |
| `payload_too_large`  | 413         |
| `insufficient_funds` | 422         |
| `too_many_bets`      | 422         |
| `invalid_bet`        | 422         |
| `loan_not_allowed`   | 422         |
| `protocol_mismatch`  | 400         |
| `github_unavailable` | 502         |
| `internal`           | 500         |

<!-- END GENERATED errors -->

Comunes a todas las rutas: `400 invalid_request` (JSON roto, campo de más o fuera de rango), `400 protocol_mismatch` (el cuerpo trae otra `v`: el cliente habla otra versión del protocolo; por WebSocket llega como mensaje `error` con ese código), `413 payload_too_large`, `429 rate_limited` y `500 internal`. Las de rutas con sesión: `401 unauthorized` y `403 forbidden`. Cada ruta de abajo lista solo los errores **propios**.

## Límites

<!-- BEGIN GENERATED limits -->

| Constante                     | Valor          |
| ----------------------------- | -------------- |
| `TEXT_LIMITS.login`           | 39 caracteres  |
| `TEXT_LIMITS.serverName`      | 80 caracteres  |
| `TEXT_LIMITS.userCode`        | 20 caracteres  |
| `TEXT_LIMITS.errorMessage`    | 500 caracteres |
| `WS_CLIENT_MESSAGE_MAX_BYTES` | 4096 bytes     |

<!-- END GENERATED limits -->

Los límites configurables (tamaño del cuerpo, rate limits, conexiones por usuario, mensajes por ventana) están en [`deploy/.env.example`](../deploy/.env.example).

## Rutas HTTP

<!-- BEGIN GENERATED routes -->

| Nombre                            | Método | Ruta                     | Auth     |
| --------------------------------- | ------ | ------------------------ | -------- |
| [`meta`](#meta)                   | GET    | `/api/meta`              | `public` |
| [`deviceStart`](#devicestart)     | POST   | `/api/auth/device/start` | `public` |
| [`devicePoll`](#devicepoll)       | POST   | `/api/auth/device/poll`  | `public` |
| [`link`](#link)                   | POST   | `/api/auth/link`         | `mod`    |
| [`redeem`](#redeem)               | POST   | `/api/auth/redeem`       | `public` |
| [`logout`](#logout)               | POST   | `/api/auth/logout`       | `any`    |
| [`turnStart`](#turnstart)         | POST   | `/api/turn/start`        | `mod`    |
| [`turnEnd`](#turnend)             | POST   | `/api/turn/end`          | `mod`    |
| [`bet`](#bet)                     | POST   | `/api/bet`               | `mod`    |
| [`me`](#me)                       | GET    | `/api/me`                | `any`    |
| [`settings`](#settings)           | POST   | `/api/me/settings`       | `any`    |
| [`deleteAccount`](#deleteaccount) | POST   | `/api/me/delete`         | `any`    |
| [`leaderboard`](#leaderboard)     | GET    | `/api/leaderboard`       | `public` |
| [`hallOfRuin`](#hallofruin)       | GET    | `/api/hall-of-ruin`      | `public` |

<!-- END GENERATED routes -->

### meta

Identifica la instancia. El mod lo usa con `/vibe-server` para comprobar que el servidor habla su versión del protocolo y para saber si es la oficial.

<!-- example: metaResponseSchema -->

```json
{
  "v": 1,
  "protocol": 1,
  "name": "vibe-gambling",
  "isOfficial": true,
  "serverVersion": "0.1.0",
  "publicUrl": "https://vibe.aimar.dev"
}
```

<!-- BEGIN GENERATED route:meta -->

`GET /api/meta` · autenticación: pública (sin sesión)

**Respuesta 200** (`metaResponseSchema`)

| Campo           | Tipo                        | Obligatorio |
| --------------- | --------------------------- | ----------- |
| `v`             | `1`                         | sí          |
| `protocol`      | `1`                         | sí          |
| `name`          | `string` (1–80 car.)        | sí          |
| `isOfficial`    | `boolean`                   | sí          |
| `serverVersion` | `string` (0–40 car.)        | sí          |
| `publicUrl`     | `string` (`/^https?:\/\//`) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "protocol": { "type": "number", "const": 1 },
    "name": { "type": "string", "minLength": 1, "maxLength": 80 },
    "isOfficial": { "type": "boolean" },
    "serverVersion": { "type": "string", "maxLength": 40 },
    "publicUrl": { "type": "string", "pattern": "^https?:\\/\\/" }
  },
  "required": ["v", "protocol", "name", "isOfficial", "serverVersion", "publicUrl"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED route:meta -->

### deviceStart

Empieza el login con GitHub (Device Flow) **a través del servidor**: el servidor pide el código a GitHub con el `client_id` de su OAuth App (sin scopes: solo el perfil público), guarda el `device_code` y devuelve al mod un `pollId` opaco. El `device_code` de GitHub nunca sale del servidor. El mod enseña `userCode` y `verificationUri` al usuario.

Errores propios: `502 github_unavailable` (GitHub no responde, o la OAuth App no tiene el Device Flow activado).

<!-- example: deviceStartRequestSchema -->

```json
{ "v": 1 }
```

<!-- example: deviceStartResponseSchema -->

```json
{
  "v": 1,
  "pollId": "am94q7Bp0HHncitBaGnEtnDV7Xn_rEqP37p1yGY6JwM",
  "userCode": "WDJB-MJHT",
  "verificationUri": "https://github.com/login/device",
  "expiresIn": 899,
  "interval": 5
}
```

<!-- BEGIN GENERATED route:deviceStart -->

`POST /api/auth/device/start` · autenticación: pública (sin sesión)

**Cuerpo de la petición (JSON)** (`deviceStartRequestSchema`)

| Campo | Tipo | Obligatorio |
| ----- | ---- | ----------- |
| `v`   | `1`  | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": { "v": { "type": "number", "const": 1 } },
  "required": ["v"],
  "additionalProperties": false
}
```

</details>

**Respuesta 200** (`deviceStartResponseSchema`)

| Campo             | Tipo                               | Obligatorio |
| ----------------- | ---------------------------------- | ----------- |
| `v`               | `1`                                | sí          |
| `pollId`          | `string` (`/^[A-Za-z0-9_-]{43}$/`) | sí          |
| `userCode`        | `string` (4–20 car.)               | sí          |
| `verificationUri` | `string` (`/^https?:\/\//`)        | sí          |
| `expiresIn`       | `integer` > 0                      | sí          |
| `interval`        | `integer` > 0                      | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "pollId": { "type": "string", "pattern": "^[A-Za-z0-9_-]{43}$" },
    "userCode": { "type": "string", "minLength": 4, "maxLength": 20 },
    "verificationUri": { "type": "string", "pattern": "^https?:\\/\\/" },
    "expiresIn": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
    "interval": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 }
  },
  "required": ["v", "pollId", "userCode", "verificationUri", "expiresIn", "interval"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED route:deviceStart -->

### devicePoll

El mod consulta cada `interval` segundos hasta recibir algo distinto de `pending`/`slow_down`. El servidor solo pregunta a GitHub si ha pasado el intervalo desde la consulta anterior (con un margen de `DEVICE_POLL_LEEWAY_MS`); si el mod llega antes, o llegan dos consultas a la vez, responde `pending` sin tocar GitHub, así que GitHub nunca penaliza al servidor. Con `slow_down`, el intervalo nuevo viene en la respuesta.

Con `ok`, el servidor ya ha pedido el perfil a GitHub (`GET /user`), ha creado o actualizado el usuario (id, login y avatar) y **ha olvidado el token de GitHub**. `token` es la sesión del mod (`MOD_SESSION_TTL_SECONDS`), que el mod guarda en `$.store`. `isNew` es `true` la primera vez: el mod avisa de que sales en el ranking público y de cómo ocultarte.

`expired` (el código caducó o no existe) y `denied` (el usuario canceló en GitHub) son finales: el mod deja de consultar.

Errores propios: `502 github_unavailable` (GitHub no responde o la OAuth App está mal configurada).

<!-- example: devicePollRequestSchema -->

```json
{ "v": 1, "pollId": "am94q7Bp0HHncitBaGnEtnDV7Xn_rEqP37p1yGY6JwM" }
```

<!-- example: devicePollResponseSchema -->

```json
{ "v": 1, "status": "pending", "interval": 5 }
```

<!-- example: devicePollResponseSchema -->

```json
{
  "v": 1,
  "status": "ok",
  "token": "crV3b3vf6xWJIR5Tmek_aEaimhOxbsdcnSRmIkriyUQ",
  "user": {
    "login": "octo-gambler",
    "avatarUrl": "https://avatars.githubusercontent.com/u/424242?v=4",
    "profileUrl": "https://github.com/octo-gambler",
    "hidden": false,
    "locale": null,
    "createdAt": "2026-10-12T19:28:41.512Z"
  },
  "isNew": true
}
```

<!-- BEGIN GENERATED route:devicePoll -->

`POST /api/auth/device/poll` · autenticación: pública (sin sesión)

**Cuerpo de la petición (JSON)** (`devicePollRequestSchema`)

| Campo    | Tipo                               | Obligatorio |
| -------- | ---------------------------------- | ----------- |
| `v`      | `1`                                | sí          |
| `pollId` | `string` (`/^[A-Za-z0-9_-]{43}$/`) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "pollId": { "type": "string", "pattern": "^[A-Za-z0-9_-]{43}$" }
  },
  "required": ["v", "pollId"],
  "additionalProperties": false
}
```

</details>

**Respuesta 200** (`devicePollResponseSchema`)

Una de estas variantes:

- `status: "pending"`

  | Campo      | Tipo          | Obligatorio |
  | ---------- | ------------- | ----------- |
  | `v`        | `1`           | sí          |
  | `status`   | `"pending"`   | sí          |
  | `interval` | `integer` > 0 | sí          |

- `status: "slow_down"`

  | Campo      | Tipo          | Obligatorio |
  | ---------- | ------------- | ----------- |
  | `v`        | `1`           | sí          |
  | `status`   | `"slow_down"` | sí          |
  | `interval` | `integer` > 0 | sí          |

- `status: "expired"`

  | Campo    | Tipo        | Obligatorio |
  | -------- | ----------- | ----------- |
  | `v`      | `1`         | sí          |
  | `status` | `"expired"` | sí          |

- `status: "denied"`

  | Campo    | Tipo       | Obligatorio |
  | -------- | ---------- | ----------- |
  | `v`      | `1`        | sí          |
  | `status` | `"denied"` | sí          |

- `status: "ok"`

  | Campo    | Tipo                               | Obligatorio |
  | -------- | ---------------------------------- | ----------- |
  | `v`      | `1`                                | sí          |
  | `status` | `"ok"`                             | sí          |
  | `token`  | `string` (`/^[A-Za-z0-9_-]{43}$/`) | sí          |
  | `user`   | [SelfUser](#selfuser)              | sí          |
  | `isNew`  | `boolean`                          | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "v": { "type": "number", "const": 1 },
        "status": { "type": "string", "const": "pending" },
        "interval": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 }
      },
      "required": ["v", "status", "interval"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "v": { "type": "number", "const": 1 },
        "status": { "type": "string", "const": "slow_down" },
        "interval": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 }
      },
      "required": ["v", "status", "interval"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "v": { "type": "number", "const": 1 },
        "status": { "type": "string", "const": "expired" }
      },
      "required": ["v", "status"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "v": { "type": "number", "const": 1 },
        "status": { "type": "string", "const": "denied" }
      },
      "required": ["v", "status"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "v": { "type": "number", "const": 1 },
        "status": { "type": "string", "const": "ok" },
        "token": { "type": "string", "pattern": "^[A-Za-z0-9_-]{43}$" },
        "user": { "$ref": "#/$defs/SelfUser" },
        "isNew": { "type": "boolean" }
      },
      "required": ["v", "status", "token", "user", "isNew"],
      "additionalProperties": false
    }
  ]
}
```

</details>

<!-- END GENERATED route:devicePoll -->

### link

Crea un [enlace de un solo uso](#enlace-de-un-solo-uso) para abrir la ventana ya con sesión. Solo el mod puede pedirlo. `url` es `PUBLIC_URL/play?code=<código>` y caduca en `expiresIn` segundos (`LINK_CODE_TTL_SECONDS`, 60 en los ejemplos).

<!-- example: linkRequestSchema -->

```json
{ "v": 1 }
```

<!-- example: linkResponseSchema -->

```json
{
  "v": 1,
  "url": "https://vibe.aimar.dev/play?code=GhIiPoPaEYqYVRpfYegLTCTRrTWZPZSBM7nBHN_bMIw",
  "expiresIn": 60
}
```

<!-- BEGIN GENERATED route:link -->

`POST /api/auth/link` · autenticación: `Authorization: Bearer <token>` de una sesión **del mod**

**Cuerpo de la petición (JSON)** (`linkRequestSchema`)

| Campo | Tipo | Obligatorio |
| ----- | ---- | ----------- |
| `v`   | `1`  | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": { "v": { "type": "number", "const": 1 } },
  "required": ["v"],
  "additionalProperties": false
}
```

</details>

**Respuesta 200** (`linkResponseSchema`)

| Campo       | Tipo                        | Obligatorio |
| ----------- | --------------------------- | ----------- |
| `v`         | `1`                         | sí          |
| `url`       | `string` (`/^https?:\/\//`) | sí          |
| `expiresIn` | `integer` > 0               | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "url": { "type": "string", "pattern": "^https?:\\/\\/" },
    "expiresIn": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 }
  },
  "required": ["v", "url", "expiresIn"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED route:link -->

### redeem

La web canjea el código de `/play?code=…` por la cookie de sesión de la web (`Set-Cookie`, `WEB_SESSION_TTL_SECONDS`). Pública: el código es la credencial.

Errores propios: `401 unauthorized` si el código caducó, ya se usó o no existe; `403 forbidden` si el `Origin` es ajeno.

<!-- example: redeemRequestSchema -->

```json
{ "v": 1, "code": "GhIiPoPaEYqYVRpfYegLTCTRrTWZPZSBM7nBHN_bMIw" }
```

<!-- BEGIN GENERATED route:redeem -->

`POST /api/auth/redeem` · autenticación: pública (sin sesión)

**Cuerpo de la petición (JSON)** (`redeemRequestSchema`)

| Campo  | Tipo                               | Obligatorio |
| ------ | ---------------------------------- | ----------- |
| `v`    | `1`                                | sí          |
| `code` | `string` (`/^[A-Za-z0-9_-]{43}$/`) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "code": { "type": "string", "pattern": "^[A-Za-z0-9_-]{43}$" }
  },
  "required": ["v", "code"],
  "additionalProperties": false
}
```

</details>

**Respuesta 200** (`redeemResponseSchema`)

| Campo  | Tipo                  | Obligatorio |
| ------ | --------------------- | ----------- |
| `v`    | `1`                   | sí          |
| `user` | [SelfUser](#selfuser) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": { "v": { "type": "number", "const": 1 }, "user": { "$ref": "#/$defs/SelfUser" } },
  "required": ["v", "user"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED route:redeem -->

### logout

Revoca **solo** la sesión con la que se llama (y cierra los WebSockets de esa sesión con `bye`/`4410`). Cerrar sesión en el mod no te echa de la ventana ni al revés. Con cookie, además la borra.

<!-- example: logoutRequestSchema -->

```json
{ "v": 1 }
```

<!-- example: okResponseSchema -->

```json
{ "v": 1, "ok": true }
```

<!-- BEGIN GENERATED route:logout -->

`POST /api/auth/logout` · autenticación: Bearer del mod **o** cookie de la web

**Cuerpo de la petición (JSON)** (`logoutRequestSchema`)

| Campo | Tipo | Obligatorio |
| ----- | ---- | ----------- |
| `v`   | `1`  | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": { "v": { "type": "number", "const": 1 } },
  "required": ["v"],
  "additionalProperties": false
}
```

</details>

**Respuesta 200** (`okResponseSchema`)

| Campo | Tipo   | Obligatorio |
| ----- | ------ | ----------- |
| `v`   | `1`    | sí          |
| `ok`  | `true` | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "ok": { "type": "boolean", "const": true }
  },
  "required": ["v", "ok"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED route:logout -->

### turnStart

El mod la llama al empezar cada turno de Claude Code (evento `turn.start`, solo el bucle principal). Abre una ronda, o **reutiliza** la que ya estuviera abierta (dos sesiones de Claude Code a la vez: una sola ronda activa por usuario), y avisa a las ventanas con `round.started`. `windowConnected` dice si el usuario tiene alguna ventana conectada: si es `false` y la opción `autoOpen` está activa, el mod pide un enlace y abre la ventana.

Es **todo** lo que el mod cuenta al empezar: un `turnId` aleatorio, la versión del plugin y el SO genérico. Ver [idempotencia](#idempotencia-de-los-turnos).

Errores propios: `409 conflict` si la temporada acaba de cerrarse en ese instante (se reintenta en el siguiente turno).

```http
POST /api/turn/start HTTP/1.1
Authorization: Bearer crV3b3vf6xWJIR5Tmek_aEaimhOxbsdcnSRmIkriyUQ
Content-Type: application/json
```

<!-- example: turnStartRequestSchema -->

```json
{
  "v": 1,
  "turnId": "c4773398-e4f3-43a4-a681-9a6ea3bbb0bd",
  "pluginVersion": "0.1.0",
  "os": "linux"
}
```

<!-- example: turnStartResponseSchema -->

```json
{
  "v": 1,
  "round": {
    "roundId": "05fa4f39-ebea-4150-809f-ca9fed9686ad",
    "openedAt": "2026-10-12T19:30:00.000Z"
  },
  "reused": false,
  "windowConnected": true
}
```

<!-- BEGIN GENERATED route:turnStart -->

`POST /api/turn/start` · autenticación: `Authorization: Bearer <token>` de una sesión **del mod**

**Cuerpo de la petición (JSON)** (`turnStartRequestSchema`)

| Campo           | Tipo                                                                 | Obligatorio |
| --------------- | -------------------------------------------------------------------- | ----------- |
| `v`             | `1`                                                                  | sí          |
| `turnId`        | `string` (`/^[A-Za-z0-9_-]{8,64}$/`)                                 | sí          |
| `pluginVersion` | `string` (`/^\d{1,4}\.\d{1,4}\.\d{1,4}([-+][0-9A-Za-z.-]{1,32})?$/`) | sí          |
| `os`            | `"linux"` \| `"darwin"` \| `"win32"` \| `"other"`                    | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "turnId": { "type": "string", "pattern": "^[A-Za-z0-9_-]{8,64}$" },
    "pluginVersion": {
      "type": "string",
      "pattern": "^\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}([-+][0-9A-Za-z.-]{1,32})?$"
    },
    "os": { "type": "string", "enum": ["linux", "darwin", "win32", "other"] }
  },
  "required": ["v", "turnId", "pluginVersion", "os"],
  "additionalProperties": false
}
```

</details>

**Respuesta 200** (`turnStartResponseSchema`)

| Campo             | Tipo                    | Obligatorio |
| ----------------- | ----------------------- | ----------- |
| `v`               | `1`                     | sí          |
| `round`           | [OpenRound](#openround) | sí          |
| `reused`          | `boolean`               | sí          |
| `windowConnected` | `boolean`               | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "round": { "$ref": "#/$defs/OpenRound" },
    "reused": { "type": "boolean" },
    "windowConnected": { "type": "boolean" }
  },
  "required": ["v", "round", "reused", "windowConnected"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED route:turnStart -->

### turnEnd

El mod la llama al terminar el turno (`turn.complete` sin `agentId`). El servidor tira la ruleta (`crypto.randomInt(0, 37)`), resuelve las apuestas del boleto (o repite la última apuesta, o la apuesta por defecto), cobra el interés de la deuda, aplica el jackpot si `gitPushOk` y avisa a las ventanas con `round.resolved`. `revealAt` es el instante a partir del cual se puede enseñar el resultado (giro mínimo `spin.minSpinMs`): la web y el toast del mod esperan hasta entonces.

- `resolved`: la tirada de este turno.
- `no_round`: ya no había ronda que resolver para este turno (caducó tras `round.staleAfterMs`, o la resolvió otra sesión de Claude Code que la compartía).
- `queued`: el usuario no tenía **ninguna ventana visible** (ninguna conectada, o todas ocultas según su último `presence`): la ronda no se tira, se guarda como [tirada pendiente](#tiradas-pendientes) con el `gitPushOk` y el `testFailed` de este turno, y el contador sube en `wallet.pendingSpins`. Con `dropped: true`, ya estaba en el tope (`pendingSpins.max`) y este prompt se ha descartado. Las ventanas (ocultas) reciben `pending`, que también cierra la ronda que vieran girar.
- Si nunca llegó el `turn/start` (red, timeout), el servidor abre y resuelve la ronda en el acto: cada prompt sigue siendo una tirada.

Lo único que cuenta el mod: `turnId`, `durationMs`, dos booleanos calculados en local (`gitPushOk`: hubo un `git push` con éxito; `testFailed`: falló un comando de tests), la versión del plugin y el SO genérico.

Errores propios: `409 conflict` (cambio de temporada justo en ese instante).

<!-- example: turnEndRequestSchema -->

```json
{
  "v": 1,
  "turnId": "c4773398-e4f3-43a4-a681-9a6ea3bbb0bd",
  "durationMs": 2100,
  "gitPushOk": false,
  "testFailed": false,
  "pluginVersion": "0.1.0",
  "os": "linux"
}
```

<!-- example: turnEndResponseSchema -->

```json
{
  "v": 1,
  "status": "resolved",
  "round": {
    "roundId": "05fa4f39-ebea-4150-809f-ca9fed9686ad",
    "openedAt": "2026-10-12T19:30:00.000Z",
    "resolvedAt": "2026-10-12T19:30:02.100Z",
    "result": 17,
    "color": "black",
    "bets": [
      {
        "selection": {
          "kind": "red"
        },
        "amount": 200,
        "won": false,
        "payout": 0
      }
    ],
    "source": "slip",
    "staked": 200,
    "returned": 0,
    "net": -200,
    "jackpot": false,
    "gitPushOk": false,
    "testFailed": false,
    "interestCharged": 0,
    "colorStreak": {
      "color": "black",
      "count": 1
    },
    "revealAt": "2026-10-12T19:30:04.000Z",
    "spectacle": {
      "tier": "none",
      "netMultiple": 0,
      "bigWin": false,
      "green": false,
      "greenWin": false,
      "jackpot": false,
      "streak": -1,
      "fire": "none",
      "fallacy": false,
      "bankrupt": false
    }
  },
  "wallet": {
    "seasonId": "2026-10",
    "balance": 800,
    "debt": 0,
    "netWorth": 800,
    "spins": 1,
    "loans": 0,
    "currentStreak": -1,
    "bestStreak": 0,
    "pendingSpins": 0
  }
}
```

Con la ventana cerrada u oculta:

<!-- example: turnEndResponseSchema -->

```json
{
  "v": 1,
  "status": "queued",
  "dropped": false,
  "wallet": {
    "seasonId": "2026-10",
    "balance": 800,
    "debt": 0,
    "netWorth": 800,
    "spins": 1,
    "loans": 0,
    "currentStreak": -1,
    "bestStreak": 0,
    "pendingSpins": 20
  }
}
```

<!-- BEGIN GENERATED route:turnEnd -->

`POST /api/turn/end` · autenticación: `Authorization: Bearer <token>` de una sesión **del mod**

**Cuerpo de la petición (JSON)** (`turnEndRequestSchema`)

| Campo           | Tipo                                                                 | Obligatorio |
| --------------- | -------------------------------------------------------------------- | ----------- |
| `v`             | `1`                                                                  | sí          |
| `turnId`        | `string` (`/^[A-Za-z0-9_-]{8,64}$/`)                                 | sí          |
| `durationMs`    | `integer` 0–86400000                                                 | sí          |
| `gitPushOk`     | `boolean`                                                            | sí          |
| `testFailed`    | `boolean`                                                            | sí          |
| `pluginVersion` | `string` (`/^\d{1,4}\.\d{1,4}\.\d{1,4}([-+][0-9A-Za-z.-]{1,32})?$/`) | sí          |
| `os`            | `"linux"` \| `"darwin"` \| `"win32"` \| `"other"`                    | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "turnId": { "type": "string", "pattern": "^[A-Za-z0-9_-]{8,64}$" },
    "durationMs": { "type": "integer", "minimum": 0, "maximum": 86400000 },
    "gitPushOk": { "type": "boolean" },
    "testFailed": { "type": "boolean" },
    "pluginVersion": {
      "type": "string",
      "pattern": "^\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}([-+][0-9A-Za-z.-]{1,32})?$"
    },
    "os": { "type": "string", "enum": ["linux", "darwin", "win32", "other"] }
  },
  "required": ["v", "turnId", "durationMs", "gitPushOk", "testFailed", "pluginVersion", "os"],
  "additionalProperties": false
}
```

</details>

**Respuesta 200** (`turnEndResponseSchema`)

Una de estas variantes:

- `status: "resolved"`

  | Campo    | Tipo                            | Obligatorio |
  | -------- | ------------------------------- | ----------- |
  | `v`      | `1`                             | sí          |
  | `status` | `"resolved"`                    | sí          |
  | `round`  | [ResolvedRound](#resolvedround) | sí          |
  | `wallet` | [Wallet](#wallet)               | sí          |

- `status: "no_round"`

  | Campo    | Tipo              | Obligatorio |
  | -------- | ----------------- | ----------- |
  | `v`      | `1`               | sí          |
  | `status` | `"no_round"`      | sí          |
  | `wallet` | [Wallet](#wallet) | sí          |

- `status: "queued"`

  | Campo     | Tipo              | Obligatorio |
  | --------- | ----------------- | ----------- |
  | `v`       | `1`               | sí          |
  | `status`  | `"queued"`        | sí          |
  | `dropped` | `boolean`         | sí          |
  | `wallet`  | [Wallet](#wallet) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "v": { "type": "number", "const": 1 },
        "status": { "type": "string", "const": "resolved" },
        "round": { "$ref": "#/$defs/ResolvedRound" },
        "wallet": { "$ref": "#/$defs/Wallet" }
      },
      "required": ["v", "status", "round", "wallet"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "v": { "type": "number", "const": 1 },
        "status": { "type": "string", "const": "no_round" },
        "wallet": { "$ref": "#/$defs/Wallet" }
      },
      "required": ["v", "status", "wallet"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "v": { "type": "number", "const": 1 },
        "status": { "type": "string", "const": "queued" },
        "dropped": { "type": "boolean" },
        "wallet": { "$ref": "#/$defs/Wallet" }
      },
      "required": ["v", "status", "dropped", "wallet"],
      "additionalProperties": false
    }
  ]
}
```

</details>

<!-- END GENERATED route:turnEnd -->

### bet

`/bet <cantidad> <casilla>` (y `/apostar`, `/all-in`) desde Claude Code. La casilla llega **como texto** y la interpreta el servidor con `parseBetTarget` de `shared` (un único parser): `red`/`rojo`, `black`/`negro`, `even`/`par`, `odd`/`impar`, `low`/`falta`/`1-18`, `high`/`pasa`/`19-36`, `1st12`/`1a12`/`dozen1`/`docena1`…, `col1`/`column1`/`columna1`…, un número (`17`) o una combinación de números válida en el tapete (`8-9`, `1-2-3`, `8-9-11-12`, `1-2-3-4-5-6`). `amount` es un entero ≥ ficha mínima o `"all-in"` (todo el saldo disponible). Las fichas se descuentan del saldo al instante y entran en el boleto (`forRound: "current"` si hay una ronda abierta, `"next"` si no). Las ventanas reciben `slip`.

Errores propios (`422`): `invalid_bet` (casilla que no existe, cantidad bajo la mínima, all-in desactivado), `insufficient_funds`, `too_many_bets` (más de `maxBetsPerRound` casillas distintas); `409 conflict` (cambio de temporada).

<!-- example: betRequestSchema -->

```json
{ "v": 1, "amount": 200, "target": "red" }
```

<!-- example: betRequestSchema -->

```json
{ "v": 1, "amount": "all-in", "target": "0" }
```

<!-- example: betResponseSchema -->

```json
{
  "v": 1,
  "slip": {
    "bets": [
      {
        "selection": {
          "kind": "red"
        },
        "amount": 200
      }
    ],
    "total": 200
  },
  "wallet": {
    "seasonId": "2026-10",
    "balance": 800,
    "debt": 0,
    "netWorth": 800,
    "spins": 0,
    "loans": 0,
    "currentStreak": 0,
    "bestStreak": 0,
    "pendingSpins": 0
  },
  "forRound": "next"
}
```

<!-- BEGIN GENERATED route:bet -->

`POST /api/bet` · autenticación: `Authorization: Bearer <token>` de una sesión **del mod**

**Cuerpo de la petición (JSON)** (`betRequestSchema`)

| Campo    | Tipo                    | Obligatorio |
| -------- | ----------------------- | ----------- |
| `v`      | `1`                     | sí          |
| `amount` | [BetAmount](#betamount) | sí          |
| `target` | `string` (1–32 car.)    | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "amount": { "$ref": "#/$defs/BetAmount" },
    "target": { "type": "string", "minLength": 1, "maxLength": 32 }
  },
  "required": ["v", "amount", "target"],
  "additionalProperties": false
}
```

</details>

**Respuesta 200** (`betResponseSchema`)

| Campo      | Tipo                    | Obligatorio |
| ---------- | ----------------------- | ----------- |
| `v`        | `1`                     | sí          |
| `slip`     | [Slip](#slip)           | sí          |
| `wallet`   | [Wallet](#wallet)       | sí          |
| `forRound` | `"current"` \| `"next"` | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "slip": { "$ref": "#/$defs/Slip" },
    "wallet": { "$ref": "#/$defs/Wallet" },
    "forRound": { "type": "string", "enum": ["current", "next"] }
  },
  "required": ["v", "slip", "wallet", "forRound"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED route:bet -->

### me

Estado del usuario: perfil, cartera de la temporada en curso (si aún no ha jugado, una cartera "virtual" con el saldo inicial), boleto, ronda abierta, puesto en el ranking de arruinados (`null` si está oculto o aún no ha tirado) y el catálogo de logros con lo conseguido. Lo usa `/balance`.

<!-- BEGIN GENERATED route:me -->

`GET /api/me` · autenticación: Bearer del mod **o** cookie de la web

**Respuesta 200** (`meResponseSchema`)

| Campo          | Tipo                              | Obligatorio |
| -------------- | --------------------------------- | ----------- |
| `v`            | `1`                               | sí          |
| `user`         | [SelfUser](#selfuser)             | sí          |
| `wallet`       | [Wallet](#wallet)                 | sí          |
| `slip`         | [Slip](#slip)                     | sí          |
| `round`        | [OpenRound](#openround) \| `null` | sí          |
| `brokeRank`    | `integer` > 0 \| `null`           | sí          |
| `achievements` | [Achievement](#achievement)[]     | no          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "user": { "$ref": "#/$defs/SelfUser" },
    "wallet": { "$ref": "#/$defs/Wallet" },
    "slip": { "$ref": "#/$defs/Slip" },
    "round": { "anyOf": [{ "$ref": "#/$defs/OpenRound" }, { "type": "null" }] },
    "brokeRank": {
      "anyOf": [
        { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
        { "type": "null" }
      ]
    },
    "achievements": { "type": "array", "items": { "$ref": "#/$defs/Achievement" } }
  },
  "required": ["v", "user", "wallet", "slip", "round", "brokeRank"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED route:me -->

### settings

Cambia los ajustes: `hidden` (ocultarse del ranking y del Salón de la Ruina; `/vibe-hide` y `/vibe-show`) y `locale` (`null` = idioma del navegador). Hay que mandar al menos uno: si no, `400 invalid_request`. Las ventanas reciben `settings`.

<!-- example: settingsRequestSchema -->

```json
{ "v": 1, "hidden": true }
```

<!-- BEGIN GENERATED route:settings -->

`POST /api/me/settings` · autenticación: Bearer del mod **o** cookie de la web

**Cuerpo de la petición (JSON)** (`settingsRequestSchema`)

| Campo    | Tipo                                           | Obligatorio |
| -------- | ---------------------------------------------- | ----------- |
| `v`      | `1`                                            | sí          |
| `hidden` | `boolean`                                      | no          |
| `locale` | `"en"` \| `"es"` \| `"fr"` \| `"de"` \| `null` | no          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "hidden": { "type": "boolean" },
    "locale": {
      "anyOf": [{ "type": "string", "enum": ["en", "es", "fr", "de"] }, { "type": "null" }]
    }
  },
  "required": ["v"],
  "additionalProperties": false
}
```

</details>

**Respuesta 200** (`settingsResponseSchema`)

| Campo  | Tipo                  | Obligatorio |
| ------ | --------------------- | ----------- |
| `v`    | `1`                   | sí          |
| `user` | [SelfUser](#selfuser) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": { "v": { "type": "number", "const": 1 }, "user": { "$ref": "#/$defs/SelfUser" } },
  "required": ["v", "user"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED route:settings -->

### deleteAccount

Borra la cuenta y **todo** lo que cuelga de ella, en cascada: sesiones, enlaces, carteras, rondas, apuestas, turnos, préstamos y filas del Salón de la Ruina. Como confirmación hay que repetir el login de GitHub (sin distinguir mayúsculas); `/vibe-delete-account <login>` lo hace desde Claude Code. Cierra todas las ventanas con `bye` (`account_deleted`) y borra la cookie.

Errores propios: `400 invalid_request` si `confirm` no es tu login.

<!-- example: deleteAccountRequestSchema -->

```json
{ "v": 1, "confirm": "octo-gambler" }
```

<!-- BEGIN GENERATED route:deleteAccount -->

`POST /api/me/delete` · autenticación: Bearer del mod **o** cookie de la web

**Cuerpo de la petición (JSON)** (`deleteAccountRequestSchema`)

| Campo     | Tipo                 | Obligatorio |
| --------- | -------------------- | ----------- |
| `v`       | `1`                  | sí          |
| `confirm` | `string` (1–39 car.) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "confirm": { "type": "string", "minLength": 1, "maxLength": 39 }
  },
  "required": ["v", "confirm"],
  "additionalProperties": false
}
```

</details>

**Respuesta 200** (`okResponseSchema`)

| Campo | Tipo   | Obligatorio |
| ----- | ------ | ----------- |
| `v`   | `1`    | sí          |
| `ok`  | `true` | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "ok": { "type": "boolean", "const": true }
  },
  "required": ["v", "ok"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED route:deleteAccount -->

### leaderboard

Rankings públicos de una temporada (por defecto, la actual): `broke` (patrimonio neto más bajo, el ranking estrella), `rich` (más alto) y `spins` (más tiradas). Solo salen usuarios no ocultos con al menos una tirada en esa temporada; los empates se ordenan por tiradas y luego por id, así que los puestos son estables. `seasons` lista las temporadas que existen (para el selector) y `players` cuántos jugadores tiene la tabla.

Errores propios: `404 not_found` si la temporada no existe.

```http
GET /api/leaderboard?season=2026-10&board=broke&limit=25 HTTP/1.1
```

<!-- BEGIN GENERATED route:leaderboard -->

`GET /api/leaderboard` · autenticación: pública (sin sesión)

**Parámetros de la query** (`leaderboardQuerySchema`)

| Campo    | Tipo                                    | Obligatorio |
| -------- | --------------------------------------- | ----------- |
| `season` | `string` (`/^\d{4}-(0[1-9]\|1[0-2])$/`) | no          |
| `board`  | `"broke"` \| `"rich"` \| `"spins"`      | no          |
| `limit`  | `integer` 1–100 (por defecto `50`)      | no          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "season": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" },
    "board": { "default": "broke", "type": "string", "enum": ["broke", "rich", "spins"] },
    "limit": { "default": 50, "type": "integer", "minimum": 1, "maximum": 100 }
  },
  "additionalProperties": false
}
```

</details>

**Respuesta 200** (`leaderboardResponseSchema`)

| Campo     | Tipo                                      | Obligatorio |
| --------- | ----------------------------------------- | ----------- |
| `v`       | `1`                                       | sí          |
| `season`  | `string` (`/^\d{4}-(0[1-9]\|1[0-2])$/`)   | sí          |
| `board`   | `"broke"` \| `"rich"` \| `"spins"`        | sí          |
| `seasons` | `string` (`/^\d{4}-(0[1-9]\|1[0-2])$/`)[] | sí          |
| `rows`    | [LeaderboardRow](#leaderboardrow)[]       | sí          |
| `players` | `integer` ≥ 0                             | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "season": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" },
    "board": { "type": "string", "enum": ["broke", "rich", "spins"] },
    "seasons": {
      "type": "array",
      "items": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" }
    },
    "rows": { "type": "array", "items": { "$ref": "#/$defs/LeaderboardRow" } },
    "players": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }
  },
  "required": ["v", "season", "board", "seasons", "rows", "players"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED route:leaderboard -->

### hallOfRuin

El Salón de la Ruina: el top `hallOfRuinSize` de arruinados de cada temporada **cerrada**, guardado al cerrarla. Al leerlo se quitan los usuarios que se han ocultado después y se renumera.

<!-- BEGIN GENERATED route:hallOfRuin -->

`GET /api/hall-of-ruin` · autenticación: pública (sin sesión)

**Respuesta 200** (`hallOfRuinResponseSchema`)

| Campo     | Tipo                         | Obligatorio |
| --------- | ---------------------------- | ----------- |
| `v`       | `1`                          | sí          |
| `seasons` | `object` (ver JSON Schema)[] | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "seasons": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "seasonId": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" },
          "rows": { "type": "array", "items": { "$ref": "#/$defs/HallOfRuinRow" } }
        },
        "required": ["seasonId", "rows"],
        "additionalProperties": false
      }
    }
  },
  "required": ["v", "seasons"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED route:hallOfRuin -->

## Idempotencia de los turnos

El mod genera un `turnId` propio (`crypto.randomUUID()`; nunca el id interno de Claude Code) y lo manda en `turn/start` y `turn/end`. El servidor guarda cada turno en la tabla `turns` con la clave `(user_id, turn_id)`:

| Situación                                                    | Respuesta                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `turn/start` repetido (reintento)                            | La misma ronda y el mismo `reused`; no se abre otra.                            |
| `turn/start` con otra ronda ya abierta (otra sesión)         | Se reutiliza esa ronda (`reused: true`).                                        |
| `turn/end` repetido de un turno que resolvió su ronda        | La misma ronda resuelta (`resolved`), sin tirar otra vez.                       |
| `turn/end` de un turno cuya ronda resolvió otra sesión       | `no_round` con la cartera actual.                                               |
| `turn/end` sin `turn/start` previo                           | Se abre y se resuelve la ronda en el acto (`round.started` + `round.resolved`). |
| `turn/end` de una ronda abierta hace más de `staleAfterMs`   | La ronda caduca sin tirada (`round.expired`) y la respuesta es `no_round`.      |
| `turn/end` repetido de un turno que se guardó como pendiente | `queued` otra vez (con la cartera actual), sin guardar otra pendiente.          |
| `turn/end` repetido de un turno descartado por el tope       | `queued` con `dropped: true`, sin guardar nada.                                 |

Todo esto ocurre dentro de una transacción que empieza bloqueando la fila de la cartera del usuario (`SELECT … FOR UPDATE`), así que dos peticiones simultáneas del mismo usuario se serializan. Un índice único parcial en `rounds` (`WHERE status = 'open'`) garantiza además una sola ronda abierta por usuario.

## Tiradas pendientes

Modelo híbrido: si al terminar el turno el usuario tiene alguna ventana conectada **y visible**, la tirada se juega en directo (`resolved`). Si no, se guarda como **tirada pendiente** (`queued`) y se gasta después desde la ventana.

- **Visibilidad.** La ventana manda `presence { visible }` (de `document.visibilityState`) al conectar y en cada cambio. El servidor la guarda por conexión, en memoria; una conexión que aún no la ha mandado cuenta como visible (así se comportan las ventanas anteriores a este mensaje).
- **Guardar.** La ronda del turno pasa a `deferred` con el `turnId`, `gitPushOk`, `testFailed` y `durationMs` de su turno: el jackpot del `git push` y la frase de los tests fallidos se conservan para cuando se gaste. Si el usuario ya tiene `pendingSpins.max` pendientes en la temporada, el prompt se descarta (`dropped: true`) y la ronda caduca sin tirada.
- **Gastar.** `spin.pending { quick, requestId }` gasta la pendiente más antigua: en la misma transacción que bloquea la cartera, el servidor tira con el RNG criptográfico **en ese momento** y con las reglas de siempre (boleto, o la última apuesta, o la apuesta por defecto; intereses; rachas; jackpot si su turno hizo `git push`). Responde a todas las ventanas con `round.started` y `round.resolved` (`revealAt` = ahora + `spin.minSpinMs`, o + `pendingSpins.quickSpinMs` si `quick`), cuya cartera ya lleva el contador rebajado. La tirada cuenta en `spins` (y en el ranking) al gastarse.
- **Ritmo.** No se puede gastar otra mientras la anterior no se haya enseñado (su `revealAt` aún no ha llegado): `error` con `rate_limited`. Mientras gira una ronda en directo (Claude pensando): `error` con `conflict`. Sin pendientes: `error` con `not_found`.
- **Idempotencia.** Un `spin.pending` repetido con el mismo `requestId` no tira otra vez: el servidor reenvía a esa ventana el `round.resolved` de la tirada que ya hizo.
- **GIRAR TODAS** es un bucle de la ventana con `quick: true` que se para solo en un premio gordo (jackpot, pleno o un neto de al menos `bigWin.minNetMultiple` veces lo apostado), cuando sale el verde, en bancarrota o si el jugador pulsa ○ (lógica pura en `shared`: `spinAllStopReason`).
- **Caducidad.** Al cerrar una temporada sus pendientes caducan (ronda `expired`) **antes** de guardar el Salón de la Ruina. El contador de la temporada nueva empieza en 0.

## Espectáculo, bancarrota y logros

Todo lo que decide qué animación toca lo calcula el servidor con sus umbrales (`config/game.json`) y viaja en los mensajes, para que la web y el mod no lo recalculen cada uno a su manera.

- **Nivel de espectáculo.** Cada `ResolvedRound` (en `round.resolved`, `hello.lastRound` y la respuesta `resolved` de `turn/end`) lleva [`spectacle`](#spectacle): `tier` (`none`, `win`, `big` ≥ `bigWin.minNetMultiple` × lo apostado, `mega` ≥ `bigWin.megaNetMultiple`, `straight` = pleno acertado con ganancia, que sustituye a MEGA WIN), `netMultiple` (el "×15"), `bigWin` (la regla de parada de GIRAR TODAS), `green` / `greenWin` (salió el 0, y además se ganó), `jackpot` (PUSH TO PROD con ganancia), `streak` y `fire` (`ignite` en la ronda que llega a `streak.onFireAt` victorias seguidas, `burning` después), `fallacy` (la racha de color llega a `streak.colorWarningAt`) y `bankrupt`. Lógica pura en `shared`: `spectacleOf`. Es opcional en el esquema solo por compatibilidad con `v: 1`; este servidor lo manda siempre.
- **Bancarrota.** `spectacle.bankrupt` es `true` en la tirada en la que el patrimonio (saldo − deuda) cae a 0 o menos **por primera vez en la temporada** (BANCARROTA — CONTINUE?). Un préstamo no cambia el patrimonio, así que solo puede pasar al resolver una tirada. En la temporada siguiente puede volver a salir.
- **Logros.** Catálogo fijo en `shared` (`ACHIEVEMENTS`, en el orden de la pantalla). Son **para siempre** (no por temporada): `seasonId` dice en cuál se consiguió. El servidor los evalúa en la misma transacción que la tirada, el préstamo o la tirada guardada, los guarda una sola vez (también con peticiones a la vez) y, después del mensaje del evento (`round.resolved`, `loan.granted` o `pending`), manda un `achievement.unlocked` por logro, en el orden del catálogo. Un reintento del mismo turno o del mismo GIRAR no los repite. El catálogo completo, con lo conseguido y el progreso de los contables, llega en `hello.achievements` y en `/api/me`. Los secretos (`hidden`) llegan igual; la web enseña "???" hasta conseguirlos.
- **Estadísticas y banco.** `stats.request` y `bank.request` (con `seasonId` opcional) responden `stats` y `bank` **solo a la ventana que los pide**. Las listas tienen tope (`stats.*` de `config/game.json`) y la gráfica del patrimonio se muestrea en el servidor. Una temporada en la que no jugó responde `error` con `not_found`.

## Enlace de un solo uso

Para que la ventana entre con la sesión del usuario sin pedirle otro login:

1. El mod llama a `POST /api/auth/link` con su Bearer.
2. El servidor genera un código aleatorio de 256 bits, guarda su SHA-256 con una caducidad de `LINK_CODE_TTL_SECONDS` y devuelve `PUBLIC_URL/play?code=<código>`.
3. El mod abre esa URL (navegador Chromium en modo app o el navegador por defecto) **solo** si es http(s), del mismo origen que su `serverUrl` y sin metacaracteres.
4. La web lee `code`, lo **quita de la barra de direcciones** con `history.replaceState` y hace `POST /api/auth/redeem`.
5. El servidor marca el código como usado con un `UPDATE … WHERE used_at IS NULL AND expires_at > now()` atómico (un solo uso, aunque lleguen dos canjes a la vez), crea una sesión **web** y la manda en la cookie.
6. La web abre `/ws` con esa cookie.

El servidor no registra la URL de ninguna petición (solo el patrón de la ruta), así que el código no acaba en sus logs. Los códigos usados o caducados se purgan en la pasada periódica del job de temporadas.

## WebSocket `/ws`

Lo abre la ventana (la web) en `wss://<PUBLIC_URL>/ws`. El mod no usa WebSocket.

**Conexión.** Antes de aceptar el upgrade el servidor comprueba, por este orden: el cupo de intentos por IP real, que `Origin` sea `PUBLIC_URL` (o de `EXTRA_ALLOWED_ORIGINS`) y que la cookie sea de una sesión **web** válida. El rechazo se hace con el socket ya abierto y un código de cierre `44xx`, porque el navegador no ve los códigos HTTP de un upgrade fallido. Como mucho `WS_MAX_CONNECTIONS_PER_USER` ventanas por usuario.

**Orden.** `hello` es siempre el primer mensaje: lo que pase mientras se prepara se encola y se manda después, en orden. Un `round.started` que llegue después del `round.resolved` de su ronda se descarta. Los mensajes de una misma ventana se procesan de uno en uno.

**Vida.** El servidor manda un ping de WebSocket (trama de control) cada `WS_PING_INTERVAL_MS` y cierra la conexión que no contesta al siguiente; así Cloudflare (que corta a los 100 s sin tráfico) no la tira. La web manda además su propio `ping` de aplicación y, si se corta, reconecta con backoff exponencial y pide `sync`. Antes de cada mensaje (salvo `ping`) el servidor vuelve a comprobar que la sesión sigue viva; si no, cierra con `4401`.

**Límites.** Mensajes de como mucho `WS_MAX_MESSAGE_BYTES` (más grande: cierre `1009`); como mucho `WS_RATE_LIMIT_MAX` mensajes cada `WS_RATE_LIMIT_WINDOW_MS` por ventana (al pasarse, `error` con `rate_limited`). Un mensaje que no es JSON o no cumple el esquema recibe `error` con `invalid_request`; la conexión sigue abierta.

**Errores de una acción.** Si `bet.place` o `bet.clear` fallan, la respuesta es `bet.rejected`; si falla otra acción, `error`. Los dos llevan un código de [`ERROR_CODES`](#errores).

### Códigos de cierre

<!-- BEGIN GENERATED close-codes -->

| Código | Nombre               | Cuándo                                                                                     |
| ------ | -------------------- | ------------------------------------------------------------------------------------------ |
| 4401   | `unauthorized`       | Sin sesión web válida, o la sesión terminó con la ventana abierta.                         |
| 4403   | `forbiddenOrigin`    | El `Origin` no es `PUBLIC_URL` (ni uno de `EXTRA_ALLOWED_ORIGINS`).                        |
| 4429   | `tooManyConnections` | Demasiadas ventanas del mismo usuario o demasiados intentos de conexión desde la misma IP. |
| 4400   | `protocolError`      | El servidor no pudo preparar el estado inicial (`hello`).                                  |
| 4410   | `sessionEnded`       | El servidor cierra la sesión: va precedido de un mensaje `bye` con el motivo.              |

<!-- END GENERATED close-codes -->

Además, `1001` (_going away_) en el apagado ordenado del servidor (precedido de `bye` con `shutdown`) y `1009` si un mensaje supera `WS_MAX_MESSAGE_BYTES`. La web no reintenta tras `4401`, `4403`, `4429` ni `4410`; sí tras cualquier otro cierre.

### Mensajes del cliente

#### bet.place

Pone fichas en una casilla del tapete. A diferencia de `/api/bet`, la selección llega ya estructurada ([`BetSelection`](#betselection)). El resultado llega a **todas** las ventanas del usuario con `slip`.

<!-- example: clientMessageSchema -->

```json
{ "v": 1, "type": "bet.place", "selection": { "kind": "split", "numbers": [8, 9] }, "amount": 50 }
```

<!-- BEGIN GENERATED ws-client:bet.place -->

Dirección: cliente → servidor.

| Campo       | Tipo                          | Obligatorio |
| ----------- | ----------------------------- | ----------- |
| `v`         | `1`                           | sí          |
| `type`      | `"bet.place"`                 | sí          |
| `selection` | [BetSelection](#betselection) | sí          |
| `amount`    | [BetAmount](#betamount)       | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "bet.place" },
    "selection": { "$ref": "#/$defs/BetSelection" },
    "amount": { "$ref": "#/$defs/BetAmount" }
  },
  "required": ["v", "type", "selection", "amount"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-client:bet.place -->

#### bet.clear

Retira todas las fichas del boleto y las devuelve al saldo (respuesta: `slip`).

<!-- example: clientMessageSchema -->

```json
{ "v": 1, "type": "bet.clear" }
```

<!-- BEGIN GENERATED ws-client:bet.clear -->

Dirección: cliente → servidor.

| Campo  | Tipo          | Obligatorio |
| ------ | ------------- | ----------- |
| `v`    | `1`           | sí          |
| `type` | `"bet.clear"` | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "bet.clear" }
  },
  "required": ["v", "type"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-client:bet.clear -->

#### loan.request

Pide el préstamo "Ludo-Crédito Express". Solo se concede si `saldo + boleto` no llega a la ficha mínima (si no, `error` con `loan_not_allowed`). Respuesta: `loan.granted`.

<!-- example: clientMessageSchema -->

```json
{ "v": 1, "type": "loan.request" }
```

<!-- BEGIN GENERATED ws-client:loan.request -->

Dirección: cliente → servidor.

| Campo  | Tipo             | Obligatorio |
| ------ | ---------------- | ----------- |
| `v`    | `1`              | sí          |
| `type` | `"loan.request"` | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "loan.request" }
  },
  "required": ["v", "type"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-client:loan.request -->

#### settings.update

Igual que `POST /api/me/settings`. Respuesta: `settings` (a todas las ventanas).

<!-- example: clientMessageSchema -->

```json
{ "v": 1, "type": "settings.update", "locale": "es" }
```

<!-- BEGIN GENERATED ws-client:settings.update -->

Dirección: cliente → servidor.

| Campo    | Tipo                                           | Obligatorio |
| -------- | ---------------------------------------------- | ----------- |
| `v`      | `1`                                            | sí          |
| `type`   | `"settings.update"`                            | sí          |
| `hidden` | `boolean`                                      | no          |
| `locale` | `"en"` \| `"es"` \| `"fr"` \| `"de"` \| `null` | no          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "settings.update" },
    "hidden": { "type": "boolean" },
    "locale": {
      "anyOf": [{ "type": "string", "enum": ["en", "es", "fr", "de"] }, { "type": "null" }]
    }
  },
  "required": ["v", "type"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-client:settings.update -->

#### presence

Si la ventana se ve (`document.visibilityState === 'visible'`). La ventana lo manda al abrir la conexión y en cada `visibilitychange`. Con todas las ventanas ocultas, los prompts se guardan como [tiradas pendientes](#tiradas-pendientes). No tiene respuesta.

<!-- example: clientMessageSchema -->

```json
{ "v": 1, "type": "presence", "visible": false }
```

<!-- BEGIN GENERATED ws-client:presence -->

Dirección: cliente → servidor.

| Campo     | Tipo         | Obligatorio |
| --------- | ------------ | ----------- |
| `v`       | `1`          | sí          |
| `type`    | `"presence"` | sí          |
| `visible` | `boolean`    | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "presence" },
    "visible": { "type": "boolean" }
  },
  "required": ["v", "type", "visible"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-client:presence -->

#### spin.pending

GIRAR: gasta la tirada pendiente más antigua. `quick: true` en cada vuelta de GIRAR TODAS (giro rápido). `requestId` lo genera la ventana (aleatorio) para que un reintento no tire dos veces. Respuesta: `round.started` y `round.resolved` a todas las ventanas; si no se puede, `error` (`not_found`, `conflict` o `rate_limited`; ver [tiradas pendientes](#tiradas-pendientes)).

<!-- example: clientMessageSchema -->

```json
{
  "v": 1,
  "type": "spin.pending",
  "quick": false,
  "requestId": "0b9d3f4e-6c1a-4f2e-9a57-3f1c2d8e7b10"
}
```

<!-- BEGIN GENERATED ws-client:spin.pending -->

Dirección: cliente → servidor.

| Campo       | Tipo                                 | Obligatorio |
| ----------- | ------------------------------------ | ----------- |
| `v`         | `1`                                  | sí          |
| `type`      | `"spin.pending"`                     | sí          |
| `quick`     | `boolean`                            | sí          |
| `requestId` | `string` (`/^[A-Za-z0-9_-]{8,64}$/`) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "spin.pending" },
    "quick": { "type": "boolean" },
    "requestId": { "type": "string", "pattern": "^[A-Za-z0-9_-]{8,64}$" }
  },
  "required": ["v", "type", "quick", "requestId"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-client:spin.pending -->

#### stats.request

Pide las estadísticas de una temporada (por defecto, la en curso) para la pantalla ESTADÍSTICAS. Respuesta: `stats`, solo a esta ventana.

<!-- example: clientMessageSchema -->

```json
{ "v": 1, "type": "stats.request", "seasonId": "2026-09" }
```

<!-- BEGIN GENERATED ws-client:stats.request -->

Dirección: cliente → servidor.

| Campo      | Tipo                                    | Obligatorio |
| ---------- | --------------------------------------- | ----------- |
| `v`        | `1`                                     | sí          |
| `type`     | `"stats.request"`                       | sí          |
| `seasonId` | `string` (`/^\d{4}-(0[1-9]\|1[0-2])$/`) | no          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "stats.request" },
    "seasonId": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" }
  },
  "required": ["v", "type"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-client:stats.request -->

#### bank.request

Pide el extracto del banco de una temporada (por defecto, la en curso). Respuesta: `bank`, solo a esta ventana.

<!-- example: clientMessageSchema -->

```json
{ "v": 1, "type": "bank.request" }
```

<!-- BEGIN GENERATED ws-client:bank.request -->

Dirección: cliente → servidor.

| Campo      | Tipo                                    | Obligatorio |
| ---------- | --------------------------------------- | ----------- |
| `v`        | `1`                                     | sí          |
| `type`     | `"bank.request"`                        | sí          |
| `seasonId` | `string` (`/^\d{4}-(0[1-9]\|1[0-2])$/`) | no          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "bank.request" },
    "seasonId": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" }
  },
  "required": ["v", "type"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-client:bank.request -->

#### sync

Pide el estado completo otra vez (tras reconectar). Respuesta: `hello`.

<!-- example: clientMessageSchema -->

```json
{ "v": 1, "type": "sync" }
```

<!-- BEGIN GENERATED ws-client:sync -->

Dirección: cliente → servidor.

| Campo  | Tipo     | Obligatorio |
| ------ | -------- | ----------- |
| `v`    | `1`      | sí          |
| `type` | `"sync"` | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "sync" }
  },
  "required": ["v", "type"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-client:sync -->

#### ping

Ping de aplicación con una marca de tiempo del cliente; el servidor la devuelve en `pong`.

<!-- example: clientMessageSchema -->

```json
{ "v": 1, "type": "ping", "t": 1760297400000 }
```

<!-- BEGIN GENERATED ws-client:ping -->

Dirección: cliente → servidor.

| Campo  | Tipo          | Obligatorio |
| ------ | ------------- | ----------- |
| `v`    | `1`           | sí          |
| `type` | `"ping"`      | sí          |
| `t`    | `integer` ≥ 0 | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "ping" },
    "t": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }
  },
  "required": ["v", "type", "t"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-client:ping -->

### Mensajes del servidor

#### hello

Primer mensaje de cada conexión y respuesta a `sync`: el estado completo, con la última ronda resuelta (para enseñarla al reconectar), la hora del servidor y los logros.

<!-- example: serverMessageSchema -->

```json
{
  "v": 1,
  "type": "hello",
  "user": {
    "login": "octo-gambler",
    "avatarUrl": "https://avatars.githubusercontent.com/u/424242?v=4",
    "profileUrl": "https://github.com/octo-gambler",
    "hidden": false,
    "locale": null,
    "createdAt": "2026-10-12T19:28:41.512Z"
  },
  "wallet": {
    "seasonId": "2026-10",
    "balance": 1000,
    "debt": 0,
    "netWorth": 1000,
    "spins": 0,
    "loans": 0,
    "currentStreak": 0,
    "bestStreak": 0,
    "pendingSpins": 0
  },
  "slip": {
    "bets": [],
    "total": 0
  },
  "round": null,
  "lastRound": null,
  "serverTime": "2026-10-12T19:29:10.000Z"
}
```

<!-- BEGIN GENERATED ws-server:hello -->

Dirección: servidor → cliente.

| Campo          | Tipo                                                                                                                                                                                                                                                                                                       | Obligatorio |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `v`            | `1`                                                                                                                                                                                                                                                                                                        | sí          |
| `type`         | `"hello"`                                                                                                                                                                                                                                                                                                  | sí          |
| `user`         | [SelfUser](#selfuser)                                                                                                                                                                                                                                                                                      | sí          |
| `wallet`       | [Wallet](#wallet)                                                                                                                                                                                                                                                                                          | sí          |
| `slip`         | [Slip](#slip)                                                                                                                                                                                                                                                                                              | sí          |
| `round`        | [OpenRound](#openround) \| `null`                                                                                                                                                                                                                                                                          | sí          |
| `lastRound`    | [ResolvedRound](#resolvedround) \| `null`                                                                                                                                                                                                                                                                  | sí          |
| `serverTime`   | `string` (date-time, `/^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$/`) | sí          |
| `achievements` | [Achievement](#achievement)[]                                                                                                                                                                                                                                                                              | no          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "hello" },
    "user": { "$ref": "#/$defs/SelfUser" },
    "wallet": { "$ref": "#/$defs/Wallet" },
    "slip": { "$ref": "#/$defs/Slip" },
    "round": { "anyOf": [{ "$ref": "#/$defs/OpenRound" }, { "type": "null" }] },
    "lastRound": { "anyOf": [{ "$ref": "#/$defs/ResolvedRound" }, { "type": "null" }] },
    "serverTime": {
      "type": "string",
      "format": "date-time",
      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
    },
    "achievements": { "type": "array", "items": { "$ref": "#/$defs/Achievement" } }
  },
  "required": ["v", "type", "user", "wallet", "slip", "round", "lastRound", "serverTime"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:hello -->

#### round.started

Un turno de Claude Code ha abierto una ronda: la ruleta empieza a girar.

<!-- example: serverMessageSchema -->

```json
{
  "v": 1,
  "type": "round.started",
  "round": {
    "roundId": "05fa4f39-ebea-4150-809f-ca9fed9686ad",
    "openedAt": "2026-10-12T19:30:00.000Z"
  }
}
```

<!-- BEGIN GENERATED ws-server:round.started -->

Dirección: servidor → cliente.

| Campo   | Tipo                    | Obligatorio |
| ------- | ----------------------- | ----------- |
| `v`     | `1`                     | sí          |
| `type`  | `"round.started"`       | sí          |
| `round` | [OpenRound](#openround) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "round.started" },
    "round": { "$ref": "#/$defs/OpenRound" }
  },
  "required": ["v", "type", "round"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:round.started -->

#### round.resolved

La ronda ya tiene número. La web deja caer la bola en esa casilla y no enseña el resultado (ni el saldo nuevo) antes de `round.revealAt`. Mismo contenido que la respuesta `resolved` de `turn/end`.

<!-- BEGIN GENERATED ws-server:round.resolved -->

Dirección: servidor → cliente.

| Campo    | Tipo                            | Obligatorio |
| -------- | ------------------------------- | ----------- |
| `v`      | `1`                             | sí          |
| `type`   | `"round.resolved"`              | sí          |
| `round`  | [ResolvedRound](#resolvedround) | sí          |
| `wallet` | [Wallet](#wallet)               | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "round.resolved" },
    "round": { "$ref": "#/$defs/ResolvedRound" },
    "wallet": { "$ref": "#/$defs/Wallet" }
  },
  "required": ["v", "type", "round", "wallet"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:round.resolved -->

#### round.expired

La ronda abierta caducó sin tirada (más de `round.staleAfterMs` abierta, o cambió la temporada). Las fichas del boleto siguen en la cartera.

<!-- example: serverMessageSchema -->

```json
{ "v": 1, "type": "round.expired", "roundId": "05fa4f39-ebea-4150-809f-ca9fed9686ad" }
```

<!-- BEGIN GENERATED ws-server:round.expired -->

Dirección: servidor → cliente.

| Campo     | Tipo                                                                                                                                                                                          | Obligatorio |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `v`       | `1`                                                                                                                                                                                           | sí          |
| `type`    | `"round.expired"`                                                                                                                                                                             | sí          |
| `roundId` | `string` (uuid, `/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\|00000000-0000-0000-0000-000000000000\|ffffffff-ffff-ffff-ffff-ffffffffffff)$/`) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "round.expired" },
    "roundId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    }
  },
  "required": ["v", "type", "roundId"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:round.expired -->

#### slip

El boleto cambió (apuesta desde la ventana, desde `/bet` o retirada), con la cartera resultante.

<!-- BEGIN GENERATED ws-server:slip -->

Dirección: servidor → cliente.

| Campo    | Tipo              | Obligatorio |
| -------- | ----------------- | ----------- |
| `v`      | `1`               | sí          |
| `type`   | `"slip"`          | sí          |
| `slip`   | [Slip](#slip)     | sí          |
| `wallet` | [Wallet](#wallet) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "slip" },
    "slip": { "$ref": "#/$defs/Slip" },
    "wallet": { "$ref": "#/$defs/Wallet" }
  },
  "required": ["v", "type", "slip", "wallet"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:slip -->

#### bet.rejected

Respuesta a un `bet.place` o `bet.clear` que no se pudo hacer.

<!-- example: serverMessageSchema -->

```json
{
  "v": 1,
  "type": "bet.rejected",
  "error": "too_many_bets",
  "message": "At most 40 different bets per round."
}
```

<!-- BEGIN GENERATED ws-server:bet.rejected -->

Dirección: servidor → cliente.

| Campo     | Tipo                                                                                                                                                                                                                                                                                                | Obligatorio |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `v`       | `1`                                                                                                                                                                                                                                                                                                 | sí          |
| `type`    | `"bet.rejected"`                                                                                                                                                                                                                                                                                    | sí          |
| `error`   | `"invalid_request"` \| `"unauthorized"` \| `"forbidden"` \| `"not_found"` \| `"conflict"` \| `"rate_limited"` \| `"payload_too_large"` \| `"insufficient_funds"` \| `"too_many_bets"` \| `"invalid_bet"` \| `"loan_not_allowed"` \| `"protocol_mismatch"` \| `"github_unavailable"` \| `"internal"` | sí          |
| `message` | `string` (0–500 car.)                                                                                                                                                                                                                                                                               | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "bet.rejected" },
    "error": {
      "type": "string",
      "enum": [
        "invalid_request",
        "unauthorized",
        "forbidden",
        "not_found",
        "conflict",
        "rate_limited",
        "payload_too_large",
        "insufficient_funds",
        "too_many_bets",
        "invalid_bet",
        "loan_not_allowed",
        "protocol_mismatch",
        "github_unavailable",
        "internal"
      ]
    },
    "message": { "type": "string", "maxLength": 500 }
  },
  "required": ["v", "type", "error", "message"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:bet.rejected -->

#### loan.granted

Préstamo concedido: `amount` monedas al saldo y la misma cantidad a la deuda, que crece `loan.interestPerSpin` en cada tirada resuelta.

<!-- BEGIN GENERATED ws-server:loan.granted -->

Dirección: servidor → cliente.

| Campo    | Tipo              | Obligatorio |
| -------- | ----------------- | ----------- |
| `v`      | `1`               | sí          |
| `type`   | `"loan.granted"`  | sí          |
| `amount` | `integer` > 0     | sí          |
| `wallet` | [Wallet](#wallet) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "loan.granted" },
    "amount": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
    "wallet": { "$ref": "#/$defs/Wallet" }
  },
  "required": ["v", "type", "amount", "wallet"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:loan.granted -->

#### wallet

Cartera actualizada. Está en el contrato, pero el servidor actual no lo emite (los cambios de cartera llegan dentro de `slip`, `round.resolved`, `loan.granted` y `season.changed`); los clientes deben aceptarlo igualmente.

<!-- BEGIN GENERATED ws-server:wallet -->

Dirección: servidor → cliente.

| Campo    | Tipo              | Obligatorio |
| -------- | ----------------- | ----------- |
| `v`      | `1`               | sí          |
| `type`   | `"wallet"`        | sí          |
| `wallet` | [Wallet](#wallet) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "wallet" },
    "wallet": { "$ref": "#/$defs/Wallet" }
  },
  "required": ["v", "type", "wallet"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:wallet -->

#### pending

Un prompt terminó sin ninguna ventana visible: se ha guardado como tirada pendiente (`queued`) o se ha descartado por el tope (`dropped`). El contador nuevo va en `wallet.pendingSpins`. Al gastar una pendiente no llega este mensaje: el contador rebajado viene en la cartera de `round.resolved`.

<!-- example: serverMessageSchema -->

```json
{
  "v": 1,
  "type": "pending",
  "event": "queued",
  "wallet": {
    "seasonId": "2026-10",
    "balance": 800,
    "debt": 0,
    "netWorth": 800,
    "spins": 1,
    "loans": 0,
    "currentStreak": -1,
    "bestStreak": 0,
    "pendingSpins": 21
  }
}
```

<!-- BEGIN GENERATED ws-server:pending -->

Dirección: servidor → cliente.

| Campo    | Tipo                      | Obligatorio |
| -------- | ------------------------- | ----------- |
| `v`      | `1`                       | sí          |
| `type`   | `"pending"`               | sí          |
| `event`  | `"queued"` \| `"dropped"` | sí          |
| `wallet` | [Wallet](#wallet)         | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "pending" },
    "event": { "type": "string", "enum": ["queued", "dropped"] },
    "wallet": { "$ref": "#/$defs/Wallet" }
  },
  "required": ["v", "type", "event", "wallet"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:pending -->

#### achievement.unlocked

Logro conseguido. Siempre llega **detrás** del mensaje del evento que lo desbloqueó (`round.resolved`, `loan.granted` o `pending`), uno por logro y en el orden del catálogo.

<!-- example: serverMessageSchema -->

```json
{
  "v": 1,
  "type": "achievement.unlocked",
  "achievement": {
    "id": "pro_debtor",
    "hidden": false,
    "unlockedAt": "2026-10-15T12:00:04.000Z",
    "seasonId": "2026-10",
    "params": { "goal": 5 },
    "progress": null
  }
}
```

<!-- BEGIN GENERATED ws-server:achievement.unlocked -->

Dirección: servidor → cliente.

| Campo         | Tipo                        | Obligatorio |
| ------------- | --------------------------- | ----------- |
| `v`           | `1`                         | sí          |
| `type`        | `"achievement.unlocked"`    | sí          |
| `achievement` | [Achievement](#achievement) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "achievement.unlocked" },
    "achievement": { "$ref": "#/$defs/Achievement" }
  },
  "required": ["v", "type", "achievement"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:achievement.unlocked -->

#### stats

Respuesta a `stats.request`: la serie del patrimonio (muestreada a `stats.seriesPoints` puntos como mucho, con el saldo inicial en la tirada 0 y siempre la última), máximo y mínimo reales, marcas de préstamo, las últimas `stats.recentRounds` tiradas, el número que más ha salido y el mayor premio.

<!-- example: serverMessageSchema -->

```json
{
  "v": 1,
  "type": "stats",
  "stats": {
    "seasonId": "2026-10",
    "seasons": ["2026-10", "2026-09"],
    "spins": 3,
    "bestStreak": 1,
    "series": [
      { "spin": 0, "netWorth": 1000 },
      { "spin": 1, "netWorth": 1350 },
      { "spin": 2, "netWorth": 1340 },
      { "spin": 3, "netWorth": 1330 }
    ],
    "peakNetWorth": 1350,
    "lowestNetWorth": 1000,
    "loanMarks": [],
    "recent": [
      {
        "roundId": "8f0e3c1a-6b2d-4d47-9a51-0c6f1e2b3a44",
        "resolvedAt": "2026-10-15T12:02:00.000Z",
        "result": 2,
        "color": "black",
        "staked": 10,
        "net": -10
      }
    ],
    "mostFrequent": { "result": 2, "color": "black", "count": 2 },
    "biggestWin": {
      "roundId": "0b7d8a52-3f1e-4c9b-8d26-5e4a3c2b1f00",
      "resolvedAt": "2026-10-15T12:00:00.000Z",
      "result": 7,
      "color": "red",
      "staked": 10,
      "net": 350
    }
  }
}
```

<!-- BEGIN GENERATED ws-server:stats -->

Dirección: servidor → cliente.

| Campo   | Tipo                        | Obligatorio |
| ------- | --------------------------- | ----------- |
| `v`     | `1`                         | sí          |
| `type`  | `"stats"`                   | sí          |
| `stats` | [SeasonStats](#seasonstats) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "stats" },
    "stats": { "$ref": "#/$defs/SeasonStats" }
  },
  "required": ["v", "type", "stats"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:stats -->

#### bank

Respuesta a `bank.request`: deuda, saldo, patrimonio, préstamos, lo que subirá la deuda en la próxima tirada, si se le concedería un préstamo ahora y el historial (cada préstamo por separado; los intereses agrupados por día de la zona horaria de la temporada y por tramo entre préstamos), con la deuda tras cada movimiento. Como mucho `stats.bankHistory` movimientos; `truncated` dice si hay más antiguos.

<!-- example: serverMessageSchema -->

```json
{
  "v": 1,
  "type": "bank",
  "bank": {
    "seasonId": "2026-10",
    "seasons": ["2026-10"],
    "balance": 0,
    "debt": 666,
    "netWorth": -666,
    "loans": 1,
    "nextInterest": 14,
    "canBorrow": true,
    "history": [
      {
        "kind": "interest",
        "day": "2026-10-15",
        "from": "2026-10-15T12:01:00.000Z",
        "to": "2026-10-15T12:03:00.000Z",
        "spins": 3,
        "amount": 166,
        "debtAfter": 666
      },
      { "kind": "loan", "at": "2026-10-15T12:00:30.000Z", "amount": 500, "debtAfter": 500 }
    ],
    "truncated": false
  }
}
```

<!-- BEGIN GENERATED ws-server:bank -->

Dirección: servidor → cliente.

| Campo  | Tipo                            | Obligatorio |
| ------ | ------------------------------- | ----------- |
| `v`    | `1`                             | sí          |
| `type` | `"bank"`                        | sí          |
| `bank` | [BankStatement](#bankstatement) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "bank" },
    "bank": { "$ref": "#/$defs/BankStatement" }
  },
  "required": ["v", "type", "bank"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:bank -->

#### settings

Los ajustes cambiaron (desde esta ventana, otra, o el mod).

<!-- BEGIN GENERATED ws-server:settings -->

Dirección: servidor → cliente.

| Campo  | Tipo                  | Obligatorio |
| ------ | --------------------- | ----------- |
| `v`    | `1`                   | sí          |
| `type` | `"settings"`          | sí          |
| `user` | [SelfUser](#selfuser) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "settings" },
    "user": { "$ref": "#/$defs/SelfUser" }
  },
  "required": ["v", "type", "user"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:settings -->

#### season.changed

Empezó una temporada nueva: saldo al inicial y deuda a cero. Lo manda el job que cierra la temporada.

<!-- BEGIN GENERATED ws-server:season.changed -->

Dirección: servidor → cliente.

| Campo      | Tipo                                    | Obligatorio |
| ---------- | --------------------------------------- | ----------- |
| `v`        | `1`                                     | sí          |
| `type`     | `"season.changed"`                      | sí          |
| `seasonId` | `string` (`/^\d{4}-(0[1-9]\|1[0-2])$/`) | sí          |
| `wallet`   | [Wallet](#wallet)                       | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "season.changed" },
    "seasonId": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" },
    "wallet": { "$ref": "#/$defs/Wallet" }
  },
  "required": ["v", "type", "seasonId", "wallet"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:season.changed -->

#### error

Un mensaje no válido o una acción que falló (que no es una apuesta).

<!-- example: serverMessageSchema -->

```json
{
  "v": 1,
  "type": "error",
  "error": "loan_not_allowed",
  "message": "You still have coins. The bank only lends to the truly broke."
}
```

<!-- BEGIN GENERATED ws-server:error -->

Dirección: servidor → cliente.

| Campo     | Tipo                                                                                                                                                                                                                                                                                                | Obligatorio |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `v`       | `1`                                                                                                                                                                                                                                                                                                 | sí          |
| `type`    | `"error"`                                                                                                                                                                                                                                                                                           | sí          |
| `error`   | `"invalid_request"` \| `"unauthorized"` \| `"forbidden"` \| `"not_found"` \| `"conflict"` \| `"rate_limited"` \| `"payload_too_large"` \| `"insufficient_funds"` \| `"too_many_bets"` \| `"invalid_bet"` \| `"loan_not_allowed"` \| `"protocol_mismatch"` \| `"github_unavailable"` \| `"internal"` | sí          |
| `message` | `string` (0–500 car.)                                                                                                                                                                                                                                                                               | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "error" },
    "error": {
      "type": "string",
      "enum": [
        "invalid_request",
        "unauthorized",
        "forbidden",
        "not_found",
        "conflict",
        "rate_limited",
        "payload_too_large",
        "insufficient_funds",
        "too_many_bets",
        "invalid_bet",
        "loan_not_allowed",
        "protocol_mismatch",
        "github_unavailable",
        "internal"
      ]
    },
    "message": { "type": "string", "maxLength": 500 }
  },
  "required": ["v", "type", "error", "message"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:error -->

#### pong

Respuesta a `ping`, con la misma `t`.

<!-- example: serverMessageSchema -->

```json
{ "v": 1, "type": "pong", "t": 1760297400000 }
```

<!-- BEGIN GENERATED ws-server:pong -->

Dirección: servidor → cliente.

| Campo  | Tipo          | Obligatorio |
| ------ | ------------- | ----------- |
| `v`    | `1`           | sí          |
| `type` | `"pong"`      | sí          |
| `t`    | `integer` ≥ 0 | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "pong" },
    "t": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }
  },
  "required": ["v", "type", "t"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:pong -->

#### bye

El servidor va a cerrar la conexión: `logout` (se cerró esa sesión), `account_deleted`, `shutdown` (apagado ordenado; cierre `1001`) o `replaced` (reservado: el servidor actual no lo usa). Tras `logout` y `account_deleted` el cierre es `4410`.

<!-- example: serverMessageSchema -->

```json
{ "v": 1, "type": "bye", "reason": "logout" }
```

<!-- BEGIN GENERATED ws-server:bye -->

Dirección: servidor → cliente.

| Campo    | Tipo                                                              | Obligatorio |
| -------- | ----------------------------------------------------------------- | ----------- |
| `v`      | `1`                                                               | sí          |
| `type`   | `"bye"`                                                           | sí          |
| `reason` | `"logout"` \| `"account_deleted"` \| `"shutdown"` \| `"replaced"` | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "type": { "type": "string", "const": "bye" },
    "reason": { "type": "string", "enum": ["logout", "account_deleted", "shutdown", "replaced"] }
  },
  "required": ["v", "type", "reason"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED ws-server:bye -->

## Rutas fuera de `/api`

<!-- BEGIN GENERATED pages -->

| Nombre (`PAGE_PATHS`) | Ruta           |
| --------------------- | -------------- |
| `play`                | `/play`        |
| `privacy`             | `/privacy`     |
| `webConfig`           | `/config.json` |
| `ws`                  | `/ws`          |
| `healthz`             | `/healthz`     |

<!-- END GENERATED pages -->

- `GET /` (landing + ranking), `GET /play` (la ventana del juego), `GET /privacy`: HTML de la build de la web (`WEB_DIST_DIR`), con `Cache-Control: no-cache` y `ETag`; el servidor reescribe sus metadatos de previsualización (`og:image`…) como URLs absolutas con `PUBLIC_URL`. También responden por el nombre del archivo (`/index.html`, `/play.html`, `/privacy.html`). Si el servidor arranca sin la build, responden `503` con una página que lo explica y solo funciona la API.
- `GET /assets/*`: archivos con hash de Vite, `max-age=ASSETS_MAX_AGE_SECONDS, immutable`. El resto de estáticos, `max-age=STATIC_MAX_AGE_SECONDS`.
- `GET /healthz`: `200 {"ok":true}` si la base de datos responde a un `select 1`; si no, `503` con un `ErrorResponse` (`internal`). Sin rate limit ni caché. Es lo que miran el `HEALTHCHECK` de la imagen, `deploy.yml` y la monitorización.
- `GET /config.json`: la configuración pública que la web lee al arrancar (nunca va escrita en el bundle). Sale de las variables de entorno y de `config/game.json` (solo la parte pública) y `config/site.json`. Lo que cuenta la página `/privacy` de la instancia va en `site.instance` (de `site.json`) y en `privacy` (del entorno: `CSP_IMG_ORIGINS` y la duración de las sesiones y del enlace). Todas sus URLs son `http`/`https`. Caché `max-age=STATIC_MAX_AGE_SECONDS`.

<!-- BEGIN GENERATED web-config -->

**Cuerpo de `/config.json`** (`webConfigSchema`)

| Campo           | Tipo                                  | Obligatorio |
| --------------- | ------------------------------------- | ----------- |
| `v`             | `1`                                   | sí          |
| `publicUrl`     | `string` (`/^https?:\/\//`)           | sí          |
| `instanceName`  | `string` (1–80 car.)                  | sí          |
| `isOfficial`    | `boolean`                             | sí          |
| `serverVersion` | `string` (0–40 car.)                  | sí          |
| `game`          | [PublicGameConfig](#publicgameconfig) | sí          |
| `privacy`       | `object` (ver JSON Schema)            | sí          |
| `site`          | `object` (ver JSON Schema)            | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "publicUrl": { "type": "string", "pattern": "^https?:\\/\\/" },
    "instanceName": { "type": "string", "minLength": 1, "maxLength": 80 },
    "isOfficial": { "type": "boolean" },
    "serverVersion": { "type": "string", "maxLength": 40 },
    "game": { "$ref": "#/$defs/PublicGameConfig" },
    "privacy": {
      "type": "object",
      "properties": {
        "imageOrigins": {
          "type": "array",
          "items": { "type": "string", "pattern": "^https?:\\/\\/" }
        },
        "modSessionTtlSeconds": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        },
        "webSessionTtlSeconds": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        },
        "linkCodeTtlSeconds": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        },
        "ipMemorySeconds": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 }
      },
      "required": [
        "imageOrigins",
        "modSessionTtlSeconds",
        "webSessionTtlSeconds",
        "linkCodeTtlSeconds",
        "ipMemorySeconds"
      ],
      "additionalProperties": false
    },
    "site": {
      "type": "object",
      "properties": {
        "author": {
          "type": "object",
          "properties": {
            "name": { "type": "string", "minLength": 1 },
            "url": { "type": "string", "pattern": "^https?:\\/\\/" }
          },
          "required": ["name", "url"],
          "additionalProperties": false
        },
        "repoUrl": { "type": "string", "pattern": "^https?:\\/\\/" },
        "installCommand": { "type": "string", "minLength": 1, "maxLength": 200 },
        "helpLinks": {
          "type": "object",
          "propertyNames": { "type": "string", "enum": ["en", "es", "fr", "de"] },
          "additionalProperties": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "label": { "type": "string", "minLength": 1, "maxLength": 80 },
                "url": { "type": "string", "pattern": "^https?:\\/\\/" }
              },
              "required": ["label", "url"],
              "additionalProperties": false
            }
          }
        },
        "moreProjects": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "label": { "type": "string", "minLength": 1, "maxLength": 80 },
              "url": { "type": "string", "pattern": "^https?:\\/\\/" },
              "description": { "type": "string", "maxLength": 200 }
            },
            "required": ["label", "url", "description"],
            "additionalProperties": false
          }
        },
        "instance": {
          "type": "object",
          "properties": {
            "operator": {
              "type": "object",
              "properties": {
                "name": { "type": "string", "minLength": 1, "maxLength": 80 },
                "url": { "type": "string", "pattern": "^https?:\\/\\/" }
              },
              "required": ["name", "url"],
              "additionalProperties": false
            },
            "hosting": {
              "type": "object",
              "propertyNames": { "type": "string", "enum": ["en", "es", "fr", "de"] },
              "additionalProperties": { "type": "string", "minLength": 1, "maxLength": 200 }
            },
            "networkProxy": {
              "anyOf": [{ "type": "string", "minLength": 1, "maxLength": 80 }, { "type": "null" }]
            },
            "contact": {
              "type": "object",
              "properties": {
                "label": { "type": "string", "minLength": 1, "maxLength": 80 },
                "url": { "type": "string", "pattern": "^https?:\\/\\/" }
              },
              "required": ["label", "url"],
              "additionalProperties": false
            },
            "backupRetentionDays": {
              "anyOf": [{ "type": "integer", "minimum": 1, "maximum": 3650 }, { "type": "null" }]
            }
          },
          "required": ["operator", "hosting", "networkProxy", "contact", "backupRetentionDays"],
          "additionalProperties": false
        }
      },
      "required": ["author", "repoUrl", "installCommand", "helpLinks", "moreProjects", "instance"],
      "additionalProperties": false
    }
  },
  "required": [
    "v",
    "publicUrl",
    "instanceName",
    "isOfficial",
    "serverVersion",
    "game",
    "privacy",
    "site"
  ],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED web-config -->

## Piezas comunes

Las tablas de arriba enlazan aquí cuando un campo es una de estas piezas.

<!-- BEGIN GENERATED common:PublicUser -->

### PublicUser

**PublicUser** (`publicUserSchema`)

| Campo        | Tipo                        | Obligatorio |
| ------------ | --------------------------- | ----------- |
| `login`      | `string` (1–39 car.)        | sí          |
| `avatarUrl`  | `string` (`/^https?:\/\//`) | sí          |
| `profileUrl` | `string` (`/^https?:\/\//`) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "login": { "type": "string", "minLength": 1, "maxLength": 39 },
    "avatarUrl": { "type": "string", "pattern": "^https?:\\/\\/" },
    "profileUrl": { "type": "string", "pattern": "^https?:\\/\\/" }
  },
  "required": ["login", "avatarUrl", "profileUrl"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:PublicUser -->

<!-- BEGIN GENERATED common:SelfUser -->

### SelfUser

**SelfUser** (`selfUserSchema`)

| Campo        | Tipo                                                                                                                                                                                                                                                                                                       | Obligatorio |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `login`      | `string` (1–39 car.)                                                                                                                                                                                                                                                                                       | sí          |
| `avatarUrl`  | `string` (`/^https?:\/\//`)                                                                                                                                                                                                                                                                                | sí          |
| `profileUrl` | `string` (`/^https?:\/\//`)                                                                                                                                                                                                                                                                                | sí          |
| `hidden`     | `boolean`                                                                                                                                                                                                                                                                                                  | sí          |
| `locale`     | `"en"` \| `"es"` \| `"fr"` \| `"de"` \| `null`                                                                                                                                                                                                                                                             | sí          |
| `createdAt`  | `string` (date-time, `/^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$/`) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "login": { "type": "string", "minLength": 1, "maxLength": 39 },
    "avatarUrl": { "type": "string", "pattern": "^https?:\\/\\/" },
    "profileUrl": { "type": "string", "pattern": "^https?:\\/\\/" },
    "hidden": { "type": "boolean" },
    "locale": {
      "anyOf": [{ "type": "string", "enum": ["en", "es", "fr", "de"] }, { "type": "null" }]
    },
    "createdAt": {
      "type": "string",
      "format": "date-time",
      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
    }
  },
  "required": ["login", "avatarUrl", "profileUrl", "hidden", "locale", "createdAt"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:SelfUser -->

<!-- BEGIN GENERATED common:Wallet -->

### Wallet

**Wallet** (`walletSchema`)

| Campo           | Tipo                                    | Obligatorio |
| --------------- | --------------------------------------- | ----------- |
| `seasonId`      | `string` (`/^\d{4}-(0[1-9]\|1[0-2])$/`) | sí          |
| `balance`       | `integer`                               | sí          |
| `debt`          | `integer` ≥ 0                           | sí          |
| `netWorth`      | `integer`                               | sí          |
| `spins`         | `integer` ≥ 0                           | sí          |
| `loans`         | `integer` ≥ 0                           | sí          |
| `currentStreak` | `integer`                               | sí          |
| `bestStreak`    | `integer` ≥ 0                           | sí          |
| `pendingSpins`  | `integer` ≥ 0                           | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "seasonId": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" },
    "balance": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 },
    "debt": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "netWorth": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 },
    "spins": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "loans": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "currentStreak": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "bestStreak": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "pendingSpins": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }
  },
  "required": [
    "seasonId",
    "balance",
    "debt",
    "netWorth",
    "spins",
    "loans",
    "currentStreak",
    "bestStreak",
    "pendingSpins"
  ],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:Wallet -->

`netWorth = balance − debt`: la métrica del ranking. `currentStreak` es positiva si llevas rondas ganadas seguidas y negativa si perdidas.

<!-- BEGIN GENERATED common:Slip -->

### Slip

**Slip** (`slipSchema`)

| Campo   | Tipo          | Obligatorio |
| ------- | ------------- | ----------- |
| `bets`  | [Bet](#bet)[] | sí          |
| `total` | `integer` ≥ 0 | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "bets": { "type": "array", "items": { "$ref": "#/$defs/Bet" } },
    "total": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }
  },
  "required": ["bets", "total"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:Slip -->

Las fichas del boleto ya están descontadas de `balance`.

<!-- BEGIN GENERATED common:Bet -->

### Bet

**Bet** (`betSchema`)

| Campo       | Tipo                          | Obligatorio |
| ----------- | ----------------------------- | ----------- |
| `selection` | [BetSelection](#betselection) | sí          |
| `amount`    | `integer` > 0                 | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "selection": { "$ref": "#/$defs/BetSelection" },
    "amount": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 }
  },
  "required": ["selection", "amount"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:Bet -->

<!-- BEGIN GENERATED common:BetSelection -->

### BetSelection

**BetSelection** (`betSelectionSchema`)

Una de estas variantes:

- variante 1

  | Campo     | Tipo                                                              | Obligatorio |
  | --------- | ----------------------------------------------------------------- | ----------- |
  | `kind`    | `"straight"` \| `"split"` \| `"street"` \| `"corner"` \| `"line"` | sí          |
  | `numbers` | `integer` 0–36[] (1–6 elementos)                                  | sí          |

- variante 2

  | Campo   | Tipo                    | Obligatorio |
  | ------- | ----------------------- | ----------- |
  | `kind`  | `"dozen"` \| `"column"` | sí          |
  | `index` | `1` \| `2` \| `3`       | sí          |

- variante 3

  | Campo  | Tipo                                                               | Obligatorio |
  | ------ | ------------------------------------------------------------------ | ----------- |
  | `kind` | `"red"` \| `"black"` \| `"even"` \| `"odd"` \| `"low"` \| `"high"` | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "anyOf": [
    {
      "type": "object",
      "properties": {
        "kind": { "type": "string", "enum": ["straight", "split", "street", "corner", "line"] },
        "numbers": {
          "minItems": 1,
          "maxItems": 6,
          "type": "array",
          "items": { "type": "integer", "minimum": 0, "maximum": 36 }
        }
      },
      "required": ["kind", "numbers"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "kind": { "type": "string", "enum": ["dozen", "column"] },
        "index": {
          "anyOf": [
            { "type": "number", "const": 1 },
            { "type": "number", "const": 2 },
            { "type": "number", "const": 3 }
          ]
        }
      },
      "required": ["kind", "index"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "kind": { "type": "string", "enum": ["red", "black", "even", "odd", "low", "high"] }
      },
      "required": ["kind"],
      "additionalProperties": false
    }
  ]
}
```

</details>

<!-- END GENERATED common:BetSelection -->

Apuestas de la ruleta europea y su pago "x a 1" (constantes de `PAYOUTS`; con el 0 pierden todas las sencillas, sin _la partage_):

| `kind`                                       | Qué cubre                                                        | Pago |
| -------------------------------------------- | ---------------------------------------------------------------- | ---- |
| `straight`                                   | 1 número (`numbers: [17]`)                                       | 35:1 |
| `split`                                      | 2 números vecinos (`[8, 9]`, `[0, 2]`)                           | 17:1 |
| `street`                                     | Fila de 3 (`[1, 2, 3]`) o los tríos `[0, 1, 2]`, `[0, 2, 3]`     | 11:1 |
| `corner`                                     | Cuadro de 4 (`[8, 9, 11, 12]`) o los cuatro primeros `[0,1,2,3]` | 8:1  |
| `line`                                       | Seisena: dos filas (`[1, 2, 3, 4, 5, 6]`)                        | 5:1  |
| `dozen`, `column`                            | `index` 1, 2 o 3                                                 | 2:1  |
| `red`, `black`, `even`, `odd`, `low`, `high` | Sencillas (`low` = 1–18, `high` = 19–36)                         | 1:1  |

Los `numbers` se ordenan al validar y tienen que existir en el tapete (`isValidInside`).

<!-- example: betSelectionSchema -->

```json
{ "kind": "corner", "numbers": [8, 9, 11, 12] }
```

<!-- example: betSelectionSchema -->

```json
{ "kind": "dozen", "index": 2 }
```

<!-- BEGIN GENERATED common:BetAmount -->

### BetAmount

**BetAmount** (`betAmountSchema`)

Tipo: [BetAmount](#betamount)

<details><summary>JSON Schema</summary>

```json
{
  "anyOf": [
    { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
    { "type": "string", "const": "all-in" }
  ]
}
```

</details>

<!-- END GENERATED common:BetAmount -->

<!-- BEGIN GENERATED common:BetOutcome -->

### BetOutcome

**BetOutcome** (`betOutcomeSchema`)

| Campo       | Tipo                          | Obligatorio |
| ----------- | ----------------------------- | ----------- |
| `selection` | [BetSelection](#betselection) | sí          |
| `amount`    | `integer` > 0                 | sí          |
| `won`       | `boolean`                     | sí          |
| `payout`    | `integer` ≥ 0                 | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "selection": { "$ref": "#/$defs/BetSelection" },
    "amount": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
    "won": { "type": "boolean" },
    "payout": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }
  },
  "required": ["selection", "amount", "won", "payout"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:BetOutcome -->

<!-- BEGIN GENERATED common:ColorStreak -->

### ColorStreak

**ColorStreak** (`colorStreakSchema`)

| Campo   | Tipo                              | Obligatorio |
| ------- | --------------------------------- | ----------- |
| `color` | `"red"` \| `"black"` \| `"green"` | sí          |
| `count` | `integer` ≥ 1                     | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "color": { "type": "string", "enum": ["red", "black", "green"] },
    "count": { "type": "integer", "minimum": 1, "maximum": 9007199254740991 }
  },
  "required": ["color", "count"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:ColorStreak -->

Racha de color al final de las últimas `streak.historySize` tiradas **del propio usuario**. La web enseña el aviso de "falacia del jugador" a partir de `colorWarningAt`.

<!-- BEGIN GENERATED common:OpenRound -->

### OpenRound

**OpenRound** (`openRoundSchema`)

| Campo      | Tipo                                                                                                                                                                                                                                                                                                       | Obligatorio |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `roundId`  | `string` (uuid, `/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\|00000000-0000-0000-0000-000000000000\|ffffffff-ffff-ffff-ffff-ffffffffffff)$/`)                                                                                                              | sí          |
| `openedAt` | `string` (date-time, `/^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$/`) | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "roundId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "openedAt": {
      "type": "string",
      "format": "date-time",
      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
    }
  },
  "required": ["roundId", "openedAt"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:OpenRound -->

<!-- BEGIN GENERATED common:Spectacle -->

### Spectacle

**Spectacle** (`spectacleSchema`)

| Campo         | Tipo                                                       | Obligatorio |
| ------------- | ---------------------------------------------------------- | ----------- |
| `tier`        | `"none"` \| `"win"` \| `"big"` \| `"mega"` \| `"straight"` | sí          |
| `netMultiple` | `integer` ≥ 0                                              | sí          |
| `bigWin`      | `boolean`                                                  | sí          |
| `green`       | `boolean`                                                  | sí          |
| `greenWin`    | `boolean`                                                  | sí          |
| `jackpot`     | `boolean`                                                  | sí          |
| `streak`      | `integer`                                                  | sí          |
| `fire`        | `"none"` \| `"ignite"` \| `"burning"`                      | sí          |
| `fallacy`     | `boolean`                                                  | sí          |
| `bankrupt`    | `boolean`                                                  | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "tier": { "type": "string", "enum": ["none", "win", "big", "mega", "straight"] },
    "netMultiple": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "bigWin": { "type": "boolean" },
    "green": { "type": "boolean" },
    "greenWin": { "type": "boolean" },
    "jackpot": { "type": "boolean" },
    "streak": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 },
    "fire": { "type": "string", "enum": ["none", "ignite", "burning"] },
    "fallacy": { "type": "boolean" },
    "bankrupt": { "type": "boolean" }
  },
  "required": [
    "tier",
    "netMultiple",
    "bigWin",
    "green",
    "greenWin",
    "jackpot",
    "streak",
    "fire",
    "fallacy",
    "bankrupt"
  ],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:Spectacle -->

<!-- BEGIN GENERATED common:ResolvedRound -->

### ResolvedRound

**ResolvedRound** (`resolvedRoundSchema`)

| Campo             | Tipo                                                                                                                                                                                                                                                                                                       | Obligatorio |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `roundId`         | `string` (uuid, `/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\|00000000-0000-0000-0000-000000000000\|ffffffff-ffff-ffff-ffff-ffffffffffff)$/`)                                                                                                              | sí          |
| `openedAt`        | `string` (date-time, `/^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$/`) | sí          |
| `resolvedAt`      | `string` (date-time, `/^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$/`) | sí          |
| `result`          | `integer` 0–36                                                                                                                                                                                                                                                                                             | sí          |
| `color`           | `"red"` \| `"black"` \| `"green"`                                                                                                                                                                                                                                                                          | sí          |
| `bets`            | [BetOutcome](#betoutcome)[]                                                                                                                                                                                                                                                                                | sí          |
| `source`          | `"slip"` \| `"repeat"` \| `"default"` \| `"none"`                                                                                                                                                                                                                                                          | sí          |
| `staked`          | `integer` ≥ 0                                                                                                                                                                                                                                                                                              | sí          |
| `returned`        | `integer` ≥ 0                                                                                                                                                                                                                                                                                              | sí          |
| `net`             | `integer`                                                                                                                                                                                                                                                                                                  | sí          |
| `jackpot`         | `boolean`                                                                                                                                                                                                                                                                                                  | sí          |
| `gitPushOk`       | `boolean`                                                                                                                                                                                                                                                                                                  | sí          |
| `testFailed`      | `boolean`                                                                                                                                                                                                                                                                                                  | sí          |
| `interestCharged` | `integer` ≥ 0                                                                                                                                                                                                                                                                                              | sí          |
| `colorStreak`     | [ColorStreak](#colorstreak) \| `null`                                                                                                                                                                                                                                                                      | sí          |
| `revealAt`        | `string` (date-time, `/^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$/`) | sí          |
| `spectacle`       | [Spectacle](#spectacle)                                                                                                                                                                                                                                                                                    | no          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "roundId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "openedAt": {
      "type": "string",
      "format": "date-time",
      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
    },
    "resolvedAt": {
      "type": "string",
      "format": "date-time",
      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
    },
    "result": { "type": "integer", "minimum": 0, "maximum": 36 },
    "color": { "type": "string", "enum": ["red", "black", "green"] },
    "bets": { "type": "array", "items": { "$ref": "#/$defs/BetOutcome" } },
    "source": { "type": "string", "enum": ["slip", "repeat", "default", "none"] },
    "staked": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "returned": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "net": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 },
    "jackpot": { "type": "boolean" },
    "gitPushOk": { "type": "boolean" },
    "testFailed": { "type": "boolean" },
    "interestCharged": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "colorStreak": { "anyOf": [{ "$ref": "#/$defs/ColorStreak" }, { "type": "null" }] },
    "revealAt": {
      "type": "string",
      "format": "date-time",
      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
    },
    "spectacle": { "$ref": "#/$defs/Spectacle" }
  },
  "required": [
    "roundId",
    "openedAt",
    "resolvedAt",
    "result",
    "color",
    "bets",
    "source",
    "staked",
    "returned",
    "net",
    "jackpot",
    "gitPushOk",
    "testFailed",
    "interestCharged",
    "colorStreak",
    "revealAt"
  ],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:ResolvedRound -->

`source` dice de dónde salieron las fichas: `slip` (el boleto), `repeat` (se repitió la última apuesta), `default` (nunca habías apostado: 10 al rojo según `config/game.json`) o `none` (no había saldo: la ruleta gira sin apuesta). `net = returned − staked`. Con `jackpot`, la **ganancia** se multiplicó por `jackpot.gitPushMultiplier`.

<!-- BEGIN GENERATED common:Achievement -->

### Achievement

**Achievement** (`achievementSchema`)

| Campo        | Tipo                                                                                                                                                                                                                                                                                                                         | Obligatorio |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `id`         | `"first_spin"` \| `"first_ruin"` \| `"pro_debtor"` \| `"all_on_zero"` \| `"friday_push"` \| `"queue_full"` \| `"on_fire"` \| `"fallacy_confirmed"` \| `"compound_interest"` \| `"comeback"` \| `"zero_collector"` \| `"big_win"` \| `"mega_win"` \| `"tests_also_bet"` \| `"addict"` \| `"night_owl"` \| `"too_big_to_fail"` | sí          |
| `hidden`     | `boolean`                                                                                                                                                                                                                                                                                                                    | sí          |
| `unlockedAt` | `string` (date-time, `/^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$/`) \| `null`         | sí          |
| `seasonId`   | `string` (`/^\d{4}-(0[1-9]\|1[0-2])$/`) \| `null`                                                                                                                                                                                                                                                                            | sí          |
| `params`     | `object` (`string` (`/^[a-z][A-Za-z]{0,31}$/`) → `number`)                                                                                                                                                                                                                                                                   | sí          |
| `progress`   | `object` (ver JSON Schema) \| `null`                                                                                                                                                                                                                                                                                         | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "enum": [
        "first_spin",
        "first_ruin",
        "pro_debtor",
        "all_on_zero",
        "friday_push",
        "queue_full",
        "on_fire",
        "fallacy_confirmed",
        "compound_interest",
        "comeback",
        "zero_collector",
        "big_win",
        "mega_win",
        "tests_also_bet",
        "addict",
        "night_owl",
        "too_big_to_fail"
      ]
    },
    "hidden": { "type": "boolean" },
    "unlockedAt": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
        },
        { "type": "null" }
      ]
    },
    "seasonId": {
      "anyOf": [{ "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" }, { "type": "null" }]
    },
    "params": {
      "type": "object",
      "propertyNames": { "type": "string", "pattern": "^[a-z][A-Za-z]{0,31}$" },
      "additionalProperties": { "type": "number" }
    },
    "progress": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "current": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
            "goal": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 }
          },
          "required": ["current", "goal"],
          "additionalProperties": false
        },
        { "type": "null" }
      ]
    }
  },
  "required": ["id", "hidden", "unlockedAt", "seasonId", "params", "progress"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:Achievement -->

<!-- BEGIN GENERATED common:RoundSummary -->

### RoundSummary

**RoundSummary** (`roundSummarySchema`)

| Campo        | Tipo                                                                                                                                                                                                                                                                                                       | Obligatorio |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `roundId`    | `string` (uuid, `/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\|00000000-0000-0000-0000-000000000000\|ffffffff-ffff-ffff-ffff-ffffffffffff)$/`)                                                                                                              | sí          |
| `resolvedAt` | `string` (date-time, `/^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$/`) | sí          |
| `result`     | `integer` 0–36                                                                                                                                                                                                                                                                                             | sí          |
| `color`      | `"red"` \| `"black"` \| `"green"`                                                                                                                                                                                                                                                                          | sí          |
| `staked`     | `integer` ≥ 0                                                                                                                                                                                                                                                                                              | sí          |
| `net`        | `integer`                                                                                                                                                                                                                                                                                                  | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "roundId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "resolvedAt": {
      "type": "string",
      "format": "date-time",
      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
    },
    "result": { "type": "integer", "minimum": 0, "maximum": 36 },
    "color": { "type": "string", "enum": ["red", "black", "green"] },
    "staked": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "net": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }
  },
  "required": ["roundId", "resolvedAt", "result", "color", "staked", "net"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:RoundSummary -->

<!-- BEGIN GENERATED common:SeasonStats -->

### SeasonStats

**SeasonStats** (`seasonStatsSchema`)

| Campo            | Tipo                                      | Obligatorio |
| ---------------- | ----------------------------------------- | ----------- |
| `seasonId`       | `string` (`/^\d{4}-(0[1-9]\|1[0-2])$/`)   | sí          |
| `seasons`        | `string` (`/^\d{4}-(0[1-9]\|1[0-2])$/`)[] | sí          |
| `spins`          | `integer` ≥ 0                             | sí          |
| `bestStreak`     | `integer` ≥ 0                             | sí          |
| `series`         | `object` (ver JSON Schema)[]              | sí          |
| `peakNetWorth`   | `integer`                                 | sí          |
| `lowestNetWorth` | `integer`                                 | sí          |
| `loanMarks`      | `integer` ≥ 0[]                           | sí          |
| `recent`         | [RoundSummary](#roundsummary)[]           | sí          |
| `mostFrequent`   | `object` (ver JSON Schema) \| `null`      | sí          |
| `biggestWin`     | [RoundSummary](#roundsummary) \| `null`   | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "seasonId": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" },
    "seasons": {
      "type": "array",
      "items": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" }
    },
    "spins": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "bestStreak": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "series": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "spin": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
          "netWorth": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          }
        },
        "required": ["spin", "netWorth"],
        "additionalProperties": false
      }
    },
    "peakNetWorth": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "lowestNetWorth": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "loanMarks": {
      "type": "array",
      "items": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }
    },
    "recent": { "type": "array", "items": { "$ref": "#/$defs/RoundSummary" } },
    "mostFrequent": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "result": { "type": "integer", "minimum": 0, "maximum": 36 },
            "color": { "type": "string", "enum": ["red", "black", "green"] },
            "count": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 }
          },
          "required": ["result", "color", "count"],
          "additionalProperties": false
        },
        { "type": "null" }
      ]
    },
    "biggestWin": { "anyOf": [{ "$ref": "#/$defs/RoundSummary" }, { "type": "null" }] }
  },
  "required": [
    "seasonId",
    "seasons",
    "spins",
    "bestStreak",
    "series",
    "peakNetWorth",
    "lowestNetWorth",
    "loanMarks",
    "recent",
    "mostFrequent",
    "biggestWin"
  ],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:SeasonStats -->

<!-- BEGIN GENERATED common:BankEntry -->

### BankEntry

**BankEntry** (`bankEntrySchema`)

Una de estas variantes:

- `kind: "loan"`

  | Campo       | Tipo                                                                                                                                                                                                                                                                                                       | Obligatorio |
  | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
  | `kind`      | `"loan"`                                                                                                                                                                                                                                                                                                   | sí          |
  | `at`        | `string` (date-time, `/^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$/`) | sí          |
  | `amount`    | `integer` > 0                                                                                                                                                                                                                                                                                              | sí          |
  | `debtAfter` | `integer` ≥ 0                                                                                                                                                                                                                                                                                              | sí          |

- `kind: "interest"`

  | Campo       | Tipo                                                                                                                                                                                                                                                                                                       | Obligatorio |
  | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
  | `kind`      | `"interest"`                                                                                                                                                                                                                                                                                               | sí          |
  | `day`       | `string` (date, `/^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))$/`)                                                            | sí          |
  | `from`      | `string` (date-time, `/^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$/`) | sí          |
  | `to`        | `string` (date-time, `/^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$/`) | sí          |
  | `spins`     | `integer` > 0                                                                                                                                                                                                                                                                                              | sí          |
  | `amount`    | `integer` > 0                                                                                                                                                                                                                                                                                              | sí          |
  | `debtAfter` | `integer` ≥ 0                                                                                                                                                                                                                                                                                              | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "kind": { "type": "string", "const": "loan" },
        "at": {
          "type": "string",
          "format": "date-time",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
        },
        "amount": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
        "debtAfter": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }
      },
      "required": ["kind", "at", "amount", "debtAfter"],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "kind": { "type": "string", "const": "interest" },
        "day": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "from": {
          "type": "string",
          "format": "date-time",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
        },
        "to": {
          "type": "string",
          "format": "date-time",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
        },
        "spins": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
        "amount": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
        "debtAfter": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }
      },
      "required": ["kind", "day", "from", "to", "spins", "amount", "debtAfter"],
      "additionalProperties": false
    }
  ]
}
```

</details>

<!-- END GENERATED common:BankEntry -->

<!-- BEGIN GENERATED common:BankStatement -->

### BankStatement

**BankStatement** (`bankStatementSchema`)

| Campo          | Tipo                                      | Obligatorio |
| -------------- | ----------------------------------------- | ----------- |
| `seasonId`     | `string` (`/^\d{4}-(0[1-9]\|1[0-2])$/`)   | sí          |
| `seasons`      | `string` (`/^\d{4}-(0[1-9]\|1[0-2])$/`)[] | sí          |
| `balance`      | `integer`                                 | sí          |
| `debt`         | `integer` ≥ 0                             | sí          |
| `netWorth`     | `integer`                                 | sí          |
| `loans`        | `integer` ≥ 0                             | sí          |
| `nextInterest` | `integer` ≥ 0                             | sí          |
| `canBorrow`    | `boolean`                                 | sí          |
| `history`      | [BankEntry](#bankentry)[]                 | sí          |
| `truncated`    | `boolean`                                 | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "seasonId": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" },
    "seasons": {
      "type": "array",
      "items": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" }
    },
    "balance": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 },
    "debt": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "netWorth": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 },
    "loans": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "nextInterest": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "canBorrow": { "type": "boolean" },
    "history": { "type": "array", "items": { "$ref": "#/$defs/BankEntry" } },
    "truncated": { "type": "boolean" }
  },
  "required": [
    "seasonId",
    "seasons",
    "balance",
    "debt",
    "netWorth",
    "loans",
    "nextInterest",
    "canBorrow",
    "history",
    "truncated"
  ],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:BankStatement -->

<!-- BEGIN GENERATED common:LeaderboardRow -->

### LeaderboardRow

**LeaderboardRow** (`leaderboardRowSchema`)

| Campo           | Tipo                        | Obligatorio |
| --------------- | --------------------------- | ----------- |
| `login`         | `string` (1–39 car.)        | sí          |
| `avatarUrl`     | `string` (`/^https?:\/\//`) | sí          |
| `profileUrl`    | `string` (`/^https?:\/\//`) | sí          |
| `rank`          | `integer` > 0               | sí          |
| `netWorth`      | `integer`                   | sí          |
| `balance`       | `integer`                   | sí          |
| `debt`          | `integer`                   | sí          |
| `spins`         | `integer` ≥ 0               | sí          |
| `currentStreak` | `integer`                   | sí          |
| `bestStreak`    | `integer` ≥ 0               | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "login": { "type": "string", "minLength": 1, "maxLength": 39 },
    "avatarUrl": { "type": "string", "pattern": "^https?:\\/\\/" },
    "profileUrl": { "type": "string", "pattern": "^https?:\\/\\/" },
    "rank": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
    "netWorth": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 },
    "balance": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 },
    "debt": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 },
    "spins": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "currentStreak": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "bestStreak": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }
  },
  "required": [
    "login",
    "avatarUrl",
    "profileUrl",
    "rank",
    "netWorth",
    "balance",
    "debt",
    "spins",
    "currentStreak",
    "bestStreak"
  ],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:LeaderboardRow -->

<!-- BEGIN GENERATED common:HallOfRuinRow -->

### HallOfRuinRow

**HallOfRuinRow** (`hallOfRuinRowSchema`)

| Campo        | Tipo                        | Obligatorio |
| ------------ | --------------------------- | ----------- |
| `login`      | `string` (1–39 car.)        | sí          |
| `avatarUrl`  | `string` (`/^https?:\/\//`) | sí          |
| `profileUrl` | `string` (`/^https?:\/\//`) | sí          |
| `rank`       | `integer` > 0               | sí          |
| `netWorth`   | `integer`                   | sí          |
| `spins`      | `integer` ≥ 0               | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "login": { "type": "string", "minLength": 1, "maxLength": 39 },
    "avatarUrl": { "type": "string", "pattern": "^https?:\\/\\/" },
    "profileUrl": { "type": "string", "pattern": "^https?:\\/\\/" },
    "rank": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
    "netWorth": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 },
    "spins": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }
  },
  "required": ["login", "avatarUrl", "profileUrl", "rank", "netWorth", "spins"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:HallOfRuinRow -->

<!-- BEGIN GENERATED common:PublicGameConfig -->

### PublicGameConfig

**PublicGameConfig** (`publicGameConfigSchema`)

| Campo             | Tipo                       | Obligatorio |
| ----------------- | -------------------------- | ----------- |
| `startingBalance` | `integer` > 0              | sí          |
| `chips`           | `integer` > 0[]            | sí          |
| `allIn`           | `boolean`                  | sí          |
| `maxBetsPerRound` | `integer`                  | sí          |
| `loan`            | `object` (ver JSON Schema) | sí          |
| `jackpot`         | `object` (ver JSON Schema) | sí          |
| `minSpinMs`       | `integer`                  | sí          |
| `colorWarningAt`  | `integer`                  | sí          |
| `seasonTimeZone`  | `string`                   | sí          |
| `seasonStartDay`  | `integer` 1–28             | sí          |
| `pendingSpins`    | `object` (ver JSON Schema) | sí          |
| `bigWin`          | `object` (ver JSON Schema) | sí          |
| `onFireAt`        | `integer` ≥ 2              | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "startingBalance": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
    "chips": {
      "type": "array",
      "items": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 }
    },
    "allIn": { "type": "boolean" },
    "maxBetsPerRound": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "loan": {
      "type": "object",
      "properties": {
        "amount": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
        "displayApr": { "type": "number" },
        "interestPerSpin": { "type": "number" }
      },
      "required": ["amount", "displayApr", "interestPerSpin"],
      "additionalProperties": false
    },
    "jackpot": {
      "type": "object",
      "properties": { "gitPushMultiplier": { "type": "number" } },
      "required": ["gitPushMultiplier"],
      "additionalProperties": false
    },
    "minSpinMs": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 },
    "colorWarningAt": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "seasonTimeZone": { "type": "string" },
    "seasonStartDay": { "type": "integer", "minimum": 1, "maximum": 28 },
    "pendingSpins": {
      "type": "object",
      "properties": {
        "max": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
        "quickSpinMs": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }
      },
      "required": ["max", "quickSpinMs"],
      "additionalProperties": false
    },
    "bigWin": {
      "type": "object",
      "properties": {
        "minNetMultiple": { "type": "number", "minimum": 1 },
        "megaNetMultiple": { "type": "number", "minimum": 1 }
      },
      "required": ["minNetMultiple", "megaNetMultiple"],
      "additionalProperties": false
    },
    "onFireAt": { "type": "integer", "minimum": 2, "maximum": 9007199254740991 }
  },
  "required": [
    "startingBalance",
    "chips",
    "allIn",
    "maxBetsPerRound",
    "loan",
    "jackpot",
    "minSpinMs",
    "colorWarningAt",
    "seasonTimeZone",
    "seasonStartDay",
    "pendingSpins",
    "bigWin",
    "onFireAt"
  ],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:PublicGameConfig -->

<!-- BEGIN GENERATED common:ErrorResponse -->

### ErrorResponse

**ErrorResponse** (`errorResponseSchema`)

| Campo     | Tipo                                                                                                                                                                                                                                                                                                | Obligatorio |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `v`       | `1`                                                                                                                                                                                                                                                                                                 | sí          |
| `error`   | `"invalid_request"` \| `"unauthorized"` \| `"forbidden"` \| `"not_found"` \| `"conflict"` \| `"rate_limited"` \| `"payload_too_large"` \| `"insufficient_funds"` \| `"too_many_bets"` \| `"invalid_bet"` \| `"loan_not_allowed"` \| `"protocol_mismatch"` \| `"github_unavailable"` \| `"internal"` | sí          |
| `message` | `string` (0–500 car.)                                                                                                                                                                                                                                                                               | sí          |

<details><summary>JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "v": { "type": "number", "const": 1 },
    "error": {
      "type": "string",
      "enum": [
        "invalid_request",
        "unauthorized",
        "forbidden",
        "not_found",
        "conflict",
        "rate_limited",
        "payload_too_large",
        "insufficient_funds",
        "too_many_bets",
        "invalid_bet",
        "loan_not_allowed",
        "protocol_mismatch",
        "github_unavailable",
        "internal"
      ]
    },
    "message": { "type": "string", "maxLength": 500 }
  },
  "required": ["v", "error", "message"],
  "additionalProperties": false
}
```

</details>

<!-- END GENERATED common:ErrorResponse -->
