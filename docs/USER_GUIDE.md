# Przewodnik użytkownika — wielu agentów równolegle

Ten przewodnik prowadzi przez typowy dzień pracy z rozszerzeniem: od ustawienia układu, przez
uruchomienie kilku agentów naraz (każdy na własnej gałęzi w `git worktree`), po przegląd i
scalenie ich zmian. Szczegóły poszczególnych funkcji są w dokumentach podlinkowanych w każdej
sekcji; odpowiedzi na typowe problemy — w [FAQ.md](FAQ.md).

Ten sam scenariusz w skrócie pokazuje walkthrough _Get started with Zed-like Agent Workspace_
(**Help → Welcome** albo **Welcome: Open Walkthrough...**).

## 1. Przygotowanie

1. Zainstaluj rozszerzenie z pliku `.vsix` (**Extensions: Install from VSIX...**).
2. Zainstaluj CLI agentów, których chcesz używać, i sprawdź je w zwykłym terminalu, np.
   `claude --version`, `codex --version`. Domyślne polecenia: `claude` (Claude Code), `codex`
   (Codex), `agy` (Agy), `kilocode` (Kilo Code) — instrukcje instalacji znajdziesz w dokumentacji
   każdego z narzędzi.
3. Upewnij się, że `git` jest w `PATH`, a projekt jest repozytorium z co najmniej jednym commitem
   (worktree tworzy się z istniejącego commita).

## 2. Układ w stylu Zeda

**Zed Layout: Apply Zed Layout** → wybierz zakres (_User_ — wszędzie, _Workspace_ — tylko ten
projekt) → przejrzyj listę zmian i potwierdź. Efekt:

```
┌───────────────────────────────────────────────────────────────┐
│ ▣ ▣ ▣ ▣   (Activity Bar u góry)                                │
├─────────────┬───────────────────────────────┬─────────────────┤
│ Eksplorator │ kod │ ✦ Claude Code │ Codex   │ Agents          │
│ (projekt)   │                               │ (Secondary      │
│             │   edytor + karty agentów      │  Side Bar)      │
├─────────────┴───────────────────────────────┴─────────────────┤
│ terminal (zwinięty)                                           │
└───────────────────────────────────────────────────────────────┘
```

Kontener _Agents_ jest początkowo w Activity Bar. Aby mieć go po prawej stronie jak w Zedzie,
przeciągnij jego ikonę do Secondary Side Bar (albo prawy przycisk → **Move To → Secondary Side
Bar**) — VS Code zapamięta to położenie ([VIEWS.md](VIEWS.md)).

Wszystko można cofnąć poleceniem **Zed Layout: Restore Previous Layout** ([LAYOUT.md](LAYOUT.md)).
Jeśli wolisz nie ruszać obecnych ustawień, zaimportuj preset jako osobny profil
([PROFILE.md](PROFILE.md)).

## 3. Agenci równolegle — każdy w swoim worktree

Gdy kilku agentów pracuje w jednym katalogu, nadpisują sobie pliki i trudno rozdzielić, kto co
zmienił. Dlatego do pracy równoległej używaj **New Agent Session in Worktree**:

1. Paleta → **Zed Layout: New Agent Session in Worktree** (albo przycisk `⑂` na pasku widoku
   _Agents_).
2. Wybierz agenta, np. _Claude Code_.
3. Wybierz bazę — zwykle _Current branch (main)_.
4. Rozszerzenie tworzy gałąź `agent/claude-1a2b3c`, katalog `../<repo>.worktrees/agent-claude-1a2b3c`
   i uruchamia w nim agenta w nowej karcie terminala `Claude Code · claude-1a2b3c`.
5. Opisz agentowi zadanie w jego terminalu.
6. Powtórz dla kolejnych zadań, np. Codex z innym zadaniem — dostanie własną gałąź i katalog.

Wskazówki:

- Jedno zadanie = jedna sesja = jedna gałąź. Małe, niezależne zadania łatwiej potem scalić.
- Zależności (`node_modules`, `.venv`) nie są kopiowane do worktree — poproś agenta o instalację
  albo zrób to sam w jego terminalu.
- Gdzie trafiają worktree i jak nazywają się gałęzie — `zedLayout.worktrees.directory` i
  `zedLayout.worktrees.branchPrefix` ([WORKTREES.md](WORKTREES.md)).
- Szybka sesja bez worktree (**New Agent Session**) przydaje się do pytań o kod lub drobnych
  poprawek w bieżącym katalogu — ale wtedy nie uruchamiaj równolegle drugiego agenta w tym samym
  katalogu.
