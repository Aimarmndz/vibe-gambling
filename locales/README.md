# locales/

Every text of vibe-gambling, one folder per language. **English (`en`) is the reference**: it
defines the keys and the `{placeholders}` every other language must have.

| Folder | Language | Flag                        |
| ------ | -------- | --------------------------- |
| `en`   | English  | United Kingdom (Union Flag) |
| `es`   | Español  | Spain (civil flag)          |
| `fr`   | Français | France                      |
| `de`   | Deutsch  | Germany                     |

## What is in a folder

| File           | What                                                                                                                        | Schema (`packages/shared/src/i18n/schemas.ts`) |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `meta.json`    | `code` (= folder name), `bcp47`, `nativeName`, `englishName`, `dir`, `order` in the pickers, `groupSeparator` for thousands | `localeMetaSchema`                             |
| `flag.json`    | The flag as pixel art: a `palette` (one character → one `#RRGGBB`) and 11 rows of 16 characters                             | `flagSchema`                                   |
| `web.json`     | The game window (`/play`), drawn in the 320×240 framebuffer with the Polygone 12 bitmap font                                | `textCatalogSchema`                            |
| `landing.json` | The landing page (`/`) and the footer                                                                                       | `textCatalogSchema`                            |
| `privacy.json` | The privacy policy (`/privacy`)                                                                                             | `textCatalogSchema`                            |
| `mod.json`     | The Claude Code plugin: status line, toasts and slash command replies                                                       | `textCatalogSchema`                            |
| `phrases.json` | The fake gambling addict phrases, by category                                                                               | `phraseCatalogSchema`                          |

Texts are flat keys (`"menu.title": "MENU"`) with `{placeholders}` that the code fills in. Keep the
placeholders exactly; translate everything else. A few values start with a space on purpose
(`serverNameSuffix`, `serverState.*` in `mod.json`): keep it. A key ending in `.one` is the
singular of the same key without it (`pendingHint.one` / `pendingHint`), chosen with
`Intl.PluralRules` for your `bcp47` (in French, 0 counts as singular too); if your language does
not change the word, write the same text in both.

## Add a language

1. **Copy** `locales/en` to `locales/<code>` (`it`, `pt-BR`…: two or three lowercase letters,
   optionally `-` and a region in capitals).
2. **Edit `meta.json`**: `code` = the folder name, its BCP 47 tag, its name in that language, a free
   `order` and the thousands separator (`,` `.` or a narrow no-break space U+202F).
3. **Translate** `web.json`, `landing.json`, `privacy.json` and `mod.json`. Short labels must fit
   the 320×240 screen (look at how long the English and Spanish ones are). Only use characters
   the bitmap font has (`packages/web/font/polygone12.txt`; add glyphs there and run
   `python3 -I packages/web/scripts/build_font.py` if you need more). The privacy page is a legal
   text: use your language's GDPR wording and do not add or remove facts.
4. **Write the phrases**: at least 40, every category, same tone, **adapted rather than translated**
   (your own puns). Humour about fake gambling addiction and dev culture, never about people or
   groups, and nothing that encourages real gambling.
5. **Draw the flag** in `flag.json` (16×11, own pixel art) and add a row to `ASSETS.md`.
6. **Run** `pnpm gen:locales`. It validates the folder (schemas, same keys and placeholders as
   English) and regenerates the language list of the protocol and the plugin's copy. Then
   `pnpm sync:mod`, `pnpm docs:protocol` and `pnpm test`.
7. Optional: real gambling-help links for your language in `config/site.json` (`helpLinks`) and the
   hosting sentence (`instance.hosting`). Without them, the English ones are used.

Nothing else is touched by hand: the web finds the folder with `import.meta.glob` (each language in
its own chunk, loaded on demand), the server accepts the new code in the user settings and the
plugin offers it in its `language` option.

## Checks

- `pnpm gen:locales --check` (in `pnpm lint` and the CI) fails if the generated registry is stale.
- `packages/shared/test/locales.test.ts`: same keys and placeholders as English in every file,
  at least 40 phrases, valid metadata and flag, registry up to date.
- `packages/web/test/i18n.test.ts`: every character exists in the bitmap font, browser language
  detection, number formatting.

---

## Resumen en español

Cada idioma es una carpeta con todos sus textos (juego, landing, `/privacy`, mod), sus frases de
ludópata, sus metadatos y su bandera en pixel art. El inglés es la referencia. **Añadir un idioma:
copia `locales/en`, tradúcelo (las frases, adaptadas), dibuja la bandera y ejecuta
`pnpm gen:locales`**; los tests comprueban que no falte ni sobre ninguna clave, que los
`{marcadores}` coincidan y que la bandera sea válida.
