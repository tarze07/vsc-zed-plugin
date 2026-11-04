import * as assert from 'assert';
import * as vscode from 'vscode';

import type { AgentDefinition, AgentSession, SessionManager, WorktreeInfo } from '../agents/types';
import { ReviewCommands, type ReviewUi } from '../review/commands';
import type { MergeResult, ReviewFile, ReviewService, ReviewTarget } from '../review/types';
import { AgentChangesTreeDataProvider, type FileNode, type SessionNode } from '../review/view';

const CLAUDE: AgentDefinition = {
  id: 'claude',
  label: 'Claude Code',
  command: 'claude',
  icon: 'sparkle',
  color: 'terminal.ansiMagenta',
};

const WORKTREE: WorktreeInfo = {
  path: '/repo.worktrees/wt',
  branch: 'agent/claude-wt',
  baseRef: 'main',
  repoRoot: '/repo',
};

function fakeSession(
  id: string,
  createdAt: number,
  cwd: string,
  worktree?: WorktreeInfo,
): AgentSession {
  return {
    id,
    agent: CLAUDE,
    name: `Session ${id}`,
    terminal: { name: `Session ${id}` } as unknown as vscode.Terminal,
    cwd,
    worktree,
    status: 'running',
    needsAttention: false,
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

/** In-memory service: changes per cwd; `/outside` is not a git repository. */
class FakeReviewService implements ReviewService {
  changes = new Map<string, ReviewFile[]>();
  calls: { method: string; cwd: string; paths: string[]; message?: string }[] = [];
  resolveCount = 0;

  resolveTarget(input: {
    cwd?: string;
    worktree?: WorktreeInfo;
  }): Promise<ReviewTarget | undefined> {
    this.resolveCount++;
    if (!input.cwd || input.cwd.startsWith('/outside')) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({
      cwd: input.cwd,
      root: input.cwd,
      baseCommit: 'abc123',
      baseLabel: input.worktree ? input.worktree.baseRef : 'HEAD',
      worktree: input.worktree,
    });
  }
  listChanges(target: ReviewTarget): Promise<ReviewFile[]> {
    return Promise.resolve([...(this.changes.get(target.cwd) ?? [])]);
  }
  baseContent(): Promise<string | undefined> {
    return Promise.resolve('base');
  }
  accept(target: ReviewTarget, files: readonly ReviewFile[]): Promise<void> {
    this.calls.push({ method: 'accept', cwd: target.cwd, paths: files.map((f) => f.path) });
    return Promise.resolve();
  }
  reject(target: ReviewTarget, files: readonly ReviewFile[]): Promise<void> {
    this.calls.push({ method: 'reject', cwd: target.cwd, paths: files.map((f) => f.path) });
    const remaining = (this.changes.get(target.cwd) ?? []).filter(
      (c) => !files.some((f) => f.path === c.path),
    );
    this.changes.set(target.cwd, remaining);
    return Promise.resolve();
  }
  commitAll(target: ReviewTarget, message: string): Promise<void> {
    this.calls.push({ method: 'commitAll', cwd: target.cwd, paths: [], message });
    return Promise.resolve();
  }
  mergeIntoBase(): Promise<MergeResult> {
    return Promise.resolve({ merged: true, message: 'merged' });
  }
}

class FakeUi implements ReviewUi {
  confirmAnswer = true;
  confirms: string[] = [];
  errors: string[] = [];
  infos: string[] = [];
  action: 'stage' | 'commit' | undefined = 'stage';

  confirm(message: string): Promise<boolean> {
    this.confirms.push(message);
    return Promise.resolve(this.confirmAnswer);
  }
  pickAcceptAction(): Promise<'stage' | 'commit' | undefined> {
    return Promise.resolve(this.action);
  }
  commitMessage(defaultMessage: string): Promise<string | undefined> {
    return Promise.resolve(defaultMessage);
  }
  info(message: string): void {
    this.infos.push(message);
  }
  warn(message: string): void {
    this.infos.push(message);
  }
  error(message: string): void {
    this.errors.push(message);
  }
}

suite('Agent Changes view (integration)', () => {
  let manager: FakeSessionManager;
  let service: FakeReviewService;
  let provider: AgentChangesTreeDataProvider;
  let ui: FakeUi;
  let commands: ReviewCommands;

  setup(() => {
    manager = new FakeSessionManager();
    service = new FakeReviewService();
    provider = new AgentChangesTreeDataProvider(manager, service);
    ui = new FakeUi();
    commands = new ReviewCommands({
      sessions: manager,
      service,
      provider,
      ui,
      acceptAllAction: () => 'ask',
    });
    manager.sessions = [
      fakeSession('wt', 2, WORKTREE.path, WORKTREE),
      fakeSession('plain', 1, '/repo'),
      fakeSession('outside', 3, '/outside/dir'),
    ];
    service.changes.set(WORKTREE.path, [
      { path: 'src/a.ts', kind: 'M' },
      { path: 'new.ts', kind: 'A' },
      { path: 'src/gone.ts', kind: 'D' },
    ]);
    manager.fire();
  });

  teardown(() => {
    provider.dispose();
    manager.dispose();
  });

  async function roots(): Promise<SessionNode[]> {
    return (await provider.getChildren()) as SessionNode[];
  }

  test('roots are sessions inside git repositories, children are changes', async () => {
    const nodes = await roots();
    assert.deepStrictEqual(
      nodes.map((n) => n.session.id),
      ['plain', 'wt'],
    );

    const plain = provider.getTreeItem(nodes[0]);
    assert.strictEqual(plain.contextValue, 'reviewSession');
    assert.strictEqual(plain.description, 'no changes');
    assert.strictEqual(plain.collapsibleState, vscode.TreeItemCollapsibleState.None);

    const wt = provider.getTreeItem(nodes[1]);
    assert.strictEqual(wt.label, 'Session wt');
    assert.strictEqual(wt.contextValue, 'reviewSession.worktree');
    assert.strictEqual(wt.description, '3 files · vs main');
    assert.strictEqual(wt.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);

    const children = (await provider.getChildren(nodes[1])) as FileNode[];
    assert.deepStrictEqual(
      children.map((c) => c.file.path),
      ['src/a.ts', 'new.ts', 'src/gone.ts'],
    );
    assert.strictEqual(provider.getParent(children[0]), nodes[1]);
    const item = provider.getTreeItem(children[0]);
    assert.strictEqual(item.label, 'a.ts');
    assert.strictEqual(item.description, 'src');
    assert.strictEqual(item.contextValue, 'reviewFile.modified');
    assert.strictEqual(item.command?.command, 'zedLayout.review.openFile');
    assert.strictEqual(item.command?.arguments?.[0], children[0]);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'diff-modified');
    assert.strictEqual(
      item.resourceUri?.fsPath,
      vscode.Uri.file('/repo.worktrees/wt/src/a.ts').fsPath,
    );
    assert.strictEqual(
      (provider.getTreeItem(children[2]).iconPath as vscode.ThemeIcon).id,
      'diff-removed',
    );
  });

  test('targets are cached until refresh; status-only changes do not reload', async () => {
    await roots();
    const count = service.resolveCount;
    await roots();
    manager.fire(); // same sessions → no reload
    await roots();
    assert.strictEqual(service.resolveCount, count);
    provider.refresh();
    await roots();
    assert.ok(service.resolveCount > count);
  });

  test('accept handles multi-selection grouped by session', async () => {
    const wt = (await roots())[1];
    const [a, added] = wt.children;
    await commands.accept(a, [a, added]);
    assert.deepStrictEqual(service.calls, [
      { method: 'accept', cwd: WORKTREE.path, paths: ['src/a.ts', 'new.ts'] },
    ]);

    service.calls = [];
    // Clicked node not part of the selection → only the clicked node.
    await commands.accept(wt.children[2], [a]);
    assert.deepStrictEqual(service.calls[0].paths, ['src/gone.ts']);
  });

  test('reject asks for confirmation and refreshes', async () => {
    let wt = (await roots())[1];
    ui.confirmAnswer = false;
    await commands.reject(wt.children[0]);
    assert.deepStrictEqual(ui.confirms, ['Discard changes to src/a.ts?']);
    assert.strictEqual(service.calls.length, 0);

    ui.confirmAnswer = true;
    await commands.reject(wt.children[0]);
    assert.deepStrictEqual(service.calls, [
      { method: 'reject', cwd: WORKTREE.path, paths: ['src/a.ts'] },
    ]);
    wt = (await roots())[1];
    assert.deepStrictEqual(
      wt.files.map((f) => f.path),
      ['new.ts', 'src/gone.ts'],
    );
  });

  test('acceptAll stages or commits; rejectAll discards everything', async () => {
    let wt = (await roots())[1];
    ui.action = 'stage';
    await commands.acceptAll(wt);
    assert.deepStrictEqual(service.calls[0], {
      method: 'accept',
      cwd: WORKTREE.path,
      paths: ['src/a.ts', 'new.ts', 'src/gone.ts'],
    });

    ui.action = 'commit';
    await commands.acceptAll('wt');
    assert.deepStrictEqual(service.calls[1], {
      method: 'commitAll',
      cwd: WORKTREE.path,
      paths: [],
      message: 'Accept changes from Session wt',
    });

    wt = (await roots())[1];
    await commands.rejectAll({ session: wt.session });
    assert.match(ui.confirms[0], /Discard all 3 files/);
    assert.strictEqual(service.calls[2].method, 'reject');
    assert.strictEqual(service.calls[2].paths.length, 3);
  });

  test('session outside a git repository reports an error', async () => {
    await commands.acceptAll('outside');
    assert.strictEqual(service.calls.length, 0);
    assert.match(ui.errors[0], /not inside a git repository/);
  });
});
