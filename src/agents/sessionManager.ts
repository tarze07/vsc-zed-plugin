import * as vscode from 'vscode';

import {
  buildShellCommand,
  findExecutable,
  parseAgents,
  shellFlavor,
  uniqueSessionName,
} from './registry';
import type {
  AgentDefinition,
  AgentSession,
  SessionLocation,
  SessionManager,
  SessionStatus,
  StartSessionOptions,
  StatusUpdate,
} from './types';

/** How long to wait for shell integration before falling back to `sendText`. */
const SHELL_INTEGRATION_TIMEOUT_MS = 3000;
const AGENTS_SETTING = 'zedLayout.agents';

export interface SessionManagerOptions {
  /** Register the `zedLayout.agents.*` commands (default true). Tests create extra managers without them. */
  registerCommands?: boolean;
}

interface SessionRecord {
  session: AgentSession;
  location: SessionLocation;
}

/**
 * Accepts what command callers pass: an `AgentSession`, a session id, or a tree item wrapping a
 * session (`{ session }`). Returns the session id, or undefined.
 */
export function sessionIdFromArg(arg: unknown): string | undefined {
  if (typeof arg === 'string') {
    return arg;
  }
  if (typeof arg === 'object' && arg !== null) {
    const obj = arg as { id?: unknown; session?: { id?: unknown } };
    if (typeof obj.session === 'object' && obj.session !== null) {
      if (typeof obj.session.id === 'string') {
        return obj.session.id;
      }
    }
    if (typeof obj.id === 'string') {
      return obj.id;
    }
  }
  return undefined;
}

function readLocation(): SessionLocation {
  const value = vscode.workspace
    .getConfiguration('zedLayout')
    .get<string>('agentSessionLocation', 'editor');
  return value === 'panel' ? 'panel' : 'editor';
}

function openAgentSettings(): void {
  void vscode.commands.executeCommand('workbench.action.openSettings', AGENTS_SETTING);
}

function showErrorWithSettings(message: string): void {
  void vscode.window.showErrorMessage(message, 'Open Settings').then((choice) => {
    if (choice === 'Open Settings') {
      openAgentSettings();
    }
  });
}

/** Resolves when `terminal` has shell integration, the timeout elapses or the terminal closes. */
function waitForShellIntegration(
  terminal: vscode.Terminal,
  timeoutMs: number,
): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration) {
    return Promise.resolve(terminal.shellIntegration);
  }
  return new Promise((resolve) => {
    const disposables: vscode.Disposable[] = [];
    const finish = (value: vscode.TerminalShellIntegration | undefined): void => {
      clearTimeout(timer);
      disposables.forEach((d) => d.dispose());
      resolve(value);
    };
    const timer = setTimeout(() => finish(terminal.shellIntegration), timeoutMs);
    disposables.push(
      vscode.window.onDidChangeTerminalShellIntegration((e) => {
        if (e.terminal === terminal) {
          finish(e.shellIntegration);
        }
      }),
      vscode.window.onDidCloseTerminal((t) => {
        if (t === terminal) {
          finish(undefined);
        }
      }),
    );
  });
}

/** Resolves true once `terminal` is the active terminal (or false after `timeoutMs`). */
function waitUntilActive(terminal: vscode.Terminal, timeoutMs: number): Promise<boolean> {
  if (vscode.window.activeTerminal === terminal) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const finish = (value: boolean): void => {
      clearTimeout(timer);
      sub.dispose();
      resolve(value);
    };
    const timer = setTimeout(() => finish(vscode.window.activeTerminal === terminal), timeoutMs);
    const sub = vscode.window.onDidChangeActiveTerminal((t) => {
      if (t === terminal) {
        finish(true);
      }
    });
  });
}

