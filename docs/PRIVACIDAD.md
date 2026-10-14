# Privacidad · Privacy

[Español](#español) · [English](#english)

Esta política describe la instancia oficial, **https://vibe.aimar.dev**. Es la versión larga de la página [`/privacy`](https://vibe.aimar.dev/privacy) de la web. Las instancias autoalojadas las gestiona quien las aloja ([SELF-HOSTING.md](SELF-HOSTING.md#privacidad-de-tu-instancia)).

La página `/privacy` de cada instancia no da por hecho que sea la oficial: quién la opera, dónde está alojada, el proxy de red que tiene delante, el contacto y los días que se guardan las copias salen del bloque `instance` de `config/site.json`, y de dónde se cargan los avatares y cuánto duran las sesiones, del `.env` del servidor (`CSP_IMG_ORIGINS`, `*_TTL_SECONDS`). En la oficial son los valores de este documento.

---

## Español

**Resumen:** vibe-gambling no sabe nada de tu trabajo. Guarda tu usuario y tu avatar de GitHub y tus partidas de mentira, para que el juego funcione. Nada de analíticas, anuncios ni cookies de seguimiento. Puedes borrarlo todo con un comando.

### Responsable

Aimar ([github.com/Aimarmndz](https://github.com/Aimarmndz)), que gestiona la instancia oficial a título personal.

### Qué sale de tu ordenador

En cada turno de Claude Code, el plugin envía **solo**:

| Se envía                                                                     | No se envía nunca                                         |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| Un identificador de turno aleatorio (lo genera el plugin)                    | Tus prompts ni las respuestas de Claude                   |
| La duración del turno                                                        | Código, diffs ni contenido de archivos                    |
| `gitPushOk`: sí/no (hubo un `git push` con éxito)                            | Las órdenes que se ejecutan ni su salida                  |
| `testFailed`: sí/no (falló un comando de tests)                              | Rutas, nombres de archivo, de carpetas ni de repositorios |
| La versión del plugin y el SO genérico (`linux`, `darwin`, `win32`, `other`) | Tu nombre de usuario del sistema, variables de entorno    |
| Tu token de sesión (para saber quién eres)                                   | El identificador interno de la sesión de Claude Code      |

Los dos sí/no se calculan **en tu ordenador** mirando las órdenes de Bash, que después se olvidan. Además, cuando usas un comando se envía lo que escribes en él (la cantidad y la casilla de `/bet`, el código de `/vibe-redeem`, el objeto de `/vibe-shop buy` y `/vibe-use`, tu login al confirmar `/vibe-delete-account`). Un test del plugin (`packages/mod/tests/privacy.test.ts`) falla si cualquier petición lleva algo más.

### Qué se guarda y para qué

| Dato                                                                                                                                                                                                       | Para qué                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| De GitHub: id numérico, login y URL del avatar                                                                                                                                                             | Identificarte y mostrarte en el ranking                                                                                                                                                                                                                              |
| De GitHub: fecha de creación de tu cuenta de GitHub (`created_at` del perfil público, se actualiza en cada login)                                                                                          | Antiabuso del ranking (abajo)                                                                                                                                                                                                                                        |
| Tus ajustes: oculto o no en el ranking, idioma, tapete y fichas                                                                                                                                            | Respetar tus preferencias                                                                                                                                                                                                                                            |
| El juego: cartera de cada temporada, rondas y turnos (cuándo empezó y terminó cada uno, resultado, apuestas, duración del turno y los dos sí/no), préstamos, rachas, logros conseguidos, Salón de la Ruina | Que el juego funcione y el ranking                                                                                                                                                                                                                                   |
| Sesiones: el **hash** de cada token, su tipo (plugin o ventana) y fechas de uso y caducidad                                                                                                                | Mantenerte con la sesión iniciada                                                                                                                                                                                                                                    |
| TIENDA: qué compraste y cuándo (con su precio), tu bolsillo de la temporada (cargas y si están armadas), tus cosméticos y lo que hizo cada objeto en cada tirada                                           | Que funcione la tienda, sus topes por temporada y el Placebómetro. Los consumibles caducan con la temporada; las compras y los cosméticos se quedan hasta que borres tu cuenta. Nada de esto es público, salvo el asterisco de una racha salvada por el casco (`7*`) |
| Programa de afiliados: tu código (aleatorio) y, si canjeas uno o alguien canjea el tuyo, quién invitó a quién, cuándo, el bono de bienvenida y la comisión                                                 | Que funcione el programa de afiliados y su antiabuso (abajo)                                                                                                                                                                                                         |

**No se guarda:** el token de GitHub (se descarta nada más leer tu perfil; el login no pide ningún permiso, solo el perfil público), la versión del plugin ni el SO (se comprueban y se tiran), tu IP (solo se usa en memoria durante un minuto para el límite de peticiones), si la ventana está a la vista o en segundo plano (solo en memoria mientras está conectada, para decidir si un prompt se juega en directo o se guarda como tirada pendiente), ni ninguna URL, cabecera o token en los logs.

### Base legal (RGPD, art. 6)

- **Ejecución del servicio que pides** (art. 6.1.b) al iniciar sesión: la cuenta, las partidas y el ranking son el juego.
- **Interés legítimo** (art. 6.1.f) en mantenerlo seguro: límites de peticiones, copias de seguridad, logs sin datos personales.

### Ranking público

Por defecto apareces en el ranking público con tu login, tu avatar y tus estadísticas; te lo avisamos al iniciar sesión. Ocúltate cuando quieras con `/vibe-hide` (o desde los ajustes de la ventana): desapareces del ranking y del Salón de la Ruina, también de temporadas pasadas. `/vibe-show` te vuelve a mostrar.

**Cuentas de GitHub nuevas.** Para que no compense crear cuentas en masa para inflar el ranking, una cuenta de GitHub con menos de **30 días** (`leaderboard.minAccountAgeDays` en `config/game.json`) juega con normalidad, pero no sale en el ranking ni en el Salón de la Ruina hasta cumplirlos; al iniciar sesión, la ventana y `/balance` te dicen desde qué día. Es el único uso de la fecha de creación de tu cuenta de GitHub, que se guarda hasta que borres tu cuenta. Las cuentas que ya existían antes de esta regla no tienen el dato hasta su próximo login y, mientras tanto, cuentan como antiguas.

### Programa de afiliados

Si pides tu enlace de afiliado (`/vibe-invite` o la pantalla AFILIADOS), se te crea un código aleatorio que no dice nada de ti. Si canjeas el código de otra persona (`/vibe-redeem`), se guarda quién invitó a quién, cuándo, el bono de bienvenida y, cuando te activas, la comisión que se le paga. Solo sirve para que el programa funcione y para sus reglas antiabuso (un código por cuenta, sin ciclos, un tope de comisiones por temporada). La página de invitación `/r/<código>` enseña el login y el avatar de quien la comparte, **salvo si está oculto** del ranking (entonces dice "alguien te ha invitado"). Quien te invitó solo ve números (cuántos invitados y activados), nunca quién eres.

Al borrar tu cuenta se borra tu lado de cada invitación: la fila que queda ya no es de nadie y solo sigue contando para el tope de comisiones de la temporada de la otra persona (si no, borrar y volver a crear una cuenta daría comisiones sin fin); si no queda ninguno de los dos lados, se borra.

### Dónde

En una VPS de **IONOS en la Unión Europea**. Intervienen también, como proveedores:

- **Cloudflare**, que hace de proxy de red de `vibe.aimar.dev` (ve tu IP y las peticiones al pasar, como cualquier CDN; no recibe nada más del servidor).
- **GitHub**, donde inicias sesión (con su propia política) y desde donde tu navegador carga los avatares del ranking (`avatars.githubusercontent.com`).

No hay ningún otro tercero: ni analíticas, ni anuncios, ni venta ni cesión de datos.

### Cookies y almacenamiento del navegador

Una sola cookie, **de sesión** (`HttpOnly`, `Secure`, `SameSite=Strict`), para que la ventana sepa quién eres; dura 30 días o hasta que cierras sesión. Tus preferencias de la ventana (sonido, filtro CRT, calidad, idioma) se quedan en el almacenamiento local de **tu** navegador y no salen de él. Ninguna cookie de seguimiento.

### Cuánto tiempo

| Dato                                     | Plazo                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Cuenta, partidas y Salón de la Ruina     | Hasta que borres tu cuenta                                             |
| Fecha de creación de tu cuenta de GitHub | Hasta que borres tu cuenta (se reescribe en cada login)                |
| Sesión del plugin / de la ventana        | 1 año / 30 días desde el login, o hasta cerrar sesión; luego se borran |
| Enlace para abrir la ventana             | 60 segundos y un solo uso; luego se borra                              |
| Login de GitHub a medias                 | Hasta que termina o caduca (~15 min); luego se borra                   |
| Canjes de afiliado                       | Hasta que borres tu cuenta (tu lado se borra; ver arriba)              |
| Copias de seguridad                      | 14 días: una cuenta borrada puede seguir en ellas hasta entonces       |
| Logs del servidor (sin datos personales) | Rotados por tamaño                                                     |

### Tus derechos y cómo borrar la cuenta

- **Borrar la cuenta**: `/vibe-delete-account <tu-login>` en Claude Code. Se borra **todo** lo tuyo al momento (sesiones, partidas, apuestas, préstamos, logros, Salón de la Ruina, la fecha de creación de tu cuenta de GitHub, tu código de afiliado y tu lado de cada invitación) y se cierran tus ventanas.
- **Oponerte al ranking público**: `/vibe-hide`.
- **Acceder a tus datos**: `/balance` y la ventana enseñan lo que hay; para una copia completa, pídela (abajo).
- **Rectificar**: tu login, tu avatar y la fecha de creación de tu cuenta se actualizan desde GitHub cada vez que inicias sesión.
- Si crees que algo no se ha hecho bien, puedes reclamar ante la **Agencia Española de Protección de Datos** ([aepd.es](https://www.aepd.es/)).

### Contacto

Por GitHub: abre una [issue](https://github.com/Aimarmndz/vibe-gambling/issues) en el repositorio (sin datos personales; si hace falta, pide un canal privado) o escribe a [@Aimarmndz](https://github.com/Aimarmndz).

---

## English

**Summary:** vibe-gambling knows nothing about your work. It stores your GitHub login and avatar and your fake games, so the game works. No analytics, no ads, no tracking cookies. You can delete everything with one command.

### Controller

Aimar ([github.com/Aimarmndz](https://github.com/Aimarmndz)), who runs the official instance as an individual.

### What leaves your computer

On every Claude Code turn, the plugin sends **only**:

| Sent                                                                        | Never sent                                   |
| --------------------------------------------------------------------------- | -------------------------------------------- |
| A random turn id (generated by the plugin)                                  | Your prompts or Claude's answers             |
| The turn duration                                                           | Code, diffs or file contents                 |
| `gitPushOk`: yes/no (a `git push` succeeded)                                | The commands that run or their output        |
| `testFailed`: yes/no (a test command failed)                                | Paths, file, folder or repository names      |
| The plugin version and the generic OS (`linux`, `darwin`, `win32`, `other`) | Your system user name, environment variables |
| Your session token (so the server knows who you are)                        | Claude Code's internal session id            |

Both yes/no flags are computed **on your computer** by looking at Bash commands, which are then forgotten. When you use a command, what you type in it is sent too (the amount and square of `/bet`, the code of `/vibe-redeem`, the item of `/vibe-shop buy` and `/vibe-use`, your login when confirming `/vibe-delete-account`). A plugin test (`packages/mod/tests/privacy.test.ts`) fails if any request carries anything else.

### What is stored and why

| Data                                                                                                                                                                                | Why                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| From GitHub: numeric id, login and avatar URL                                                                                                                                       | To identify you and show you on the leaderboard                                                                                                                                                                                               |
| From GitHub: the date your GitHub account was created (`created_at` of the public profile, refreshed at every login)                                                                | Leaderboard anti-abuse (below)                                                                                                                                                                                                                |
| Your settings: hidden from the leaderboard or not, language, felt and chips                                                                                                         | To respect your preferences                                                                                                                                                                                                                   |
| The game: wallet per season, rounds and turns (when each one started and ended, result, bets, turn duration and the two flags), loans, streaks, unlocked achievements, Hall of Ruin | To run the game and the leaderboard                                                                                                                                                                                                           |
| Sessions: the **hash** of each token, its kind (plugin or window), usage and expiry dates                                                                                           | To keep you logged in                                                                                                                                                                                                                         |
| SHOP: what you bought and when (and its price), your pocket for the season (charges and whether they are armed), your cosmetics and what each item did on each spin                 | To run the shop, its per-season limits and the Placebometer. Consumables expire with the season; purchases and cosmetics stay until you delete your account. None of it is public, except the asterisk on a streak saved by the helmet (`7*`) |
| Affiliate program: your code (random) and, if you redeem one or someone redeems yours, who invited whom, when, the welcome bonus and the commission                                 | To run the affiliate program and its anti-abuse rules (below)                                                                                                                                                                                 |

**Not stored:** the GitHub token (thrown away right after reading your profile; login asks for no permissions, only the public profile), the plugin version or the OS (checked and dropped), your IP (only kept in memory for a minute for rate limiting), whether the game window is visible or in the background (only in memory while it is connected, to decide if a prompt is played live or saved as a pending spin), and no URLs, headers or tokens in the logs.

### Legal basis (GDPR, art. 6)

- **Providing the service you ask for** (art. 6.1.b) when you log in: the account, the games and the leaderboard are the game.
- **Legitimate interest** (art. 6.1.f) in keeping it secure: rate limits, backups, logs without personal data.

### Public leaderboard

By default you appear on the public leaderboard with your login, avatar and stats; you are told so when you log in. Hide any time with `/vibe-hide` (or in the window settings): you disappear from the leaderboard and the Hall of Ruin, past seasons included. `/vibe-show` brings you back.

**New GitHub accounts.** So that mass-creating accounts to inflate the leaderboard is not worth it, a GitHub account younger than **30 days** (`leaderboard.minAccountAgeDays` in `config/game.json`) plays as usual but does not appear on the leaderboard or in the Hall of Ruin until it turns 30 days old; at login, the window and `/balance` tell you from which day. That is the only use of your GitHub account's creation date, which is kept until you delete your account. Accounts that existed before this rule do not have the date until their next login and, meanwhile, count as old.

### Affiliate program

If you ask for your affiliate link (`/vibe-invite` or the AFFILIATES screen), a random code is created for you; it says nothing about you. If you redeem someone else's code (`/vibe-redeem`), the server stores who invited whom, when, the welcome bonus and, once you activate, the commission paid to them. It is only used to run the program and its anti-abuse rules (one code per account, no cycles, a cap on commissions per season). The invite page `/r/<code>` shows the login and avatar of whoever shares it, **unless they are hidden** from the leaderboard (then it says "someone invited you"). Whoever invited you only sees numbers (how many invited and activated), never who you are.

When you delete your account, your side of every invite is erased: the remaining row belongs to nobody and only keeps counting towards the other person's seasonal commission cap (otherwise deleting and re-creating an account would mean endless commissions); if neither side is left, it is deleted.

### Where

On an **IONOS** VPS in the **European Union**. Also involved, as providers:

- **Cloudflare**, the network proxy in front of `vibe.aimar.dev` (it sees your IP and the requests passing through, like any CDN; it gets nothing else from the server).
- **GitHub**, where you log in (under its own policy) and from where your browser loads the leaderboard avatars (`avatars.githubusercontent.com`).

No other third parties: no analytics, no ads, no data sold or shared.

### Cookies and browser storage

One **session** cookie (`HttpOnly`, `Secure`, `SameSite=Strict`) so the window knows who you are; it lasts 30 days or until you log out. Your window preferences (sound, CRT filter, quality, language) stay in **your** browser's local storage and never leave it. No tracking cookies.

### For how long

| Data                                | Retention                                                       |
| ----------------------------------- | --------------------------------------------------------------- |
| Account, games and Hall of Ruin     | Until you delete your account                                   |
| Your GitHub account's creation date | Until you delete your account (rewritten at every login)        |
| Plugin / window session             | 1 year / 30 days from login, or until you log out; then deleted |
| Link that opens the window          | 60 seconds, single use; then deleted                            |
| Unfinished GitHub login             | Until it finishes or expires (~15 min); then deleted            |
| Affiliate invites                   | Until you delete your account (your side is erased; see above)  |
| Backups                             | 14 days: a deleted account may remain in them until then        |
| Server logs (no personal data)      | Rotated by size                                                 |

### Your rights and deleting your account

- **Delete your account**: `/vibe-delete-account <your-login>` in Claude Code. **Everything** about you is deleted at once (sessions, games, bets, loans, achievements, Hall of Ruin, your GitHub account's creation date, your affiliate code and your side of every invite) and your windows are closed.
- **Object to the public leaderboard**: `/vibe-hide`.
- **Access your data**: `/balance` and the window show what there is; ask (below) for a full copy.
- **Rectification**: your login, avatar and account creation date are refreshed from GitHub every time you log in.
- If you think something was not handled properly, you can complain to a data protection authority (in Spain, the [AEPD](https://www.aepd.es/)).

### Contact

Through GitHub: open an [issue](https://github.com/Aimarmndz/vibe-gambling/issues) in the repository (no personal data; ask for a private channel if needed) or write to [@Aimarmndz](https://github.com/Aimarmndz).
