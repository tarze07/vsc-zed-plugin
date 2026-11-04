import * as vscode from 'vscode';

import type { OrphanTracker, SessionHistory, SessionManager } from '../agents/types';

/** Orphaned agent worktrees (#16). Temporary stub. */
export function createOrphanTracker(
  _context: vscode.ExtensionContext,
  _sessions: SessionManager,
  _history: SessionHistory,
): OrphanTracker & vscode.Disposable {
  const emitter = new vscode.EventEmitter<void>();
  return {
    onDidChange: emitter.event,
    getOrphans: () => [],
    refresh: () => Promise.resolve(),
    dispose: () => emitter.dispose(),
  };
}
