# Widok „Agents”

Widok `Agents` (`zedLayout.agentsView`, issue #7, plan: sekcja 3.3 w [PLAN.md](PLAN.md)) pokazuje listę sesji agentów uruchomionych przez rozszerzenie.

## Co pokazuje widok

Płaska lista sesji w kolejności utworzenia. Każdy element to jedna sesja (jeden terminal):

- **etykieta** — nazwa sesji (ta sama co nazwa terminala),
- **opis** — agent · status · gałąź (gałąź tylko dla sesji w worktree), np. `Claude Code · waiting · agent/claude-1a2b`,
- **podpowiedź** (tooltip) — agent, polecenie z argumentami, katalog roboczy, ścieżka/gałąź/baza worktree, status, informacja „Needs attention” i czas startu.

Lista odświeża się automatycznie przy każdej zmianie sesji (dodanie, usunięcie, zmiana nazwy, zmiana statusu). W nagłówku widoku wyświetlana jest liczba sesji (np. „3 sessions”), a gdy istnieją sesje nieprzywrócone lub osierocone worktree — także one, np. „3 sessions · 1 not restored · 2 orphaned”.

## Sesje nieprzywrócone i osierocone worktree (#16)

Po przeładowaniu okna (*Reload Window*) rozszerzenie odtwarza sesje, których terminale VS Code przywrócił. Pozostałe sesje z poprzedniego okna są „odłączone” (*detached*), a worktree na gałęziach agentów (prefiks `zedLayout.worktrees.branchPrefix`, domyślnie `agent/`) bez żadnej sesji są „osierocone” (*orphaned*).

Gdy nie ma ani jednych, ani drugich, widok pozostaje płaską listą sesji (jak wyżej). W przeciwnym razie elementy są pogrupowane:

| Grupa | Zawartość | Ikona | Stan |
|---|---|---|---|
| **Sessions** | działające sesje (jak wyżej); gdy pusta — opis `none` | `terminal` | rozwinięta |
| **Not restored** | sesje, których terminal nie został przywrócony (tylko gdy są) | `history` | rozwinięta |
| **Orphaned worktrees** | worktree agentów bez sesji (tylko gdy są) | `git-branch` | rozwinięta; zwinięta, gdy jest ich więcej niż 5 |

Opis grupy to liczba elementów.

**Sesja nieprzywrócona** — etykieta: nazwa sesji; opis: `agent · not restored` (+ gałąź dla sesji w worktree), np. `Claude Code · not restored · agent/claude-1a2b`; ikona `debug-disconnect`; podpowiedź: agent, katalog roboczy, worktree (ścieżka/gałąź/baza), czas utworzenia. Akcje (w wierszu i w menu kontekstowym):

- *Resume Agent Session* — uruchamia nową sesję z tym samym agentem, nazwą, katalogiem i worktree,
- *Forget Agent Session* — usuwa wpis z listy (worktree pozostaje nietknięty; jeśli istnieje, pojawi się w grupie *Orphaned worktrees*).

**Osierocony worktree** — etykieta: nazwa gałęzi bez prefiksu (np. `claude-1a2b`), a przy odłączonym HEAD nazwa katalogu; opis: `orphaned`, dodatkowo `· missing` (katalog nie istnieje — kandydat do `git worktree prune`) i `· locked` (worktree zablokowany); ikona `git-branch`, a dla brakującego katalogu `warning`; podpowiedź: ścieżka, repozytorium, gałąź, baza, skrócony SHA HEAD. Akcje:

- *Start Agent Session in Worktree* (w wierszu i w menu) — nowa sesja agenta w tym worktree,
- *Open Worktree in New Window*,
- *Review Worktree Changes* — zmiany względem bazy w widoku *Agent Changes*,
- *Remove Worktree* (w wierszu i w menu).

Pasek tytułu widoku (menu „…”) zawiera dodatkowo *Clean Up Agent Worktrees...* (zbiorcze usuwanie osieroconych worktree) i *Refresh Orphaned Worktrees* (ponowne skanowanie repozytoriów).

Gdy nie ma żadnej sesji, widok pokazuje ekran powitalny z linkami *New Agent Session* i *New Agent Session in Worktree*. Gdy lista agentów w ustawieniu `zedLayout.agents` jest pusta, nad listą pojawia się komunikat z prośbą o skonfigurowanie agentów w ustawieniach.

## Statusy i ikony

| Status | Opis | Ikona |
|---|---|---|
| `starting` | terminal utworzony, polecenie agenta jeszcze nie działa | `loading~spin` (animowana) |
| `running` | agent pracuje | ikona agenta z `zedLayout.agents` (np. `sparkle`) w jego kolorze; bez ikony — `pulse` |
| `waiting` | agent prawdopodobnie czeka na odpowiedź użytkownika | `bell-dot`, kolor `charts.yellow` |
| `exited` (kod 0 lub nieznany) | proces/terminal zakończony | `circle-slash`, kolor `disabledForeground` |
| `exited` (kod ≠ 0) | zakończony błędem; opis zawiera kod, np. `exited (1)` | `error`, kolor `charts.red` |

## Akcje

- **Kliknięcie** elementu — *Focus Agent Session* (pokazuje terminal sesji i kasuje znacznik „wymaga uwagi”).
- **Pasek tytułu widoku** — *New Agent Session* (`$(add)`), *New Agent Session in Worktree* (`$(git-branch)`).
- **Przyciski w wierszu** — *Restart*, *Stop*.
- **Menu kontekstowe** — *Focus*, *Rename*, *Restart*, *Stop*; dla sesji w worktree dodatkowo *Open Worktree in New Window*, *Compare Worktree with Base*, *Remove Worktree*.

Widok przekazuje sesję jako argument poleceń `zedLayout.agents.*` / `zedLayout.worktrees.*`. `contextValue` elementu ma postać `agentSession.<status>`, a dla sesji w worktree `agentSession.<status>.worktree` (używane w warunkach `when` menu: `viewItem =~ /^agentSession/` i `viewItem =~ /^agentSession.*\.worktree/`).

Pozostałe elementy (#16): sesja nieprzywrócona ma `contextValue` `detachedSession` (`viewItem == detachedSession`) i przekazuje poleceniom `zedLayout.agents.resume` / `forget` swój zapisany rekord (`SessionRecord`); osierocony worktree ma `orphanWorktree` z opcjonalnymi przyrostkami `.prunable` / `.locked` (`viewItem =~ /^orphanWorktree/`) i przekazuje poleceniom `zedLayout.worktrees.orphan.*` obiekt `OrphanedWorktree`; grupy mają `group.sessions`, `group.detached`, `group.orphans` (bez akcji).

**Synchronizacja zaznaczenia:** gdy aktywnym terminalem staje się terminal sesji agenta, a widok jest widoczny, odpowiedni element zostaje zaznaczony (bez przenoszenia fokusu) — także wewnątrz grupy *Sessions*.

## Badge

Ikona kontenera *Agents* pokazuje badge z liczbą sesji wymagających uwagi (`needsAttention` — agent czeka na input albo zakończył się nieoczekiwanie, a sesja nie była jeszcze otwarta). Badge znika, gdy żadna sesja nie wymaga uwagi. Sesje nieprzywrócone i osierocone worktree nie zwiększają licznika; podpowiedź badge'a wspomina jedynie o liczbie sesji nieprzywróconych.

## Przeniesienie do Secondary Side Bar

Kontener *Agents* jest zarejestrowany w Activity Bar (lewy Side Bar), bo minimalna wspierana wersja VS Code (1.95) nie pozwala rozszerzeniom na deklarowanie kontenerów bezpośrednio w Secondary Side Bar. Aby mieć widok po prawej stronie, jak panel agentów w Zedzie:

1. Otwórz Secondary Side Bar: **View → Appearance → Secondary Side Bar** (`Ctrl+Alt+B` / `⌥⌘B`) — preset *Apply Zed Layout* robi to automatycznie.
2. Przeciągnij ikonę *Agents* z Activity Bar (albo nagłówek widoku *Agents*) na obszar Secondary Side Bar.
   - Alternatywa bez myszy: kliknij prawym przyciskiem ikonę *Agents* w Activity Bar → **Move To → Secondary Side Bar**, albo uruchom z palety **View: Move View** (`workbench.action.moveView`), wybierz *Agents*, a potem *Secondary Side Bar*.
3. VS Code zapamiętuje to położenie (dla profilu/przestrzeni roboczej) — nie trzeba powtarzać tego po restarcie.

Aby przywrócić domyślne położenie: prawy przycisk na widoku → **Reset Location** albo polecenie **View: Reset View Locations**.
