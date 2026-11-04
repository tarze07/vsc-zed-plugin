import type * as vscode from 'vscode';

import { createSessionHistory } from './history';
import { createSessionManager } from './sessionManager';
import { registerStatusTracking } from './status';
import type { SessionHistory, SessionManager } from './types';

/**
 * Agents: agent registry (`zedLayout.agents`), terminal session manager (#6), status
 * detection (#8) and session persistence / restore (#16). Returns the shared `SessionManager`
 * used by views (#7), worktrees (#9) and review (#10), plus the `SessionHistory`.
 */
export function register(context: vscode.ExtensionContext): {
  sessions: SessionManager;
  history: SessionHistory;
} {
  const sessions = createSessionManager(context);
  context.subscriptions.push(sessions);
  const history = createSessionHistory(context, sessions);
  context.subscriptions.push(history);
  registerStatusTracking(context, sessions);
  return { sessions, history };
}

export type * from './types';
