import * as assert from 'assert';
import * as os from 'os';
import * as vscode from 'vscode';

import { createSessionHistory, recordIdFromArg } from '../agents/history';
import { createSessionManager } from '../agents/sessionManager';
import {
  SESSIONS_SCHEMA_VERSION,
  SESSIONS_STATE_KEY,
  SESSION_ID_ENV,
  deserializeSessions,
} from '../agents/sessionStore';
import type { SessionRecord } from '../agents/types';

const EXTENSION_ID = 'tarze07.vsc-zed-plugin';
const AGENT_ID = 'zed-history-test-agent';

const testAgent =
  process.platform === 'win32'
    ? { id: AGENT_ID, label: 'History Agent', command: 'cmd', args: ['/c', 'echo', 'ok'] }
    : { id: AGENT_ID, label: 'History Agent', command: 'sh', args: ['-c', 'sleep 1'] };

class FakeMemento implements vscode.Memento {
  private readonly data = new Map<string, unknown>();
  keys(): readonly string[] {
    return [...this.data.keys()];
  }
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.data.has(key) ? (this.data.get(key) as T) : defaultValue;
  }
  update(key: string, value: unknown): Thenable<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, JSON.parse(JSON.stringify(value)));
    }
    return Promise.resolve();
  }
}

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

function makeContext(): { context: vscode.ExtensionContext; state: FakeMemento } {
  const state = new FakeMemento();
  const context = {
    subscriptions: [],
    workspaceState: state,
  } as unknown as vscode.ExtensionContext;
  return { context, state };
}

const stored = (state: FakeMemento): SessionRecord[] =>
  deserializeSessions(state.get(SESSIONS_STATE_KEY));

function record(id: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    agentId: AGENT_ID,
    agentLabel: 'History Agent',
    name: `Zed History ${id}`,
    location: 'panel',
    createdAt: Date.now(),
    terminalName: `Zed History ${id}`,
    ...extra,
  };
}

