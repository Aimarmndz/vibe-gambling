# Changelog

> 🇪🇸 Registro de cambios en inglés, con el formato de Keep a Changelog: las entradas se generan desde los Conventional Commits con `pnpm release` y se revisan a mano (cómo, en [docs/RELEASING.md](docs/RELEASING.md)).

All notable changes to vibe-gambling are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). One version covers the whole project: the Claude Code plugin, the server, the web window and the Docker image. While the version is `0.x`, the protocol between them may still change; see the [versioning policy](docs/RELEASING.md#política-de-versiones).

## [Unreleased]

The show release: every spin now gets the arcade treatment it deserves.

### Added

- **Spectacle animations** inside the PS1 framebuffer, each with synthesized sound, skippable and with a short, still version under `prefers-reduced-motion`: tiered prizes (BIG WIN, MEGA WIN, STRAIGHT UP!) with a low-poly coin shower, the whole table flashing GREEN! when the 0 comes up, a PUSH TO PROD rocket before the `git push` jackpot, a bank counter for the loan (contract, pixel signature, APPROVED stamp, coins into your balance), an arcade BANKRUPT · CONTINUE? 9… 8… screen, ON FIRE streaks and a gambler's-fallacy notice that always tells the honest odds.
- **New in-game menus** in the same style: a 5×2 grid of spinning low-poly icons, block wipes between screens and pages for pending spins, season stats (net-worth chart with loans marked, latest spins, hottest number, biggest win), the 17 joke achievements with trophy pop-ups, the bank statement, the leaderboard with avatars and the Hall of Ruin, the memory card, settings, a how-to-play book and credits.
- **Logo and identity**: a pixel-art casino chip with a `>_` prompt, used for the favicon and app icons, the title screen, the landing page, the Open Graph card and the GitHub social preview, generated from `docs/brand/`.
- **README** rewritten in English with a separate Spanish `README.es.md`, a hero GIF recorded from a real Claude Code session next to the game window, and a screenshot gallery.
- Plural forms with `Intl.PluralRules` in the window and the plugin, in all four languages.
- The WebSocket protocol tells which request each `error` (`re`) and each pending-spin result (`requestId`) answers.

### Fixed

- The result is never revealed (in the window or in the plugin's toast) before the ball has finished landing, even when Claude takes longer than the minimum spin.
- SPIN ALL no longer hangs when another screen's request fails at the same time, and no longer counts a spin from another window or a live prompt as its own.
- Nothing spoils a spin while the ball is falling: achievements, stats, the bank statement and the leaderboard wait for the result.
- Screen readers hear the number and colour on a straight-up win and on green.
- Long labels in French and German fit their windows, and the felt keeps "2:1" readable.
- The window's visibility reports are ignored once its session has expired.
- The privacy page lists the achievements among the stored data.

## [0.1.0] - 2026-10-13

First public version: every Claude Code prompt is a spin of a PS1-style European roulette, with fake coins only.

### Added

- **Claude Code plugin** (`packages/mod`), installable from the repo's own marketplace with `/plugin install vibe-gambling --marketplace Aimarmndz/vibe-gambling`:
  - each prompt opens a round and the end of the turn spins the wheel; the window opens once, as a borderless app window when a Chromium-based browser is available;
  - commands `/roulette`, `/bet`, `/all-in`, `/balance`, `/vibe-login`, `/vibe-logout`, `/vibe-hide`, `/vibe-show`, `/vibe-server` and `/vibe-delete-account`, with Spanish aliases;
  - GitHub login with the Device Flow, brokered by the server and asking for no permissions;
  - dev jackpot when a `git push` succeeds during the turn, and a consolation phrase when a test command fails, both detected locally as yes/no flags;
  - no dependencies, never slows a turn down (background requests with a short timeout, `🎰 offline` when the server is down) and works on Linux, macOS and Windows;
  - every option (server URL, language, timeouts, window size…) in the plugin's `userConfig`.
- **Pending spins**: when no game window is open and visible at the end of a turn, the spin is saved instead of played; spend them later from the window with SPIN or SPIN ALL (which stops on a big win, on green or when you go broke). Capped per user and cleared when the season ends; a pending spin keeps its turn's `git push` jackpot.
- **Four languages**: English, Spanish, French and German everywhere (game window, landing page, privacy page, plugin messages and 60+ gambler phrases per language), with pixel-art flags to switch language in Settings. Every text lives in `locales/<language>/`: adding a language means copying a folder, translating it and drawing its flag.
- **Spectacle data on the server**: each resolved round carries its prize tier (win, big win, mega win, straight up, green), streaks and the season's first bankruptcy; 17 joke achievements are evaluated in the same transaction as the spin; season stats and the bank statement are available over the WebSocket (the animations and menus that use them arrive in the next release).
- **Server** (`packages/server`): Fastify HTTP API and WebSocket, PostgreSQL with Drizzle migrations, server-side `crypto.randomInt` spins, money operations in transactions with row locks, idempotent turns, monthly seasons, the Most broke, Richest and Most spins leaderboards and the Hall of Ruin, account deletion and hiding from the leaderboard.
- **Game rules** from `config/game.json`: European wheel with its official payouts (no _la partage_), a bet slip that holds chips until the spin, repeated last bet, the Ludo-Credit Express loan with compound interest and a debt cap, streaks and seasons.
- **PS1 window and site** (`packages/web`): Three.js scene with a hand-made PS1 pipeline (320×240, vertex snapping, affine textures, 15-bit color with dithering, fog and a CRT filter), boot screen, memory card, synthesized sounds, mouse, keyboard and gamepad input, `prefers-reduced-motion`; landing page with the leaderboards, a per-instance privacy page and Open Graph images.
- **Shared contract** (`packages/shared`): zod schemas for every HTTP and WebSocket message, versioned with protocol `v1`, and the pure roulette logic, with property tests.
- **Self-hosting and deployment**: multi-arch Docker image, development and production Compose files, an optional Caddy setup, Postgres backups, a Cloudflare-only firewall script and step-by-step guides.
- **Releases**: one SemVer version for everything, reproducible release artifacts (plugin `.zip`, server `.tar.gz` with the built web, SBOM and checksums) and a multi-arch image on GHCR.
- **Documentation**: README in English and Spanish, architecture, protocol reference generated from the schemas, privacy policy, deployment and self-hosting guides, and contributing guidelines with DCO.

### Security

- Strict Content Security Policy without inline scripts or styles, HSTS, `HttpOnly`/`Secure`/`SameSite=Strict` session cookie and `Origin` check on the WebSocket.
- Rate limits per IP (IPv6 grouped by prefix) and per session, also for WebSocket handshakes and messages; keys are forgotten when their window expires.
- Logs never contain IPs, headers, tokens, query strings or database details; GitHub tokens are discarded right after login and only session-token hashes are stored.
- The plugin only talks to `https` servers (plain `http` only to localhost), never puts server text in a shell command, and only accepts `http(s)` URLs anywhere in the protocol.

[Unreleased]: https://github.com/Aimarmndz/vibe-gambling/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Aimarmndz/vibe-gambling/releases/tag/v0.1.0
