import * as assert from 'assert';

import {
  badgeCount,
  badgeTooltip,
  describeSession,
  orderSessions,
  sessionContextValue,
  sessionDescription,
  sessionIcon,
  sessionTooltip,
  viewDescription,
  type AgentSessionLike,
} from '../views/agentsTreeModel';

const SESSION_REGEX = /^agentSession/;
const WORKTREE_REGEX = /^agentSession.*\.worktree/;

function session(overrides: Partial<AgentSessionLike> = {}): AgentSessionLike {
  return {
    id: 's1',
    name: 'Claude Code 1',
    agent: {
      id: 'claude',
      label: 'Claude Code',
      command: 'claude',
      args: ['--verbose'],
      icon: 'sparkle',
      color: 'terminal.ansiMagenta',
    },
    cwd: '/repo',
    status: 'running',
    needsAttention: false,
    createdAt: 1000,
    ...overrides,
  };
}

const WORKTREE = {
  path: '/repo.worktrees/claude-1a2b',
  branch: 'agent/claude-1a2b',
  baseRef: 'main',
  repoRoot: '/repo',
};

suite('Agents view model', () => {
  test('description: agent label and status', () => {
    assert.strictEqual(sessionDescription(session()), 'Claude Code · running');
    assert.strictEqual(
      sessionDescription(session({ status: 'starting' })),
      'Claude Code · starting',
    );
  });

  test('description: includes branch for worktree sessions', () => {
    assert.strictEqual(
      sessionDescription(session({ status: 'waiting', worktree: WORKTREE })),
      'Claude Code · waiting · agent/claude-1a2b',
    );
  });

  test('description: exit code shown only for failed exits', () => {
    assert.strictEqual(
      sessionDescription(session({ status: 'exited', exitCode: 0 })),
      'Claude Code · exited',
    );
    assert.strictEqual(sessionDescription(session({ status: 'exited' })), 'Claude Code · exited');
    assert.strictEqual(
      sessionDescription(session({ status: 'exited', exitCode: 2 })),
      'Claude Code · exited (2)',
    );
  });

  test('label and id come from the session', () => {
    const d = describeSession(session({ id: 'abc', name: 'My agent' }));
    assert.strictEqual(d.id, 'abc');
    assert.strictEqual(d.label, 'My agent');
  });

  test('contextValue: status plus worktree suffix, matching menu when clauses', () => {
    const statuses = ['starting', 'running', 'waiting', 'exited'] as const;
    for (const status of statuses) {
      const plain = sessionContextValue({ status });
      assert.strictEqual(plain, `agentSession.${status}`);
      assert.match(plain, SESSION_REGEX);
      assert.doesNotMatch(plain, WORKTREE_REGEX);

      const wt = sessionContextValue({ status, worktree: WORKTREE });
      assert.strictEqual(wt, `agentSession.${status}.worktree`);
      assert.match(wt, SESSION_REGEX);
      assert.match(wt, WORKTREE_REGEX);
    }
  });

  test('icons per status', () => {
    assert.deepStrictEqual(sessionIcon(session({ status: 'starting' })), { id: 'loading~spin' });
    assert.deepStrictEqual(sessionIcon(session({ status: 'running' })), {
      id: 'sparkle',
      color: 'terminal.ansiMagenta',
    });
    assert.deepStrictEqual(sessionIcon(session({ status: 'waiting' })), {
      id: 'bell-dot',
      color: 'charts.yellow',
    });
    assert.strictEqual(sessionIcon(session({ status: 'exited' })).id, 'circle-slash');
    assert.strictEqual(sessionIcon(session({ status: 'exited', exitCode: 0 })).id, 'circle-slash');
    assert.strictEqual(sessionIcon(session({ status: 'exited', exitCode: 1 })).id, 'error');
  });

  test('running without agent icon falls back to pulse', () => {
    const s = session({ agent: { id: 'x', label: 'X', command: 'x' } });
    assert.deepStrictEqual(sessionIcon(s), { id: 'pulse', color: undefined });
  });

  test('tooltip lists agent, command, cwd, worktree, status and start time', () => {
    const tooltip = sessionTooltip(
      session({ status: 'waiting', worktree: WORKTREE, cwd: undefined, needsAttention: true }),
      () => 'TIME',
    );
    assert.ok(tooltip.includes('Claude Code'));
    assert.ok(tooltip.includes('`claude --verbose`'));
    assert.ok(tooltip.includes('Cwd: `/repo.worktrees/claude-1a2b`'));
    assert.ok(tooltip.includes('Worktree: `/repo.worktrees/claude-1a2b`'));
    assert.ok(tooltip.includes('Branch: `agent/claude-1a2b`'));
    assert.ok(tooltip.includes('Base: `main`'));
    assert.ok(tooltip.includes('Status: waiting'));
    assert.ok(tooltip.includes('Needs attention'));
    assert.ok(tooltip.includes('Started: TIME'));
  });

  test('tooltip escapes markdown in the session name', () => {
    const tooltip = sessionTooltip(session({ name: '*bold* [x](y)' }), () => 't');
    assert.ok(tooltip.startsWith('**\\*bold\\* \\[x\\]\\(y\\)**'));
  });

  test('badge counts sessions needing attention', () => {
    assert.strictEqual(badgeCount([]), 0);
    assert.strictEqual(
      badgeCount([
        session({ needsAttention: true }),
        session({ needsAttention: false }),
        session({ needsAttention: true, status: 'exited', exitCode: 1 }),
      ]),
      2,
    );
    assert.strictEqual(badgeTooltip(1), '1 agent session needs attention');
    assert.strictEqual(badgeTooltip(3), '3 agent sessions need attention');
  });

  test('view description and ordering', () => {
    assert.strictEqual(viewDescription(0), undefined);
    assert.strictEqual(viewDescription(1), '1 session');
    assert.strictEqual(viewDescription(3), '3 sessions');
    const ordered = orderSessions([
      session({ id: 'b', createdAt: 2 }),
      session({ id: 'a', createdAt: 1 }),
      session({ id: 'c', createdAt: 2 }),
    ]);
    assert.deepStrictEqual(
      ordered.map((s) => s.id),
      ['a', 'b', 'c'],
    );
  });
});
