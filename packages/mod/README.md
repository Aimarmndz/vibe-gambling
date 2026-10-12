# vibe-gambling — Claude Code mod

The Claude Code side of vibe-gambling: every prompt is a spin. It opens the PS1-style roulette window when you send a prompt, closes the round when Claude finishes, and shows the result in a toast and your balance in the status line. Fake coins only.

```text
/plugin install vibe-gambling --marketplace Aimarmndz/vibe-gambling
/vibe-login
```

## Commands

| Command                        | Alias      | What it does                                                        |
| ------------------------------ | ---------- | ------------------------------------------------------------------- |
| `/roulette`                    | `/ruleta`  | Open the window                                                     |
| `/bet <amount> <square>`       | `/apostar` | Bet on the current or next spin (`/bet 200 red`, `/bet 100 1st12`)  |
| `/all-in [square]`             |            | Your whole balance (red by default)                                 |
| `/balance`                     | `/saldo`   | Balance, debt, net worth and rank                                   |
| `/vibe-login`, `/vibe-logout`  |            | GitHub device-code login / log out                                  |
| `/vibe-hide`, `/vibe-show`     |            | Hide from / show on the public leaderboard                          |
| `/vibe-server [url\|default]`  |            | Show or change the server (self-hosting); checks `GET /api/meta`    |
| `/vibe-delete-account <login>` |            | Delete your account and all its data (repeat your login to confirm) |

## Privacy

The mod sends **only** a random turn id, the turn duration, two booleans (`gitPushOk`, `testFailed`), the plugin version, the generic OS (`linux`/`darwin`/`win32`/`other`) and your session token — plus what you type in `/bet`. Never prompts, answers, code, commands, paths, file or repo names. Bash commands are inspected locally to compute the two booleans and then forgotten. `tests/privacy.test.ts` enforces it.

## Options

Set them in `/config` (or `pluginConfigs["vibe-gambling"].options` in your settings). The defaults live in `.claude-plugin/plugin.json`.

| Option                   | Default                  | Meaning                                                     |
| ------------------------ | ------------------------ | ----------------------------------------------------------- |
| `serverUrl`              | `https://vibe.aimar.dev` | Server to play on (`/vibe-server` changes it)               |
| `autoOpen`               | `true`                   | Open the window on each prompt if it is not open            |
| `language`               | `auto`                   | `auto` (system locale), `en` or `es`                        |
| `turnTimeoutMs`          | `1500`                   | Timeout of the requests made during a turn (max 1500)       |
| `commandTimeoutMs`       | `5000`                   | Timeout of the slash commands' requests                     |
| `windowReopenCooldownMs` | `60000`                  | Wait for an opened window to connect before opening another |
| `windowSize`             | `960,720`                | App-mode window size                                        |
| `launchTimeoutMs`        | `5000`                   | How long the browser launcher may take                      |
| `revealMaxDelayMs`       | `30000`                  | Longest wait before the result toast                        |

## Development

```sh
claude --plugin-dir packages/mod                   # load it in a session
pnpm --filter @vibe-gambling/mod validate          # claude plugin validate .
pnpm --filter @vibe-gambling/mod test              # claude plugin test . (one *.test.ts per behaviour)
pnpm --filter @vibe-gambling/mod typecheck         # lays the engine's types, then tsc -p .
pnpm sync:mod                                      # regenerate hooks/generated from packages/shared
```

- `hooks/register.ts` wires the engine events; it is the only file that touches `$` (the engine requires it) and adapts it to the small `Io` interface in `hooks/lib/io.ts`. Everything in `hooks/lib` is plain TypeScript.
- `hooks/generated/` is a copy of the phrases and protocol constants from `packages/shared` (the mod is installed alone, so it cannot import them). `packages/shared/test/mod-contract.test.ts` fails if the copy is stale and validates the mod's request bodies against the shared zod schemas.
- The engine's type declarations (`.claude-plugin/types/`) belong to the installed Claude Code and are not committed: `scripts/mod-engine-types.ts` asks the installed `claude` to write them (headless, isolated config, no API key needed).
- The plugin API is early access: if a new Claude Code release changes it, re-run `typecheck`, `validate` and `test`.
