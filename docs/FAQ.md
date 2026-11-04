# FAQ — najczęstsze pytania i problemy

## Agent się nie uruchamia: „command … was not found on PATH”

Rozszerzenie przed utworzeniem terminala sprawdza, czy polecenie agenta (`command` w
`zedLayout.agents`) istnieje. `PATH` jest sprawdzany **w środowisku procesu VS Code**, a nie w
profilu Twojej powłoki.

1. Sprawdź w zwykłym terminalu, gdzie jest CLI: `which claude` (macOS/Linux) albo
   `Get-Command claude` (PowerShell).
2. Najprościej: wpisz pełną ścieżkę z wyniku w polu `command` danego agenta
   (**Preferences: Open Settings (UI)** → `zedLayout.agents` → _Edit in settings.json_).
3. Jeśli CLI jest instalowane przez menedżera wersji (nvm, asdf, volta, pipx, npm z prefiksem w
   `~/.npm-global`), a VS Code uruchamiasz z Docka lub menu, ten katalog może nie być w `PATH`.
   Uruchom VS Code z terminala (`code .`) albo dopisz katalog do `PATH` w profilu logowania
   (`~/.profile`, `~/.zprofile`) i uruchom VS Code ponownie (całą aplikację, nie tylko okno).
4. Zdalnie (SSH, WSL, Dev Containers) rozszerzenie działa po stronie zdalnej — CLI agenta musi
   być zainstalowane tam, a nie na komputerze lokalnym.
5. Agent, którego nie używasz, nie przeszkadza — zgłasza błąd dopiero przy próbie uruchomienia.
   Możesz go usunąć z listy, kopiując domyślne wpisy do `settings.json` bez niego.

