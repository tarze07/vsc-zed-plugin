/**
 * Git operations behind the Agent Changes view (#10). Must not import `vscode`
 * (unit-tested under plain mocha); the view/commands talk to it through `ReviewService`.
 */
import * as fs from 'fs';
import * as nodePath from 'path';

import type { WorktreeInfo } from '../agents/types';
import { createGitRunner, GitError, type GitRunner } from '../worktrees/git';
import { mergeChanges, parseNameStatusZ, type ChangedFile } from '../worktrees/model';
import type { MergeResult, ReviewFile, ReviewService, ReviewTarget } from './types';

/** Max paths passed to one git invocation (keeps well below Windows' ~32k command-line limit). */
export const PATH_CHUNK_SIZE = 100;

/** Global options for every invocation: unquoted (UTF-8) paths. */
const BASE_ARGS = ['-c', 'core.quotePath=false'];
/** Paths given by callers are literal file names, never pathspec magic (`:(top)`, globs, …). */
const LITERAL = '--literal-pathspecs';

/** Splits `items` into chunks of at most `size` elements. */
export function chunk<T>(items: readonly T[], size = PATH_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Absolute path of the repo-relative `relPath` inside `root`, or throws when it would escape
 * `root` (`..`, absolute paths) or points into the `.git` directory.
 */
export function resolveInsideRoot(root: string, relPath: string): string {
  if (!relPath || relPath.includes('\0')) {
    throw new Error(`Invalid path: ${JSON.stringify(relPath)}`);
  }
  if (nodePath.isAbsolute(relPath) || /^[A-Za-z]:[\\/]/.test(relPath)) {
    throw new Error(`Refusing to touch a path outside the repository: ${relPath}`);
  }
  const base = nodePath.resolve(root);
  const resolved = nodePath.resolve(base, relPath);
  const rel = nodePath.relative(base, resolved);
  if (!rel || rel === '..' || rel.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(rel)) {
    throw new Error(`Refusing to touch a path outside the repository: ${relPath}`);
  }
  if (rel.split(/[\\/]/)[0].toLowerCase() === '.git') {
    throw new Error(`Refusing to touch a path inside .git: ${relPath}`);
  }
  return resolved;
}

/** True when the real (symlink-resolved) parent directory of `abs` is inside the real `root`. */
function parentIsInsideRoot(root: string, abs: string): boolean {
  try {
    const realRoot = fs.realpathSync.native(root);
    const realParent = fs.realpathSync.native(nodePath.dirname(abs));
    const rel = nodePath.relative(realRoot, realParent);
    return (
      rel === '' ||
      (rel !== '..' && !rel.startsWith(`..${nodePath.sep}`) && !nodePath.isAbsolute(rel))
    );
  } catch {
    return false; // parent missing → nothing to delete
  }
}

function uniq(items: Iterable<string>): string[] {
  return [...new Set(items)];
}

function splitZ(output: string): string[] {
  return output.split('\0').filter((p) => p !== '');
}

export class GitReviewService implements ReviewService {
  constructor(private readonly git: GitRunner = createGitRunner()) {}

  private run(args: readonly string[], cwd: string, timeout?: number) {
    return this.git([...BASE_ARGS, ...args], { cwd, timeout });
  }

  private async tryRun(args: readonly string[], cwd: string): Promise<string | undefined> {
    try {
      return (await this.run(args, cwd)).stdout;
    } catch (error) {
      if (error instanceof GitError && error.code === undefined) {
        return undefined; // git ran and failed
      }
      throw error; // git missing / timed out
    }
  }

  /**
   * - worktree: cwd = worktree path, baseCommit = merge-base(baseRef, HEAD) (falls back to `baseRef` itself).
   * - otherwise: cwd = repository root of `cwd`, baseCommit = HEAD.
   * Returns undefined when the directory does not exist, is not inside a git repository, or the
   * repository has no commits yet (nothing to compare against).
   */
  async resolveTarget(input: {
    cwd?: string;
    worktree?: WorktreeInfo;
  }): Promise<ReviewTarget | undefined> {
    const dir = input.worktree?.path ?? input.cwd;
    if (!dir || !fs.existsSync(dir)) {
      return undefined;
    }
    const top = await this.tryRun(['rev-parse', '--show-toplevel'], dir);
    if (top === undefined || !top.trim()) {
      return undefined;
    }
    const root = nodePath.normalize(top.trim());
    const wt = input.worktree;
    if (wt) {
      const mergeBase =
        (await this.tryRun(['merge-base', wt.baseRef, 'HEAD'], root)) ??
        (await this.tryRun(['rev-parse', '--verify', '--quiet', `${wt.baseRef}^{commit}`], root));
      if (!mergeBase?.trim()) {
        throw new Error(
          `Cannot resolve base "${wt.baseRef}" of worktree ${wt.path} (branch deleted or unrelated history?)`,
        );
      }
      return {
        cwd: wt.path,
        root,
        baseCommit: mergeBase.trim(),
        baseLabel: wt.baseRef,
        worktree: wt,
      };
    }
    const head = await this.tryRun(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], root);
    if (!head?.trim()) {
      return undefined; // unborn branch: no commits yet
    }
    return { cwd: root, root, baseCommit: head.trim(), baseLabel: 'HEAD' };
  }

  async listChanges(target: ReviewTarget): Promise<ReviewFile[]> {
    const cwd = target.root;
    const [diff, untracked] = await Promise.all([
      this.run(
        ['diff', '--name-status', '-z', '-M', '--no-ext-diff', target.baseCommit, '--'],
        cwd,
      ),
      this.run(['ls-files', '--others', '--exclude-standard', '-z'], cwd),
    ]);
    const untrackedFiles: ChangedFile[] = splitZ(untracked.stdout).map((p) => ({
      path: p,
      kind: '?',
    }));
    return mergeChanges(parseNameStatusZ(diff.stdout), untrackedFiles)
      .map((f): ReviewFile =>
        f.originalPath !== undefined ? { ...f } : { path: f.path, kind: f.kind },
      )
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async baseContent(target: ReviewTarget, file: ReviewFile): Promise<string | undefined> {
    if (file.kind === 'A' || file.kind === '?') {
      return undefined;
    }
    const p =
      (file.kind === 'R' || file.kind === 'C') && file.originalPath ? file.originalPath : file.path;
    return this.tryRun(['show', `${target.baseCommit}:${p}`], target.root);
  }

  async accept(target: ReviewTarget, files: readonly ReviewFile[]): Promise<void> {
    const root = target.root;
    const paths = uniq(
      files.flatMap((f) => (f.originalPath !== undefined ? [f.path, f.originalPath] : [f.path])),
    );
    for (const p of paths) {
      resolveInsideRoot(root, p);
    }
    // `git add -- <p>` fails for a path that is neither on disk nor in the index (e.g. a rename
    // source already committed away on the agent branch); those have nothing left to stage.
    const indexed = await this.indexedPaths(root, paths);
    const toAdd = paths.filter((p) => indexed.has(p) || fs.existsSync(resolveInsideRoot(root, p)));
    for (const part of chunk(toAdd)) {
      await this.run([LITERAL, 'add', '-A', '--', ...part], root);
    }
  }

  async reject(target: ReviewTarget, files: readonly ReviewFile[]): Promise<void> {
    const root = target.root;
    const restore: string[] = [];
    const remove: string[] = [];
    for (const f of files) {
      resolveInsideRoot(root, f.path);
      if (f.originalPath !== undefined) {
        resolveInsideRoot(root, f.originalPath);
      }
      switch (f.kind) {
        case 'A':
        case '?':
          remove.push(f.path);
          break;
        case 'R':
        case 'C':
          if (f.originalPath !== undefined) {
            restore.push(f.originalPath);
          }
          remove.push(f.path);
          break;
        default: // M, T, D, U
          restore.push(f.path);
          break;
      }
    }
    // A path listed as M/D/… that does not exist at base is removed instead (defensive).
    const inBase = await this.pathsInCommit(root, target.baseCommit, uniq([...restore, ...remove]));
    const toRestore = uniq(restore.filter((p) => inBase.has(p)));
    const toRemove = uniq([...remove, ...restore.filter((p) => !inBase.has(p))]).filter(
      (p) => !toRestore.includes(p),
    );

    for (const part of chunk(toRestore)) {
      await this.restoreFromBase(root, target.baseCommit, part);
    }
    if (toRemove.length) {
      const indexed = await this.indexedPaths(root, toRemove);
      for (const part of chunk(toRemove.filter((p) => indexed.has(p)))) {
        await this.run(
          [LITERAL, 'rm', '-f', '--cached', '--quiet', '--ignore-unmatch', '--', ...part],
          root,
        );
      }
      for (const p of toRemove) {
        const abs = resolveInsideRoot(root, p);
        if (!parentIsInsideRoot(root, abs)) {
          continue; // reached through a symlinked directory: never delete outside the repository
        }
        fs.rmSync(abs, { force: true });
        this.pruneEmptyParents(root, abs);
      }
    }
  }

  async commitAll(target: ReviewTarget, message: string): Promise<void> {
    const cwd = target.root;
    await this.run(['add', '-A'], cwd);
    try {
      await this.run(['diff', '--cached', '--quiet', '--no-ext-diff'], cwd);
      throw new Error('Nothing to commit: there are no changes in the working tree.');
    } catch (error) {
      if (!(error instanceof GitError && error.exitCode === 1)) {
        throw error;
      }
    }
    await this.run(['commit', '--quiet', '-m', message], cwd);
  }

  async mergeIntoBase(target: ReviewTarget): Promise<MergeResult> {
    const wt = target.worktree;
    if (!wt) {
      return { merged: false, message: 'Only worktree sessions can be merged into a base branch.' };
    }
    const baseBranch = wt.baseRef.replace(/^refs\/heads\//, '');
    if ((await this.statusPorcelain(wt.path, true)).length) {
      return {
        merged: false,
        message: `Worktree ${wt.path} has uncommitted changes; commit or reject them first.`,
      };
    }
    const current = (
      await this.tryRun(['symbolic-ref', '--quiet', '--short', 'HEAD'], wt.repoRoot)
    )?.trim();
    if (current !== baseBranch) {
      return {
        merged: false,
        message: `Base branch "${baseBranch}" is not checked out in ${wt.repoRoot}${current ? ` (current: ${current})` : ''}.`,
      };
    }
    // Untracked files in the main repository are ignored here; if one would be overwritten,
    // git refuses the merge before touching anything and the error is reported below.
    if ((await this.statusPorcelain(wt.repoRoot, false)).length) {
      return {
        merged: false,
        message: `The main repository ${wt.repoRoot} has uncommitted changes.`,
      };
    }
    try {
      await this.run(['merge', '--no-ff', '--no-edit', wt.branch], wt.repoRoot, 120_000);
      return { merged: true, message: `Merged ${wt.branch} into ${baseBranch}.` };
    } catch (error) {
      if (!(error instanceof GitError)) {
        throw error;
      }
      await this.tryRun(['merge', '--abort'], wt.repoRoot);
      const detail = summarize(`${error.stdout}\n${error.stderr}`) || error.message;
      return {
        merged: false,
        message: `Merge of ${wt.branch} into ${baseBranch} failed and was aborted: ${detail}`,
      };
    }
  }

  // ---- helpers ----

  private async statusPorcelain(cwd: string, includeUntracked: boolean): Promise<string[]> {
    const { stdout } = await this.run(
      [
        'status',
        '--porcelain',
        '-z',
        includeUntracked ? '--untracked-files=all' : '--untracked-files=no',
      ],
      cwd,
    );
    return splitZ(stdout);
  }

  /** Subset of `paths` present in the index. */
  private async indexedPaths(root: string, paths: readonly string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (const part of chunk(paths)) {
      const { stdout } = await this.run(
        [LITERAL, 'ls-files', '--cached', '-z', '--', ...part],
        root,
      );
      for (const p of splitZ(stdout)) {
        found.add(p);
      }
    }
    return found;
  }

  /** Subset of `paths` that exist (as files) in `commit`. */
  private async pathsInCommit(
    root: string,
    commit: string,
    paths: readonly string[],
  ): Promise<Set<string>> {
    const found = new Set<string>();
    for (const part of chunk(paths)) {
      const { stdout } = await this.run(
        [LITERAL, 'ls-tree', '-r', '-z', '--name-only', '--full-tree', commit, '--', ...part],
        root,
      );
      for (const p of splitZ(stdout)) {
        found.add(p);
      }
    }
    return found;
  }

  /** Index + working tree of `paths` := `commit`. Uses `git checkout` on git < 2.23 (no `restore`). */
  private async restoreFromBase(
    root: string,
    commit: string,
    paths: readonly string[],
  ): Promise<void> {
    try {
      await this.run(
        [LITERAL, 'restore', `--source=${commit}`, '--staged', '--worktree', '--', ...paths],
        root,
      );
    } catch (error) {
      if (
        error instanceof GitError &&
        /not a git command|unknown (sub)?command/i.test(error.stderr)
      ) {
        await this.run([LITERAL, 'checkout', commit, '--', ...paths], root);
        return;
      }
      throw error;
    }
  }

  /** Removes now-empty directories between `abs` and `root` (exclusive), like git does. */
  private pruneEmptyParents(root: string, abs: string): void {
    const base = nodePath.resolve(root);
    let dir = nodePath.dirname(abs);
    while (dir !== base && dir.startsWith(base + nodePath.sep)) {
      try {
        if (fs.readdirSync(dir).length > 0) {
          return;
        }
        fs.rmdirSync(dir);
      } catch {
        return;
      }
      dir = nodePath.dirname(dir);
    }
  }
}

/** Short, single-paragraph summary of git output (conflict lines first). */
function summarize(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const conflicts = lines.filter((l) => /^CONFLICT/.test(l));
  const picked = conflicts.length ? conflicts : lines;
  const text = picked.slice(0, 5).join('; ');
  return picked.length > 5 ? `${text}; …` : text;
}
