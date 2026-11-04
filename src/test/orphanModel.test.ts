import * as assert from 'assert';

import type { WorktreeEntry } from '../worktrees/model';
import {
  describeOrphanSummary,
  findOrphans,
  isPathInside,
  isRiskyOrphan,
  normalizePathKey,
  orphansSignature,
} from '../worktrees/orphanModel';

function entry(path: string, extra: Partial<WorktreeEntry> = {}): WorktreeEntry {
  return {
    path,
    head: 'a'.repeat(40),
    detached: false,
    bare: false,
    locked: false,
    prunable: false,
    ...extra,
  };
}

suite('orphan model: findOrphans', () => {
  const posix = {
    repoRoot: '/src/app',
    worktreesDir: '/src/app.worktrees',
    branchPrefix: 'agent/',
    platform: 'linux' as NodeJS.Platform,
  };

  test('excludes the main worktree and bare entries', () => {
    const entries = [
      entry('/src/app', { branch: 'agent/main-like' }),
      entry('/srv/bare.git', { bare: true, head: undefined }),
      entry('/src/app.worktrees/agent-claude-1a2b3c', { branch: 'agent/claude-1a2b3c' }),
    ];
    const orphans = findOrphans(entries, posix);
    assert.deepStrictEqual(orphans, [
      {
        path: '/src/app.worktrees/agent-claude-1a2b3c',
        branch: 'agent/claude-1a2b3c',
        head: 'a'.repeat(40),
        repoRoot: '/src/app',
      },
    ]);
  });

  test('matches by branch prefix OR by location inside the worktrees directory', () => {
    const entries = [
      entry('/src/app', { branch: 'main' }),
      // Prefix match outside the directory.
      entry('/elsewhere/claude', { branch: 'agent/claude-111111' }),
      // Directory match with another branch / detached HEAD.
      entry('/src/app.worktrees/manual', { branch: 'feature/x' }),
      entry('/src/app.worktrees/detached', { detached: true }),
      // Neither: an unrelated user worktree.
      entry('/src/feature-y', { branch: 'feature/y' }),
      // Sibling directory whose name merely starts with the worktrees dir name.
      entry('/src/app.worktrees-old/z', { branch: 'feature/z' }),
    ];
    const orphans = findOrphans(entries, posix);
    assert.deepStrictEqual(
      orphans.map((o) => [o.path, o.branch]),
      [
        ['/elsewhere/claude', 'agent/claude-111111'],
        ['/src/app.worktrees/manual', 'feature/x'],
        ['/src/app.worktrees/detached', undefined],
      ],
    );
  });

  test('empty prefix only uses the directory rule', () => {
    const entries = [
      entry('/src/app', { branch: 'main' }),
      entry('/elsewhere/x', { branch: 'agent/x' }),
      entry('/src/app.worktrees/y', { branch: 'agent/y' }),
    ];
    const orphans = findOrphans(entries, { ...posix, branchPrefix: '' });
    assert.deepStrictEqual(
      orphans.map((o) => o.path),
      ['/src/app.worktrees/y'],
    );
  });

  test('excludes worktrees of live and detached sessions (normalised paths)', () => {
    const entries = [
      entry('/src/app', { branch: 'main' }),
      entry('/src/app.worktrees/a', { branch: 'agent/a' }),
      entry('/src/app.worktrees/b', { branch: 'agent/b' }),
      entry('/src/app.worktrees/c', { branch: 'agent/c' }),
    ];
    const orphans = findOrphans(entries, {
      ...posix,
      livePaths: ['/src/app.worktrees/a/'],
      detachedPaths: ['/src/app.worktrees/x/../b'],
    });
    assert.deepStrictEqual(
      orphans.map((o) => o.path),
      ['/src/app.worktrees/c'],
    );
  });

  test('paths are case-sensitive on linux', () => {
    const entries = [
      entry('/src/app', { branch: 'main' }),
      entry('/src/app.worktrees/A', { branch: 'agent/a' }),
    ];
    const orphans = findOrphans(entries, { ...posix, livePaths: ['/src/app.worktrees/a'] });
    assert.strictEqual(orphans.length, 1);
  });

  test('win32: case-insensitive, accepts git forward slashes and backslashes', () => {
    const entries = [
      entry('C:/Src/App', { branch: 'main' }),
      entry('C:/Src/App.worktrees/agent-a', { branch: 'agent/a' }),
      entry('C:/Src/App.worktrees/agent-b', { branch: 'agent/b' }),
      entry('C:/Src/App.worktrees/manual', { branch: 'feature/m' }),
      entry('D:/other/agent-d', { branch: 'agent/d' }),
    ];
    const orphans = findOrphans(entries, {
      repoRoot: 'c:\\src\\app',
      worktreesDir: 'c:\\SRC\\app.worktrees',
      branchPrefix: 'agent/',
      livePaths: ['c:\\src\\app.worktrees\\AGENT-A'],
      detachedPaths: ['C:\\Src\\App.worktrees\\agent-b\\'],
      platform: 'win32',
    });
    assert.deepStrictEqual(
      orphans.map((o) => o.path),
      ['C:/Src/App.worktrees/manual', 'D:/other/agent-d'],
    );
  });

  test('win32: main worktree recognised by path even if not listed first', () => {
    const entries = [
      entry('C:/elsewhere', { bare: true }),
      entry('C:/Src/App', { branch: 'agent/x' }),
    ];
    const orphans = findOrphans(entries, {
      repoRoot: 'c:\\src\\app',
      worktreesDir: 'c:\\src\\app.worktrees',
      branchPrefix: 'agent/',
      platform: 'win32',
    });
    assert.deepStrictEqual(orphans, []);
  });

  test('marks locked and prunable entries', () => {
    const entries = [
      entry('/src/app', { branch: 'main' }),
      entry('/src/app.worktrees/l', { branch: 'agent/l', locked: true, lockedReason: 'x' }),
      entry('/src/app.worktrees/p', { branch: 'agent/p', prunable: true }),
    ];
    const orphans = findOrphans(entries, posix);
    assert.deepStrictEqual(
      orphans.map((o) => [o.path, !!o.locked, !!o.prunable]),
      [
        ['/src/app.worktrees/l', true, false],
        ['/src/app.worktrees/p', false, true],
      ],
    );
  });
});

