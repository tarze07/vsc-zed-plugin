import * as assert from 'assert';
import * as vscode from 'vscode';

import type {
  AgentDefinition,
  AgentSession,
  OrphanedWorktree,
  OrphanTracker,
  SessionHistory,
  SessionManager,
  SessionRecord,
  SessionStatus,
  WorktreeInfo,
} from '../agents/types';
import {
  AgentsTreeDataProvider,
  type AgentsGroupElement,
  type AgentsTreeElement,
} from '../views/agentsView';

function ids(elements: readonly AgentsTreeElement[]): (string | undefined)[] {
  return elements.map((e) => ('id' in e ? e.id : 'path' in e ? e.path : undefined));
}

const CLAUDE: AgentDefinition = {
  id: 'claude',
  label: 'Claude Code',
  command: 'claude',
  icon: 'sparkle',
  color: 'terminal.ansiMagenta',
};

function fakeSession(
  id: string,
  createdAt: number,
  status: SessionStatus = 'running',
  worktree?: WorktreeInfo,
): AgentSession {
  return {
    id,
    agent: CLAUDE,
    name: `Session ${id}`,
    terminal: { name: `Session ${id}` } as unknown as vscode.Terminal,
    status,
    needsAttention: status === 'waiting',
    worktree,
    createdAt,
  };
}

class FakeHistory implements SessionHistory {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  detached: SessionRecord[] = [];

  fire(): void {
    this.emitter.fire();
  }
  getDetached(): readonly SessionRecord[] {
    return this.detached;
  }
  findByWorktreePath(): SessionRecord | undefined {
    return undefined;
  }
  resume(): Promise<AgentSession | undefined> {
    return Promise.resolve(undefined);
  }
  forget(): void {}
  dispose(): void {
    this.emitter.dispose();
  }
}

class FakeOrphans implements OrphanTracker {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  orphans: OrphanedWorktree[] = [];

  fire(): void {
    this.emitter.fire();
  }
  getOrphans(): readonly OrphanedWorktree[] {
    return this.orphans;
  }
  refresh(): Promise<void> {
    return Promise.resolve();
  }
  dispose(): void {
    this.emitter.dispose();
  }
}

function record(id: string, createdAt: number, worktree?: WorktreeInfo): SessionRecord {
  return {
    id,
    agentId: 'claude',
    agentLabel: 'Claude Code',
    name: `Old ${id}`,
    worktree,
    location: 'editor',
    createdAt,
    terminalName: `Old ${id}`,
  };
}

function orphan(name: string, extra: Partial<OrphanedWorktree> = {}): OrphanedWorktree {
  return {
    path: `/repo.worktrees/${name}`,
    branch: `agent/${name}`,
    head: '0123456789abcdef',
    repoRoot: '/repo',
    baseRef: 'main',
    ...extra,
  };
}

class FakeSessionManager implements SessionManager {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeSessions = this.emitter.event;
  sessions: AgentSession[] = [];

  fire(): void {
    this.emitter.fire();
  }
  getSessions(): readonly AgentSession[] {
    return this.sessions;
  }
  getSession(id: string): AgentSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }
  findByTerminal(terminal: vscode.Terminal): AgentSession | undefined {
    return this.sessions.find((s) => s.terminal === terminal);
  }
  getAgents(): readonly AgentDefinition[] {
    return [CLAUDE];
  }
  pickAgent(): Promise<AgentDefinition | undefined> {
    return Promise.resolve(CLAUDE);
  }
  startSession(): Promise<AgentSession | undefined> {
    return Promise.resolve(undefined);
  }
  focus(): void {}
  rename(): void {}
  stop(): void {}
  restart(): Promise<AgentSession | undefined> {
    return Promise.resolve(undefined);
  }
  setStatus(): void {}
  dispose(): void {
    this.emitter.dispose();
  }
}

