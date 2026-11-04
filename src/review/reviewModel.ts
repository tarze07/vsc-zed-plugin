/**
 * Pure helpers for the Agent Changes view (#10). Must not import `vscode` at runtime
 * (unit-tested under plain mocha) — only type imports are allowed here.
 */
import * as path from 'path';

import type { ChangeKind } from '../worktrees/model';
import type { ReviewFile, ReviewTarget } from './types';

export const SESSION_CONTEXT = 'reviewSession';
export const FILE_CONTEXT = 'reviewFile';

export interface IconDescriptor {
  /** Codicon id. */
  id: string;
  /** Theme color id. */
  color?: string;
}

export interface SessionNodeInput {
  sessionId: string;
  name: string;
  baseLabel: string;
  root: string;
  fileCount: number;
  /** Branch of the worktree (worktree sessions only). */
  branch?: string;
  /** Agent icon (codicon id + theme color). */
  agentIcon?: string;
  agentColor?: string;
  /** Error from listing changes, shown instead of the file count. */
  error?: string;
}

export interface SessionNodeDescriptor {
  id: string;
  label: string;
  description: string;
  tooltip: string;
  contextValue: string;
  icon: IconDescriptor;
  /** No children when there are no changes. */
  collapsible: 'expanded' | 'none';
}

export interface FileNodeDescriptor {
  id: string;
  label: string;
  description: string;
  tooltip: string;
  contextValue: string;
  icon: IconDescriptor;
}

/** Readable kind name used in `contextValue` (`reviewFile.<name>`) and tooltips. */
export function kindName(kind: ChangeKind): string {
  switch (kind) {
    case 'A':
      return 'added';
    case '?':
      return 'untracked';
    case 'M':
      return 'modified';
    case 'T':
      return 'typeChanged';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'U':
      return 'conflict';
    default:
      return 'modified';
  }
}

export function kindIcon(kind: ChangeKind): IconDescriptor {
  switch (kind) {
    case 'A':
      return { id: 'diff-added', color: 'gitDecoration.addedResourceForeground' };
    case '?':
      return { id: 'diff-added', color: 'gitDecoration.untrackedResourceForeground' };
    case 'D':
      return { id: 'diff-removed', color: 'gitDecoration.deletedResourceForeground' };
    case 'R':
    case 'C':
      return { id: 'diff-renamed', color: 'gitDecoration.renamedResourceForeground' };
    case 'U':
      return { id: 'warning', color: 'gitDecoration.conflictingResourceForeground' };
    case 'M':
    case 'T':
    default:
      return { id: 'diff-modified', color: 'gitDecoration.modifiedResourceForeground' };
  }
}

/** Human-readable kind, e.g. "renamed from a/b.ts". */
export function describeKind(file: ReviewFile): string {
  switch (file.kind) {
    case 'A':
      return 'added';
    case '?':
      return 'untracked';
    case 'D':
      return 'deleted';
    case 'R':
      return `renamed from ${file.originalPath ?? '?'}`;
    case 'C':
      return `copied from ${file.originalPath ?? '?'}`;
    case 'U':
      return 'conflict';
    case 'T':
      return 'type changed';
    default:
      return 'modified';
  }
}

export function filesLabel(count: number): string {
  return count === 1 ? '1 file' : `${count} files`;
}

