import type * as vscode from 'vscode';

import type { SessionManager } from '../agents/types';
import { createAgentsView } from './agentsView';

export { AGENTS_VIEW_ID, AgentsTreeDataProvider, createTreeItem } from './agentsView';

/** Views: the Agents tree view (#7). */
export function register(context: vscode.ExtensionContext, sessions: SessionManager): void {
  context.subscriptions.push(createAgentsView(sessions));
}