suite('Agents view (integration)', () => {
  let manager: FakeSessionManager;
  let history: FakeHistory;
  let orphans: FakeOrphans;
  let provider: AgentsTreeDataProvider;

  setup(() => {
    manager = new FakeSessionManager();
    history = new FakeHistory();
    orphans = new FakeOrphans();
    provider = new AgentsTreeDataProvider(manager, history, orphans, {
      getBranchPrefix: () => 'agent/',
    });
  });

  teardown(() => {
    provider.dispose();
    manager.dispose();
    history.dispose();
    orphans.dispose();
  });

  test('returns sessions in creation order with tree items', () => {
    const worktree: WorktreeInfo = {
      path: '/repo.worktrees/b',
      branch: 'agent/claude-b',
      baseRef: 'main',
      repoRoot: '/repo',
    };
    manager.sessions = [fakeSession('b', 2, 'waiting', worktree), fakeSession('a', 1)];

    const children = provider.getChildren();
    assert.deepStrictEqual(ids(children), ['a', 'b']);

    const first = provider.getTreeItem(children[0]);
    assert.strictEqual(first.id, 'a');
    assert.strictEqual(first.label, 'Session a');
    assert.strictEqual(first.contextValue, 'agentSession.running');
    assert.strictEqual(first.command?.command, 'zedLayout.agents.focus');
    assert.strictEqual(first.command?.arguments?.[0], children[0]);
    assert.ok(first.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((first.iconPath as vscode.ThemeIcon).id, 'sparkle');

    const second = provider.getTreeItem(children[1]);
    assert.strictEqual(second.contextValue, 'agentSession.waiting.worktree');
    assert.match(second.contextValue ?? '', /^agentSession.*\.worktree/);
    assert.strictEqual(second.description, 'Claude Code · waiting · agent/claude-b');
    assert.strictEqual((second.iconPath as vscode.ThemeIcon).id, 'bell-dot');
    assert.deepStrictEqual(provider.getChildren(children[0]), []);
  });

  test('fires onDidChangeTreeData when sessions change', () => {
    let fired = 0;
    const sub = provider.onDidChangeTreeData(() => fired++);
    manager.sessions = [fakeSession('a', 1)];
    manager.fire();
    sub.dispose();
    assert.strictEqual(fired, 1);
    assert.deepStrictEqual(ids(provider.getChildren()), ['a']);
  });

  test('flat list has no parents', () => {
    manager.sessions = [fakeSession('a', 1)];
    const [session] = provider.getChildren();
    assert.strictEqual(provider.getParent(session), undefined);
    assert.strictEqual(provider.isGrouped(), false);
  });

  test('works without history and orphan tracker (flat list)', () => {
    const plain = new AgentsTreeDataProvider(manager);
    manager.sessions = [fakeSession('a', 1)];
    assert.deepStrictEqual(ids(plain.getChildren()), ['a']);
    plain.dispose();
  });

  test('groups sessions, detached records and orphans', () => {
    const worktree: WorktreeInfo = {
      path: '/repo.worktrees/old',
      branch: 'agent/old',
      baseRef: 'main',
      repoRoot: '/repo',
    };
    manager.sessions = [fakeSession('a', 1)];
    history.detached = [record('y', 5, worktree), record('x', 3)];
    orphans.orphans = [orphan('zed'), orphan('abc', { prunable: true, locked: true })];

    const roots = provider.getChildren();
    assert.strictEqual(provider.isGrouped(), true);
    assert.deepStrictEqual(
      roots.map((r) => (r as AgentsGroupElement).group),
      ['sessions', 'detached', 'orphans'],
    );
    const [sessionsGroup, detachedGroup, orphansGroup] = roots;

    const groupItem = provider.getTreeItem(sessionsGroup);
    assert.strictEqual(groupItem.id, 'group:sessions');
    assert.strictEqual(groupItem.label, 'Sessions');
    assert.strictEqual(groupItem.contextValue, 'group.sessions');
    assert.strictEqual(groupItem.description, '1');
    assert.strictEqual(groupItem.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.strictEqual((groupItem.iconPath as vscode.ThemeIcon).id, 'terminal');
    assert.strictEqual(provider.getTreeItem(detachedGroup).contextValue, 'group.detached');
    assert.strictEqual(provider.getTreeItem(detachedGroup).description, '2');
    assert.strictEqual(provider.getTreeItem(orphansGroup).contextValue, 'group.orphans');

    // Live sessions keep their items and click command.
    const sessionChildren = provider.getChildren(sessionsGroup);
    assert.deepStrictEqual(ids(sessionChildren), ['a']);
    const sessionItem = provider.getTreeItem(sessionChildren[0]);
    assert.strictEqual(sessionItem.contextValue, 'agentSession.running');
    assert.strictEqual(sessionItem.command?.command, 'zedLayout.agents.focus');
    assert.strictEqual(provider.getParent(sessionChildren[0]), sessionsGroup);
    assert.strictEqual(provider.getParent(manager.sessions[0]), sessionsGroup);

    // Detached records: the record itself is the element (command argument).
    const detachedChildren = provider.getChildren(detachedGroup);
    assert.deepStrictEqual(ids(detachedChildren), ['x', 'y']);
    assert.strictEqual(detachedChildren[1], history.detached[0]);
    const detachedItem = provider.getTreeItem(detachedChildren[1]);
    assert.strictEqual(detachedItem.id, 'detached:y');
    assert.strictEqual(detachedItem.label, 'Old y');
    assert.strictEqual(detachedItem.contextValue, 'detachedSession');
    assert.strictEqual(detachedItem.description, 'Claude Code · not restored · agent/old');
    assert.strictEqual((detachedItem.iconPath as vscode.ThemeIcon).id, 'debug-disconnect');
    assert.strictEqual(detachedItem.command, undefined);
    assert.strictEqual(provider.getParent(detachedChildren[0]), detachedGroup);

    // Orphans: sorted by label, the orphan object itself is the element.
    const orphanChildren = provider.getChildren(orphansGroup);
    assert.deepStrictEqual(ids(orphanChildren), ['/repo.worktrees/abc', '/repo.worktrees/zed']);
    assert.strictEqual(orphanChildren[0], orphans.orphans[1]);
    const orphanItem = provider.getTreeItem(orphanChildren[0]);
    assert.strictEqual(orphanItem.id, 'orphan:/repo.worktrees/abc');
    assert.strictEqual(orphanItem.label, 'abc');
    assert.strictEqual(orphanItem.description, 'orphaned · missing · locked');
    assert.strictEqual(orphanItem.contextValue, 'orphanWorktree.prunable.locked');
    assert.match(orphanItem.contextValue ?? '', /^orphanWorktree/);
    assert.strictEqual((orphanItem.iconPath as vscode.ThemeIcon).id, 'warning');
    assert.strictEqual(provider.getParent(orphanChildren[0]), orphansGroup);
    assert.strictEqual(provider.getParent(orphansGroup), undefined);
    assert.deepStrictEqual(provider.getChildren(orphanChildren[0]), []);
    assert.deepStrictEqual(provider.getChildren(detachedChildren[0]), []);
  });

  test('empty groups: Sessions shows "none", other groups are omitted', () => {
    orphans.orphans = [orphan('a')];
    const roots = provider.getChildren();
    assert.deepStrictEqual(
      roots.map((r) => (r as AgentsGroupElement).group),
      ['sessions', 'orphans'],
    );
    const sessionsItem = provider.getTreeItem(roots[0]);
    assert.strictEqual(sessionsItem.description, 'none');
    assert.strictEqual(sessionsItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.deepStrictEqual(provider.getChildren(roots[0]), []);
  });

  test('orphan group collapses above five entries', () => {
    orphans.orphans = ['a', 'b', 'c', 'd', 'e'].map((n) => orphan(n));
    const expanded = provider.getTreeItem(provider.getChildren()[1]);
    assert.strictEqual(expanded.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    orphans.orphans.push(orphan('f'));
    const collapsed = provider.getTreeItem(provider.getChildren()[1]);
    assert.strictEqual(collapsed.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.strictEqual((collapsed.iconPath as vscode.ThemeIcon).id, 'git-branch');
  });

  test('refreshes on history and orphan changes; switches between flat and grouped', () => {
    manager.sessions = [fakeSession('a', 1)];
    let fired = 0;
    const sub = provider.onDidChangeTreeData(() => fired++);

    history.detached = [record('x', 1)];
    history.fire();
    assert.strictEqual(fired, 1);
    assert.strictEqual(provider.getChildren().length, 2);

    history.detached = [];
    orphans.orphans = [orphan('a')];
    orphans.fire();
    assert.strictEqual(fired, 2);
    assert.deepStrictEqual(
      provider.getChildren().map((r) => (r as AgentsGroupElement).group),
      ['sessions', 'orphans'],
    );

    orphans.orphans = [];
    orphans.fire();
    sub.dispose();
    assert.strictEqual(fired, 3);
    assert.deepStrictEqual(ids(provider.getChildren()), ['a']);
    assert.strictEqual(provider.getParent(manager.sessions[0]), undefined);
  });
});
