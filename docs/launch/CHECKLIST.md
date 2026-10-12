# Checklist de lanzamiento

Para Aimar. **Nada de esto está hecho**: todo lo que toca GitHub, la VPS o publica algo necesita que lo hagas tú (o que des permiso explícito). Los textos de los posts están en [POSTS.en.md](POSTS.en.md) y [POSTS.es.md](POSTS.es.md); el guion del vídeo en [VIDEO-30S.md](VIDEO-30S.md).

## 1. Antes del primer push

- [ ] `git log --format='%an <%ae>%n%(trailers:key=Signed-off-by)' | sort -u`: solo tu identidad personal (Aimarmndz), todos los commits con `Signed-off-by` y ningún `Co-Authored-By`.
- [ ] Nada que no deba subir: `git ls-files | grep -E '(^|/)\.env$|^\.plan/|\.(pem|key)$'` no devuelve nada.
- [ ] Todo en verde en local: `pnpm lint`, `pnpm typecheck`, `pnpm test`, integración del servidor y E2E.
- [ ] `docs/demo.gif` grabado (el README ya lo enlaza) y `docs/launch/social-preview.png` (1280×640) hecho.
- [ ] Push inicial a `git@github.com:Aimarmndz/vibe-gambling.git` (rama `main`). Con el repo aún privado.
- [ ] El CI pasa en GitHub (incluida la matriz del mod en Linux, macOS y Windows).

## 2. Ajustes del repositorio

- [ ] **About** (rueda dentada de la portada del repo):
  - Description: `🎰 Every prompt is a spin. A PS1-style roulette that pops up while Claude Code thinks. Fake coins, real addiction (not really). Global leaderboard of the most broke devs.`
  - Website: `https://vibe.aimar.dev`
  - Topics: `claude-code` `claude-code-plugin` `roulette` `psx` `ps1-graphics` `threejs` `retro` `shitpost` `parody` `gambling-parody` `fastify` `typescript` `webgl`
- [ ] **Social preview**: _Settings → General → Social preview_ → subir `docs/launch/social-preview.png`.
- [ ] **Labels** que usan las plantillas de issues y Dependabot (`bug`, `enhancement` y `good first issue` ya existen por defecto):

  ```sh
  gh label create triage       --color FBCA04 --description "Needs a first look"
  gh label create phrase       --color F2C14E --description "New gambler phrase"
  gh label create dependencies --color 0366D6 --description "Dependency updates"
  gh label create ci           --color 5319E7 --description "GitHub Actions"
  gh label create docker       --color 1D63ED --description "Docker images"
  ```

