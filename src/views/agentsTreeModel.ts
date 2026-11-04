/**
 * Pure display model for the Agents view (#7). Must NOT import `vscode` (directly or
 * transitively) so it can be unit-tested with plain mocha.
 */

export type AgentSessionStatusLike = 'starting' | 'running' | 'waiting' | 'exited';

/** Minimal structural subset of `AgentSession` (src/agents/types.ts) needed for display. */
export interface AgentSessionLike {
  readonly id: string;
  readonly name: string;
  readonly agent: {
    readonly id: string;
    readonly label: string;
    readonly command: string;
    readonly args?: readonly string[];
    readonly icon?: string;
    readonly color?: string;
  };
  readonly cwd?: string;
  readonly worktree?: {
    readonly path: string;
    readonly branch: string;
    readonly baseRef: string;
    readonly repoRoot: string;
  };
  readonly status: AgentSessionStatusLike;
  readonly needsAttention: boolean;
  readonly exitCode?: number;
  readonly createdAt: number;
}

export interface SessionIconDescriptor {
  /** Codicon id, e.g. "bell-dot" or "loading~spin". */
  id: string;
  /** Theme color id, e.g. "charts.yellow". Undefined = default foreground. */
  color?: string;
}

export interface SessionItemDescriptor {
  id: string;
  label: string;
  description: string;
  /** Markdown source for the tooltip. */
  tooltip: string;
  icon: SessionIconDescriptor;
  contextValue: string;
}

export const CONTEXT_VALUE_PREFIX = 'agentSession';
export const WORKTREE_CONTEXT_SUFFIX = '.worktree';

/** Short, human-readable status text. */
export function statusText(session: Pick<AgentSessionLike, 'status' | 'exitCode'>): string {
  switch (session.status) {
    case 'starting':
      return 'starting';
    case 'running':
      return 'running';
    case 'waiting':
      return 'waiting';
    case 'exited':
      return isFailedExit(session) ? `exited (${session.exitCode})` : 'exited';
  }
}

function isFailedExit(session: Pick<AgentSessionLike, 'exitCode'>): boolean {
  return session.exitCode !== undefined && session.exitCode !== 0;
}

/** "Claude Code · waiting · agent/claude-1a2b" (branch only for worktree sessions). */
export function sessionDescription(session: AgentSessionLike): string {
  const parts = [session.agent.label, statusText(session)];
  if (session.worktree) {
    parts.push(session.worktree.branch);
  }
  return parts.join(' · ');
}

/** Codicon + theme color for a session, depending on its status. */
export function sessionIcon(session: AgentSessionLike): SessionIconDescriptor {
  switch (session.status) {
    case 'starting':
      return { id: 'loading~spin' };
    case 'running':
      return { id: session.agent.icon || 'pulse', color: session.agent.color || undefined };
    case 'waiting':
      return { id: 'bell-dot', color: 'charts.yellow' };
    case 'exited':
      return isFailedExit(session)
        ? { id: 'error', color: 'charts.red' }
        : { id: 'circle-slash', color: 'disabledForeground' };
  }
}

/**
 * `agentSession.<status>` plus `.worktree` when the session runs in a worktree. Matches the
 * `when` clauses in package.json: `viewItem =~ /^agentSession/` and
 * `viewItem =~ /^agentSession.*\.worktree/`.
 */
export function sessionContextValue(
  session: Pick<AgentSessionLike, 'status' | 'worktree'>,
): string {
  const base = `${CONTEXT_VALUE_PREFIX}.${session.status}`;
  return session.worktree ? base + WORKTREE_CONTEXT_SUFFIX : base;
}

/** Escapes Markdown special characters in user-provided text. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, (ch) => `\\${ch}`);
}

function code(text: string): string {
  // Inline code: pick a fence longer than any backtick run inside the text.
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function defaultFormatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/** Markdown tooltip: agent, command, cwd, worktree, status, start time. */
export function sessionTooltip(
  session: AgentSessionLike,
  formatTime: (timestamp: number) => string = defaultFormatTime,
): string {
  const commandLine = [session.agent.command, ...(session.agent.args ?? [])].join(' ');
  const lines = [
    `**${escapeMarkdown(session.name)}**`,
    '',
    `- Agent: ${escapeMarkdown(session.agent.label)}`,
    `- Command: ${code(commandLine)}`,
  ];
  const cwd = session.cwd ?? session.worktree?.path;
  if (cwd) {
    lines.push(`- Cwd: ${code(cwd)}`);
  }
  if (session.worktree) {
    lines.push(
      `- Worktree: ${code(session.worktree.path)}`,
      `- Branch: ${code(session.worktree.branch)}`,
      `- Base: ${code(session.worktree.baseRef)}`,
    );
  }
  lines.push(`- Status: ${escapeMarkdown(statusText(session))}`);
  if (session.needsAttention) {
    lines.push('- Needs attention');
  }
  lines.push(`- Started: ${escapeMarkdown(formatTime(session.createdAt))}`);
  return lines.join('\n');
}

export function describeSession(
  session: AgentSessionLike,
  formatTime?: (timestamp: number) => string,
): SessionItemDescriptor {
  return {
    id: session.id,
    label: session.name,
    description: sessionDescription(session),
    tooltip: sessionTooltip(session, formatTime),
    icon: sessionIcon(session),
    contextValue: sessionContextValue(session),
  };
}

/** Sessions in creation order (stable for equal timestamps). */
export function orderSessions<T extends Pick<AgentSessionLike, 'createdAt'>>(
  sessions: readonly T[],
): T[] {
  return [...sessions].sort((a, b) => a.createdAt - b.createdAt);
}

/** Number of sessions needing the user's attention (view badge value). */
export function badgeCount(sessions: readonly Pick<AgentSessionLike, 'needsAttention'>[]): number {
  return sessions.filter((session) => session.needsAttention).length;
}

export function badgeTooltip(count: number): string {
  return count === 1 ? '1 agent session needs attention' : `${count} agent sessions need attention`;
}

/** View description, e.g. "3 sessions". Undefined when there are no sessions. */
export function viewDescription(sessionCount: number): string | undefined {
  if (sessionCount <= 0) {
    return undefined;
  }
  return sessionCount === 1 ? '1 session' : `${sessionCount} sessions`;
}

export const NO_AGENTS_MESSAGE =
  'No agents configured. Add agent CLIs in Settings: zedLayout.agents.';
