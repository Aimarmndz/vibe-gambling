// SPDX-License-Identifier: AGPL-3.0-or-later
// GENERADO por scripts/gen-locales.ts a partir de locales/en/mod.json. No lo edites a mano.
import type { ModTexts } from './locales.ts'

export const modTextsEn: ModTexts = {
  coin: '🪙',
  'color.red': 'red',
  'color.black': 'black',
  'color.green': 'green',
  debtLabel: 'debt',
  statusOffline: '🎰 offline',
  statusLogin: '🎰 /vibe-login',
  statusBadConfig: '🎰 bad config',
  loginHint:
    '🎰 Every prompt is a spin. Risk: 100%. Upside: infinite. Run /vibe-login to take a seat at the table.',
  jackpotTag: '🚀 JACKPOT',
  noRound: 'The wheel spun without you. FOMO is part of the product. Next prompt, next spin.',
  pendingCount: '{count} pending',
  'pendingCount.one': '{count} pending',
  spinSaved: '🎰 Spin saved for later · {count} pending. Open /roulette and hit SPIN.',
  'spinSaved.one': '🎰 Spin saved for later · {count} pending. Open /roulette and hit SPIN.',
  spinDropped: '🎰 {count} pending spins is the limit: this prompt was not saved',
  'spinDropped.one': '🎰 {count} pending spin is the limit: this prompt was not saved',
  pendingHint:
    '🎰 {count} pending spins (prompts with the window closed). Spend them with SPIN in /roulette.',
  'pendingHint.one':
    '🎰 {count} pending spin (a prompt with the window closed). Spend it with SPIN in /roulette.',
  'command.roulette.description': 'Open the roulette window (your new IDE)',
  'command.bet.description': 'Bet fake coins on the current or next spin. Not financial advice',
  'command.bet.argumentHint': '<amount> <square>',
  'command.allIn.description':
    'Bet your whole balance (red by default). Diversification is overrated',
  'command.allIn.argumentHint': '[square]',
  'command.balance.description': 'Balance, debt, net worth and rank. Brace yourself',
  'command.login.description': 'Log in with GitHub (device code). No KYC, no deposit',
  'command.logout.description': "Log out of vibe-gambling (we'll wait)",
  'command.hide.description': 'Hide from the public leaderboard. Shame, now opt-out',
  'command.show.description': 'Show up on the public leaderboard again. Shameless',
  'command.server.description': 'Show or change the vibe-gambling server (franchise mode)',
  'command.server.argumentHint': '[url|default]',
  'command.deleteAccount.description': 'Delete your account and all its data. No exit fees',
  'command.deleteAccount.argumentHint': '<login>',
  notLoggedIn: "You're not logged in. Run /vibe-login first. No seat, no spin.",
  offline:
    '🎰 The casino is unreachable right now. Your fake coins are safe (they were never real).',
  serverError: 'The server said no: {detail}',
  badConfig: 'vibe-gambling is misconfigured: {errors}. Fix it in /config.',
  sessionExpired: 'Your session expired. Run /vibe-login again. Even sessions need a break.',
  openingWindow: '🎰 Opening the table… place your bets.',
  windowFailed:
    "Couldn't open the window. Is there a browser around? Run /roulette again once there is.",
  betUsage: 'Usage: /bet <amount> <square>, e.g. /bet 200 red, /bet 50 17, /bet 100 1st12',
  allInUsage: 'Usage: /all-in [square], e.g. /all-in black',
  betBadAmount:
    '"{raw}" is not an amount. Whole fake coins only (or "all-in"). Fractional ruin is not supported.',
  betBadTarget: '"{raw}" is too long to be a square on this table.',
  betPlaced: '🎰 {amount} on {target} ({round}). Balance: {balance}.',
  'betRound.current': 'this spin',
  'betRound.next': 'next spin',
  insufficientFunds:
    "Not enough fake coins. The Ludo-Credit Express is in the window, if you're brave.",
  tooManyBets: 'Too many chips on the table for one spin. Even addicts have limits.',
  invalidBet: '"{target}" is not a square on this table. Try a number, a colour or a dozen.',
  balance: '🎰 Balance {balance} · Debt {debt} · Net worth {netWorth} · {rank}',
  rankHidden: 'hidden from the leaderboard',
  rankNone: 'not ranked yet',
  rankNewAccount: 'on the leaderboard from {date} (new GitHub account)',
  alreadyLoggedIn: "You're already logged in as @{login}. /vibe-logout first to switch.",
  loginPrompt:
    "🎰 Go to {uri} and enter {code}. You have {minutes} min; I'll keep checking in the background.",
  loginInProgress: 'Still waiting: go to {uri} and enter {code}.',
  loginWelcome:
    '🎰 Welcome to the table, @{login}. Risk: 100%. Upside: infinite. Real money: none.',
  loginPublicNotice:
    'Heads-up: you appear on the public leaderboard (login and avatar). /vibe-hide to vanish.',
  loginNewAccount:
    'Your GitHub account is under {days} days old: you play as usual and show up on the public leaderboard (login and avatar) from {date}. /vibe-hide to stay off it.',
  loginExpired: 'The login code expired. Run /vibe-login to get a new one.',
  loginDenied: 'GitHub login was cancelled. The table will wait. It always does.',
  loginFailed: 'The login stopped: the server said "{detail}". Run /vibe-login to try again.',
  loggedOut: '🎰 Logged out. The wheel will miss you (it keeps spinning anyway).',
  notLoggedInLogout: "You weren't logged in. Mission accomplished anyway.",
  hidden: "🎰 You're hidden from the leaderboard (and the Hall of Ruin). Ruin, now in private.",
  shown: "🎰 You're back on the leaderboard. Shame is public again.",
  serverCurrent: '🎰 Server: {url}{name}{state}',
  serverNameSuffix: ' — {name}',
  'serverState.unreachable': ' (unreachable)',
  'serverState.official': ' (official)',
  'serverState.selfHosted': ' (self-hosted)',
  serverBadUrl: '"{raw}" is not an http(s) URL.',
  serverNeedsHttps:
    '"{raw}" uses plain http: your session token would travel in clear text. Use https (http is only for localhost).',
  serverUnreachable: "Couldn't reach {url}/api/meta. Server not changed.",
  serverIncompatible:
    '{url} speaks protocol v{protocol}, this mod speaks v{expected}. Server not changed.',
  serverChanged: '🎰 Now playing at {url} — {name}{state}. Log in there with /vibe-login.',
  serverChangeDenied: "Couldn't save the server: {reason}",
  officialTag: 'official',
  selfHostedTag: 'self-hosted',
  deleteUsage:
    'This deletes your account and every spin, forever. To confirm, type: /vibe-delete-account {login}',
  deleteMismatch: "That's not your login. Nothing was deleted.",
  deleted: '🎰 Account deleted. All data is gone. The house thanks you for playing.',
  dailyLimit: '🎰 Daily spin limit reached · the table reopens at {time}',
}