- [ ] **Security** (_Settings → Code security_): activar **Private vulnerability reporting** (lo enlazan `SECURITY.md` y la plantilla de issues), Dependabot alerts y security updates, secret scanning y push protection.
- [ ] **Rama `main`**: el ruleset «Protege main» ya prohíbe borrarla y el force-push. Si se quiere exigir el CI en verde, añadir los checks obligatorios con _bypass_ para el rol admin (si no, bloquea los push directos); con eso `dependabot-automerge.yml` usa el auto-merge nativo de GitHub sin cambiar nada. Opcional: instalar la GitHub App **DCO** para comprobar el `Signed-off-by` de los PRs.
- [ ] **Entorno `production`** y los secrets de `deploy.yml` (lista en [DESPLIEGUE.md §13](../DESPLIEGUE.md#13-actualizaciones)).

## 3. Producción

- [ ] Crear la **OAuth App de GitHub** con _Enable Device Flow_ ([DESPLIEGUE.md §6](../DESPLIEGUE.md#6-la-oauth-app-de-github)) y apuntar el Client ID.
- [ ] Preparar la VPS: Docker, usuario `deploy`, firewall de Cloudflare, certificado de origen y `.env` ([DESPLIEGUE.md](../DESPLIEGUE.md), secciones 1 a 7).
- [ ] Etiqueta **`v0.1.0`** ([RELEASING.md](../RELEASING.md#la-primera-versión-v010)): `pnpm release 0.1.0 --dry-run`, `pnpm release 0.1.0` y `git push --atomic origin main v0.1.0`. Esperar a que `release.yml` publique `ghcr.io/aimarmndz/vibe-gambling:0.1.0` y la GitHub Release con sus artefactos. Si el repo ya es público, salen con atestaciones; si no, relanzar el workflow después de hacerlo público.
- [ ] Hacer **público el paquete** de GHCR (_tu perfil → Packages → vibe-gambling → Package settings → Change visibility_) y comprobar que está enlazado al repo.
- [ ] Desplegar (`docker compose pull && docker compose up -d`), añadir `vibe.aimar.dev` al reverse proxy y pasar la [comprobación final](../DESPLIEGUE.md#11-comprobación-final).
- [ ] Copias de seguridad con cron y una restauración de prueba ([DESPLIEGUE.md §12](../DESPLIEGUE.md#12-copias-de-seguridad)).
- [ ] Monitor de uptime contra `https://vibe.aimar.dev/healthz`.

## 4. Hacerlo público

- [ ] **Hacer público el repo** (_Settings → General → Danger Zone → Change visibility_).
- [ ] Justo después, en _Settings → Code security_: activar **secret scanning** y **push protection** (gratis en repos públicos) y comprobar que **CodeQL** (`codeql.yml`) pasa de `skipped` a ejecutarse: lanzarlo a mano (_Actions → CodeQL → Run workflow_) y revisar _Security → Code scanning_. No activar el «default setup» de CodeQL: choca con el workflow avanzado.
- [ ] Probar la instalación de verdad, en un Claude Code limpio: `/plugin install vibe-gambling --marketplace Aimarmndz/vibe-gambling` → `/vibe-login` → un prompt → la ventana se abre y la bola cae. Con el repo privado este paso falla: hazlo justo después de publicarlo.
- [ ] **Release v0.1.0**: la crea `release.yml` con las notas del CHANGELOG, los artefactos y la verificación. Editarla (_Releases → v0.1.0 → Edit_) para el anuncio: título `v0.1.0 — Every prompt is a spin`, el GIF (`docs/demo.gif`) arriba, "Fake coins only" y el enlace a `https://vibe.aimar.dev` (relanzar el workflow vuelve a escribir las notas).
- [ ] **Fijar** el repo en tu perfil (_tu perfil → Customize your pins_), junto a scan2nas.
- [ ] En el README de tu perfil (`Aimarmndz/aimarmndz`), una línea con el enlace.
- [ ] Ponerle **descripción a scan2nas** en GitHub (ahora está vacía y el README de vibe-gambling lo enlaza): `Preset-based document scanning for Epson scanners on Linux, straight to your NAS (CLI + Qt app).`

## 5. Publicar los posts

Orden sugerido: Show HN primero (entre semana, por la mañana en EE. UU.), r/ClaudeAI y Twitter/X el mismo día, r/ProgrammerHumor al día siguiente con el GIF.

- [ ] **Show HN** ([POSTS.en.md](POSTS.en.md#show-hn)). Quédate un par de horas contestando comentarios: las preguntas técnicas (privacidad, Device Flow, el pipeline PS1) son la mejor publicidad.
- [ ] **r/ClaudeAI** (EN) con la _flair_ de proyecto que pidan las normas del subreddit en ese momento.
- [ ] **r/ProgrammerHumor** (EN): post de imagen/vídeo con el GIF; el enlace al repo en un comentario si las normas no dejan enlaces en el post.
- [ ] **Twitter/X**: el hilo en inglés y, si quieres, el de español.
- [ ] Opcional en español: el post de [POSTS.es.md](POSTS.es.md) en tus redes o comunidades hispanohablantes.
- [ ] El vídeo de 30 s ([VIDEO-30S.md](VIDEO-30S.md)) como adjunto en Twitter/X y Reddit.

## 6. Después

- [ ] Mirar el uptime, los logs (`docker compose logs server`) y los 429 las primeras horas.
- [ ] Contestar issues, etiquetar las frases nuevas con `phrase` y `good first issue`.
- [ ] Si algo de privacidad o seguridad sale en los comentarios, contestarlo con enlaces a [PRIVACIDAD.md](../PRIVACIDAD.md) y [SECURITY.md](../../SECURITY.md).