export function describeSessionNode(input: SessionNodeInput): SessionNodeDescriptor {
  const worktree = input.branch !== undefined;
  const description = input.error
    ? `error · vs ${input.baseLabel}`
    : input.fileCount === 0
      ? 'no changes'
      : `${filesLabel(input.fileCount)} · vs ${input.baseLabel}`;
  const tooltip = [
    `**${input.name}**`,
    worktree ? `Branch: \`${input.branch}\`` : undefined,
    `Base: \`${input.baseLabel}\``,
    `Root: ${input.root}`,
    input.error ? `Error: ${input.error}` : `${filesLabel(input.fileCount)} changed`,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n\n');
  return {
    id: sessionNodeId(input.sessionId),
    label: input.name,
    description,
    tooltip,
    contextValue: SESSION_CONTEXT + (worktree ? '.worktree' : ''),
    icon: input.agentIcon
      ? { id: input.agentIcon, color: input.agentColor }
      : { id: worktree ? 'git-branch' : 'terminal' },
    collapsible: input.fileCount > 0 ? 'expanded' : 'none',
  };
}

export function sessionNodeId(sessionId: string): string {
  return `review:${sessionId}`;
}

export function fileNodeId(sessionId: string, file: ReviewFile): string {
  return `review:${sessionId}:${file.path}`;
}

/** Splits a repo-relative `/` path into basename and dirname ("" for top-level files). */
export function splitPath(relPath: string): { base: string; dir: string } {
  const base = path.posix.basename(relPath);
  const dir = path.posix.dirname(relPath);
  return { base, dir: dir === '.' ? '' : dir };
}

export function describeFileNode(sessionId: string, file: ReviewFile): FileNodeDescriptor {
  const { base, dir } = splitPath(file.path);
  const rename =
    (file.kind === 'R' || file.kind === 'C') && file.originalPath
      ? `← ${file.originalPath}`
      : undefined;
  return {
    id: fileNodeId(sessionId, file),
    label: base,
    description: [dir, rename].filter(Boolean).join(' '),
    tooltip: `${file.path} — ${describeKind(file)}`,
    contextValue: `${FILE_CONTEXT}.${kindName(file.kind)}`,
    icon: kindIcon(file.kind),
  };
}

/** Whether a change has a base ("left") and a working-tree ("right") side. */
export function changeSides(kind: ChangeKind): { left: boolean; right: boolean } {
  return {
    left: kind !== 'A' && kind !== '?',
    right: kind !== 'D',
  };
}

/** Builders for the URIs of one change (generic so it stays testable without `vscode`). */
export interface TripleFactory<U> {
  /** Working-tree file (`root/path`). */
  resource(file: ReviewFile): U;
  /** Base version of the file (at `baseCommit`, `originalPath` for renames). */
  base(file: ReviewFile): U;
}

/**
 * `vscode.changes` entries `[resource, original?, modified?]`:
 * added/untracked → no original, deleted → no modified.
 */
export function changeTriples<U>(
  files: readonly ReviewFile[],
  factory: TripleFactory<U>,
): [U, U | undefined, U | undefined][] {
  return files.map((file) => {
    const resource = factory.resource(file);
    const sides = changeSides(file.kind);
    return [
      resource,
      sides.left ? factory.base(file) : undefined,
      sides.right ? resource : undefined,
    ];
  });
}

/** Everything the base-content provider needs, encoded into the URI query. */
export interface BaseUriQuery {
  sessionId: string;
  cwd: string;
  root: string;
  baseCommit: string;
  baseLabel: string;
  path: string;
  originalPath?: string;
  kind: ChangeKind;
}

export function encodeBaseQuery(sessionId: string, target: ReviewTarget, file: ReviewFile): string {
  const query: BaseUriQuery = {
    sessionId,
    cwd: target.cwd,
    root: target.root,
    baseCommit: target.baseCommit,
    baseLabel: target.baseLabel,
    path: file.path,
    originalPath: file.originalPath,
    kind: file.kind,
  };
  return JSON.stringify(query);
}

export function decodeBaseQuery(query: string): BaseUriQuery | undefined {
  try {
    const parsed = JSON.parse(query) as Partial<BaseUriQuery>;
    if (
      typeof parsed.cwd !== 'string' ||
      typeof parsed.root !== 'string' ||
      typeof parsed.baseCommit !== 'string' ||
      typeof parsed.path !== 'string' ||
      typeof parsed.kind !== 'string'
    ) {
      return undefined;
    }
    return {
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : '',
      cwd: parsed.cwd,
      root: parsed.root,
      baseCommit: parsed.baseCommit,
      baseLabel: typeof parsed.baseLabel === 'string' ? parsed.baseLabel : parsed.baseCommit,
      path: parsed.path,
      originalPath: typeof parsed.originalPath === 'string' ? parsed.originalPath : undefined,
      kind: parsed.kind,
    };
  } catch {
    return undefined;
  }
}

/** Splits a decoded query back into the service arguments. */
export function queryToTarget(query: BaseUriQuery): { target: ReviewTarget; file: ReviewFile } {
  return {
    target: {
      cwd: query.cwd,
      root: query.root,
      baseCommit: query.baseCommit,
      baseLabel: query.baseLabel,
    },
    file: { path: query.path, originalPath: query.originalPath, kind: query.kind },
  };
}

export function changesTitle(sessionName: string, baseLabel: string): string {
  return `${sessionName} ↔ ${baseLabel}`;
}

export function fileDiffTitle(file: ReviewFile, sessionName: string, baseLabel: string): string {
  return `${splitPath(file.path).base} (${baseLabel} ↔ ${sessionName})`;
}

export function defaultCommitMessage(sessionName: string): string {
  return `Accept changes from ${sessionName}`;
}

/** View description: total number of changed files across sessions. */
export function viewDescription(totalFiles: number): string | undefined {
  return totalFiles > 0 ? `${filesLabel(totalFiles)} changed` : undefined;
}

export function rejectConfirmation(files: readonly ReviewFile[]): {
  message: string;
  detail: string;
} {
  if (files.length === 1) {
    const file = files[0];
    const detail =
      file.kind === 'A' || file.kind === '?'
        ? 'The file was added by the agent and will be deleted.'
        : file.kind === 'R' || file.kind === 'C'
          ? `The original ${file.originalPath ?? ''} is restored and ${file.path} is removed.`
          : 'The file is restored to its base version. This cannot be undone.';
    return { message: `Discard changes to ${file.path}?`, detail };
  }
  const list = files
    .slice(0, 10)
    .map((f) => `• ${f.path}`)
    .join('\n');
  const more = files.length > 10 ? `\n… and ${files.length - 10} more` : '';
  return {
    message: `Discard changes to ${filesLabel(files.length)}?`,
    detail: `${list}${more}\n\nFiles are restored to their base version. This cannot be undone.`,
  };
}
