# Plan: rozszerzenie VS Code „Zed-like Agent Workspace”

> Odpowiedź na zgłoszenie [#1 „Plan na plugin”](https://github.com/tarze07/vsc-zed-plugin/issues/1).
> Status: **zaakceptowany** (2026-11-04). Punkty z sekcji „Zgłoszenia” założono jako osobne issues.

## 1. Cel

Rozszerzenie do Visual Studio Code, które jednym poleceniem ustawia środowisko tak, by wyglądało i działało jak widok edytora Zed nastawiony na pracę z agentami AI — a przede wszystkim ułatwia **równoległą pracę z wieloma agentami** (Claude Code, Codex, Agy, Kilo Code).

Rozszerzenie nie jest klonem Zeda. Odtwarzamy **układ i sposób pracy** (minimalistyczny interfejs, panel agentów z boku, przegląd zmian agenta), korzystając wyłącznie z publicznego API VS Code.

## 2. Co składa się na „widok Zeda” (punkt odniesienia)

| Element w Zed | Odpowiednik w VS Code |
|---|---|
| Panel agenta zadokowany po prawej, lista wątków | Widok w *Secondary Side Bar* (auxiliary bar) z listą sesji agentów |
| Drzewo projektu po lewej, bez paska aktywności | Primary Side Bar po lewej, `workbench.activityBar.location: "top"` lub `"hidden"` |
| Terminal na dole, chowany jednym skrótem | Panel na dole, skróty przełączania |
| Brak minimapy, cienkie paski przewijania, mało „chrome” | Zestaw ustawień `editor.*` / `workbench.*` |
| Przegląd zmian agenta w jednym widoku (multibuffer) | Widok „Review” z listą zmienionych plików + `vscode.changes` / `vscode.diff` |
| Ciemny, stonowany motyw, font monospace o dużej czytelności | Własny motyw kolorów + rekomendacja fontu (np. IBM Plex Mono / Lilex) |
| Skróty klawiszowe Zeda | Opcjonalny zestaw keybindings |

## 3. Zakres funkcjonalny

### 3.1 Preset układu („Apply Zed Layout”)
- Polecenie `Zed Layout: Apply` ustawia:
  - pasek aktywności u góry/ukryty, Primary Side Bar po lewej, Secondary Side Bar po prawej (otwarty na widoku agentów),
  - panel (terminal) na dole, domyślnie zwinięty,
  - wyłączone: minimap, breadcrumbs (opcjonalnie), layout control, command center wg ustawień,
  - kompaktowe zakładki, `editor.renderLineHighlight: "gutter"`, cieńsze scrollbary, `window.titleBarStyle: "custom"`.
- Polecenie `Zed Layout: Restore Previous` — przed zmianą zapisujemy kopię dotychczasowych wartości (w `globalState`) i umożliwiamy pełne cofnięcie.
- Wybór zakresu: *User* lub *Workspace* settings.
- Rekomendacja (nie wymóg) użycia **VS Code Profiles**: instrukcja/polecenie eksportu presetu jako profilu `.code-profile`.

### 3.2 Motyw i typografia
- Własne motywy `Zed-like Dark` i `Zed-like Light` (kontrybucja `themes`), stonowana paleta, wyraźne rozróżnienie paneli.
- Ustawienia fontu edytora i terminala, `editor.lineHeight`, ligatury — konfigurowalne.

### 3.3 Panel agentów (rdzeń „multi-agent”)
Widok `Agents` w Secondary Side Bar (TreeView, w późniejszej fazie ewentualnie Webview):
- **Lista sesji agentów** — każda sesja = nazwany terminal z ikoną i kolorem (`TerminalOptions.iconPath`, `color`), uruchamiający skonfigurowane polecenie (np. `claude`, `codex`, `gemini`).
- Akcje: *New Agent Session* (wybór agenta z listy w ustawieniach), *Focus*, *Rename*, *Stop*, *Restart*.
- **Status sesji**: działa / czeka na input / zakończona — na podstawie Shell Integration API (`onDidStartTerminalShellExecution`, `onDidEndTerminalShellExecution`) i aktywności wyjścia; badge z liczbą sesji wymagających uwagi.
- Sesje domyślnie otwierane jako **karty w obszarze edytora** (obok kodu, jak wątki w Zed); panel na dole jako opcja w ustawieniach.
- Konfiguracja agentów w `settings.json`:
  ```jsonc
  "zedLayout.agents": [
    { "id": "claude", "label": "Claude Code", "command": "claude",   "icon": "sparkle", "color": "terminal.ansiMagenta" },
    { "id": "codex",  "label": "Codex",       "command": "codex",    "icon": "robot",   "color": "terminal.ansiGreen" },
    { "id": "agy",    "label": "Agy",         "command": "agy",      "icon": "rocket",  "color": "terminal.ansiBlue" },
    { "id": "kilo",   "label": "Kilo Code",   "command": "kilocode", "icon": "zap",     "color": "terminal.ansiYellow" }
  ]
  ```
- Domyślnie skonfigurowani agenci: **Claude Code, Codex, Agy, Kilo Code**. Polecenia uruchamiające są edytowalne (nazwa binarki może się różnić w zależności od instalacji).

### 3.4 Izolacja agentów — git worktree
- Opcja „New Agent Session in Worktree”: tworzy `git worktree` na nowej gałęzi (np. `agent/<nazwa>-<krótki-id>`) w katalogu konfigurowalnym (domyślnie poza repo, np. `../<repo>.worktrees/`), uruchamia agenta z `cwd` w tym worktree.
- Lista worktree przy sesjach, akcje: *Open in New Window*, *Compare with Base*, *Merge/Cherry-pick* (przez wbudowany Git), *Remove Worktree* (z potwierdzeniem i sprawdzeniem niezacommitowanych zmian).
- Dzięki temu kilku agentów pracuje równolegle bez konfliktów w jednym katalogu roboczym.

### 3.5 Przegląd zmian agentów („Review”)
- Widok `Agent Changes`: pliki zmienione w danej sesji/worktree względem gałęzi bazowej.
- Otwieranie wszystkich zmian w jednym edytorze wielodiffowym (`vscode.changes`) — najbliższy odpowiednik multibuffera Zeda.
- Akcje *Accept* (stage/commit) i *Reject* (przywrócenie pliku) per plik i zbiorczo.

### 3.6 Skróty klawiszowe
- Opcjonalny zestaw (włączany ustawieniem / `when`-clause `config.zedLayout.keymap`) zbliżony do Zeda, m.in.:
  przełącz panel agentów, przełącz drzewo projektu, przełącz terminal, nowa sesja agenta, następna/poprzednia sesja, otwórz Review.
- Bez nadpisywania domyślnych skrótów VS Code, gdy zestaw jest wyłączony.

### 3.7 Konfiguracja i UX
- Prefiks ustawień: `zedLayout.*`.
- Walkthrough (`contributes.walkthroughs`) przy pierwszym uruchomieniu: zastosuj układ → skonfiguruj agentów → uruchom pierwszą sesję.
- Pełna odwracalność zmian i brak modyfikacji ustawień bez wyraźnej zgody użytkownika.

## 4. Poza zakresem (na teraz)
- Własna implementacja agenta / czat z modelem — integrujemy istniejące CLI.
- Implementacja Agent Client Protocol (ACP) — kandydat na późniejszą fazę.
- Kopiowanie zasobów graficznych, ikon czy motywów Zeda 1:1.
- VS Code for the Web / Codespaces / vscode.dev — wspieramy **tylko VS Code na komputer** (`extensionKind: ["workspace"]`, wymagany lokalny `git` i CLI agentów).

## 5. Architektura techniczna
- **Język/Build:** TypeScript, `esbuild`, `@types/vscode` (min. VS Code 1.95 — stabilne Shell Integration API i `vscode.changes`).
- **Moduły:**
  - `layout/` — preset ustawień, backup/restore,
  - `theme/` — pliki motywów JSON,
  - `agents/` — rejestr agentów, menedżer sesji terminalowych, wykrywanie statusu,
  - `worktrees/` — obsługa `git worktree` (przez `child_process` + API rozszerzenia `vscode.git`),
  - `review/` — widok zmian i akcje,
  - `views/` — TreeDataProvider-y, kontrybucje `viewsContainers.secondarySidebar` (lub panel + polecenie przeniesienia),
  - `keymap/` — keybindings w `package.json`.
- **Testy:** `@vscode/test-cli` + `@vscode/test-electron` (testy integracyjne), testy jednostkowe logiki (backup ustawień, parsowanie worktree) w Mocha/Vitest.
- **CI:** GitHub Actions — lint, build, testy (xvfb), pakowanie `vsce package`.
- **Dystrybucja:** VSIX w GitHub Releases; później VS Code Marketplace i Open VSX.
- **Licencja:** GPL-3.0 (zgodnie z repozytorium).

## 6. Etapy (milestones)

| Etap | Zawartość | Efekt |
|---|---|---|
| **M0 – Szkielet** | scaffolding, build, lint, CI, README | Pustą wtyczkę da się zbudować i uruchomić |
| **M1 – Układ i wygląd** | preset układu + restore, motywy, typografia | „Wygląda jak Zed” |
| **M2 – Panel agentów i worktree** | konfiguracja agentów, sesje terminalowe (karty edytora), sesje w git worktree, statusy, widok w Secondary Side Bar | Wiele agentów naraz, każdy w izolacji |
| **M3 – Review** | widok zmian, multi-diff, accept/reject | Wygodny przegląd pracy agentów |
| **M4 – Szlif i wydanie** | keymap, walkthrough, dokumentacja, publikacja | Wersja 0.1.0 |

## 7. Zgłoszenia

1. **[M0] Szkielet rozszerzenia** — TypeScript + esbuild, `package.json` z kontrybucjami, ESLint/Prettier, `F5` debug, README.
2. **[M0] CI w GitHub Actions** — build, lint, testy z xvfb, artefakt `.vsix`.
3. **[M1] Polecenie „Apply Zed Layout” z backupem i „Restore Previous”** — wybór zakresu User/Workspace, testy jednostkowe backupu.
4. **[M1] Motywy Zed-like Dark/Light + ustawienia typografii.**
5. **[M1] Eksport presetu jako VS Code Profile** (plik `.code-profile` + instrukcja).
6. **[M2] Konfiguracja agentów (`zedLayout.agents`) + polecenie „New Agent Session”.**
7. **[M2] Widok „Agents” w Secondary Side Bar** — lista sesji, focus/rename/stop/restart.
8. **[M2] Wykrywanie statusu sesji agenta** (Shell Integration) + badge „wymaga uwagi”.
9. **[M2] Sesje agentów w git worktree** — tworzenie, otwieranie, usuwanie z zabezpieczeniami.
10. **[M3] Widok „Agent Changes” + multi-diff + accept/reject.**
11. **[M4] Zestaw skrótów klawiszowych w stylu Zeda (opcjonalny).**
12. **[M4] Walkthrough pierwszego uruchomienia i dokumentacja użytkownika.**
13. **[M4] Publikacja: GitHub Releases, Marketplace, Open VSX.**

## 8. Ryzyka i otwarte pytania
- **Brak API do pełnej kontroli układu** — część ustawień (np. pozycja konkretnych widoków) da się zmienić tylko poleceniami `workbench.action.*`, a VS Code zapamiętuje układ per workspace. Preset może wymagać jednorazowego „ułożenia” przy pierwszym otwarciu workspace.
- **Wykrywanie stanu agenta „czeka na input”** jest heurystyczne (zależy od CLI); dopuszczamy, by w v0.1 status był uproszczony (działa / zakończony).
- **Decyzje (odpowiedzi na pytania z planu):**
  1. Domyślni agenci: Claude Code, Codex, Agy, Kilo Code.
  2. Sesje agentów otwierane jako karty obok kodu (obszar edytora).
  3. Worktree przesunięte z M3 do M2 — razem z sesjami agentów.
  4. Tylko VS Code na komputer.
