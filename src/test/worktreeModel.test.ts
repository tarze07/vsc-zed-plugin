import * as assert from 'assert';
import * as path from 'path';

import {
  makeBranchName,
  mergeChanges,
  parseNameStatusZ,
  parseStatusPorcelainZ,
  parseWorktreeList,
  randomShortId,
  resolveWorktreesDir,
  sanitizeRefName,
  shortBranchName,
  worktreePathFor,
} from '../worktrees/model';

suite('worktree model: parseWorktreeList', () => {
  test('parses main, branch, detached, bare, locked and prunable entries', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /repo.worktrees/agent-claude-1a2b3c',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/agent/claude-1a2b3c',
      'locked reason with spaces',
      '',
      'worktree /tmp/detached',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree /srv/bare.git',
      'bare',
      '',
      'worktree /tmp/locked-no-reason',
      'HEAD 4444444444444444444444444444444444444444',
      'branch refs/heads/feature/x',
      'locked',
      'prunable',
      '',
    ].join('\n');

    const list = parseWorktreeList(porcelain);
    assert.strictEqual(list.length, 5);

    assert.deepStrictEqual(list[0], {
      path: '/repo',
      head: '1111111111111111111111111111111111111111',
      branch: 'main',
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
    });
    assert.strictEqual(list[1].branch, 'agent/claude-1a2b3c');
    assert.strictEqual(list[1].locked, true);
    assert.strictEqual(list[1].lockedReason, 'reason with spaces');

    assert.strictEqual(list[2].detached, true);
    assert.strictEqual(list[2].branch, undefined);
    assert.strictEqual(list[2].prunable, true);
    assert.strictEqual(list[2].prunableReason, 'gitdir file points to non-existent location');

    assert.strictEqual(list[3].bare, true);
    assert.strictEqual(list[3].head, undefined);

    assert.strictEqual(list[4].branch, 'feature/x');
    assert.strictEqual(list[4].locked, true);
    assert.strictEqual(list[4].lockedReason, undefined);
    assert.strictEqual(list[4].prunable, true);
  });

  test('handles CRLF, missing trailing blank line, paths with spaces and empty input', () => {
    const list = parseWorktreeList(
      'worktree C:/My Repo\r\nHEAD abc\r\nbranch refs/heads/main\r\n\r\nworktree C:/wt two\r\nHEAD def\r\ndetached',
    );
    assert.deepStrictEqual(
      list.map((e) => [e.path, e.branch, e.detached]),
      [
        ['C:/My Repo', 'main', false],
        ['C:/wt two', undefined, true],
      ],
    );
    assert.deepStrictEqual(parseWorktreeList(''), []);
  });

  test('accepts NUL-separated (-z) output', () => {
    const list = parseWorktreeList(
      'worktree /a\0HEAD 1\0branch refs/heads/m\0\0worktree /b\0bare\0\0',
    );
    assert.deepStrictEqual(
      list.map((e) => [e.path, e.branch, e.bare]),
      [
        ['/a', 'm', false],
        ['/b', undefined, true],
      ],
    );
  });
});

