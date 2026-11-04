import * as assert from 'assert';
import * as vscode from 'vscode';

import { createSessionManager, sessionIdFromArg } from '../agents/sessionManager';
import type { SessionManager } from '../agents/types';

const EXTENSION_ID = 'tarze07.vsc-zed-plugin';
const AGENT_ID = 'zed-test-agent';

/** An executable that exists on every CI machine. */
const testAgent =
  process.platform === 'win32'
    ? { id: AGENT_ID, label: 'Test Agent', command: 'cmd', args: ['/c', 'echo', 'ok'] }
    : { id: AGENT_ID, label: 'Test Agent', command: 'sh', args: ['-c', 'sleep 1'] };

function waitFor(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (predicate()) {
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error('Timed out waiting for condition'));
      } else {
        setTimeout(tick, 50);
      }
    };
    tick();
  });
}

suite('Session manager', function () {
  this.timeout(60000);

  let manager: SessionManager;
  let previousAgents: unknown;
  let previousLocation: unknown;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();

    const config = vscode.workspace.getConfiguration('zedLayout');
    previousAgents = config.inspect('agents')?.globalValue;
    previousLocation = config.inspect('agentSessionLocation')?.globalValue;
    await config.update(
      'agents',
      [
        testAgent,
        { id: 'zed-missing', label: 'Missing', command: 'zed-layout-no-such-binary-4f2a' },
      ],
      vscode.ConfigurationTarget.Global,
    );
    await config.update('agentSessionLocation', 'panel', vscode.ConfigurationTarget.Global);

    // A separate manager instance; the extension's own instance owns the commands.
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    manager = createSessionManager(context, { registerCommands: false });
  });

  suiteTeardown(async () => {
    for (const session of manager.getSessions()) {
      manager.stop(session.id);
    }
    manager.dispose();
    const config = vscode.workspace.getConfiguration('zedLayout');
    await config.update('agents', previousAgents, vscode.ConfigurationTarget.Global);
    await config.update(
      'agentSessionLocation',
      previousLocation,
      vscode.ConfigurationTarget.Global,
    );
  });

  test('registers the agent commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'zedLayout.agents.newSession',
      'zedLayout.agents.focus',
      'zedLayout.agents.rename',
      'zedLayout.agents.stop',
      'zedLayout.agents.restart',
      'zedLayout.agents.next',
      'zedLayout.agents.previous',
    ]) {
      assert.ok(commands.includes(id), `${id} is not registered`);
    }
  });

  test('reads agents from configuration', () => {
    assert.deepStrictEqual(
      manager.getAgents().map((a) => a.id),
      [AGENT_ID, 'zed-missing'],
    );
  });

  test('sessionIdFromArg accepts sessions, ids and tree items', () => {
    assert.strictEqual(sessionIdFromArg('abc'), 'abc');
    assert.strictEqual(sessionIdFromArg({ id: 'abc' }), 'abc');
    assert.strictEqual(sessionIdFromArg({ id: 'item', session: { id: 'abc' } }), 'abc');
    assert.strictEqual(sessionIdFromArg(undefined), undefined);
    assert.strictEqual(sessionIdFromArg(42), undefined);
  });

  test('returns undefined for a missing executable or unknown agent', async () => {
    assert.strictEqual(await manager.startSession({ agentId: 'zed-missing' }), undefined);
    assert.strictEqual(await manager.startSession({ agentId: 'nope' }), undefined);
    assert.strictEqual(manager.getSessions().length, 0);
  });

  test('starts, renames, updates status and stops a session', async () => {
    let changes = 0;
    const sub = manager.onDidChangeSessions(() => changes++);
    try {
      const session = await manager.startSession({ agentId: AGENT_ID });
      assert.ok(session, 'session was not created');
      assert.strictEqual(session.name, 'Test Agent');
      assert.strictEqual(session.status, 'starting');
      assert.strictEqual(manager.getSession(session.id), session);
      assert.strictEqual(manager.findByTerminal(session.terminal), session);
      assert.ok(changes >= 1);

      const second = await manager.startSession({ agentId: AGENT_ID });
      assert.ok(second);
      assert.strictEqual(second.name, 'Test Agent 2');
      assert.deepStrictEqual(
        manager.getSessions().map((s) => s.id),
        [session.id, second.id],
      );

      const before = changes;
      manager.setStatus(session.id, 'running', { needsAttention: true });
      assert.strictEqual(session.status, 'running');
      assert.strictEqual(session.needsAttention, true);
      assert.strictEqual(changes, before + 1);
      manager.setStatus(session.id, 'running', { needsAttention: true });
      assert.strictEqual(changes, before + 1, 'no change event without a change');
      manager.setStatus('unknown', 'exited');

      manager.focus(session.id);
      assert.strictEqual(session.needsAttention, false);

      manager.rename(session.id, 'Renamed');
      assert.strictEqual(manager.getSession(session.id)?.name, 'Renamed');

      manager.stop(session.id);
      assert.strictEqual(manager.getSession(session.id), undefined);

      const restarted = await manager.restart(second.id);
      assert.ok(restarted);
      assert.notStrictEqual(restarted.id, second.id);
      assert.strictEqual(restarted.name, 'Test Agent 2');
      assert.strictEqual(manager.getSession(second.id), undefined);

      // Closing the terminal from outside removes the session too.
      restarted.terminal.dispose();
      await waitFor(() => manager.getSessions().length === 0);
    } finally {
      sub.dispose();
    }
  });
});
