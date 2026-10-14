// SPDX-License-Identifier: AGPL-3.0-or-later
// GENERADO por scripts/gen-locales.ts a partir de locales/es/mod.json. No lo edites a mano.
import type { ModTexts } from './locales.ts'

export const modTextsEs: ModTexts = {
  coin: '🪙',
  'color.red': 'rojo',
  'color.black': 'negro',
  'color.green': 'verde',
  debtLabel: 'deuda',
  statusOffline: '🎰 sin conexión',
  statusLogin: '🎰 /vibe-login',
  statusBadConfig: '🎰 config rota',
  loginHint:
    '🎰 Cada prompt es una tirada. Puedes perder el 100 %, pero también puedes ganar infinito. Usa /vibe-login para sentarte a la mesa.',
  jackpotTag: '🚀 JACKPOT',
  noRound: 'La ruleta giró sin ti. El FOMO viene incluido. Siguiente prompt, siguiente tirada.',
  pendingCount: '{count} pendientes',
  'pendingCount.one': '{count} pendiente',
  spinSaved: '🎰 Tirada guardada · {count} pendientes. Abre /roulette y dale a GIRAR.',
  'spinSaved.one': '🎰 Tirada guardada · {count} pendiente. Abre /roulette y dale a GIRAR.',
  spinDropped: '🎰 {count} tiradas pendientes es el tope: este prompt no se guarda',
  'spinDropped.one': '🎰 {count} tirada pendiente es el tope: este prompt no se guarda',
  pendingHint:
    '🎰 {count} tiradas pendientes (prompts con la ventana cerrada). Gástalas con GIRAR en /roulette.',
  'pendingHint.one':
    '🎰 {count} tirada pendiente (un prompt con la ventana cerrada). Gástala con GIRAR en /roulette.',
  'command.roulette.description': 'Abre la ventana de la ruleta (tu nuevo IDE)',
  'command.bet.description':
    'Apuesta monedas de mentira a la tirada actual o la siguiente. No es asesoramiento financiero',
  'command.bet.argumentHint': '<cantidad> <casilla>',
  'command.allIn.description':
    'Apuesta todo tu saldo (al rojo por defecto). Diversificar está sobrevalorado',
  'command.allIn.argumentHint': '[casilla]',
  'command.balance.description': 'Saldo, deuda, patrimonio y puesto. Siéntate antes de mirarlo',
  'command.login.description': 'Entra con GitHub (código de dispositivo). Sin KYC y sin depósito',
  'command.logout.description': 'Cierra la sesión de vibe-gambling (te esperamos)',
  'command.hide.description': 'Ocúltate del ranking público. Vergüenza con opt-out',
  'command.show.description': 'Vuelve a aparecer en el ranking público. Sin vergüenza',
  'command.server.description': 'Muestra o cambia el servidor de vibe-gambling (modo franquicia)',
  'command.server.argumentHint': '[url|default]',
  'command.deleteAccount.description': 'Borra tu cuenta y todos sus datos. Sin comisión de salida',
  'command.deleteAccount.argumentHint': '<login>',
  notLoggedIn: 'No has entrado. Usa /vibe-login primero. Sin silla no hay tirada.',
  offline: '🎰 El casino no responde. Tus monedas están a salvo (nunca fueron de verdad).',
  serverError: 'El servidor dice que no: {detail}',
  badConfig: 'vibe-gambling está mal configurado: {errors}. Arréglalo en /config.',
  sessionExpired:
    'Tu sesión ha caducado. Vuelve a usar /vibe-login. Hasta las sesiones necesitan un descanso.',
  openingWindow: '🎰 Abriendo la mesa… hagan juego.',
  windowFailed:
    'No he podido abrir la ventana. ¿Hay algún navegador por ahí? Cuando lo haya, vuelve a usar /roulette.',
  betUsage: 'Uso: /bet <cantidad> <casilla>, p. ej. /bet 200 rojo, /apostar 50 17, /bet 100 1a12',
  allInUsage: 'Uso: /all-in [casilla], p. ej. /all-in negro',
  betBadAmount:
    '"{raw}" no es una cantidad. Solo monedas enteras (o "all-in"). La ruina fraccionada aún no está soportada.',
  betBadTarget: '"{raw}" es demasiado largo para ser una casilla de esta mesa.',
  betPlaced: '🎰 {amount} a {target} ({round}). Saldo: {balance}.',
  'betRound.current': 'esta tirada',
  'betRound.next': 'la siguiente',
  insufficientFunds: 'No te llega. El Ludo-Crédito Express te espera en la ventana, si te atreves.',
  tooManyBets: 'Demasiadas fichas para una tirada. Hasta los ludópatas tienen límites.',
  invalidBet:
    '"{target}" no es una casilla de esta mesa. Prueba con un número, un color o una docena.',
  balance: '🎰 Saldo {balance} · Deuda {debt} · Patrimonio {netWorth} · {rank}',
  rankHidden: 'oculto del ranking',
  rankNone: 'aún sin puesto',
  rankNewAccount: 'en el ranking desde el {date} (cuenta de GitHub nueva)',
  alreadyLoggedIn: 'Ya has entrado como @{login}. Usa /vibe-logout antes para cambiar.',
  loginPrompt:
    '🎰 Ve a {uri} y escribe {code}. Tienes {minutes} min; yo voy comprobando en segundo plano.',
  loginInProgress: 'Sigo esperando: ve a {uri} y escribe {code}.',
  loginWelcome:
    '🎰 Bienvenido a la mesa, @{login}. Riesgo: 100 %. Potencial: infinito. Dinero de verdad: ninguno.',
  loginPublicNotice:
    'Ojo: apareces en el ranking público (usuario y avatar). Usa /vibe-hide para desaparecer.',
  loginNewAccount:
    'Tu cuenta de GitHub tiene menos de {days} días: juegas igual y sales en el ranking público (usuario y avatar) desde el {date}. Usa /vibe-hide si no quieres salir.',
  loginExpired: 'El código ha caducado. Usa /vibe-login para pedir otro.',
  loginDenied: 'Has cancelado el login en GitHub. La mesa esperará. Siempre espera.',
  loginFailed:
    'El login se ha cortado: el servidor dice "{detail}". Usa /vibe-login para volver a intentarlo.',
  loggedOut: '🎰 Sesión cerrada. La ruleta te echará de menos (y seguirá girando igual).',
  notLoggedInLogout: 'No habías entrado. Misión cumplida igualmente.',
  hidden: '🎰 Estás oculto del ranking (y del Salón de la Ruina). Ruina, ahora en privado.',
  shown: '🎰 Vuelves al ranking. La vergüenza vuelve a ser pública.',
  serverCurrent: '🎰 Servidor: {url}{name}{state}',
  serverNameSuffix: ' — {name}',
  'serverState.unreachable': ' (no responde)',
  'serverState.official': ' (oficial)',
  'serverState.selfHosted': ' (self-host)',
  serverBadUrl: '"{raw}" no es una URL http(s).',
  serverNeedsHttps:
    '"{raw}" va por http sin cifrar: tu token de sesión viajaría en claro. Usa https (http solo vale para localhost).',
  serverUnreachable: 'No he podido llegar a {url}/api/meta. No cambio de servidor.',
  serverIncompatible:
    '{url} habla el protocolo v{protocol} y este mod el v{expected}. No cambio de servidor.',
  serverChanged: '🎰 Ahora juegas en {url} — {name}{state}. Entra ahí con /vibe-login.',
  serverChangeDenied: 'No he podido guardar el servidor: {reason}',
  officialTag: 'oficial',
  selfHostedTag: 'self-host',
  deleteUsage:
    'Esto borra tu cuenta y todas tus tiradas para siempre. Para confirmarlo escribe: /vibe-delete-account {login}',
  deleteMismatch: 'Ese no es tu usuario. No he borrado nada.',
  deleted: '🎰 Cuenta borrada. No queda nada. La casa te agradece tu visita.',
  dailyLimit: '🎰 Tope diario de tiradas alcanzado · la mesa reabre a las {time}',
  'command.invite.description': 'Tu enlace de afiliado y las cuentas de tu pirámide',
  'command.redeem.description': 'Canjea el código de quien te invitó (bono de bienvenida)',
  'command.redeem.argumentHint': '<código>',
  inviteHeader: '🔺 Programa de Afiliados Piramidal (legalmente distinto)',
  inviteLink: 'Tu enlace: {url} · código {code}',
  inviteStats:
    'Invitados {invited} · activados {activated} · en espera {waiting} · ganado {earned} 🪙 · esta temporada {commissions}/{cap} comisiones',
  inviteActivation:
    'Tu amigo cobra {bonus} 🪙 al canjearlo con /vibe-redeem {code}; tú, {commission} 🪙 cuando juegue {spins} tiradas. Invita a 3 amigos y deja de tenerlos.',
  inviteActivationAge:
    'Tu amigo cobra {bonus} 🪙 al canjearlo con /vibe-redeem {code}; tú, {commission} 🪙 cuando juegue {spins} tiradas y su cuenta de GitHub tenga {days} días. Invita a 3 amigos y deja de tenerlos.',
  inviteCanRedeem:
    '¿Te invitó alguien? /vibe-redeem <código> antes del {date} y cobras {bonus} 🪙.',
  inviteRedeemed: 'Entraste por invitación: +{bonus} 🪙 de bienvenida.',
  redeemUsage: 'Uso: /vibe-redeem <código>, p. ej. /vibe-redeem ABCD2345 (también vale el enlace)',
  redeemBadCode:
    '"{raw}" no es un código de afiliado (8 letras y números, sin 0, 1, I, L, O ni U).',
  redeemed:
    '🔺 Código canjeado: +{bonus} 🪙 de bienvenida. Saldo: {balance}. Bienvenido a la pirámide de @{login}.',
  redeemedAnon:
    '🔺 Código canjeado: +{bonus} 🪙 de bienvenida. Saldo: {balance}. Bienvenido a la pirámide (su cima prefiere el anonimato).',
  'redeemRejected.not_found': 'Ese código no existe. ¿Seguro que tu amigo sí?',
  'redeemRejected.own_code':
    'Ese es tu propio código. Autorreferirse es la base de toda pirámide, pero de esta no.',
  'redeemRejected.already_redeemed': 'Ya canjeaste un código. A la pirámide solo se entra una vez.',
  'redeemRejected.cycle':
    'Esa persona entró con tu código: no te puede invitar alguien a quien invitaste tú.',
  'redeemRejected.too_late':
    'Tu cuenta ya no es nueva: el bono de bienvenida es solo para tus primeros días.',
  'redeemRejected.too_many_spins':
    'Ya has jugado demasiadas tiradas: el bono de bienvenida es solo para recién llegados.',
  'command.shop.description':
    'TIENDA: ventajas que no existen, con la letra pequeña honesta. La casa siempre gana',
  'command.shop.argumentHint': '[buy <objeto>]',
  'command.use.description': 'Arma o desarma un objeto del bolsillo para la próxima tirada',
  'command.use.argumentHint': '<objeto> [off]',
  'item.rabbit_foot': 'Pata de Conejo™',
  'item.oracle': 'VibeOracle (Predicción IA)',
  'item.insurance': 'Seguro a Todo Riesgo',
  'item.turbo': 'Turbo Pleno ×2',
  'item.streak_helmet': 'Casco de Racha',
  'item.revert': 'git revert HEAD~1',
  'item.felt_memory_blue': 'Tapete Memory Card',
  'item.felt_montecarlo97': "Tapete Montecarlo '97",
  'item.felt_dark_mode': 'Tapete Modo Oscuro',
  'item.felt_vaporwave': 'Tapete Vaporwave',
  'item.chips_floppy': 'Fichas Disquete 3½',
  'item.chips_cinco_duros': 'Fichas Cinco Duros',
  'item.chips_bottle_cap': 'Fichas Chapa',
  'itemTag.rabbit_foot': 'no hace nada, pero con mucha convicción',
  'itemTag.oracle': 'otra tirada de la ruleta disfrazada de IA',
  'itemTag.insurance': 'devuelve parte de lo perdido en exteriores (con franquicia)',
  'itemTag.turbo': 'duplica tu único pleno (un número, una fe)',
  'itemTag.streak_helmet': 'una derrota no rompe tu racha (le pone un asterisco)',
  'itemTag.revert': 'el seguro que se contrata después del accidente',
  'itemTag.felt_memory_blue': 'azul de tarjeta de memoria',
  'itemTag.felt_montecarlo97': 'lujo de 32 bits',
  'itemTag.felt_dark_mode': 'por fin la ruleta en modo oscuro',
  'itemTag.felt_vaporwave': 'A E S T H E T I C',
  'itemTag.chips_floppy': '1,44 MB de pérdidas',
  'itemTag.chips_cinco_duros': 'nostalgia en pesetas',
  'itemTag.chips_bottle_cap': 'la moneda oficial del recreo',
  shopHeader:
    '🛒 TIENDA · temporada {season} · los consumibles caducan el {date}, como los yogures',
  shopClosedNote: 'La tienda está cerrada: solo se venden cosméticos (el mal gusto nunca cierra).',
  shopCharges: '{count} cargas',
  'shopCharges.one': '{count} carga',
  shopBought: '{bought}/{max} esta temporada',
  shopSoldOut: 'AGOTADO esta temporada',
  shopOwned: 'tuyo',
  shopEdge: 'devuelve de media ≤ {max} por carga: la casa gana ≥ {edge}',
  shopEdgePlacebo: 'devuelve 0: la casa gana {edge} por carga (o sea, todo)',
  shopEdgeRevert: 'devuelve ≤ {max}: la casa gana ≥ {edge}, siempre',
  shopEdgeCosmetic: 'EV −{edge}; lo único que sobrevive a la temporada es tu mal gusto',
  shopCosmetics: '🎨 Cosméticos (para siempre):',
  shopPocket: '🎒 Bolsillo: {items}',
  shopPocketEmpty: '🎒 Bolsillo vacío. Es lo más rentable que vas a ver hoy.',
  pocketArmed: 'armado',
  shopRevert: '↩ git revert disponible: devolvería {refund} 🪙 (cuesta {price}) hasta las {time}.',
  shopBorrow:
    '¿No te llega? ¿Financiamos tu pata de conejo? El Ludo-Crédito Express presta en /roulette.',
  shopFooter:
    'Compra con /vibe-shop buy <objeto> · arma con /vibe-use <objeto> [off]. La casa siempre gana; aquí, al menos, te lo decimos.',
  shopUsage: 'Uso: /vibe-shop [buy <objeto>], p. ej. /vibe-shop buy pata',
  shopUnknownItem:
    '"{raw}" no está en el catálogo. Prueba con pata, oráculo, seguro, turbo, casco, revert, vaporwave o disquete.',
  bought: '🛒 {name} ×{charges} por {price} 🪙. Saldo: {balance}. Ármalo con /vibe-use {alias}.',
  boughtCosmetic:
    '🎨 {name} es tuyo para siempre por {price} 🪙. Saldo: {balance}. Póntelo en el ARMARIO de /roulette.',
  boughtRevert:
    '↩ git revert HEAD~1: pagas {price}, recuperas {refund}. Saldo: {balance}. Ni el historial ni los intereses se deshacen.',
  buyNoFunds:
    'No te llega para {name}. ¿Lo financiamos? El Ludo-Crédito Express te espera en /roulette.',
  buySoldOut:
    'Ya has comprado todos los {name} de esta temporada. Hasta la casa tiene stock limitado (de vergüenza, no).',
  buyOwned: '{name} ya es tuyo. El mal gusto no se acumula.',
  buyNothingToRevert:
    'Nada que revertir: tu última ronda no perdió, la ventana ya se cerró o ya gastaste el revert de esta temporada.',
  shopClosed: 'La tienda está cerrada. Por una vez, la casa no te vende nada.',
  shopCooldown: 'Calma: una compra cada poco. Ni las tiendas de verdad cobran tan rápido.',
  useUsage: 'Uso: /vibe-use <objeto> [off], p. ej. /vibe-use pata o /vibe-use seguro off',
  useNotConsumable:
    '{name} no se arma: los cosméticos se equipan en el ARMARIO de /roulette y git revert se usa al comprarlo.',
  armed: '🎒 {name} armado ({charges} cargas). Actúa en la próxima tirada con fichas.',
  disarmed: '🎒 {name} desarmado. Sus cargas te esperan hasta fin de temporada.',
  armConflict: 'No puedo armar {name}: no te quedan cargas o ya llevas el máximo armado.',
  balanceArmed: '🎒 Armado: {items}',
  balancePocket: '🎒 En el bolsillo sin armar: {items} (/vibe-use <objeto>)',
  'effect.placebo': '🐇 +∞% SUERTE',
  'effect.predictionHit': '🔮 La IA predijo {n}: ¡ACIERTO! (1/37, como cualquiera)',
  'effect.predictionMiss': '🔮 La IA predijo {n}: falló (como siempre)',
  'effect.refund': '🛡 SEGURO {amount}',
  'effect.boost': '⚡ TURBO ×2 {amount}',
  'effect.boostMiss': '⚡ Turbo: el pleno no entró',
  'effect.shield': '⛑ Casco: racha salvada (con asterisco)',
}