suite('worktree model: branch names', () => {
  test('default prefix', () => {
    assert.strictEqual(makeBranchName('agent/', 'claude', '1a2b3c'), 'agent/claude-1a2b3c');
    assert.strictEqual(makeBranchName('', 'codex', 'ff00aa'), 'codex-ff00aa');
    assert.strictEqual(makeBranchName('ai-', 'kilo', '000001'), 'ai-kilo-000001');
  });

  test('sanitizes characters forbidden by git check-ref-format', () => {
    assert.strictEqual(
      makeBranchName('my agents/', 'cl aude', 'abc123'),
      'my-agents/cl-aude-abc123',
    );
    assert.strictEqual(makeBranchName('a~b^c:d?e*f[g\\h/', 'x', '1'), 'a-b-c-d-e-f-g-h/x-1');
    assert.strictEqual(makeBranchName('agent..x/', 'id', '1'), 'agent.x/id-1');
    assert.strictEqual(makeBranchName('agent@{x}/', 'id', '1'), 'agent-x}/id-1');
    assert.strictEqual(makeBranchName('agent\t\n/', 'id', '1'), 'agent-/id-1');
  });

  test('fixes component and trailing rules', () => {
    assert.strictEqual(sanitizeRefName('.hidden/.dot/name'), 'hidden/dot/name');
    assert.strictEqual(sanitizeRefName('foo.lock/bar.lock'), 'foo/bar');
    assert.strictEqual(sanitizeRefName('foo.lock.lock'), 'foo');
    assert.strictEqual(sanitizeRefName('a//b///c'), 'a/b/c');
    assert.strictEqual(sanitizeRefName('trailing/'), 'trailing');
    assert.strictEqual(sanitizeRefName('trailing.'), 'trailing');
    assert.strictEqual(sanitizeRefName('/leading'), 'leading');
    assert.strictEqual(sanitizeRefName('-dash'), 'dash');
    assert.strictEqual(sanitizeRefName('@'), '');
  });

  test('falls back to a usable name when everything is stripped', () => {
    assert.strictEqual(makeBranchName('', '', 'abc'), 'abc');
    assert.strictEqual(makeBranchName('///', '...', ''), 'agent-worktree');
  });

  test('every generated name satisfies the main check-ref-format rules', () => {
    const inputs: [string, string, string][] = [
      ['agent/', 'claude', '1a2b3c'],
      [' weird ', '..x..', '.lock'],
      ['a/./b/', 'c.lock', 'd'],
      ['~^:?*[', '\\', '@{'],
    ];
    for (const [p, a, s] of inputs) {
      const name = makeBranchName(p, a, s);
      assert.ok(name.length > 0, name);
      // eslint-disable-next-line no-control-regex
      assert.ok(!/[\x00-\x20\x7f~^:?*[\\]/.test(name), name);
      assert.ok(!name.includes('..'), name);
      assert.ok(!name.includes('@{'), name);
      assert.ok(!name.includes('//'), name);
      assert.ok(!/[./]$/.test(name), name);
      assert.ok(!name.startsWith('-'), name);
      for (const comp of name.split('/')) {
        assert.ok(!comp.startsWith('.'), name);
        assert.ok(!comp.endsWith('.lock'), name);
      }
    }
  });

  test('shortBranchName strips the prefix', () => {
    assert.strictEqual(shortBranchName('agent/claude-1a2b3c', 'agent/'), 'claude-1a2b3c');
    assert.strictEqual(shortBranchName('ai-claude-1', 'ai-'), 'claude-1');
    assert.strictEqual(shortBranchName('other/claude-1', 'agent/'), 'other/claude-1');
    assert.strictEqual(shortBranchName('claude-1', ''), 'claude-1');
  });

  test('randomShortId', () => {
    assert.match(randomShortId(), /^[0-9a-f]{6}$/);
    assert.strictEqual(
      randomShortId(4, () => 0.999),
      'ffff',
    );
  });
});

suite('worktree model: directories', () => {
  test('default: <parent>/<repo>.worktrees (posix)', () => {
    assert.strictEqual(
      resolveWorktreesDir('/home/u/src/app', '', path.posix),
      '/home/u/src/app.worktrees',
    );
    assert.strictEqual(
      resolveWorktreesDir('/home/u/src/app/', '  ', path.posix),
      '/home/u/src/app.worktrees',
    );
    assert.strictEqual(
      resolveWorktreesDir('/home/u/src/app', undefined, path.posix),
      '/home/u/src/app.worktrees',
    );
  });

  test('default: <parent>\\<repo>.worktrees (win32)', () => {
    assert.strictEqual(
      resolveWorktreesDir('C:\\src\\app', '', path.win32),
      'C:\\src\\app.worktrees',
    );
    assert.strictEqual(
      resolveWorktreesDir('C:/src/app/', '', path.win32),
      'C:\\src\\app.worktrees',
    );
  });

  test('relative settings resolve against the repo root', () => {
    assert.strictEqual(
      resolveWorktreesDir('/home/u/src/app', '.worktrees', path.posix),
      '/home/u/src/app/.worktrees',
    );
    assert.strictEqual(
      resolveWorktreesDir('/home/u/src/app', '../trees', path.posix),
      '/home/u/src/trees',
    );
    assert.strictEqual(
      resolveWorktreesDir('C:\\src\\app', '..\\trees', path.win32),
      'C:\\src\\trees',
    );
  });

  test('absolute settings and ~', () => {
    assert.strictEqual(
      resolveWorktreesDir('/home/u/src/app', '/var/trees/', path.posix),
      '/var/trees/',
    );
    assert.strictEqual(resolveWorktreesDir('C:\\src\\app', 'D:\\trees', path.win32), 'D:\\trees');
    assert.strictEqual(
      resolveWorktreesDir('/home/u/src/app', '~/trees', path.posix, '/home/u'),
      '/home/u/trees',
    );
    // Without a home dir "~" is just a relative directory name.
    assert.strictEqual(resolveWorktreesDir('/r', '~/trees', path.posix), '/r/~/trees');
  });

  test('worktreePathFor flattens branch separators', () => {
    assert.strictEqual(
      worktreePathFor('/home/u/src/app.worktrees', 'agent/claude-1a2b3c', path.posix),
      '/home/u/src/app.worktrees/agent-claude-1a2b3c',
    );
    assert.strictEqual(
      worktreePathFor('C:\\src\\app.worktrees', 'agent/team/codex-1', path.win32),
      'C:\\src\\app.worktrees\\agent-team-codex-1',
    );
    assert.strictEqual(worktreePathFor('/d', 'plain', path.posix), '/d/plain');
  });
});

suite('worktree model: change lists', () => {
  test('parseNameStatusZ handles renames and plain entries', () => {
    const out = 'M\0src/a.ts\0R087\0old.ts\0new.ts\0A\0added.md\0D\0gone.txt\0';
    assert.deepStrictEqual(parseNameStatusZ(out), [
      { path: 'src/a.ts', kind: 'M' },
      { path: 'new.ts', originalPath: 'old.ts', kind: 'R' },
      { path: 'added.md', kind: 'A' },
      { path: 'gone.txt', kind: 'D' },
    ]);
    assert.deepStrictEqual(parseNameStatusZ(''), []);
  });

  test('parseStatusPorcelainZ handles untracked, renamed, staged and conflicts', () => {
    const out = ' M a.ts\0?? new file.txt\0R  b2.ts\0b.ts\0A  c.ts\0 D d.ts\0UU e.ts\0';
    assert.deepStrictEqual(parseStatusPorcelainZ(out), [
      { path: 'a.ts', kind: 'M' },
      { path: 'new file.txt', kind: '?' },
      { path: 'b2.ts', originalPath: 'b.ts', kind: 'R' },
      { path: 'c.ts', kind: 'A' },
      { path: 'd.ts', kind: 'D' },
      { path: 'e.ts', kind: 'U' },
    ]);
  });

  test('mergeChanges de-duplicates by path and sorts', () => {
    assert.deepStrictEqual(
      mergeChanges(
        [
          { path: 'b', kind: 'M' },
          { path: 'a', kind: 'A' },
        ],
        [{ path: 'b', kind: 'D' }],
      ),
      [
        { path: 'a', kind: 'A' },
        { path: 'b', kind: 'D' },
      ],
    );
  });
});
