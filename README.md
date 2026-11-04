# Zed-like Agent Workspace

Rozszerzenie do Visual Studio Code, które ustawia środowisko tak, by wyglądało i działało jak
widok edytora [Zed](https://zed.dev) nastawiony na pracę z agentami AI, oraz ułatwia
**równoległą pracę z wieloma agentami** (Claude Code, Codex, Agy, Kilo Code) — każdy w osobnej
sesji terminala, opcjonalnie w izolowanym `git worktree`.

Pełny plan, zakres i etapy prac: [docs/PLAN.md](docs/PLAN.md).

> **Status:** M0 — szkielet. Rozszerzenie na razie udostępnia jedynie przykładowe polecenie
> `Zed Layout: Hello` i ustawienie `zedLayout.enabled`.

## Wymagania

- [Node.js](https://nodejs.org/) 20 lub nowszy (z npm),
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
4. W palecie poleceń (`Ctrl+Shift+P` / `Cmd+Shift+P`) wybierz **Zed Layout: Hello**.

Podczas pracy możesz uruchomić zadanie `npm: watch` (`Ctrl+Shift+B`), aby bundel przebudowywał się
automatycznie.

## Testy

Testy integracyjne korzystają z `@vscode/test-cli` i `@vscode/test-electron` (pobierają VS Code
przy pierwszym uruchomieniu):

```bash
npm test
```

Na Linuksie bez środowiska graficznego (np. w CI) użyj `xvfb-run -a npm test`.
Testy można też uruchomić z VS Code konfiguracją **Extension Tests**.

## Pakowanie

```bash
npm run package      # tworzy vsc-zed-plugin-<wersja>.vsix
code --install-extension vsc-zed-plugin-0.0.1.vsix
```

## Licencja

[GPL-3.0-only](LICENSE).