Więcej: [AGENTS.md](AGENTS.md#rozwiązywanie-problemów-command--was-not-found-on-path).

## Status sesji jest zawsze „running” (nigdy „waiting”), brak kodu wyjścia

Wykrywanie statusu korzysta z **Shell Integration** terminala VS Code. Jeśli w ciągu ~5 s od
startu sesji nie pojawi się żadne zdarzenie wykonania polecenia, sesja przechodzi w tryb
awaryjny: status _running_ aż do zamknięcia terminala, bez _waiting_ i bez kodu wyjścia.

Sprawdź:

- `terminal.integrated.shellIntegration.enabled` ma wartość `true`,
- domyślna powłoka to bash, zsh, fish lub pwsh (cmd.exe i nietypowe powłoki nie są wspierane),
- w terminalu przy prompcie widać znaczniki poleceń (kółka przy liniach) — to znak, że Shell
  Integration działa; motywy promptu (np. powerlevel10k, starship) czasem ją psują — patrz
  dokumentacja VS Code _Terminal Shell Integration_ (ręczna instalacja skryptu w `.zshrc`/`.bashrc`),
- w środowiskach zdalnych Shell Integration też musi działać po stronie zdalnej.

Jeśli agent wypisuje animację (spinner), może nigdy nie przejść w _waiting_; jeśli długo myśli w
ciszy — przejdzie w _waiting_ za wcześnie. Dostosuj `zedLayout.status.waitingAfterSeconds`.
Szczegóły: [STATUS.md](STATUS.md).

## Jak przenieść widok „Agents” do Secondary Side Bar (na prawo)?

VS Code 1.95 nie pozwala rozszerzeniom umieszczać kontenera bezpośrednio w Secondary Side Bar,
więc _Agents_ startuje w Activity Bar. Przeciągnij ikonę _Agents_ do Secondary Side Bar albo
kliknij ją prawym przyciskiem → **Move To → Secondary Side Bar** (bez myszy: **View: Move
View**). VS Code zapamięta położenie. Powrót: **View: Reset View Locations**. Szczegóły:
[VIEWS.md](VIEWS.md#przeniesienie-do-secondary-side-bar).

## Jak przywrócić poprzedni układ?

**Zed Layout: Restore Previous Layout** przywraca wartości sprzed **pierwszego** _Apply_ (także
usuwa klucze, które wcześniej nie były ustawione). Gdy kopie istnieją dla _User_ i _Workspace_,
pojawi się wybór. Ręcznie zmienione później ustawienia spoza presetu nie są dotykane.

Jeśli kopii nie ma (np. ustawienia zmieniono ręcznie albo przez profil), usuń odpowiednie klucze
z `settings.json` — lista kluczy jest w [LAYOUT.md](LAYOUT.md#zmieniane-ustawienia). Zmiana
`window.titleBarStyle` może wymagać ponownego uruchomienia VS Code.

## Import profilu: motyw nie działa / rozszerzenie nie zainstalowało się

Rozszerzenie nie jest jeszcze w Marketplace, więc import profilu nie zainstaluje go
automatycznie, a bez niego motyw _Zed-like Dark_ nie istnieje. Najpierw zainstaluj `.vsix`, potem
importuj profil (**Profiles: Import Profile...**) i upewnij się, że rozszerzenie jest **włączone w
nowym profilu** (profile mają osobne listy rozszerzeń; w razie potrzeby zainstaluj VSIX ponownie,
będąc już w profilu). Szczegóły: [PROFILE.md](PROFILE.md).

## Windows: argumenty agenta i PowerShell

- Argumenty w `args` podawaj jako osobne elementy tablicy, **bez własnych cudzysłowów** —
  rozszerzenie cytuje je samo zgodnie z powłoką: PowerShell (`'…'`, apostrof podwajany), cmd.exe
  (`"…"`). Przykład: `"args": ["--model", "opus"]`, a nie `"args": ["--model \"opus\""]`.
- Polecenie ze spacjami w ścieżce (np. `C:\Program Files\…\agent.exe`) jest w PowerShellu
  poprzedzane `&` automatycznie — wpisz samą ścieżkę w `command`.
- Nazwy bez rozszerzenia są szukane z rozszerzeniami z `PATHEXT` — globalne pakiety npm instalują
  pliki `.cmd` i to jest obsługiwane.
- Jeśli PowerShell blokuje skrypty `.ps1` (Execution Policy), wskaż w `command` plik `.cmd` albo
  `.exe` zamiast `.ps1`.
- Do pełnego wykrywania statusu używaj powłoki z Shell Integration — PowerShell 7 (`pwsh`) albo
  Git Bash; cmd.exe daje tryb awaryjny (tylko _running_, bez _waiting_ i kodu wyjścia).
- Wiele CLI agentów działa najlepiej w WSL — wtedy otwórz projekt przez **WSL: Connect to WSL**
  i zainstaluj CLI w WSL.

## Co dzieje się z sesjami po przeładowaniu okna?

Od #16 sesje są zapisywane w stanie przestrzeni roboczej (`zedLayout.sessions.restoreOnStartup`,
domyślnie włączone):

- Terminale agentów, które VS Code przywróci (_persistent sessions_, ustawienie
  `terminal.integrated.enablePersistentSessions`), wracają do widoku „Agents” jako sesje — bez
  ponownego uruchamiania agenta. Dopasowanie po znaczniku `ZED_LAYOUT_SESSION_ID`, a gdy go brak —
  po nazwie i katalogu terminala ([AGENTS.md](AGENTS.md)).
- Sesje, których terminali nie przywrócono, trafiają do grupy **Not restored** — możesz je wznowić
  (**Resume**: ten sam agent, katalog i worktree) albo zapomnieć (**Forget**; worktree zostaje).
- Worktree agentów bez żadnej sesji pokazują się w grupie **Orphaned worktrees** z akcjami
  Start Session, Open in New Window, Review i Remove; zbiorcze sprzątanie: **Zed Layout: Clean Up
  Agent Worktrees...** ([WORKTREES.md](WORKTREES.md)).

Ograniczenia: status przywróconej sesji to _running_ do następnego zdarzenia Shell Integration;
czy proces agenta przetrwa przeładowanie, zależy od przywracania procesów terminala przez VS Code.

Ręcznie (bez rozszerzenia): `git worktree list`, `git worktree remove <katalog>`,
`git branch -d agent/<nazwa>`, `git worktree prune` dla katalogów usuniętych ręcznie.

## Czy rozszerzenie zmienia moje ustawienia bez pytania?

Nie. Ustawienia zmienia tylko _Apply Zed Layout_ — po wyborze zakresu i potwierdzeniu
(`zedLayout.layout.confirmBeforeApply`), z kopią do przywrócenia. Skróty w stylu Zeda są
domyślnie wyłączone (`zedLayout.keymap.enabled`). Walkthrough tylko podpowiada polecenia — każde
uruchamiasz sam.

## Jak ponownie otworzyć walkthrough?

**Help → Welcome** → sekcja _Walkthroughs_ → _Get started with Zed-like Agent Workspace_, albo
paleta → **Welcome: Open Walkthrough...**.

## Czy mogę dodać innego agenta (np. Aider, Gemini CLI)?

Tak — dowolne CLI uruchamiane w terminalu. Dodaj wpis do `zedLayout.agents` (pamiętaj, że
ustawienie zastępuje całą listę, więc skopiuj też domyślne wpisy). Przykład i opis pól:
[AGENTS.md](AGENTS.md).