export function createSessionManager(
  _context: vscode.ExtensionContext,
  options: SessionManagerOptions = {},
): SessionManager {
  const emitter = new vscode.EventEmitter<void>();
  /** Insertion order = creation order. */
  const records = new Map<string, SessionRecord>();
  const disposables: vscode.Disposable[] = [emitter];
  let counter = 0;
  let lastConfigErrors = '';

  const fire = (): void => emitter.fire();

  const readAgents = (): { agents: AgentDefinition[]; errors: string[] } =>
    parseAgents(vscode.workspace.getConfiguration('zedLayout').get<unknown>('agents'));

  const getSessions = (): AgentSession[] => [...records.values()].map((r) => r.session);

  const getSession = (id: string): AgentSession | undefined => records.get(id)?.session;

  const findByTerminal = (terminal: vscode.Terminal): AgentSession | undefined =>
    getSessions().find((s) => s.terminal === terminal);

  const removeSession = (id: string): boolean => records.delete(id);

  const clearAttention = (session: AgentSession): void => {
    if (session.needsAttention) {
      session.needsAttention = false;
      fire();
    }
  };

  const reportNoAgents = (errors: string[]): void => {
    const details = errors.length > 0 ? ` Problems: ${errors.join(' ')}` : '';
    showErrorWithSettings(`No valid agents configured in "${AGENTS_SETTING}".${details}`);
  };

  const pickAgent = async (): Promise<AgentDefinition | undefined> => {
    const { agents, errors } = readAgents();
    if (agents.length === 0) {
      reportNoAgents(errors);
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      agents.map((agent) => ({
        label: `$(${agent.icon ?? 'hubot'}) ${agent.label}`,
        description: [agent.command, ...(agent.args ?? [])].join(' '),
        agent,
      })),
      { title: 'New Agent Session', placeHolder: 'Select an agent to start' },
    );
    return picked?.agent;
  };

  const sendAgentCommand = async (session: AgentSession): Promise<void> => {
    const flavor = shellFlavor(process.platform, vscode.env.shell);
    const commandLine = buildShellCommand(session.agent, flavor);
    const integration = await waitForShellIntegration(
      session.terminal,
      SHELL_INTEGRATION_TIMEOUT_MS,
    );
    if (!records.has(session.id) || session.terminal.exitStatus !== undefined) {
      return; // stopped or closed meanwhile
    }
    if (integration) {
      integration.executeCommand(commandLine);
    } else {
      session.terminal.sendText(commandLine, true);
    }
  };

  const launch = (
    agent: AgentDefinition,
    opts: Omit<StartSessionOptions, 'agentId'>,
  ): AgentSession | undefined => {
    const cwd = opts.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    // Check the executable before creating the terminal, so a typo does not leave an empty shell.
    const pathEnv = agent.env?.PATH ?? agent.env?.Path ?? process.env.PATH;
    if (!findExecutable(agent.command, { pathEnv, cwd })) {
      showErrorWithSettings(
        `Cannot start ${agent.label}: command "${agent.command}" was not found on PATH. ` +
          `Install it or set the full path in "${AGENTS_SETTING}".`,
      );
      return undefined;
    }

    const name =
      opts.name?.trim() ||
      uniqueSessionName(
        agent.label,
        getSessions().map((s) => s.name),
      );
    const location = opts.location ?? readLocation();
    const terminal = vscode.window.createTerminal({
      name,
      cwd,
      env: agent.env,
      iconPath: new vscode.ThemeIcon(agent.icon ?? 'hubot'),
      color: agent.color ? new vscode.ThemeColor(agent.color) : undefined,
      location:
        location === 'panel' ? vscode.TerminalLocation.Panel : vscode.TerminalLocation.Editor,
    });

    const session: AgentSession = {
      id: `${Date.now().toString(36)}-${++counter}`,
      agent,
      name,
      terminal,
      cwd,
      worktree: opts.worktree,
      status: 'starting',
      needsAttention: false,
      createdAt: Date.now(),
    };
    records.set(session.id, { session, location });
    terminal.show(false);
    fire();

    sendAgentCommand(session).catch((err: unknown) => {
      void vscode.window.showErrorMessage(
        `Failed to start ${agent.label}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return session;
  };

  const startSession = async (
    opts: StartSessionOptions = {},
  ): Promise<AgentSession | undefined> => {
    let agent: AgentDefinition | undefined;
    if (opts.agentId !== undefined) {
      const { agents, errors } = readAgents();
      agent = agents.find((a) => a.id === opts.agentId);
      if (!agent) {
        const details = errors.length > 0 ? ` Problems: ${errors.join(' ')}` : '';
        showErrorWithSettings(
          `Agent "${opts.agentId}" is not configured in "${AGENTS_SETTING}".${details}`,
        );
        return undefined;
      }
    } else {
      agent = await pickAgent();
      if (!agent) {
        return undefined;
      }
    }
    return launch(agent, opts);
  };

  const focus = (id: string): void => {
    const session = getSession(id);
    if (!session) {
      return;
    }
    session.terminal.show(false);
    clearAttention(session);
  };

  const renameTerminal = async (terminal: vscode.Terminal, name: string): Promise<void> => {
    // No stable API renames a terminal; the rename command acts on the active terminal.
    terminal.show(true);
    if (!(await waitUntilActive(terminal, 1000))) {
      return;
    }
    try {
      await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name });
    } catch {
      // best effort
    }
  };

  const rename = (id: string, name: string): void => {
    const session = getSession(id);
    const trimmed = name.trim();
    if (!session || trimmed === '' || trimmed === session.name) {
      return;
    }
    session.name = trimmed;
    fire();
    void renameTerminal(session.terminal, trimmed);
  };

  const stop = (id: string): void => {
    const session = getSession(id);
    if (!session) {
      return;
    }
    removeSession(id);
    fire();
    session.terminal.dispose();
  };

  const restart = async (id: string): Promise<AgentSession | undefined> => {
    const record = records.get(id);
    if (!record) {
      return undefined;
    }
    const { session, location } = record;
    // Prefer the current definition of the agent; fall back to the one the session started with.
    const agent = readAgents().agents.find((a) => a.id === session.agent.id) ?? session.agent;
    stop(id);
    return launch(agent, {
      name: session.name,
      cwd: session.cwd,
      worktree: session.worktree,
      location,
    });
  };

  const setStatus = (id: string, status: SessionStatus, update: StatusUpdate = {}): void => {
    const session = getSession(id);
    if (!session) {
      return;
    }
    let changed = false;
    if (session.status !== status) {
      session.status = status;
      changed = true;
    }
    // A key present in `update` is applied even when its value is undefined (clears a stale exit code).
    if ('needsAttention' in update && session.needsAttention !== !!update.needsAttention) {
      session.needsAttention = !!update.needsAttention;
      changed = true;
    }
    if ('exitCode' in update && session.exitCode !== update.exitCode) {
      session.exitCode = update.exitCode;
      changed = true;
    }
    if (changed) {
      fire();
    }
  };

  // ---- command helpers ------------------------------------------------------------------------

  const pickSession = async (title: string): Promise<AgentSession | undefined> => {
    const sessions = getSessions();
    if (sessions.length === 0) {
      void vscode.window.showInformationMessage('No agent sessions are running.');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      sessions.map((session) => ({
        label: `$(${session.agent.icon ?? 'hubot'}) ${session.name}`,
        description: `${session.agent.label} · ${session.status}`,
        detail: session.worktree?.path ?? session.cwd,
        session,
      })),
      { title, placeHolder: 'Select an agent session' },
    );
    return picked?.session;
  };

  const resolveSessionArg = async (
    arg: unknown,
    title: string,
  ): Promise<AgentSession | undefined> => {
    if (arg === undefined || arg === null) {
      return pickSession(title);
    }
    const id = sessionIdFromArg(arg);
    return id === undefined ? undefined : getSession(id);
  };

  const cycle = (step: 1 | -1): void => {
    const sessions = getSessions();
    if (sessions.length === 0) {
      return;
    }
    const active = vscode.window.activeTerminal;
    const index = sessions.findIndex((s) => s.terminal === active);
    const next =
      index === -1
        ? step === 1
          ? 0
          : sessions.length - 1
        : (index + step + sessions.length) % sessions.length;
    focus(sessions[next].id);
  };

  if (options.registerCommands !== false) {
    disposables.push(
      vscode.commands.registerCommand('zedLayout.agents.newSession', (arg?: unknown) =>
        startSession(typeof arg === 'string' ? { agentId: arg } : {}),
      ),
      vscode.commands.registerCommand('zedLayout.agents.focus', async (arg?: unknown) => {
        const session = await resolveSessionArg(arg, 'Focus Agent Session');
        if (session) {
          focus(session.id);
        }
      }),
      vscode.commands.registerCommand('zedLayout.agents.rename', async (arg?: unknown) => {
        const session = await resolveSessionArg(arg, 'Rename Agent Session');
        if (!session) {
          return;
        }
        const name = await vscode.window.showInputBox({
          title: 'Rename Agent Session',
          value: session.name,
          prompt: 'New name for the agent session',
          validateInput: (v) => (v.trim() === '' ? 'Name must not be empty.' : undefined),
        });
        if (name !== undefined) {
          rename(session.id, name);
        }
      }),
      vscode.commands.registerCommand('zedLayout.agents.stop', async (arg?: unknown) => {
        const session = await resolveSessionArg(arg, 'Stop Agent Session');
        if (!session) {
          return;
        }
        if (session.status === 'running' || session.status === 'waiting') {
          const answer = await vscode.window.showWarningMessage(
            `Stop agent session "${session.name}"?`,
            {
              modal: true,
              detail: 'The terminal and the agent process running in it will be closed.',
            },
            'Stop',
          );
          if (answer !== 'Stop') {
            return;
          }
        }
        stop(session.id);
      }),
      vscode.commands.registerCommand('zedLayout.agents.restart', async (arg?: unknown) => {
        const session = await resolveSessionArg(arg, 'Restart Agent Session');
        return session ? restart(session.id) : undefined;
      }),
      vscode.commands.registerCommand('zedLayout.agents.next', () => cycle(1)),
      vscode.commands.registerCommand('zedLayout.agents.previous', () => cycle(-1)),
    );
  }

  // ---- listeners ------------------------------------------------------------------------------

  disposables.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      const session = findByTerminal(terminal);
      if (session && removeSession(session.id)) {
        fire();
      }
    }),
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      const session = terminal ? findByTerminal(terminal) : undefined;
      if (session) {
        clearAttention(session);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(AGENTS_SETTING)) {
        return;
      }
      const { errors } = readAgents();
      const key = errors.join('\n');
      if (key !== '' && key !== lastConfigErrors) {
        void vscode.window
          .showWarningMessage(
            `Some entries in "${AGENTS_SETTING}" are invalid and were ignored: ${errors.join(' ')}`,
            'Open Settings',
          )
          .then((choice) => {
            if (choice === 'Open Settings') {
              openAgentSettings();
            }
          });
      }
      lastConfigErrors = key;
    }),
  );

  return {
    onDidChangeSessions: emitter.event,
    getSessions,
    getSession,
    findByTerminal,
    getAgents: () => readAgents().agents,
    pickAgent,
    startSession,
    focus,
    rename,
    stop,
    restart,
    setStatus,
    dispose: () => {
      // Session terminals belong to the user — keep them open when the extension deactivates.
      records.clear();
      disposables.splice(0).forEach((d) => d.dispose());
    },
  };
}
