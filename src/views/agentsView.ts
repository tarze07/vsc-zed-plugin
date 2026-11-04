import * as vscode from 'vscode';

import type { AgentSession, SessionManager } from '../agents/types';
import {
  badgeCount,
  badgeTooltip,
  describeSession,
  NO_AGENTS_MESSAGE,
  orderSessions,
  viewDescription,
} from './agentsTreeModel';

export const AGENTS_VIEW_ID = 'zedLayout.agentsView';
export const FOCUS_COMMAND = 'zedLayout.agents.focus';

/** Flat list of agent sessions in creation order; refreshes on `onDidChangeSessions`. */
export class AgentsTreeDataProvider
  implements vscode.TreeDataProvider<AgentSession>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<AgentSession | undefined | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly sessions: SessionManager) {
    this.subscription = sessions.onDidChangeSessions(() => this.refresh());
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  getChildren(element?: AgentSession): AgentSession[] {
    if (element) {
      return [];
    }
    return orderSessions(this.sessions.getSessions());
  }

  getParent(): undefined {
    // Flat list: every session is a root element (needed for `TreeView.reveal`).
    return undefined;
  }

  getTreeItem(session: AgentSession): vscode.TreeItem {
    return createTreeItem(session);
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}

export function createTreeItem(session: AgentSession): vscode.TreeItem {
  const descriptor = describeSession(session);
  const item = new vscode.TreeItem(descriptor.label, vscode.TreeItemCollapsibleState.None);
  item.id = descriptor.id;
  item.description = descriptor.description;
  item.tooltip = new vscode.MarkdownString(descriptor.tooltip);
  item.iconPath = descriptor.icon.color
    ? new vscode.ThemeIcon(descriptor.icon.id, new vscode.ThemeColor(descriptor.icon.color))
    : new vscode.ThemeIcon(descriptor.icon.id);
  item.contextValue = descriptor.contextValue;
  item.command = {
    command: FOCUS_COMMAND,
    title: 'Focus Agent Session',
    arguments: [session],
  };
  return item;
}

/** Creates the `zedLayout.agentsView` tree view with badge, description and selection sync. */
export function createAgentsView(sessions: SessionManager): vscode.Disposable {
  const provider = new AgentsTreeDataProvider(sessions);
  const view = vscode.window.createTreeView(AGENTS_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  const updateViewState = (): void => {
    const all = sessions.getSessions();
    const count = badgeCount(all);
    view.badge = count > 0 ? { value: count, tooltip: badgeTooltip(count) } : undefined;
    view.description = viewDescription(all.length);
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
    vscode.window.onDidChangeActiveTerminal((terminal) => revealTerminal(terminal)),
    view.onDidChangeVisibility((event) => {
      if (event.visible) {
        revealTerminal(vscode.window.activeTerminal);
      }
    }),
  );
}
