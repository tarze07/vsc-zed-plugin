/**
 * `git worktree` operations for agent sessions (#9). Must not import `vscode`
 * (unit-tested under plain mocha); settings are passed in by the caller.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';

import type { WorktreeInfo } from '../agents/types';
import { createGitRunner, GitError, type GitRunner } from './git';
import {
  makeBranchName,
  mergeChanges,
  parseNameStatusZ,
  parseStatusPorcelainZ,
  parseWorktreeList,
  randomShortId,
  resolveWorktreesDir,
  worktreePathFor,
  type ChangedFile,
  type WorktreeEntry,
} from './model';

export interface CreateWorktreeOptions {
  repoRoot: string;
  agentId: string;
  /** Ref the new branch starts from (branch name or sha). */
  baseRef: string;
  /** `zedLayout.worktrees.directory` (default `""`). */
  directory?: string;
  /** `zedLayout.worktrees.branchPrefix` (default `"agent/"`). */
  branchPrefix?: string;
}

export interface RemoveWorktreeOptions {
  /** `git worktree remove --force` (discards uncommitted changes). */
  force?: boolean;
  /** Worktree is locked: pass `--force` twice (implies `force`). */
  locked?: boolean;
  /** Only `git worktree prune` (stale entry whose directory is gone or unusable). */
  prune?: boolean;
  /** Also `git branch -D <branch>`. */
  deleteBranch?: boolean;
}

export interface RemoveWorktreeResult {
  /** True when the branch was deleted. */
  branchDeleted: boolean;
  /** Set when deleting the branch was requested but failed (worktree removal itself succeeded). */
  branchError?: string;
}

export interface WorktreeChanges {
  /** Commit the comparison starts from: merge-base of `baseRef` and the worktree `HEAD`. */
  baseCommit: string;
  /** Committed + uncommitted + untracked changes since `baseCommit`. */
  files: ChangedFile[];
}

export interface WorktreeServiceOptions {
  /** Short id generator (default: 6 random hex chars). */
  shortId?: () => string;
  /** Attempts on branch/path collision (default 5). */
  maxAttempts?: number;
  /** Timeout for `git worktree add` (checkout of large repos), ms. */
  addTimeout?: number;
}

const DEFAULT_PREFIX = 'agent/';

/** Git config variable (in section `branch.<name>`) holding the ref an agent branch was created from. */
export const BASE_CONFIG_KEY = 'zedLayoutBase';

function baseConfigKey(branch: string): string {
  return `branch.${branch}.${BASE_CONFIG_KEY}`;
}

export class WorktreeService {
  private readonly shortId: () => string;
  private readonly maxAttempts: number;
  private readonly addTimeout: number;

  constructor(
    private readonly git: GitRunner = createGitRunner(),
    options: WorktreeServiceOptions = {},
  ) {
    this.shortId = options.shortId ?? (() => randomShortId(6));
    this.maxAttempts = options.maxAttempts ?? 5;
    this.addTimeout = options.addTimeout ?? 120_000;
  }

  /** Top-level directory of the repository containing `cwd`; throws `GitError` if not a repo. */
  async getRepoRoot(cwd: string): Promise<string> {
    const { stdout } = await this.git(['rev-parse', '--show-toplevel'], { cwd });
    return nodePath.normalize(stdout.trim());
  }

  /** Repo root or `undefined` when `cwd` is not inside a git work tree (or git is missing). */
  async tryGetRepoRoot(cwd: string): Promise<string | undefined> {
    try {
      return await this.getRepoRoot(cwd);
    } catch {
      return undefined;
    }
  }

  /** Current branch name, or the commit sha when HEAD is detached. */
  async currentRef(repoRoot: string): Promise<string> {
    try {
      const { stdout } = await this.git(['symbolic-ref', '--quiet', '--short', 'HEAD'], {
        cwd: repoRoot,
      });
      const branch = stdout.trim();
      if (branch) {
        return branch;
      }
    } catch {
      // Detached HEAD: fall through to the sha.
    }
    const { stdout } = await this.git(['rev-parse', 'HEAD'], { cwd: repoRoot });
    return stdout.trim();
  }

  /** Resolves `ref` to a commit sha; throws `GitError` when it is not a valid commit. */
  async resolveCommit(cwd: string, ref: string): Promise<string> {
    const { stdout } = await this.git(
      ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
      {
        cwd,
      },
    );
    return stdout.trim();
  }

