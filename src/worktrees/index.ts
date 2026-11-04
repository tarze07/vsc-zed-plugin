import type * as vscode from 'vscode';

import type { SessionManager } from '../agents/types';

/** Worktrees: `git worktree` management for isolated agent sessions (#9). */
export function register(_context: vscode.ExtensionContext, _sessions: SessionManager): void {
  // Implemented in #9.
}
