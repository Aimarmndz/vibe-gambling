# Changelog

> 🇪🇸 Registro de cambios en inglés, con el formato de Keep a Changelog: las entradas se generan desde los Conventional Commits con `pnpm release` y se revisan a mano (cómo, en [docs/RELEASING.md](docs/RELEASING.md)).

All notable changes to vibe-gambling are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). One version covers the whole project: the Claude Code plugin, the server, the web window and the Docker image. While the version is `0.x`, the protocol between them may still change; see the [versioning policy](docs/RELEASING.md#política-de-versiones).

## [Unreleased]

### Changed

- **Every other text is satirical too**, in all four languages and adapted rather than translated: the game window (loan shark fine print, bankruptcy, achievements, menus, settings, how to play, credits, empty states), the plugin's replies and slash command descriptions, the READMEs, the plugin and marketplace descriptions and the page metadata now parody casino, crypto, MLM and growth-hacking marketing ("Risk: 100%. Upside: infinite."). Error messages still say what happened and what to do, with the joke as a short extra. There are new gambler phrases in every category. The privacy policy only changes its intro; its content is the same. The gambling-help notice and links stay as they were, without jokes, and every text still makes it clear that no real money is ever involved.

### Added

- **The SHOP: items that do nothing, honestly labelled.** Buy advantages that don't exist with your fake coins: the Lucky Rabbit's Foot™ (does nothing, shows "+∞% LUCK"), the AI Tipster (its "prediction" is just another independent spin, right before the real one: it is right 1 in 37 times, like anyone), Full Coverage Insurance (refunds half of your lost outside bets, with a cap), the Straight-Up Turbo (×2 on your only straight-up bet, never on top of the `git push` jackpot), the Streak Helmet (one loss doesn't break your winning streak, which gets an asterisk: `7*`), `git revert HEAD~1` (refunds part of your last round's loss, after the ball has landed and for a short while, once per season, and always for more than it gives back) and cosmetic felts and chip sets that are yours forever. Consumables expire with the season, have per-season limits and are armed for the next round that resolves (live or a pending spin, also with SPIN ALL). The wheel is untouched: 37 uniform pockets, same payouts; items pay on their own lines (`itemNet`). Every item's fine print states its real expected value, and the server refuses to start with a "generous" configuration: for any bet, what an item pays back on average per charge is at most what that charge costs (checked by a `refine` per item and an exact test over the 37 pockets). The game window gets a SHOP tile (the main menu grid is now 6 + 6) with SHOP / POCKET / WARDROBE tabs and the Placebometer (spent vs. recovered, % of rounds won with and without the rabbit's foot, AI hits vs. 2.70 %); the demo has a working shop too ("try before you don't buy"). In Claude Code: `/vibe-shop` (`/vibe-tienda`), `/vibe-shop buy <item>` with Spanish and English aliases, `/vibe-use <item> [off]` (`/vibe-usar`), armed items in `/balance` and the status line, and item effects in the end-of-turn toast. Six new achievements, all numbers in `config/game.json` (`items`), new routes `GET /api/shop`, `POST /api/shop/buy` and `POST /api/items/arm`, new WebSocket messages `shop.request`, `shop.buy`, `item.arm`, `shop` and `inventory`, and database migration `0006`. The privacy policy lists what the shop stores; none of it is public except the streak asterisk.
- **Pyramid Affiliate Program (legally distinct)**: every player gets a short random affiliate code and a public invite page, `/r/<code>`, that says who invites you (unless they are hidden from the leaderboard), what you get and how to install and redeem. `/vibe-invite` (`/vibe-invitar`) shows your link and your pyramid stats and `/vibe-redeem <code>` (`/vibe-canjear`) redeems the code of whoever invited you: a 500-coin welcome bonus, once per account, within your first 7 days and 100 spins, never your own code nor the code of someone who redeemed yours. Whoever invited you gets a 1,000-coin commission once you play 50 spins and your GitHub account is old enough for the leaderboard, up to 10 commissions per season. All the numbers live in `config/game.json` (`referral`). The game window gets an AFFILIATES screen with a low-poly 3D pyramid, the commission shows up as a trophy-style notice with coins flying to your balance, and there are two new achievements, _Influencer_ and _Top of the Pyramid_. New routes `GET /api/referral`, `POST /api/referral/redeem` and `GET /api/referral/lookup`, new WebSocket messages `referral.request`, `referral` and `referral.commission`, and database migration `0005`. The privacy policy explains what is stored (who invited whom and when) and that it goes away with your account.
- **The demo can be paused**: `/play?demo` still spins by itself, but `A` (L1 on a gamepad) toggles between AUTO and PAUSED and `G` (SELECT) spins once right away, as if you had just sent a prompt. Both live in a small panel under the streak box that you can also click or tap, the status sign says which mode you are in, spinning by hand switches to PAUSED, and the choice is remembered in this browser. Screen readers hear every switch.
- **Hardware acceleration warning**: when the browser draws WebGL in software (hardware acceleration off, no drivers, a virtual machine), the game window says so once per session after it starts, with the exact settings path for Chrome, Edge and Brave, Firefox and Safari. "Got it" closes it and "Don't show again" means it. The list of software renderers lives in `config/web.json` (`gpu.softwareRenderers`).

