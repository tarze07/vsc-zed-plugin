import * as fs from 'fs';
import * as vscode from 'vscode';

import { hasSessionManagerInternals, type SessionManagerInternals } from './sessionManager';
import {
  SESSION_ID_ENV,
  SESSIONS_STATE_KEY,
  deserializeSessions,
  matchRestoredTerminals,
  samePath,
  serializeSessions,
  type TerminalInfo,
} from './sessionStore';
import type { AgentSession, SessionHistory, SessionManager, SessionRecord } from './types';

const RESTORE_SETTING = 'zedLayout.sessions.restoreOnStartup';

export interface SessionHistoryOptions {
  /** Register `zedLayout.agents.resume` / `forget` (default true). Tests pass false. */
  registerCommands?: boolean;
  /** How long to wait for VS Code to restore terminals after activation (default 5000 ms). */
  restoreWindowMs?: number;
  /** Debounce of `workspaceState` writes (default 300 ms). */
  persistDelayMs?: number;
  /** Platform for path comparison (default `process.platform`). */
  platform?: NodeJS.Platform;
  /** Overrides `zedLayout.sessions.restoreOnStartup`. */
  restoreOnStartup?: boolean;
}

/** Extra members used by tests. */
export interface SessionHistoryInternals {
  /** Resolves once the restore window ended (all saved records adopted or detached). */
  readonly whenRestored: Promise<void>;
  /** Writes pending changes to `workspaceState` now. */
  flush(): Thenable<void>;
}

/**
 * Accepts what command callers pass: a `SessionRecord`, a tree item `{ record }`, or a record id.
 */
export function recordIdFromArg(arg: unknown): string | undefined {
  if (typeof arg === 'string') {
    return arg;
  }
  if (typeof arg === 'object' && arg !== null) {
    const obj = arg as { id?: unknown; record?: { id?: unknown } };
    if (typeof obj.record === 'object' && obj.record !== null) {
      if (typeof obj.record.id === 'string') {
        return obj.record.id;
      }
    }
    if (typeof obj.id === 'string') {
      return obj.id;
    }
  }
  return undefined;
}

/** Name / cwd / env marker of a terminal, as far as the API exposes them. */
export function terminalInfo(terminal: vscode.Terminal): TerminalInfo {
  const options = terminal.creationOptions as Partial<vscode.TerminalOptions>;
  const env = options.env;
  const envValue = env ? env[SESSION_ID_ENV] : undefined;
  const optionCwd = options.cwd;
  const cwd =
    terminal.shellIntegration?.cwd?.fsPath ??
    (typeof optionCwd === 'string' ? optionCwd : optionCwd?.fsPath);
  return {
    name: terminal.name,
    cwd,
    envId: typeof envValue === 'string' && envValue !== '' ? envValue : undefined,
  };
}

const byCreation = (a: SessionRecord, b: SessionRecord): number => a.createdAt - b.createdAt;

/**
 * Session persistence (#16):
 * - live sessions are written to `workspaceState` (`zedLayout.sessions`) on every change
 *   (debounced);
 * - on creation, saved records are matched against terminals VS Code restored and adopted into the
 *   `SessionManager` without re-running the agent; the rest become "detached" (Resume / Forget);
 * - a record is dropped only on `stop()` / `restart()`, `forget`, `resume`, or when the user,
 *   the shell or an extension closes the terminal. Terminals closed by a window shutdown /
 *   reload keep their record (see docs/AGENTS.md, "Przywracanie sesji").
 */
