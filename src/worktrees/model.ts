/**
 * Pure helpers for git worktrees (#9). Must not import `vscode` (unit-tested under plain mocha).
 */
import * as nodePath from 'path';

/** Minimal subset of `path` used here, so tests can pass `path.posix` / `path.win32`. */
export type PathApi = Pick<
  typeof nodePath,
  'basename' | 'dirname' | 'isAbsolute' | 'join' | 'normalize' | 'resolve'
>;

/** One entry of `git worktree list --porcelain`. */
export interface WorktreeEntry {
  path: string;
  /** Commit sha checked out (absent for bare repositories). */
  head?: string;
  /** Short branch name (without `refs/heads/`), absent when detached or bare. */
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockedReason?: string;
  prunable: boolean;
  prunableReason?: string;
}

/** Parses `git worktree list --porcelain` (records separated by blank lines; `-z` NULs also accepted). */
export function parseWorktreeList(porcelain: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | undefined;
  const flush = (): void => {
    if (current) {
      entries.push(current);
      current = undefined;
    }
  };
  for (const rawLine of porcelain.split(/\r?\n|\0/)) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') {
      flush();
      continue;
    }
    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? undefined : line.slice(space + 1);
    if (key === 'worktree') {
      flush();
      current = {
        path: value ?? '',
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (!current) {
      continue;
    }
    switch (key) {
      case 'HEAD':
        current.head = value;
        break;
      case 'branch':
        current.branch = value?.replace(/^refs\/heads\//, '');
        break;
      case 'detached':
        current.detached = true;
        break;
      case 'bare':
        current.bare = true;
        break;
      case 'locked':
        current.locked = true;
        if (value) {
          current.lockedReason = value;
        }
        break;
      case 'prunable':
        current.prunable = true;
        if (value) {
          current.prunableReason = value;
        }
        break;
      default:
        break;
    }
  }
  flush();
  return entries;
}

/**
 * Makes `refName` satisfy `git check-ref-format --branch` rules:
 * no control chars, spaces, `~^:?*[\`, `..`, `@{`, `//`; no component starting with `.`
 * or ending with `.lock`; no trailing `/` or `.`; not `@`. Invalid characters become `-`.
 */
export function sanitizeRefName(refName: string): string {
  let s = refName
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x20\x7f~^:?*[\\]+/g, '-')
    .replace(/@\{/g, '-')
    .replace(/\.{2,}/g, '.');
  const components = s
    .split('/')
    .map((c) => {
      let comp = c.replace(/^[.-]+/, '');
      while (/\.lock$/i.test(comp)) {
        comp = comp.slice(0, -'.lock'.length);
      }
      return comp.replace(/\.+$/, '').replace(/-{2,}/g, '-');
    })
    .filter((c) => c.length > 0);
  s = components.join('/');
  s = s.replace(/[./]+$/, '');
  if (s === '@') {
    s = '';
  }
  return s;
}

/** Branch for an agent worktree, e.g. `makeBranchName('agent/', 'claude', '1a2b3c')` → `agent/claude-1a2b3c`. */
export function makeBranchName(prefix: string, agentId: string, shortId: string): string {
  const name = sanitizeRefName(`${prefix}${agentId}-${shortId}`);
  if (name) {
    return name;
  }
  return (shortId && sanitizeRefName(`agent-${shortId}`)) || 'agent-worktree';
}

/** Branch name without the configured prefix (for display), e.g. `agent/claude-1a2b3c` → `claude-1a2b3c`. */
export function shortBranchName(branch: string, prefix: string): string {
  const p = sanitizeRefName(prefix);
  if (p && branch.startsWith(`${p}/`)) {
    return branch.slice(p.length + 1);
  }
  if (prefix && branch.startsWith(prefix)) {
    return branch.slice(prefix.length) || branch;
  }
  return branch;
}

/**
 * Directory that holds agent worktrees.
 * - empty setting → `<parent of repoRoot>/<repoName>.worktrees`
 * - `~` / `~/…` → relative to `homeDir` (when given)
 * - relative → resolved against `repoRoot`
 * - absolute → normalized as is
 */
export function resolveWorktreesDir(
  repoRoot: string,
  setting: string | undefined,
  pathApi: PathApi = nodePath,
  homeDir?: string,
): string {
  const value = (setting ?? '').trim();
  if (!value) {
    const root = stripTrailingSep(repoRoot, pathApi);
    return pathApi.join(pathApi.dirname(root), `${pathApi.basename(root)}.worktrees`);
  }
  if (homeDir && (value === '~' || /^~[\\/]/.test(value))) {
    return pathApi.join(homeDir, value.slice(1));
  }
  if (pathApi.isAbsolute(value)) {
    return pathApi.normalize(value);
  }
  return pathApi.resolve(repoRoot, value);
}

/** Path of the worktree for `branch` inside `dir` (`/` and `\` flattened to `-`). */
export function worktreePathFor(dir: string, branch: string, pathApi: PathApi = nodePath): string {
  const leaf = branch.replace(/[\\/]+/g, '-').replace(/^[.-]+/, '') || 'worktree';
  return pathApi.join(dir, leaf);
}

function stripTrailingSep(p: string, pathApi: PathApi): string {
  const normalized = pathApi.normalize(p);
  const trimmed = normalized.replace(/[\\/]+$/, '');
  // Keep filesystem roots ("/", "C:\") intact.
  return trimmed === '' || /^[A-Za-z]:$/.test(trimmed) ? normalized : trimmed;
}

/** Single-letter change kind used for compare/review. */
export type ChangeKind = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | '?';

/** A file changed in a worktree relative to its base. Paths are repo-relative with `/`. */
export interface ChangedFile {
  path: string;
  /** Previous path for renames / copies. */
  originalPath?: string;
  kind: ChangeKind;
}

/** Parses `git diff --name-status -z` output. */
export function parseNameStatusZ(output: string): ChangedFile[] {
  const parts = output.split('\0');
  const files: ChangedFile[] = [];
  let i = 0;
  while (i < parts.length) {
    const status = parts[i++];
    if (!status) {
      continue;
    }
    const kind = status[0] as ChangeKind;
    if (kind === 'R' || kind === 'C') {
      const from = parts[i++];
      const to = parts[i++];
      if (from !== undefined && to !== undefined) {
        files.push({ path: to, originalPath: from, kind });
      }
    } else {
      const p = parts[i++];
      if (p !== undefined && p !== '') {
        files.push({ path: p, kind: 'AMDTU'.includes(kind) ? kind : 'M' });
      }
    }
  }
  return files;
}

/** Parses `git status --porcelain -z` (v1) into a count-friendly list. */
export function parseStatusPorcelainZ(output: string): ChangedFile[] {
  const parts = output.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry || entry.length < 4) {
      continue;
    }
    const xy = entry.slice(0, 2);
    const p = entry.slice(3);
    if (xy === '??' || xy === '!!') {
      files.push({ path: p, kind: '?' });
    } else if (xy.includes('R') || xy.includes('C')) {
      files.push({ path: p, originalPath: parts[++i], kind: xy.includes('R') ? 'R' : 'C' });
    } else if (xy.includes('U') || xy === 'AA' || xy === 'DD') {
      files.push({ path: p, kind: 'U' });
    } else if (xy.includes('D')) {
      files.push({ path: p, kind: 'D' });
    } else if (xy.includes('A')) {
      files.push({ path: p, kind: 'A' });
    } else {
      files.push({ path: p, kind: 'M' });
    }
  }
  return files;
}

/** Merges change lists (later entries win for the same path) and sorts by path. */
export function mergeChanges(...lists: ChangedFile[][]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  for (const list of lists) {
    for (const f of list) {
      byPath.set(f.path, f);
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Random lowercase hex id of `length` characters (default 6). */
export function randomShortId(length = 6, random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += Math.floor(random() * 16).toString(16);
  }
  return out;
}
