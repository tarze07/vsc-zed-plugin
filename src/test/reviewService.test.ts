import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { WorktreeInfo } from '../agents/types';
import { chunk, GitReviewService, resolveInsideRoot } from '../review/service';
import type { ReviewFile, ReviewTarget } from '../review/types';
import { createGitRunner, type GitRunner } from '../worktrees/git';
import { removeTmpDir } from './tmpDir';

const baseGit = createGitRunner();
/** Runner with local identity / defaults so tests do not depend on the user's git config. */
const git: GitRunner = (args, options) =>
  baseGit(
    [
      '-c',
      'user.name=Review Test',
      '-c',
      'user.email=review-test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'init.defaultBranch=main',
      '-c',
      'core.autocrlf=false',
      ...args,
    ],
    options,
  );

async function gitAvailable(): Promise<boolean> {
  try {
    await baseGit(['--version'], { cwd: os.tmpdir() });
    return true;
  } catch {
    return false;
  }
}

suite('review helpers', () => {
  test('chunk', () => {
    assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepStrictEqual(chunk([], 2), []);
    assert.strictEqual(chunk(Array.from({ length: 250 }, (_, i) => i)).length, 3);
  });

  test('resolveInsideRoot rejects traversal, absolute paths and .git', () => {
    const root = path.resolve(os.tmpdir(), 'repo');
    assert.strictEqual(resolveInsideRoot(root, 'a/b.txt'), path.join(root, 'a', 'b.txt'));
    assert.strictEqual(resolveInsideRoot(root, '..foo'), path.join(root, '..foo'));
    for (const bad of [
      '../x',
      'a/../../x',
      '',
      '.',
      path.resolve(os.tmpdir(), 'x'),
      '.git/config',
      'C:/x',
    ]) {
      assert.throws(
        () => resolveInsideRoot(root, bad),
        /Invalid path|outside the repository|inside \.git/,
        bad,
      );
    }
  });
});

