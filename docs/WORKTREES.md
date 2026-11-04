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

## Ustawienia

| Ustawienie | Domyślnie | Opis |
|---|---|---|
| `zedLayout.worktrees.directory` | `""` | Katalog na worktree. Pusty: `../<repo>.worktrees`. Ścieżki względne liczone od katalogu głównego repozytorium. |
| `zedLayout.worktrees.branchPrefix` | `"agent/"` | Prefiks gałęzi tworzonych dla agentów. |

## Ograniczenia

- Worktree współdzieli z głównym repozytorium obiekty i referencje: ta sama gałąź nie może być
  jednocześnie wybrana w dwóch worktree (dlatego każda sesja dostaje nową gałąź).
- Zależności (np. `node_modules`) nie są kopiowane — agent musi je zainstalować w worktree.
- Lista sesji nie przetrwa przeładowania okna; worktree i gałęzie pozostają na dysku i można je
  usunąć ręcznie (`git worktree list`, `git worktree remove`).
