import type * as vscode from 'vscode';

import type { OrphanTracker, SessionHistory, SessionManager } from '../agents/types';
import { createAgentsView } from './agentsView';

export { AGENTS_VIEW_ID, AgentsTreeDataProvider, createTreeItem } from './agentsView';

/** Views: the Agents tree view (#7) with detached sessions and orphaned worktrees (#16). */
export function register(
  context: vscode.ExtensionContext,
  sessions: SessionManager,
  history: SessionHistory,
  orphans: OrphanTracker,
): void {
  context.subscriptions.push(createAgentsView(sessions, history, orphans));
}
