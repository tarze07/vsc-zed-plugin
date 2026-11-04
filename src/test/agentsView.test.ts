import * as assert from 'assert';
import * as vscode from 'vscode';

import type {
  AgentDefinition,
  AgentSession,
  SessionManager,
  SessionStatus,
  WorktreeInfo,
} from '../agents/types';
import { AgentsTreeDataProvider } from '../views/agentsView';

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
  let provider: AgentsTreeDataProvider;

  setup(() => {
    manager = new FakeSessionManager();
    provider = new AgentsTreeDataProvider(manager);
  });

  teardown(() => {
    provider.dispose();
    manager.dispose();
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
    assert.deepStrictEqual(
      children.map((s) => s.id),
      ['a', 'b'],
    );

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
    assert.deepStrictEqual(
      provider.getChildren().map((s) => s.id),
      ['a'],
    );
  });
});
