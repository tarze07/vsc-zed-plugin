# Widok „Agents”

Widok `Agents` (`zedLayout.agentsView`, issue #7, plan: sekcja 3.3 w [PLAN.md](PLAN.md)) pokazuje listę sesji agentów uruchomionych przez rozszerzenie.

## Co pokazuje widok

Płaska lista sesji w kolejności utworzenia. Każdy element to jedna sesja (jeden terminal):

- **etykieta** — nazwa sesji (ta sama co nazwa terminala),
- **opis** — agent · status · gałąź (gałąź tylko dla sesji w worktree), np. `Claude Code · waiting · agent/claude-1a2b`,
- **podpowiedź** (tooltip) — agent, polecenie z argumentami, katalog roboczy, ścieżka/gałąź/baza worktree, status, informacja „Needs attention” i czas startu.

Lista odświeża się automatycznie przy każdej zmianie sesji (dodanie, usunięcie, zmiana nazwy, zmiana statusu). W nagłówku widoku wyświetlana jest liczba sesji (np. „3 sessions”).

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

**Synchronizacja zaznaczenia:** gdy aktywnym terminalem staje się terminal sesji agenta, a widok jest widoczny, odpowiedni element zostaje zaznaczony (bez przenoszenia fokusu).

## Badge

Ikona kontenera *Agents* pokazuje badge z liczbą sesji wymagających uwagi (`needsAttention` — agent czeka na input albo zakończył się nieoczekiwanie, a sesja nie była jeszcze otwarta). Badge znika, gdy żadna sesja nie wymaga uwagi.

## Przeniesienie do Secondary Side Bar

Kontener *Agents* jest zarejestrowany w Activity Bar (lewy Side Bar), bo minimalna wspierana wersja VS Code (1.95) nie pozwala rozszerzeniom na deklarowanie kontenerów bezpośrednio w Secondary Side Bar. Aby mieć widok po prawej stronie, jak panel agentów w Zedzie:

1. Otwórz Secondary Side Bar: **View → Appearance → Secondary Side Bar** (`Ctrl+Alt+B` / `⌥⌘B`) — preset *Apply Zed Layout* robi to automatycznie.
2. Przeciągnij ikonę *Agents* z Activity Bar (albo nagłówek widoku *Agents*) na obszar Secondary Side Bar.
   - Alternatywa bez myszy: kliknij prawym przyciskiem ikonę *Agents* w Activity Bar → **Move To → Secondary Side Bar**, albo uruchom z palety **View: Move View** (`workbench.action.moveView`), wybierz *Agents*, a potem *Secondary Side Bar*.
3. VS Code zapamiętuje to położenie (dla profilu/przestrzeni roboczej) — nie trzeba powtarzać tego po restarcie.

Aby przywrócić domyślne położenie: prawy przycisk na widoku → **Reset Location** albo polecenie **View: Reset View Locations**.
