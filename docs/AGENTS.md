# Sesje agentów — konfiguracja i polecenia

Issue #6, plan: sekcja 3.3 w [PLAN.md](PLAN.md). Każda sesja agenta to nazwany terminal (z ikoną i kolorem), w którym uruchamiane jest skonfigurowane polecenie CLI agenta.

## Konfiguracja agentów (`zedLayout.agents`)

Lista obiektów w `settings.json` (User lub Workspace). Domyślnie skonfigurowani są czterej agenci:

```jsonc
"zedLayout.agents": [
  { "id": "claude", "label": "Claude Code", "command": "claude",   "args": [], "icon": "sparkle", "color": "terminal.ansiMagenta" },
  { "id": "codex",  "label": "Codex",       "command": "codex",    "args": [], "icon": "robot",   "color": "terminal.ansiGreen" },
  { "id": "agy",    "label": "Agy",         "command": "agy",      "args": [], "icon": "rocket",  "color": "terminal.ansiBlue" },
  { "id": "kilo",   "label": "Kilo Code",   "command": "kilocode", "args": [], "icon": "zap",     "color": "terminal.ansiYellow" }
]
```

Ustawienie zastępuje całą listę — aby dodać agenta, skopiuj domyślne wpisy i dopisz własny.

| Pole | Wymagane | Opis |
|---|---|---|
| `id` | tak | Unikalny identyfikator: małe litery, cyfry, `-`, `_`; zaczyna się literą lub cyfrą (`^[a-z0-9][a-z0-9-_]*$`). |
| `label` | tak | Nazwa wyświetlana (QuickPick, domyślna nazwa sesji). |
| `command` | tak | Plik wykonywalny: nazwa szukana w `PATH`, ścieżka bezwzględna, względna (względem katalogu roboczego sesji) lub zaczynająca się od `~/`. |
| `args` | nie | Tablica argumentów (stringi). Każdy argument jest bezpiecznie cytowany — nie trzeba (i nie należy) dodawać własnych cudzysłowów. |
| `icon` | nie | Id ikony [Codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html), np. `sparkle`. Domyślnie `hubot`. |
| `color` | nie | Id koloru motywu, np. `terminal.ansiMagenta`. |
| `env` | nie | Dodatkowe zmienne środowiskowe terminala (`{ "NAZWA": "wartość" }`). |

Przykład — agent z argumentami, zmienną środowiskową i pełną ścieżką:

```jsonc
{
  "id": "claude-opus",
  "label": "Claude (Opus)",
  "command": "/opt/claude/bin/claude",
  "args": ["--model", "opus"],
  "icon": "sparkle",
  "color": "terminal.ansiMagenta",
  "env": { "CLAUDE_CONFIG_DIR": "/home/me/.claude-work" }
}
```

**Walidacja:** wpisy z błędami (zły `id`, pusty `label`/`command`, `args` niebędące tablicą stringów, `env` z wartościami innymi niż stringi) oraz duplikaty `id` (wygrywa pierwszy wpis) są pomijane. Po zmianie ustawienia pojawia się ostrzeżenie z listą problemów i przyciskiem *Open Settings*. Zmiany są widoczne od razu — bez przeładowania okna.

## Miejsce otwierania sesji (`zedLayout.agentSessionLocation`)

- `editor` (domyślnie) — sesja otwiera się jako karta terminala w obszarze edytora, obok kodu (jak wątki w Zed).
- `panel` — sesja otwiera się w panelu terminala na dole.

Ustawienie dotyczy nowych sesji; *Restart* zachowuje miejsce, w którym sesja była uruchomiona.

## Jak uruchamiana jest sesja

