# Status sesji agentów

Każda sesja agenta (terminal z uruchomionym CLI, np. `claude`, `codex`) ma status oraz flagę
**„wymaga uwagi”** (`needsAttention`). Na jej podstawie widok _Agents_ pokazuje badge z liczbą
sesji wymagających uwagi.

## Statusy

| Status     | Znaczenie                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `starting` | Terminal utworzony, polecenie agenta jeszcze nie zostało zaobserwowane.                            |
| `running`  | Polecenie działa i wypisuje dane (albo nie da się tego sprawdzić — patrz _Tryb awaryjny_).         |
| `waiting`  | Polecenie działa, ale od `zedLayout.status.waitingAfterSeconds` sekund nic nie wypisało (heurystyka). |
| `exited`   | Polecenie się zakończyło (z kodem wyjścia, jeśli jest znany) albo terminal został zamknięty.        |

Flaga **„wymaga uwagi”** jest ustawiana, gdy sesja:

- przechodzi w `waiting` (agent prawdopodobnie czeka na odpowiedź),
- kończy działanie (`exited` po zakończeniu polecenia — niezależnie od kodu wyjścia).

Flaga jest czyszczona, gdy:

- użytkownik przełączy się na terminal sesji (aktywny terminal / akcja _Focus_),
- agent znów zaczyna wypisywać dane (`waiting` → `running`) — skoro pracuje, nie trzeba na nim
  reagować,
- w terminalu startuje nowe polecenie.

Zamknięcie terminalu przez użytkownika daje `exited` **bez** flagi uwagi (to świadoma akcja).
Jeśli sesja przechodzi w `waiting`/`exited`, a jej terminal jest właśnie aktywny w aktywnym oknie,
flaga nie jest ustawiana (użytkownik już na nią patrzy).

## Jak działa wykrywanie

Logika jest podzielona na dwie części:

- `src/agents/statusMachine.ts` — czysta maszyna stanów (bez `vscode`), testowana jednostkowo ze
  wstrzykiwanym zegarem. Zdarzenia: `executionStart`, `output`, `tick`, `executionEnd`,
  `terminalClosed`, `focused`, `shellIntegrationUnavailable`.
- `src/agents/status.ts` — podpina zdarzenia VS Code (tylko stabilne API) i zgłasza zmiany przez
  `SessionManager.setStatus(...)` (wyłącznie gdy coś się zmieniło):
  - `window.onDidStartTerminalShellExecution` → `executionStart`; wyjście polecenia jest czytane
    przez `execution.read()` i każdy fragment to `output`,
  - `window.onDidEndTerminalShellExecution` → `executionEnd` z `exitCode`,
  - `window.onDidCloseTerminal` → `terminalClosed`,
  - `window.onDidChangeActiveTerminal` / `onDidChangeWindowState` → `focused`,
  - timer co 1 s (działa tylko, gdy jakaś sesja jest w stanie `running`) → `tick`,
  - `sessions.onDidChangeSessions` — dodawanie/usuwanie stanu dla nowych/usuniętych sesji.

Śledzone jest **każde** polecenie uruchomione w terminalu sesji, nie tylko pierwsze (agent). Gdy
agent się zakończy, a użytkownik uruchomi w tym samym terminalu kolejne polecenie, status wraca do
`running`, a potem do `exited` po jego zakończeniu.

### Tryb awaryjny (brak Shell Integration)

Jeśli w ciągu ~5 s od utworzenia sesji nie pojawi się żadne zdarzenie wykonania (shell nie wspiera
Shell Integration, jest wyłączona `terminal.integrated.shellIntegration.enabled`, nietypowy shell,
zdalne środowisko bez integracji), sesja dostaje status `running` i zostaje w nim aż do zamknięcia
terminalu. W tym trybie **nie da się wykryć** `waiting` ani kodu wyjścia agenta.

## Ograniczenia

- Wymaga Shell Integration w terminalu (bash, zsh, fish, pwsh; VS Code ≥ 1.93).
- `waiting` to heurystyka czasowa: „brak wyjścia przez N sekund”. Agent, który długo myśli bez
  wypisywania niczego, zostanie błędnie uznany za czekającego; CLI z animacją (spinner, migający
  kursor rysowany sekwencjami ANSI) może nigdy nie przejść w `waiting`. Zachowanie zależy od
  konkretnego CLI.
- Wpisywanie znaków przez użytkownika powoduje echo (wyjście), więc sesja wraca do `running`.
- Wyjście jest obserwowane tylko dla poleceń wykrytych przez Shell Integration; dane wypisane
  poza poleceniem (np. przez prompt shella) nie są brane pod uwagę.

## Ustawienia

| Ustawienie                             | Domyślnie | Opis                                                                    |
| -------------------------------------- | --------- | ----------------------------------------------------------------------- |
| `zedLayout.status.waitingAfterSeconds` | `5`       | Po ilu sekundach bez wyjścia sesja `running` przechodzi w `waiting` (min. 1). |
| `zedLayout.status.notifyOnAttention`   | `true`    | Pokazuj powiadomienie, gdy sesja w tle wymaga uwagi.                    |

Zmiany ustawień są uwzględniane od razu.

## Powiadomienia

Gdy sesja zaczyna wymagać uwagi, jej terminal nie jest aktywny i
`zedLayout.status.notifyOnAttention` jest włączone, pojawia się powiadomienie:

- `<nazwa> is waiting for input`,
- `<nazwa> finished (exit N)` (albo `<nazwa> finished`, gdy kod wyjścia jest nieznany).

Przycisk **Show** wywołuje `zedLayout.agents.focus` dla tej sesji. Powiadomienie pojawia się
najwyżej raz na każde przejście flagi „wymaga uwagi” z `false` na `true` (np. kolejne powiadomienie
o zakończeniu nie pojawi się, jeśli sesja czekała i użytkownik jej jeszcze nie otworzył).
