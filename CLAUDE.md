# vibe-gambling — reglas del proyecto

Este archivo **añade y anula** reglas de `~/dev/CLAUDE.md`. La especificación completa está en `.plan/` (local, nunca se sube): empieza por `.plan/00-INDICE.md`.

## Configuración: nada hardcodeado (regla absoluta)

- **Ningún valor configurable puede estar escrito en el código**: URLs, dominios, puertos, credenciales, `client_id`, orígenes, rangos de IP, timeouts, intervalos, límites de rate limit, zona horaria, saldo inicial, valores de las fichas, TAE del préstamo, multiplicadores, textos de marca, etc.
- Todo sale de **variables de entorno** (`.env`) o de **archivos de configuración** versionados (`config/*.json` / `*.yaml`), leídos en un único módulo de configuración por paquete y **validados con zod al arrancar**. Si falta algo obligatorio, el proceso falla con un error claro; nunca arranca con un valor inventado.
- Cada variable está documentada en un `.env.example` (sin secretos reales) con su descripción y su valor de ejemplo.
- La web recibe su configuración en tiempo de ejecución (p. ej. `/config.json` servido por el servidor, o variables `VITE_*` solo para lo que sea de build), nunca con valores escritos a mano en el bundle.
- El plugin de Claude Code toma la URL del servidor y sus opciones de la configuración del plugin (`userConfig` / manifiesto), no de constantes del código.
- Las únicas constantes permitidas en el código son las que forman parte de la lógica y no tienen sentido configurar (p. ej. las 37 casillas y el orden del cilindro europeo, o los pagos oficiales de cada apuesta).
- Los tests usan su propia configuración de test, nunca valores incrustados en el código de producción.

## Despliegue

- **La instancia oficial está desplegada** en la VPS con Noust (`docs/DESPLIEGUE.md`, sección 16), por decisión de Aimar. **No se despliega ni se toca la VPS sin su permiso explícito**: el desarrollo y las pruebas se hacen **en local** (Docker Compose, Postgres local, el mod con `--plugin-dir`).
- Aun así, el proyecto debe quedar **listo para desplegarlo fácilmente** después: imagen Docker, compose de producción, `.env.example` de producción y `docs/DESPLIEGUE.md` paso a paso, de modo que desplegar sea copiar el `.env`, ejecutar un comando y añadir el sitio al reverse proxy existente.
- Contexto de producción (solo para la documentación): `https://vibe.aimar.dev`, detrás del proxy de Cloudflare, en una VPS compartida que ya sirve `aimar.dev` con su propio reverse proxy.

## Anulaciones de `~/dev/CLAUDE.md`

- **Stack**: no hay Next.js, Tailwind ni Server Actions. Es Fastify + `@fastify/websocket` + Drizzle/Postgres (servidor), Vite + Three.js (web) y un plugin de Claude Code (mod), en un monorepo pnpm.
- **Idioma de la UI**: inglés y español con i18n (inglés por defecto), no solo español.
- Se mantiene todo lo demás: código e identificadores en inglés; comentarios y commits en español (Conventional Commits, imperativo, `git commit -s`); servidor como única autoridad; zod en todas las entradas; Prettier; nunca secretos en el repo.

## Git

- Identidad personal Aimarmndz (`~/dev`). Remoto `git@github.com:Aimarmndz/vibe-gambling.git`, rama `main`.
- Nunca trailers `Co-Authored-By`.
- Nunca hacer push, tocar el repo de GitHub, tocar la VPS ni publicar nada sin permiso explícito de Aimar.