1. Wybór agenta (QuickPick) — chyba że polecenie dostało `id` agenta.
2. Sprawdzenie, czy `command` istnieje (`PATH`, na Windows także `PATHEXT`). Jeśli nie — komunikat błędu z przyciskiem *Open Settings*, terminal nie jest tworzony.
3. Utworzenie zwykłego terminala ze skonfigurowaną powłoką: nazwa = `label` (kolejne: `label 2`, `label 3`, …), ikona, kolor, `env`, katalog roboczy = pierwszy folder przestrzeni roboczej (albo katalog worktree, #9).
4. Wysłanie polecenia agenta do powłoki — przez Shell Integration (`executeCommand`), gdy pojawi się w ciągu ~3 s, w przeciwnym razie przez `sendText`. Dzięki temu po zakończeniu agenta powłoka pozostaje używalna, a wykrywanie statusu (#8) dostaje zdarzenia start/koniec polecenia.

Argumenty są cytowane zgodnie z powłoką: POSIX (`'…'`, `'` → `'\''`), PowerShell na Windows (`'…'`, `'` → `''`, polecenie ze spacjami poprzedzone `&`), cmd.exe (`"…"`, gdy domyślną powłoką jest cmd).

## Polecenia

| Polecenie | Id | Uwagi |
|---|---|---|
| New Agent Session | `zedLayout.agents.newSession` | Opcjonalny argument: `id` agenta (np. w skrócie klawiszowym). |
| Focus Agent Session | `zedLayout.agents.focus` | Pokazuje terminal i kasuje znacznik „wymaga uwagi”. |
| Rename Agent Session | `zedLayout.agents.rename` | Pyta o nową nazwę; zmienia też nazwę karty terminala (best effort). |
| Stop Agent Session | `zedLayout.agents.stop` | Zamyka terminal; gdy agent działa lub czeka na input — pyta o potwierdzenie. |
| Restart Agent Session | `zedLayout.agents.restart` | Zamyka i uruchamia ponownie z tym samym agentem, nazwą, katalogiem i worktree. |
| Next / Previous Agent Session | `zedLayout.agents.next` / `.previous` | Przełącza fokus między sesjami w kolejności utworzenia. |

Focus/Rename/Stop/Restart przyjmują sesję (z widoku Agents), jej id lub nic — wtedy pojawia się QuickPick z listą sesji. Zamknięcie terminala ręcznie usuwa sesję z listy. Wyłączenie rozszerzenia nie zamyka terminali agentów.

Przykładowy skrót klawiszowy (`keybindings.json`):

```jsonc
{ "key": "ctrl+alt+c", "command": "zedLayout.agents.newSession", "args": "claude" },
{ "key": "ctrl+alt+]", "command": "zedLayout.agents.next" },
{ "key": "ctrl+alt+[", "command": "zedLayout.agents.previous" }
```

## Przywracanie sesji (`zedLayout.sessions.restoreOnStartup`)

Metadane sesji (id, agent, nazwa, katalog, worktree, miejsce otwarcia, czas utworzenia, nazwa terminala) są zapisywane w stanie przestrzeni roboczej (`context.workspaceState`, klucz `zedLayout.sessions`, z numerem wersji schematu) przy każdej zmianie: start, zmiana nazwy, stop, restart. Dzięki temu po *Developer: Reload Window* (lub ponownym otwarciu folderu) sesje wracają na listę w widoku Agents.

**Dopasowanie terminali po przeładowaniu.** Po aktywacji (`onStartupFinished`) rozszerzenie bierze terminale przywrócone przez VS Code (`window.terminals` oraz nowe terminale otwierane przez ~5 s) i dopasowuje je do zapisanych sesji — w kolejności:

1. znacznik środowiska `ZED_LAYOUT_SESSION_ID` (ustawiany na każdym terminalu agenta; odczytywany z `terminal.creationOptions.env`, o ile VS Code go przekazuje),
2. nazwa terminala + katalog roboczy (ścieżki porównywane po normalizacji, na Windows bez rozróżniania wielkości liter),
3. sama nazwa — tylko gdy jest jednoznaczna (jeden terminal i jedna sesja o tej nazwie).

Jeden terminal nigdy nie jest dopasowany dwa razy, a terminal ze znacznikiem innej (nieznanej) sesji nie jest dopasowywany po nazwie. Dopasowany terminal zostaje **przejęty** (adopted): sesja wraca z tym samym id, nazwą i agentem, **bez ponownego uruchamiania polecenia agenta**. Status startowy to `running`; dokładniejszy status pojawi się, gdy shell integration zgłosi kolejne polecenie (#8). Jeśli agenta nie ma już w `zedLayout.agents`, sesja działa dalej, a *Restart* zapyta, którego agenta uruchomić.

**Sesje odłączone (detached).** Zapisane sesje, których terminal nie wrócił, trafiają do listy „odłączonych” w widoku Agents z akcjami:

- *Resume* (`zedLayout.agents.resume`) — uruchamia nową sesję z tym samym agentem, nazwą, katalogiem i worktree (jeśli agenta nie ma w konfiguracji — QuickPick) i usuwa wpis z listy,
- *Forget* (`zedLayout.agents.forget`) — usuwa wpis bez pytania; worktree (jeśli był) zostaje na dysku — usuniesz go w widoku Worktrees.

Oba polecenia przyjmują rekord sesji, element drzewa `{ record }` albo id; bez argumentu pokazują QuickPick. Terminal przywrócony później niż po 5 s jest jeszcze przejmowany, ale tylko na podstawie znacznika `ZED_LAYOUT_SESSION_ID`.

**Kiedy wpis znika.** Wpis jest usuwany przy *Stop*/*Restart*, *Forget*, *Resume* oraz gdy terminal zamknie użytkownik, proces powłoki lub inne rozszerzenie (`TerminalExitReason.User` / `Process` / `Extension`). Zamknięcie z powodu wyłączania lub przeładowania okna (`TerminalExitReason.Shutdown`) oraz dezaktywacja rozszerzenia **nie** usuwają wpisów — od pierwszego takiego zdarzenia żaden wpis nie jest już usuwany. Zamknięcie z nieznanego powodu (`Unknown`) przenosi sesję do odłączonych (bezpieczniej zapytać niż zgubić worktree).

**Ustawienie.** `zedLayout.sessions.restoreOnStartup` (domyślnie `true`). Po wyłączeniu zapisane sesje nie są przejmowane ani pokazywane jako odłączone przy starcie (stare wpisy są odrzucane); bieżące sesje nadal są zapisywane, więc ponowne włączenie zadziała od następnego przeładowania.

**Ograniczenia.**

- Terminale musi przywrócić sam VS Code: wymagane `terminal.integrated.enablePersistentSessions` (domyślnie włączone). Bez tego wszystkie sesje po przeładowaniu będą odłączone.
- Ciągłość procesu agenta zależy od ponownego podłączenia procesu terminala przez VS Code (persistent terminal process reconnection, `terminal.integrated.persistentSessionReviveProcess`). Gdy VS Code przywraca tylko zawartość ekranu z nową powłoką, sesja zostanie przejęta, ale agent w niej już nie działa — uruchom go przez *Restart*.
- Po przejęciu status `running` jest tylko przybliżeniem do pierwszego zdarzenia shell integration; zakończenie agenta uruchomionego przed przeładowaniem może nie zostać wykryte.
- Stan jest zapisywany per przestrzeń robocza; sesje z innych okien nie są widoczne.

## Rozwiązywanie problemów: „command … was not found on PATH”

- Sprawdź w zwykłym terminalu: `which claude` (macOS/Linux) lub `Get-Command claude` (PowerShell). Wpisz w `command` pełną ścieżkę z wyniku.
- `PATH` sprawdzany jest w środowisku VS Code, nie w profilu powłoki. Jeśli CLI jest instalowane przez menedżera wersji (nvm, asdf, volta, pipx, npm prefix w `~/.npm-global`), a VS Code uruchamiasz z Docka/menu, katalog może nie być w `PATH` — uruchom VS Code z terminala (`code .`), dopisz katalog do `PATH` w profilu logowania lub podaj pełną ścieżkę.
- Na Windows nazwy bez rozszerzenia są szukane z rozszerzeniami z `PATHEXT` (`.exe`, `.cmd`, …) — globalne pakiety npm instalują pliki `.cmd`, co jest obsługiwane.
- Zdalnie (SSH, WSL, Dev Containers) rozszerzenie działa po stronie zdalnej — CLI agenta musi być zainstalowane tam.
- Jeśli `env` agenta ustawia `PATH`, wyszukiwanie używa tej wartości.
