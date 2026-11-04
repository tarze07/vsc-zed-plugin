# Motywy Zed-like i typografia

Rozszerzenie dostarcza dwa motywy kolorów — **Zed-like Dark** i **Zed-like Light** — oraz
konfigurowalny zestaw ustawień typografii stosowany razem z presetem układu
(`Zed Layout: Apply Zed Layout`). Issue: [#5](https://github.com/tarze07/vsc-zed-plugin/issues/5).

## Założenia

- Spokojny, „niskochromowy” wygląd inspirowany Zedem: stonowana paleta, cienkie i subtelne
  obramowania, brak krzykliwych akcentów.
- Panele (sidebar, panel dolny, nieaktywne karty, terminal) mają **nieco inne tło niż edytor**,
  dzięki czemu obszar edycji jest wyraźnie odróżniony bez użycia mocnych linii.
- Jeden kolor akcentu (niebieski) dla fokusu, aktywnej karty, kursora i przycisków.
- Paleta jest **autorska** — nie kopiuje kolorów ani plików motywów Zeda.
- Wszystkie główne pary tekst/tło spełniają **WCAG AA (≥ 4.5:1)**; sprawdza to test
  `src/test/themeContrast.test.ts`.
- 16 kolorów ANSI terminala jest wzajemnie różnych — posłużą też jako kolory
  identyfikujące poszczególnych agentów (M1/M2).

## Wybór motywu

- Paleta poleceń → **Preferences: Color Theme** (`Ctrl+K Ctrl+T` / `Cmd+K Cmd+T`) →
  `Zed-like Dark` lub `Zed-like Light`, albo
- w `settings.json`: `"workbench.colorTheme": "Zed-like Dark"`, albo
- automatycznie przez `Zed Layout: Apply Zed Layout`, gdy `zedLayout.layout.applyTheme`
  jest włączone (motyw wybiera `zedLayout.layout.theme`).

## Paleta

### Powierzchnie i tekst

| Rola                            | Klucz(e)                                                       | Dark      | Light     |
| ------------------------------- | -------------------------------------------------------------- | --------- | --------- |
| Tło edytora                     | `editor.background`, `tab.activeBackground`                    | `#1c1f24` | `#fcfcfb` |
| Tło paneli                      | `sideBar.background`, `panel.background`, `terminal.background` | `#22262c` | `#f2f3f5` |
| Tło „chrome”                    | `titleBar.*`, `statusBar.*`, `activityBar.background`          | `#1f2328` | `#eceef1` |
| Pola, przyciski drugorzędne     | `input.background`, `dropdown.background`                      | `#2a2f37` | `#ffffff` |
| Obramowania                     | `*.border`                                                     | `#2e333b` | `#dde0e5` |
| Tekst                           | `foreground`, `editor.foreground`                              | `#cdd2da` | `#2b3038` |
| Tekst wyróżniony                | `tab.activeForeground`, `list.activeSelectionForeground`       | `#e6e9ee` | `#14171c` |
| Tekst drugorzędny               | `tab.inactiveForeground`, `statusBar.foreground`               | `#959dab` | `#5b6270` |
| Numery linii                    | `editorLineNumber.foreground`                                  | `#6e7684` | `#878e9a` |
| Akcent                          | `focusBorder`, `tab.activeBorderTop`, `editorCursor.foreground` | `#6fa3ea` | `#2d68d0` |
| Tło przycisku / badge           | `button.background`, `badge.background`                        | `#2f63b8` | `#2d68d0` |
| Zaznaczenie w liście            | `list.activeSelectionBackground`                               | `#2e4566` | `#d5e2f7` |
| Zaznaczenie w edytorze          | `editor.selectionBackground`                                   | `#3d5b8a66` | `#2d68d02e` |

### Składnia

| Token                          | Dark      | Light     |
| ------------------------------ | --------- | --------- |
| Komentarze (kursywa)           | `#848c9a` | `#687180` |
| Słowa kluczowe, `storage`      | `#c69ae8` | `#8340b8` |
| Łańcuchy znaków                | `#9ccb83` | `#3b7a26` |
| Escape, regex, linki           | `#6ccbc4` | `#167473` |
| Funkcje, nagłówki Markdown     | `#6fb1e6` | `#1f5fbf` |
| Typy, klasy, atrybuty          | `#ddc078` | `#8a6300` |
| Liczby, stałe, dekoratory      | `#e3a26e` | `#a8501a` |
| Parametry                      | `#e0b8a0` | `#8f4a2a` |
| Właściwości                    | `#e3a6a9` | `#a33a55` |
| Tagi, usunięcia w diffie       | `#e57f84` | `#b4323b` |
| Operatory                      | `#a9b4c4` | `#4f5866` |
| Interpunkcja                   | `#a2aab7` | `#5b6270` |
| `invalid` (podkreślenie)       | `#ff8a8f` | `#c4202b` |

### Terminal (ANSI)

| Kolor   | Dark      | Dark (bright) | Light     | Light (bright) |
| ------- | --------- | ------------- | --------- | -------------- |
| Black   | `#2a2f37` | `#7d8594`     | `#2b3038` | `#5b6270`      |
| Red     | `#e57f84` | `#f29da1`     | `#b4323b` | `#c7444d`      |
| Green   | `#9ccb83` | `#b6dea0`     | `#3b7a26` | `#4b8a34`      |
| Yellow  | `#ddc078` | `#ecd598`     | `#8a6300` | `#9a6f00`      |
| Blue    | `#6fb1e6` | `#92c6f0`     | `#1f5fbf` | `#3570d2`      |
| Magenta | `#c69ae8` | `#d9b6f2`     | `#8340b8` | `#954fcc`      |
| Cyan    | `#6ccbc4` | `#8fdcd6`     | `#167473` | `#1d8584`      |
| White   | `#cdd2da` | `#f2f4f7`     | `#6b7280` | `#4a505b`      |

W motywie jasnym „white”/„bright white” są celowo ciemnoszare, aby tekst wypisywany tymi
kolorami pozostał czytelny na jasnym tle terminala.

## Kontrast (WCAG 2.x)

Współczynniki obliczone modułem `src/theme/contrast.ts` (luminancja względna WCAG; kolory z
kanałem alfa są nakładane na tło). Próg 4.5 = WCAG AA dla zwykłego tekstu, 3 = AA dla
dużego tekstu / elementów UI (numery nieaktywnych linii, placeholdery, komentarze).

| Para                                                                | Min | Dark  | Light |
| ------------------------------------------------------------------- | --: | ----: | ----: |
| `editor.foreground` / `editor.background`                           | 4.5 | 10.88 | 12.93 |
| `editorLineNumber.activeForeground` / `editor.background`           | 4.5 | 10.88 | 12.93 |
| `sideBar.foreground` / `sideBar.background`                         | 4.5 | 10.01 | 11.95 |
| `sideBarSectionHeader.foreground` / `sideBarSectionHeader.background` | 4.5 | 10.01 | 11.95 |
| `panelTitle.activeForeground` / `panel.background`                  | 4.5 | 12.49 | 16.18 |
| `terminal.foreground` / `terminal.background`                       | 4.5 | 10.01 | 11.95 |
| `statusBar.foreground` / `statusBar.background`                     | 4.5 |  5.78 |  5.27 |
| `titleBar.activeForeground` / `titleBar.activeBackground`           | 4.5 | 10.40 | 11.42 |
| `activityBar.foreground` / `activityBar.background`                 | 4.5 | 10.40 | 11.42 |
| `tab.activeForeground` / `tab.activeBackground`                     | 4.5 | 13.58 | 17.50 |
| `tab.inactiveForeground` / `tab.inactiveBackground`                 | 4.5 |  5.56 |  5.52 |
| `list.activeSelectionForeground` / `list.activeSelectionBackground` | 4.5 |  7.99 | 13.73 |
| `list.inactiveSelectionForeground` / `list.inactiveSelectionBackground` | 4.5 | 8.74 | 10.70 |
| `input.foreground` / `input.background`                             | 4.5 |  8.86 | 13.27 |
| `dropdown.foreground` / `dropdown.background`                       | 4.5 |  8.86 | 13.27 |
| `button.foreground` / `button.background`                           | 4.5 |  5.84 |  5.25 |
| `button.secondaryForeground` / `button.secondaryBackground`         | 4.5 |  8.86 | 13.27 |
| `badge.foreground` / `badge.background`                             | 4.5 |  5.84 |  5.25 |
| `quickInput.foreground` / `quickInput.background`                   | 4.5 | 10.01 | 11.95 |
| `quickInputList.focusForeground` / `quickInputList.focusBackground` | 4.5 |  7.99 | 13.73 |
| `notifications.foreground` / `notifications.background`             | 4.5 | 10.01 | 11.95 |
| `editorWidget.foreground` / `editorWidget.background`               | 4.5 | 10.01 | 11.95 |
| `menu.foreground` / `menu.background`                               | 4.5 | 10.01 | 11.95 |
| `editorLineNumber.foreground` / `editor.background`                 |   3 |  3.61 |  3.21 |
| `input.placeholderForeground` / `input.background`                  |   3 |  4.93 |  6.13 |
| `panelTitle.inactiveForeground` / `panel.background`                |   3 |  5.56 |  5.52 |
| `activityBarTop.inactiveForeground` / `activityBarTop.background`   |   3 |  5.56 |  5.52 |

Tokeny składni względem `editor.background`:

| Token                    | Min | Dark  | Light |
| ------------------------ | --: | ----: | ----: |
| Komentarze               |   3 |  4.88 |  4.80 |
| Słowa kluczowe           | 4.5 |  7.23 |  6.03 |
| Operatory                | 4.5 |  7.88 |  7.01 |
| Interpunkcja             | 4.5 |  7.06 |  5.97 |
| Łańcuchy znaków          | 4.5 |  8.88 |  5.12 |
| Escape / regex / linki   | 4.5 |  8.64 |  5.41 |
| Liczby i stałe           | 4.5 |  7.60 |  5.34 |
| Funkcje                  | 4.5 |  7.17 |  5.93 |
| Typy i klasy             | 4.5 |  9.35 |  5.29 |
| Zmienne                  | 4.5 | 10.88 | 12.93 |
| Parametry                | 4.5 |  9.08 |  6.43 |
| Właściwości              | 4.5 |  8.10 |  6.21 |
| Tagi                     | 4.5 |  6.06 |  5.91 |
| `invalid`                | 4.5 |  7.31 |  5.70 |

Komentarze spełniają nawet próg 4.5, choć test wymaga dla nich tylko 3:1.

Pełny raport (wszystkie reguły `tokenColors` i `semanticTokenColors`) generuje:

```sh
npm run compile-tests
node scripts/contrast-report.mjs
```

## Edycja motywów

Pliki `themes/*.json` są generowane z palet zdefiniowanych w `scripts/generate-themes.mjs`
(jedno źródło prawdy dla obu wariantów). Po zmianie palety:

```sh
node scripts/generate-themes.mjs
npx prettier --write themes
npm run compile-tests
node scripts/contrast-report.mjs   # kod wyjścia 1, jeśli któraś para nie spełnia progu
```

## Typografia

Preset układu zapisuje (i zapamiętuje do przywrócenia) ustawienia zwracane przez
`getTypographySettings()` z `src/theme/typography.ts`. Konfiguracja:

| Ustawienie                              | Domyślnie                                                                    | Efekt |
| --------------------------------------- | ---------------------------------------------------------------------------- | ----- |
| `zedLayout.typography.enabled`          | `true`                                                                       | Wyłączone → preset nie zmienia fontów. |
| `zedLayout.typography.fontFamily`       | `'IBM Plex Mono', 'Lilex', Menlo, Consolas, 'DejaVu Sans Mono', monospace`  | `editor.fontFamily` (i terminal). |
| `zedLayout.typography.fontSize`         | `14`                                                                         | `editor.fontSize` (i terminal), zakres 6–72. |
| `zedLayout.typography.lineHeight`       | `1.6`                                                                        | `editor.lineHeight`; < 8 = mnożnik rozmiaru fontu, ≥ 8 = piksele. |
| `zedLayout.typography.ligatures`        | `false`                                                                      | `editor.fontLigatures`. |
| `zedLayout.typography.applyToTerminal`  | `true`                                                                       | Ustawia też `terminal.integrated.fontFamily`, `fontSize`, `lineHeight`. |

Mapowanie wysokości linii:

- edytor: mnożnik (< 8) jest zachowany (minimum 1), wartość w pikselach (≥ 8) jest zaokrąglana;
  `0` oznacza wartość automatyczną VS Code;
- terminal: `terminal.integrated.lineHeight` jest zawsze mnożnikiem — wartość pikselowa jest
  dzielona przez rozmiar fontu (np. 24 px przy 16 px → 1.5), a wynik ograniczany do zakresu 1–3.

Nieprawidłowe wartości (zły typ, rozmiar spoza zakresu, ujemna wysokość linii, pusta rodzina
fontów) są zastępowane domyślnymi (`readTypographyOptions()`).

### Zalecane fonty

Rozszerzenie **nie dołącza fontów** — trzeba je zainstalować w systemie samodzielnie. Jeśli
żaden z nich nie jest dostępny, VS Code użyje kolejnego fontu z listy (Menlo, Consolas,
DejaVu Sans Mono, systemowy `monospace`).

- **IBM Plex Mono** — spokojny, czytelny krój o „humanistycznym” charakterze, dobrze pasuje
  do estetyki motywu. <https://github.com/IBM/plex> (także Google Fonts:
  <https://fonts.google.com/specimen/IBM+Plex+Mono>).
- **Lilex** — font oparty na IBM Plex Mono z dodanymi ligaturami programistycznymi
  (włącz `zedLayout.typography.ligatures`, aby z nich korzystać).
  <https://github.com/mishamyrt/Lilex>

Po instalacji fontu uruchom ponownie VS Code, a następnie (ponownie) wykonaj
`Zed Layout: Apply Zed Layout` lub ustaw font ręcznie.
