# config/

Configuración versionada de vibe-gambling. **Ningún valor de estos archivos está repetido en el código**: cada paquete los lee en su módulo de configuración y los valida con zod al arrancar (si algo falta o no cuadra, el proceso no arranca).

| Archivo     | Qué contiene                                                                                          | Esquema                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `game.json` | Números del juego: saldo inicial, fichas, préstamo y su TAE, jackpot, temporadas, giro mínimo, rachas | `gameConfigSchema` (`packages/shared`)                             |
| `site.json` | Textos de marca y enlaces: autor, repo, comando de instalación, ayuda real, otros proyectos           | `siteConfigSchema` (`packages/server`)                             |
| `web.json`  | Ajustes del cliente web: ping y reconexión del WebSocket, tiempos de la interfaz, ranking y modo demo | `webClientConfigSchema` (`packages/web`, se empaqueta en la build) |

Las variables de entorno (URLs, puertos, secretos, rate limits…) están en `deploy/.env.example`.
