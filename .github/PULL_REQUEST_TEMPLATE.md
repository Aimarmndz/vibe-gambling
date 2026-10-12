<!-- Thanks for contributing! / ¡Gracias por contribuir! Read CONTRIBUTING.md before opening the PR. -->

## What and why

<!-- What does this PR change and why? Link the issue: "Closes #123". -->

## How it was tested

<!-- Commands you ran and what you checked by hand. -->

## Screenshots / clip

<!-- Required for anything visual (window, shaders, CRT, landing, leaderboard): before and after. Delete this section if nothing visual changed. -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`, [DCO](https://developercertificate.org/)).
- [ ] Commit messages follow Conventional Commits (in Spanish, imperative mood, if you can).
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally.
- [ ] New behavior has tests (and the integration / E2E / mod tests of what I touched pass). No test was deleted or loosened to make it pass.
- [ ] New source files have the `SPDX-License-Identifier: AGPL-3.0-or-later` header.
- [ ] Nothing configurable is hardcoded (URLs, ports, timeouts, limits, texts… come from env or `config/*.json`), and new env vars are documented in the `.env.example` files.
- [ ] If it's visual: screenshots or a clip are included, and `prefers-reduced-motion` and the CRT toggle still work.
- [ ] User-facing texts are in the i18n files, in English and Spanish.
- [ ] Docs updated if needed (README, `docs/`, `ASSETS.md` for new assets with their license).

## Privacy

- [ ] This PR does **not** change what leaves the user's machine, **or** it does and the mod privacy test was updated to prove only allowed fields are sent (`turnId`, duration, `gitPushOk`, `testFailed`, plugin version, generic OS).
- [ ] No new personal data is stored on the server, **or** `docs/PRIVACIDAD.md` and `/privacy` are updated.
- [ ] No secrets, tokens, real `.env` files or personal data in the diff.
- [ ] Fake coins only: nothing here involves real money, purchases or links to betting sites.
