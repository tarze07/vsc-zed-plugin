import * as assert from 'assert';

import {
  changeSides,
  changesTitle,
  changeTriples,
  decodeBaseQuery,
  defaultCommitMessage,
  describeFileNode,
  describeSessionNode,
  encodeBaseQuery,
  fileDiffTitle,
  kindIcon,
  queryToTarget,
  rejectConfirmation,
  splitPath,
  viewDescription,
} from '../review/reviewModel';
import type { ReviewFile, ReviewTarget } from '../review/types';

// package.json `when` clauses.
const SESSION_REGEX = /^reviewSession/;
const WORKTREE_REGEX = /^reviewSession.*\.worktree/;
const FILE_REGEX = /^reviewFile/;

const TARGET: ReviewTarget = {
  cwd: '/repo.worktrees/a',
  root: '/repo.worktrees/a',
  baseCommit: 'abc123',
  baseLabel: 'main',
};

suite('Review model', () => {
  test('session node: label, description, contextValue', () => {
    const wt = describeSessionNode({
      sessionId: 's1',
      name: 'Claude · a',
      baseLabel: 'main',
      root: '/repo.worktrees/a',
      fileCount: 3,
      branch: 'agent/a',
      agentIcon: 'sparkle',
      agentColor: 'terminal.ansiMagenta',
    });
    assert.strictEqual(wt.label, 'Claude · a');
    assert.strictEqual(wt.description, '3 files · vs main');
    assert.strictEqual(wt.contextValue, 'reviewSession.worktree');
    assert.match(wt.contextValue, SESSION_REGEX);
    assert.match(wt.contextValue, WORKTREE_REGEX);
    assert.doesNotMatch(wt.contextValue, FILE_REGEX);
    assert.deepStrictEqual(wt.icon, { id: 'sparkle', color: 'terminal.ansiMagenta' });
    assert.strictEqual(wt.collapsible, 'expanded');
    assert.strictEqual(wt.id, 'review:s1');

    const plain = describeSessionNode({
      sessionId: 's2',
      name: 'Codex',
      baseLabel: 'HEAD',
      root: '/repo',
      fileCount: 1,
    });
    assert.strictEqual(plain.description, '1 file · vs HEAD');
    assert.strictEqual(plain.contextValue, 'reviewSession');
    assert.match(plain.contextValue, SESSION_REGEX);
    assert.doesNotMatch(plain.contextValue, WORKTREE_REGEX);
    assert.strictEqual(plain.icon.id, 'terminal');

    const empty = describeSessionNode({
      sessionId: 's3',
      name: 'Empty',
      baseLabel: 'HEAD',
      root: '/repo',
      fileCount: 0,
    });
    assert.strictEqual(empty.description, 'no changes');
    assert.strictEqual(empty.collapsible, 'none');

    const failed = describeSessionNode({
      sessionId: 's4',
      name: 'Broken',
      baseLabel: 'main',
      root: '/repo',
      fileCount: 0,
      error: 'fatal: bad object',
    });
    assert.strictEqual(failed.description, 'error · vs main');
    assert.match(failed.tooltip, /fatal: bad object/);
  });

  test('file node: label, description, contextValue, icon', () => {
    const modified = describeFileNode('s1', { path: 'src/a/b.ts', kind: 'M' });
    assert.strictEqual(modified.label, 'b.ts');
    assert.strictEqual(modified.description, 'src/a');
    assert.strictEqual(modified.contextValue, 'reviewFile.modified');
    assert.match(modified.contextValue, FILE_REGEX);
    assert.doesNotMatch(modified.contextValue, SESSION_REGEX);
    assert.deepStrictEqual(modified.icon, {
      id: 'diff-modified',
      color: 'gitDecoration.modifiedResourceForeground',
    });
    assert.strictEqual(modified.id, 'review:s1:src/a/b.ts');

    const top = describeFileNode('s1', { path: 'README.md', kind: 'A' });
    assert.strictEqual(top.label, 'README.md');
    assert.strictEqual(top.description, '');
    assert.strictEqual(top.contextValue, 'reviewFile.added');

    const renamed = describeFileNode('s1', {
      path: 'src/new.ts',
      originalPath: 'lib/old.ts',
      kind: 'R',
    });
    assert.strictEqual(renamed.description, 'src ← lib/old.ts');
    assert.strictEqual(renamed.contextValue, 'reviewFile.renamed');
    assert.match(renamed.tooltip, /renamed from lib\/old\.ts/);

    assert.strictEqual(
      describeFileNode('s', { path: 'x', kind: '?' }).contextValue,
      'reviewFile.untracked',
    );
    assert.strictEqual(
      describeFileNode('s', { path: 'x', kind: 'U' }).contextValue,
      'reviewFile.conflict',
    );
  });

  test('icons per kind', () => {
    assert.strictEqual(kindIcon('A').id, 'diff-added');
    assert.strictEqual(kindIcon('?').id, 'diff-added');
    assert.strictEqual(kindIcon('M').id, 'diff-modified');
    assert.strictEqual(kindIcon('T').id, 'diff-modified');
    assert.strictEqual(kindIcon('D').id, 'diff-removed');
    assert.strictEqual(kindIcon('D').color, 'gitDecoration.deletedResourceForeground');
    assert.strictEqual(kindIcon('R').id, 'diff-renamed');
    assert.strictEqual(kindIcon('C').id, 'diff-renamed');
    assert.strictEqual(kindIcon('U').id, 'warning');
    assert.strictEqual(kindIcon('A').color, 'gitDecoration.addedResourceForeground');
  });

  test('splitPath', () => {
    assert.deepStrictEqual(splitPath('a/b/c.ts'), { base: 'c.ts', dir: 'a/b' });
    assert.deepStrictEqual(splitPath('c.ts'), { base: 'c.ts', dir: '' });
  });

  test('multi-diff triples: added has no left, deleted has no right', () => {
    const files: ReviewFile[] = [
      { path: 'a.ts', kind: 'A' },
      { path: 'u.ts', kind: '?' },
      { path: 'm.ts', kind: 'M' },
      { path: 'd.ts', kind: 'D' },
      { path: 'new.ts', originalPath: 'old.ts', kind: 'R' },
    ];
    const triples = changeTriples(files, {
      resource: (f) => `file:${f.path}`,
      base: (f) => `base:${f.originalPath ?? f.path}`,
    });
    assert.deepStrictEqual(triples, [
      ['file:a.ts', undefined, 'file:a.ts'],
      ['file:u.ts', undefined, 'file:u.ts'],
      ['file:m.ts', 'base:m.ts', 'file:m.ts'],
      ['file:d.ts', 'base:d.ts', undefined],
      ['file:new.ts', 'base:old.ts', 'file:new.ts'],
    ]);
    assert.deepStrictEqual(changeSides('D'), { left: true, right: false });
    assert.deepStrictEqual(changeSides('A'), { left: false, right: true });
    assert.deepStrictEqual(changeSides('M'), { left: true, right: true });
  });

  test('base URI query round-trips', () => {
    const file: ReviewFile = { path: 'src/new.ts', originalPath: 'src/old.ts', kind: 'R' };
    const decoded = decodeBaseQuery(encodeBaseQuery('s1', TARGET, file));
    assert.ok(decoded);
    assert.strictEqual(decoded.sessionId, 's1');
    const { target, file: back } = queryToTarget(decoded);
    assert.deepStrictEqual(target, TARGET);
    assert.deepStrictEqual(back, file);

    assert.strictEqual(decodeBaseQuery('not json'), undefined);
    assert.strictEqual(decodeBaseQuery('{"cwd":1}'), undefined);
  });

  test('titles, messages and descriptions', () => {
    assert.strictEqual(changesTitle('Claude · a', 'main'), 'Claude · a ↔ main');
    assert.strictEqual(
      fileDiffTitle({ path: 'src/x.ts', kind: 'M' }, 'Claude', 'main'),
      'x.ts (main ↔ Claude)',
    );
    assert.strictEqual(defaultCommitMessage('Claude · a'), 'Accept changes from Claude · a');
    assert.strictEqual(viewDescription(0), undefined);
    assert.strictEqual(viewDescription(1), '1 file changed');
    assert.strictEqual(viewDescription(5), '5 files changed');
  });

  test('reject confirmation', () => {
    const one = rejectConfirmation([{ path: 'src/a.ts', kind: 'M' }]);
    assert.strictEqual(one.message, 'Discard changes to src/a.ts?');
    const added = rejectConfirmation([{ path: 'n.ts', kind: 'A' }]);
    assert.match(added.detail, /deleted/);
    const many = rejectConfirmation(
      Array.from({ length: 12 }, (_, i) => ({ path: `f${i}.ts`, kind: 'M' as const })),
    );
    assert.strictEqual(many.message, 'Discard changes to 12 files?');
    assert.match(many.detail, /and 2 more/);
  });
});
