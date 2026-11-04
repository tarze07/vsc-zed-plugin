import * as vscode from 'vscode';

import type {
  AgentSession,
  OrphanedWorktree,
  OrphanTracker,
  SessionHistory,
  SessionManager,
  SessionRecord,
} from '../agents/types';
import {
  badgeCount,
  badgeTooltip,
  buildAgentsTree,
  DEFAULT_BRANCH_PREFIX,
  describeDetached,
  describeGroup,
  describeOrphan,
  describeSession,
  isGrouped,
  NO_AGENTS_MESSAGE,
  viewDescription,
  type AgentsTreeNode,
  type CollapsedState,
  type GroupKind,
  type SessionIconDescriptor,
  type SessionItemDescriptor,
} from './agentsTreeModel';

export const AGENTS_VIEW_ID = 'zedLayout.agentsView';
export const FOCUS_COMMAND = 'zedLayout.agents.focus';

/** Group node element ("Sessions", "Not restored", "Orphaned worktrees"). */
export interface AgentsGroupElement {
  readonly kind: 'group';
  readonly group: GroupKind;
}

/**
 * Tree elements. Sessions, detached records and orphans are the contract objects themselves, so
 * context-menu commands (`zedLayout.agents.*`, `zedLayout.worktrees.orphan.*`) receive them as
 * their argument.
 */
export type AgentsTreeElement =
  AgentSession | SessionRecord | OrphanedWorktree | AgentsGroupElement;

type Node = AgentsTreeNode<AgentSession, SessionRecord, OrphanedWorktree>;

const EMPTY_HISTORY: SessionHistory = {
  onDidChange: () => new vscode.Disposable(() => undefined),
  getDetached: () => [],
  findByWorktreePath: () => undefined,
  resume: () => Promise.resolve(undefined),
  forget: () => undefined,
};

const EMPTY_ORPHANS: OrphanTracker = {
  onDidChange: () => new vscode.Disposable(() => undefined),
  getOrphans: () => [],
  refresh: () => Promise.resolve(),
};

function readBranchPrefix(): string {
  return vscode.workspace
    .getConfiguration('zedLayout.worktrees')
    .get<string>('branchPrefix', DEFAULT_BRANCH_PREFIX);
}

/** Kind of a tree element (groups carry `kind`; the contract objects are told apart by shape). */
export function elementKind(element: AgentsTreeElement): Node['kind'] {
  if ('kind' in element && element.kind === 'group') {
    return 'group';
  }
  if ('terminal' in element) {
    return 'session';
  }
  if ('terminalName' in element || 'agentLabel' in element) {
    return 'detached';
  }
  return 'orphan';
}

export interface AgentsTreeDataProviderOptions {
  /** `zedLayout.worktrees.branchPrefix`, stripped from orphan labels. Defaults to the setting. */
  getBranchPrefix?: () => string;
}

/**
 * Live sessions in creation order; when there are detached sessions or orphaned worktrees,
 * grouped under "Sessions" / "Not restored" / "Orphaned worktrees". Refreshes on changes of the
 * session manager, the session history and the orphan tracker.
 */
export class AgentsTreeDataProvider
  implements vscode.TreeDataProvider<AgentsTreeElement>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<AgentsTreeElement | undefined | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];
  private readonly groups: Record<GroupKind, AgentsGroupElement> = {
    sessions: { kind: 'group', group: 'sessions' },
    detached: { kind: 'group', group: 'detached' },
    orphans: { kind: 'group', group: 'orphans' },
  };
  private readonly getBranchPrefix: () => string;

  constructor(
    private readonly sessions: SessionManager,
    private readonly history: SessionHistory = EMPTY_HISTORY,
    private readonly orphans: OrphanTracker = EMPTY_ORPHANS,
    options: AgentsTreeDataProviderOptions = {},
  ) {
    this.getBranchPrefix = options.getBranchPrefix ?? readBranchPrefix;
    this.subscriptions = [
      sessions.onDidChangeSessions(() => this.refresh()),
      history.onDidChange(() => this.refresh()),
      orphans.onDidChange(() => this.refresh()),
    ];
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  /** True when the tree currently shows group nodes. */
  isGrouped(): boolean {
    return isGrouped(this.history.getDetached().length, this.orphans.getOrphans().length);
  }

  private buildTree(): Node[] {
    return buildAgentsTree({
      sessions: this.sessions.getSessions(),
      detached: this.history.getDetached(),
      orphans: this.orphans.getOrphans(),
      branchPrefix: this.getBranchPrefix(),
    });
  }

  private toElement(node: Node): AgentsTreeElement {
    switch (node.kind) {
      case 'group':
        return this.groups[node.group];
      case 'session':
        return node.session;
      case 'detached':
        return node.record;
      case 'orphan':
        return node.orphan;
    }
  }

  getChildren(element?: AgentsTreeElement): AgentsTreeElement[] {
    const roots = this.buildTree();
    if (!element) {
      return roots.map((node) => this.toElement(node));
    }
    if (elementKind(element) !== 'group') {
      return [];
    }
    const group = (element as AgentsGroupElement).group;
    const node = roots.find((root) => root.kind === 'group' && root.group === group);
    return node && node.kind === 'group' ? node.children.map((child) => this.toElement(child)) : [];
  }

  getParent(element: AgentsTreeElement): AgentsTreeElement | undefined {
    switch (elementKind(element)) {
      case 'group':
        return undefined;
      case 'session':
        // Needed for `TreeView.reveal`: sessions are roots in the flat list.
        return this.isGrouped() ? this.groups.sessions : undefined;
      case 'detached':
        return this.groups.detached;
      case 'orphan':
        return this.groups.orphans;
    }
  }

  getTreeItem(element: AgentsTreeElement): vscode.TreeItem {
    switch (elementKind(element)) {
      case 'group': {
        const group = (element as AgentsGroupElement).group;
        return createGroupTreeItem(group, this.groupCount(group));
      }
      case 'session':
        return createTreeItem(element as AgentSession);
      case 'detached':
        return createDetachedTreeItem(element as SessionRecord);
      case 'orphan':
        return createOrphanTreeItem(element as OrphanedWorktree, this.getBranchPrefix());
    }
  }

  private groupCount(group: GroupKind): number {
    switch (group) {
      case 'sessions':
        return this.sessions.getSessions().length;
      case 'detached':
        return this.history.getDetached().length;
      case 'orphans':
        return this.orphans.getOrphans().length;
    }
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.changeEmitter.dispose();
  }
}

