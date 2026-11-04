// Generates the command and settings tables of README.md from package.json (#12).
//
//   node scripts/docs-tables.mjs           # print both tables to stdout
//   node scripts/docs-tables.mjs --write   # replace the marked sections in README.md (Prettier-formatted)
//   node scripts/docs-tables.mjs --check   # exit 1 when README.md is out of date
//
// README.md sections are delimited by <!-- commands:start --> / <!-- commands:end --> and
// <!-- settings:start --> / <!-- settings:end -->.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as prettier from 'prettier';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const readmePath = join(root, 'README.md');

/** Polish descriptions of commands (package.json titles are English). */
const COMMAND_NOTES = {
  'zedLayout.hello': 'Polecenie testowe — pokazuje powitanie.',
  'zedLayout.apply': 'Stosuje układ, motyw i typografię w stylu Zeda (z potwierdzeniem i kopią).',
  'zedLayout.restore': 'Przywraca ustawienia sprzed pierwszego Apply.',
  'zedLayout.profile.save': 'Zapisuje preset jako plik profilu VS Code (`.code-profile`).',
  'zedLayout.agents.newSession': 'Uruchamia agenta w nowym terminalu (argument: id agenta).',
  'zedLayout.agents.focus': 'Pokazuje terminal sesji i kasuje znacznik „wymaga uwagi”.',
  'zedLayout.agents.rename': 'Zmienia nazwę sesji.',
  'zedLayout.agents.stop': 'Zamyka terminal sesji (z potwierdzeniem, gdy agent działa).',
  'zedLayout.agents.restart': 'Uruchamia sesję ponownie z tymi samymi parametrami.',
  'zedLayout.agents.next': 'Przełącza na następną sesję.',
  'zedLayout.agents.previous': 'Przełącza na poprzednią sesję.',
  'zedLayout.worktrees.newSession':
    'Tworzy `git worktree` na nowej gałęzi i uruchamia w nim agenta.',
  'zedLayout.worktrees.openInNewWindow': 'Otwiera katalog worktree w nowym oknie.',
  'zedLayout.worktrees.compareWithBase': 'Pokazuje zmiany worktree względem bazy (multi-diff).',
  'zedLayout.worktrees.remove': 'Bezpiecznie usuwa worktree (opcjonalnie także gałąź).',
  'zedLayout.agents.resume':
    'Wznawia sesję, której terminal nie został przywrócony po przeładowaniu okna.',
  'zedLayout.agents.forget': 'Usuwa nieprzywróconą sesję z listy (bez usuwania worktree).',
  'zedLayout.worktrees.orphan.startSession': 'Uruchamia agenta w osieroconym worktree.',
  'zedLayout.worktrees.orphan.openInNewWindow': 'Otwiera osierocone worktree w nowym oknie.',
  'zedLayout.worktrees.orphan.review':
    'Pokazuje zmiany osieroconego worktree względem bazy (multi-diff).',
  'zedLayout.worktrees.orphan.remove':
    'Bezpiecznie usuwa osierocone worktree (opcjonalnie także gałąź).',
  'zedLayout.worktrees.cleanUp':
    'Zbiorcze sprzątanie worktree agentów bez sesji (wielokrotny wybór, `git worktree prune`).',
  'zedLayout.worktrees.refreshOrphans': 'Ponownie wyszukuje osierocone worktree agentów.',
  'zedLayout.review.open': 'Pokazuje sesję w widoku Agent Changes i otwiera jej zmiany.',
  'zedLayout.review.refresh': 'Odświeża widok Agent Changes.',
  'zedLayout.review.openAll': 'Otwiera wszystkie zmiany sesji w jednym multi-diffie.',
  'zedLayout.review.openFile': 'Otwiera diff jednego pliku.',
  'zedLayout.review.accept': 'Akceptuje (stage) wybrane pliki.',
  'zedLayout.review.reject': 'Przywraca wybrane pliki do wersji bazowej (nieodwracalne).',
  'zedLayout.review.acceptAll': 'Stage lub commit wszystkich zmian sesji.',
  'zedLayout.review.rejectAll': 'Przywraca wszystkie pliki sesji do bazy (nieodwracalne).',
  'zedLayout.review.mergeIntoBase': 'Scala gałąź agenta do gałęzi bazowej (`git merge --no-ff`).',
  'zedLayout.keymap.toggleAgentsPanel':
    'Pokazuje kontener Agents z fokusem (skrót Zeda przełącza widoczność).',
  'zedLayout.keymap.toggleProjectPanel':
    'Pokazuje Eksplorator z fokusem (skrót Zeda przełącza widoczność).',
};

