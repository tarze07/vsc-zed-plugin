# Zed-like Agent Workspace

Rozszerzenie do Visual Studio Code, które ustawia środowisko tak, by wyglądało i działało jak
widok edytora [Zed](https://zed.dev) nastawiony na pracę z agentami AI, oraz ułatwia
**równoległą pracę z wieloma agentami** (Claude Code, Codex, Agy, Kilo Code) — każdy w osobnej
sesji terminala, opcjonalnie w izolowanym `git worktree`, z przeglądem zmian w jednym multi-diffie.

> **Status:** wersja podglądowa (M4). Rozszerzenie nie jest powiązane z Zed Industries — to
> niezależny projekt inspirowany układem Zeda. Plan i etapy prac: [docs/PLAN.md](docs/PLAN.md).

## Funkcje

- **Układ w stylu Zeda** — _Apply Zed Layout_: pasek aktywności u góry, drzewo projektu po lewej,
  Secondary Side Bar po prawej, terminal na dole, bez minimapy, kompaktowe zakładki. Przed zmianą
  pyta o zgodę i zakres (User/Workspace), zapisuje kopię ustawień; _Restore Previous Layout_
  cofa wszystko. Alternatywnie: import gotowego **profilu VS Code**.
- **Motywy Zed-like Dark / Zed-like Light** — stonowane, z kontrastem WCAG AA, oraz typografia
  (font, interlinia, ligatury) dla edytora i terminala.
- **Sesje agentów** — każdy agent CLI w nazwanym terminalu z ikoną i kolorem, jako karta obok
  kodu albo w panelu. Lista agentów jest konfigurowalna (`zedLayout.agents`).
- **Widok „Agents”** — lista sesji ze statusem (_starting_ / _running_ / _waiting_ / _exited_),
  badge z liczbą sesji wymagających uwagi, powiadomienia, akcje focus/rename/stop/restart.
- **Worktree** — sesja w osobnym `git worktree` na nowej gałęzi (`agent/<agent>-<id>`), dzięki
  czemu kilku agentów pracuje równolegle nad tym samym repozytorium; porównanie z bazą i
  bezpieczne usuwanie.
- **Widok „Agent Changes”** — pliki zmienione przez każdą sesję względem bazy, wszystkie zmiany w
  jednym multi-diffie, Accept (stage) / Reject per plik lub zbiorczo, commit i scalenie gałęzi
  agenta do bazowej.
- **Skróty w stylu Zeda** — opcjonalne (`zedLayout.keymap.enabled`, domyślnie wyłączone).
- **Walkthrough** — przewodnik pierwszego uruchomienia: _Get started with Zed-like Agent
  Workspace_ (patrz niżej).

## Szybki start

1. **Instalacja.** Pobierz plik `vsc-zed-plugin-<wersja>.vsix` z
   [wydań na GitHubie](https://github.com/tarze07/vsc-zed-plugin/releases) (albo zbuduj go:
   `npm run package`) i zainstaluj: paleta poleceń → **Extensions: Install from VSIX...** albo
   `code --install-extension vsc-zed-plugin-<wersja>.vsix`.
2. **Walkthrough.** Po instalacji z poziomu VS Code otwiera się przewodnik _Get started with
   Zed-like Agent Workspace_. Możesz go otworzyć w każdej chwili: **Help → Welcome** (sekcja
   _Walkthroughs_) albo paleta → **Welcome: Open Walkthrough...**.
3. **Układ.** Paleta (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Zed Layout: Apply Zed Layout** →
   wybierz zakres i potwierdź listę zmian.
4. **Agent.** Upewnij się, że CLI agenta działa w zwykłym terminalu (np. `claude --version`), a
   potem **Zed Layout: New Agent Session** (albo **New Agent Session in Worktree**, by agent
   pracował na własnej gałęzi).
5. **Przegląd.** Gdy agent skończy, **Zed Layout: Review Agent Changes** — przejrzyj diff,
   zaakceptuj lub odrzuć zmiany, scal gałąź.

Pełny scenariusz pracy z kilkoma agentami: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).
Problemy (agent nie w `PATH`, brak statusu _waiting_, Windows…): [docs/FAQ.md](docs/FAQ.md).

## Walkthrough i ilustracje

Przewodnik ma sześć kroków: zastosuj układ → wybierz motyw (opcjonalnie) → skonfiguruj agentów →
uruchom pierwszą sesję (opcjonalnie w worktree) → przejrzyj zmiany → skróty klawiszowe
(opcjonalnie). Treść kroków jest w katalogu [`walkthrough/`](walkthrough).

Repozytorium nie zawiera zrzutów ekranu. Schematyczne ilustracje (rysunki SVG w palecie motywu
Zed-like Dark, nie zrzuty ekranu) użyte w walkthrough:
[układ](walkthrough/media/layout.svg), [sesje i worktree](walkthrough/media/sessions.svg),
[przegląd zmian](walkthrough/media/review.svg).

## Polecenia

Wszystkie polecenia mają kategorię **Zed Layout** w palecie poleceń. Polecenia oznaczone „nie”
w kolumnie _W palecie_ są dostępne z menu widoków _Agents_ / _Agent Changes_ (działają na
wskazanej sesji lub pliku). Tabela jest generowana z `package.json`
(`node scripts/docs-tables.mjs --write`).

<!-- commands:start -->

| Polecenie                                      | Id                                    | W palecie         | Opis                                                                       |
| ---------------------------------------------- | ------------------------------------- | ----------------- | -------------------------------------------------------------------------- |
| Zed Layout: Hello                              | `zedLayout.hello`                     | tak               | Polecenie testowe — pokazuje powitanie.                                    |
| Zed Layout: Apply Zed Layout                   | `zedLayout.apply`                     | tak               | Stosuje układ, motyw i typografię w stylu Zeda (z potwierdzeniem i kopią). |
| Zed Layout: Restore Previous Layout            | `zedLayout.restore`                   | tak               | Przywraca ustawienia sprzed pierwszego Apply.                              |
| Zed Layout: New Agent Session                  | `zedLayout.agents.newSession`         | tak               | Uruchamia agenta w nowym terminalu (argument: id agenta).                  |
| Zed Layout: Focus Agent Session                | `zedLayout.agents.focus`              | nie (menu widoku) | Pokazuje terminal sesji i kasuje znacznik „wymaga uwagi”.                  |
| Zed Layout: Rename Agent Session               | `zedLayout.agents.rename`             | nie (menu widoku) | Zmienia nazwę sesji.                                                       |
| Zed Layout: Stop Agent Session                 | `zedLayout.agents.stop`               | nie (menu widoku) | Zamyka terminal sesji (z potwierdzeniem, gdy agent działa).                |
| Zed Layout: Restart Agent Session              | `zedLayout.agents.restart`            | nie (menu widoku) | Uruchamia sesję ponownie z tymi samymi parametrami.                        |
| Zed Layout: Next Agent Session                 | `zedLayout.agents.next`               | tak               | Przełącza na następną sesję.                                               |
| Zed Layout: Previous Agent Session             | `zedLayout.agents.previous`           | tak               | Przełącza na poprzednią sesję.                                             |
| Zed Layout: New Agent Session in Worktree      | `zedLayout.worktrees.newSession`      | tak               | Tworzy `git worktree` na nowej gałęzi i uruchamia w nim agenta.            |
| Zed Layout: Open Worktree in New Window        | `zedLayout.worktrees.openInNewWindow` | nie (menu widoku) | Otwiera katalog worktree w nowym oknie.                                    |
| Zed Layout: Compare Worktree with Base         | `zedLayout.worktrees.compareWithBase` | nie (menu widoku) | Pokazuje zmiany worktree względem bazy (multi-diff).                       |
| Zed Layout: Remove Worktree                    | `zedLayout.worktrees.remove`          | nie (menu widoku) | Bezpiecznie usuwa worktree (opcjonalnie także gałąź).                      |
| Zed Layout: Review Agent Changes               | `zedLayout.review.open`               | tak               | Pokazuje sesję w widoku Agent Changes i otwiera jej zmiany.                |
| Zed Layout: Refresh Agent Changes              | `zedLayout.review.refresh`            | nie (menu widoku) | Odświeża widok Agent Changes.                                              |
| Zed Layout: Open All Changes                   | `zedLayout.review.openAll`            | tak               | Otwiera wszystkie zmiany sesji w jednym multi-diffie.                      |
| Zed Layout: Open Change                        | `zedLayout.review.openFile`           | nie (menu widoku) | Otwiera diff jednego pliku.                                                |
| Zed Layout: Accept Change                      | `zedLayout.review.accept`             | nie (menu widoku) | Akceptuje (stage) wybrane pliki.                                           |
| Zed Layout: Reject Change                      | `zedLayout.review.reject`             | nie (menu widoku) | Przywraca wybrane pliki do wersji bazowej (nieodwracalne).                 |
| Zed Layout: Accept All Changes                 | `zedLayout.review.acceptAll`          | tak               | Stage lub commit wszystkich zmian sesji.                                   |
| Zed Layout: Reject All Changes                 | `zedLayout.review.rejectAll`          | tak               | Przywraca wszystkie pliki sesji do bazy (nieodwracalne).                   |
| Zed Layout: Merge Agent Branch into Base       | `zedLayout.review.mergeIntoBase`      | tak               | Scala gałąź agenta do gałęzi bazowej (`git merge --no-ff`).                |
| Zed Layout: Save Zed Layout as Profile File... | `zedLayout.profile.save`              | tak               | Zapisuje preset jako plik profilu VS Code (`.code-profile`).               |
| Zed Layout: Toggle Agents Panel                | `zedLayout.keymap.toggleAgentsPanel`  | tak               | Pokazuje kontener Agents z fokusem (skrót Zeda przełącza widoczność).      |
| Zed Layout: Toggle Project Panel               | `zedLayout.keymap.toggleProjectPanel` | tak               | Pokazuje Eksplorator z fokusem (skrót Zeda przełącza widoczność).          |

<!-- commands:end -->

Polecenia można przypisać do własnych skrótów w **Preferences: Open Keyboard Shortcuts**, np.
`{ "key": "ctrl+alt+c", "command": "zedLayout.agents.newSession", "args": "claude" }` uruchamia
od razu agenta o id `claude`. Gotowy zestaw skrótów w stylu Zeda: [docs/KEYMAP.md](docs/KEYMAP.md).

## Ustawienia

Wszystkie ustawienia mają prefiks `zedLayout.` (UI ustawień: wyszukaj `zedLayout`). Tabela jest
generowana z `package.json`.

<!-- settings:start -->

| Ustawienie                             | Typ / wartości                     | Domyślnie                                                                    | Opis                                                                                          |
| -------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `zedLayout.enabled`                    | boolean                            | `true`                                                                       | Włącza funkcje rozszerzenia.                                                                  |
| `zedLayout.layout.scope`               | `ask` / `user` / `workspace`       | `"ask"`                                                                      | Gdzie _Apply Zed Layout_ zapisuje ustawienia: pytaj, User albo Workspace.                     |
| `zedLayout.layout.confirmBeforeApply`  | boolean                            | `true`                                                                       | Pytaj o potwierdzenie przed zmianą ustawień.                                                  |
| `zedLayout.layout.activityBarLocation` | `top` / `hidden`                   | `"top"`                                                                      | Położenie Activity Bar ustawiane przez preset.                                                |
| `zedLayout.layout.hideBreadcrumbs`     | boolean                            | `false`                                                                      | Ukryj breadcrumbs przy stosowaniu presetu.                                                    |
| `zedLayout.layout.applyTheme`          | boolean                            | `true`                                                                       | Przełącz też motyw kolorów przy stosowaniu presetu.                                           |
| `zedLayout.layout.theme`               | `Zed-like Dark` / `Zed-like Light` | `"Zed-like Dark"`                                                            | Motyw ustawiany przez preset (gdy `zedLayout.layout.applyTheme` = `true`).                    |
| `zedLayout.typography.enabled`         | boolean                            | `true`                                                                       | Stosuj typografię (font, interlinia, ligatury) w ramach presetu.                              |
| `zedLayout.typography.fontFamily`      | string                             | `"'IBM Plex Mono', 'Lilex', Menlo, Consolas, 'DejaVu Sans Mono', monospace"` | Font edytora ustawiany przez preset.                                                          |
| `zedLayout.typography.fontSize`        | number                             | `14`                                                                         | Rozmiar fontu edytora (6–72).                                                                 |
| `zedLayout.typography.lineHeight`      | number                             | `1.6`                                                                        | Wysokość linii; wartości &lt; 8 to mnożnik rozmiaru fontu.                                    |
| `zedLayout.typography.ligatures`       | boolean                            | `false`                                                                      | Ligatury w edytorze.                                                                          |
| `zedLayout.typography.applyToTerminal` | boolean                            | `true`                                                                       | Zastosuj font i rozmiar także w terminalu.                                                    |
| `zedLayout.agents`                     | array                              | 4 wpisy: `claude`, `codex`, `agy`, `kilocode`                                | Agenci CLI dostępni dla nowych sesji — patrz [docs/AGENTS.md](docs/AGENTS.md).                |
| `zedLayout.agentSessionLocation`       | `editor` / `panel`                 | `"editor"`                                                                   | Gdzie otwierają się nowe sesje: karta edytora albo panel terminala.                           |
| `zedLayout.status.notifyOnAttention`   | boolean                            | `true`                                                                       | Powiadomienie, gdy sesja w tle wymaga uwagi.                                                  |
| `zedLayout.status.waitingAfterSeconds` | number                             | `5`                                                                          | Po ilu sekundach bez wyjścia działający agent jest uznawany za czekającego.                   |
| `zedLayout.worktrees.directory`        | string                             | `""`                                                                         | Katalog na worktree; pusty: `../<repo>.worktrees`, ścieżki względne od katalogu repozytorium. |
| `zedLayout.worktrees.branchPrefix`     | string                             | `"agent/"`                                                                   | Prefiks gałęzi tworzonych dla agentów.                                                        |
| `zedLayout.review.acceptAllAction`     | `ask` / `stage` / `commit`         | `"ask"`                                                                      | Co robi _Accept All Changes_: pytaj, stage albo commit.                                       |
| `zedLayout.keymap.enabled`             | boolean                            | `false`                                                                      | Włącza skróty klawiszowe w stylu Zeda (domyślnie wyłączone — nic nie jest nadpisywane).       |

<!-- settings:end -->

Domyślna wartość `zedLayout.agents`:

```jsonc
"zedLayout.agents": [
  { "id": "claude", "label": "Claude Code", "command": "claude",   "args": [], "icon": "sparkle", "color": "terminal.ansiMagenta" },
  { "id": "codex",  "label": "Codex",       "command": "codex",    "args": [], "icon": "robot",   "color": "terminal.ansiGreen" },
  { "id": "agy",    "label": "Agy",         "command": "agy",      "args": [], "icon": "rocket",  "color": "terminal.ansiBlue" },
  { "id": "kilo",   "label": "Kilo Code",   "command": "kilocode", "args": [], "icon": "zap",     "color": "terminal.ansiYellow" }
]
```

Ustawienie zastępuje całą listę — aby dodać agenta, skopiuj domyślne wpisy i dopisz własny
(pola `id`, `label`, `command`, `args`, `icon`, `color`, `env`; szczegóły w
[docs/AGENTS.md](docs/AGENTS.md)).

## Dokumentacja

| Dokument                                 | Zawartość                                                           |
| ---------------------------------------- | ------------------------------------------------------------------- |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Przewodnik: praca z wieloma agentami równolegle, od układu po merge |
| [docs/FAQ.md](docs/FAQ.md)               | Najczęstsze problemy i pytania                                      |
| [docs/LAYOUT.md](docs/LAYOUT.md)         | _Apply Zed Layout_: zmieniane ustawienia, kopia i przywracanie      |
| [docs/PROFILE.md](docs/PROFILE.md)       | Preset jako profil VS Code (import, zapis własnego pliku)           |
| [docs/THEMES.md](docs/THEMES.md)         | Paleta, kontrast WCAG, typografia i zalecane fonty                  |
| [docs/AGENTS.md](docs/AGENTS.md)         | Konfiguracja agentów, uruchamianie sesji, cytowanie argumentów      |
| [docs/VIEWS.md](docs/VIEWS.md)           | Widok _Agents_, przeniesienie do Secondary Side Bar                 |
| [docs/STATUS.md](docs/STATUS.md)         | Wykrywanie statusu sesji, powiadomienia, ograniczenia               |
| [docs/WORKTREES.md](docs/WORKTREES.md)   | Sesje w `git worktree`: katalogi, gałęzie, porównanie, usuwanie     |
| [docs/REVIEW.md](docs/REVIEW.md)         | Widok _Agent Changes_: accept/reject, commit, merge                 |
| [docs/KEYMAP.md](docs/KEYMAP.md)         | Skróty klawiszowe w stylu Zeda                                      |
| [docs/RELEASING.md](docs/RELEASING.md)   | Wydawanie wersji (dla opiekunów)                                    |
| [docs/PLAN.md](docs/PLAN.md)             | Plan projektu i zakres                                              |

## Wymagania

- [Visual Studio Code](https://code.visualstudio.com/) 1.95 lub nowszy (wersja desktopowa),
- `git` w `PATH` (worktree i przegląd zmian),
- CLI agentów, których chcesz używać (Claude Code, Codex, Agy, Kilo Code lub dowolne inne),
- terminal z Shell Integration (bash, zsh, fish, pwsh) — dla pełnego wykrywania statusu.

## Rozwój

Wymagany [Node.js](https://nodejs.org/) 22 lub nowszy (z npm).

### Budowanie

```bash
npm install          # instalacja zależności
npm run build        # bundel esbuild: src/extension.ts -> dist/extension.js
npm run watch        # przebudowa przy każdej zmianie
```

Kontrola jakości:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run format:check # Prettier (sprawdzenie)
npm run format       # Prettier (formatowanie)
```

### Uruchamianie i debugowanie

1. Otwórz katalog repozytorium w VS Code.
2. Zainstaluj rekomendowane rozszerzenia (`.vscode/extensions.json`).
3. Naciśnij `F5` (konfiguracja **Run Extension**) — zostanie uruchomione okno
   _Extension Development Host_ z załadowanym rozszerzeniem.
4. W palecie poleceń wybierz **Zed Layout: Apply Zed Layout** albo otwórz walkthrough
   (**Welcome: Open Walkthrough...** → _Get started with Zed-like Agent Workspace_).

Podczas pracy możesz uruchomić zadanie `npm: watch` (`Ctrl+Shift+B`), aby bundel przebudowywał się
automatycznie.

### Testy

Testy integracyjne korzystają z `@vscode/test-cli` i `@vscode/test-electron` (pobierają VS Code
przy pierwszym uruchomieniu):

```bash
npm test
```

Szybkie testy jednostkowe (bez pobierania VS Code):

```bash
npm run test:unit
```

Na Linuksie bez środowiska graficznego (np. w CI) użyj `xvfb-run -a npm test`.
Testy można też uruchomić z VS Code konfiguracją **Extension Tests**.

### Motywy, profil i dokumentacja

```bash
npm run themes:generate  # regeneruje themes/*.json ze scripts/generate-themes.mjs
npm run themes:contrast  # raport kontrastu WCAG (kończy się błędem, gdy para nie spełnia progu)
npm run profile:generate # regeneruje profiles/zed-like.code-profile
node scripts/docs-tables.mjs --write  # odświeża tabele poleceń i ustawień w README.md
node scripts/docs-tables.mjs --check  # błąd, gdy tabele w README.md są nieaktualne
```

### Pakowanie

```bash
npm run package      # tworzy vsc-zed-plugin-<wersja>.vsix
code --install-extension vsc-zed-plugin-<wersja>.vsix
```

Wydania: [docs/RELEASING.md](docs/RELEASING.md).

## Licencja

[GPL-3.0-only](LICENSE).
