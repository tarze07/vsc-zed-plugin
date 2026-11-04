import * as assert from 'assert';
import * as vscode from 'vscode';

import { createStatusTracker, registerStatusTracking } from '../agents/status';
import type { AgentSession, SessionManager, SessionStatus, StatusUpdate } from '../agents/types';

interface SetStatusCall {
  id: string;
  status: SessionStatus;
  update?: StatusUpdate;
}

function createFakeSessions() {
  const emitter = new vscode.EventEmitter<void>();
  const list: AgentSession[] = [];
  const calls: SetStatusCall[] = [];
  const manager: SessionManager = {
    onDidChangeSessions: emitter.event,
    getSessions: () => list,
    getSession: (id) => list.find((s) => s.id === id),
    findByTerminal: (terminal) => list.find((s) => s.terminal === terminal),
    getAgents: () => [],
    pickAgent: () => Promise.resolve(undefined),
    startSession: () => Promise.resolve(undefined),
    focus: () => undefined,
    rename: () => undefined,
    stop: () => undefined,
    restart: () => Promise.resolve(undefined),
    setStatus: (id, status, update) => {
      calls.push({ id, status, update });
      const session = list.find((s) => s.id === id);
      if (session) {
        session.status = status;
        session.needsAttention = update?.needsAttention ?? false;
        session.exitCode = update?.exitCode;
        emitter.fire();
      }
    },
    dispose: () => emitter.dispose(),
  };
  const add = (session: AgentSession) => {
    list.push(session);
    emitter.fire();
  };
  return { manager, calls, add };
}

suite('Status tracking (VS Code)', () => {
  test('registerStatusTracking does not throw and registers a disposable', () => {
    const { manager } = createFakeSessions();
    const context = { subscriptions: [] as vscode.Disposable[] };
    registerStatusTracking(context as unknown as vscode.ExtensionContext, manager);
    assert.strictEqual(context.subscriptions.length, 1);
    context.subscriptions.forEach((d) => d.dispose());
    manager.dispose();
  });

  test('closing a session terminal reports exited without attention', async () => {
    const { manager, calls, add } = createFakeSessions();
    const tracker = createStatusTracker(manager, { fallbackDelayMs: 60_000 });
    const terminal = vscode.window.createTerminal({ name: 'status-test' });
    try {
      add({
        id: 's1',
        agent: { id: 'test', label: 'Test', command: 'true' },
        name: 'status-test',
        terminal,
        status: 'starting',
        needsAttention: false,
        createdAt: Date.now(),
      });
      const closed = new Promise<void>((resolve) => {
        const sub = vscode.window.onDidCloseTerminal((t) => {
          if (t === terminal) {
            sub.dispose();
            // Let the tracker's own listener run.
            setTimeout(resolve, 50);
          }
        });
      });
      terminal.dispose();
      await closed;
      const last = calls.filter((c) => c.id === 's1').pop();
      assert.ok(last, 'setStatus was called');
      assert.strictEqual(last.status, 'exited');
      assert.strictEqual(last.update?.needsAttention, false);
    } finally {
      tracker.dispose();
      manager.dispose();
    }
  });

  test('fallback: no shell execution → running', async () => {
    const { manager, calls, add } = createFakeSessions();
    const tracker = createStatusTracker(manager, { fallbackDelayMs: 10 });
    // A fake terminal object: it never produces shell executions.
    const terminal = { name: 'fake' } as unknown as vscode.Terminal;
    try {
      add({
        id: 's2',
        agent: { id: 'test', label: 'Test', command: 'true' },
        name: 'fake',
        terminal,
        status: 'starting',
        needsAttention: false,
        createdAt: Date.now(),
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepStrictEqual(
        calls.map((c) => [c.id, c.status, c.update?.needsAttention]),
        [['s2', 'running', false]],
      );
    } finally {
      tracker.dispose();
      manager.dispose();
    }
  });
});
