# Profil VS Code „Zed Layout”

Alternatywa dla polecenia **Zed Layout: Apply Zed Layout** (issue #13, plan: sekcja 3.1 w [PLAN.md](PLAN.md)). Zamiast zmieniać ustawienia bieżącego (domyślnego) profilu, importujesz preset jako **osobny profil VS Code** (*Profiles*) i przełączasz się między nim a swoim dotychczasowym profilem.

Gotowy plik: [`profiles/zed-like.code-profile`](../profiles/zed-like.code-profile) (w repozytorium i dołączany do wydań).

## Co zawiera profil

Profil ma tylko dwa zasoby — **ustawienia** i **rozszerzenia**. Skróty klawiszowe, snippety, zadania i stan UI pozostają domyślne (nie są częścią pliku).

### Ustawienia

Dokładnie te same wartości, które zapisuje `Apply Zed Layout` w zakresie *User* przy domyślnych ustawieniach `zedLayout.*` (pełna lista i opis: [LAYOUT.md](LAYOUT.md)), plus włączenie rozszerzenia:

| Ustawienie | Wartość |
|---|---|
| `workbench.activityBar.location` | `"top"` |
| `workbench.sideBar.location` | `"left"` |
| `workbench.panel.defaultLocation` | `"bottom"` |
| `workbench.layoutControl.enabled` | `false` |
| `workbench.editor.tabSizing` | `"shrink"` |
| `window.density.editorTabHeight` | `"compact"` |
| `editor.minimap.enabled` | `false` |
| `editor.renderLineHighlight` | `"gutter"` |
| `editor.scrollbar.verticalScrollbarSize` | `8` |
| `editor.scrollbar.horizontalScrollbarSize` | `8` |
| `window.titleBarStyle` | `"custom"` |
| `workbench.colorTheme` | `"Zed-like Dark"` |
| `editor.fontFamily` | `"'IBM Plex Mono', 'Lilex', Menlo, Consolas, 'DejaVu Sans Mono', monospace"` |
| `editor.fontSize` | `14` |
| `editor.lineHeight` | `1.6` |
| `editor.fontLigatures` | `false` |
| `terminal.integrated.fontFamily` | jak `editor.fontFamily` |
| `terminal.integrated.fontSize` | `14` |
| `terminal.integrated.lineHeight` | `1.6` |
| `zedLayout.enabled` | `true` |

`breadcrumbs.enabled` nie jest ustawiane (domyślnie `zedLayout.layout.hideBreadcrumbs` = `false`). Ustawienia `window.*` działają, bo profil to ustawienia użytkownika (inaczej niż przy zakresie *Workspace* w `Apply`).

### Rozszerzenia

- `tarze07.vsc-zed-plugin` (Zed-like Agent Workspace) — dostarcza motywy `Zed-like Dark` / `Zed-like Light` oraz panel agentów.

## Instalacja rozszerzenia (najpierw!)

Rozszerzenie **nie jest jeszcze opublikowane w Marketplace**. Import profilu próbuje je zainstalować z galerii — dopóki nie zostanie opublikowane, ta instalacja się nie powiedzie (VS Code pominie rozszerzenie, a ustawienia zaimportuje). Bez rozszerzenia motyw `Zed-like Dark` nie istnieje i VS Code użyje motywu domyślnego.

Dlatego przed importem zainstaluj plik `.vsix` (z wydania na GitHubie albo zbudowany lokalnie przez `npm run package`):

- Command Palette → **Extensions: Install from VSIX...** → wybierz plik `vsc-zed-plugin-*.vsix`, albo
- `code --install-extension vsc-zed-plugin-0.0.1.vsix`.

Profile mają własne listy rozszerzeń: po utworzeniu profilu upewnij się, że rozszerzenie jest w nim włączone (widok *Extensions* w nowym profilu; w razie potrzeby zainstaluj VSIX ponownie, będąc już w profilu „Zed Layout”). Po publikacji w Marketplace ten krok nie będzie potrzebny.

## Import profilu

1. Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Profiles: Import Profile...**
2. Wskaż źródło:
   - **plik**: `profiles/zed-like.code-profile` z repozytorium / wydania albo plik zapisany poleceniem *Save Zed Layout as Profile File...* (niżej),
   - **URL**: `https://raw.githubusercontent.com/tarze07/vsc-zed-plugin/main/profiles/zed-like.code-profile`
3. W podglądzie (edytor profili) sprawdź zawartość, ewentualnie zmień nazwę i kliknij **Create Profile**.
4. Przełącz się na profil „Zed Layout” (**Profiles: Switch Profile** albo ikona koła zębatego → *Profiles*). Profil można też przypisać do konkretnego folderu/przestrzeni roboczej.

Po imporcie wygląd jest taki sam jak po `Zed Layout: Apply Zed Layout` (zakres *User*, domyślne ustawienia). Zmiana `window.titleBarStyle` może wymagać ponownego uruchomienia okna. Jedyna różnica: `Apply` dodatkowo jednorazowo zwija panel i otwiera Secondary Side Bar — w nowym profilu zrób to ręcznie (lub uruchom `Apply` w tym profilu).

## Polecenie „Save Zed Layout as Profile File...”

**Zed Layout: Save Zed Layout as Profile File...** (`zedLayout.profile.save`) tworzy plik `.code-profile` z **bieżących** ustawień `zedLayout.layout.*` i `zedLayout.typography.*` (np. motyw jasny, inny font, ukryte breadcrumbs):

1. pyta o nazwę profilu (domyślnie „Zed Layout”),
2. pyta, gdzie zapisać plik (domyślnie `zed-layout.code-profile`),
3. po zapisie pokazuje komunikat z przyciskami:
   - **Import Profile…** — otwiera wbudowane `Profiles: Import Profile...` (jeśli się nie da — użyj go ręcznie z Command Palette i wskaż zapisany plik),
   - **Open Docs** — otwiera tę stronę na GitHubie.

## Profil a „Apply Zed Layout”

| | Profil „Zed Layout” | `Apply Zed Layout` |
|---|---|---|
| Gdzie zmienia ustawienia | osobny profil — Twój profil zostaje nietknięty | bieżący profil (User lub Workspace settings) |
| Cofnięcie | przełącz się z powrotem na poprzedni profil (lub usuń profil) | `Zed Layout: Restore Previous Layout` (z kopii zapasowej) |
| Kopia zapasowa | niepotrzebna | zapisywana w `globalState` / `workspaceState` |
| Rozszerzenia, skróty, snippety | osobne dla profilu (startuje „czysto”) | Twoje dotychczasowe |
| Zakres Workspace | — (profil można przypisać do folderu) | możliwy, bez `window.*` |

`Restore Previous Layout` nie jest potrzebne w przypadku profilu — wystarczy przełączyć profil.

## Format pliku `.code-profile`

Plik to JSON zgodny z eksportem VS Code (`Profiles: Export Profile...`):

```jsonc
{
  "name": "Zed Layout",
  // JSON-string z obiektem { "settings": "<treść settings.json jako string>" } — podwójne kodowanie
  "settings": "{\"settings\":\"{\\n  \\\"workbench.activityBar.location\\\": \\\"top\\\", ...}\\n\"}",
  // JSON-string z tablicą { identifier: { id }, displayName? }
  "extensions": "[{\"identifier\":{\"id\":\"tarze07.vsc-zed-plugin\"},\"displayName\":\"Zed-like Agent Workspace\"}]"
}
```

Zawiera tylko minimalne, dobrze znane pola. Pominięte zostały pola opcjonalne eksportu VS Code: `icon`, `keybindings`, `snippets`, `tasks`, `globalState`, a w rozszerzeniach `identifier.uuid`, `version`, `preRelease`, `disabled`, `applicationScoped`. Format nie jest publicznym, wersjonowanym API VS Code — jeśli przyszła wersja go zmieni, wygeneruj plik ponownie i porównaj z eksportem z VS Code.

## Regeneracja pliku

Źródłem prawdy jest `buildPreset()` (`src/layout/preset.ts`) i `buildCodeProfile()` (`src/profile/profile.ts`). Po zmianie presetu lub domyślnych wartości:

```sh
npm run compile-tests
node scripts/generate-profile.mjs
```

Test `src/test/profileFile.test.ts` sprawdza, że zatwierdzony plik jest identyczny z wynikiem `buildCodeProfile()` dla wartości domyślnych — nieaktualny plik oblewa testy.

## Architektura kodu

- `src/profile/profile.ts` — czyste funkcje (bez `vscode`): `buildCodeProfile`, `buildDefaultCodeProfile`, `serializeCodeProfile`, `parseCodeProfile`.
- `src/profile/index.ts` — polecenie `zedLayout.profile.save`.
- `scripts/generate-profile.mjs` — generator `profiles/zed-like.code-profile` (z `out/profile/profile.js`).
- Testy: `src/test/profileFile.test.ts`.
