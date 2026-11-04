import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createGitRunner, GitError, type GitRunner } from '../worktrees/git';
import { WorktreeService } from '../worktrees/service';

const baseGit = createGitRunner();
/** Runner with local identity / defaults so tests do not depend on the user's git config. */
const git: GitRunner = (args, options) =>
  baseGit(
    [
      '-c',
      'user.name=Worktree Test',
      '-c',
      'user.email=worktree-test@example.invalid',
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

suite('worktree service (git CLI)', function () {
  this.timeout(30_000);

  let tmp: string;
  let repo: string;
  let service: WorktreeService;

  suiteSetup(async function () {
    if (!(await gitAvailable())) {
      this.skip();
    }
  });

  setup(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zed-wt-')));
    repo = path.join(tmp, 'my repo');
    fs.mkdirSync(repo);
    await git(['init', '--quiet'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
    fs.writeFileSync(path.join(repo, 'old.txt'), 'old\n');
    await git(['add', '.'], { cwd: repo });
    await git(['commit', '--quiet', '-m', 'initial'], { cwd: repo });
    let n = 0;
    service = new WorktreeService(git, { shortId: () => `abc00${n++}` });
  });

  teardown(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('getRepoRoot and currentRef', async () => {
    fs.mkdirSync(path.join(repo, 'sub'));
    assert.strictEqual(await service.getRepoRoot(path.join(repo, 'sub')), repo);
    assert.strictEqual(await service.currentRef(repo), 'main');
    assert.strictEqual(await service.tryGetRepoRoot(tmp), undefined);

    const sha = (await git(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
    await git(['checkout', '--quiet', '--detach'], { cwd: repo });
    assert.strictEqual(await service.currentRef(repo), sha);
  });

  test('create, list, detect changes, compare and remove', async () => {
    const info = await service.create({ repoRoot: repo, agentId: 'claude', baseRef: 'main' });
    assert.deepStrictEqual(info, {
      path: path.join(tmp, 'my repo.worktrees', 'agent-claude-abc000'),
      branch: 'agent/claude-abc000',
      baseRef: 'main',
      repoRoot: repo,
    });
    assert.ok(fs.existsSync(path.join(info.path, 'README.md')));

    const list = await service.list(repo);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].branch, 'main');
    assert.strictEqual(fs.realpathSync(list[1].path), info.path);
    assert.strictEqual(list[1].branch, 'agent/claude-abc000');

    assert.strictEqual(await service.hasUncommittedChanges(info.path), false);
    assert.strictEqual(await service.hasUnpushedOrUnmergedCommits(info.path, info.baseRef), false);
    assert.deepStrictEqual((await service.changes(info)).files, []);

    // Uncommitted + untracked changes.
    fs.writeFileSync(path.join(info.path, 'README.md'), 'hello agent\n');
    fs.writeFileSync(path.join(info.path, 'new file.txt'), 'new\n');
    assert.strictEqual(await service.hasUncommittedChanges(info.path), true);
    assert.strictEqual((await service.uncommittedChanges(info.path)).length, 2);

    // A commit on the agent branch.
    await git(['rm', '--quiet', 'old.txt'], { cwd: info.path });
    await git(['commit', '--quiet', '-m', 'remove old'], { cwd: info.path });
    assert.strictEqual(await service.countCommitsNotInBase(info.path, info.baseRef), 1);

    const changes = await service.changes(info);
    assert.deepStrictEqual(
      changes.files.map((f) => [f.path, f.kind]),
      [
        ['new file.txt', '?'],
        ['old.txt', 'D'],
        ['README.md', 'M'],
      ].sort((a, b) => a[0].localeCompare(b[0])),
    );
    assert.strictEqual(await service.showFile(info.path, changes.baseCommit, 'old.txt'), 'old\n');

    // Without --force git refuses to remove a dirty worktree.
    await assert.rejects(service.remove(info), (e: unknown) => e instanceof GitError);
    assert.ok(fs.existsSync(info.path));

    const result = await service.remove(info, { force: true, deleteBranch: true });
    assert.deepStrictEqual(result, { branchDeleted: true });
    assert.ok(!fs.existsSync(info.path));
    assert.strictEqual(await service.branchExists(repo, info.branch), false);
    assert.strictEqual((await service.list(repo)).length, 1);
  });

  test('retries with a new short id on collision and keeps the branch when asked', async () => {
    await git(['branch', 'agent/codex-abc000'], { cwd: repo });
    const info = await service.create({
      repoRoot: repo,
      agentId: 'codex',
      baseRef: 'main',
      directory: '.trees',
      branchPrefix: 'bots/',
    });
    // "agent/" collision does not matter for prefix "bots/", so the first id is used…
    assert.strictEqual(info.branch, 'bots/codex-abc000');
    assert.strictEqual(info.path, path.join(repo, '.trees', 'bots-codex-abc000'));

    // …and a colliding branch forces the next id.
    await git(['branch', 'bots/codex-abc001'], { cwd: repo });
    const second = await service.create({
      repoRoot: repo,
      agentId: 'codex',
      baseRef: 'main',
      directory: '.trees',
      branchPrefix: 'bots/',
    });
    assert.strictEqual(second.branch, 'bots/codex-abc002');

    const result = await service.remove(second);
    assert.deepStrictEqual(result, { branchDeleted: false });
    assert.strictEqual(await service.branchExists(repo, second.branch), true);
  });

  test('remove prunes a worktree whose directory was deleted by hand', async () => {
    const info = await service.create({ repoRoot: repo, agentId: 'kilo', baseRef: 'main' });
    fs.rmSync(info.path, { recursive: true, force: true });
    await service.remove(info, { deleteBranch: true });
    assert.strictEqual((await service.list(repo)).length, 1);
    assert.strictEqual(await service.branchExists(repo, info.branch), false);
  });

  test('create fails with git stderr for an unknown base ref', async () => {
    await assert.rejects(
      service.create({ repoRoot: repo, agentId: 'claude', baseRef: 'does-not-exist' }),
      (e: unknown) => e instanceof GitError && e.detail.length > 0,
    );
  });

  test('missing git executable yields a GitError with code ENOENT', async () => {
    const missing = createGitRunner('git-definitely-not-installed-zed');
    await assert.rejects(
      missing(['--version'], { cwd: tmp }),
      (e: unknown) => e instanceof GitError && e.code === 'ENOENT',
    );
  });
});
