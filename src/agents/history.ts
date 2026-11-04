import * as vscode from 'vscode';

import type { SessionHistory, SessionManager } from './types';

/** Persistence, adoption of restored terminals and detached sessions (#16). Temporary stub. */
export function createSessionHistory(
  _context: vscode.ExtensionContext,
  _sessions: SessionManager,
): SessionHistory & vscode.Disposable {
  const emitter = new vscode.EventEmitter<void>();
  return {
    onDidChange: emitter.event,
    getDetached: () => [],
    findByWorktreePath: () => undefined,
    resume: () => Promise.resolve(undefined),
    forget: () => undefined,
    dispose: () => emitter.dispose(),
  };
}
