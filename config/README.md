# config/

Configuración versionada de vibe-gambling. **Ningún valor de estos archivos está repetido en el código**: cada paquete los lee en su módulo de configuración y los valida con zod al arrancar (si algo falta o no cuadra, el proceso no arranca).

| Archivo     | Qué contiene                                                                                                                                                                                       | Esquema                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `game.json` | Números del juego: saldo inicial, fichas, préstamo y su TAE, jackpot, temporadas, giro mínimo, rachas, edad mínima de la cuenta de GitHub para el ranking, programa de afiliados, TIENDA (`items`) | `gameConfigSchema` (`packages/shared`)                             |
| `site.json` | Textos de marca y enlaces: autor, repo, comando de instalación, ayuda real, otros proyectos y los datos de la instancia para `/privacy` (`instance`, ver `docs/SELF-HOSTING.md`)                   | `siteConfigSchema` (`packages/server`)                             |
| `web.json`  | Ajustes del cliente web: ping y reconexión del WebSocket, tiempos de la interfaz, ranking, modo demo y renderers WebGL por software (aviso de aceleración por hardware)                            | `webClientConfigSchema` (`packages/web`, se empaqueta en la build) |

Las variables de entorno (URLs, puertos, secretos, rate limits…) están en `deploy/.env.example`.

## La TIENDA (`game.json` → `items`)

| Clave                                  | Qué es                                                                                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                              | Si la tienda está abierta. Cerrada, no se compra ni se arma ningún consumible (los cosméticos se siguen vendiendo y equipando).                                                                     |
| `purchaseCooldownMs`                   | Tiempo mínimo entre dos compras del mismo jugador (antiabuso).                                                                                                                                      |
| `maxArmed`                             | Consumibles armados a la vez como mucho.                                                                                                                                                            |
| `rabbitFoot`, `oracle`, `streakHelmet` | `price` (por compra), `charges` (cargas por compra: una por ronda jugada con el objeto armado) y `maxPerSeason` (compras por temporada). No pagan nada.                                             |
| `insurance`                            | Además, `refundRate` (parte devuelta de las apuestas exteriores perdidas, 0–1) y `coverCap` (lo asegurado por ronda, a prorrata). Tiene que cumplir `price/charges ≥ refundRate·coverCap·25/37`.    |
| `turbo`                                | Además, `multiplier` (de la ganancia del único pleno; no se suma al jackpot) y `coverCap` (parte del pleno que se multiplica). Tiene que cumplir `price/charges ≥ 35·(multiplier − 1)·coverCap/37`. |
| `revert`                               | `git revert HEAD~1`: `price`, `maxRefund` (tiene que ser menor que `price`), `windowMs` (cuánto dura la ocasión desde que se enseña la ronda) y `maxPerSeason`.                                     |
| `cosmetics`                            | `feltPrice` (cada tapete) y `chipsPrice` (cada juego de fichas). Son para siempre.                                                                                                                  |

**La casa siempre gana**: las condiciones de `insurance`, `turbo` y `revert` las comprueba zod al arrancar. Si una configuración haría que un objeto devolviera de media más de lo que cuesta, el servidor no arranca y dice qué número cambiar. Los ids del catálogo (`rabbit_foot`, `felt_vaporwave`…) son de la lógica, no de la configuración: están en `packages/shared/src/game/items.ts`.
