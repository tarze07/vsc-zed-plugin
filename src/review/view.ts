import * as vscode from 'vscode';

import type { AgentSession, SessionManager } from '../agents/types';
import { workingUri } from './content';
import { describeFileNode, describeSessionNode, viewDescription } from './reviewModel';
import type { ReviewFile, ReviewService, ReviewTarget } from './types';

export const AGENT_CHANGES_VIEW_ID = 'zedLayout.agentChangesView';
export const OPEN_FILE_COMMAND = 'zedLayout.review.openFile';

/** Debounce for file-system driven refreshes. */
const WATCH_DEBOUNCE_MS = 1500;

export interface SessionNode {
  readonly type: 'session';
  readonly session: AgentSession;
  readonly target: ReviewTarget;
  readonly files: readonly ReviewFile[];
  readonly children: readonly FileNode[];
  /** Error from `listChanges` (git stderr), if any. */
  readonly error?: string;
}

export interface FileNode {
  readonly type: 'file';
  readonly parent: SessionNode;
  readonly file: ReviewFile;
}

export type ReviewNode = SessionNode | FileNode;

export function isSessionNode(value: unknown): value is SessionNode {
  return typeof value === 'object' && value !== null && (value as SessionNode).type === 'session';
}

export function isFileNode(value: unknown): value is FileNode {
  return typeof value === 'object' && value !== null && (value as FileNode).type === 'file';
}

function errorText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string' && detail) {
      return detail;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sessions (resolved to a git `ReviewTarget`) with their changed files.
 * Targets and changes are cached per refresh generation; `refresh()` invalidates the cache.
 */
export class AgentChangesTreeDataProvider
  implements vscode.TreeDataProvider<ReviewNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<ReviewNode | undefined | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly loadEmitter = new vscode.EventEmitter<readonly SessionNode[]>();
  /** Fires after each (re)load with the current session nodes. */
  readonly onDidLoad = this.loadEmitter.event;

  private generation = 0;
  private signature: string;
  private loading?: { generation: number; promise: Promise<SessionNode[]> };
  private roots: SessionNode[] = [];
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly sessions: SessionManager,
    private readonly service: ReviewService,
  ) {
    this.signature = sessionsSignature(sessions.getSessions());
    this.subscription = sessions.onDidChangeSessions(() => this.onSessionsChanged());
  }

  /**
   * Status changes fire `onDidChangeSessions` often: only reload git data when sessions were
   * added/removed or moved; a rename just re-renders the cached nodes.
   */
  private onSessionsChanged(): void {
    const signature = sessionsSignature(this.sessions.getSessions());
    if (signature !== this.signature) {
      this.signature = signature;
      this.refresh();
    } else {
      this.changeEmitter.fire();
    }
  }

  /** Invalidates cached targets/changes and re-renders the tree. */
  refresh(): void {
    this.generation++;
    this.changeEmitter.fire();
  }

  /** Session nodes of the latest completed load (may be stale while a refresh is running). */
  get current(): readonly SessionNode[] {
    return this.roots;
  }

  /** Loads (or reuses the in-flight / cached load of) the session nodes. */
  getSessionNodes(): Promise<SessionNode[]> {
    if (!this.loading || this.loading.generation !== this.generation) {
      const generation = this.generation;
      const promise = this.load().then((nodes) => {
        if (generation === this.generation) {
          this.roots = nodes;
          this.loadEmitter.fire(nodes);
        }
        return nodes;
      });
      this.loading = { generation, promise };
    }
    return this.loading.promise;
  }

  async findSessionNode(sessionId: string): Promise<SessionNode | undefined> {
    return (await this.getSessionNodes()).find((n) => n.session.id === sessionId);
  }

  async getChildren(element?: ReviewNode): Promise<ReviewNode[]> {
    if (!element) {
      return this.getSessionNodes();
    }
    return element.type === 'session' ? [...element.children] : [];
  }

  getParent(element: ReviewNode): ReviewNode | undefined {
    return element.type === 'file' ? element.parent : undefined;
  }

  getTreeItem(element: ReviewNode): vscode.TreeItem {
    return element.type === 'session' ? sessionTreeItem(element) : fileTreeItem(element);
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
    this.loadEmitter.dispose();
  }

  private async load(): Promise<SessionNode[]> {
    const sessions = [...this.sessions.getSessions()].sort((a, b) => a.createdAt - b.createdAt);
    const nodes = await Promise.all(sessions.map((s) => this.loadSession(s)));
    return nodes.filter((n): n is SessionNode => n !== undefined);
  }

  private async loadSession(session: AgentSession): Promise<SessionNode | undefined> {
    let target: ReviewTarget | undefined;
    try {
      target = await this.service.resolveTarget({
        cwd: sessionCwd(session),
        worktree: session.worktree,
      });
    } catch {
      target = undefined;
    }
    if (!target) {
      return undefined;
    }
    let files: ReviewFile[] = [];
    let error: string | undefined;
    try {
      files = await this.service.listChanges(target);
    } catch (e) {
      error = errorText(e);
    }
    const children: FileNode[] = [];
    const node: SessionNode = { type: 'session', session, target, files, children, error };
    for (const file of files) {
      children.push({ type: 'file', parent: node, file });
    }
    return node;
  }
}