/** Polish descriptions of settings; falls back to the English description from package.json. */
const SETTING_NOTES = {
  'zedLayout.enabled': 'Włącza funkcje rozszerzenia.',
  'zedLayout.layout.scope':
    'Gdzie *Apply Zed Layout* zapisuje ustawienia: pytaj, User albo Workspace.',
  'zedLayout.layout.confirmBeforeApply': 'Pytaj o potwierdzenie przed zmianą ustawień.',
  'zedLayout.layout.activityBarLocation': 'Położenie Activity Bar ustawiane przez preset.',
  'zedLayout.layout.hideBreadcrumbs': 'Ukryj breadcrumbs przy stosowaniu presetu.',
  'zedLayout.layout.applyTheme': 'Przełącz też motyw kolorów przy stosowaniu presetu.',
  'zedLayout.layout.theme':
    'Motyw ustawiany przez preset (gdy `zedLayout.layout.applyTheme` = `true`).',
  'zedLayout.typography.enabled':
    'Stosuj typografię (font, interlinia, ligatury) w ramach presetu.',
  'zedLayout.typography.fontFamily': 'Font edytora ustawiany przez preset.',
  'zedLayout.typography.fontSize': 'Rozmiar fontu edytora (6–72).',
  'zedLayout.typography.lineHeight': 'Wysokość linii; wartości < 8 to mnożnik rozmiaru fontu.',
  'zedLayout.typography.ligatures': 'Ligatury w edytorze.',
  'zedLayout.typography.applyToTerminal': 'Zastosuj font i rozmiar także w terminalu.',
  'zedLayout.agents':
    'Agenci CLI dostępni dla nowych sesji — patrz [docs/AGENTS.md](docs/AGENTS.md).',
  'zedLayout.agentSessionLocation':
    'Gdzie otwierają się nowe sesje: karta edytora albo panel terminala.',
  'zedLayout.status.notifyOnAttention': 'Powiadomienie, gdy sesja w tle wymaga uwagi.',
  'zedLayout.status.waitingAfterSeconds':
    'Po ilu sekundach bez wyjścia działający agent jest uznawany za czekającego.',
  'zedLayout.worktrees.directory':
    'Katalog na worktree; pusty: `../<repo>.worktrees`, ścieżki względne od katalogu repozytorium.',
  'zedLayout.worktrees.branchPrefix': 'Prefiks gałęzi tworzonych dla agentów.',
  'zedLayout.sessions.restoreOnStartup':
    'Po przeładowaniu okna ponownie podłącza sesje, których terminale VS Code przywrócił, i pokazuje te, których nie udało się przywrócić.',
  'zedLayout.worktrees.showOrphaned': 'Pokazuje w widoku „Agents” worktree agentów bez sesji.',
  'zedLayout.review.acceptAllAction': 'Co robi *Accept All Changes*: pytaj, stage albo commit.',
  'zedLayout.keymap.enabled':
    'Włącza skróty klawiszowe w stylu Zeda (domyślnie wyłączone — nic nie jest nadpisywane).',
};

/** Escapes a table cell; `<` outside inline code would be parsed as HTML. */
const cell = (text) =>
  String(text)
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/</g, '&lt;')))
    .join('')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
const code = (text) => '`' + String(text).replace(/`/g, '\\`') + '`';

function formatDefault(schema) {
  const value = schema.default;
  if (value === undefined) return '—';
  if (Array.isArray(value) && value.some((item) => item && typeof item === 'object')) {
    const names = value.map((item) => item.command ?? item.id ?? '…');
    return `${value.length} wpisy: ${names.map(code).join(', ')}`;
  }
  return code(JSON.stringify(value));
}

function formatType(schema) {
  if (schema.enum) return schema.enum.map(code).join(' / ');
  return schema.type ?? '';
}

export function commandsTable() {
  const hidden = new Set(
    (pkg.contributes.menus?.commandPalette ?? [])
      .filter((entry) => entry.when === 'false')
      .map((entry) => entry.command),
  );
  const rows = pkg.contributes.commands.map((c) => {
    const title = c.category ? `${c.category}: ${c.title}` : c.title;
    const palette = hidden.has(c.command) ? 'nie (menu widoku)' : 'tak';
    const note = COMMAND_NOTES[c.command] ?? '';
    if (!note) process.stderr.write(`docs-tables: no description for ${c.command}\n`);
    return `| ${cell(title)} | ${code(c.command)} | ${palette} | ${cell(note)} |`;
  });
  return ['| Polecenie | Id | W palecie | Opis |', '|---|---|---|---|', ...rows].join('\n');
}

export function settingsTable() {
  const rows = Object.entries(pkg.contributes.configuration.properties).map(([key, schema]) => {
    if (!SETTING_NOTES[key])
      process.stderr.write(`docs-tables: no Polish description for ${key}\n`);
    return `| ${code(key)} | ${cell(formatType(schema))} | ${cell(formatDefault(schema))} | ${cell(SETTING_NOTES[key] ?? schema.markdownDescription ?? schema.description ?? '')} |`;
  });
  return ['| Ustawienie | Typ / wartości | Domyślnie | Opis |', '|---|---|---|---|', ...rows].join(
    '\n',
  );
}

function replaceSection(text, name, content) {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(text)) throw new Error(`README.md: missing <!-- ${name}:start/end --> markers`);
  return text.replace(re, (_m, start, end) => `${start}\n\n${content}\n\n${end}`);
}

const mode = process.argv[2];
if (mode === '--write' || mode === '--check') {
  const current = readFileSync(readmePath, 'utf8');
  const raw = replaceSection(
    replaceSection(current, 'commands', commandsTable()),
    'settings',
    settingsTable(),
  );
  // README.md is checked by Prettier, so compare/write the formatted text.
  const options = (await prettier.resolveConfig(readmePath)) ?? {};
  const updated = await prettier.format(raw, { ...options, filepath: readmePath });
  if (mode === '--check') {
    if (updated !== current) {
      process.stderr.write(
        'README.md tables are out of date: node scripts/docs-tables.mjs --write\n',
      );
      process.exit(1);
    }
  } else if (updated !== current) {
    writeFileSync(readmePath, updated);
  }
} else {
  process.stdout.write(`${commandsTable()}\n\n${settingsTable()}\n`);
}
