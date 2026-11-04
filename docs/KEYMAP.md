# Skróty klawiszowe w stylu Zeda

Funkcja z issue #11 (plan: sekcja 3.6 w [PLAN.md](PLAN.md)). Rozszerzenie dostarcza opcjonalny
zestaw skrótów zbliżony do domyślnej mapy klawiszy Zeda. **Domyślnie jest wyłączony** — dopóki go
nie włączysz, żaden domyślny skrót VS Code nie jest nadpisywany.

## Włączenie

W `settings.json` (użytkownika albo workspace):

```jsonc
{
  "zedLayout.keymap.enabled": true,
}
```

albo w UI ustawień: wyszukaj `zedLayout.keymap.enabled`. Zmiana działa od razu, bez przeładowania
okna.

Każdy skrót z `contributes.keybindings` ma klauzulę `when` zaczynającą się od
`config.zedLayout.keymap.enabled && …`, więc przy wyłączonym ustawieniu VS Code w ogóle go nie
rozważa i obowiązują wyłącznie skróty domyślne (pilnuje tego test `src/test/keymapContrib.test.ts`).

## Lista skrótów

| Akcja | Windows / Linux | macOS | Komenda | Odpowiednik w Zedzie |
|---|---|---|---|---|
| Przełącz panel agentów | `Ctrl+Shift+/` (`Ctrl+?`) | `Cmd+Shift+/` (`Cmd+?`) | `zedLayout.keymap.toggleAgentsPanel` | `cmd-?` — `agent::ToggleFocus` |
| Przełącz drzewo projektu | `Ctrl+Shift+E` | `Cmd+Shift+E` | `zedLayout.keymap.toggleProjectPanel` | `cmd-shift-e` — `project_panel::ToggleFocus` |
| Przełącz terminal | ``Ctrl+` `` | ``Ctrl+` `` | `workbench.action.terminal.toggleTerminal` | ``ctrl-` `` — `terminal_panel::ToggleFocus` |
| Nowa sesja agenta | `Shift+Alt+N` | `Cmd+Alt+N` | `zedLayout.agents.newSession` | — |
| Nowa sesja agenta (fokus w widoku *Agents*) | `Ctrl+N` | `Cmd+N` | `zedLayout.agents.newSession` | `cmd-n` w panelu agenta — `agent::NewThread` |
| Nowa sesja w worktree | `Shift+Alt+W` | `Cmd+Alt+Shift+N` | `zedLayout.worktrees.newSession` | — |
| Następna sesja | `Shift+Alt+]` | `Ctrl+Alt+]` | `zedLayout.agents.next` | — |
| Poprzednia sesja | `Shift+Alt+[` | `Ctrl+Alt+[` | `zedLayout.agents.previous` | — |
| Otwórz Review (Agent Changes) | `Shift+Alt+V` | `Cmd+Alt+V` | `zedLayout.review.open` | — |

„—” oznacza, że Zed nie ma bezpośredniego odpowiednika (albo jego skrót koliduje z VS Code), więc
dobraliśmy skrót wolny w domyślnej mapie VS Code. Nazwy klawiszy dotyczą układu US; na innych
układach VS Code mapuje je według pozycji klawisza / znaku (sprawdź *Keyboard Shortcuts*).

## Jak działają przełączniki paneli

Rozszerzenie nie ma dostępu do kluczy kontekstu workbencha (np. czy panel ma fokus), dlatego
przełączanie jest zrealizowane klauzulami `when` w samych skrótach — tak jak `ToggleFocus` w Zedzie:

- **Panel agentów** (`Ctrl+Shift+/` / `Cmd+Shift+/`):
  - fokus jest w kontenerze *Agents* → panel jest zamykany: `workbench.action.closeSidebar`,
    `workbench.action.closeAuxiliaryBar` albo `workbench.action.closePanel` — zależnie od tego, gdzie
    kontener jest zadokowany (pasek boczny, drugi pasek boczny, panel dolny);
  - w każdym innym przypadku (panel ukryty albo widoczny bez fokusu) → `toggleAgentsPanel`
    pokazuje kontener *Agents* i przenosi do niego fokus (`workbench.view.extension.zedLayoutAgents`).
- **Drzewo projektu** (`Ctrl+Shift+E` / `Cmd+Shift+E`): analogicznie dla Eksploratora —
  fokus w Eksploratorze → zamknięcie paska bocznego (lub drugiego paska), w przeciwnym razie
  `toggleProjectPanel` pokazuje Eksplorator z fokusem (`workbench.view.explorer`).

Wywołane z palety poleceń (*Zed Layout: Toggle Agents Panel* / *Toggle Project Panel*) komendy
pomocnicze zawsze **pokazują i ustawiają fokus** — paleta zabiera fokus panelowi, więc nie da się
wtedy rozpoznać, że panel był aktywny. Do ukrycia służy wtedy np. `Ctrl+B` / `Cmd+B`
(*Toggle Primary Side Bar Visibility*).

## Nadpisania domyślnych skrótów (tylko przy włączonym ustawieniu)

| Skrót | Domyślnie w VS Code | Z włączonym zestawem |
|---|---|---|
| `Ctrl+Shift+E` / `Cmd+Shift+E` | pokaż Eksplorator | to samo, ale gdy Eksplorator ma fokus — ukrywa pasek boczny |
| ``Ctrl+` `` | przełącz terminal | bez zmian (wpis tylko dokumentuje skrót w zestawie) |
| `Ctrl+N` / `Cmd+N` | nowy plik bez tytułu | **tylko gdy fokus jest w widoku *Agents***: nowa sesja agenta |

Pozostałe kombinacje dobrano tak, by nie kolidowały z domyślną mapą VS Code na żadnym systemie
(stan dla VS Code 1.95+). Celowo unikaliśmy:

- `Ctrl+Alt+<litera>` na Windows — to *AltGr*, w polskim układzie wpisuje `ą ć ę ł ń ó ś ź ż`
  (np. `Ctrl+Alt+N` = `ń`), dlatego na Windows/Linux używamy `Shift+Alt+…`;
- `Cmd+Alt+[` / `Cmd+Alt+]` na macOS (zwijanie/rozwijanie kodu) — stąd `Ctrl+Alt+[` / `Ctrl+Alt+]`;
- `Cmd+Alt+R` na macOS / `Shift+Alt+R` na Windows (*Reveal in Finder/File Explorer*) — stąd
  Review pod `V`.

Uwaga: na macOS `Cmd+Shift+/` jest też systemowym skrótem wyszukiwania w menu *Help*; jeśli system go
przechwytuje, przypisz panel agentów do innego skrótu (niżej).

Skróty z innych rozszerzeń albo z Twojego `keybindings.json` mają pierwszeństwo przed tymi z
rozszerzenia (wpisy użytkownika zawsze wygrywają), więc konflikty łatwo rozwiązać lokalnie.

## Własne dostosowanie

*Preferences: Open Keyboard Shortcuts (JSON)* i np.:

```jsonc
[
  // inny skrót dla panelu agentów
  {
    "key": "shift+alt+g",
    "command": "zedLayout.keymap.toggleAgentsPanel",
    "when": "config.zedLayout.keymap.enabled",
  },
  // wyłączenie pojedynczego skrótu z zestawu (minus przed nazwą komendy)
  { "key": "ctrl+n", "command": "-zedLayout.agents.newSession" },
]
```

Wszystkie skróty z zestawu znajdziesz w *Keyboard Shortcuts* po wpisaniu `zedLayout` (albo
`@ext:tarze07.vsc-zed-plugin`).
