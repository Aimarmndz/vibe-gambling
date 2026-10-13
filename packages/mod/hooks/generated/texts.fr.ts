// SPDX-License-Identifier: AGPL-3.0-or-later
// GENERADO por scripts/gen-locales.ts a partir de locales/fr/mod.json. No lo edites a mano.
import type { ModTexts } from './locales.ts'

export const modTextsFr: ModTexts = {
  coin: '🪙',
  'color.red': 'rouge',
  'color.black': 'noir',
  'color.green': 'vert',
  debtLabel: 'dette',
  statusOffline: '🎰 hors ligne',
  statusLogin: '🎰 /vibe-login',
  statusBadConfig: '🎰 config cassée',
  loginHint: '🎰 Chaque prompt est un tour de roue. Lance /vibe-login pour t’asseoir à la table.',
  jackpotTag: '🚀 JACKPOT',
  noRound: 'La roue a tourné sans toi. Prochain prompt, prochain tour.',
  pendingCount: '{count} en attente',
  'pendingCount.one': '{count} en attente',
  spinSaved: '🎰 Tour mis de côté · {count} en attente. Ouvre /roulette et clique sur LANCER.',
  'spinSaved.one':
    '🎰 Tour mis de côté · {count} en attente. Ouvre /roulette et clique sur LANCER.',
  spinDropped: '🎰 {count} tours en attente, c’est la limite : ce prompt n’a pas été gardé',
  'spinDropped.one': '🎰 {count} tour en attente, c’est la limite : ce prompt n’a pas été gardé',
  pendingHint:
    '🎰 {count} tours en attente (prompts envoyés fenêtre fermée). Joue-les avec LANCER dans /roulette.',
  'pendingHint.one':
    '🎰 {count} tour en attente (un prompt envoyé fenêtre fermée). Joue-le avec LANCER dans /roulette.',
  'command.roulette.description': 'Ouvre la fenêtre de la roulette',
  'command.bet.description': 'Mise des pièces fictives sur le tour en cours ou le suivant',
  'command.bet.argumentHint': '<montant> <case>',
  'command.allIn.description': 'Mise tout ton solde (sur le rouge par défaut)',
  'command.allIn.argumentHint': '[case]',
  'command.balance.description': 'Solde, dette, patrimoine et classement',
  'command.login.description': 'Se connecter avec GitHub (code d’appareil)',
  'command.logout.description': 'Se déconnecter de vibe-gambling',
  'command.hide.description': 'Disparaître du classement public',
  'command.show.description': 'Réapparaître dans le classement public',
  'command.server.description': 'Affiche ou change le serveur vibe-gambling',
  'command.server.argumentHint': '[url|default]',
  'command.deleteAccount.description': 'Supprime ton compte et toutes ses données',
  'command.deleteAccount.argumentHint': '<identifiant>',
  notLoggedIn: 'Tu n’es pas connecté. Lance d’abord /vibe-login.',
  offline:
    '🎰 Le casino ne répond pas pour l’instant. Tes pièces fictives sont à l’abri (elles n’ont jamais existé).',
  serverError: 'Le serveur a dit non : {detail}',
  badConfig: 'vibe-gambling est mal configuré : {errors}. Corrige ça dans /config.',
  sessionExpired: 'Ta session a expiré. Relance /vibe-login.',
  openingWindow: '🎰 Ouverture de la table…',
  windowFailed: 'Impossible d’ouvrir la fenêtre. Il y a un navigateur dans le coin ?',
  betUsage: 'Syntaxe : /bet <montant> <case>, p. ex. /bet 200 red, /bet 50 17, /bet 100 1st12',
  allInUsage: 'Syntaxe : /all-in [case], p. ex. /all-in black',
  betBadAmount:
    '« {raw} » n’est pas un montant. Pièces fictives entières uniquement (ou « all-in »).',
  betBadTarget: '« {raw} » est trop long pour être une case de cette table.',
  betPlaced: '🎰 {amount} sur {target} ({round}). Solde : {balance}.',
  'betRound.current': 'ce tour-ci',
  'betRound.next': 'le prochain tour',
  insufficientFunds:
    'Pas assez de pièces fictives. Le Ludo-Crédit Express t’attend dans la fenêtre, si tu l’oses.',
  tooManyBets: 'Trop de jetons sur la table pour un seul tour. Même les accros ont des limites.',
  invalidBet: '« {target} » n’est pas une case de cette table.',
  balance: '🎰 Solde {balance} · Dette {debt} · Patrimoine {netWorth} · {rank}',
  rankHidden: 'masqué du classement',
  rankNone: 'pas encore classé',
  rankNewAccount: 'au classement à partir du {date} (compte GitHub récent)',
  alreadyLoggedIn:
    'Tu es déjà connecté en tant que @{login}. Fais d’abord /vibe-logout pour changer.',
  loginPrompt:
    '🎰 Va sur {uri} et saisis {code}. Tu as {minutes} min ; je vérifie en arrière-plan.',
  loginInProgress: 'J’attends toujours : va sur {uri} et saisis {code}.',
  loginWelcome: '🎰 Bienvenue à la table, @{login}.',
  loginPublicNotice:
    'Attention : tu apparais dans le classement public (identifiant et avatar). /vibe-hide pour disparaître.',
  loginNewAccount:
    'Ton compte GitHub a moins de {days} jours : tu joues normalement et tu apparaîtras dans le classement public (identifiant et avatar) à partir du {date}. /vibe-hide pour ne pas y figurer.',
  loginExpired: 'Le code de connexion a expiré. Lance /vibe-login pour en avoir un nouveau.',
  loginDenied: 'La connexion GitHub a été annulée. La table t’attendra.',
  loginFailed:
    'La connexion s’est arrêtée : le serveur a répondu « {detail} ». Lance /vibe-login pour réessayer.',
  loggedOut: '🎰 Déconnecté. Tu vas manquer à la roue.',
  notLoggedInLogout: 'Tu n’étais pas connecté. Mission accomplie quand même.',
  hidden: '🎰 Tu es masqué du classement (et du Panthéon de la ruine).',
  shown: '🎰 Te revoilà dans le classement. La honte redevient publique.',
  serverCurrent: '🎰 Serveur : {url}{name}{state}',
  serverNameSuffix: ' — {name}',
  'serverState.unreachable': ' (injoignable)',
  'serverState.official': ' (officiel)',
  'serverState.selfHosted': ' (auto-hébergé)',
  serverBadUrl: '« {raw} » n’est pas une URL http(s).',
  serverNeedsHttps:
    '« {raw} » utilise http sans chiffrement : ton jeton de session circulerait en clair. Utilise https (http n’est accepté que pour localhost).',
  serverUnreachable: 'Impossible de joindre {url}/api/meta. Serveur inchangé.',
  serverIncompatible:
    '{url} parle le protocole v{protocol}, ce mod parle le v{expected}. Serveur inchangé.',
  serverChanged:
    '🎰 Tu joues maintenant sur {url} — {name}{state}. Connecte-toi là-bas avec /vibe-login.',
  serverChangeDenied: 'Impossible d’enregistrer le serveur : {reason}',
  officialTag: 'officiel',
  selfHostedTag: 'auto-hébergé',
  deleteUsage:
    'Ceci supprime ton compte et tous tes tours, pour toujours. Pour confirmer, tape : /vibe-delete-account {login}',
  deleteMismatch: 'Ce n’est pas ton identifiant. Rien n’a été supprimé.',
  deleted:
    '🎰 Compte supprimé. Toutes les données ont disparu. La maison te remercie d’avoir joué.',
  dailyLimit: '🎰 Limite quotidienne de tours atteinte · la table rouvre à {time}',
}
