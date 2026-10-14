# Contributing to vibe-gambling

Thanks for wanting to make the most pointless roulette on the internet a little better. The joke is on the surface; the code underneath is meant to be boringly solid, so contributions are held to the same bar.

> 🇪🇸 Hay un [resumen en español](#resumen-en-español) al final.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), never through public issues.

## Ground rules

- **Fake coins only.** No real money, no purchases, no links to betting sites. Ever. The shop sells placebos for fake coins and the referral programme is a pyramid of nothing; PRs that make any of it real are closed.
- **Privacy first.** The mod only sends `turnId`, the turn duration, two booleans (`gitPushOk`, `testFailed`), the plugin version and the generic OS. Never prompts, code, commands, paths or repo names. Any change that touches what leaves the user's machine needs a test that proves it.
- **Nothing hardcoded.** URLs, ports, timeouts, limits, brand texts… come from environment variables (validated with zod in each package's config module) or from `config/*.json`. The only constants in code are the rules of European roulette.
- **The server is the only authority.** The browser and the mod never decide results or balances.

## Developer Certificate of Origin (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org/) instead of a CLA. Every commit must carry a `Signed-off-by` line with your real name (or the name you usually use in public) and an email that you control:

```text
Signed-off-by: Jane Doe <jane@example.com>
```

Git adds it for you with `-s`:

```sh
git commit -s -m "feat(web): añade el sonido de la bola al rebotar"
```

By signing off you certify that you wrote the change, or otherwise have the right to submit it under the project's license (AGPL-3.0-or-later, see below), and that you understand the contribution and your sign-off are public and kept forever. Read the [full text of the DCO](https://developercertificate.org/): it is short.

Forgot to sign off? Fix the last commit with `git commit --amend -s --no-edit`, or a whole branch with `git rebase --signoff main`, then force-push your branch.

## License of contributions

vibe-gambling is licensed under the **GNU AGPL-3.0-or-later** with an additional term under section 7(b) that requires keeping the author attribution ("Created by Aimar (github.com/Aimarmndz)") in the UI. See [LICENSE](LICENSE). Your contributions are accepted under the same terms.

Every source file starts with an SPDX header (CI checks it with `pnpm lint:spdx`):

| File type            | Header                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| `.ts`, `.tsx`, `.js` | `// SPDX-License-Identifier: AGPL-3.0-or-later`                                       |
| `.glsl`              | `// SPDX-License-Identifier: AGPL-3.0-or-later`                                       |
| `.css`               | `/* SPDX-License-Identifier: AGPL-3.0-or-later */`                                    |
| `.html`              | `<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->` (right after `<!doctype html>`) |

Assets (fonts, textures, sounds, models) must be your own work or under a compatible license, and are listed with their origin and license in `ASSETS.md`. No copyrighted samples, logos or trademarks of others (see [Trademarks](README.md#trademarks) in the README).

## Setting up the environment

### In a dev container (zero setup)

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Aimarmndz/vibe-gambling?quickstart=1)

`.devcontainer/devcontainer.json` works in GitHub Codespaces and in VS Code / any editor with [Dev Containers](https://containers.dev/). It brings Node 26, pnpm (the version in `packageManager`), Docker inside the container (for `deploy/docker-compose.dev.yml` and the testcontainers integration tests), the GitHub CLI, ESLint and Prettier, and on creation runs `pnpm install` and installs the Playwright browsers. Ports 8787 (server), 5173 (Vite) and 5436 (Postgres) are forwarded. Then follow "Option A" or "Option B" below as usual. Claude Code is not preinstalled: add it with `npm install -g @anthropic-ai/claude-code` if you work on the mod.

### On your machine

Requirements:

- **Node.js 26** (see `.nvmrc`; `nvm use` or `fnm use` picks it up).
- **pnpm 11**, the exact version in `packageManager` (`package.json`): `npm install -g pnpm@<that version>` (Node 26 no longer ships Corepack).
- **Docker** with Compose, for Postgres and the server's integration tests.
- **Claude Code** (`npm install -g @anthropic-ai/claude-code`) if you work on the mod.

```sh
git clone https://github.com/Aimarmndz/vibe-gambling.git
cd vibe-gambling
pnpm install

# Option A, the whole stack in Docker (server + web build + Postgres + a fake GitHub):
docker compose -f deploy/docker-compose.dev.yml up -d --build
# → http://localhost:8787 (Postgres on 127.0.0.1:5436, fake GitHub on 8788)

# Option B, watch mode: Postgres in Docker, the rest on the host (one terminal each).
# The server reads deploy/dev.env (committed, no secrets); the web needs packages/web/.env.
docker compose -f deploy/docker-compose.dev.yml up -d postgres
pnpm --filter @vibe-gambling/server dev:fake-github
pnpm --filter @vibe-gambling/server dev
cp packages/web/.env.example packages/web/.env
pnpm --filter @vibe-gambling/web dev        # http://localhost:5173, proxies /api and /ws to 8787

# Load the mod in a Claude Code session and point it at your local server
claude --plugin-dir packages/mod
# then, inside Claude Code: /vibe-server http://localhost:8787 and /vibe-login
# (the fake GitHub approves the device code by itself)
```

Every value (ports, URLs, the fake GitHub for local logins…) is documented in `deploy/dev.env`, `deploy/.env.example` and `packages/web/.env.example`. Never commit a real `.env`. `/play?demo` runs the window against a simulated server in the browser, no account needed.

### Standard scripts

At the root:

| Command              | What it does                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm lint`          | ESLint + Prettier check + SPDX headers + version sync + Markdown links + locales and protocol docs check |
| `pnpm lint:spdx`     | Only the SPDX header check (`scripts/check-spdx.ts`)                                                     |
| `pnpm lint:versions` | Only the version sync check: every manifest and `CHANGELOG.md` agree (`scripts/check-versions.ts`)       |
| `pnpm lint:links`    | Only the Markdown check: every relative link, image and anchor exists (`scripts/check-links.ts`)         |
| `pnpm format`        | Prettier write on the whole repo                                                                         |
| `pnpm typecheck`     | `tsc` in every package                                                                                   |
| `pnpm test`          | Unit tests in every package (`pnpm -r test`)                                                             |
| `pnpm build`         | Production build of the server and the web                                                               |
| `pnpm package`       | Release artifacts in `dist-release/` (mod zip, server tarball, SBOM, checksums), reproducible            |
| `pnpm release`       | Maintainers: bump the version, close the changelog, commit and tag locally ([RELEASING][releasing])      |
| `pnpm test:scripts`  | Tests of the repo scripts (`node --test`)                                                                |
| `pnpm sync:mod`      | Regenerate the mod's copy of `shared` (`packages/mod/hooks/generated`)                                   |
| `pnpm gen:locales`   | Regenerate the language registry from `locales/` (protocol list, the mod's copy, plugin options)         |
| `pnpm docs:protocol` | Regenerate the schema sections of `docs/PROTOCOLO.md` (`--check` only checks; part of `pnpm lint`)       |

Per package (`pnpm --filter @vibe-gambling/<package> <script>`):

| Package  | Scripts                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `shared` | `typecheck`, `test`                                                                                                              |
| `server` | `typecheck`, `test`, `test:integration` (real Postgres via testcontainers), `build`, `dev`, `start`, `db:generate`, `db:migrate` |
| `web`    | `typecheck`, `test`, `build`, `dev`, `test:e2e` (Playwright against the running stack)                                           |
| `mod`    | `typecheck`, `validate` (`claude plugin validate .`), `test` (`claude plugin test .`)                                            |

Before opening a PR, run at least `pnpm lint`, `pnpm typecheck` and `pnpm test`, plus the integration or E2E tests of what you touched. CI runs all of it, including the mod tests on Linux, macOS and Windows.

## Code style

- **Prettier** formats everything (no semicolons, single quotes, 100 columns): `pnpm format`. Don't fight it.
- **ESLint** with `typescript-eslint` must be clean.
- **TypeScript** strict. Relative imports **with the `.ts` extension**, `import type` for types, no `enum` and no parameter properties (`erasableSyntaxOnly`).
- **Identifiers and file names in English; code comments in Spanish.** Yes, really: it's the house style. If you don't speak Spanish, write the comment in simple English and a reviewer will translate it.
- Errors are handled explicitly; never swallowed silently.
- Every input (HTTP, WebSocket, config) is validated with zod. Protocol messages are defined once in `packages/shared`; reuse them instead of redefining shapes.
- **Changing the protocol?** After touching a schema or a route in `packages/shared`, run `pnpm sync:mod` (the mod's generated copy) and `pnpm docs:protocol` (the generated sections of [docs/PROTOCOLO.md](docs/PROTOCOLO.md); the examples there are validated against the schemas too). Tests fail if either is stale. A breaking change bumps `PROTOCOL_VERSION`.
- **Tests**: new behavior comes with tests. When a test fails, fix the cause; never delete or loosen a test to make it pass. `packages/shared` keeps ≥ 95 % coverage.

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) **in Spanish, imperative mood**, signed off:

```text
feat(web): añade el filtro CRT desactivable
fix(server): evita saldo negativo con apuestas concurrentes
docs: explica cómo autoalojar el servidor
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`. Scopes: `shared`, `server`, `web`, `mod`, `deploy`, `ci`. If writing in Spanish is a blocker, write it in English and the maintainer will reword it when merging.

## Pull request flow

1. For anything bigger than a typo, open an issue first (bug report or idea) so we agree on the approach.
2. Fork, create a branch from `main` (`feat/crt-curvature`, `fix/ws-reconnect`…).
3. Make small, focused commits, all signed off.
4. Run the checks above locally.
5. Open the PR and fill in the template: what and why, how you tested it, screenshots or a short clip for anything visual, and the privacy checklist.
6. CI must be green. A maintainer reviews it; expect questions and small change requests.
7. PRs are merged with **squash** or **rebase**, keeping the Conventional Commit title and the sign-off.

Your Conventional Commit titles feed the changelog draft, so make them read well (`feat` → _Added_, `fix` → _Fixed_). You never bump versions or edit `CHANGELOG.md` releases in a PR: the maintainer does it when cutting a release, as explained in [docs/RELEASING.md][releasing] (in Spanish).

[releasing]: docs/RELEASING.md

## Ways to contribute

### New funny phrases

The gambler phrases live in `locales/<language>/phrases.json` (one folder per language: `en`, `es`, `fr`, `de`):

- Grouped by category (`win`, `lose`, `zero`, `bigWin`, `bigLoss`, `jackpot`, `testFailed`, `broke`…). The categories are defined in `packages/shared/src/i18n/phrases.ts`.
- Phrases are **adapted, not translated**: each language has its own puns, same tone. Add yours in the languages you speak (the tests check that every category has phrases in every language, that each language has at least 40, and that each category uses the same `{placeholders}` as English). If you only speak one, say so in the PR.
- Templates use `{placeholders}`; keep the ones the category already uses. Then run `pnpm gen:locales` (the plugin keeps a generated copy).

Tone rules (non-negotiable):

- ✅ Jokes about **fake gambling addiction** (gambler's fallacy, "I can quit whenever I want", "this is an investment") and **dev culture** (vibe coding, tokens, `git push --force`, "works on my machine", flaky tests).
- ❌ Never about real people, groups, nationalities, genders, religions, or anyone's real addiction or illness.
- ❌ Nothing that encourages real gambling, mentions real betting brands, or links anywhere.
- Short: one line, it has to fit in a toast and in the PS1 result screen.

Use the **"New funny phrase"** issue template if you'd rather propose it than open a PR.

### Translations

The UI ships in English (the reference language and default), Spanish, French and German. Every text lives in [`locales/`](locales/README.md), one folder per language (game, landing, `/privacy`, plugin messages, phrases, metadata and a pixel-art flag), never in components. **Adding a language is copying `locales/en`, translating it and drawing its flag**, then `pnpm gen:locales`: the web discovers it by itself and the protocol, server and plugin pick it up from the generated registry. The step by step is in [locales/README.md](locales/README.md). Partial translations are welcome as a draft PR.

### Shaders and the PS1 look

The PSX pipeline (320×240 render target, vertex snapping, affine textures, 15-bit color with Bayer dithering, fog, CRT filter) lives in `packages/web`. When you touch it:

- Keep `prefers-reduced-motion` working (no wobble, no CRT, short animations) and the CRT toggle.
- Include **before/after screenshots** in the PR (the Playwright E2E saves them under `docs/screenshots/`).
- Keep 60 fps on an ordinary laptop, and no external assets: textures are procedural or our own, sounds are synthesized with WebAudio.
- `.glsl` files carry the SPDX header too.

## Resumen en español

- **Monedas falsas siempre**, privacidad por encima de todo y **nada hardcodeado** (todo en env o `config/*.json`).
- Cada commit lleva **`Signed-off-by`** (DCO, [developercertificate.org](https://developercertificate.org/)): usa `git commit -s`. Con eso certificas que tienes derecho a aportar el cambio bajo la licencia del proyecto (AGPL-3.0-or-later con el término 7(b) de atribución).
- Entorno: Node 26, pnpm 11 (la versión exacta de `packageManager`: `npm install -g pnpm@<versión>`; Node 26 ya no trae Corepack), Docker (o, sin instalar nada, el devcontainer en GitHub Codespaces: botón «Open in GitHub Codespaces» de arriba); `pnpm install` y `docker compose -f deploy/docker-compose.dev.yml up -d --build` (pila completa en http://localhost:8787 con un GitHub falso), o solo `postgres` en Docker y los scripts `dev:fake-github` y `dev` del servidor y `dev` de la web en modo watch. El mod se carga con `claude --plugin-dir packages/mod` y se apunta al servidor local con `/vibe-server http://localhost:8787`.
- Antes del PR: `pnpm lint`, `pnpm typecheck`, `pnpm test` y los tests de integración o E2E de lo que toques.
- Versiones y CHANGELOG: no se tocan en los PR. Las releases las saca el mantenedor con `pnpm release`, como cuenta [docs/RELEASING.md](docs/RELEASING.md); el título de tu commit acaba en el borrador del CHANGELOG, así que cuídalo.
- Estilo: Prettier y ESLint limpios; identificadores en inglés y **comentarios en español**; cabecera SPDX en cada archivo fuente; commits con **Conventional Commits en español** e imperativo.
- **Frases nuevas** en `locales/<idioma>/phrases.json`, adaptadas (no traducidas) en los idiomas que hables, y luego `pnpm gen:locales`. Humor sobre la ludopatía de mentira y la cultura dev; **nunca** sobre personas ni colectivos, ni nada que anime a apostar de verdad.
- **Idiomas nuevos**: copia `locales/en`, tradúcelo, dibuja la bandera y ejecuta `pnpm gen:locales` ([locales/README.md](locales/README.md)). **Shaders**: mira la sección de arriba; en lo visual, capturas del antes y el después en el PR.
