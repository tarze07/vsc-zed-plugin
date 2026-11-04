import type * as vscode from 'vscode';

import type { OrphanTracker, SessionHistory, SessionManager } from '../agents/types';
import { createAgentsView } from './agentsView';

export { AGENTS_VIEW_ID, AgentsTreeDataProvider, createTreeItem } from './agentsView';

/** Views: the Agents tree view (#7). */
export function register(
  context: vscode.ExtensionContext,
  sessions: SessionManager,
  _history: SessionHistory,
  _orphans: OrphanTracker,
): void {
  context.subscriptions.push(createAgentsView(sessions));
}
