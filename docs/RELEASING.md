# Wydawanie wersji (release)

Wydanie jest zautomatyzowane workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml).
Wypchnięcie taga `vX.Y.Z` uruchamia:

1. **build** — `npm ci`, `release:check` (tag == wersja w `package.json`, sekcja w `CHANGELOG.md`,
   ikona PNG), lint, `format:check`, typecheck, build, testy (`xvfb-run -a npm test`),
   `vsce package` → artefakt `vsc-zed-plugin-X.Y.Z.vsix` + notatki wydania z `CHANGELOG.md`.
2. **release** — GitHub Release dla taga z załączonymi `*.vsix` i `profiles/zed-like.code-profile`;
   treść = sekcja `## [X.Y.Z]` z `CHANGELOG.md`. Wersja z `-` (np. `0.2.0-beta.1`) → _pre-release_.
3. **publish-marketplace** — `vsce publish` do VS Code Marketplace (sekret `VSCE_PAT`).
4. **publish-openvsx** — `ovsx publish` do [Open VSX](https://open-vsx.org) (sekret `OVSX_PAT`).

Joby publikacji są **pomijane** (z adnotacją _notice_ w podsumowaniu runu), gdy odpowiedni sekret
nie jest ustawiony — GitHub Release powstaje niezależnie od nich. Wersje z `-` nie są publikowane do
sklepów (Marketplace nie przyjmuje wersji pre-release semver).

## Jednorazowa konfiguracja

### VS Code Marketplace (`VSCE_PAT`)

1. Zaloguj się kontem Microsoft na <https://dev.azure.com> i utwórz (dowolną) organizację Azure DevOps.
2. Utwórz **Personal Access Token**: _User settings → Personal access tokens → New Token_:
   - **Organization:** `All accessible organizations` (inaczej publikacja zwróci 401),
   - **Scopes:** _Custom defined_ → _Show all scopes_ → **Marketplace → Manage**,
   - ustaw datę wygaśnięcia (maks. 1 rok) i zapisz token.
3. Utwórz wydawcę **`tarze07`** na <https://marketplace.visualstudio.com/manage/createpublisher>
   (ID musi być identyczne z polem `publisher` w `package.json`).
4. Sprawdź token lokalnie: `npx vsce login tarze07` (wklej PAT) — opcjonalnie.
5. W repozytorium GitHub: _Settings → Secrets and variables → Actions → New repository secret_:
   `VSCE_PAT` = token z pkt 2.

### Open VSX (`OVSX_PAT`)

1. Zaloguj się na <https://open-vsx.org> kontem GitHub.
2. Podpisz **Eclipse Foundation Publisher Agreement**: _Settings_ (avatar → _Settings_) → połącz konto
   Eclipse (utwórz je na <https://accounts.eclipse.org>, jeśli go nie masz) → zaakceptuj umowę.
3. Wygeneruj token: _Settings → Access Tokens → Generate New Token_.
4. Utwórz przestrzeń nazw (namespace) **`tarze07`** (jednorazowo):
   ```sh
   npx ovsx create-namespace tarze07 -p <OVSX_TOKEN>
   ```
5. (Zalecane) Zgłoś własność przestrzeni nazw, aby rozszerzenie było oznaczone jako zweryfikowane:
   issue w <https://github.com/EclipseFdn/open-vsx.org/issues> („Claim namespace tarze07”).
6. W repozytorium GitHub dodaj sekret `OVSX_PAT` = token z pkt 3.

### GitHub

- _Settings → Actions → General → Workflow permissions_: workflow sam deklaruje
  `contents: write` dla joba `release`, więc domyślne ustawienie („Read repository contents”) wystarcza,
  o ile organizacja nie blokuje podnoszenia uprawnień.
- Sekrety: `VSCE_PAT`, `OVSX_PAT` (repozytorium → _Secrets and variables → Actions_).
- (Opcjonalnie) reguła ochrony tagów `v*` (_Settings → Rules → Rulesets_), aby tylko opiekunowie
  mogli wydawać wersje.

## Wydanie nowej wersji

1. Na gałęzi `main` (wszystkie zmiany scalone, CI zielone):
   - podnieś wersję bez tworzenia taga: `npm version 0.1.0 --no-git-tag-version`
     (aktualizuje `package.json` i `package-lock.json`),
   - w `CHANGELOG.md` zamień `## [Unreleased]` na `## [0.1.0] - RRRR-MM-DD` (i dodaj nową, pustą
     sekcję `## [Unreleased]` nad nią).
2. Sprawdź lokalnie:
   ```sh
   npm run release:check -- --tag v0.1.0
   npm run package && unzip -l vsc-zed-plugin-0.1.0.vsix   # m.in. images/icon.png
   ```
3. Zatwierdź i wypchnij zmiany, następnie utwórz i wypchnij tag:
   ```sh
   git commit -am "Release 0.1.0"
   git push
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. Obserwuj run _Release_ w zakładce _Actions_. Po sukcesie:
   - GitHub Release: `https://github.com/tarze07/vsc-zed-plugin/releases/tag/v0.1.0`,
   - Marketplace: <https://marketplace.visualstudio.com/items?itemName=tarze07.vsc-zed-plugin>
     (weryfikacja przez Marketplace trwa zwykle kilka minut),
   - Open VSX: <https://open-vsx.org/extension/tarze07/vsc-zed-plugin>.

Publikacja ręczna (awaryjnie, z lokalnego `.vsix`):

```sh
VSCE_PAT=... npm run publish:vsce -- --packagePath vsc-zed-plugin-0.1.0.vsix
OVSX_PAT=... npm run publish:ovsx -- --packagePath vsc-zed-plugin-0.1.0.vsix
```

## Próbny przebieg (dry run)

_Actions → Release → Run workflow_ na dowolnej gałęzi, z zaznaczonym **Dry run** (domyślnie).
Wykonuje build, testy, `release:check` i `vsce package`, publikuje artefakt `vsix` (z `.vsix` i
`release-notes.md`) do pobrania z runu — **bez** tworzenia GitHub Release i bez publikacji.
Na gałęzi (nie tagu) zgodność tag/wersja nie jest sprawdzana.

Uruchomienie na **tagu** (_Use workflow from → Tags → vX.Y.Z_) z odznaczonym _Dry run_ ponawia
wydanie tego taga — przydatne, gdy np. sekret został dodany po wypchnięciu taga.

## Rozwiązywanie problemów

| Objaw                                                   | Przyczyna / rozwiązanie                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Tag "vX" does not match package.json version`          | Tag wskazuje commit bez podbitej wersji. Usuń tag (`git push --delete origin vX; git tag -d vX`), popraw wersję, utwórz tag ponownie.                                           |
| `CHANGELOG.md has no "## [X.Y.Z]" section`              | Dodaj sekcję `## [X.Y.Z] - data` do `CHANGELOG.md`.                                                                                                                             |
| `vsce publish`: 401 / `Access Denied`                   | PAT wygasł, nie ma zakresu _Marketplace → Manage_ lub nie jest ustawiony na _All accessible organizations_. Wygeneruj nowy i zaktualizuj `VSCE_PAT`.                            |
| `vsce publish`: `Extension ... already exists` / wersja | Wersja już opublikowana — Marketplace nie pozwala nadpisać wersji. Podbij wersję (patch).                                                                                       |
| `ovsx publish`: `Unknown publisher` / namespace         | Brak namespace `tarze07` — uruchom `npx ovsx create-namespace tarze07 -p <token>`.                                                                                              |
| `ovsx publish`: wymagana umowa wydawcy                  | Podpisz Eclipse Publisher Agreement w ustawieniach konta Open VSX.                                                                                                              |
| Job publikacji „zielony”, ale nic nie opublikowano      | Brak sekretu — sprawdź adnotację _notice_ w podsumowaniu runu i dodaj sekret, potem ponów (dry run odznaczony, na tagu).                                                        |
| `release` 403 `Resource not accessible by integration`  | Organizacja/repo blokuje `contents: write` dla `GITHUB_TOKEN` — zmień _Workflow permissions_ na _Read and write_.                                                               |
| Testy padają tylko w CI                                 | Testy integracyjne wymagają `xvfb-run` (Linux). Zobacz log kroku _Test_; lokalnie `npm run test:unit` + `npm test`.                                                             |
| `vsce` odrzuca ikonę / obrazki                          | Ikona musi być PNG (nie SVG) ≥ 128×128 — źródło w `images/icon.svg`, wersja PNG w `images/icon.png`. Obrazki SVG w README muszą pochodzić z zaufanych źródeł (np. shields.io). |

## Ikona

`images/icon.svg` to źródło ikony (oryginalny projekt: okno edytora podzielone na panel kodu i panel
sesji agentów, w palecie motywu _Zed-like Dark_). `images/icon.png` (256×256) jest renderowany z SVG,
np. przez Playwright/Chromium:

```js
const { chromium } = require('playwright');
const svg = require('fs').readFileSync('images/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
await page.setContent(`<body style="margin:0">${svg}</body>`);
await page.locator('svg').screenshot({ path: 'images/icon.png', omitBackground: true });
await browser.close();
```
