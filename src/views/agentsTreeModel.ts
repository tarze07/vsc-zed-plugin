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

export function badgeTooltip(count: number, detachedCount = 0): string {
  const text =
    count === 1 ? '1 agent session needs attention' : `${count} agent sessions need attention`;
  if (detachedCount <= 0) {
    return text;
  }
  return detachedCount === 1
    ? `${text}; 1 session not restored`
    : `${text}; ${detachedCount} sessions not restored`;
}

/**
 * View description, e.g. "3 sessions · 1 not restored · 2 orphaned". Zero counts are omitted;
 * undefined when everything is zero.
 */
export function viewDescription(
  sessionCount: number,
  detachedCount = 0,
  orphanCount = 0,
): string | undefined {
  const parts: string[] = [];
  if (sessionCount > 0) {
    parts.push(sessionCount === 1 ? '1 session' : `${sessionCount} sessions`);
  }
  if (detachedCount > 0) {
    parts.push(`${detachedCount} not restored`);
  }
  if (orphanCount > 0) {
    parts.push(`${orphanCount} orphaned`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export const NO_AGENTS_MESSAGE =
  'No agents configured. Add agent CLIs in Settings: zedLayout.agents.';

// ---------------------------------------------------------------------------
// #16: detached sessions ("Not restored") and orphaned worktrees
// ---------------------------------------------------------------------------

/** Minimal structural subset of `SessionRecord` (src/agents/types.ts) needed for display. */
export interface SessionRecordLike {
  readonly id: string;
  readonly agentId: string;
  readonly agentLabel: string;
  readonly name: string;
  readonly cwd?: string;
  readonly worktree?: AgentSessionLike['worktree'];
  readonly createdAt: number;
}

/** Minimal structural subset of `OrphanedWorktree` (src/agents/types.ts) needed for display. */
export interface OrphanedWorktreeLike {
  readonly path: string;
  readonly branch?: string;
  readonly head: string;
  readonly repoRoot: string;
  readonly baseRef?: string;
  readonly locked?: boolean;
  readonly prunable?: boolean;
}

export type GroupKind = 'sessions' | 'detached' | 'orphans';
export type CollapsedState = 'none' | 'expanded' | 'collapsed';

export interface GroupItemDescriptor extends SessionItemDescriptor {
  collapsed: CollapsedState;
}

/** Tree node with a discriminator; the payload objects are what commands receive as arguments. */
export type AgentsTreeNode<
  S extends AgentSessionLike = AgentSessionLike,
  R extends SessionRecordLike = SessionRecordLike,
  O extends OrphanedWorktreeLike = OrphanedWorktreeLike,
> =
  | { kind: 'group'; group: GroupKind; children: AgentsTreeNode<S, R, O>[] }
  | { kind: 'session'; session: S }
  | { kind: 'detached'; record: R }
  | { kind: 'orphan'; orphan: O };

export const DETACHED_CONTEXT_VALUE = 'detachedSession';
export const ORPHAN_CONTEXT_VALUE = 'orphanWorktree';
export const PRUNABLE_CONTEXT_SUFFIX = '.prunable';
export const LOCKED_CONTEXT_SUFFIX = '.locked';
export const DEFAULT_BRANCH_PREFIX = 'agent/';
/** The "Orphaned worktrees" group starts collapsed above this many entries. */
export const ORPHAN_GROUP_EXPAND_LIMIT = 5;

const GROUPS: Record<GroupKind, { label: string; icon: string }> = {
  sessions: { label: 'Sessions', icon: 'terminal' },
  detached: { label: 'Not restored', icon: 'history' },
  orphans: { label: 'Orphaned worktrees', icon: 'git-branch' },
};

export function groupId(group: GroupKind): string {
  return `group:${group}`;
}

/** Group node: count as description ("none" for an empty Sessions group). */
export function describeGroup(group: GroupKind, count: number): GroupItemDescriptor {
  const meta = GROUPS[group];
  let collapsed: CollapsedState;
  if (count === 0) {
    collapsed = 'none';
  } else if (group === 'orphans' && count > ORPHAN_GROUP_EXPAND_LIMIT) {
    collapsed = 'collapsed';
  } else {
    collapsed = 'expanded';
  }
  return {
    id: groupId(group),
    label: meta.label,
    description: count === 0 ? 'none' : String(count),
    tooltip: `**${meta.label}** (${count})`,
    icon: { id: meta.icon },
    contextValue: `group.${group}`,
    collapsed,
  };
}

export function detachedId(record: Pick<SessionRecordLike, 'id'>): string {
  return `detached:${record.id}`;
}

/** "Claude Code · not restored · agent/claude-1a2b" (branch only for worktree sessions). */
export function detachedDescription(record: SessionRecordLike): string {
  const parts = [record.agentLabel, 'not restored'];
  if (record.worktree) {
    parts.push(record.worktree.branch);
  }
  return parts.join(' · ');
}

export function detachedTooltip(
  record: SessionRecordLike,
  formatTime: (timestamp: number) => string = defaultFormatTime,
): string {
  const lines = [
    `**${escapeMarkdown(record.name)}**`,
    '',
    'Terminal was not restored after the window reload.',
    '',
    `- Agent: ${escapeMarkdown(record.agentLabel)}`,
  ];
  const cwd = record.cwd ?? record.worktree?.path;
  if (cwd) {
    lines.push(`- Cwd: ${code(cwd)}`);
  }
  if (record.worktree) {
    lines.push(
      `- Worktree: ${code(record.worktree.path)}`,
      `- Branch: ${code(record.worktree.branch)}`,
      `- Base: ${code(record.worktree.baseRef)}`,
    );
  }
  lines.push(`- Created: ${escapeMarkdown(formatTime(record.createdAt))}`);
  return lines.join('\n');
}

export function describeDetached(
  record: SessionRecordLike,
  formatTime?: (timestamp: number) => string,
): SessionItemDescriptor {
  return {
    id: detachedId(record),
    label: record.name,
    description: detachedDescription(record),
    tooltip: detachedTooltip(record, formatTime),
    icon: { id: 'debug-disconnect' },
    contextValue: DETACHED_CONTEXT_VALUE,
  };
}

export function orphanId(orphan: Pick<OrphanedWorktreeLike, 'path'>): string {
  return `orphan:${orphan.path}`;
}

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

/** Branch without the agent prefix, or the folder name for a detached HEAD. */
export function orphanLabel(
  orphan: Pick<OrphanedWorktreeLike, 'path' | 'branch'>,
  branchPrefix: string = DEFAULT_BRANCH_PREFIX,
): string {
  if (!orphan.branch) {
    return baseName(orphan.path);
  }
  if (branchPrefix && orphan.branch.startsWith(branchPrefix)) {
    return orphan.branch.slice(branchPrefix.length) || orphan.branch;
  }
  return orphan.branch;
}

export function orphanDescription(
  orphan: Pick<OrphanedWorktreeLike, 'prunable' | 'locked'>,
): string {
  const parts = ['orphaned'];
  if (orphan.prunable) {
    parts.push('missing');
  }
  if (orphan.locked) {
    parts.push('locked');
  }
  return parts.join(' · ');
}

/**
 * `orphanWorktree` plus `.prunable` / `.locked`. Matches `viewItem =~ /^orphanWorktree/`.
 */
export function orphanContextValue(
  orphan: Pick<OrphanedWorktreeLike, 'prunable' | 'locked'>,
): string {
  let value = ORPHAN_CONTEXT_VALUE;
  if (orphan.prunable) {
    value += PRUNABLE_CONTEXT_SUFFIX;
  }
  if (orphan.locked) {
    value += LOCKED_CONTEXT_SUFFIX;
  }
  return value;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function orphanTooltip(orphan: OrphanedWorktreeLike): string {
  const lines = [
    `**${escapeMarkdown(orphan.branch ?? baseName(orphan.path))}**`,
    '',
    'Agent worktree without a session.',
    '',
    `- Path: ${code(orphan.path)}`,
    `- Repository: ${code(orphan.repoRoot)}`,
  ];
  lines.push(orphan.branch ? `- Branch: ${code(orphan.branch)}` : '- Branch: detached HEAD');
  if (orphan.baseRef) {
    lines.push(`- Base: ${code(orphan.baseRef)}`);
  }
  if (orphan.head) {
    lines.push(`- Head: ${code(shortSha(orphan.head))}`);
  }
  if (orphan.prunable) {
    lines.push('- Directory is missing (can be pruned)');
  }
  if (orphan.locked) {
    lines.push('- Locked');
  }
  return lines.join('\n');
}

export function orphanIcon(orphan: Pick<OrphanedWorktreeLike, 'prunable'>): SessionIconDescriptor {
  return orphan.prunable
    ? { id: 'warning', color: 'list.warningForeground' }
    : { id: 'git-branch' };
}

export function describeOrphan(
  orphan: OrphanedWorktreeLike,
  branchPrefix?: string,
): SessionItemDescriptor {
  return {
    id: orphanId(orphan),
    label: orphanLabel(orphan, branchPrefix),
    description: orphanDescription(orphan),
    tooltip: orphanTooltip(orphan),
    icon: orphanIcon(orphan),
    contextValue: orphanContextValue(orphan),
  };
}

/** Orphans sorted by repository, then branch/folder label, then path. */
export function orderOrphans<T extends OrphanedWorktreeLike>(
  orphans: readonly T[],
  branchPrefix?: string,
): T[] {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return [...orphans].sort(
    (a, b) =>
      cmp(a.repoRoot, b.repoRoot) ||
      cmp(orphanLabel(a, branchPrefix), orphanLabel(b, branchPrefix)) ||
      cmp(a.path, b.path),
  );
}

/** True when the view shows groups (there is something besides live sessions). */
export function isGrouped(detachedCount: number, orphanCount: number): boolean {
  return detachedCount > 0 || orphanCount > 0;
}

/**
 * Root nodes of the Agents view. Without detached sessions and orphans: a flat list of live
 * sessions. Otherwise groups "Sessions" (always), "Not restored" and "Orphaned worktrees"
 * (each only when non-empty).
 */
export function buildAgentsTree<
  S extends AgentSessionLike,
  R extends SessionRecordLike,
  O extends OrphanedWorktreeLike,
>(input: {
  sessions: readonly S[];
  detached: readonly R[];
  orphans: readonly O[];
  branchPrefix?: string;
}): AgentsTreeNode<S, R, O>[] {
  const sessionNodes: AgentsTreeNode<S, R, O>[] = orderSessions(input.sessions).map((session) => ({
    kind: 'session',
    session,
  }));
  if (!isGrouped(input.detached.length, input.orphans.length)) {
    return sessionNodes;
  }
  const roots: AgentsTreeNode<S, R, O>[] = [
    { kind: 'group', group: 'sessions', children: sessionNodes },
  ];
  if (input.detached.length > 0) {
    roots.push({
      kind: 'group',
      group: 'detached',
      children: orderSessions(input.detached).map((record) => ({ kind: 'detached', record })),
    });
  }
  if (input.orphans.length > 0) {
    roots.push({
      kind: 'group',
      group: 'orphans',
      children: orderOrphans(input.orphans, input.branchPrefix).map((orphan) => ({
        kind: 'orphan',
        orphan,
      })),
    });
  }
  return roots;
}