suite('orphan model: helpers', () => {
  test('normalizePathKey and isPathInside', () => {
    assert.strictEqual(normalizePathKey('/a/b/', 'linux'), '/a/b');
    assert.strictEqual(normalizePathKey('/', 'linux'), '/');
    assert.strictEqual(normalizePathKey('C:/A/B/', 'win32'), 'c:\\a\\b');
    assert.strictEqual(normalizePathKey('C:\\', 'win32'), 'c:\\');
    assert.strictEqual(normalizePathKey('/Users/X', 'darwin'), '/users/x');
    assert.ok(isPathInside('/a/b/c', '/a/b', 'linux'));
    assert.ok(!isPathInside('/a/b', '/a/b', 'linux'));
    assert.ok(!isPathInside('/a/bc', '/a/b', 'linux'));
    assert.ok(isPathInside('C:/A/B/c', 'c:\\a\\b', 'win32'));
    assert.ok(isPathInside('C:\\x', 'C:\\', 'win32'));
  });

  test('orphansSignature changes only with content', () => {
    const a = [{ path: '/x', head: '1', repoRoot: '/r', branch: 'agent/x' }];
    const b = [{ path: '/x', head: '1', repoRoot: '/r', branch: 'agent/x' }];
    assert.strictEqual(orphansSignature(a), orphansSignature(b));
    assert.notStrictEqual(orphansSignature(a), orphansSignature([{ ...b[0], head: '2' }]));
    assert.notStrictEqual(orphansSignature(a), orphansSignature([{ ...b[0], baseRef: 'main' }]));
    assert.notStrictEqual(orphansSignature(a), orphansSignature([]));
  });

  test('describeOrphanSummary and isRiskyOrphan', () => {
    const o = { path: '/x', head: '1', repoRoot: '/r', branch: 'agent/x' };
    const clean = { uncommitted: 0, commitsNotInBase: 0, baseRef: 'main' };
    assert.strictEqual(describeOrphanSummary(o, clean), '0 uncommitted, 0 commits not in main');
    assert.strictEqual(isRiskyOrphan(o, clean, { deleteBranch: true }), false);

    const committed = { uncommitted: 0, commitsNotInBase: 1, baseRef: 'main' };
    assert.strictEqual(describeOrphanSummary(o, committed), '0 uncommitted, 1 commit not in main');
    assert.strictEqual(isRiskyOrphan(o, committed, { deleteBranch: false }), false);
    assert.strictEqual(isRiskyOrphan(o, committed, { deleteBranch: true }), true);

    const dirty = { uncommitted: 3, commitsNotInBase: 2, baseRef: 'dev' };
    assert.strictEqual(describeOrphanSummary(o, dirty), '3 uncommitted, 2 commits not in dev');
    assert.strictEqual(isRiskyOrphan(o, dirty, { deleteBranch: false }), true);

    assert.strictEqual(isRiskyOrphan(o, { error: 'boom' }, { deleteBranch: false }), true);
    assert.strictEqual(isRiskyOrphan({ ...o, locked: true }, clean, { deleteBranch: false }), true);
    assert.strictEqual(
      describeOrphanSummary({ ...o, locked: true }, clean),
      '0 uncommitted, 0 commits not in main, locked',
    );

    const stale = { ...o, prunable: true };
    assert.strictEqual(describeOrphanSummary(stale, {}), 'directory missing — will be pruned');
    assert.strictEqual(isRiskyOrphan(stale, {}, { deleteBranch: true }), false);
  });
});
