# Security policy

vibe-gambling only handles fake coins, but it still has accounts, session tokens and a public server, so security reports are very welcome.

## Supported versions

| Version                                         | Supported                   |
| ----------------------------------------------- | --------------------------- |
| Latest release (`v0.x`) and `main`              | ✅                          |
| Older releases                                  | ❌ (please update first)    |
| Self-hosted instances running modified versions | Report it to their operator |

The official instance (`https://vibe.aimar.dev`) always runs the latest release.

## Reporting a vulnerability

**Please do not open a public issue, pull request or discussion for security problems.**

Use GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue: affected component (`server`, `web`, `mod`, deployment files), steps to reproduce, impact and, if you have one, a suggested fix.

Only the maintainers can see the report. If private reporting is not available for some reason, contact the author through his GitHub profile ([github.com/Aimarmndz](https://github.com/Aimarmndz)) and ask for a private channel, **without** including the details of the vulnerability in a public place.

## What to expect

- An acknowledgement within **7 days**.
- A first assessment (confirmed or not, severity) within **14 days**.
- A fix released as soon as reasonably possible, coordinated with you. Once it is out, a GitHub security advisory is published, crediting you if you want.

This is a hobby project maintained by one person: there is no bug bounty, but there is eternal gratitude and a mention in the advisory.

## Scope

In scope:

- Authentication and sessions (GitHub Device Flow, one-time link codes, cookies, mod tokens).
- Anything that lets someone change another user's balance, bets or settings, or the result of a spin.
- Data leaks beyond what [the privacy policy](docs/PRIVACIDAD.md) says is stored, and anything that makes the mod send more than `turnId`, turn duration, the two booleans, the plugin version and the generic OS.
- Injection (SQL, XSS, CSP bypasses), WebSocket origin checks, rate limit bypasses that enable abuse.
- The Docker image and the deployment files in `deploy/`.

Out of scope:

- "I won a lot of fake coins" without a bug behind it (that's just luck; the house will get you next spin).
- Denial of service by sheer volume, and reports from automated scanners without a working proof of concept.
- Vulnerabilities in self-hosted instances caused by their own configuration.
- Social engineering and physical attacks.

## Resumen en español

Para avisar de un fallo de seguridad **no abras un issue público**: usa la pestaña **Security → Report a vulnerability** del repositorio (aviso privado de GitHub, solo lo ven los mantenedores). Se responde en 7 días como máximo y se publica un aviso de seguridad cuando el arreglo esté disponible. Solo se da soporte a la última versión y a `main`.
