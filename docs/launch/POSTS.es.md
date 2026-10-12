# Posts de lanzamiento (español)

Borradores. **No se publica nada.** Enlaces: repo `https://github.com/Aimarmndz/vibe-gambling`, web `https://vibe.aimar.dev`, perfil `https://github.com/Aimarmndz`. Adjunta `docs/demo.gif` (o el vídeo de 30 s) donde se pueda. Dilo siempre: parodia, monedas falsas, aquí no se apuesta nada real.

Hacker News, r/ClaudeAI y r/ProgrammerHumor son en inglés: usa [POSTS.en.md](POSTS.en.md). Estos son para Twitter/X en español y comunidades hispanohablantes (Discord, Telegram, foros, LinkedIn si te atreves).

## "Show HN" en español (para foros o comunidades dev)

**Título:** vibe-gambling: cada prompt de Claude Code es una tirada de ruleta estilo PS1

> Me pasaba el rato mirando el spinner mientras Claude Code trabajaba, esperando que saliera bien. Eso es una tragaperras. Así que lo he convertido en una.
>
> vibe-gambling es un plugin de Claude Code: al mandar un prompt se abre una ventana con una ruleta low-poly estilo PlayStation 1 (320×240, vértices que tiemblan, texturas afines, dithering, filtro CRT, un arranque de consola inventada y memory card). La ruleta gira mientras Claude piensa y la bola cae cuando termina. Apuestas con el ratón o con `/apostar 200 rojo`. Si en el turno hubo un `git push` con éxito, las ganancias pagan doble. Cuando te arruinas, el Ludo-Crédito Express te presta 1.000 monedas a una TAE del 4.200 %. Hay ranking mensual de los devs más arruinados y un Salón de la Ruina.
>
> **Solo monedas falsas.** No se compra nada, no hay dinero real ni enlaces a casas de apuestas. Es una parodia.
>
> El chiste está por fuera; por dentro he intentado que esté impecable:
>
> - El plugin manda un id de turno aleatorio, la duración, dos booleanos (git push ok / test fallido), la versión y el SO. Nunca prompts, código, comandos ni rutas; hay un test que intercepta cada petición y falla si no.
> - El servidor es la única autoridad: `crypto.randomInt`, operaciones de dinero en transacciones de Postgres con bloqueo de fila (probado con 150 apuestas simultáneas), turnos idempotentes.
> - Login con el Device Flow de GitHub a través del servidor; el token de GitHub se tira nada más leer el perfil público.
> - Cada mensaje HTTP/WebSocket es un esquema zod compartido por servidor, web y plugin; la documentación del protocolo se genera a partir de ellos y se comprueba en el CI.
> - Fastify + Drizzle + Three.js, AGPL, autoalojable con un compose.
>
> Instalación: `/plugin install vibe-gambling --marketplace Aimarmndz/vibe-gambling` y luego `/vibe-login`.
>
> Código: https://github.com/Aimarmndz/vibe-gambling · Ranking: https://vibe.aimar.dev

## Twitter/X

**Hilo:**

> 1/ El vibe coding es ludopatía. Lo he hecho oficial.
>
> Ahora cada prompt de Claude Code es una tirada de ruleta estilo PS1. Gira mientras Claude piensa y la bola cae cuando termina. 🎰
>
> [GIF]

> 2/ Apuestas con el ratón o con /apostar 200 rojo.
> ¿git push en el turno? ×2.
> ¿Sin blanca? El Ludo-Crédito Express te presta 1.000 monedas al 4.200 % TAE. Lee la letra pequeña.
> Ranking mensual de los devs más arruinados.

> 3/ Solo monedas falsas. No se apuesta nada real ni se puede comprar nada. Es una parodia.
>
> Y el plugin no manda tus prompts, tu código ni tus comandos: un id de turno, la duración y dos booleanos. Hay un test que lo comprueba.

> 4/ 320×240, vértices que tiemblan, texturas afines, dithering, CRT, arranque de una consola inventada y memory card. Three.js y nada de assets externos: texturas, modelos y sonidos salen del código.

> 5/ Instalación:
> /plugin install vibe-gambling --marketplace Aimarmndz/vibe-gambling
>
> Código (AGPL): https://github.com/Aimarmndz/vibe-gambling
> Ranking: https://vibe.aimar.dev
>
> Hecho por mí. También hago cosas útiles: https://github.com/Aimarmndz

**Tuit suelto:**

> Cada prompt de Claude Code es ahora una tirada de ruleta de PS1. El git push paga ×2, el prestamista cobra un 4.200 % TAE y hay ranking de los devs más arruinados.
>
> Solo monedas falsas 🎰
>
> https://github.com/Aimarmndz/vibe-gambling

## Mensaje corto (Discord, Telegram, grupos)

> He hecho una tontería muy seria: un plugin de Claude Code que convierte cada prompt en una tirada de ruleta estilo PS1. La ruleta gira mientras Claude piensa, el `git push` paga doble y hay ranking de los más arruinados. Monedas falsas, cero datos de tu código. https://github.com/Aimarmndz/vibe-gambling
