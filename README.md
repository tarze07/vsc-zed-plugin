# Zed-like Agent Workspace

Rozszerzenie do Visual Studio Code, które ustawia środowisko tak, by wyglądało i działało jak
widok edytora [Zed](https://zed.dev) nastawiony na pracę z agentami AI, oraz ułatwia
**równoległą pracę z wieloma agentami** (Claude Code, Codex, Agy, Kilo Code) — każdy w osobnej
sesji terminala, opcjonalnie w izolowanym `git worktree`.

Pełny plan, zakres i etapy prac: [docs/PLAN.md](docs/PLAN.md).

> **Status:** M1 — układ i wygląd. Panel agentów, worktree i przegląd zmian są w planach (M2–M3).

## Funkcje

- **Zed Layout: Apply Zed Layout** — ustawia układ w stylu Zeda (pasek aktywności u góry, drzewo
  projektu po lewej, Secondary Side Bar po prawej, terminal na dole, bez minimapy, kompaktowe
  zakładki, motyw i typografia). Przed zmianą pyta o zgodę i zapisuje kopię dotychczasowych
  ustawień. Zakres: User lub Workspace (`zedLayout.layout.scope`).
- **Zed Layout: Restore Previous Layout** — przywraca ustawienia sprzed pierwszego zastosowania.
- **Motywy Zed-like Dark / Zed-like Light** — stonowane motywy spełniające WCAG AA.
- **Typografia** — font, rozmiar, interlinia i ligatury dla edytora i terminala
  (`zedLayout.typography.*`).

Szczegóły: [docs/LAYOUT.md](docs/LAYOUT.md) (lista zmienianych ustawień, backup/restore) oraz
[docs/THEMES.md](docs/THEMES.md) (paleta, kontrast, fonty).

## Wymagania

- [Node.js](https://nodejs.org/) 22 lub nowszy (z npm),
- [Visual Studio Code](https://code.visualstudio.com/) 1.95 lub nowszy (wersja desktopowa).

## Budowanie

```bash
npm install          # instalacja zależności
npm run build        # bundel esbuild: src/extension.ts -> dist/extension.js
npm run watch        # przebudowa przy każdej zmianie
```

Kontrola jakości:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run format:check # Prettier (sprawdzenie)
npm run format       # Prettier (formatowanie)
```

## Uruchamianie i debugowanie

1. Otwórz katalog repozytorium w VS Code.
2. Zainstaluj rekomendowane rozszerzenia (`.vscode/extensions.json`).
3. Naciśnij `F5` (konfiguracja **Run Extension**) — zostanie uruchomione okno
   _Extension Development Host_ z załadowanym rozszerzeniem.
4. W palecie poleceń (`Ctrl+Shift+P` / `Cmd+Shift+P`) wybierz **Zed Layout: Apply Zed Layout**.

Podczas pracy możesz uruchomić zadanie `npm: watch` (`Ctrl+Shift+B`), aby bundel przebudowywał się
automatycznie.

## Testy

Testy integracyjne korzystają z `@vscode/test-cli` i `@vscode/test-electron` (pobierają VS Code
przy pierwszym uruchomieniu):

```bash
npm test
```

Szybkie testy jednostkowe (bez pobierania VS Code):

```bash
npm run test:unit
```

Na Linuksie bez środowiska graficznego (np. w CI) użyj `xvfb-run -a npm test`.
Testy można też uruchomić z VS Code konfiguracją **Extension Tests**.

## Motywy

```bash
npm run themes:generate  # regeneruje themes/*.json ze scripts/generate-themes.mjs
npm run themes:contrast  # raport kontrastu WCAG (kończy się błędem, gdy para nie spełnia progu)
```

## Pakowanie

```bash
npm run package      # tworzy vsc-zed-plugin-<wersja>.vsix
code --install-extension vsc-zed-plugin-0.0.1.vsix
```

## Licencja

[GPL-3.0-only](LICENSE).
