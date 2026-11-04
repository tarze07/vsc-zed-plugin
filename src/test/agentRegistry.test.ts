import * as assert from 'assert';

import {
  buildShellCommand,
  findExecutable,
  parseAgents,
  quotePosix,
  quotePowerShell,
  shellFlavor,
  uniqueSessionName,
} from '../agents/registry';

suite('Agent registry: parseAgents', () => {
  const defaults = [
    {
      id: 'claude',
      label: 'Claude Code',
      command: 'claude',
      args: [],
      icon: 'sparkle',
      color: 'terminal.ansiMagenta',
    },
    { id: 'codex', label: 'Codex', command: 'codex', args: [], icon: 'robot' },
    { id: 'agy', label: 'Agy', command: 'agy' },
    { id: 'kilo', label: 'Kilo Code', command: 'kilocode', env: { FOO: 'bar' } },
  ];

  test('accepts the default agents', () => {
    const { agents, errors } = parseAgents(defaults);
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(
      agents.map((a) => a.id),
      ['claude', 'codex', 'agy', 'kilo'],
    );
    assert.deepStrictEqual(agents[0], defaults[0]);
    assert.deepStrictEqual(agents[3].env, { FOO: 'bar' });
    assert.strictEqual(agents[2].args, undefined);
  });

  test('undefined yields nothing, non-array yields an error', () => {
    assert.deepStrictEqual(parseAgents(undefined), { agents: [], errors: [] });
    const r = parseAgents({ id: 'x' });
    assert.strictEqual(r.agents.length, 0);
    assert.strictEqual(r.errors.length, 1);
  });

  test('drops invalid entries with readable errors', () => {
    const { agents, errors } = parseAgents([
      'claude',
      { id: 'Bad Id', label: 'X', command: 'x' },
      { id: 'ok', label: ' ', command: 'x' },
      { id: 'ok2', label: 'Ok', command: '' },
      { id: 'ok3', label: 'Ok', command: 'x', args: 'nope' },
      { id: 'ok4', label: 'Ok', command: 'x', args: ['a', 1] },
      { id: 'ok5', label: 'Ok', command: 'x', env: { A: 1 } },
      { id: '-x', label: 'Ok', command: 'x' },
      { id: 'good_one-2', label: ' Good ', command: ' good ' },
    ]);
    assert.deepStrictEqual(agents, [{ id: 'good_one-2', label: 'Good', command: 'good' }]);
    assert.strictEqual(errors.length, 8);
    assert.match(errors[0], /Agent #1: expected an object/);
    assert.match(errors[1], /Agent #2 \("Bad Id"\): "id"/);
    assert.match(errors[2], /"label"/);
    assert.match(errors[3], /"command"/);
    assert.match(errors[4], /"args"/);
    assert.match(errors[5], /"args"/);
    assert.match(errors[6], /"env"/);
    assert.match(errors[7], /"id"/);
  });

  test('drops duplicate ids, keeping the first', () => {
    const { agents, errors } = parseAgents([
      { id: 'a', label: 'First', command: 'a' },
      { id: 'a', label: 'Second', command: 'b' },
    ]);
    assert.deepStrictEqual(
      agents.map((a) => a.label),
      ['First'],
    );
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /duplicate id "a"/);
  });

  test('reports all problems of one entry together', () => {
    const { errors } = parseAgents([{ id: 'X', command: 3 }]);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /"id".*"label".*"command"/);
  });
});