function sessionsSignature(sessions: readonly AgentSession[]): string {
  return JSON.stringify(
    sessions.map((s) => [s.id, s.cwd ?? '', s.worktree?.path ?? '', s.worktree?.baseRef ?? '']),
  );
}

/** Working directory of a session: its cwd, worktree, or the first workspace folder. */
export function sessionCwd(session: AgentSession): string | undefined {
  return (
    session.cwd ??
    session.worktree?.path ??
    vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === 'file')?.uri.fsPath
  );
}

function themeIcon(id: string, color?: string): vscode.ThemeIcon {
  return color ? new vscode.ThemeIcon(id, new vscode.ThemeColor(color)) : new vscode.ThemeIcon(id);
}

export function sessionTreeItem(node: SessionNode): vscode.TreeItem {
  const d = describeSessionNode({
    sessionId: node.session.id,
    name: node.session.name,
    baseLabel: node.target.baseLabel,
    root: node.target.root,
    fileCount: node.files.length,
    branch: node.target.worktree?.branch ?? node.session.worktree?.branch,
    agentIcon: node.session.agent.icon,
    agentColor: node.session.agent.color,
    error: node.error,
  });
  const item = new vscode.TreeItem(
    d.label,
    d.collapsible === 'expanded'
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None,
  );
  item.id = d.id;
  item.description = d.description;
  item.tooltip = new vscode.MarkdownString(d.tooltip);
  item.iconPath = themeIcon(d.icon.id, d.icon.color);
  item.contextValue = d.contextValue;
  return item;
}

export function fileTreeItem(node: FileNode): vscode.TreeItem {
  const d = describeFileNode(node.parent.session.id, node.file);
  const item = new vscode.TreeItem(d.label, vscode.TreeItemCollapsibleState.None);
  item.id = d.id;
  item.description = d.description;
  item.tooltip = d.tooltip;
  item.iconPath = themeIcon(d.icon.id, d.icon.color);
  item.contextValue = d.contextValue;
  item.resourceUri = workingUri(node.parent.target, node.file);
  item.command = { command: OPEN_FILE_COMMAND, title: 'Open Change', arguments: [node] };
  return item;
}

export interface AgentChangesView extends vscode.Disposable {
  readonly provider: AgentChangesTreeDataProvider;
  readonly view: vscode.TreeView<ReviewNode>;
}

/**
 * Creates the `zedLayout.agentChangesView` tree view: multi-select, description with the total
 * number of changed files, and debounced file-system watchers on every session root.
 */
export function createAgentChangesView(
  sessions: SessionManager,
  service: ReviewService,
): AgentChangesView {
  const provider = new AgentChangesTreeDataProvider(sessions, service);
  const view = vscode.window.createTreeView(AGENT_CHANGES_VIEW_ID, {
    treeDataProvider: provider,
    canSelectMany: true,
    showCollapseAll: true,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = (uri: vscode.Uri): void => {
    // Ignore git metadata: listing changes itself touches `.git/index` (would loop).
    if (/[\\/]\.git([\\/]|$)/.test(uri.fsPath)) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      provider.refresh();
    }, WATCH_DEBOUNCE_MS);
  };

  const watchers = new Map<string, vscode.Disposable>();
  const syncWatchers = (nodes: readonly SessionNode[]): void => {
    const roots = new Set(nodes.map((n) => n.target.root));
    for (const [root, watcher] of watchers) {
      if (!roots.has(root)) {
        watcher.dispose();
        watchers.delete(root);
      }
    }
    for (const root of roots) {
      if (watchers.has(root)) {
        continue;
      }
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(root), '**/*'),
      );
      watchers.set(
        root,
        vscode.Disposable.from(
          watcher,
          watcher.onDidCreate(scheduleRefresh),
          watcher.onDidChange(scheduleRefresh),
          watcher.onDidDelete(scheduleRefresh),
        ),
      );
    }
  };

  const onLoad = provider.onDidLoad((nodes) => {
    const total = nodes.reduce((sum, n) => sum + n.files.length, 0);
    view.description = viewDescription(total);
    syncWatchers(nodes);
  });

  // Keep watchers in sync with the session roots even while the view is hidden.
  const onSessions = sessions.onDidChangeSessions(() => void provider.getSessionNodes());
  // Load once so watchers and the description exist before the view is first shown.
  void provider.getSessionNodes();

  const disposable = vscode.Disposable.from(provider, view, onLoad, onSessions, {
    dispose: () => {
      if (timer) {
        clearTimeout(timer);
      }
      for (const watcher of watchers.values()) {
        watcher.dispose();
      }
      watchers.clear();
    },
  });

  return {
    provider,
    view,
    dispose: () => disposable.dispose(),
  };
}
