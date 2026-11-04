/**
 * Pure helpers for session persistence (#16): (de)serialisation of `SessionRecord[]` stored in
 * `context.workspaceState` and matching of terminals restored by VS Code after a window reload
 * to saved records. No `vscode` import (the type import below is erased), so everything here can
 * be unit-tested in plain mocha.
 */
import * as path from 'path';

import type { SessionLocation, SessionRecord, WorktreeInfo } from './types';

/** `workspaceState` key holding the persisted sessions. */
export const SESSIONS_STATE_KEY = 'zedLayout.sessions';

/** Environment variable set on every agent terminal; its value is the session id. */
export const SESSION_ID_ENV = 'ZED_LAYOUT_SESSION_ID';

/** Current schema version of the stored payload. */
export const SESSIONS_SCHEMA_VERSION = 1;

export interface StoredSessions {
  version: number;
  records: SessionRecord[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

function parseWorktree(value: unknown): WorktreeInfo | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const { path: wtPath, branch, baseRef, repoRoot } = value;
  if (
    !nonEmptyString(wtPath) ||
    typeof branch !== 'string' ||
    typeof baseRef !== 'string' ||
    !nonEmptyString(repoRoot)
  ) {
    return undefined;
  }
  return { path: wtPath, branch, baseRef, repoRoot };
}

/**
 * Validates one stored record. Returns undefined for malformed entries (missing id / agentId /
 * name). Optional fields with a wrong type are dropped or defaulted instead of rejecting the record.
 */
export function parseSessionRecord(value: unknown): SessionRecord | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const { id, agentId, agentLabel, name, cwd, worktree, location, createdAt, terminalName } = value;
  if (!nonEmptyString(id) || !nonEmptyString(agentId) || !nonEmptyString(name)) {
    return undefined;
  }
  const record: SessionRecord = {
    id,
    agentId,
    agentLabel: nonEmptyString(agentLabel) ? agentLabel : agentId,
    name,
    location: (location === 'panel' ? 'panel' : 'editor') as SessionLocation,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
    terminalName: nonEmptyString(terminalName) ? terminalName : name,
  };
  if (nonEmptyString(cwd)) {
    record.cwd = cwd;
  }
  const wt = parseWorktree(worktree);
  if (wt) {
    record.worktree = wt;
  }
  return record;
}

/** Payload written to `workspaceState`. Duplicate ids keep the first record. */
export function serializeSessions(records: readonly SessionRecord[]): StoredSessions {
  const seen = new Set<string>();
  const out: SessionRecord[] = [];
  for (const record of records) {
    const parsed = parseSessionRecord(record);
    if (parsed && !seen.has(parsed.id)) {
      seen.add(parsed.id);
      out.push(parsed);
    }
  }
  return { version: SESSIONS_SCHEMA_VERSION, records: out };
}

/**
 * Reads the stored payload. Unknown / newer schema versions and non-objects yield `[]`;
 * malformed records are dropped; duplicate ids keep the first record.
 */
export function deserializeSessions(value: unknown): SessionRecord[] {
  if (!isObject(value) || value.version !== SESSIONS_SCHEMA_VERSION) {
    return [];
  }
  if (!Array.isArray(value.records)) {
    return [];
  }
  return serializeSessions(
    value.records.map(parseSessionRecord).filter((r): r is SessionRecord => r !== undefined),
  ).records;
}

/** Normalises a filesystem path for comparison (case-insensitive and `\` = `/` on win32). */
export function normalizePath(p: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    let normalized = path.win32.normalize(p).replace(/\//g, '\\');
    if (normalized.length > 3 && normalized.endsWith('\\')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized.toLowerCase();
  }
  let normalized = path.posix.normalize(p);
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function samePath(
  a: string | undefined,
  b: string | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (a === undefined || b === undefined || a === '' || b === '') {
    return false;
  }
  return normalizePath(a, platform) === normalizePath(b, platform);
}

/** What `matchRestoredTerminals` needs to know about a terminal. */
export interface TerminalInfo {
  name: string;
  cwd?: string;
  /** Value of `ZED_LAYOUT_SESSION_ID` from the terminal's creation options, if available. */
  envId?: string;
}

export interface MatchResult {
  /** `[recordId, terminalIndex]` pairs; each terminal index appears at most once. */
  matched: [string, number][];
  unmatchedRecords: SessionRecord[];
}

const recordNames = (record: SessionRecord): string[] =>
  record.terminalName === record.name ? [record.name] : [record.terminalName, record.name];

/**
 * Matches restored terminals to saved records, in three passes:
 * 1. env marker (`envId === record.id`);
 * 2. name (terminal name or session name) + cwd (normalised path, `record.worktree.path` or
 *    `record.cwd`);
 * 3. name alone, only when exactly one remaining terminal and one remaining record carry it.
 *
 * Terminals that carry an env marker of another (unknown) session are never matched by name.
 * A terminal is never matched twice; the order of `records` decides ties in pass 2.
 */
export function matchRestoredTerminals(
  records: readonly SessionRecord[],
  terminals: readonly TerminalInfo[],
  platform: NodeJS.Platform = process.platform,
): MatchResult {
  const matched: [string, number][] = [];
  const usedTerminals = new Set<number>();
  let remaining = [...records];

  const take = (record: SessionRecord, index: number): void => {
    matched.push([record.id, index]);
    usedTerminals.add(index);
    remaining = remaining.filter((r) => r !== record);
  };

  // 1. env marker
  for (const record of [...remaining]) {
    const index = terminals.findIndex((t, i) => !usedTerminals.has(i) && t.envId === record.id);
    if (index !== -1) {
      take(record, index);
    }
  }

  const nameCandidate = (t: TerminalInfo, i: number): boolean =>
    !usedTerminals.has(i) && (t.envId === undefined || t.envId === '');

  // 2. name + cwd
  for (const record of [...remaining]) {
    const names = recordNames(record);
    const cwd = record.cwd ?? record.worktree?.path;
    if (cwd === undefined) {
      continue;
    }
    const index = terminals.findIndex(
      (t, i) => nameCandidate(t, i) && names.includes(t.name) && samePath(t.cwd, cwd, platform),
    );
    if (index !== -1) {
      take(record, index);
    }
  }

  // 3. unique name
  for (const record of [...remaining]) {
    const names = recordNames(record);
    const candidates = terminals
      .map((t, i) => [t, i] as const)
      .filter(([t, i]) => nameCandidate(t, i) && names.includes(t.name));
    if (candidates.length !== 1) {
      continue;
    }
    const [terminal, index] = candidates[0];
    const rivals = remaining.filter((r) => recordNames(r).includes(terminal.name));
    if (rivals.length === 1) {
      take(record, index);
    }
  }

  return { matched, unmatchedRecords: remaining };
}
