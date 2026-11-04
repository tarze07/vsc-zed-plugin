import * as assert from 'assert';

import {
  SESSIONS_SCHEMA_VERSION,
  deserializeSessions,
  matchRestoredTerminals,
  normalizePath,
  parseSessionRecord,
  samePath,
  serializeSessions,
} from '../agents/sessionStore';
import type { SessionRecord } from '../agents/types';

function rec(id: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    agentId: 'claude',
    agentLabel: 'Claude Code',
    name: `Session ${id}`,
    location: 'editor',
    createdAt: 1,
    terminalName: `Session ${id}`,
    ...extra,
  };
}

const worktree = {
  path: '/repo/.worktrees/a',
  branch: 'agent/claude-a',
  baseRef: 'main',
  repoRoot: '/repo',
};

suite('Session store: (de)serialisation', () => {
  test('round-trips records with a schema version', () => {
    const records = [rec('a', { cwd: '/repo', worktree }), rec('b', { location: 'panel' })];
    const payload = serializeSessions(records);
    assert.strictEqual(payload.version, SESSIONS_SCHEMA_VERSION);
    const json: unknown = JSON.parse(JSON.stringify(payload));
    assert.deepStrictEqual(deserializeSessions(json), records);
  });

  test('drops malformed entries and duplicates, defaults optional fields', () => {
    const stored = {
      version: SESSIONS_SCHEMA_VERSION,
      records: [
        null,
        42,
        'x',
        { id: 'no-agent', name: 'n' },
        { id: '', agentId: 'claude', name: 'n' },
        { id: 'ok', agentId: 'codex', name: 'Codex', location: 'weird', worktree: { path: 1 } },
        { id: 'ok', agentId: 'claude', name: 'dup' },
        rec('b'),
      ],
    };
    const records = deserializeSessions(stored);
    assert.deepStrictEqual(
      records.map((r) => r.id),
      ['ok', 'b'],
    );
    assert.deepStrictEqual(records[0], {
      id: 'ok',
      agentId: 'codex',
      agentLabel: 'codex',
      name: 'Codex',
      location: 'editor',
      createdAt: 0,
      terminalName: 'Codex',
    });
  });

  test('ignores unknown versions and garbage', () => {
    assert.deepStrictEqual(deserializeSessions(undefined), []);
    assert.deepStrictEqual(deserializeSessions([rec('a')]), []);
    assert.deepStrictEqual(deserializeSessions({ version: 99, records: [rec('a')] }), []);
    assert.deepStrictEqual(deserializeSessions({ version: SESSIONS_SCHEMA_VERSION }), []);
  });

  test('parseSessionRecord keeps a valid worktree', () => {
    assert.deepStrictEqual(parseSessionRecord(rec('a', { worktree }))?.worktree, worktree);
  });
});

suite('Session store: paths', () => {
  test('normalises posix paths', () => {
    assert.strictEqual(normalizePath('/a/b/../c/', 'linux'), '/a/c');
    assert.strictEqual(normalizePath('/', 'linux'), '/');
    assert.ok(samePath('/a/b', '/a/b/', 'linux'));
    assert.ok(!samePath('/a/B', '/a/b', 'linux'));
    assert.ok(!samePath(undefined, '/a', 'linux'));
  });

  test('is case-insensitive and separator-agnostic on win32', () => {
    assert.ok(samePath('C:\\Repo\\WT\\', 'c:/repo/wt', 'win32'));
    assert.strictEqual(normalizePath('C:\\', 'win32'), 'c:\\');
  });
});

suite('Session store: matchRestoredTerminals', () => {
  test('matches by env marker first, regardless of name', () => {
    const records = [rec('a'), rec('b')];
    const result = matchRestoredTerminals(
      records,
      [
        { name: 'Session a', envId: 'b' },
        { name: 'renamed', envId: 'a' },
      ],
      'linux',
    );
    assert.deepStrictEqual(result.matched, [
      ['a', 1],
      ['b', 0],
    ]);
    assert.deepStrictEqual(result.unmatchedRecords, []);
  });

  test('matches by name + cwd, then by unique name', () => {
    const records = [
      rec('a', { name: 'Claude', terminalName: 'Claude', cwd: '/repo/x' }),
      rec('b', { name: 'Claude', terminalName: 'Claude', cwd: '/repo/y' }),
      rec('c', { name: 'Codex', terminalName: 'Codex' }),
    ];
    const result = matchRestoredTerminals(
      records,
      [{ name: 'Codex' }, { name: 'Claude', cwd: '/repo/y/' }, { name: 'Claude', cwd: '/repo/x' }],
      'linux',
    );
    assert.deepStrictEqual(result.matched, [
      ['a', 2],
      ['b', 1],
      ['c', 0],
    ]);
  });

  test('ambiguous names stay unmatched, a terminal is never used twice', () => {
    const records = [
      rec('a', { name: 'Claude', terminalName: 'Claude' }),
      rec('b', { name: 'Claude', terminalName: 'Claude' }),
    ];
    const one = matchRestoredTerminals(records, [{ name: 'Claude' }], 'linux');
    assert.deepStrictEqual(one.matched, []);
    assert.deepStrictEqual(
      one.unmatchedRecords.map((r) => r.id),
      ['a', 'b'],
    );

    const two = matchRestoredTerminals([records[0]], [{ name: 'Claude' }, { name: 'Claude' }]);
    assert.deepStrictEqual(two.matched, []);
  });

  test('terminals carrying a foreign env marker are not matched by name', () => {
    const result = matchRestoredTerminals(
      [rec('a', { cwd: '/r' })],
      [{ name: 'Session a', cwd: '/r', envId: 'other' }],
      'linux',
    );
    assert.deepStrictEqual(result.matched, []);
  });

  test('matches the session name when the terminal name was not updated', () => {
    const result = matchRestoredTerminals(
      [rec('a', { name: 'New', terminalName: 'Old' })],
      [{ name: 'New' }],
      'linux',
    );
    assert.deepStrictEqual(result.matched, [['a', 0]]);
  });

  test('uses the worktree path when cwd is missing, case-insensitively on win32', () => {
    const result = matchRestoredTerminals(
      [
        rec('a', {
          name: 'Claude',
          terminalName: 'Claude',
          worktree: { ...worktree, path: 'C:\\Repo\\WT' },
        }),
        rec('b', { name: 'Claude', terminalName: 'Claude', cwd: 'C:\\Other' }),
      ],
      [
        { name: 'Claude', cwd: 'c:/other' },
        { name: 'Claude', cwd: 'c:/repo/wt' },
      ],
      'win32',
    );
    assert.deepStrictEqual(result.matched, [
      ['a', 1],
      ['b', 0],
    ]);
  });
});