suite('Agent registry: quoting', () => {
  test('POSIX quoting', () => {
    assert.strictEqual(quotePosix('plain-arg_1.0'), 'plain-arg_1.0');
    assert.strictEqual(quotePosix('--model=opus'), '--model=opus');
    assert.strictEqual(quotePosix(''), "''");
    assert.strictEqual(quotePosix('two words'), "'two words'");
    assert.strictEqual(quotePosix("it's"), "'it'\\''s'");
    assert.strictEqual(quotePosix('$HOME; rm -rf /'), "'$HOME; rm -rf /'");
    assert.strictEqual(quotePosix('`x`'), "'`x`'");
  });

  test('PowerShell quoting', () => {
    assert.strictEqual(quotePowerShell('plain'), 'plain');
    assert.strictEqual(quotePowerShell('C:\\tools\\a.exe'), 'C:\\tools\\a.exe');
    assert.strictEqual(quotePowerShell("it's"), "'it''s'");
    assert.strictEqual(quotePowerShell('$env:X'), "'$env:X'");
    assert.strictEqual(quotePowerShell('a b'), "'a b'");
    assert.strictEqual(quotePowerShell(''), "''");
  });

  test('buildShellCommand on POSIX', () => {
    assert.strictEqual(buildShellCommand({ command: 'claude' }, 'linux'), 'claude');
    assert.strictEqual(
      buildShellCommand({ command: 'node', args: ['-e', 'setTimeout(()=>{},1000)'] }, 'darwin'),
      "node -e 'setTimeout(()=>{},1000)'",
    );
    assert.strictEqual(
      buildShellCommand({ command: '/opt/my tools/agent', args: ["it's"] }, 'linux'),
      "'/opt/my tools/agent' 'it'\\''s'",
    );
    assert.strictEqual(buildShellCommand({ command: '~/bin/agent' }, 'linux'), '~/bin/agent');
  });

  test('buildShellCommand on Windows (PowerShell)', () => {
    assert.strictEqual(
      buildShellCommand({ command: 'codex', args: ['--flag', 'a b'] }, 'win32'),
      "codex --flag 'a b'",
    );
    assert.strictEqual(
      buildShellCommand({ command: 'C:\\Program Files\\Agent\\agent.exe' }, 'win32'),
      "& 'C:\\Program Files\\Agent\\agent.exe'",
    );
  });

  test('buildShellCommand for cmd.exe', () => {
    assert.strictEqual(
      buildShellCommand({ command: 'agent', args: ['a b', 'say "hi"'] }, 'cmd'),
      'agent "a b" "say ""hi"""',
    );
  });

  test('shellFlavor', () => {
    assert.strictEqual(shellFlavor('linux', '/bin/bash'), 'posix');
    assert.strictEqual(shellFlavor('linux', '/usr/bin/pwsh'), 'powershell');
    assert.strictEqual(shellFlavor('win32', undefined), 'powershell');
    assert.strictEqual(shellFlavor('win32', 'C:\\Windows\\System32\\cmd.exe'), 'cmd');
    assert.strictEqual(shellFlavor('win32', 'C:\\Program Files\\Git\\bin\\bash.exe'), 'posix');
    assert.strictEqual(
      shellFlavor('win32', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'),
      'powershell',
    );
  });
});

suite('Agent registry: unique session names', () => {
  test('first free name', () => {
    assert.strictEqual(uniqueSessionName('Codex', []), 'Codex');
    assert.strictEqual(uniqueSessionName('Codex', ['Codex']), 'Codex 2');
    assert.strictEqual(uniqueSessionName('Codex', ['Codex', 'Codex 2', 'Codex 3']), 'Codex 4');
    assert.strictEqual(uniqueSessionName('Codex', ['Codex', 'Codex 3']), 'Codex 2');
    assert.strictEqual(uniqueSessionName('Codex', ['Codex 2']), 'Codex');
  });
});

suite('Agent registry: findExecutable', () => {
  const posixFiles = new Set(['/usr/bin/claude', '/home/u/bin/agent', '/work/tools/run']);
  const posixFs = (p: string): boolean => posixFiles.has(p);

  test('finds bare names on PATH (POSIX)', () => {
    const opts = { platform: 'linux' as const, pathEnv: '/bin::/usr/bin', isExecutable: posixFs };
    assert.strictEqual(findExecutable('claude', opts), '/usr/bin/claude');
    assert.strictEqual(findExecutable('codex', opts), undefined);
    assert.strictEqual(findExecutable('', opts), undefined);
  });

  test('checks paths directly (POSIX)', () => {
    const opts = {
      platform: 'linux' as const,
      pathEnv: '',
      cwd: '/work',
      homeDir: '/home/u',
      isExecutable: posixFs,
    };
    assert.strictEqual(findExecutable('/usr/bin/claude', opts), '/usr/bin/claude');
    assert.strictEqual(findExecutable('./tools/run', opts), '/work/tools/run');
    assert.strictEqual(findExecutable('~/bin/agent', opts), '/home/u/bin/agent');
    assert.strictEqual(findExecutable('./missing', opts), undefined);
  });

  test('uses PATHEXT on Windows', () => {
    const winFiles = new Set(['C:\\tools\\codex.CMD', 'C:\\bin\\agy.exe']);
    const opts = {
      platform: 'win32' as const,
      pathEnv: 'C:\\nothing;"C:\\tools";C:\\bin',
      pathExt: '.EXE;.CMD',
      isExecutable: (p: string) => winFiles.has(p),
    };
    assert.strictEqual(findExecutable('codex', opts), 'C:\\tools\\codex.CMD');
    assert.strictEqual(findExecutable('agy.exe', opts), 'C:\\bin\\agy.exe');
    assert.strictEqual(findExecutable('kilocode', opts), undefined);
    assert.strictEqual(findExecutable('C:\\tools\\codex', opts), 'C:\\tools\\codex.CMD');
  });

  test('real file system: finds node via its own directory', () => {
    const path = process.execPath;
    const dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
    const base = path.slice(dir.length + 1).replace(/\.exe$/i, '');
    const found = findExecutable(base, { pathEnv: dir });
    assert.ok(found, `expected to find ${base} in ${dir}`);
  });
});