## [0.3.2] - 2026-10-13

### Changed

- **The landing page is more satirical** in all four languages: it now pitches itself as "the most honest casino on the internet" (you win nothing, you lose nothing, and you still can't stop), the demo is free "because the first one always is", and the fake-money notice says it with a joke instead of a dry "fake coins only", while still saying clearly that no real money is ever involved, next to the gambling-help links.

### Added

- **Daily database backups for the Noust deployment**: `deploy/systemd/vibe-backup.{service,timer}` run `deploy/backup.sh`, which now takes the app folder and compose file from `VIBE_APP_DIR` and `VIBE_COMPOSE_FILE`.

## [0.3.1] - 2026-10-13

### Added

- **Deploying with [Noust](https://github.com/Perkybeet/noust)**: `compose.noust.yml` builds the server image on the VPS from the tagged source (no GHCR token needed for a private package), and `docs/DESPLIEGUE.md` explains the whole setup step by step.
- **`deploy/nginx/vibe.aimar.dev.conf`**: the nginx site of the official instance, with an access log that keeps neither IPs nor query strings, as the privacy policy promises, and WebSockets with a timeout above the server's ping.
- **`deploy/cloudflare-nginx.sh`** with a weekly systemd timer: lets only Cloudflare reach the site from inside nginx, for servers whose other sites do not go through Cloudflare and so cannot close 80/443 to everyone else. If the download fails or `nginx -t` does not pass, the previous list stays.

## [0.3.0] - 2026-10-13

### Security

- **New GitHub accounts stay off the leaderboard**: accounts younger than 30 days (`leaderboard.minAccountAgeDays` in `config/game.json`) play as usual but only appear on the leaderboards and in the Hall of Ruin once they turn 30 days old, so mass-creating accounts to inflate the leaderboard is not worth it. The plugin (at login and in `/balance`), the game window and the landing page say so, with the date you will appear. The server now stores your GitHub account's creation date (from the public profile, no new permissions), deleted with your account; accounts from before the rule count as old until their next login.
- **One spin per ball**: while the ball of your last spin is still falling, a new prompt is not played live; it is saved as a pending spin instead (with the usual cap). Nothing is lost when you play with Claude, but a script can no longer chain turns faster than the wheel can show them (at most one spin per landing, about 14 a minute).
- **Minimum turn length**: the server times each turn itself, from `turn/start` to `turn/end` (never trusting the plugin's `durationMs`). A turn shorter than `turn.minDurationMs` (800 ms) gives no spin and no pending spin, and a `turn/end` without its `turn/start` no longer counts as a spin. The server logs the fact and the duration only, with no personal data.
- **Daily spin limit**: at most `dailySpinLimit` (2,500) spins played per player and day, from midnight to midnight in the season's time zone (daylight saving days included). After that, prompts neither spin nor queue and SPIN is refused until midnight; the plugin and the game window close the table with a new batch of closing-time jokes in every language, the time it reopens and, quietly, a real gambling-help line.

## [0.2.0] - 2026-10-13

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

[Unreleased]: https://github.com/Aimarmndz/vibe-gambling/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/Aimarmndz/vibe-gambling/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Aimarmndz/vibe-gambling/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Aimarmndz/vibe-gambling/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Aimarmndz/vibe-gambling/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Aimarmndz/vibe-gambling/releases/tag/v0.1.0
