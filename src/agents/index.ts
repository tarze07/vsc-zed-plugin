import type * as vscode from 'vscode';

import { createSessionManager } from './sessionManager';
import { registerStatusTracking } from './status';
import type { SessionManager } from './types';

/**
 * Agents: agent registry (`zedLayout.agents`), terminal session manager (#6) and status
 * detection (#8). Returns the shared `SessionManager` used by views (#7) and worktrees (#9).
 */
export function register(context: vscode.ExtensionContext): SessionManager {
  const sessions = createSessionManager(context);
  context.subscriptions.push(sessions);
  registerStatusTracking(context, sessions);
  return sessions;
}

export type * from './types';
