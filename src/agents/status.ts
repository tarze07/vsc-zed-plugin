import * as vscode from 'vscode';

import {
  attentionRaised,
  initialStatusState,
  needsTicks,
  reduceStatus,
  waitingAfterMsFromSetting,
  type AttentionReason,
  type StatusEvent,
  type StatusState,
} from './statusMachine';
import type { AgentSession, SessionManager } from './types';

/** Command (#6/#7) that shows a session terminal and clears its attention flag. */
const FOCUS_COMMAND = 'zedLayout.agents.focus';
const SHOW_ACTION = 'Show';

export interface StatusTrackerOptions {
  /** Clock (ms); injectable for tests. */
  now?: () => number;
  /** How often the `waiting` timeout is checked while some session is running. */
  tickIntervalMs?: number;
  /** No shell execution observed within this time after a session appears → fallback mode. */
  fallbackDelayMs?: number;
}

interface Entry {
  state: StatusState;
  readonly terminal: vscode.Terminal;
  /** Execution currently observed in the session terminal (any command, not only the agent). */
  execution?: vscode.TerminalShellExecution;
  fallbackTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Status detection (#8): observes session terminals (shell integration executions, their output,
 * terminal close / focus) and reports the result via `sessions.setStatus(...)`.
 * See docs/STATUS.md for the heuristic and its limitations.
 */
export function registerStatusTracking(
  context: vscode.ExtensionContext,
  sessions: SessionManager,
): void {
  context.subscriptions.push(createStatusTracker(sessions));
}

/** Testable core of {@link registerStatusTracking}. */
export function createStatusTracker(
  sessions: SessionManager,
  options: StatusTrackerOptions = {},
): vscode.Disposable {
  const now = options.now ?? (() => Date.now());
  const tickIntervalMs = options.tickIntervalMs ?? 1000;
  const fallbackDelayMs = options.fallbackDelayMs ?? 5000;

  const entries = new Map<string, Entry>();
  const disposables: vscode.Disposable[] = [];
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  const readConfig = () => {
    const config = vscode.workspace.getConfiguration('zedLayout.status');
    return {
      waitingAfterMs: waitingAfterMsFromSetting(config.get<number>('waitingAfterSeconds')),
      notifyOnAttention: config.get<boolean>('notifyOnAttention', true),
    };
  };
  let config = readConfig();

  const isActive = (terminal: vscode.Terminal): boolean =>
    vscode.window.activeTerminal === terminal && vscode.window.state.focused;

  const updateTimer = () => {
    const wanted = !disposed && [...entries.values()].some((e) => needsTicks(e.state));
    if (wanted && !tickTimer) {
      tickTimer = setInterval(() => {
        const t = now();
        for (const id of [...entries.keys()]) {
          apply(id, { type: 'tick', now: t });
        }
      }, tickIntervalMs);
    } else if (!wanted && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
  };

  const notify = (session: AgentSession, reason: AttentionReason, state: StatusState) => {
    const message =
      reason === 'waiting'
        ? `${session.name} is waiting for input`
        : state.exitCode === undefined
          ? `${session.name} finished`
          : `${session.name} finished (exit ${state.exitCode})`;
    void vscode.window.showInformationMessage(message, SHOW_ACTION).then(
      (choice) => {
        if (choice === SHOW_ACTION && sessions.getSession(session.id)) {
          void vscode.commands.executeCommand(FOCUS_COMMAND, session.id);
        }
      },
      () => undefined,
    );
  };

  function apply(id: string, event: StatusEvent): void {
    const entry = entries.get(id);
    if (!entry || disposed) {
      return;
    }
    const prev = entry.state;
    let next = reduceStatus(prev, event, config);
    const reason = attentionRaised(prev, next);
    // The user is looking at this terminal right now: no badge, no notification.
    if (reason && isActive(entry.terminal)) {
      next = reduceStatus(next, { type: 'focused' }, config);
    }
    entry.state = next;
    if (next !== prev) {
      if (next.status !== 'starting' && entry.fallbackTimer) {
        clearTimeout(entry.fallbackTimer);
        entry.fallbackTimer = undefined;
      }
      const session = sessions.getSession(id);
      if (
        session &&
        (session.status !== next.status ||
          session.needsAttention !== next.needsAttention ||
          session.exitCode !== next.exitCode)
      ) {
        sessions.setStatus(id, next.status, {
          needsAttention: next.needsAttention,
          exitCode: next.exitCode,
        });
      }
      // `attentionRaised` is true only on a false → true edge: at most one notification per
      // session per transition.
      if (session && reason && next.needsAttention && config.notifyOnAttention) {
        notify(session, reason, next);
      }
    }
    updateTimer();
  }

  const dropEntry = (id: string) => {
    const entry = entries.get(id);
    if (entry?.fallbackTimer) {
      clearTimeout(entry.fallbackTimer);
    }
    entries.delete(id);
  };

  const syncSessions = () => {
    const current = sessions.getSessions();
    const ids = new Set(current.map((s) => s.id));
    for (const id of [...entries.keys()]) {
      if (!ids.has(id)) {
        dropEntry(id);
      }
    }
    for (const session of current) {
      const entry = entries.get(session.id);
      if (!entry) {
        const created: Entry = {
          state: initialStatusState(session.status, session.needsAttention, session.exitCode),
          terminal: session.terminal,
        };
        if (session.status === 'starting') {
          created.fallbackTimer = setTimeout(() => {
            created.fallbackTimer = undefined;
            apply(session.id, { type: 'shellIntegrationUnavailable' });
          }, fallbackDelayMs);
        }
        entries.set(session.id, created);
      } else if (entry.state.needsAttention && !session.needsAttention) {
        // SessionManager.focus() cleared the flag — mirror it in the machine.
        entry.state = reduceStatus(entry.state, { type: 'focused' }, config);
      }
    }
    updateTimer();
  };

  const entryForTerminal = (terminal: vscode.Terminal): [string, Entry] | undefined => {
    const session = sessions.findByTerminal(terminal);
    if (session) {
      const entry = entries.get(session.id);
      if (entry) {
        return [session.id, entry];
      }
    }
    for (const pair of entries) {
      if (pair[1].terminal === terminal) {
        return pair;
      }
    }
    return undefined;
  };

  const observeOutput = async (
    id: string,
    entry: Entry,
    execution: vscode.TerminalShellExecution,
  ) => {
    try {
      for await (const chunk of execution.read()) {
        if (chunk.length === 0) {
          continue;
        }
        if (disposed || entries.get(id) !== entry || entry.execution !== execution) {
          return;
        }
        apply(id, { type: 'output', now: now() });
      }
    } catch {
      // Stream errors are not fatal for status tracking.
    }
  };

  disposables.push(
    sessions.onDidChangeSessions(syncSessions),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('zedLayout.status')) {
        config = readConfig();
      }
    }),
    vscode.window.onDidStartTerminalShellExecution((e) => {
      const found = entryForTerminal(e.terminal);
      if (!found) {
        return;
      }
      const [id, entry] = found;
      entry.execution = e.execution;
      apply(id, { type: 'executionStart', now: now() });
      void observeOutput(id, entry, e.execution);
    }),
    vscode.window.onDidEndTerminalShellExecution((e) => {
      const found = entryForTerminal(e.terminal);
      if (!found || found[1].execution !== e.execution) {
        return;
      }
      found[1].execution = undefined;
      apply(found[0], { type: 'executionEnd', exitCode: e.exitCode });
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      const found = entryForTerminal(terminal);
      if (found) {
        found[1].execution = undefined;
        apply(found[0], { type: 'terminalClosed' });
      }
    }),
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      const found = terminal && entryForTerminal(terminal);
      if (found) {
        apply(found[0], { type: 'focused' });
      }
    }),
    vscode.window.onDidChangeWindowState((state) => {
      const terminal = vscode.window.activeTerminal;
      const found = state.focused && terminal && entryForTerminal(terminal);
      if (found) {
        apply(found[0], { type: 'focused' });
      }
    }),
  );

  syncSessions();

  return {
    dispose: () => {
      disposed = true;
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = undefined;
      }
      for (const id of [...entries.keys()]) {
        dropEntry(id);
      }
      for (const d of disposables) {
        d.dispose();
      }
      disposables.length = 0;
    },
  };
}
