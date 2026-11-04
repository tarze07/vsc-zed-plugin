import * as assert from 'assert';

import {
  badgeCount,
  badgeTooltip,
  buildAgentsTree,
  describeDetached,
  describeGroup,
  describeOrphan,
  describeSession,
  orderOrphans,
  orphanContextValue,
  orphanLabel,
  orderSessions,
  sessionContextValue,
  sessionDescription,
  sessionIcon,
  sessionTooltip,
  viewDescription,
  type AgentSessionLike,
  type OrphanedWorktreeLike,
  type SessionRecordLike,
} from '../views/agentsTreeModel';

// `when` clauses from package.json (view/item/context of zedLayout.agentsView).
const DETACHED_WHEN = (viewItem: string): boolean => viewItem === 'detachedSession';
const ORPHAN_REGEX = /^orphanWorktree/;

function record(overrides: Partial<SessionRecordLike> = {}): SessionRecordLike {
  return {
    id: 'r1',
    agentId: 'claude',
    agentLabel: 'Claude Code',
    name: 'Claude Code 1',
    cwd: '/repo',
    createdAt: 500,
    ...overrides,
  };
}

function orphan(overrides: Partial<OrphanedWorktreeLike> = {}): OrphanedWorktreeLike {
  return {
    path: '/repo.worktrees/claude-1a2b',
    branch: 'agent/claude-1a2b',
    head: '0123456789abcdef0123',
    repoRoot: '/repo',
    baseRef: 'main',
    ...overrides,
  };
}

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

  test('view description with detached sessions and orphans', () => {
    assert.strictEqual(viewDescription(0, 0, 0), undefined);
    assert.strictEqual(viewDescription(3, 1, 2), '3 sessions · 1 not restored · 2 orphaned');
    assert.strictEqual(viewDescription(0, 2, 0), '2 not restored');
    assert.strictEqual(viewDescription(1, 0, 1), '1 session · 1 orphaned');
  });

  test('badge tooltip mentions sessions not restored', () => {
    assert.strictEqual(badgeTooltip(1, 0), '1 agent session needs attention');
    assert.strictEqual(
      badgeTooltip(2, 1),
      '2 agent sessions need attention; 1 session not restored',
    );
    assert.strictEqual(
      badgeTooltip(1, 3),
      '1 agent session needs attention; 3 sessions not restored',
    );
  });

  test('detached record descriptor', () => {
    const d = describeDetached(record(), () => 'TIME');
    assert.strictEqual(d.id, 'detached:r1');
    assert.strictEqual(d.label, 'Claude Code 1');
    assert.strictEqual(d.description, 'Claude Code · not restored');
    assert.deepStrictEqual(d.icon, { id: 'debug-disconnect' });
    assert.strictEqual(d.contextValue, 'detachedSession');
    assert.ok(DETACHED_WHEN(d.contextValue));
    assert.doesNotMatch(d.contextValue, SESSION_REGEX);
    assert.doesNotMatch(d.contextValue, ORPHAN_REGEX);
    assert.ok(d.tooltip.includes('Cwd: `/repo`'));
    assert.ok(d.tooltip.includes('Created: TIME'));
    assert.ok(d.tooltip.includes('not restored'));
  });

  test('detached record in a worktree shows branch and worktree details', () => {
    const d = describeDetached(record({ cwd: undefined, worktree: WORKTREE }), () => 't');
    assert.strictEqual(d.description, 'Claude Code · not restored · agent/claude-1a2b');
    assert.ok(d.tooltip.includes('Cwd: `/repo.worktrees/claude-1a2b`'));
    assert.ok(d.tooltip.includes('Worktree: `/repo.worktrees/claude-1a2b`'));
    assert.ok(d.tooltip.includes('Branch: `agent/claude-1a2b`'));
    assert.ok(d.tooltip.includes('Base: `main`'));
    assert.strictEqual(d.contextValue, 'detachedSession');
  });

  test('orphan descriptor', () => {
    const d = describeOrphan(orphan());
    assert.strictEqual(d.id, 'orphan:/repo.worktrees/claude-1a2b');
    assert.strictEqual(d.label, 'claude-1a2b');
    assert.strictEqual(d.description, 'orphaned');
    assert.deepStrictEqual(d.icon, { id: 'git-branch' });
    assert.strictEqual(d.contextValue, 'orphanWorktree');
    assert.match(d.contextValue, ORPHAN_REGEX);
    assert.doesNotMatch(d.contextValue, SESSION_REGEX);
    assert.ok(!DETACHED_WHEN(d.contextValue));
    assert.ok(d.tooltip.includes('Path: `/repo.worktrees/claude-1a2b`'));
    assert.ok(d.tooltip.includes('Repository: `/repo`'));
    assert.ok(d.tooltip.includes('Base: `main`'));
    assert.ok(d.tooltip.includes('Head: `0123456`'));
  });

  test('orphan: prunable and locked flags', () => {
    const prunable = describeOrphan(orphan({ prunable: true }));
    assert.strictEqual(prunable.description, 'orphaned · missing');
    assert.strictEqual(prunable.icon.id, 'warning');
    assert.strictEqual(prunable.contextValue, 'orphanWorktree.prunable');
    assert.strictEqual(describeOrphan(orphan({ locked: true })).description, 'orphaned · locked');
    assert.strictEqual(orphanContextValue({ locked: true }), 'orphanWorktree.locked');
    const both = orphanContextValue({ prunable: true, locked: true });
    assert.strictEqual(both, 'orphanWorktree.prunable.locked');
    for (const value of [both, orphanContextValue({}), orphanContextValue({ locked: true })]) {
      assert.match(value, ORPHAN_REGEX);
    }
  });

  test('orphan label: strips the branch prefix, folder name for detached HEAD', () => {
    assert.strictEqual(orphanLabel({ path: '/x', branch: 'agent/foo' }), 'foo');
    assert.strictEqual(orphanLabel({ path: '/x', branch: 'bots/foo' }, 'bots/'), 'foo');
    assert.strictEqual(orphanLabel({ path: '/x', branch: 'feature/foo' }), 'feature/foo');
    assert.strictEqual(orphanLabel({ path: '/repo.worktrees/wt-1/', branch: undefined }), 'wt-1');
    assert.strictEqual(orphanLabel({ path: 'C:\\wt\\wt-2' }), 'wt-2');
    const d = describeOrphan(orphan({ branch: undefined }));
    assert.strictEqual(d.label, 'claude-1a2b');
    assert.ok(d.tooltip.includes('detached HEAD'));
  });

  test('group descriptors', () => {
    const sessions = describeGroup('sessions', 2);
    assert.deepStrictEqual(
      { ...sessions, tooltip: undefined },
      {
        id: 'group:sessions',
        label: 'Sessions',
        description: '2',
        tooltip: undefined,
        icon: { id: 'terminal' },
        contextValue: 'group.sessions',
        collapsed: 'expanded',
      },
    );
    assert.strictEqual(describeGroup('sessions', 0).description, 'none');
    assert.strictEqual(describeGroup('sessions', 0).collapsed, 'none');
    const detached = describeGroup('detached', 1);
    assert.strictEqual(detached.label, 'Not restored');
    assert.strictEqual(detached.icon.id, 'history');
    assert.strictEqual(detached.contextValue, 'group.detached');
    assert.strictEqual(detached.collapsed, 'expanded');
    const orphans = describeGroup('orphans', 5);
    assert.strictEqual(orphans.label, 'Orphaned worktrees');
    assert.strictEqual(orphans.icon.id, 'git-branch');
    assert.strictEqual(orphans.contextValue, 'group.orphans');
    assert.strictEqual(orphans.collapsed, 'expanded');
    assert.strictEqual(describeGroup('orphans', 6).collapsed, 'collapsed');
    for (const value of [sessions, detached, orphans].map((g) => g.contextValue)) {
      assert.doesNotMatch(value, SESSION_REGEX);
      assert.doesNotMatch(value, ORPHAN_REGEX);
      assert.ok(!DETACHED_WHEN(value));
    }
  });

  test('tree: flat list without detached sessions and orphans', () => {
    const tree = buildAgentsTree({
      sessions: [session({ id: 'b', createdAt: 2 }), session({ id: 'a', createdAt: 1 })],
      detached: [],
      orphans: [],
    });
    assert.deepStrictEqual(
      tree.map((n) => (n.kind === 'session' ? n.session.id : n.kind)),
      ['a', 'b'],
    );
  });

  test('tree: groups when detached sessions or orphans exist', () => {
    const tree = buildAgentsTree({
      sessions: [],
      detached: [record({ id: 'r2', createdAt: 9 }), record({ id: 'r1', createdAt: 1 })],
      orphans: [
        orphan({ path: '/w/b', branch: 'agent/b' }),
        orphan({ path: '/w/a', branch: 'agent/a' }),
      ],
    });
    assert.deepStrictEqual(
      tree.map((n) => (n.kind === 'group' ? n.group : n.kind)),
      ['sessions', 'detached', 'orphans'],
    );
    const [sessions, detached, orphans] = tree;
    assert.ok(sessions.kind === 'group' && sessions.children.length === 0);
    assert.ok(detached.kind === 'group');
    assert.deepStrictEqual(
      detached.children.map((n) => (n.kind === 'detached' ? n.record.id : n.kind)),
      ['r1', 'r2'],
    );
    assert.ok(orphans.kind === 'group');
    assert.deepStrictEqual(
      orphans.children.map((n) => (n.kind === 'orphan' ? n.orphan.path : n.kind)),
      ['/w/a', '/w/b'],
    );

    const onlyOrphans = buildAgentsTree({ sessions: [], detached: [], orphans: [orphan()] });
    assert.deepStrictEqual(
      onlyOrphans.map((n) => (n.kind === 'group' ? n.group : n.kind)),
      ['sessions', 'orphans'],
    );
  });

  test('orphans are ordered by repository, then label', () => {
    const ordered = orderOrphans([
      orphan({ repoRoot: '/z', path: '/z.wt/a', branch: 'agent/a' }),
      orphan({ repoRoot: '/a', path: '/a.wt/c', branch: 'agent/c' }),
      orphan({ repoRoot: '/a', path: '/a.wt/b', branch: 'agent/b' }),
    ]);
    assert.deepStrictEqual(
      ordered.map((o) => o.path),
      ['/a.wt/b', '/a.wt/c', '/z.wt/a'],
    );
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
