import * as vscode from 'vscode';

import type { SessionManager } from './types';

/** Implemented in #6. Temporary no-op stub so the extension keeps activating. */
export function createSessionManager(_context: vscode.ExtensionContext): SessionManager {
  const emitter = new vscode.EventEmitter<void>();
  return {
    onDidChangeSessions: emitter.event,
    getSessions: () => [],
    getSession: () => undefined,
    findByTerminal: () => undefined,
    getAgents: () => [],
    pickAgent: () => Promise.resolve(undefined),
    startSession: () => Promise.resolve(undefined),
    focus: () => undefined,
    rename: () => undefined,
    stop: () => undefined,
    restart: () => Promise.resolve(undefined),
    setStatus: () => undefined,
    dispose: () => emitter.dispose(),
  };
}