suite('review service (git CLI)', function () {
  this.timeout(60_000);

  let tmp: string;
  let repo: string;
  let service: GitReviewService;

  const read = (root: string, rel: string): string | undefined => {
    const p = path.join(root, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
  };
  const write = (root: string, rel: string, content: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  const out = async (args: string[], cwd: string): Promise<string> =>
    (await git(args, { cwd })).stdout;
  const kinds = (files: ReviewFile[]): string[] =>
    files.map((f) => `${f.kind} ${f.originalPath ? `${f.originalPath} -> ` : ''}${f.path}`);

  suiteSetup(async function () {
    if (!(await gitAvailable())) {
      this.skip();
    }
  });

  setup(async () => {
    // `.native` expands Windows 8.3 short names (e.g. RUNNER~1) so paths match what git reports.
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'zed-review-')));
    repo = path.join(tmp, 'my repo');
    fs.mkdirSync(repo);
    await git(['init', '--quiet'], { cwd: repo });
    write(repo, 'README.md', 'hello\n');
    write(repo, 'mod.txt', 'mod base\n');
    write(repo, 'del.txt', 'del base\n');
    write(repo, 'old name.txt', 'rename me\nline 2\nline 3\nline 4\n');
    write(repo, 'keep.txt', 'keep\n');
    write(repo, 'sp ace/ż file.txt', 'unicode base\n');
    await git(['add', '.'], { cwd: repo });
    await git(['commit', '--quiet', '-m', 'initial'], { cwd: repo });
    service = new GitReviewService(git);
  });

  teardown(() => {
    // Best-effort: Windows may keep the temp dir locked after git exits.
    removeTmpDir(tmp);
  });

  /** Makes every kind of change in the working tree of `root`. */
  async function makeChanges(root: string): Promise<void> {
    write(root, 'mod.txt', 'mod changed\n');
    fs.rmSync(path.join(root, 'del.txt'));
    await git(['mv', 'old name.txt', 'new name.txt'], { cwd: root });
    write(root, 'added.txt', 'added\n');
    await git(['add', 'added.txt'], { cwd: root });
    write(root, 'untracked dir/new file.txt', 'untracked\n');
    write(root, 'sp ace/ż file.txt', 'unicode changed\n');
  }

  async function createWorktree(): Promise<WorktreeInfo> {
    const wtPath = path.join(tmp, 'wt x');
    await git(['worktree', 'add', '--quiet', '-b', 'agent/x', wtPath, 'main'], { cwd: repo });
    return { path: wtPath, branch: 'agent/x', baseRef: 'main', repoRoot: repo };
  }

  test('resolveTarget: non-worktree, subdirectory, not a repo, no commits', async () => {
    const head = (await out(['rev-parse', 'HEAD'], repo)).trim();
    const t = await service.resolveTarget({ cwd: path.join(repo, 'sp ace') });
    assert.deepStrictEqual(t, { cwd: repo, root: repo, baseCommit: head, baseLabel: 'HEAD' });

    assert.strictEqual(await service.resolveTarget({ cwd: tmp }), undefined);
    assert.strictEqual(await service.resolveTarget({ cwd: path.join(tmp, 'missing') }), undefined);
    assert.strictEqual(await service.resolveTarget({}), undefined);

    const empty = path.join(tmp, 'empty');
    fs.mkdirSync(empty);
    await git(['init', '--quiet'], { cwd: empty });
    assert.strictEqual(await service.resolveTarget({ cwd: empty }), undefined);
  });

  test('resolveTarget: worktree uses merge-base with baseRef', async () => {
    const base = (await out(['rev-parse', 'HEAD'], repo)).trim();
    const wt = await createWorktree();
    write(wt.path, 'agent.txt', 'agent\n');
    await git(['add', '.'], { cwd: wt.path });
    await git(['commit', '--quiet', '-m', 'agent work'], { cwd: wt.path });
    // main moves on: the merge-base stays at the fork point.
    write(repo, 'main.txt', 'main\n');
    await git(['add', '.'], { cwd: repo });
    await git(['commit', '--quiet', '-m', 'main work'], { cwd: repo });

    const t = await service.resolveTarget({ worktree: wt });
    assert.ok(t);
    assert.strictEqual(t.cwd, wt.path);
    assert.strictEqual(t.root, wt.path);
    assert.strictEqual(t.baseCommit, base);
    assert.strictEqual(t.baseLabel, 'main');
    assert.strictEqual(t.worktree, wt);
  });

  test('listChanges: all kinds, unicode/space paths, committed agent change', async () => {
    const wt = await createWorktree();
    write(wt.path, 'committed.txt', 'committed on branch\n');
    await git(['add', '.'], { cwd: wt.path });
    await git(['commit', '--quiet', '-m', 'agent commit'], { cwd: wt.path });
    await makeChanges(wt.path);

    const t = await service.resolveTarget({ worktree: wt });
    assert.ok(t);
    assert.deepStrictEqual(kinds(await service.listChanges(t)), [
      'A added.txt',
      'A committed.txt',
      'D del.txt',
      'M mod.txt',
      'R old name.txt -> new name.txt',
      'M sp ace/ż file.txt',
      '? untracked dir/new file.txt',
    ]);
  });

  test('listChanges: non-worktree shows only uncommitted changes', async () => {
    write(repo, 'mod.txt', 'x\n');
    const t = await service.resolveTarget({ cwd: repo });
    assert.ok(t);
    assert.deepStrictEqual(await service.listChanges(t), [{ path: 'mod.txt', kind: 'M' }]);
  });

  test('baseContent', async () => {
    await makeChanges(repo);
    const t = (await service.resolveTarget({ cwd: repo }))!;
    const files = await service.listChanges(t);
    const by = (p: string): ReviewFile => files.find((f) => f.path === p)!;
    assert.strictEqual(await service.baseContent(t, by('mod.txt')), 'mod base\n');
    assert.strictEqual(await service.baseContent(t, by('del.txt')), 'del base\n');
    assert.strictEqual(
      await service.baseContent(t, by('new name.txt')),
      'rename me\nline 2\nline 3\nline 4\n',
    );
    assert.strictEqual(await service.baseContent(t, by('sp ace/ż file.txt')), 'unicode base\n');
    assert.strictEqual(await service.baseContent(t, by('added.txt')), undefined);
    assert.strictEqual(await service.baseContent(t, by('untracked dir/new file.txt')), undefined);
    assert.strictEqual(await service.baseContent(t, { path: 'nope.txt', kind: 'M' }), undefined);
  });

  test('accept stages the files (both sides of renames, deletions, untracked)', async () => {
    await makeChanges(repo);
    // Unstage the rename so accept has to stage both sides itself.
    await git(['reset', '--quiet'], { cwd: repo });
    const t = (await service.resolveTarget({ cwd: repo }))!;
    const files: ReviewFile[] = [
      { path: 'mod.txt', kind: 'M' },
      { path: 'del.txt', kind: 'D' },
      { path: 'new name.txt', originalPath: 'old name.txt', kind: 'R' },
      { path: 'untracked dir/new file.txt', kind: '?' },
      { path: 'sp ace/ż file.txt', kind: 'M' },
    ];
    await service.accept(t, files);
    const staged = await out(
      ['-c', 'core.quotePath=false', 'diff', '--cached', '--name-status', '-M'],
      repo,
    );
    assert.deepStrictEqual(
      staged.trim().split('\n').sort(),
      ['D\tdel.txt', 'M\tmod.txt', 'M\tsp ace/ż file.txt', 'R100\told name.txt\tnew name.txt']
        .concat(['A\tuntracked dir/new file.txt'])
        .sort(),
    );
    // added.txt was not in the list: still staged only because makeChanges staged it.
    assert.deepStrictEqual(kinds(await service.listChanges(t)).length, 6);
    await service.accept(t, []); // no-op
  });

  test('accept skips rename sources already committed away', async () => {
    const wt = await createWorktree();
    await git(['mv', 'old name.txt', 'new name.txt'], { cwd: wt.path });
    await git(['commit', '--quiet', '-m', 'rename'], { cwd: wt.path });
    write(wt.path, 'new name.txt', 'rename me\nline 2\nline 3\nline 4\nmore\n');
    const t = (await service.resolveTarget({ worktree: wt }))!;
    const files = await service.listChanges(t);
    assert.deepStrictEqual(kinds(files), ['R old name.txt -> new name.txt']);
    await service.accept(t, files);
    assert.strictEqual((await out(['diff', '--name-only'], wt.path)).trim(), '');
  });

  test('reject restores every kind to base and touches nothing else', async () => {
    const wt = await createWorktree();
    write(wt.path, 'committed.txt', 'committed on branch\n');
    write(wt.path, 'keep.txt', 'keep changed\n');
    await git(['add', '.'], { cwd: wt.path });
    await git(['commit', '--quiet', '-m', 'agent commit'], { cwd: wt.path });
    // keep.txt changed in the commit: must stay as it is (not in the reject list).
    await makeChanges(wt.path);
    write(wt.path, 'other untracked.txt', 'stay\n');
    const t = (await service.resolveTarget({ worktree: wt }))!;
    const all = await service.listChanges(t);
    const toReject = all.filter((f) => f.path !== 'keep.txt' && f.path !== 'other untracked.txt');
    assert.strictEqual(toReject.length, 7);

    await service.reject(t, toReject);

    assert.strictEqual(read(wt.path, 'mod.txt'), 'mod base\n');
    assert.strictEqual(read(wt.path, 'del.txt'), 'del base\n');
    assert.strictEqual(read(wt.path, 'old name.txt'), 'rename me\nline 2\nline 3\nline 4\n');
    assert.strictEqual(read(wt.path, 'new name.txt'), undefined);
    assert.strictEqual(read(wt.path, 'added.txt'), undefined);
    assert.strictEqual(read(wt.path, 'committed.txt'), undefined);
    assert.strictEqual(read(wt.path, 'sp ace/ż file.txt'), 'unicode base\n');
    assert.strictEqual(read(wt.path, 'untracked dir/new file.txt'), undefined);
    assert.ok(!fs.existsSync(path.join(wt.path, 'untracked dir')), 'empty dir pruned');
    // Untouched:
    assert.strictEqual(read(wt.path, 'keep.txt'), 'keep changed\n');
    assert.strictEqual(read(wt.path, 'other untracked.txt'), 'stay\n');
    assert.deepStrictEqual(kinds(await service.listChanges(t)), [
      'M keep.txt',
      '? other untracked.txt',
    ]);
    // Index matches base for the rejected files too.
    const staged = await out(['diff', '--cached', '--name-only', t.baseCommit], wt.path);
    assert.deepStrictEqual(staged.trim().split('\n'), ['keep.txt']);
  });

  test('reject of a copy keeps the original and removes the copy', async () => {
    write(repo, 'copy.txt', 'mod base\n');
    await git(['add', 'copy.txt'], { cwd: repo });
    const t = (await service.resolveTarget({ cwd: repo }))!;
    await service.reject(t, [{ path: 'copy.txt', originalPath: 'mod.txt', kind: 'C' }]);
    assert.strictEqual(read(repo, 'copy.txt'), undefined);
    assert.strictEqual(read(repo, 'mod.txt'), 'mod base\n');
    assert.deepStrictEqual(await service.listChanges(t), []);
  });

  test('reject refuses paths outside the repository', async () => {
    const outside = path.join(tmp, 'outside.txt');
    fs.writeFileSync(outside, 'precious\n');
    write(repo, 'mod.txt', 'changed\n');
    const t = (await service.resolveTarget({ cwd: repo }))!;
    for (const bad of ['../outside.txt', 'a/../../outside.txt', outside, '.git/HEAD']) {
      await assert.rejects(
        service.reject(t, [
          { path: 'mod.txt', kind: 'M' },
          { path: bad, kind: '?' },
        ]),
        /outside the repository|inside \.git/,
      );
      await assert.rejects(service.accept(t, [{ path: bad, kind: '?' }]));
    }
    assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'precious\n');
    // Validation happens before anything is touched.
    assert.strictEqual(read(repo, 'mod.txt'), 'changed\n');
    assert.ok(fs.existsSync(path.join(repo, '.git', 'HEAD')));
  });

  test('reject does not delete through a symlinked directory', async function () {
    const outsideDir = path.join(tmp, 'outside');
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(path.join(outsideDir, 'f.txt'), 'precious\n');
    try {
      fs.symlinkSync(outsideDir, path.join(repo, 'link'), 'dir');
    } catch {
      this.skip(); // no symlink permission (Windows)
    }
    const t = (await service.resolveTarget({ cwd: repo }))!;
    await service.reject(t, [{ path: 'link/f.txt', kind: '?' }]);
    assert.strictEqual(fs.readFileSync(path.join(outsideDir, 'f.txt'), 'utf8'), 'precious\n');
  });

  test('commitAll commits everything; errors when nothing to commit', async () => {
    await makeChanges(repo);
    const t = (await service.resolveTarget({ cwd: repo }))!;
    await service.commitAll(t, 'agent: all changes');
    assert.strictEqual(
      (await out(['log', '-1', '--format=%s'], repo)).trim(),
      'agent: all changes',
    );
    assert.strictEqual((await out(['status', '--porcelain'], repo)).trim(), '');
    await assert.rejects(service.commitAll(t, 'again'), /Nothing to commit/);
  });

  test('mergeIntoBase: success', async () => {
    const wt = await createWorktree();
    write(wt.path, 'agent.txt', 'agent\n');
    const t = (await service.resolveTarget({ worktree: wt }))!;
    await service.commitAll(t, 'agent work');
    const r = await service.mergeIntoBase(t);
    assert.strictEqual(r.merged, true, r.message);
    assert.strictEqual(read(repo, 'agent.txt'), 'agent\n');
    // --no-ff: a merge commit with two parents.
    const parents = (await out(['log', '-1', '--format=%P'], repo)).trim().split(' ');
    assert.strictEqual(parents.length, 2);
  });

  test('mergeIntoBase refusals: no worktree, dirty worktree, base not checked out, dirty main', async () => {
    const nonWt = (await service.resolveTarget({ cwd: repo }))!;
    assert.strictEqual((await service.mergeIntoBase(nonWt)).merged, false);

    const wt = await createWorktree();
    write(wt.path, 'agent.txt', 'agent\n');
    const t = (await service.resolveTarget({ worktree: wt }))!;
    let r = await service.mergeIntoBase(t);
    assert.strictEqual(r.merged, false);
    assert.match(r.message, /uncommitted/);

    await service.commitAll(t, 'agent work');
    await git(['checkout', '--quiet', '-b', 'other'], { cwd: repo });
    r = await service.mergeIntoBase(t);
    assert.strictEqual(r.merged, false);
    assert.match(r.message, /not checked out/);
    assert.match(r.message, /other/);

    await git(['checkout', '--quiet', 'main'], { cwd: repo });
    write(repo, 'README.md', 'dirty\n');
    r = await service.mergeIntoBase(t);
    assert.strictEqual(r.merged, false);
    assert.match(r.message, /main repository/);
    assert.strictEqual(read(repo, 'agent.txt'), undefined);
  });

  test('mergeIntoBase: conflict is aborted', async () => {
    const wt = await createWorktree();
    write(wt.path, 'mod.txt', 'agent version\n');
    const t = (await service.resolveTarget({ worktree: wt }))!;
    await service.commitAll(t, 'agent work');
    write(repo, 'mod.txt', 'main version\n');
    await git(['commit', '--quiet', '-am', 'main work'], { cwd: repo });
    const headBefore = (await out(['rev-parse', 'HEAD'], repo)).trim();

    const r = await service.mergeIntoBase(t);
    assert.strictEqual(r.merged, false);
    assert.match(r.message, /CONFLICT/);
    assert.match(r.message, /aborted/);
    assert.strictEqual((await out(['rev-parse', 'HEAD'], repo)).trim(), headBefore);
    assert.strictEqual((await out(['status', '--porcelain'], repo)).trim(), '');
    assert.strictEqual(read(repo, 'mod.txt'), 'main version\n');
    assert.ok(!fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD')));
  });

  test('handles many paths (chunked)', async () => {
    const t = (await service.resolveTarget({ cwd: repo }))!;
    const files: ReviewFile[] = [];
    for (let i = 0; i < 250; i++) {
      write(repo, `many/f${i}.txt`, `${i}\n`);
      files.push({ path: `many/f${i}.txt`, kind: '?' });
    }
    await service.accept(t, files);
    assert.strictEqual(
      (await out(['diff', '--cached', '--name-only'], repo)).trim().split('\n').length,
      250,
    );
    const listed = await service.listChanges(t);
    assert.strictEqual(listed.length, 250);
    await service.reject(t, listed);
    assert.ok(!fs.existsSync(path.join(repo, 'many')));
    assert.deepStrictEqual(await service.listChanges(t as ReviewTarget), []);
  });
});
