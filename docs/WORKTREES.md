# Sesje agentów w git worktree

Funkcja z issue #9 (plan: sekcja 3.4 w [PLAN.md](PLAN.md)). Każda sesja agenta może dostać własny
[`git worktree`](https://git-scm.com/docs/git-worktree) na osobnej gałęzi, dzięki czemu kilku
agentów pracuje równolegle nad tym samym repozytorium, nie nadpisując sobie plików w jednym
katalogu roboczym.

Wymagany jest `git` w `PATH` (rozszerzenie wywołuje CLI bezpośrednio, bez powłoki).

## Polecenia

| Polecenie | Id | Gdzie |
|---|---|---|
| **New Agent Session in Worktree** | `zedLayout.worktrees.newSession` | paleta poleceń, pasek widoku *Agents*, ekran powitalny widoku |
| **Open Worktree in New Window** | `zedLayout.worktrees.openInNewWindow` | menu kontekstowe sesji z worktree |
| **Compare Worktree with Base** | `zedLayout.worktrees.compareWithBase` | menu kontekstowe sesji z worktree |
| **Remove Worktree** | `zedLayout.worktrees.remove` | menu kontekstowe sesji z worktree |

Polecenia z menu kontekstowego dostają sesję jako argument (obiekt sesji, `{ session }` albo id
sesji). Wywołane bez argumentu pokazują QuickPick z sesjami, które mają worktree.
`newSession` przyjmuje opcjonalnie id agenta (np. `"claude"`) — wtedy pomija wybór agenta.

## Jak to działa — nowa sesja

1. **Repozytorium** — otwarty folder musi należeć do repozytorium git
   (`git rev-parse --show-toplevel`). Przy kilku folderach (multi-root) pojawia się QuickPick;
   foldery z tego samego repozytorium są pokazywane raz.
2. **Agent** — QuickPick z `zedLayout.agents` (pomijany, gdy id agenta podano jako argument).
3. **Baza** — QuickPick: *Current branch (X)* (bieżąca gałąź, a przy odłączonym `HEAD` — sha
   commita) albo *Enter ref…* (dowolna gałąź, tag lub commit; walidowane przez
   `git rev-parse --verify`).
4. **Worktree** — z powiadomieniem o postępie:
   `git worktree add -b <gałąź> -- <katalog> <baza>`.
   Gdy gałąź lub katalog już istnieją, losowany jest nowy krótki id (do 5 prób).
5. **Sesja** — terminal agenta startuje z `cwd` w nowym worktree; nazwa sesji to
   `<etykieta agenta> · <gałąź bez prefiksu>`, np. `Claude Code · claude-1a2b3c`.
   Jeśli sesji nie udało się uruchomić (lub ją anulowano), rozszerzenie proponuje usunięcie
   świeżo utworzonego worktree.

Błędy gita (np. repozytorium bez commitów, nieznany ref) są pokazywane z treścią `stderr`.

## Układ katalogów

Domyślnie (`zedLayout.worktrees.directory` = `""`) worktree trafiają **obok** repozytorium, do
katalogu `<repo>.worktrees`:

```
~/src/
├── app/                         ← główne repozytorium (gałąź main)
└── app.worktrees/
    ├── agent-claude-1a2b3c/     ← gałąź agent/claude-1a2b3c
    └── agent-codex-9f8e7d/      ← gałąź agent/codex-9f8e7d
```

Nazwa katalogu to nazwa gałęzi ze znakami `/` zamienionymi na `-`. Trzymanie worktree poza
repozytorium sprawia, że nie widać ich w drzewie plików, wyszukiwaniu ani w `git status`
głównego katalogu.

Wartość ustawienia:

- pusta — `../<nazwa-repo>.worktrees` (obok katalogu głównego repozytorium),
- ścieżka względna — względem katalogu głównego repozytorium (np. `.worktrees` → wewnątrz repo;
  wtedy warto dodać ten katalog do `.gitignore`),
- ścieżka bezwzględna — używana bez zmian,
- `~/…` — względem katalogu domowego.

## Nazwy gałęzi

`<prefiks><id-agenta>-<krótki-id>`, np. `agent/claude-1a2b3c`, gdzie krótki id to 6 losowych
znaków szesnastkowych. Prefiks ustawia `zedLayout.worktrees.branchPrefix` (domyślnie `agent/`).

Nazwa jest oczyszczana zgodnie z regułami `git check-ref-format`: spacje, znaki sterujące oraz
`~ ^ : ? * [ \` i `@{` zamieniane są na `-`, `..` na `.`, usuwane są puste człony (`//`), człony
zaczynające się od `.`, końcówki `.lock` oraz końcowe `/` i `.`.

## Porównanie i przegląd (Compare with Base)

*Compare Worktree with Base* zbiera wszystkie zmiany gałęzi agenta względem bazy:

- zmiany zacommitowane i niezacommitowane plików śledzonych —
  `git diff --name-status <merge-base>` (od punktu rozgałęzienia z bazą do stanu katalogu
  roboczego; to samo co `<baza>...HEAD` plus zmiany lokalne),
- nowe, nieśledzone pliki — `git ls-files --others --exclude-standard`.

Zmiany otwierają się w jednym edytorze wielu różnic (`vscode.changes`), w którym lewa strona to
wersja z bazy (URI `git:` z wbudowanego rozszerzenia Git — `toGitUri`), a prawa — plik w worktree.
Gdy wbudowane rozszerzenie Git jest wyłączone, wersja bazowa jest czytana przez `git show`;
gdy edytor wielu różnic jest niedostępny, pojawia się QuickPick z listą plików i zwykły
`vscode.diff` dla wybranego pliku. Bez zmian — komunikat informacyjny.

Scalanie (merge / cherry-pick) wykonuje się zwykłymi narzędziami Git — gałąź agenta jest
normalną lokalną gałęzią, widoczną również w głównym repozytorium. *Open Worktree in New Window*
otwiera katalog worktree w nowym oknie VS Code (pełny widok Source Control dla tej gałęzi).

## Bezpieczne usuwanie (Remove Worktree)

1. Modalne potwierdzenie (ścieżka, liczba działających sesji, które zostaną zatrzymane).
2. Sprawdzenie stanu:
   - niezacommitowane zmiany — `git status --porcelain --untracked-files=all`,
   - commity, których nie ma w bazie — `git rev-list --count <baza>..HEAD`.

   Jeśli cokolwiek zostanie znalezione (lub sprawdzenie się nie powiedzie), pojawia się drugie,
   wyraźne ostrzeżenie z liczbami; kontynuacja wymaga przycisku **Remove Anyway** i używa
   `git worktree remove --force`.
3. Pytanie, czy usunąć również gałąź (domyślnie **nie** — *Keep Branch*; zamknięcie okna też
   zachowuje gałąź). Usunięcie to `git branch -D`, więc commity spoza bazy przepadają —
   ostrzeżenie mówi o tym wprost.
4. Zatrzymanie wszystkich sesji agentów działających w tym worktree.
5. `git worktree remove [--force] <katalog>`; jeśli katalog usunięto wcześniej ręcznie —
   `git worktree prune`. Na koniec komunikat z wynikiem.

## Osierocone worktree (#16)

Worktree utworzone przez *New Agent Session in Worktree* zostają na dysku razem z gałęzią
`agent/*`, także gdy sesja agenta zniknie (zamknięty terminal, przeładowanie okna, którego
terminal nie został przywrócony itp.). Rozszerzenie wykrywa takie worktree i pokazuje je w
widoku *Agents*, żeby można je było wznowić, przejrzeć albo usunąć.

### Wykrywanie

Dla każdego folderu przestrzeni roboczej należącego do repozytorium git (repozytoria
deduplikowane po głównym worktree — także gdy otwarty folder sam jest worktree) wykonywane jest
`git worktree list --porcelain`. Worktree jest **osierocony**, gdy:

- nie jest głównym worktree ani repozytorium `bare`,
- jego gałąź zaczyna się od `zedLayout.worktrees.branchPrefix` **albo** katalog leży wewnątrz
  katalogu z `zedLayout.worktrees.directory` (dzięki temu łapane są też worktree z odłączonym
  `HEAD` lub po zmianie prefiksu),
- nie używa go żadna działająca sesja, żadna zapamiętana (odłączona) sesja z poprzedniego okna i
  nie jest otwarty jako folder w bieżącym oknie.

Ścieżki są porównywane po normalizacji (separatory, końcowy `/`); na Windows i macOS bez
rozróżniania wielkości liter. Worktree, których katalog usunięto ręcznie (git oznacza je jako
`prunable`), są pokazywane jako kandydaci do `git worktree prune`; zablokowane (`git worktree
lock`) — z oznaczeniem.

Lista odświeża się: chwilę po starcie (żeby przywrócone terminale zdążyły zostać ponownie
podłączone do sesji), po każdej zmianie listy sesji i historii sesji, po zmianie folderów
przestrzeni roboczej lub ustawień `zedLayout.worktrees.*`, po własnych akcjach oraz poleceniem
**Refresh Orphaned Worktrees** (`zedLayout.worktrees.refreshOrphans`, pasek widoku *Agents*).
Zdarzenia są grupowane (debounce), a widok dostaje powiadomienie tylko, gdy lista faktycznie się
zmieniła. `zedLayout.worktrees.showOrphaned: false` ukrywa sekcję (lista jest pusta), ale
polecenie *Clean Up Agent Worktrees…* nadal działa.

### Akcje

| Akcja | Id | Działanie |
|---|---|---|
| **Start Agent Session in Worktree** | `zedLayout.worktrees.orphan.startSession` | wybór agenta, nowa sesja z `cwd` w worktree (nazwa `<agent> · <gałąź bez prefiksu>`) |
| **Open Worktree in New Window** | `zedLayout.worktrees.orphan.openInNewWindow` | jak dla sesji |
| **Review Worktree Changes** | `zedLayout.worktrees.orphan.review` | edytor wielu różnic względem bazy — ta sama logika co *Compare with Base* |
| **Remove Worktree** | `zedLayout.worktrees.orphan.remove` | te same zabezpieczenia co *Remove Worktree* sesji; dla `prunable` — tylko `git worktree prune`; zablokowany — `git worktree remove --force --force` po potwierdzeniu |

Polecenia przyjmują obiekt `OrphanedWorktree`, `{ orphan }` albo ścieżkę worktree; bez
argumentu pokazują QuickPick z osieroconymi worktree.

### Baza gałęzi agenta

Przy tworzeniu worktree rozszerzenie zapisuje ref bazowy w konfiguracji repozytorium:

```sh
git config branch.<gałąź>.zedLayoutBase <baza>
```

(najlepszym wysiłkiem — błąd zapisu nie przerywa tworzenia sesji). `git branch -D <gałąź>`
usuwa całą sekcję `branch.<gałąź>`, więc wpis znika razem z gałęzią; przy zachowaniu gałęzi
wpis zostaje i kolejne wznowienie zna bazę.

Dla osieroconych worktree baza to zapisany ref, o ile nadal wskazuje na commit; w przeciwnym
razie (worktree sprzed tej wersji, utworzone ręcznie, baza usunięta) — domyślna gałąź
repozytorium:

1. `git symbolic-ref --short refs/remotes/origin/HEAD` (np. `origin/main` → `main`, jeśli
   lokalna gałąź istnieje; inaczej `origin/main`),
2. `main`,
3. `master`,
4. bieżąca gałąź głównego repozytorium.

### Clean Up Agent Worktrees…

`zedLayout.worktrees.cleanUp` (paleta poleceń i menu `…` widoku *Agents*):

1. Skanuje repozytoria i równolegle (z paskiem postępu) liczy dla każdego worktree zmiany
   niezacommitowane i commity spoza bazy.
2. QuickPick z wielokrotnym wyborem: gałąź, ścieżka i podsumowanie, np.
   `3 uncommitted, 2 commits not in main`, `directory missing — will be pruned`, `locked`.
   Wstępnie zaznaczone są tylko worktree „czyste”.
3. Jedno modalne potwierdzenie z listą: **Remove Worktrees** (gałęzie zostają) albo
   **Remove Worktrees and Branches** (`git branch -D`).
4. Jeśli wśród wybranych są worktree z niezacommitowanymi zmianami, zablokowane, takie, których
   stanu nie udało się sprawdzić, albo — przy usuwaniu gałęzi — z commitami spoza bazy, pojawia
   się drugie, wyraźne ostrzeżenie z ich listą: **Remove Anyway** (`--force`) lub
   **Skip These** (usuwa tylko pozostałe).
5. Usuwanie po kolei; wpisy `prunable` — `git worktree prune`. Na koniec komunikat z
   podsumowaniem (usunięte worktree, wyczyszczone wpisy, usunięte gałęzie, ewentualne błędy).

## Ustawienia

| Ustawienie | Domyślnie | Opis |
|---|---|---|
| `zedLayout.worktrees.directory` | `""` | Katalog na worktree. Pusty: `../<repo>.worktrees`. Ścieżki względne liczone od katalogu głównego repozytorium. Worktree w tym katalogu są traktowane jako worktree agentów. |
| `zedLayout.worktrees.branchPrefix` | `"agent/"` | Prefiks gałęzi tworzonych dla agentów (i rozpoznawania osieroconych worktree). |
| `zedLayout.worktrees.showOrphaned` | `true` | Pokazuje w widoku *Agents* worktree agentów bez sesji. |

## Ograniczenia

- Worktree współdzieli z głównym repozytorium obiekty i referencje: ta sama gałąź nie może być
  jednocześnie wybrana w dwóch worktree (dlatego każda sesja dostaje nową gałąź).
- Zależności (np. `node_modules`) nie są kopiowane — agent musi je zainstalować w worktree.
- Worktree i gałęzie pozostają na dysku po zakończeniu sesji; worktree bez sesji widać jako
  osierocone (sekcja wyżej) i można je wznowić lub usunąć z poziomu widoku *Agents*.
