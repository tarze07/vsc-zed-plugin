import type { WorktreeInfo } from '../agents/types';
import type { ChangeKind } from '../worktrees/model';

/**
 * Shared #10 contract between the review git service (src/review/service.ts) and the
 * Agent Changes view/commands (src/review/view.ts, src/review/commands.ts).
 * No `vscode` import: the service must stay testable under plain mocha.
 */

/** A file changed by an agent. `path` is repo-relative with `/`. */
export interface ReviewFile {
  path: string;
  /** Previous path for renames/copies. */
  originalPath?: string;
  kind: ChangeKind;
}

/** What is being reviewed for one session. */
export interface ReviewTarget {
  /** Working directory of the session: worktree path, or the repository root for non-worktree sessions. */
  cwd: string;
  /** Repository root of `cwd` (worktree root for worktree sessions). */
  root: string;
  /**
   * Commit changes are compared against:
   * - worktree session: merge-base of `worktree.baseRef` and the worktree HEAD,
   * - non-worktree session: `HEAD` of the repository (i.e. uncommitted changes only).
   */
  baseCommit: string;
  /** Human-readable base, e.g. "main" or "HEAD". */
  baseLabel: string;
  worktree?: WorktreeInfo;
}

export interface MergeResult {
  merged: boolean;
  /** Human-readable summary or the reason it did not merge (e.g. base branch not checked out, conflicts). */
  message: string;
}

export interface ReviewService {
  /** Resolves the review target for a session cwd/worktree; undefined if `cwd` is not inside a git repository. */
  resolveTarget(input: {
    cwd?: string;
    worktree?: WorktreeInfo;
  }): Promise<ReviewTarget | undefined>;
  /** Committed (since baseCommit) + uncommitted + untracked changes, sorted by path. */
  listChanges(target: ReviewTarget): Promise<ReviewFile[]>;
  /** File content at `baseCommit` (uses `originalPath` for renames); undefined when the file did not exist there. */
  baseContent(target: ReviewTarget, file: ReviewFile): Promise<string | undefined>;
  /** Stage the files (`git add -A -- <paths>`; handles deletions and both sides of renames). */
  accept(target: ReviewTarget, files: readonly ReviewFile[]): Promise<void>;
  /**
   * Revert files to their `baseCommit` state in the working tree and index: modified/deleted →
   * restored, added/untracked → removed, renamed → original restored and new path removed.
   * Note: for worktree sessions this reverts only the working tree/index; commits on the agent branch are not rewritten.
   */
  reject(target: ReviewTarget, files: readonly ReviewFile[]): Promise<void>;
  /** Stage everything and commit with `message` (no-op error if nothing to commit). */
  commitAll(target: ReviewTarget, message: string): Promise<void>;
  /**
   * Merge the agent branch into its base (`git merge --no-ff <branch>` run in `worktree.repoRoot`).
   * Only when the worktree has no uncommitted changes and the main repository currently has
   * `worktree.baseRef` checked out with a clean working tree; otherwise returns merged=false with a reason.
   * On conflicts: `git merge --abort` and merged=false.
   */
  mergeIntoBase(target: ReviewTarget): Promise<MergeResult>;
}