export function createSessionHistory(
  context: vscode.ExtensionContext,
  sessions: SessionManager,
  options: SessionHistoryOptions = {},
): SessionHistory & SessionHistoryInternals & vscode.Disposable {
  const platform = options.platform ?? process.platform;
  const restoreWindowMs = options.restoreWindowMs ?? 5000;
  const persistDelayMs = options.persistDelayMs ?? 300;
  const restoreOnStartup =
    options.restoreOnStartup ??
    vscode.workspace.getConfiguration().get<boolean>(RESTORE_SETTING, true);
  const internals: (SessionManager & SessionManagerInternals) | undefined =
    hasSessionManagerInternals(sessions) ? sessions : undefined;

  const emitter = new vscode.EventEmitter<void>();
  const disposables: vscode.Disposable[] = [emitter];
  /** Records of sessions currently in the manager. */
  const live = new Map<string, SessionRecord>();
  /** Saved records still waiting for their terminal (restore window). */
  const pending = new Map<string, SessionRecord>();
  /** Saved records whose terminal was not restored. */
  const detached = new Map<string, SessionRecord>();
  let disposed = false;
  /** Set once a terminal closed because of a window shutdown: no record is removed afterwards. */
  let shuttingDown = false;
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let lastWritten = JSON.stringify(context.workspaceState.get<unknown>(SESSIONS_STATE_KEY) ?? null);

  const fireChange = (): void => {
    if (!disposed) {
      emitter.fire();
    }
  };

  const toRecord = (session: AgentSession, previous?: SessionRecord): SessionRecord => {
    const record: SessionRecord = {
      id: session.id,
      agentId: session.agent.id,
      agentLabel: session.agent.label,
      name: session.name,
      location: internals?.getLocation(session.id) ?? previous?.location ?? 'editor',
      createdAt: session.createdAt,
      terminalName: session.name,
    };
    if (session.cwd !== undefined) {
      record.cwd = session.cwd;
    }
    if (session.worktree) {
      record.worktree = { ...session.worktree };
    }
    return record;
  };

  const allRecords = (): SessionRecord[] =>
    [...live.values(), ...pending.values(), ...detached.values()].sort(byCreation);

  const flush = (): Thenable<void> => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = undefined;
    }
    const payload = serializeSessions(allRecords());
    const json = JSON.stringify(payload);
    if (json === lastWritten) {
      return Promise.resolve();
    }
    lastWritten = json;
    return context.workspaceState.update(SESSIONS_STATE_KEY, payload);
  };

  const schedulePersist = (): void => {
    if (disposed || persistTimer) {
      return;
    }
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      void flush();
    }, persistDelayMs);
  };

  // ---- live sessions ---------------------------------------------------------------------------

  const syncLive = (): void => {
    if (disposed) {
      return;
    }
    const current = sessions.getSessions();
    for (const session of current) {
      live.set(session.id, toRecord(session, live.get(session.id)));
      // A session that appears with the id of a waiting / detached record supersedes it.
      pending.delete(session.id);
      if (detached.delete(session.id)) {
        fireChange();
      }
    }
    if (!internals) {
      // Without the removal event, any session that disappeared is treated as closed for good.
      const ids = new Set(current.map((s) => s.id));
      for (const id of [...live.keys()]) {
        if (!ids.has(id)) {
          live.delete(id);
        }
      }
    }
    schedulePersist();
  };

  const onRemoved = (
    session: AgentSession,
    cause: 'stopped' | 'closed',
    exitReason?: vscode.TerminalExitReason,
  ): void => {
    if (disposed) {
      return;
    }
    if (cause === 'closed' && exitReason === vscode.TerminalExitReason.Shutdown) {
      // Window closing / reloading: keep every record, the terminal will be restored.
      shuttingDown = true;
      return;
    }
    if (shuttingDown) {
      return;
    }
    const record = live.get(session.id) ?? toRecord(session);
    live.delete(session.id);
    if (
      cause === 'closed' &&
      (exitReason === undefined || exitReason === vscode.TerminalExitReason.Unknown)
    ) {
      // We cannot tell whether the user closed it: keep it as a detached session (Resume / Forget).
      detached.set(record.id, record);
      fireChange();
    }
    // `stopped` and closes by the user / the shell process / an extension drop the record.
    schedulePersist();
  };

  // ---- restore -----------------------------------------------------------------------------------

  let resolveRestored!: () => void;
  const whenRestored = new Promise<void>((resolve) => {
    resolveRestored = resolve;
  });

  const isFree = (terminal: vscode.Terminal): boolean =>
    terminal.exitStatus === undefined && sessions.findByTerminal(terminal) === undefined;

  const adopt = (records: SessionRecord[], terminals: readonly vscode.Terminal[]): void => {
    if (!internals || records.length === 0) {
      return;
    }
    const free = terminals.filter(isFree);
    if (free.length === 0) {
      return;
    }
    const { matched } = matchRestoredTerminals(records, free.map(terminalInfo), platform);
    for (const [id, index] of matched) {
      const record = pending.get(id) ?? detached.get(id);
      if (!record) {
        continue;
      }
      pending.delete(id);
      const wasDetached = detached.delete(id);
      live.set(id, record);
      internals.adoptTerminal(free[index], record);
      if (wasDetached) {
        fireChange();
      }
    }
  };

  const endRestoreWindow = (): void => {
    if (pending.size > 0) {
      for (const record of pending.values()) {
        detached.set(record.id, record);
      }
      pending.clear();
      fireChange();
    }
    schedulePersist();
    resolveRestored();
  };

  // Subscribe before adopting so adopted sessions are recorded.
  disposables.push(sessions.onDidChangeSessions(syncLive));
  if (internals) {
    disposables.push(
      internals.onDidRemoveSession((e) => onRemoved(e.session, e.cause, e.exitReason)),
    );
  }
  syncLive();

  const saved = deserializeSessions(context.workspaceState.get<unknown>(SESSIONS_STATE_KEY)).filter(
    (r) => !live.has(r.id),
  );
  if (!restoreOnStartup || saved.length === 0) {
    // Records of a disabled restore are dropped (the next write contains only live sessions).
    schedulePersist();
    resolveRestored();
  } else {
    for (const record of saved) {
      pending.set(record.id, record);
    }
    adopt([...pending.values()], vscode.window.terminals);
    if (pending.size === 0) {
      endRestoreWindow();
    } else {
      const timer = setTimeout(endRestoreWindow, restoreWindowMs);
      disposables.push({ dispose: () => clearTimeout(timer) });
    }
  }

  disposables.push(
    vscode.window.onDidOpenTerminal((terminal) => {
      if (disposed) {
        return;
      }
      if (pending.size > 0) {
        adopt([...pending.values()], [terminal]);
        if (pending.size === 0) {
          endRestoreWindow();
        }
      } else if (detached.size > 0) {
        // A late restore: re-attach only on the (unambiguous) env marker.
        const envId = terminalInfo(terminal).envId;
        const record = envId === undefined ? undefined : detached.get(envId);
        if (record) {
          adopt([record], [terminal]);
        }
      }
    }),
  );

  // ---- API -----------------------------------------------------------------------------------

  const getDetached = (): readonly SessionRecord[] => [...detached.values()].sort(byCreation);

  const findByWorktreePath = (wtPath: string): SessionRecord | undefined => {
    const liveRecords = sessions.getSessions().map((s) => toRecord(s, live.get(s.id)));
    return [...liveRecords, ...pending.values(), ...detached.values()].find((r) =>
      samePath(r.worktree?.path, wtPath, platform),
    );
  };

  const forget = (id: string): void => {
    if (detached.delete(id)) {
      fireChange();
      schedulePersist();
    }
  };

  const resume = async (id: string): Promise<AgentSession | undefined> => {
    const record = detached.get(id);
    if (!record) {
      return undefined;
    }
    const cwd = record.cwd ?? record.worktree?.path;
    if (cwd !== undefined && !fs.existsSync(cwd)) {
      void vscode.window.showErrorMessage(
        `Cannot resume "${record.name}": the directory ${cwd} no longer exists.`,
      );
      return undefined;
    }
    let agentId = record.agentId;
    if (!sessions.getAgents().some((a) => a.id === agentId)) {
      const agent = await sessions.pickAgent();
      if (!agent) {
        return undefined;
      }
      agentId = agent.id;
    }
    const session = await sessions.startSession({
      agentId,
      name: record.name,
      cwd,
      worktree: record.worktree,
      location: record.location,
    });
    if (session && detached.delete(id)) {
      fireChange();
      schedulePersist();
    }
    return session;
  };

  // ---- commands ---------------------------------------------------------------------------------

  const pickDetached = async (title: string): Promise<SessionRecord | undefined> => {
    const records = getDetached();
    if (records.length === 0) {
      void vscode.window.showInformationMessage('There are no detached agent sessions.');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      records.map((record) => ({
        label: `$(debug-disconnect) ${record.name}`,
        description: record.agentLabel,
        detail: record.worktree?.path ?? record.cwd,
        record,
      })),
      { title, placeHolder: 'Select a detached agent session' },
    );
    return picked?.record;
  };

  const resolveRecordArg = async (
    arg: unknown,
    title: string,
  ): Promise<SessionRecord | undefined> => {
    if (arg === undefined || arg === null) {
      return pickDetached(title);
    }
    const id = recordIdFromArg(arg);
    return id === undefined ? undefined : detached.get(id);
  };

  if (options.registerCommands !== false) {
    disposables.push(
      vscode.commands.registerCommand('zedLayout.agents.resume', async (arg?: unknown) => {
        const record = await resolveRecordArg(arg, 'Resume Agent Session');
        return record ? resume(record.id) : undefined;
      }),
      vscode.commands.registerCommand('zedLayout.agents.forget', async (arg?: unknown) => {
        const record = await resolveRecordArg(arg, 'Forget Agent Session');
        if (!record) {
          return;
        }
        forget(record.id);
        const worktree = record.worktree
          ? ` Its worktree ${record.worktree.path} (branch ${record.worktree.branch}) was kept.`
          : '';
        void vscode.window.showInformationMessage(
          `Forgot agent session "${record.name}".${worktree}`,
        );
      }),
    );
  }

  return {
    onDidChange: emitter.event,
    getDetached,
    findByWorktreePath,
    resume,
    forget,
    whenRestored,
    flush,
    dispose: () => {
      if (disposed) {
        return;
      }
      // Write what is pending, but never remove records on deactivation (the window may be
      // reloading and its terminals will be restored).
      if (persistTimer) {
        void flush();
      }
      disposed = true;
      resolveRestored();
      disposables.splice(0).forEach((d) => d.dispose());
    },
  };
}