suite('Session history (#16)', function () {
  this.timeout(60000);

  let previousAgents: unknown;
  let previousLocation: unknown;
  const terminals: vscode.Terminal[] = [];
  const toDispose: vscode.Disposable[] = [];

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();
    const config = vscode.workspace.getConfiguration('zedLayout');
    previousAgents = config.inspect('agents')?.globalValue;
    previousLocation = config.inspect('agentSessionLocation')?.globalValue;
    await config.update('agents', [testAgent], vscode.ConfigurationTarget.Global);
    await config.update('agentSessionLocation', 'panel', vscode.ConfigurationTarget.Global);
  });

  teardown(() => {
    toDispose.splice(0).forEach((d) => d.dispose());
    terminals.splice(0).forEach((t) => t.dispose());
  });

  suiteTeardown(async () => {
    const config = vscode.workspace.getConfiguration('zedLayout');
    await config.update('agents', previousAgents, vscode.ConfigurationTarget.Global);
    await config.update(
      'agentSessionLocation',
      previousLocation,
      vscode.ConfigurationTarget.Global,
    );
  });

  test('recordIdFromArg accepts records, tree items and ids', () => {
    assert.strictEqual(recordIdFromArg('abc'), 'abc');
    assert.strictEqual(recordIdFromArg(record('abc')), 'abc');
    assert.strictEqual(recordIdFromArg({ id: 'item', record: { id: 'abc' } }), 'abc');
    assert.strictEqual(recordIdFromArg(undefined), undefined);
  });

  test('persists sessions on start, rename and stop', async () => {
    const { context, state } = makeContext();
    const sessions = createSessionManager(context, { registerCommands: false });
    const history = createSessionHistory(context, sessions, {
      registerCommands: false,
      persistDelayMs: 10,
    });
    toDispose.push(history, sessions);

    const session = await sessions.startSession({ agentId: AGENT_ID, name: 'Zed History A' });
    assert.ok(session);
    terminals.push(session.terminal);
    const env = (session.terminal.creationOptions as vscode.TerminalOptions).env;
    assert.strictEqual(env?.[SESSION_ID_ENV], session.id);

    await waitFor(() => stored(state).some((r) => r.id === session.id));
    const saved = stored(state).find((r) => r.id === session.id);
    assert.strictEqual(saved?.agentId, AGENT_ID);
    assert.strictEqual(saved?.location, 'panel');
    assert.strictEqual(saved?.name, 'Zed History A');

    sessions.rename(session.id, 'Zed History B');
    await waitFor(() => stored(state).find((r) => r.id === session.id)?.name === 'Zed History B');

    sessions.stop(session.id);
    await waitFor(() => stored(state).length === 0);
    assert.deepStrictEqual(history.getDetached(), []);
  });

  test('adopts a restored terminal by env marker and detaches the rest', async () => {
    const { context, state } = makeContext();
    const cwd = os.tmpdir();
    const adoptedRecord = record('saved-1', { cwd, terminalName: 'Old Name' });
    const ghost = record('saved-2', {
      cwd,
      worktree: { path: `${cwd}/zed-ghost-wt`, branch: 'agent/x', baseRef: 'main', repoRoot: cwd },
    });
    await state.update(SESSIONS_STATE_KEY, {
      version: SESSIONS_SCHEMA_VERSION,
      records: [adoptedRecord, ghost],
    });

    const terminal = vscode.window.createTerminal({
      name: 'Zed History restored',
      cwd,
      env: { [SESSION_ID_ENV]: 'saved-1' },
      location: vscode.TerminalLocation.Panel,
    });
    terminals.push(terminal);

    const sessions = createSessionManager(context, { registerCommands: false });
    const history = createSessionHistory(context, sessions, {
      registerCommands: false,
      persistDelayMs: 10,
      restoreWindowMs: 1000,
      restoreOnStartup: true,
    });
    toDispose.push(history, sessions);

    await history.whenRestored;
    const adopted = sessions.getSession('saved-1');
    assert.ok(adopted, 'terminal was not adopted');
    assert.strictEqual(adopted.terminal, terminal);
    assert.strictEqual(adopted.status, 'running');
    assert.strictEqual(adopted.name, adoptedRecord.name);
    assert.strictEqual(adopted.agent.id, AGENT_ID);

    assert.deepStrictEqual(
      history.getDetached().map((r) => r.id),
      ['saved-2'],
    );
    assert.strictEqual(history.findByWorktreePath(`${cwd}/zed-ghost-wt/`)?.id, 'saved-2');
    assert.strictEqual(history.findByWorktreePath(`${cwd}/elsewhere`), undefined);

    await history.flush();
    assert.deepStrictEqual(
      stored(state)
        .map((r) => r.id)
        .sort(),
      ['saved-1', 'saved-2'],
    );

    let changes = 0;
    toDispose.push(history.onDidChange(() => changes++));
    history.forget('saved-2');
    assert.strictEqual(changes, 1);
    assert.deepStrictEqual(history.getDetached(), []);
    await history.flush();
    assert.deepStrictEqual(
      stored(state).map((r) => r.id),
      ['saved-1'],
    );

    // Closed by an extension (not a window shutdown): the record is dropped.
    terminal.dispose();
    await waitFor(() => sessions.getSession('saved-1') === undefined);
    await waitFor(() => stored(state).length === 0);
  });

  test('adopts a terminal of an agent that is no longer configured', async () => {
    const { context } = makeContext();
    const state = context.workspaceState;
    await state.update(SESSIONS_STATE_KEY, {
      version: SESSIONS_SCHEMA_VERSION,
      records: [record('saved-gone', { agentId: 'zed-gone-agent', agentLabel: 'Gone' })],
    });
    const terminal = vscode.window.createTerminal({
      name: 'Zed History gone',
      env: { [SESSION_ID_ENV]: 'saved-gone' },
      location: vscode.TerminalLocation.Panel,
    });
    terminals.push(terminal);
    const sessions = createSessionManager(context, { registerCommands: false });
    const history = createSessionHistory(context, sessions, {
      registerCommands: false,
      restoreWindowMs: 1000,
      restoreOnStartup: true,
    });
    toDispose.push(history, sessions);
    await history.whenRestored;
    const adopted = sessions.getSession('saved-gone');
    assert.ok(adopted);
    assert.strictEqual(adopted.agent.label, 'Gone');
    assert.strictEqual(adopted.agent.command, '');
  });

  test('resume starts a new session from a detached record', async () => {
    const { context, state } = makeContext();
    const cwd = os.tmpdir();
    await state.update(SESSIONS_STATE_KEY, {
      version: SESSIONS_SCHEMA_VERSION,
      records: [record('saved-resume', { cwd, name: 'Zed History Resumed' })],
    });
    const sessions = createSessionManager(context, { registerCommands: false });
    const history = createSessionHistory(context, sessions, {
      registerCommands: false,
      persistDelayMs: 10,
      restoreWindowMs: 500,
      restoreOnStartup: true,
    });
    toDispose.push(history, sessions);
    await history.whenRestored;
    assert.deepStrictEqual(
      history.getDetached().map((r) => r.id),
      ['saved-resume'],
    );

    assert.strictEqual(await history.resume('unknown'), undefined);
    const session = await history.resume('saved-resume');
    assert.ok(session, 'session was not resumed');
    terminals.push(session.terminal);
    assert.strictEqual(session.name, 'Zed History Resumed');
    assert.strictEqual(session.cwd, cwd);
    assert.deepStrictEqual(history.getDetached(), []);
    await waitFor(() => {
      const ids = stored(state).map((r) => r.id);
      return ids.length === 1 && ids[0] === session.id;
    });
    sessions.stop(session.id);
  });

  test('restoreOnStartup = false drops saved records', async () => {
    const { context, state } = makeContext();
    await state.update(SESSIONS_STATE_KEY, {
      version: SESSIONS_SCHEMA_VERSION,
      records: [record('saved-off')],
    });
    const sessions = createSessionManager(context, { registerCommands: false });
    const history = createSessionHistory(context, sessions, {
      registerCommands: false,
      persistDelayMs: 10,
      restoreOnStartup: false,
    });
    toDispose.push(history, sessions);
    await history.whenRestored;
    assert.deepStrictEqual(history.getDetached(), []);
    await waitFor(() => stored(state).length === 0);
  });
});
