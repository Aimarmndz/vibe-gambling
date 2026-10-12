# Cómo se publica una versión

vibe-gambling tiene **una sola versión** para todo el proyecto: el plugin de Claude Code, el servidor, la web y la imagen Docker salen juntos con el mismo número. Esta guía explica cómo se saca una versión, qué hace el CI con ella y cómo comprobar lo publicado.

Resumen para quien ya lo ha hecho otras veces:

```sh
pnpm release --draft                 # 1. borrador de las notas desde los commits
#                                      → revisarlo y escribirlo en inglés bajo [Unreleased]
pnpm release minor --dry-run         # 2. ensayo: no toca nada
pnpm release minor                   # 3. commit «chore(release): vX.Y.Z» + etiqueta, en local
git push --atomic origin main vX.Y.Z # 4. publicar: el CI hace el resto
```

## Política de versiones

Se sigue [SemVer 2.0](https://semver.org/lang/es/). La pregunta para elegir el número es siempre la misma: **¿qué le pasa a quien tiene instalada la versión anterior?**

| Cambio                                                                                                                                                                                           | 0.x (ahora) | Desde 1.0 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | --------- |
| Sube la **versión del protocolo** (`PROTOCOL_VERSION` de `packages/shared`, el campo `v` de cada mensaje): los plugins antiguos reciben `protocol_mismatch` y dejan de funcionar con el servidor | **minor**   | **major** |
| Cambio incompatible en la configuración (`.env`, `config/*.json`) o una migración que exige pasos a mano                                                                                         | **minor**   | **major** |
| Funcionalidad nueva compatible: un comando, una opción con valor por defecto, un campo **opcional** en el protocolo, una migración aditiva                                                       | minor       | minor     |
| Arreglos, rendimiento, textos, traducciones, dependencias                                                                                                                                        | patch       | patch     |
| Solo documentación, tests o CI                                                                                                                                                                   | sin versión | —         |

- **0.x mientras el protocolo pueda cambiar.** En 0.x un cambio incompatible sube la **minor** (0.1 → 0.2) y todo lo demás la patch, como permite SemVer para las versiones iniciales. La **1.0.0** llegará cuando el protocolo `v1` se dé por estable; a partir de ahí, cambiar `v` es siempre una **major**.
- La versión del protocolo **no** es la del proyecto: es un entero que solo cambia cuando un cliente antiguo ya no puede hablar con el servidor nuevo. El servidor la publica en `/api/meta` (`protocol`) junto a su versión (`serverVersion`), y el mod la comprueba al cambiar de servidor. Las notas de cada release dicen qué protocolo hablan.
- **Pre-releases** (`0.2.0-rc.0`, `1.0.0-beta.1`): para probar la imagen y los artefactos antes de anunciar. Se publican como _pre-release_ en GitHub y no mueven la etiqueta `latest` de la imagen. Ojo: el marketplace sirve el plugin desde `main`, así que una `-rc` etiquetada en `main` también llega a quien actualice el plugin; para probar el mod sin eso, usa el zip con `claude --plugin-dir`.
- **Nunca se reutiliza un número.** Si una versión sale mal, se publica la siguiente patch; no se borran etiquetas empujadas.

## Dónde vive la versión

La versión está en estos archivos y tiene que ser la misma en todos. `pnpm lint:versions` (dentro de `pnpm lint` y en el CI) falla si alguno se desincroniza; `pnpm release` los cambia todos a la vez.

| Archivo                                                | Para qué se usa                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json` (raíz)                                  | La referencia; el SBOM y los artefactos toman la versión de aquí                                                                     |
| `packages/*/package.json`                              | La del servidor se empaqueta en el build y es la que devuelve `/api/meta`                                                            |
| `packages/mod/.claude-plugin/plugin.json`              | La que ve Claude Code y la que el mod manda en cada turno (`pluginVersion`)                                                          |
| `.claude-plugin/marketplace.json` (`metadata.version`) | La del marketplace; las entradas de plugin no la repiten (manda la de `plugin.json`)                                                 |
| `packages/mod/hooks/generated/manifest.ts`             | Copia **generada** de la versión y los valores por defecto de `plugin.json` (`pnpm sync:mod`): el mod no lee su manifiesto del disco |
| `CHANGELOG.md`                                         | Tiene que tener una sección `## [X.Y.Z]` con contenido para la versión actual                                                        |

## Paso a paso

### 0. Antes de empezar

- Estar en `main`, al día con `origin/main` (`git pull --ff-only`), con el árbol limpio y el CI en verde en ese commit.
- Tener la firma de commits y etiquetas configurada como para cualquier otro commit del repo (DCO: el script hace el commit con `--signoff`; si tienes `commit.gpgSign`/`tag.gpgSign`, git firma también).

### 1. Escribir las notas

Las notas de cada versión son su sección de `CHANGELOG.md`, en **inglés** y en formato [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Hay dos formas de llenarlas:

- **Recomendada**: `pnpm release --draft` imprime las entradas agrupadas desde la última etiqueta, a partir de los Conventional Commits (`feat` → _Added_, `fix` → _Fixed_, `perf`/`refactor`/`revert` → _Changed_, `fix(security)` → _Security_, `!` o `BREAKING CHANGE:` → **Breaking**; `docs`, `test`, `build`, `ci`, `chore` y `style` no salen). Los asuntos de los commits están en español: tradúcelos, agrúpalos y escríbelos para quien usa el plugin, bajo `## [Unreleased]`, y haz un commit normal (`docs: prepara las notas de la X.Y.Z`).
- **Automática**: si `[Unreleased]` está vacío, `pnpm release` mete el borrador tal cual. Sirve para una patch con dos arreglos, pero el resultado queda en español.

### 2. Ensayo

```sh
pnpm release patch --dry-run        # o minor, major, prerelease, 0.3.0…
```

Enseña la versión nueva, las notas y todo lo que impediría la release (rama, árbol sucio, etiqueta existente, versiones desincronizadas, notas vacías). No escribe nada y sale siempre con 0.

Tipos de subida: `major`, `minor`, `patch`, `premajor`, `preminor`, `prepatch`, `prerelease` (con `--preid rc` por defecto) o una versión explícita (`0.3.0`, `1.0.0-rc.0`). Las notas de una estable recogen todo desde la **estable** anterior, aunque ya saliera en sus `-rc`.

### 3. Release en local

```sh
pnpm release patch
```

Cambia la versión en todos los manifiestos, cierra `[Unreleased]` en `## [X.Y.Z] - AAAA-MM-DD`, regenera los enlaces de comparación del final del CHANGELOG, comprueba que todo cuadra y deja **en local**:

- el commit `chore(release): vX.Y.Z` (con `Signed-off-by`);
- la etiqueta anotada `vX.Y.Z`, con las notas como mensaje.

Si algo falla antes del commit, deja los archivos como estaban. No empuja nada. Revisa el resultado:

```sh
git show --stat HEAD
git tag -n20 -l vX.Y.Z
```

¿No te convence? Aún no se ha publicado nada: `git tag -d vX.Y.Z && git reset --hard HEAD~1`.

### 4. Publicar

```sh
git push --atomic origin main vX.Y.Z
```

`--atomic` empuja la rama y la etiqueta a la vez o ninguna de las dos.

### 5. Lo que hace el CI

[`release.yml`](../.github/workflows/release.yml) arranca con la etiqueta:

1. **artifacts**: comprueba que la etiqueta es `v` + la versión de todos los manifiestos (`check-versions.ts --tag`) y ejecuta `pnpm package` (ver abajo), que construye el servidor y la web y genera los artefactos. Si el repo es público, firma su **atestación de procedencia** (SLSA, con el OIDC de GitHub).
2. **image**: si lo anterior pasa, construye la imagen para `linux/amd64` y `linux/arm64` y la publica en `ghcr.io/aimarmndz/vibe-gambling` con las etiquetas `X.Y.Z` y `X.Y` (más `X` desde la 1.0, y `latest` solo en versiones estables), con SBOM y procedencia de BuildKit y, si el repo es público, atestación.
3. **release**: crea la GitHub Release `vX.Y.Z` con las notas del CHANGELOG, las instrucciones de instalación y verificación y el digest de la imagen; la marca como _pre-release_ si la versión lleva sufijo y le adjunta:

| Artefacto                            | Qué es                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `vibe-gambling-mod-vX.Y.Z.zip`       | El plugin, solo lo que carga Claude Code (`.claude-plugin/plugin.json`, `hooks/`, README y LICENSE), en la raíz del zip                      |
| `vibe-gambling-server-vX.Y.Z.tar.gz` | Servidor empaquetado con esbuild, build de la web, `config/`, migraciones, `.env.example` y un README para instalarlo sin Docker con Node 26 |
| `vibe-gambling-vX.Y.Z.spdx.json`     | SBOM SPDX 2.3 de las dependencias de producción del servidor y de la web (lo que va dentro del tar.gz y de la imagen)                        |
| `SHA256SUMS`                         | SHA-256 de los tres anteriores                                                                                                               |

Cada paso es idempotente: si un job falla por algo pasajero, **Re-run failed jobs** termina la release sin duplicar nada. Relanzar el job **release** vuelve a escribir las notas desde el CHANGELOG: si las has retocado a mano en GitHub, vuelve a hacerlo después.

### 6. Después

- Comprueba la release en GitHub y, si quieres, añade arriba el GIF o lo que haga falta para anunciarla (editar las notas no cambia los artefactos).
- Despliega la versión en la instancia oficial con [`deploy.yml`](../.github/workflows/deploy.yml) (`image_tag` = `X.Y.Z`); ver [DESPLIEGUE.md §13](DESPLIEGUE.md#13-actualizaciones).
- Quien instaló el plugin desde el marketplace la recibe al actualizar los plugins en Claude Code: el marketplace lee `main` y Claude Code reconoce la actualización por la versión de `plugin.json`, por eso los cambios del mod llegan a los usuarios con cada release.

## Generar los artefactos en local

`pnpm package` genera en `dist-release/` (ignorado por git) **exactamente** lo mismo que adjunta el CI, más `RELEASE_NOTES.md` (las notas que usa la release). Es reproducible: la fecha de todos los archivos es la del commit de `HEAD` (o `SOURCE_DATE_EPOCH`), las entradas van ordenadas y sin dueño ni permisos del sistema, así que el mismo commit da los mismos bytes en cualquier máquina (y los mismos SHA-256 que la release, salvo cambios de las herramientas de build).

```sh
pnpm package                # construye y empaqueta
pnpm package --skip-build   # reutiliza los dist/ que ya haya
```

Para probarlos de verdad:

```sh
cd "$(mktemp -d)"
cp ~/dev/vibe-gambling/dist-release/* .
sha256sum --check SHA256SUMS

# El plugin
unzip -q vibe-gambling-mod-vX.Y.Z.zip -d mod
claude plugin validate mod
claude --plugin-dir mod     # y dentro: /vibe-server http://localhost:8787

# El servidor, con Node 26 contra el Postgres de desarrollo (5436)
docker exec vibe-gambling-dev-postgres-1 psql -U vibe -d vibe -c 'CREATE DATABASE vibe_pkg'
tar -xzf vibe-gambling-server-vX.Y.Z.tar.gz
cd vibe-gambling-server-vX.Y.Z
# .env: el de deploy/dev.env con DATABASE_URL → …/vibe_pkg, otro PORT y PUBLIC_URL, y las rutas
# ./drizzle, ./web, ./config/game.json y ./config/site.json (ver el README del tar.gz)
npm start &
curl -fsS http://127.0.0.1:<PORT>/healthz && curl -fsS -o /dev/null http://127.0.0.1:<PORT>/
kill %1
docker exec vibe-gambling-dev-postgres-1 psql -U vibe -d vibe -c 'DROP DATABASE vibe_pkg'
```

El CI ejecuta `pnpm package --skip-build` en cada PR (job **Build**), así que un empaquetado roto se ve antes de etiquetar.

## Verificar una release

Cualquiera puede comprobar que un artefacto es el que construyó el CI de este repo a partir de la etiqueta:

```sh
# Integridad: las sumas cuadran con lo descargado
sha256sum --check --ignore-missing SHA256SUMS

# Procedencia de los archivos (requiere gh ≥ 2.49)
gh attestation verify vibe-gambling-server-vX.Y.Z.tar.gz --repo Aimarmndz/vibe-gambling
gh attestation verify vibe-gambling-mod-vX.Y.Z.zip --repo Aimarmndz/vibe-gambling

# Procedencia de la imagen
gh attestation verify oci://ghcr.io/aimarmndz/vibe-gambling:X.Y.Z --repo Aimarmndz/vibe-gambling

# Manifiesto multi-arch, SBOM y procedencia de BuildKit adjuntos a la imagen
docker buildx imagetools inspect ghcr.io/aimarmndz/vibe-gambling:X.Y.Z
docker buildx imagetools inspect ghcr.io/aimarmndz/vibe-gambling:X.Y.Z --format '{{ json .SBOM }}'
```

`gh attestation verify` comprueba la firma (Sigstore), que el certificado lo emitió el OIDC de GitHub para `Aimarmndz/vibe-gambling` y que el digest del archivo es el atestado. Con `--signer-workflow Aimarmndz/vibe-gambling/.github/workflows/release.yml` se exige además que lo firmara este workflow.

**Las atestaciones solo existen si el repo era público cuando se ejecutó el workflow** (GitHub no las ofrece en repos privados sin Enterprise). Los SHA256SUMS y el SBOM se publican siempre.

## La primera versión (v0.1.0)

La versión `0.1.0` ya está escrita en los manifiestos y en el CHANGELOG, pero nunca se ha etiquetado. Para ella:

```sh
pnpm release 0.1.0 --dry-run
pnpm release 0.1.0       # fecha la sección [0.1.0] con el día de hoy y etiqueta
```

Si la sección ya tiene la fecha de hoy, no hay nada que commitear: solo se crea la etiqueta sobre `HEAD`. `pnpm release patch|minor|…` se niega mientras la versión actual no tenga su etiqueta, para no saltarse ninguna.

Orden recomendado (ver [launch/CHECKLIST.md](launch/CHECKLIST.md)): hacer **público el repo antes de empujar `v0.1.0`**, para que la release salga con atestaciones. Si se empuja con el repo privado, todo lo demás se publica igual; al hacerlo público, **Actions → Release → Re-run all jobs** sobre la ejecución de `v0.1.0` añade las atestaciones (vuelve a publicar la imagen con las mismas etiquetas y actualiza los artefactos de la release, que son idénticos).

## El paquete de GHCR

El primer push de la imagen crea el paquete `ghcr.io/aimarmndz/vibe-gambling` **privado**, aunque el repo sea público. Para que cualquiera pueda hacer `docker pull` sin iniciar sesión (lo necesitan los compose de producción y de self-hosting):

1. GitHub → tu perfil → **Packages** → `vibe-gambling` → **Package settings**.
2. **Danger Zone → Change visibility → Public**. GitHub no deja volver a hacer privado un paquete público: hazlo cuando el repo ya sea público.
3. Comprueba que el paquete está enlazado al repo (sale en la columna **Packages** de su portada). Lo enlaza solo la etiqueta `org.opencontainers.image.source` que pone `docker/metadata-action`; si no, **Connect repository** en la misma página.

Comprobación, sin sesión:

```sh
docker logout ghcr.io
docker pull ghcr.io/aimarmndz/vibe-gambling:X.Y.Z
```

## Si algo sale mal

| Situación                                                 | Qué hacer                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm release` se niega                                   | Lee la lista de problemas: casi siempre es el árbol sucio, no estar en `main` o una versión desincronizada (`pnpm lint:versions` dice cuál)            |
| Aún no has empujado y quieres deshacer                    | `git tag -d vX.Y.Z && git reset --hard HEAD~1`                                                                                                         |
| El workflow falla en **artifacts** («tag does not match») | La etiqueta no es la versión de los manifiestos: borra la etiqueta remota (`git push origin :refs/tags/vX.Y.Z`), arréglalo y vuelve a hacer la release |
| Falla un job por algo pasajero (registro, red)            | **Re-run failed jobs**: todos los pasos son idempotentes                                                                                               |
| La versión publicada tiene un fallo                       | Arréglalo y publica la siguiente patch. No borres la release ni la etiqueta: alguien puede tenerla instalada                                           |
| Un fallo de seguridad                                     | Sigue [SECURITY.md](../SECURITY.md): la patch sale con su aviso de seguridad y la entrada en _Security_                                                |
