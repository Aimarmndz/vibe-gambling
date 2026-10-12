# Contributing to vibe-gambling

Thanks for wanting to make the most pointless roulette on the internet a little better. The joke is on the surface; the code underneath is meant to be boringly solid, so contributions are held to the same bar.

> 🇪🇸 Hay un [resumen en español](#resumen-en-español) al final.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), never through public issues.

## Ground rules

- **Fake coins only.** No real money, no purchases, no links to betting sites. Ever. PRs that blur this line are closed.
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

Assets (fonts, textures, sounds, models) must be your own work or under a compatible license, and are listed with their origin and license in `ASSETS.md`. No copyrighted samples, logos or trademarks of others (see "Trademarks" in the README).

## Setting up the environment

Requirements:

- **Node.js 26** (see `.nvmrc`; `nvm use` or `fnm use` picks it up).
- **pnpm 11** via Corepack: `corepack enable` (the exact version comes from `packageManager` in `package.json`).
- **Docker** with Compose, for Postgres and the server's integration tests.
- **Claude Code** (`npm install -g @anthropic-ai/claude-code`) if you work on the mod.

```sh
git clone https://github.com/Aimarmndz/vibe-gambling.git
cd vibe-gambling
pnpm install

# Postgres for development (port and credentials come from deploy/.env, see deploy/.env.example)
cp deploy/.env.example deploy/.env
docker compose -f deploy/docker-compose.dev.yml up -d

# Server + web in watch mode (in two terminals)
pnpm --filter @vibe-gambling/server dev
pnpm --filter @vibe-gambling/web dev

# Load the mod in a Claude Code session, pointed at your local server through its plugin options
claude --plugin-dir packages/mod
```

Every value (ports, URLs, the fake GitHub for local logins…) is documented in the `.env.example` files. Never commit a real `.env`.

### Standard scripts

At the root:

| Command          | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| `pnpm lint`      | ESLint + Prettier check + SPDX headers               |
| `pnpm lint:spdx` | Only the SPDX header check (`scripts/check-spdx.ts`) |
| `pnpm format`    | Prettier write on the whole repo                     |
| `pnpm typecheck` | `tsc` in every package                               |
| `pnpm test`      | Unit tests in every package (`pnpm -r test`)         |
| `pnpm build`     | Production build of the server and the web           |

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

## Ways to contribute

### New funny phrases

The gambler phrases live in `packages/shared/src/i18n/`:

- `phrases.en.ts` (English) and `phrases.es.ts` (Spanish), grouped by category (`win`, `lose`, `zero`, `bigWin`, `bigLoss`, `jackpot`, `testFailed`, `broke`…). The categories are defined in `phrases.ts`.
- Add each phrase **in both languages** when you can (the tests check that every category has phrases in both languages, that each language has at least 40, and that both use the same `{placeholders}`). If you only speak one, say so in the PR and someone will translate it.
- Templates use `{placeholders}`; keep the ones the category already uses.

Tone rules (non-negotiable):

- ✅ Jokes about **fake gambling addiction** (gambler's fallacy, "I can quit whenever I want", "this is an investment") and **dev culture** (vibe coding, tokens, `git push --force`, "works on my machine", flaky tests).
- ❌ Never about real people, groups, nationalities, genders, religions, or anyone's real addiction or illness.
- ❌ Nothing that encourages real gambling, mentions real betting brands, or links anywhere.
- Short: one line, it has to fit in a toast and in the PS1 result screen.

Use the **"New funny phrase"** issue template if you'd rather propose it than open a PR.

### Translations

The UI ships in English (default) and Spanish. Texts live in translation files (never in components): the phrases in `packages/shared/src/i18n/`, and the UI strings in the web package's i18n folder. To add a language, add the locale to `shared` and a full catalog for every file, and make the tests pass. Partial translations are welcome as a draft PR.

### Shaders and the PS1 look

The PSX pipeline (320×240 render target, vertex snapping, affine textures, 15-bit color with Bayer dithering, fog, CRT filter) lives in `packages/web`. When you touch it:

- Keep `prefers-reduced-motion` working (no wobble, no CRT, short animations) and the CRT toggle.
- Include **before/after screenshots** in the PR (the Playwright E2E saves them under `docs/screenshots/`).
- Keep 60 fps on an ordinary laptop, and no external assets: textures are procedural or our own, sounds are synthesized with WebAudio.
- `.glsl` files carry the SPDX header too.

## Resumen en español

- **Monedas falsas siempre**, privacidad por encima de todo y **nada hardcodeado** (todo en env o `config/*.json`).
- Cada commit lleva **`Signed-off-by`** (DCO, [developercertificate.org](https://developercertificate.org/)): usa `git commit -s`. Con eso certificas que tienes derecho a aportar el cambio bajo la licencia del proyecto (AGPL-3.0-or-later con el término 7(b) de atribución).
- Entorno: Node 26, pnpm 11 (`corepack enable`), Docker; `pnpm install`, `docker compose -f deploy/docker-compose.dev.yml up -d` y los scripts `dev` de `server` y `web`. El mod se carga con `claude --plugin-dir packages/mod`.
- Antes del PR: `pnpm lint`, `pnpm typecheck`, `pnpm test` y los tests de integración o E2E de lo que toques.
- Estilo: Prettier y ESLint limpios; identificadores en inglés y **comentarios en español**; cabecera SPDX en cada archivo fuente; commits con **Conventional Commits en español** e imperativo.
- **Frases nuevas** en `packages/shared/src/i18n/phrases.en.ts` y `phrases.es.ts`, en los dos idiomas si puedes. Humor sobre la ludopatía de mentira y la cultura dev; **nunca** sobre personas ni colectivos, ni nada que anime a apostar de verdad.
- **Traducciones** y **shaders**: mira las secciones de arriba; en lo visual, capturas del antes y el después en el PR.
