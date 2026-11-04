import type * as vscode from 'vscode';

import type { SessionManager } from './types';

/** Status detection (#8): observes session terminals and calls `sessions.setStatus(...)`. */
export function registerStatusTracking(
  _context: vscode.ExtensionContext,
  _sessions: SessionManager,
): void {
  // Implemented in #8.
}
