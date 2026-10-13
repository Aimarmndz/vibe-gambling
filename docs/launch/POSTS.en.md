# Launch posts (English)

Drafts. **Nothing is published.** Links: repo `https://github.com/Aimarmndz/vibe-gambling`, site `https://vibe.aimar.dev`, profile `https://github.com/Aimarmndz`. Attach `docs/hero.gif` (or the 30 s video) wherever images are allowed. Always say it: parody, fake coins, nothing real is gambled.

## Show HN

**Title** (HN strips emoji and dislikes hype):

> Show HN: vibe-gambling – every Claude Code prompt is a spin of a PS1-style roulette

**URL:** `https://github.com/Aimarmndz/vibe-gambling`

**Text:**

> I kept staring at the spinner while Claude Code worked, refreshing nothing, hoping for a good outcome. That's a slot machine. So I made it one.
>
> vibe-gambling is a Claude Code plugin: when you send a prompt, a window opens with a low-poly roulette wheel in PS1 style (320×240, wobbly vertices, affine texture warping, dithering, CRT filter, a fake console boot screen and a memory card). The wheel spins while Claude thinks and the ball drops when the turn ends. Bet with the mouse or with `/bet 200 red`. If a `git push` succeeded during the turn, winnings pay double. When you're broke, a loan shark offers 1,000 coins at 4,200 % APR. There's a monthly leaderboard of the most broke devs and a Hall of Ruin.
>
> Fake coins only. No purchases, no real money, no links to betting sites. It's a parody.
>
> The joke is on the surface; I tried to make the inside solid:
>
> - The plugin sends a random turn id, the duration, two booleans (git push ok / test failed), the plugin version and the OS. Never prompts, code, commands or paths; a test intercepts every request and fails otherwise.
> - The server is the only authority: `crypto.randomInt`, money operations in Postgres transactions with row locks (tested with 150 concurrent bets), idempotent turns.
> - GitHub login is the Device Flow brokered by the server; the GitHub token is discarded right after reading the public profile.
> - Every HTTP/WebSocket message is a zod schema shared by server, web and plugin; the protocol docs are generated from them and checked in CI.
> - Fastify + Drizzle + Three.js, AGPL, self-hostable with one compose file.
>
> Install: `/plugin install vibe-gambling --marketplace Aimarmndz/vibe-gambling`, then `/vibe-login`.
>
> Happy to answer questions about the PS1 pipeline (no `noperspective` in WebGL2, so affine UVs are done by hand) or anything else.

## r/ClaudeAI

**Title:** I turned every Claude Code prompt into a roulette spin (PS1 graphics, fake coins, global leaderboard of broke devs)

**Body:**

> Vibe coding already felt like gambling, so I removed the "felt like".
>
> **vibe-gambling** is a Claude Code plugin. Send a prompt → a PS1-style roulette window pops up → the wheel spins while Claude works → the ball drops when the turn ends.
>
> - Bet in the window or with `/bet 200 red`, `/all-in`, `/balance`
> - `git push` succeeded during the turn? Winnings ×2. Push to prod = bonus.
> - Broke? The Ludo-Credit Express lends you 1,000 coins at 4,200 % APR.
> - Monthly leaderboard of the most broke devs + a Hall of Ruin
>
> **Fake coins only.** Nothing real is gambled, nothing can be bought. It's a parody.
>
> Privacy: the plugin never sends prompts, answers, code, commands or paths: only a random turn id, the duration, two yes/no flags (git push ok, test failed), the plugin version and the OS. There's a test that enforces it. It never slows a turn down (1.5 s timeout, everything in the background).
>
> Install:
>
> ```
> /plugin install vibe-gambling --marketplace Aimarmndz/vibe-gambling
> /vibe-login
> ```
>
> Repo (AGPL, self-hostable): https://github.com/Aimarmndz/vibe-gambling · Leaderboard: https://vibe.aimar.dev
>
> Not affiliated with Anthropic. Made by [Aimar](https://github.com/Aimarmndz), who also makes useful things.

## r/ProgrammerHumor

Image/video post with the GIF.

**Title:** Vibe coding is gambling, so I made it official

**First comment (by OP):**

> It's a real Claude Code plugin: every prompt is a roulette spin, the ball drops when Claude finishes, `git push` pays ×2 and the loan shark charges 4,200 % APR. Fake coins only, nothing real is gambled. Leaderboard of the most broke devs: https://vibe.aimar.dev · Code: https://github.com/Aimarmndz/vibe-gambling

Alternative titles:

- "My AI pair programmer now has a casino attached. The house always wins, the tests never do."
- "Me waiting for Claude to finish: (PS1 roulette spinning)"
- "Finally, a use for the spinner"

## Twitter/X

**Thread:**

> 1/ Vibe coding is gambling. I just made it official.
>
> Every Claude Code prompt is now a spin of a PS1-style roulette. The wheel spins while Claude thinks; the ball drops when it's done. 🎰
>
> [GIF]

> 2/ Bet with the mouse or with /bet 200 red.
> git push during the turn? ×2.
> Broke? The Ludo-Credit Express lends you 1,000 coins at 4,200 % APR. Read the fine print.
> Monthly leaderboard of the most broke devs.

> 3/ Fake coins only. Nothing real is gambled, nothing can be bought. It's a parody.
>
> And the plugin never sends your prompts, code or commands: a random turn id, the duration and two booleans. There's a test for that.

> 4/ 320×240, wobbly vertices, affine textures, dithering, CRT, a made-up console boot screen and a memory card. Three.js, no external assets: textures, models and sounds are generated in code.

> 5/ Install:
> /plugin install vibe-gambling --marketplace Aimarmndz/vibe-gambling
>
> Code (AGPL): https://github.com/Aimarmndz/vibe-gambling
> Leaderboard: https://vibe.aimar.dev
>
> Made by me. I also make useful things: https://github.com/Aimarmndz

**Single tweet** (if no thread):

> Every Claude Code prompt is now a spin of a PS1 roulette. git push pays ×2, the loan shark charges 4,200 % APR, and there's a leaderboard of the most broke devs.
>
> Fake coins only 🎰
>
> https://github.com/Aimarmndz/vibe-gambling
