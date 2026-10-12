# Diseño v2 — especificación visual

Especificación para programar los menús, las animaciones de espectáculo y la marca de la v2
(`.plan/12-v2-espectaculo-y-tiradas.md`). La estética de la v1 no cambia: misma paleta, Polygone 12,
framebuffer de 320×240, vertex snapping, dithering de 15 bits y CRT. La v2 añade carácter dentro de
ese lenguaje.

- **Pase de diseño (Claude Design, privado):** <https://claude.ai/artifact/DqpM5RMvjynZFnvWosyWGi>
  (páginas _Sistema_, _Menús_, _Animaciones_ y _Logo_). El de la v1 sigue en
  <https://claude.ai/artifact/BMC5jy91JbTEnkKcoYbXc8>.
- **Capturas:** `docs/design/v2/*.png`. Las pantallas están a ×3 (960×720) y los guiones gráficos a
  ×2 por fotograma, siempre con vecino más cercano. Son maquetas pintadas a 320×240 con la fuente real
  y la misma cuantización de 15 bits + Bayer 4×4 del juego; el fondo de la mesa es la captura real de
  la v1 reducida a 320×240.
- **Marca:** `docs/brand/` (ver [Logo](#logo)).

Todas las medidas de este documento son **píxeles del framebuffer de 320×240** salvo que se diga lo
contrario. Los tiempos son milisegundos.

## Reglas

1. **Todo dentro del framebuffer.** HUD, menús, rótulos y FX se pintan antes del dithering; nada en
   DOM encima (como en la v1).
2. **Movimiento en escalones.** Después de aplicar la curva, cada posición se redondea a píxel entero.
   El texto solo existe a escalas enteras (×1 … ×10): los "rebotes" de los rótulos son escalones de
   escala (p. ej. ×7 → ×6 → ×5), no interpolación. Fuego, parpadeos y bucles de sprites van a 15 fps.
3. **Siempre saltable.** ✕, ○ o clic: la primera pulsación lleva la animación a su estado final, la
   segunda la cierra. Ninguna bloquea el siguiente turno.
4. **Nunca destripa.** Ninguna animación muestra el número ni el saldo antes de `revealAt`. Todo lo que
   cuentan (premio, préstamo, pendientes) sale de mensajes del servidor.
5. **Movimiento reducido** (`prefers-reduced-motion`): sin sacudidas, sin parpadeos, sin lluvia de
   fichas ni llamas animadas, rótulos sin escalones; cada animación dura como mucho 1200 ms
   (`fx.reducedMaxMs`). Cada guion trae su versión reducida.
6. **Fotosensibilidad.** Como mucho un flash por resultado y nunca más de 3 destellos por segundo (el
   verde parpadea 3 veces en 960 ms). Nada de flashes rojos saturados.

## Paleta

La de la v1 no cambia (`packages/web/src/ui/palette.ts`):

| Token                       | Hex                               | Uso                                  |
| --------------------------- | --------------------------------- | ------------------------------------ |
| `ink`                       | `#08070D`                         | fondos, contornos, sombras de texto  |
| `menuTop` → `menuBottom`    | `#2B3FAE` → `#0D1240`             | ventanas (degradado vertical)        |
| `frame` / `frameInner`      | `#C9C3D8` / `#5A5F8A`             | marco biselado doble                 |
| `line`                      | `#3A3D60`                         | bordes de pozos y separadores        |
| `felt` / `feltDark`         | `#136B45` / `#0B4A2F`             | paño                                 |
| `red` / `black` / `green`   | `#C1272D` / `#1A1820` / `#17A05D` | casillas                             |
| `gold` / `goldDark`         | `#F2C14E` / `#A8761E`             | acento, selección, símbolos de mando |
| `cream`                     | `#F3EAD6`                         | texto                                |
| `muted`                     | `#9AA0C8`                         | etiquetas y ayuda                    |
| `win` / `loss`              | `#6EE08A` / `#FF5A6A`             | cifras positivas / negativas         |
| `alertTop` / `moneyTop`     | `#7A1420` / `#1D6B3A`             | ventanas de alerta / dinero          |
| `deepTop` / `jackpotBottom` | `#1B2368` / `#5A0D12`             | fondos de menú / sombras de rótulos  |
| `carpet` / `carpetLine`     | `#3A0F1C` / `#1C2A6A`             | moqueta                              |

Tokens nuevos de la v2 (añadir a `PALETTE`; solo espectáculo, iconos y marca):

| Token                      | Hex                   | Uso                                                |
| -------------------------- | --------------------- | -------------------------------------------------- |
| `goldHi`                   | `#FFE08A`             | brillo de los degradados oro, banda alta del fuego |
| `fire1` / `fire2`          | `#FF7A1F` / `#FFD04A` | llamas, degradado de MEGA WIN y ON FIRE            |
| `steel`                    | `#8D93B8`             | engranaje, piezas metálicas del cohete             |
| `patternInk`               | `#222C78`             | palos ♠♥♦♣ del fondo de los menús                  |
| `paperTop` / `paperBottom` | `#EFE6CC` / `#D9CBA6` | páginas de "Cómo se juega" y contrato              |
| `redHi` / `redLo`          | `#E0454A` / `#8F1B20` | bisel del canto de la ficha (marca e iconos)       |
| `creamLo`                  | `#CBBD98`             | sombra de las inserciones de la ficha              |
| `skin`                     | `#D9A07A`             | el banquero                                        |
| `chipBlue`                 | `#2B5FD9`             | ya existe en `CHIP_COLORS`; fichas que llueven     |

Degradados de rótulo (4 bandas horizontales a escalones, de arriba abajo, sobre la altura de las
mayúsculas):

- **Oro:** `#FFE08A`, `#F2C14E`, `#F2C14E`, `#A8761E` (BIG WIN, contador del pendiente, ¡PLENO!).
- **Fuego:** `#FFE08A`, `#FFD04A`, `#FF7A1F`, `#C1272D` (MEGA WIN, ON FIRE).
- **Verde:** `#C8F7D8`, `#6EE08A`, `#17A05D`, `#1D6B3A` (¡VERDE!, contadores de premio).
- **Rojo:** `#FF9AA4`, `#FF5A6A`, `#C1272D`, `#5A0D12` (BANCARROTA, deuda, falacia).

Los rótulos grandes llevan contorno de tinta de 1 px (2 px en MEGA WIN) y sombra dura de
`max(2, escala/2)` px en `jackpotBottom` (o tinta).

Contraste (WCAG 2.x): crema sobre tinta 16,8:1; oro sobre `#2B3FAE` 5,2:1; apagado sobre `#0D1240`
7:1, pero **3,4:1 sobre `#2B3FAE`**: el texto apagado no va en el tercio de arriba de una ventana.

## Curvas y tiempos

| Curva      | cubic-bezier          | Uso                                             |
| ---------- | --------------------- | ----------------------------------------------- |
| `outBack`  | `0.34, 1.56, 0.64, 1` | toasts que entran, sellos, la 7ª casilla        |
| `outCubic` | `0.33, 1, 0.68, 1`    | contadores que ruedan, la gráfica que se dibuja |
| `outExpo`  | `0.16, 1, 0.3, 1`     | ventanas que suben (terminal, contrato)         |
| `inQuad`   | `0.11, 0, 0.5, 0`     | salidas, cohete, ficha que vuela                |
| `step`     | —                     | escalas de texto: 3 escalones de 87 ms          |
| seno       | —                     | bob de iconos y respiración del cursor (bucles) |

Escala de tiempos: 40 (blip) · 80 (flash) · 180 (paso de odómetro) · 220 (entrada de toast) · 480
(barrido) · 1400–2200 (contador del premio) · 2600 (hold del premio) · 3200 (avisos, `ui.toastMs`).

## Orden de capas

| Capa | Contenido                                                       | ¿Tiembla? |
| ---- | --------------------------------------------------------------- | --------- |
| 0    | Mundo 3D (ruleta, mesa) en el render target de 320×240          | sí        |
| 1    | HUD fijo (paneles de saldo y racha/tiradas/pendientes)          | no        |
| 2    | Rótulo de estado, avisos, logros                                | no        |
| 3    | Menús y diálogos a pantalla completa                            | no        |
| 4    | FX 2D: flash, rayos, rótulos de espectáculo, llamas, contadores | sí        |
| 5    | FX 3D: iconos de menú, fichas que llueven, ficha que vuela      | sí        |
| 6    | Composición: color de 15 bits + Bayer 4×4 de todo lo anterior   | —         |
| 7    | CRT (desactivable)                                              | —         |

La capa 5 es un segundo pase 3D sobre el mismo render target, con el z-buffer limpio, el mismo
material PSX (vertex snapping, sombreado plano por cara) y su propia cámara, que se compone **después**
del canvas de la UI y **antes** del dithering. La sacudida es un desplazamiento entero de las capas
0, 4 y 5; el HUD y los menús no tiemblan.

## Configuración

Los tiempos van en `config/web.json` (propuesta; los nombres ya existentes se respetan) y los
umbrales que también afectan al servidor o al mod, en `config/game.json`.

Ya existen y se usan tal cual: `ui.toastMs` (3200), `ui.counterBumpMs` (450),
`ui.pendingNoticeDelayMs` (600), `spin.quickLandingMs` (900, caída de GIRAR TODAS),
`game.json` `pendingSpins.max` (100) y `pendingSpins.quickSpinMs` (ritmo del servidor),
`bigWin.minNetMultiple` (5) y `streak.colorWarningAt` (5, falacia).

Nuevos en `config/game.json`:

```json
{
  "bigWin": { "minNetMultiple": 5, "megaNetMultiple": 15 },
  "streak": { "colorWarningAt": 5, "historySize": 50, "onFireAt": 5 }
}
```

Nuevos en `config/web.json`:

```json
{
  "menu": { "wipeMs": 480, "cursorBreatheMs": 250, "iconSpinMs": 2400, "iconBobMs": 2000 },
  "fx": {
    "reducedMaxMs": 1200,
    "bigWin": {
      "flashMs": 80,
      "impactStepMs": 87,
      "countMs": { "big": 1400, "mega": 1800, "pleno": 2200 },
      "holdMs": 2600,
      "coins": { "big": 10, "mega": 26, "pleno": 26 },
      "gravityPxS2": 600
    },
    "green": { "blinkMs": 160, "blinks": 3, "chainMs": 600 },
    "push": { "terminalMs": 700, "rocketMs": 400, "stampMs": 400 },
    "loan": {
      "contractMs": 450,
      "signMs": 900,
      "stampMs": 250,
      "coinsMs": 900,
      "debtMs": 700,
      "finePrintPxPerS": 400
    },
    "bankrupt": { "desaturateMs": 600, "glitchMs": 600, "countFrom": 9, "tickMs": 1000 },
    "onFire": { "introMs": 1500 },
    "fallacy": { "holdMs": 3200 },
    "achievement": { "inMs": 220, "holdMs": 2800, "outMs": 200, "gapMs": 150 },
    "pending": { "rollMs": 180, "floatMs": 600, "flyMs": 400 }
  }
}
```

Los textos (rótulos, frases, nombres de logros) van a i18n, también "BIG WIN", "MEGA WIN" y
"ON FIRE" (se dejan en inglés en las dos lenguas, como en las máquinas).

## Menús

Plantilla común (todas las pantallas del menú):

- **Fondo:** degradado vertical `deepTop` → `ink` y una trama de palos ♠♥♦♣ (Polygone 12, ×1) en
  `patternInk`, rejilla de 24×22 px desplazada 12 px en filas alternas, que se desliza 8 px/s en
  diagonal.
- **Cabecera** (0–21): tinta al 55 % + degradado de menú al 92 %, línea `frame` en y = 21 y
  `frameInner` en y = 20. Icono 3D de la pantalla en (12, 11) a tamaño 7; título oro ×1 en x = 24,
  y = 7 con sombra de tinta; dato de contexto a la derecha (x = 314) en apagado.
- **Contenido:** ventanas biseladas de la v1 (`drawWindow`) con márgenes de 8 px. Lo no seleccionado
  va en **pozos**: tinta al 55 % + borde de 1 px `line`.
- **Selección:** banda `menuTop` + **esquinas oro** (brazos de 6 px y 2 de grosor, a 2 px por fuera;
  respiran a 3 px cada 250 ms, a saltos). Una sola selección por pantalla.
- **Ayuda inferior** (222–239): como la v1, pero los símbolos ✕ ○ △ □ y las flechas van en oro y las
  etiquetas en apagado, separados 10 px y centrados.
- **Transición:** barrido de bloques de 16×16 en diagonal (34 diagonales). 0–240 ms se tapa (la
  diagonal frontera en `menuTop` al 85 %), se cambia de pantalla en tinta y 240–480 ms se destapa en
  el mismo sentido. Movimiento reducido: corte seco.
- **Sonido:** mover = square 1320 Hz 40 ms (`move`); abrir = `accept` + barrido de ruido con paso
  banda 400 → 2400 Hz, 480 ms, ganancia 0,05; volver = `back`.

### Menú principal (`menu-main.png`)

- Rejilla de 5×2 tiles de 56×52, hueco 6, origen (8, 30). Orden: CONTINUAR (ficha), TIRADAS (pila de
  fichas), ESTADÍSTICAS (barras), LOGROS (copa), CLASIFICACIÓN (corona), BANCO (banco), MEMORY CARD,
  AJUSTES (engranaje), CÓMO SE JUEGA (libro), CRÉDITOS (gema POLYGONE).
- Seleccionado: ventana de menú + icono a tamaño 17 (unidades de malla → px), una vuelta cada
  `menu.iconSpinMs`, bob ±1,5 px con periodo `menu.iconBobMs`, brillo ×1,12. Resto: pozo, icono a 13,
  brillo ×0,72, quieto en su ángulo de 3/4.
- Insignias: TIRADAS con el número (caja roja con borde crema, texto crema); LOGROS con un punto oro
  de radio 2 si hay uno sin ver.
- Ventana de información (8, 150, 304×64): nombre ×2 oro en (18, 160), descripción crema en y = 182,
  pista apagada en y = 196; en TIRADAS, el número ×3 con degradado oro a la derecha y "DE 100".
- ←→↑↓ mueven (sin saltar de fila), ratón: pasar = seleccionar, clic = abrir; ✕ abre, ○ vuelve a la
  mesa. `aria-live`: "Tiradas, 20 pendientes".

### Tiradas pendientes (`menu-pending*.png`)

- **Reposo:** ventana (8, 28, 148×120) con la pila 3D (una ficha cada 2 pendientes, máx. 10) en
  (46, 92) a tamaño 19 y el número ×5 con degradado oro, contorno y sombra `jackpotBottom` centrado en
  x = 116; "PENDIENTES" debajo; "n/100" y "CADUCAN EN n D" en y = 116; barra de 130×4 en (17, 129).
  Ventana de cola (162, 28, 150×120): filas de 13 px con número, antigüedad y etiquetas PUSH ×2 (oro) y
  TESTS ✕ (`loss`) — el jackpot y la frase de tests se conservan al gastarla. Pozo "SE JUEGAN CON"
  (8, 152, 304×24). Botones de 148×34 en y = 182: ✕ GIRAR (1 tirada y su coste) y □ TODAS.
- **GIRAR TODAS:** ruleta a pantalla completa con caída de `spin.quickLandingMs`; ventana de progreso
  (8, 8, 304×34) con k/n ×2 y barra; ventana "ÚLTIMAS" (240, 50, 72×132) con las 7 últimas y su neto (la
  nueva arriba con marco oro). Se para sola en premio gordo, en el verde o en bancarrota (lo decide el
  servidor) y lo dice en una ventana verde ("PARADA: ¡PREMIO GORDO!"); ○ para.
- **Vacía:** ficha apagada y "Con la ventana abierta se juega en directo." En el tope, el número en
  rojo y "100 · LLENA".
- `aria-live`: "Tirada 7 de 20: 22 negro, menos 150". Movimiento reducido: sin ruleta, solo la lista.

### Estadísticas (`menu-stats.png`)

- Gráfica (8, 28, 304×98), área de trazado 280×70 en (16, 48), escala automática con mínimo ±500:
  línea en escalón de 1 px oro, cero en crema discontinuo (2 sí / 2 no), relleno al 35 % en `win`
  sobre 0 y `loss` bajo 0; ▼ crema en cada préstamo; punto oro de radio 2 y valor en la última
  tirada; "MÁX" arriba a la derecha.
- Tres fichas de 98×48 en y = 129: MÁS REPETIDO (casilla de su color de radio 10 con aro oro + "×n"),
  MAYOR PREMIO (neto ×2 en `win` + la apuesta), TIRADAS (×2 oro + mejor racha).
- ÚLTIMAS 18: casillas de 15×13 cada 16 px, la más reciente a la izquierda con marco oro.
- ←→ cambia de temporada. Los datos los da el servidor (historial de la temporada). Al entrar, la línea
  se dibuja de izquierda a derecha en 600 ms (`outCubic`).

### Logros (`menu-achievements.png`)

- Barra de 302×2 bajo la cabecera; lista (8, 33, 304×183) de filas de 29 px: copa 3D a tamaño 9
  (oro o `#4A4E78` si falta), nombre crema, descripción apagada, fecha a la derecha. Los contables
  llevan "n/meta" y barra de 56×3; los secretos, "???" hasta conseguirlos. La copa de la fila
  seleccionada gira (1 vuelta / 1,2 s). Barra de desplazamiento de 2 px en x = 306.

### Banco (`menu-bank.png`)

- Ventana de deuda (8, 28, 150×112) con degradado `alertTop` → `menuBottom`: DEUDA ×3 con degradado
  rojo; saldo, patrimonio, TAE e interés por tirada; abajo "SIGUIENTE TIRADA +n".
- Ventana (164, 28, 148×112) con el banco 3D girando a tamaño 26, nº de préstamos, días en números
  rojos y "DEVOLVER · NO EXISTE" (no hay forma de pagar la deuda).
- Historial (8, 144, 304×72): fecha, movimiento (PRÉSTAMO o INTERESES · n TIRADAS, agrupados por día)
  y deuda en `loss`. Sin saldo para la ficha mínima, la última fila de la ventana de deuda se cambia por
  "✕ PEDIR PRÉSTAMO" y lanza la secuencia del préstamo. La letra pequeña completa se lee aquí.

### Clasificación, Memory Card, Ajustes, Cómo se juega y Créditos

- **Clasificación** (`menu-ranking.png`): pestañas ARRUINADOS · RICOS · ADICTOS · SALÓN DE LA RUINA
  (la activa con fondo oro y texto tinta, el resto en pozos), cabecera de columnas en apagado, filas de
  15 px con avatar de 12×12 — el avatar de GitHub reducido con vecino más cercano y pasado por el
  dithering; en las capturas hay marcadores de posición —, tu fila con banda y esquinas. ✕ abre el
  perfil.
- **Memory Card** (`menu-memory.png`): 15 bloques de 56×36; el bloque 1 lleva la marca de 16 px a ×2
  como icono de guardado (el "\_" parpadea cada 500 ms). Resumen con logros y pendientes.
- **Ajustes** (`menu-settings.png`): filas de 18 px, interruptor de 22×11 (`moneyTop` + botón `win`
  encendido), volumen en 8 barras crecientes, `◄ valor ►` para listas, "MOVIMIENTO REDUCIDO" de solo
  lectura (sigue al sistema) y descripción del ajuste seleccionado debajo.
- **Cómo se juega** (`menu-help.png`): libro abierto en papel (`paperTop` → `paperBottom`, lomo
  `#B8A77E`/`#8A7A55`, marco `goldDark`) con 4 páginas dobles: mesa y fichas, girar con Claude, tiradas
  pendientes, préstamo y temporadas. ←→ pasa página con un barrido de columnas de 8 px (160 ms) y roce
  de papel (ruido paso banda 2,5 kHz, 120 ms).
- **Créditos** (`menu-credits.png`): logotipo a ×1, la atribución 7(b) de `legal.createdBy`
  ("Created by Aimar (github.com/Aimarmndz)") en oro, consola, fuente, sonido, descargos y AGPL. Suben
  a 20 px/s; ↑↓ a mano.

### HUD (`hud-table.png`, `hud-open-notice.png`)

- El panel derecho (222, 4) pasa de 94×29 a **94×40** cuando hay pendientes y añade la fila
  "PENDIENTES n" en oro (etiqueta en x = 228, número alineado a x = 310, y = 32). Con 0 vuelve a la
  v1. En el tope: "100 MÁX" en rojo que respira (1 s).
- Al abrir la ventana con pendientes (una vez por sesión, tras `ui.pendingNoticeDelayMs`): mesa
  oscurecida 55 % y ventana (40, 70, 240×92) con la pila 3D, "TIENES / 20 TIRADAS / PENDIENTES" y
  ✕ IR A TIRADAS · ○ LUEGO.

## Animaciones

t = 0 es el momento indicado en cada una. Las de resultado empiezan **cuando la bola se asienta**, que
nunca es antes de `revealAt`. Cada una lista su sonido sintetizado (WebAudio, sin samples); los nombres
entre comillas son sonidos que ya existen en `audio/sfx.ts`.

### Premio gordo por niveles (`sb-bigwin*.png`)

Niveles por neto / apostado: **BIG WIN** ≥ `bigWin.minNetMultiple` (5), **MEGA WIN** ≥
`bigWin.megaNetMultiple` (15), **¡PLENO!** si acierta un pleno (sustituye a MEGA WIN).

| t (ms)    | Imagen                                                                                                                                                                                                                         | Sonido                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 0         | La bola se asienta; medalla del número como en la v1                                                                                                                                                                           | 'settle'                                                               |
| 0–80      | Flash crema al 85 % (capa 4), uno solo                                                                                                                                                                                         | impacto: ruido paso bajo 180 Hz 150 ms + seno 55 → 30 Hz               |
| 80–340    | Rayos (BIG: 12 cuñas `deepTop`/`carpet` al 50 %; MEGA: 20 `jackpotBottom`/`carpet` al 70 %; PLENO: `jackpotBottom`/`goldDark`), centro (160, 96). Rótulo ×7 → ×6 → ×5 en escalones de 87 ms. Sacudida (3, −2) px que decae a 0 | fanfarria: square C5 E5 G5 C6 E6, 90 ms por nota (+ sierra C3 en MEGA) |
| 340       | Rótulo asentado (MEGA: "×15" ×2 crema debajo). Contador ×3 con degradado verde a +0. Primeras fichas desde abajo                                                                                                               | empieza el tic                                                         |
| 340–2140  | Contador rodando (`outCubic`, `countMs`). Lluvia de fichas 3D (10/26), gravedad 600 px/s², giro aleatorio                                                                                                                      | tic triangle cada 50 ms, 1800 → 2600 Hz                                |
| 2140–4740 | Valor final; brillo diagonal de 6 px por el rótulo cada 1200 ms; rayos girando 6°/s; ✕ CONTINUAR                                                                                                                               | acorde C6+E6+G6 square 600 ms, vibrato 6 Hz, chispas 2–4 kHz           |

¡PLENO!: el número ×5 (×6 en el impacto) en su color dentro de un aro oro de radio 34 y "¡PLENO!" ×5
debajo; al final, campana FM (1568 Hz, índice 3). BIG WIN usa 'bigWin' de la v1. Movimiento reducido:
ventana fija `goldDark` → `carpet` con el rótulo ×4 y el contador en 3 saltos de 150 ms.

### Sale el verde (`sb-green.png`)

| t (ms)  | Imagen                                                                                               | Sonido                                                   |
| ------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 0       | Bola en el 0, medalla verde                                                                          | 'settle'                                                 |
| 0–160   | Tinte `green` al 45 % en toda la escena; casilla del 0 en `#7DFFB0`; "¡VERDE!" ×7 en degradado verde | seno E6 (1319 Hz) 120 ms                                 |
| 160–320 | Sin tinte; rótulo ×6                                                                                 | seno B5 (988 Hz) 120 ms                                  |
| 320–960 | Dos parpadeos más (3 en total); banda verde "TODAS LAS SENCILLAS PIERDEN"                            | ding-dong por parpadeo; "boing" seno 220 → 110 Hz 300 ms |
| 960 +   | Si había apuesta al 0: banda oro "¡TODO AL 0! → PREMIO GORDO" y a los `chainMs` encadena con ¡PLENO! | fanfarria del pleno                                      |

Movimiento reducido: un tinte fijo de 600 ms sin parpadeo.

### PUSH TO PROD (`sb-push.png`)

Solo si el turno trajo `gitPushOk`; va entre la caída y el resultado. El texto de la terminal es
**fijo** (el mod no envía rama, repo ni commit).

| t (ms)    | Imagen                                                                                                                           | Sonido                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0–350     | Mesa al 50 %; terminal de tinta (30, 50, 260×100) sube (`outExpo` 200 ms); "$ git push"; barra verde a saltos de 10 % hasta 40 % | tecleo: clics de ruido paso alto 3 kHz, 15 ms, cada 45 ms |
| 350–700   | 100 % y "→ main ✓ DEPLOYED" en oro                                                                                               | díada square 880 + 1320 Hz, 80 ms                         |
| 700–1100  | Cohete (sprite de 9×13 a ×4) despega con humo; "PUSH TO PROD" ×2                                                                 | ruido paso bajo 300 → 2000 Hz + seno 80 → 40 Hz           |
| 1100–1500 | Cohete sale por arriba (`inQuad`, ×2); rótulo ×3 oro; sello "×N" girado −11° cae ×6 → ×3                                         | golpe square 196 Hz 60 ms + ruido; 'jackpot'              |
| 1500 +    | Resultado normal con la cuenta: "+100 · ×2 · +200" y banda "PUSH TO PROD = BONUS"                                                | 'win' o la fanfarria del nivel                            |

Sprite del cohete (9×13; R = `red`, C = `cream`, B = `chipBlue`, G = `steel`):

```text
....R....
...RRR...
...CCC...
..CCCCC..
..CCBCC..
..CBBBC..
..CCBCC..
..CCCCC..
..CCCCC..
.RCCCCCR.
RRCCCCCRR
RR.GGG.RR
R..GGG..R
```

Llama (O = `fire1`, Y = `fire2`), alternando cada 66 ms: `...O.O...` / `..OYOYO..` / `...OYO...` /
`....O....` y `..O...O..` / `...OYO...` / `..OYYYO..` / `...OYO...` / `....O....`. Movimiento
reducido: banda "PUSH TO PROD ×2" 600 ms.

### Préstamo: secuencia de banco (`sb-loan.png`)

t = 0 cuando el servidor confirma el préstamo tras ✕ ACEPTAR.

| t (ms)    | Imagen                                                                                                                                                                                                                       | Sonido                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| oferta    | Ventanilla: moqueta, rótulo "LUDO-CRÉDITO EXPRESS" en ventana de alerta, banquero low-poly (cabeza de caja, chistera con banda roja, monóculo, corbata) tras rejas oro de 2 px cada 14 px; diálogo ✕ ACEPTAR / ○ NO, GRACIAS | campanilla: seno 2093 Hz 300 ms                       |
| 0–450     | Contrato (180×150, papel) sube (`outBack`); la letra pequeña pasa movida                                                                                                                                                     | papel: ruido paso banda 2,5 kHz 200 ms                |
| 450–1350  | Firma pixel de izquierda a derecha (polilínea ondulada en `night`) con la pluma visible                                                                                                                                      | garabato: ruido paso banda 1,5–3 kHz modulado a 12 Hz |
| 1350–1600 | Sello APROBADO rojo (doble marco), girado −12°, cae ×4 → ×2; sacudida de 2 px 120 ms                                                                                                                                         | golpe: seno 90 → 50 Hz 120 ms + ruido                 |
| 1600–2500 | HUD: fichas caen en SALDO (fila en `moneyTop`), que cuenta 0 → 1.000 (`outCubic`); "+1.000" ×2 en `win`                                                                                                                      | 10 blips triangle 2–4 kHz, uno cada 50 ms             |
| 2500–3200 | DEUDA sube 0 → 1.000 (fila en `alertTop`), "+1.000" ×2 en `loss`, "KA-CHING"; la letra pequeña cruza la barra inferior a 400 px/s                                                                                            | 'loan' + campana FM                                   |

Movimiento reducido: de la oferta al estado final con los dos valores, 800 ms. La animación nunca
cambia lo que se firma.

### BANCARROTA — CONTINUE? (`sb-bankrupt.png`)

La primera vez en la temporada que el patrimonio llega a 0 o menos (lo marca el servidor).

| t (ms)   | Imagen                                                                                                                             | Sonido                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 0–600    | Escena desaturada al 70 %; PATRIM. parpadea en rojo 2 veces (150/150)                                                              | apagón: sierra 440 → 55 Hz 900 ms, paso bajo 4 kHz → 200 Hz |
| 600–1200 | Tinta; "BANCARROTA" ×4 en degradado rojo con glitch (40 % de filas ±8 px, 4 fotogramas)                                            | ráfagas de ruido de 30 ms                                   |
| 1200 +   | "BANCARROTA" ×3 arriba, "CONTINUE?" ×2, cuenta ×9 en oro desde `countFrom`; cada `tickMs` baja y el nuevo entra a ×10 → ×9 (80 ms) | tic square 330 Hz 50 ms                                     |
| 3 → 1    | Número en rojo a ×10                                                                                                               | tic square 440 Hz                                           |
| ✕ o 0    | La oferta del Ludo-Crédito (diálogo de siempre). Llegar a 0 no castiga: no hay game over                                           | al llegar a 0: 'lose'                                       |

○ cierra en cualquier momento. Movimiento reducido: sin desaturado ni glitch, cuenta sin rebote.

### ON FIRE (`sb-fire.png`)

A partir de `streak.onFireAt` victorias seguidas.

- 0–300: el panel derecho destella crema al 50 % (una vez); fuego "doom fire" de 102×30 que nace en
  su borde inferior, paleta de 5 tonos `carpet`, `red`, `fire1`, `fire2`, `goldHi`. Sonido: ruido
  paso bajo 400 → 3000 Hz 500 ms + square G4 B4 D5 G5 (50 ms).
- 300–1500: franja de fuego de 240×40 en (40, 70) y "ON FIRE" ×5 en degradado de fuego, "n SEGUIDAS"
  debajo.
- Después, en bucle: llamitas de 30×10 detrás del ▲ a 15 fps hasta la primera derrota (crepitar
  opcional: clics de ruido, 2/s, ganancia 0,01).
- Movimiento reducido: icono de llama fijo de 8×8 junto a la racha.

### Falacia del jugador (`sb-fallacy.png`)

Con `streak.colorWarningAt` colores iguales seguidos (el ejemplo muestra 7 rojos).

- 0: ventana de historial (20, 56, 280×40); la última casilla cae 4 px y rebota (`outBack`, 200 ms).
- 200: mesa al 60 % de tinta; "7 ROJOS SEGUIDOS" ×2 en degradado rojo.
- 600: viñeta (30, 134, 260×52): "El negro TIENE que salir." y, debajo, la aclaración honesta "Cada
  tirada es independiente: el negro sigue siendo 18/37."; sello oro "FALACIA DEL JUGADOR" girado.
  Dura `fx.fallacy.holdMs` o hasta ✕.
- Sonido: "dun dun" sierra 147 Hz y 139 Hz, 200 ms cada una.

### Aviso de logro (`sb-achievement.png`)

Ventana `goldDark` → `carpet` de 140×32 en y = 50, bajo el HUD derecho.

- 0–220: entra de x = 320 a x = 176 (`outBack`). Copa 3D a tamaño 10 en (x + 16, 66) girando 1
  vuelta / 1,2 s; "LOGRO DESBLOQUEADO" en oro (x + 32, 56) y el nombre en crema (x + 32, 69).
- 2800–3100: brillo diagonal de 6 px que cruza la ventana.
- 3000–3200: sale por la derecha (`inQuad`). Si hay más, el siguiente a los `gapMs`.
- Sonido: arpegio triangle E6 G6 C7 (70 ms por nota) + brillo de ruido paso alto 6 kHz 200 ms. Nada
  que recuerde a sonidos o iconos de otra consola. `aria-live="polite"`.

### Contador de pendientes (`sb-pending-counter.png`)

- **Sube** (al volver a estar visible la ventana): odómetro: el dígito viejo sale hacia arriba y el
  nuevo entra por abajo, recortados a la fila (clip de 24×10 en (290, 31)), `fx.pending.rollMs` por
  paso (si suben más de 5, un solo giro); "+n" en oro sube 12 px y se desvanece en `floatMs`;
  destello crema del 15 % en el panel durante 1 fotograma. Sonido: square 1760 Hz 40 ms. El total de
  la animación cabe en `ui.counterBumpMs`.
- **Baja** (al gastar): una ficha 3D sale del contador hacia la ruleta en arco (`flyMs`, `inQuad`) y
  el dígito rueda hacia abajo. Sonido: 'chip' + square 1320 → 880 Hz 60 ms.
- Movimiento reducido: el número cambia sin rodar y sin ficha.

## Iconos 3D

Mallas en código (Three.js, material PSX con sombreado plano por cara y vertex snapping); tamaños
relativos a una caja de ±1 unidad. Luz direccional (−0,55, 0,75, 0,6), ambiente 0,42. Ver
`icons-sheet.png` (cada fila, 8 ángulos de la vuelta).

| Icono          | Malla                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Ficha          | cilindro de 24 lados, r 1, alto 0,2; cara superior: centro crema r < 0,56, aro oro 0,56–0,66, canto rojo con inserción crema cada 3 lados |
| Pila de fichas | n fichas de 16 lados (inserción cada 4), separadas 0,22, desplazadas ±0,035 al azar fijo, colores rojo/azul/verde/negro/oro               |
| Barras         | base 1,9×0,14×1 `frameInner` + 3 prismas 0,42 de lado: `loss` 0,7, `gold` 1,2, `win` 1,75 de alto                                         |
| Copa           | torno de 10 lados (pie, tallo, cáliz) en oro con el interior oscurecido + dos asas de 0,18×0,55                                           |
| Corona         | aro de 10 lados r 0,85 alto 0,7 con 5 puntas de 0,75 y 5 gemas (rojo/azul)                                                                |
| Banco          | basamento, 4 columnas de 0,22, cornisa, frontón con faldones rojos y triángulo oro                                                        |
| Memory card    | caja 1,25×1,7×0,16 `frame` con etiqueta oro y 3 muescas de tinta                                                                          |
| Engranaje      | 8 dientes (radios 1 / 0,74) extruidos ±0,18 en `steel`, hexágono de tinta en el centro                                                    |
| Libro          | tapa roja 1,3×1,6×0,34 con canto de páginas crema, franja oro y marcapáginas                                                              |
| Gema POLYGONE  | torno de 8 lados (la gema de la v1)                                                                                                       |

## Logo

**Elegida: variante A, ficha con prompt "\>\_".** Ficha roja de casino con 8 inserciones crema, aro oro
y un prompt de terminal "\>\_" en oro sobre el centro de tinta: cuenta el producto entero (casino +
programar) en un solo dibujo y sigue legible a 16 px porque son tres anillos concéntricos de alto
contraste con contorno de tinta. Descartadas: **B, ruleta cenital** (genérica de cualquier casino y a
16 px los bolsillos rojo/negro se vuelven ruido) y **C, ficha 3D low-poly** (la más "PS1", pero el
dithering ensucia por debajo de 64 px). Comparativa en `docs/design/v2/logo-variants.png` y en la
página _Logo_ del artifact.

| Archivo                                     | Qué es                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `docs/brand/logo-mark.svg`                  | marca en rejilla de 32×32 (1 `rect` = 1 píxel), vale para fondo claro y oscuro                                  |
| `docs/brand/logo-mark-16.svg`               | marca redibujada a mano a 16×16 (4 inserciones en cruz, "\>\_" de 3×5) para el favicon                          |
| `docs/brand/logo.svg`                       | logotipo para fondo oscuro: marca + "VIBE" oro con sombra de tinta / "GAMBLING" rojo, Polygone 12 a ×2 (129×33) |
| `docs/brand/logo-light.svg`                 | logotipo para fondo claro: "VIBE" en tinta, sin sombra                                                          |
| `docs/brand/png/logo-mark-{16…512}.png`     | 16 (de la versión de 16), 32, 64, 128, 256 y 512 (escalas enteras de la de 32)                                  |
| `docs/brand/png/logo{,-light}@{2,4,8}x.png` | logotipo a escalas enteras (258, 516 y 1032 px de ancho)                                                        |
| `docs/brand/avatar.png`                     | avatar del repo, 500×500: la marca a ×14 sobre `#0D1240`                                                        |

Los SVG son la fuente de verdad; los PNG se regeneran con `node docs/brand/build.mjs` (Chromium de
Playwright de `packages/web`, sin red). Usos previstos: favicon (16 y 32), `apple-touch-icon` (la de
128 sobre `#0D1240`), cabecera del README (`<picture>` con `logo.svg` / `logo-light.svg` según
`prefers-color-scheme`), pantalla de título, icono de guardado de la memory card, `og.png` y
`docs/launch/social-preview.png`.
