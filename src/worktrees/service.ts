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
      return { path: wtPath, branch, baseRef, repoRoot };
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Could not find a free branch name for the worktree');
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

  /** Number of commits on the worktree's `HEAD` that are not reachable from `baseRef`. */
  async countCommitsNotInBase(wtPath: string, baseRef: string): Promise<number> {
    const { stdout } = await this.git(['rev-list', '--count', `${baseRef}..HEAD`, '--'], {
      cwd: wtPath,
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
    if (fs.existsSync(info.path)) {
      const args = ['worktree', 'remove'];
      if (options.force) {
        args.push('--force');
      }
      args.push('--', info.path);
      await this.git(args, { cwd, timeout: this.addTimeout });
    } else {
      // Directory already gone (deleted by hand): drop the stale administrative entry.
      await this.git(['worktree', 'prune'], { cwd });
    }
    if (!options.deleteBranch) {
      return { branchDeleted: false };
    }
    try {
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