  /** True when a local branch named `branch` exists. */
  async branchExists(repoRoot: string, branch: string): Promise<boolean> {
    try {
      await this.git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
        cwd: repoRoot,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Creates a new branch + worktree for an agent. Retries with a new short id on collision. */
  async create(options: CreateWorktreeOptions): Promise<WorktreeInfo> {
    const { repoRoot, agentId, baseRef } = options;
    const prefix = options.branchPrefix ?? DEFAULT_PREFIX;
    const dir = resolveWorktreesDir(repoRoot, options.directory, nodePath, os.homedir());
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const branch = makeBranchName(prefix, agentId, this.shortId());
      const wtPath = worktreePathFor(dir, branch);
      if (fs.existsSync(wtPath) || (await this.branchExists(repoRoot, branch))) {
        lastError = new Error(`Branch or path already exists: ${branch} (${wtPath})`);
        continue;
      }
      await fs.promises.mkdir(dir, { recursive: true });
      try {
        await this.git(['worktree', 'add', '-b', branch, '--', wtPath, baseRef], {
          cwd: repoRoot,
          timeout: this.addTimeout,
        });
      } catch (error) {
        if (error instanceof GitError && /already exists/i.test(error.stderr)) {
          lastError = error;
          continue;
        }
        throw error;
      }
      await this.recordBaseRef(repoRoot, branch, baseRef);
      return { path: wtPath, branch, baseRef, repoRoot };
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Could not find a free branch name for the worktree');
  }

  /** Stores `baseRef` in `branch.<branch>.zedLayoutBase` (best effort; never throws). */
  async recordBaseRef(repoRoot: string, branch: string, baseRef: string): Promise<boolean> {
    try {
      await this.git(['config', baseConfigKey(branch), baseRef], { cwd: repoRoot });
      return true;
    } catch {
      return false;
    }
  }

  /** Base ref recorded for `branch` at creation, or `undefined`. */
  async readBaseRef(repoRoot: string, branch: string): Promise<string | undefined> {
    try {
      const { stdout } = await this.git(['config', '--get', baseConfigKey(branch)], {
        cwd: repoRoot,
      });
      return stdout.trim() || undefined;
    } catch {
      // Exit code 1: not set.
      return undefined;
    }
  }

  /** All recorded base refs of the repository (one `git config` call): branch → base ref. */
  async readBaseRefs(repoRoot: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    let stdout: string;
    try {
      ({ stdout } = await this.git(
        ['config', '-z', '--get-regexp', `^branch\\..*\\.${BASE_CONFIG_KEY.toLowerCase()}$`],
        { cwd: repoRoot },
      ));
    } catch {
      return result;
    }
    const suffix = `.${BASE_CONFIG_KEY.toLowerCase()}`;
    // `-z`: records "<key>\n<value>\0".
    for (const record of stdout.split('\0')) {
      const nl = record.indexOf('\n');
      if (nl === -1) {
        continue;
      }
      const key = record.slice(0, nl);
      const value = record.slice(nl + 1).trim();
      if (key.startsWith('branch.') && key.toLowerCase().endsWith(suffix) && value) {
        result.set(key.slice('branch.'.length, key.length - suffix.length), value);
      }
    }
    return result;
  }

  /** Removes the recorded base ref of `branch` (best effort). */
  async clearBaseRef(repoRoot: string, branch: string): Promise<void> {
    try {
      await this.git(['config', '--unset', baseConfigKey(branch)], { cwd: repoRoot });
    } catch {
      // Not set (exit 5) or the section is already gone.
    }
  }

  /**
   * The repository's default branch: `origin/HEAD` (as a local branch when it exists, else the
   * remote-tracking ref), then `main`, then `master`, then the current branch of `repoRoot`.
   */
  async defaultBranch(repoRoot: string): Promise<string> {
    try {
      const { stdout } = await this.git(
        ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
        { cwd: repoRoot },
      );
      const remoteRef = stdout.trim();
      if (remoteRef) {
        const local = remoteRef.replace(/^origin\//, '');
        return (await this.branchExists(repoRoot, local)) ? local : remoteRef;
      }
    } catch {
      // No origin/HEAD.
    }
    for (const candidate of ['main', 'master']) {
      if (await this.branchExists(repoRoot, candidate)) {
        return candidate;
      }
    }
    return this.currentRef(repoRoot);
  }

  /** Recorded base ref of `branch` when it still resolves to a commit, else `defaultBranch`. */
  async resolveBaseRef(repoRoot: string, branch: string | undefined): Promise<string> {
    const recorded = branch ? await this.readBaseRef(repoRoot, branch) : undefined;
    if (recorded) {
      try {
        await this.resolveCommit(repoRoot, recorded);
        return recorded;
      } catch {
        // Base branch deleted since: fall back.
      }
    }
    return this.defaultBranch(repoRoot);
  }

  /** `git worktree prune` (drops entries whose directory no longer exists). */
  async prune(repoRoot: string): Promise<void> {
    await this.git(['worktree', 'prune'], { cwd: repoRoot });
  }

  /** All worktrees of the repository (the main one first). */
  async list(repoRoot: string): Promise<WorktreeEntry[]> {
    const { stdout } = await this.git(['worktree', 'list', '--porcelain'], { cwd: repoRoot });
    return parseWorktreeList(stdout);
  }

  /** Uncommitted changes (staged, unstaged, untracked) in the worktree. */
  async uncommittedChanges(wtPath: string): Promise<ChangedFile[]> {
    const { stdout } = await this.git(['status', '--porcelain', '-z', '--untracked-files=all'], {
      cwd: wtPath,
    });
    return parseStatusPorcelainZ(stdout);
  }

  async hasUncommittedChanges(wtPath: string): Promise<boolean> {
    return (await this.uncommittedChanges(wtPath)).length > 0;
  }

  /**
   * Number of commits on `head` (default: the worktree's `HEAD`; run in `cwd`) that are not
   * reachable from `baseRef`.
   */
  async countCommitsNotInBase(cwd: string, baseRef: string, head = 'HEAD'): Promise<number> {
    const { stdout } = await this.git(['rev-list', '--count', `${baseRef}..${head}`, '--'], {
      cwd,
    });
    return Number.parseInt(stdout.trim(), 10) || 0;
  }

  async hasUnpushedOrUnmergedCommits(wtPath: string, baseRef: string): Promise<boolean> {
    return (await this.countCommitsNotInBase(wtPath, baseRef)) > 0;
  }

  /**
   * Changes in the worktree since it diverged from `baseRef`: committed and uncommitted
   * tracked changes (diff merge-base → working tree) plus untracked files.
   */
  async changes(info: WorktreeInfo): Promise<WorktreeChanges> {
    const cwd = info.path;
    let baseCommit: string;
    try {
      const { stdout } = await this.git(['merge-base', info.baseRef, 'HEAD'], { cwd });
      baseCommit = stdout.trim();
    } catch {
      baseCommit = await this.resolveCommit(cwd, info.baseRef);
    }
    const [diff, untracked] = await Promise.all([
      this.git(['diff', '--name-status', '-z', '--find-renames', baseCommit, '--'], { cwd }),
      this.git(['ls-files', '--others', '--exclude-standard', '-z'], { cwd }),
    ]);
    const untrackedFiles: ChangedFile[] = untracked.stdout
      .split('\0')
      .filter((p) => p !== '')
      .map((p) => ({ path: p, kind: '?' }));
    return { baseCommit, files: mergeChanges(parseNameStatusZ(diff.stdout), untrackedFiles) };
  }

  /** Content of `relPath` (repo-relative, `/` separated) at `commit`. */
  async showFile(cwd: string, commit: string, relPath: string): Promise<string> {
    const { stdout } = await this.git(['show', `${commit}:${relPath}`], { cwd });
    return stdout;
  }

  /** `git worktree remove [--force] <path>`, then optionally `git branch -D <branch>`. */
  async remove(
    info: WorktreeInfo,
    options: RemoveWorktreeOptions = {},
  ): Promise<RemoveWorktreeResult> {
    const cwd = info.repoRoot;
    if (!options.prune && fs.existsSync(info.path)) {
      const args = ['worktree', 'remove'];
      if (options.force || options.locked) {
        args.push('--force');
      }
      if (options.locked) {
        args.push('--force');
      }
      args.push('--', info.path);
      await this.git(args, { cwd, timeout: this.addTimeout });
    } else {
      // Directory already gone (deleted by hand): drop the stale administrative entry.
      await this.git(['worktree', 'prune'], { cwd });
    }
    if (!options.deleteBranch || !info.branch) {
      return { branchDeleted: false };
    }
    try {
      // Also drops the `branch.<name>` config section (incl. the recorded base ref).
      await this.git(['branch', '-D', '--', info.branch], { cwd });
      return { branchDeleted: true };
    } catch (error) {
      return {
        branchDeleted: false,
        branchError: error instanceof GitError ? error.detail : String(error),
      };
    }
  }
}
