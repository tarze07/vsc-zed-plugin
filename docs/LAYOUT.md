# Preset układu „Apply Zed Layout”

Polecenia (issue #4, plan: sekcja 3.1 w [PLAN.md](PLAN.md)):

- **Zed Layout: Apply Zed Layout** (`zedLayout.apply`) — zapisuje zestaw ustawień nadających VS Code układ podobny do Zeda, wcześniej robiąc kopię dotychczasowych wartości.
- **Zed Layout: Restore Previous Layout** (`zedLayout.restore`) — przywraca wartości sprzed pierwszego zastosowania presetu.

## Przebieg „Apply”

1. **Zakres** — wg `zedLayout.layout.scope`:
   - `ask` (domyślnie): QuickPick *User* / *Workspace* (*Workspace* tylko, gdy otwarty jest folder),
   - `user`: ustawienia użytkownika,
   - `workspace`: ustawienia przestrzeni roboczej (bez otwartego folderu — ostrzeżenie i brak zmian).
2. **Potwierdzenie** — gdy `zedLayout.layout.confirmBeforeApply` = `true` (domyślnie), modalne okno z liczbą ustawień, które się zmienią, i pełną listą kluczy z wartościami (`•` — zmieni się, `✓` — już ma tę wartość) oraz listą kluczy pominiętych w zakresie Workspace.
3. Anulowanie QuickPicka lub potwierdzenia **niczego nie zmienia**.
4. Zapis kopii zapasowej (patrz niżej), następnie zapis ustawień.
5. Polecenia układu (best effort — błąd lub brak polecenia nie przerywa Apply):
   `workbench.action.closePanel` (zwinięcie panelu/terminala) →
   `workbench.action.focusAuxiliaryBar` (otwarcie Secondary Side Bar) →
   `workbench.action.focusActiveEditorGroup` (powrót fokusu do edytora).
6. Komunikat z podsumowaniem i przyciskiem *Restore Previous*.

## Zmieniane ustawienia

| Ustawienie | Wartość | Warunek | Zakres Workspace |
|---|---|---|---|
| `workbench.activityBar.location` | `"top"` lub `"hidden"` | wg `zedLayout.layout.activityBarLocation` | zapisywane |
| `workbench.sideBar.location` | `"left"` | zawsze | zapisywane |
| `workbench.panel.defaultLocation` | `"bottom"` | zawsze | zapisywane |
| `workbench.layoutControl.enabled` | `false` | zawsze | zapisywane |
| `workbench.editor.tabSizing` | `"shrink"` | zawsze | zapisywane |
| `window.density.editorTabHeight` | `"compact"` | zawsze | **pomijane** |
| `editor.minimap.enabled` | `false` | zawsze | zapisywane |
| `editor.renderLineHighlight` | `"gutter"` | zawsze | zapisywane |
| `editor.scrollbar.verticalScrollbarSize` | `8` | zawsze | zapisywane |
| `editor.scrollbar.horizontalScrollbarSize` | `8` | zawsze | zapisywane |
| `window.titleBarStyle` | `"custom"` | zawsze | **pomijane** |
| `breadcrumbs.enabled` | `false` | tylko gdy `zedLayout.layout.hideBreadcrumbs` = `true` | zapisywane |
| `workbench.colorTheme` | `"Zed-like Dark"` / `"Zed-like Light"` | gdy `zedLayout.layout.applyTheme` = `true` (motyw z `zedLayout.layout.theme`) | zapisywane |
| ustawienia typografii | wg `zedLayout.typography.*` | gdy `zedLayout.typography.enabled` = `true` | zapisywane (poza `window.*`) |

Ustawienia typografii (font edytora i — opcjonalnie — terminala, wysokość linii, ligatury) pochodzą z funkcji `getTypographySettings()` w `src/theme/typography.ts` (issue #5); są zapisywane i kopiowane do backupu dokładnie tak samo jak pozostałe klucze.

### Pomijanie w zakresie Workspace

Ustawienia `window.*` (`window.titleBarStyle`, `window.density.editorTabHeight`) mają zakres *application*/*window* i VS Code ignoruje je w ustawieniach przestrzeni roboczej. Przy zakresie *Workspace* nie są zapisywane — okno potwierdzenia i komunikat końcowy wymieniają je jako pominięte. Aby je zastosować, użyj zakresu *User*.

Uwaga: zmiana `window.titleBarStyle` może wymagać ponownego uruchomienia VS Code (VS Code sam o to zapyta).

## Kopia zapasowa i „Restore Previous”

- Przed zapisem, dla każdego klucza presetu zapamiętywana jest wartość **w docelowym zakresie** (`inspect(key).globalValue` dla User, `workspaceValue` dla Workspace) — także informacja, że klucz **nie był ustawiony**.
- Kopia (`zedLayout.layout.backup`: zakres, znacznik czasu, lista wpisów) trafia do `context.globalState` (User) lub `context.workspaceState` (Workspace). Zapis kopii następuje **przed** zmianą ustawień, więc nawet przerwane Apply da się cofnąć.
- **Ponowne Apply nie nadpisuje kopii**: zachowywane są wpisy z pierwszego Apply (stan sprzed rozszerzenia), a dopisywane są tylko klucze, których kopia jeszcze nie zawiera (np. po włączeniu typografii lub ukrycia breadcrumbs).
- **Restore** zapisuje z powrotem każdą oryginalną wartość; klucze, które wcześniej nie były ustawione, są usuwane (`update(key, undefined, target)`). Po udanym przywróceniu kopia jest kasowana. Jeśli część zapisów się nie uda, w kopii zostają tylko te klucze, a Restore można powtórzyć.
- Gdy istnieją kopie w obu zakresach — QuickPick z wyborem; gdy nie ma żadnej — komunikat informacyjny, bez zmian.
- Restore przywraca stan sprzed Apply także dla kluczy, które użytkownik zmienił ręcznie po Apply (kopia odzwierciedla stan sprzed pierwszego Apply).
- Ustawienia spoza presetu nie są dotykane.

## Architektura kodu

- `src/layout/preset.ts` — czysta funkcja `buildPreset(options)` i `presetForTarget(preset, target)` (bez importu `vscode`).
- `src/layout/options.ts` — odczyt `zedLayout.layout.*` / `zedLayout.typography.*` z walidacją.
- `src/layout/backup.ts` — czysta logika kopii (`applyWithBackup`, `restoreFromBackup`) na interfejsach `ScopedSettings` / `BackupStorage`.
- `src/layout/vscodeAdapters.ts` — adaptery do `WorkspaceConfiguration` i `Memento`.
- `src/layout/index.ts` — rejestracja poleceń i interfejs (QuickPick, potwierdzenie, komunikaty).
- Testy: `src/test/layoutPreset.test.ts`, `src/test/layoutBackup.test.ts` (jednostkowe), `src/test/layoutCommands.test.ts` (integracyjny).
