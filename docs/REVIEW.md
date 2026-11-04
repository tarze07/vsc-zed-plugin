# Przegląd zmian agentów („Agent Changes”)

Funkcja z issue #10 (plan: sekcja 3.5 w [PLAN.md](PLAN.md)). Widok **Agent Changes** w kontenerze
*Agents* pokazuje pliki zmienione przez każdą sesję agenta względem bazy i pozwala je
przejrzeć w jednym edytorze wielodiffowym oraz zaakceptować lub odrzucić — per plik i zbiorczo.

Wymagany jest `git` w `PATH`.

## Co pokazuje widok

- **Węzeł sesji** — po jednym dla każdej sesji agenta, której katalog roboczy (`cwd`, worktree albo
  pierwszy folder workspace) leży w repozytorium git. Sesje poza repozytorium są pomijane.
  - etykieta: nazwa sesji, ikona i kolor agenta,
  - opis: `<n> files · vs <baza>` albo `no changes` (wtedy węzeł nie ma dzieci),
  - podpowiedź: gałąź (dla worktree), baza, katalog repozytorium.
- **Węzeł pliku** — nazwa pliku, w opisie katalog i dla zmiany nazwy `← stara/ścieżka`. Ikona wg
  rodzaju zmiany: dodany/nieśledzony `diff-added`, zmieniony `diff-modified`, usunięty
  `diff-removed`, przeniesiony/skopiowany `diff-renamed`, konflikt `warning` (kolory
  `gitDecoration.*ResourceForeground`). Kliknięcie otwiera diff pliku.
- **Opis widoku** — łączna liczba zmienionych plików we wszystkich sesjach.

Widok odświeża się sam: po zmianie listy sesji, po każdej akcji accept/reject/merge oraz
(z opóźnieniem ~1,5 s) po zmianach plików w katalogach sesji (watcher; zmiany w `.git/` są
ignorowane). Ręcznie: przycisk **Refresh** na pasku widoku. Zmiana samego statusu sesji nie
uruchamia ponownie gita.

## Baza porównania

| Sesja | Baza (`baseCommit`) | Co jest widoczne |
|---|---|---|
| w worktree (#9) | `merge-base` gałęzi bazowej (`worktree.baseRef`) i `HEAD` worktree | wszystko, co agent zrobił na swojej gałęzi: commity + niezacommitowane + nieśledzone pliki |
| bez worktree | `HEAD` repozytorium | tylko niezacommitowane zmiany (w tym nieśledzone pliki) |

Lewa strona diffu to zawartość pliku w `baseCommit` (dla zmiany nazwy — spod starej ścieżki),
serwowana przez dostawcę dokumentów `zedlayout-review:` (tylko do odczytu). Prawa strona to plik
w katalogu roboczym sesji — można go edytować bezpośrednio w diffie.

## Akcje

| Akcja | Id | Gdzie | Działanie |
|---|---|---|---|
| **Review Agent Changes** | `zedLayout.review.open` | paleta, menu sesji w widoku *Agents* | pokazuje sesję w widoku *Agent Changes* i otwiera wszystkie zmiany |
| **Open All Changes** | `zedLayout.review.openAll` | węzeł sesji (inline + menu) | edytor wielodiffowy |
| **Open Change** | `zedLayout.review.openFile` | kliknięcie / menu pliku | diff pliku |
| **Accept Change** | `zedLayout.review.accept` | plik (inline + menu) | `git add` wybranych plików (stage) |
| **Reject Change** | `zedLayout.review.reject` | plik (inline + menu) | przywrócenie pliku do bazy (po potwierdzeniu) |
| **Accept All Changes** | `zedLayout.review.acceptAll` | węzeł sesji | stage albo commit wszystkiego |
| **Reject All Changes** | `zedLayout.review.rejectAll` | węzeł sesji | przywrócenie wszystkich plików (po potwierdzeniu) |
| **Merge Agent Branch into Base** | `zedLayout.review.mergeIntoBase` | menu sesji z worktree | `git merge --no-ff` gałęzi agenta do bazy |

Polecenia przyjmują węzeł widoku, obiekt sesji, `{ session }` albo id sesji. Wywołane bez
argumentu (z palety) używają zaznaczenia w widoku, a gdy go nie ma — QuickPick z sesjami.
Widok obsługuje **zaznaczanie wielu plików** (Ctrl/Cmd/Shift+klik): *Accept*/*Reject* działają
wtedy na całym zaznaczeniu (również z różnych sesji).

- **Accept** = stage (`git add -A -- <ścieżki>`; usunięcia i obie strony zmiany nazwy są
  obsługiwane). Plik nadal jest widoczny w widoku, bo wciąż różni się od bazy — staging oznacza
  „przejrzane”, nie znika ze zmian.
- **Reject** = powrót do stanu z `baseCommit` w katalogu roboczym i indeksie: zmienione/usunięte
  pliki są przywracane, dodane/nieśledzone — usuwane, przy zmianie nazwy przywracany jest
  oryginał, a nowa ścieżka usuwana. Wymaga potwierdzenia (okno modalne) i **nie da się cofnąć**.
  W worktree nie przepisuje commitów już zrobionych na gałęzi agenta — cofa tylko stan plików.
- **Accept All** — zależnie od ustawienia `zedLayout.review.acceptAllAction`:
  - `ask` (domyślnie) — QuickPick *Stage* / *Commit…*,
  - `stage` — `git add` wszystkich zmienionych plików,
  - `commit` — pole na komunikat (domyślnie `Accept changes from <nazwa sesji>`), potem
    stage wszystkiego i `git commit` w katalogu sesji (w worktree — na gałęzi agenta; bez
    worktree — na bieżącej gałęzi repozytorium).
- **Reject All** — okno modalne z liczbą plików, potem *Reject* dla wszystkich.
- **Merge into Base** (tylko sesje w worktree) — po potwierdzeniu uruchamia
  `git merge --no-ff <gałąź agenta>` w głównym repozytorium. Warunki:
  - worktree nie ma niezacommitowanych zmian (najpierw *Accept All → Commit*),
  - w głównym repozytorium jest checkoutowana gałąź bazowa (`worktree.baseRef`), a jego katalog
    roboczy jest czysty.

  Gdy warunek nie jest spełniony albo wystąpią konflikty (merge jest wtedy przerywany przez
  `git merge --abort`), pokazywane jest ostrzeżenie z powodem; po udanym merge'u — informacja.

Błędy gita są pokazywane z treścią `stderr`.

## Multi-diff

**Open All Changes** otwiera jeden edytor `vscode.changes` z tytułem `<sesja> ↔ <baza>` i
wszystkimi plikami — najbliższy odpowiednik multibuffera Zeda. Pliki dodane mają pustą lewą
stronę, usunięte — pustą prawą. Jeśli wersja VS Code nie udostępnia `vscode.changes`, pokazywany
jest QuickPick z plikami, a wybrany otwiera się w zwykłym diffie.

Pojedynczy plik (**Open Change**): diff `baza ↔ katalog roboczy`; plik dodany otwiera się
bezpośrednio, usunięty — jako dokument tylko do odczytu z wersją bazową.
