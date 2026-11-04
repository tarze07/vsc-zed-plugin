/**
 * Detection of orphaned agent worktrees (#16). Pure: must not import `vscode`
 * (unit-tested under plain mocha).
 */
import * as nodePath from 'path';

import type { OrphanedWorktree } from '../agents/types';
import type { WorktreeEntry } from './model';

export interface FindOrphansOptions {
  /** Main worktree of the repository (never an orphan). */
  repoRoot: string;
  /** Resolved `zedLayout.worktrees.directory` for this repository. */
  worktreesDir: string;
  /** `zedLayout.worktrees.branchPrefix`; empty → only the directory rule applies. */
  branchPrefix: string;
  /** Worktree paths used by live sessions (or open as workspace folders). */
  livePaths?: Iterable<string>;
  /** Worktree paths of detached (persisted, not restored) sessions. */
  detachedPaths?: Iterable<string>;
  /** Defaults to `process.platform`; selects path semantics and case sensitivity. */
  platform?: NodeJS.Platform;
}

/** Case-insensitive file systems by default (Windows, macOS). */
export function isCaseInsensitivePlatform(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin';
}

function pathApiFor(platform: NodeJS.Platform): typeof nodePath.posix {
  return platform === 'win32' ? nodePath.win32 : nodePath.posix;
}

/**
 * Comparable form of `p`: normalised separators, no trailing separator (except roots),
 * lower case on case-insensitive platforms.
 */
export function normalizePathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  const api = pathApiFor(platform);
  let n = api.normalize(p);
  const root = api.parse(n).root;
  while (n.length > root.length && /[\\/]$/.test(n)) {
    n = n.slice(0, -1);
  }
  return isCaseInsensitivePlatform(platform) ? n.toLowerCase() : n;
}

/** True when `child` lies strictly inside `dir`. */
export function isPathInside(
  child: string,
  dir: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const c = normalizePathKey(child, platform);
  const d = normalizePathKey(dir, platform);
  if (c === d) {
    return false;
  }
  const sep = pathApiFor(platform).sep;
  return c.startsWith(d.endsWith(sep) ? d : d + sep);
}

/**
 * Worktrees of one repository that belong to agents but have no live or detached session:
 * not the main worktree, not bare, on a branch starting with `branchPrefix` OR located inside
 * `worktreesDir`, and not in `livePaths` / `detachedPaths`.
 */
export function findOrphans(
  entries: readonly WorktreeEntry[],
  options: FindOrphansOptions,
): OrphanedWorktree[] {
  const platform = options.platform ?? process.platform;
  const key = (p: string): string => normalizePathKey(p, platform);
  const used = new Set<string>();
  for (const p of options.livePaths ?? []) {
    used.add(key(p));
  }
  for (const p of options.detachedPaths ?? []) {
    used.add(key(p));
  }
  const rootKey = key(options.repoRoot);
  const prefix = options.branchPrefix;
  const orphans: OrphanedWorktree[] = [];
  entries.forEach((entry, index) => {
    // git always lists the main worktree first.
    if (index === 0 || entry.bare || !entry.path) {
      return;
    }
    const pathKey = key(entry.path);
    if (pathKey === rootKey || used.has(pathKey)) {
      return;
    }
    const onAgentBranch = !!prefix && !!entry.branch && entry.branch.startsWith(prefix);
    const inAgentDir = isPathInside(entry.path, options.worktreesDir, platform);
    if (!onAgentBranch && !inAgentDir) {
      return;
    }
    const orphan: OrphanedWorktree = {
      path: entry.path,
      branch: entry.branch,
      head: entry.head ?? '',
      repoRoot: options.repoRoot,
    };
    if (entry.locked) {
      orphan.locked = true;
    }
    if (entry.prunable) {
      orphan.prunable = true;
    }
    orphans.push(orphan);
  });
  return orphans;
}

/** Stable comparison key of an orphan list (fire change events only on real changes). */
export function orphansSignature(orphans: readonly OrphanedWorktree[]): string {
  return JSON.stringify(
    orphans.map((o) => [o.repoRoot, o.path, o.branch, o.head, o.baseRef, !!o.locked, !!o.prunable]),
  );
}

/** Summary used by the clean-up QuickPick. */
export interface OrphanSummary {
  uncommitted?: number;
  commitsNotInBase?: number;
  baseRef?: string;
  error?: string;
}

/** "3 uncommitted, 2 commits not in main" / "clean" / "directory missing — will be pruned". */
export function describeOrphanSummary(orphan: OrphanedWorktree, summary: OrphanSummary): string {
  if (orphan.prunable) {
    return 'directory missing — will be pruned';
  }
  const parts: string[] = [];
  if (summary.uncommitted !== undefined) {
    parts.push(`${summary.uncommitted} uncommitted`);
  }
  if (summary.commitsNotInBase !== undefined) {
    parts.push(
      `${summary.commitsNotInBase} commit${summary.commitsNotInBase === 1 ? '' : 's'} not in ${summary.baseRef ?? 'base'}`,
    );
  }
  if (summary.error) {
    parts.push(`check failed: ${summary.error}`);
  }
  if (orphan.locked) {
    parts.push('locked');
  }
  return parts.join(', ') || 'clean';
}

/**
 * True when removing the worktree needs `--force` or may lose work: uncommitted changes, locked,
 * state unknown (check failed), or — when the branch is deleted too — commits not in the base.
 * Stale (prunable) entries are never risky.
 */
export function isRiskyOrphan(
  orphan: OrphanedWorktree,
  summary: OrphanSummary,
  options: { deleteBranch: boolean },
): boolean {
  if (orphan.prunable) {
    return false;
  }
  return (
    !!orphan.locked ||
    !!summary.error ||
    (summary.uncommitted ?? 0) > 0 ||
    (options.deleteBranch && !!orphan.branch && (summary.commitsNotInBase ?? 0) > 0)
  );
}