function themeIcon(icon: SessionIconDescriptor): vscode.ThemeIcon {
  return icon.color
    ? new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.color))
    : new vscode.ThemeIcon(icon.id);
}

function toCollapsibleState(state: CollapsedState): vscode.TreeItemCollapsibleState {
  switch (state) {
    case 'none':
      return vscode.TreeItemCollapsibleState.None;
    case 'expanded':
      return vscode.TreeItemCollapsibleState.Expanded;
    case 'collapsed':
      return vscode.TreeItemCollapsibleState.Collapsed;
  }
}

function itemFromDescriptor(
  descriptor: SessionItemDescriptor,
  state: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
): vscode.TreeItem {
  const item = new vscode.TreeItem(descriptor.label, state);
  item.id = descriptor.id;
  item.description = descriptor.description;
  item.tooltip = new vscode.MarkdownString(descriptor.tooltip);
  item.iconPath = themeIcon(descriptor.icon);
  item.contextValue = descriptor.contextValue;
  return item;
}

export function createTreeItem(session: AgentSession): vscode.TreeItem {
  const item = itemFromDescriptor(describeSession(session));
  item.command = {
    command: FOCUS_COMMAND,
    title: 'Focus Agent Session',
    arguments: [session],
  };
  return item;
}

export function createDetachedTreeItem(record: SessionRecord): vscode.TreeItem {
  return itemFromDescriptor(describeDetached(record));
}

export function createOrphanTreeItem(
  orphan: OrphanedWorktree,
  branchPrefix?: string,
): vscode.TreeItem {
  return itemFromDescriptor(describeOrphan(orphan, branchPrefix));
}

export function createGroupTreeItem(group: GroupKind, count: number): vscode.TreeItem {
  const descriptor = describeGroup(group, count);
  return itemFromDescriptor(descriptor, toCollapsibleState(descriptor.collapsed));
}

/** Creates the `zedLayout.agentsView` tree view with badge, description and selection sync. */
export function createAgentsView(
  sessions: SessionManager,
  history: SessionHistory = EMPTY_HISTORY,
  orphans: OrphanTracker = EMPTY_ORPHANS,
): vscode.Disposable {
  const provider = new AgentsTreeDataProvider(sessions, history, orphans);
  const view = vscode.window.createTreeView(AGENTS_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  const updateViewState = (): void => {
    const all = sessions.getSessions();
    const detachedCount = history.getDetached().length;
    const count = badgeCount(all);
    view.badge =
      count > 0 ? { value: count, tooltip: badgeTooltip(count, detachedCount) } : undefined;
    view.description = viewDescription(all.length, detachedCount, orphans.getOrphans().length);
    view.message = sessions.getAgents().length === 0 ? NO_AGENTS_MESSAGE : undefined;
  };

  const revealTerminal = (terminal: vscode.Terminal | undefined): void => {
    if (!terminal || !view.visible) {
      return;
    }
    const session = sessions.findByTerminal(terminal);
    if (!session) {
      return;
    }
    try {
      view.reveal(session, { select: true, focus: false }).then(undefined, () => undefined);
    } catch {
      // Best effort: the element may already be gone from the tree.
    }
  };

  updateViewState();

  return vscode.Disposable.from(
    provider,
    view,
    sessions.onDidChangeSessions(() => updateViewState()),
    history.onDidChange(() => updateViewState()),
    orphans.onDidChange(() => updateViewState()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('zedLayout.worktrees.branchPrefix')) {
        provider.refresh();
      }
    }),
    vscode.window.onDidChangeActiveTerminal((terminal) => revealTerminal(terminal)),
    view.onDidChangeVisibility((event) => {
      if (event.visible) {
        revealTerminal(vscode.window.activeTerminal);
      }
    }),
  );
}
