import type * as vscode from 'vscode';

/**
 * Shared M2 contract (#6, #7, #8, #9). Owned by the coordinator — change only by agreement.
 *
 * - #6 implements `SessionManager` (src/agents/sessionManager.ts) and the agent registry.
 * - #7 renders sessions in the Agents view (src/views/**) using only this interface.
 * - #8 tracks session status (src/agents/status.ts) and reports it via `setStatus`.
 * - #9 creates worktrees (src/worktrees/**) and starts sessions with `startSession({ cwd, worktree })`.
 */

/** One configured agent CLI (`zedLayout.agents` entry). */
export interface AgentDefinition {
  id: string;
  label: string;
  command: string;
  args?: string[];
  /** Codicon id, e.g. "sparkle". */
  icon?: string;
  /** Theme color id, e.g. "terminal.ansiMagenta". */
  color?: string;
  env?: Record<string, string>;
}

/**
 * - `starting`: terminal created, agent command not yet observed running
 * - `running`: agent is producing output / executing
 * - `waiting`: agent appears to wait for user input (heuristic)
 * - `exited`: agent process / terminal ended
 */
export type SessionStatus = 'starting' | 'running' | 'waiting' | 'exited';

/** Git worktree an agent session runs in (#9). */
export interface WorktreeInfo {
  /** Absolute path of the worktree directory. */
  path: string;
  /** Branch checked out in the worktree, e.g. "agent/claude-1a2b3c". */
  branch: string;
  /** Ref the branch was created from, e.g. "main" or a commit sha. */
  baseRef: string;
  /** Absolute path of the main repository root. */
  repoRoot: string;
}

export type SessionLocation = 'editor' | 'panel';

export interface AgentSession {
  /** Stable unique id (not the terminal name). */
  readonly id: string;
  readonly agent: AgentDefinition;
  /** Display name (also the terminal name). */
  name: string;
  terminal: vscode.Terminal;
  cwd?: string;
  worktree?: WorktreeInfo;
  status: SessionStatus;
  /** True when the session needs the user's attention (waiting for input or exited unexpectedly) and was not yet focused. */
  needsAttention: boolean;
  exitCode?: number;
  readonly createdAt: number;
}

export interface StartSessionOptions {
  /** Agent id; when omitted the user is asked with a QuickPick. */
  agentId?: string;
  name?: string;
  cwd?: string;
  worktree?: WorktreeInfo;
  /** Defaults to `zedLayout.agentSessionLocation`. */
  location?: SessionLocation;
}

export interface StatusUpdate {
  needsAttention?: boolean;
  exitCode?: number;
}

export interface SessionManager extends vscode.Disposable {
  /** Fires on any change: session added/removed/renamed/status changed. */
  readonly onDidChangeSessions: vscode.Event<void>;
  getSessions(): readonly AgentSession[];
  getSession(id: string): AgentSession | undefined;
  findByTerminal(terminal: vscode.Terminal): AgentSession | undefined;
  /** Agents from `zedLayout.agents` (validated). */
  getAgents(): readonly AgentDefinition[];
  /** QuickPick over configured agents. */
  pickAgent(): Promise<AgentDefinition | undefined>;
  /** Creates the terminal, sends the agent command, registers the session. Undefined if cancelled / failed. */
  startSession(options?: StartSessionOptions): Promise<AgentSession | undefined>;
  /** Shows the session terminal and clears `needsAttention`. */
  focus(id: string): void;
  rename(id: string, name: string): void;
  /** Disposes the terminal; the session is removed from the list. */
  stop(id: string): void;
  /** Stops and starts a new session with the same agent, name, cwd and worktree. */
  restart(id: string): Promise<AgentSession | undefined>;
  /** Used by status tracking (#8). No-op for unknown ids. */
  setStatus(id: string, status: SessionStatus, update?: StatusUpdate): void;
}