- Własny skrót dla ulubionego agenta:
  `{ "key": "ctrl+alt+c", "command": "zedLayout.worktrees.newSession", "args": "claude" }`.

## 4. Śledzenie statusów

Widok _Agents_ pokazuje każdą sesję ze statusem ([STATUS.md](STATUS.md)):

| Status     | Co oznacza                                                     | Co zrobić                     |
| ---------- | -------------------------------------------------------------- | ----------------------------- |
| _starting_ | terminal utworzony, agent się uruchamia                        | poczekać                      |
| _running_  | agent pracuje (wypisuje dane)                                  | zająć się czymś innym         |
| _waiting_  | od kilku sekund brak wyjścia — agent prawdopodobnie czeka      | sprawdzić, odpowiedzieć       |
| _exited_   | agent zakończył działanie (kod ≠ 0 — ikona błędu)              | przejrzeć zmiany              |

- Badge na ikonie _Agents_ to liczba sesji wymagających uwagi; dla sesji w tle pojawia się też
  powiadomienie z przyciskiem **Show** (`zedLayout.status.notifyOnAttention`).
- Przełączanie między sesjami: kliknięcie w widoku albo **Next / Previous Agent Session**
  (z włączonym `zedLayout.keymap.enabled` także skróty — [KEYMAP.md](KEYMAP.md)).
- _waiting_ to heurystyka „brak wyjścia przez N sekund”. Jeśli agent długo „myśli” w ciszy i
  zbyt często dostaje _waiting_, zwiększ `zedLayout.status.waitingAfterSeconds`.

## 5. Przegląd zmian

Gdy agent skończy (status _exited_ albo _waiting_ po wykonaniu zadania):

1. **Review Agent Changes** z menu sesji w widoku _Agents_ (albo z palety) — widok
   _Agent Changes_ pokazuje pliki zmienione przez sesję względem punktu odgałęzienia od bazy, a
   wszystkie zmiany otwierają się w jednym multi-diffie ([REVIEW.md](REVIEW.md)).
2. Prawa strona diffu to plik w worktree — drobne poprawki możesz wpisać od razu w diffie.
3. Per plik: **Accept** (stage — „przejrzane”) albo **Reject** (powrót do wersji bazowej;
   nieodwracalne, z potwierdzeniem). Działa też na zaznaczeniu wielu plików.
4. Gdy wszystko jest w porządku: **Accept All Changes → Commit…** — commit na gałęzi agenta
   (`zedLayout.review.acceptAllAction` pozwala pominąć pytanie stage/commit).

Możesz też zlecić agentowi poprawki — wystarczy wrócić do jego terminala; widok odświeży się sam.

## 6. Scalenie i sprzątanie

1. W głównym repozytorium miej wybraną gałąź bazową (np. `main`) i czysty katalog roboczy.
2. Menu sesji w _Agent Changes_ → **Merge Agent Branch into Base** (`git merge --no-ff`).
   Przy konfliktach merge jest przerywany — rozwiąż je ręcznie (np. `git merge agent/claude-1a2b3c`
   w terminalu i edytor konfliktów VS Code) albo poproś agenta o rebase na bazę.
3. Menu sesji w _Agents_ → **Remove Worktree** — rozszerzenie ostrzeże o niezacommitowanych
   zmianach i commitach spoza bazy, zatrzyma sesje w tym worktree i zapyta, czy usunąć gałąź.

Kolejność dla kilku agentów: scalaj po jednym, a po każdym scaleniu sprawdź, czy pozostałe
gałęzie nie wymagają aktualizacji (konflikty wychodzą wtedy wcześnie i są mniejsze).

## 7. Dobre praktyki

- **Rozdzielaj obszary kodu** między agentów (np. backend / frontend / testy) — mniej konfliktów.
- **Commituj często** w worktree (albo proś o to agenta) — _Compare Worktree with Base_ i review
  pokazują zarówno commity, jak i zmiany niezacommitowane.
- **Nie przeładowuj okna** w trakcie pracy agentów — lista sesji nie przetrwa przeładowania
  (worktree i gałęzie zostają na dysku, patrz [FAQ.md](FAQ.md#po-przeładowaniu-okna-zostały-worktree-i-gałęzie-agentów)).
- **Pełny podgląd gałęzi:** _Open Worktree in New Window_ otwiera worktree w osobnym oknie z
  widokiem Source Control dla tej gałęzi.
- **Własni agenci:** dowolne CLI (także skrypt) dodasz do `zedLayout.agents` — np. ten sam agent
  z innym modelem przez `args` ([AGENTS.md](AGENTS.md)).
