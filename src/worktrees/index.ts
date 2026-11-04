import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type {
  AgentSession,
  OrphanedWorktree,
  OrphanTracker,
  SessionHistory,
  SessionManager,
  WorktreeInfo,
} from '../agents/types';
import { gitErrorDetail } from './git';
import { shortBranchName, type ChangedFile } from './model';
import {
  describeOrphanSummary,
  isRiskyOrphan,
  normalizePathKey,
  type OrphanSummary,
} from './orphanModel';
import { createOrphanTracker, type OrphanTrackerImpl } from './orphans';
import { WorktreeService } from './service';

/** Worktrees: `git worktree` management for isolated agent sessions (#9). */

const BASE_SCHEME = 'zedlayout-worktree-base';

export function register(
  context: vscode.ExtensionContext,
  sessions: SessionManager,
  history: SessionHistory,
): OrphanTracker {
  const service = new WorktreeService();
  const orphans = createOrphanTracker(context, sessions, history, service);
  context.subscriptions.push(orphans);
  const commands = new WorktreeCommands(service, sessions, orphans);

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      BASE_SCHEME,
      new BaseContentProvider(service),
    ),
    vscode.commands.registerCommand('zedLayout.worktrees.newSession', (arg?: unknown) =>
      commands.newSession(arg),
    ),
    vscode.commands.registerCommand('zedLayout.worktrees.openInNewWindow', (arg?: unknown) =>
      commands.openInNewWindow(arg),
    ),
    vscode.commands.registerCommand('zedLayout.worktrees.compareWithBase', (arg?: unknown) =>
      commands.compareWithBase(arg),
    ),
    vscode.commands.registerCommand('zedLayout.worktrees.remove', (arg?: unknown) =>
      commands.remove(arg),
    ),
    vscode.commands.registerCommand('zedLayout.worktrees.orphan.startSession', (arg?: unknown) =>
      commands.orphanStartSession(arg),
    ),
    vscode.commands.registerCommand('zedLayout.worktrees.orphan.openInNewWindow', (arg?: unknown) =>
      commands.orphanOpenInNewWindow(arg),
    ),
    vscode.commands.registerCommand('zedLayout.worktrees.orphan.review', (arg?: unknown) =>
      commands.orphanReview(arg),
    ),
    vscode.commands.registerCommand('zedLayout.worktrees.orphan.remove', (arg?: unknown) =>
      commands.orphanRemove(arg),
    ),
    vscode.commands.registerCommand('zedLayout.worktrees.cleanUp', () => commands.cleanUp()),
    vscode.commands.registerCommand('zedLayout.worktrees.refreshOrphans', () => orphans.refresh()),
  );
  return orphans;
}

interface WorktreeSettings {
  directory: string;
  branchPrefix: string;
}

function readSettings(scope?: vscode.Uri): WorktreeSettings {
  const config = vscode.workspace.getConfiguration('zedLayout.worktrees', scope);
  return {
    directory: config.get<string>('directory', '') ?? '',
    branchPrefix: config.get<string>('branchPrefix', 'agent/') ?? 'agent/',
  };
}

/** Display name of a worktree: its branch, or `detached <sha>` for a detached HEAD. */
function worktreeLabel(info: { branch?: string; head?: string; path: string }): string {
  if (info.branch) {
    return info.branch;
  }
  return info.head ? `detached ${info.head.slice(0, 7)}` : path.basename(info.path);
}

function isOrphanedWorktree(value: unknown): value is OrphanedWorktree {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as OrphanedWorktree).path === 'string' &&
    typeof (value as OrphanedWorktree).repoRoot === 'string' &&
    typeof (value as OrphanedWorktree).head === 'string'
  );
}

function isAgentSession(value: unknown): value is AgentSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AgentSession).id === 'string' &&
    typeof (value as AgentSession).agent === 'object'
  );
}

class WorktreeCommands {
  constructor(
    private readonly service: WorktreeService,
    private readonly sessions: SessionManager,
    private readonly orphans: OrphanTrackerImpl,
  ) {}

  // ---------------------------------------------------------------- new session

  async newSession(arg?: unknown): Promise<void> {
    const repo = await this.pickRepository();
    if (!repo) {
      return;
    }

    let agentId = typeof arg === 'string' && arg ? arg : undefined;
    if (agentId && !this.sessions.getAgents().some((a) => a.id === agentId)) {
      void vscode.window.showErrorMessage(`Unknown agent "${agentId}" (see zedLayout.agents).`);
      return;
    }
    if (!agentId) {
      agentId = (await this.sessions.pickAgent())?.id;
      if (!agentId) {
        return;
      }
    }
    const agent = this.sessions.getAgents().find((a) => a.id === agentId);

    const baseRef = await this.pickBaseRef(repo.root);
    if (!baseRef) {
      return;
    }

    const settings = readSettings(repo.folder?.uri);
    let info: WorktreeInfo;
    try {
      info = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating worktree from ${baseRef}…`,
        },
        () =>
          this.service.create({
            repoRoot: repo.root,
            agentId: agentId,
            baseRef,
            directory: settings.directory,
            branchPrefix: settings.branchPrefix,
          }),
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not create worktree: ${gitErrorDetail(error)}`);
      return;
    }

    const name = `${agent?.label ?? agentId} · ${shortBranchName(info.branch, settings.branchPrefix)}`;
    let session: AgentSession | undefined;
    try {
      session = await this.sessions.startSession({
        agentId,
        cwd: info.path,
        worktree: info,
        name,
      });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Could not start agent session: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!session) {
      const removeItem = 'Remove Worktree';
      const choice = await vscode.window.showWarningMessage(
        `Worktree ${info.path} (branch ${info.branch}) was created, but no agent session was started.`,
        removeItem,
        'Keep',
      );
      if (choice === removeItem) {
        await this.removeWorktree(info, [], { confirm: false });
      }
      this.orphans.scheduleRefresh();
    }
  }

  /** Workspace folder that is inside a git repository (QuickPick when several). */
  private async pickRepository(): Promise<
    { root: string; folder?: vscode.WorkspaceFolder } | undefined
  > {
    const folders = (vscode.workspace.workspaceFolders ?? []).filter(
      (f) => f.uri.scheme === 'file',
    );
    if (folders.length === 0) {
      void vscode.window.showErrorMessage(
        'Open a folder that is a git repository to start an agent session in a worktree.',
      );
      return undefined;
    }
    const repos = (
      await Promise.all(
        folders.map(async (folder) => {
          const root = await this.service.tryGetRepoRoot(folder.uri.fsPath);
          return root ? { root, folder } : undefined;
        }),
      )
    ).filter((r): r is { root: string; folder: vscode.WorkspaceFolder } => r !== undefined);

    // Several folders of the same repository → one entry.
    const unique = repos.filter((r, i) => repos.findIndex((o) => o.root === r.root) === i);
    if (unique.length === 0) {
      void vscode.window.showErrorMessage(
        'No git repository found in the open folders (or Git is not installed).',
      );
      return undefined;
    }
    if (unique.length === 1) {
      return unique[0];
    }
    const picked = await vscode.window.showQuickPick(
      unique.map((r) => ({ label: r.folder.name, description: r.root, repo: r })),
      { title: 'New Agent Session in Worktree', placeHolder: 'Select a repository' },
    );
    return picked?.repo;
  }

  private async pickBaseRef(repoRoot: string): Promise<string | undefined> {
    let current: string;
    try {
      current = await this.service.currentRef(repoRoot);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Cannot determine the current branch (does the repository have any commits?): ${gitErrorDetail(error)}`,
      );
      return undefined;
    }
    const currentItem: vscode.QuickPickItem = {
      label: `$(git-branch) Current branch (${current})`,
      description: 'base the new worktree on it',
    };
    const otherItem: vscode.QuickPickItem = {
      label: '$(edit) Enter ref…',
      description: 'branch, tag or commit',
    };
    const choice = await vscode.window.showQuickPick([currentItem, otherItem], {
      title: 'New Agent Session in Worktree',
      placeHolder: 'Base for the new branch',
    });
    if (!choice) {
      return undefined;
    }
    if (choice === currentItem) {
      return current;
    }
    const ref = await vscode.window.showInputBox({
      title: 'Base ref for the new worktree',
      prompt: 'Branch, tag or commit',
      value: current,
      validateInput: async (value) => {
        const v = value.trim();
        if (!v) {
          return 'Enter a ref';
        }
        if (v.startsWith('-')) {
          return 'Invalid ref';
        }
        try {
          await this.service.resolveCommit(repoRoot, v);
          return undefined;
        } catch {
          return `Unknown ref: ${v}`;
        }
      },
    });
    return ref?.trim() || undefined;
  }

  // ---------------------------------------------------------------- open in new window

  async openInNewWindow(arg?: unknown): Promise<void> {
    const session = await this.resolveSession(arg, 'Open Worktree in New Window');
    if (session?.worktree) {
      await this.openFolderInNewWindow(session.worktree.path);
    }
  }

  private async openFolderInNewWindow(wtPath: string): Promise<void> {
    if (!fs.existsSync(wtPath)) {
      void vscode.window.showErrorMessage(`Worktree directory not found: ${wtPath}`);
      return;
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(wtPath), {
      forceNewWindow: true,
    });
  }

  // ---------------------------------------------------------------- compare

  async compareWithBase(arg?: unknown): Promise<void> {
    const session = await this.resolveSession(arg, 'Compare Worktree with Base');
    if (session?.worktree) {
      await this.compare(session.worktree);
    }
  }

  /** Multi-diff of all changes in the worktree since it diverged from `info.baseRef`. */
  private async compare(info: WorktreeInfo): Promise<void> {
    const label = worktreeLabel(info);
    if (!fs.existsSync(info.path)) {
      void vscode.window.showErrorMessage(`Worktree directory not found: ${info.path}`);
      return;
    }
    let changes: { baseCommit: string; files: ChangedFile[] };
    try {
      changes = await this.service.changes(info);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Could not compare ${label} with ${info.baseRef}: ${gitErrorDetail(error)}`,
      );
      return;
    }
    if (changes.files.length === 0) {
      void vscode.window.showInformationMessage(
        `No changes in ${label} compared with ${info.baseRef}.`,
      );
      return;
    }

    const toBaseUri = await this.baseUriFactory(info);
    const entries = changes.files.map((file) => {
      const resource = vscode.Uri.file(path.join(info.path, ...file.path.split('/')));
      const original =
        file.kind === 'A' || file.kind === '?'
          ? undefined
          : toBaseUri(
              vscode.Uri.file(path.join(info.path, ...(file.originalPath ?? file.path).split('/'))),
              file.originalPath ?? file.path,
              changes.baseCommit,
            );
      const modified = file.kind === 'D' ? undefined : resource;
      return { file, resource, original, modified };
    });
    const title = `${label} ↔ ${info.baseRef}`;

    const available = await vscode.commands.getCommands(true);
    if (available.includes('vscode.changes')) {
      try {
        await vscode.commands.executeCommand(
          'vscode.changes',
          title,
          entries.map((e) => [e.resource, e.original, e.modified]),
        );
        return;
      } catch {
        // Fall back to single-file diffs below.
      }
    }

    // Fallback: pick a file and open a regular diff editor.
    const picked = await vscode.window.showQuickPick(
      entries.map((e) => ({
        label: e.file.path,
        description: describeKind(e.file),
        entry: e,
      })),
      { title, placeHolder: `${entries.length} changed file(s) — select one to diff` },
    );
    if (!picked) {
      return;
    }
    const { entry } = picked;
    const empty = vscode.Uri.from({ scheme: BASE_SCHEME, path: entry.file.path, query: 'empty' });
    await vscode.commands.executeCommand(
      'vscode.diff',
      entry.original ?? empty,
      entry.modified ?? empty,
      `${entry.file.path} (${info.baseRef} ↔ ${label})`,
    );
  }

  /**
   * Builds URIs for the base version of a file: the built-in Git extension's `toGitUri`
   * when available (worktree repository opened in it), otherwise our own `git show` provider.
   */
  private async baseUriFactory(
    info: WorktreeInfo,
  ): Promise<(fileUri: vscode.Uri, relPath: string, commit: string) => vscode.Uri> {
    const own = (_fileUri: vscode.Uri, relPath: string, commit: string): vscode.Uri =>
      vscode.Uri.from({
        scheme: BASE_SCHEME,
        path: `/${relPath}`,
        query: JSON.stringify({ cwd: info.path, commit, path: relPath }),
      });
    try {
      const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (!ext) {
        return own;
      }
      const exported = ext.isActive ? ext.exports : await ext.activate();
      if (!exported?.enabled) {
        return own;
      }
      const api = exported.getAPI(1);
      const root = vscode.Uri.file(info.path);
      const repo = api.getRepository(root) ?? (await api.openRepository?.(root));
      if (!repo) {
        return own;
      }
      return (fileUri, _relPath, commit) => api.toGitUri(fileUri, commit);
    } catch {
      return own;
    }
  }

  // ---------------------------------------------------------------- remove

  async remove(arg?: unknown): Promise<void> {
    const session = await this.resolveSession(arg, 'Remove Worktree');
    const info = session?.worktree;
    if (!session || !info) {
      return;
    }
    const related = this.sessions
      .getSessions()
      .filter((s) => s.worktree && samePath(s.worktree.path, info.path));
    if (!related.some((s) => s.id === session.id) && this.sessions.getSession(session.id)) {
      related.push(session);
    }
    await this.removeWorktree(info, related, { confirm: true });
    this.orphans.scheduleRefresh();
  }

  /**
   * Removes a worktree with the #9 safeguards. `prunable` (git reports the directory as gone)
   * → only `git worktree prune`; `locked` → `git worktree remove --force --force`.
   * Returns true when the worktree was removed.
   */
  private async removeWorktree(
    info: WorktreeInfo,
    sessionsToStop: readonly AgentSession[],
    options: { confirm: boolean; prunable?: boolean; locked?: boolean },
  ): Promise<boolean> {
    const label = worktreeLabel(info);
    const exists = !options.prunable && fs.existsSync(info.path);
    if (options.confirm) {
      const live = sessionsToStop.filter((s) => s.status !== 'exited').length;
      const removeItem = 'Remove';
      const confirmed = await vscode.window.showWarningMessage(
        info.branch
          ? `Remove worktree for branch "${info.branch}"?`
          : `Remove worktree "${label}"?`,
        {
          modal: true,
          detail:
            `${info.path}\n` +
            (exists ? '' : '(directory no longer exists — only git metadata will be pruned)\n') +
            (exists && options.locked ? '(the worktree is locked)\n' : '') +
            (live > 0 ? `\n${live} running agent session(s) will be stopped.` : ''),
        },
        removeItem,
      );
      if (confirmed !== removeItem) {
        return false;
      }
    }

    // Safety checks: uncommitted changes and commits that exist only on this branch.
    let force = false;
    let uniqueCommits = 0;
    if (exists) {
      let uncommitted = 0;
      let checkFailed: string | undefined;
      try {
        uncommitted = (await this.service.uncommittedChanges(info.path)).length;
      } catch (error) {
        checkFailed = gitErrorDetail(error);
      }
      try {
        uniqueCommits = await this.service.countCommitsNotInBase(info.path, info.baseRef);
      } catch (error) {
        checkFailed ??= gitErrorDetail(error);
      }
      if (uncommitted > 0 || uniqueCommits > 0 || checkFailed) {
        const lines: string[] = [];
        if (uncommitted > 0) {
          lines.push(`• ${uncommitted} uncommitted change(s) will be lost.`);
        }
        if (uniqueCommits > 0) {
          lines.push(`• ${uniqueCommits} commit(s) on "${label}" are not in "${info.baseRef}".`);
        }
        if (checkFailed) {
          lines.push(`• Could not check the worktree state: ${checkFailed}`);
        }
        const anyway = 'Remove Anyway';
        const choice = await vscode.window.showWarningMessage(
          `Worktree "${label}" contains work that is not in "${info.baseRef}".`,
          { modal: true, detail: lines.join('\n') },
          anyway,
        );
        if (choice !== anyway) {
          return false;
        }
        force = true;
      }
    } else if (info.branch) {
      // Directory gone: count the branch's own commits from the main repository.
      try {
        uniqueCommits = await this.service.countCommitsNotInBase(
          info.repoRoot,
          info.baseRef,
          `refs/heads/${info.branch}`,
        );
      } catch {
        uniqueCommits = 0;
      }
    }

    // Branch deletion (default: keep). Not applicable to a detached HEAD.
    let deleteBranch = false;
    if (!info.branch) {
      deleteBranch = false;
    } else if (options.confirm) {
      const deleteItem = 'Delete Branch';
      const keepItem = 'Keep Branch';
      const choice = await vscode.window.showWarningMessage(
        `Also delete branch "${info.branch}"?`,
        {
          modal: true,
          detail:
            uniqueCommits > 0
              ? `The branch has ${uniqueCommits} commit(s) not in "${info.baseRef}" — deleting it discards them (git branch -D).`
              : 'Keeping the branch lets you merge or inspect it later.',
        },
        deleteItem,
        keepItem,
      );
      deleteBranch = choice === deleteItem;
    } else {
      // Just created and never used: the branch has no own commits.
      deleteBranch = uniqueCommits === 0;
    }

    for (const s of sessionsToStop) {
      if (this.sessions.getSession(s.id)) {
        this.sessions.stop(s.id);
      }
    }

    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Removing worktree ${label}…`,
        },
        () =>
          this.service.remove(info, {
            force,
            deleteBranch,
            prune: !exists,
            locked: exists && options.locked,
          }),
      );
      if (result.branchError) {
        void vscode.window.showWarningMessage(
          `Worktree removed, but branch "${info.branch}" could not be deleted: ${result.branchError}`,
        );
      } else if (!info.branch) {
        void vscode.window.showInformationMessage(`Removed worktree "${label}".`);
      } else {
        void vscode.window.showInformationMessage(
          result.branchDeleted
            ? `Removed worktree and branch "${info.branch}".`
            : `Removed worktree; branch "${info.branch}" was kept.`,
        );
      }
      return true;
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not remove worktree: ${gitErrorDetail(error)}`);
      return false;
    }
  }

  // ---------------------------------------------------------------- orphaned worktrees (#16)

  async orphanStartSession(arg?: unknown): Promise<void> {
    const orphan = await this.resolveOrphan(arg, 'Start Agent Session in Worktree');
    if (!orphan || !this.checkOrphanDirectory(orphan)) {
      return;
    }
    const agent = await this.sessions.pickAgent();
    if (!agent) {
      return;
    }
    const info = await this.orphanInfo(orphan);
    if (!info) {
      return;
    }
    const prefix = readSettings(vscode.Uri.file(info.repoRoot)).branchPrefix;
    const name = `${agent.label} · ${info.branch ? shortBranchName(info.branch, prefix) : worktreeLabel(orphan)}`;
    try {
      await this.sessions.startSession({
        agentId: agent.id,
        cwd: info.path,
        worktree: info,
        name,
      });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Could not start agent session: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.orphans.scheduleRefresh();
  }

  async orphanOpenInNewWindow(arg?: unknown): Promise<void> {
    const orphan = await this.resolveOrphan(arg, 'Open Worktree in New Window');
    if (orphan && this.checkOrphanDirectory(orphan)) {
      await this.openFolderInNewWindow(orphan.path);
    }
  }

  async orphanReview(arg?: unknown): Promise<void> {
    const orphan = await this.resolveOrphan(arg, 'Review Worktree Changes');
    if (!orphan || !this.checkOrphanDirectory(orphan)) {
      return;
    }
    const info = await this.orphanInfo(orphan);
    if (info) {
      await this.compare(info);
    }
  }

  async orphanRemove(arg?: unknown): Promise<void> {
    const orphan = await this.resolveOrphan(arg, 'Remove Worktree');
    if (!orphan) {
      return;
    }
    const info = await this.orphanInfo(orphan);
    if (!info) {
      return;
    }
    await this.removeWorktree(info, [], {
      confirm: true,
      prunable: orphan.prunable || !fs.existsSync(orphan.path),
      locked: orphan.locked,
    });
    await this.orphans.refresh();
  }

  /** "Clean Up Agent Worktrees…": multi-select removal of orphaned worktrees. */
  async cleanUp(): Promise<void> {
    const title = 'Clean Up Agent Worktrees';
    const scanned = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Checking agent worktrees…' },
      async () => {
        const found = (await this.orphans.collect()).map((o) =>
          !o.prunable && !fs.existsSync(o.path) ? { ...o, prunable: true } : o,
        );
        const defaults = new Map<string, Promise<string | undefined>>();
        const defaultFor = (repoRoot: string): Promise<string | undefined> => {
          let p = defaults.get(repoRoot);
          if (!p) {
            p = this.service.defaultBranch(repoRoot).catch(() => undefined);
            defaults.set(repoRoot, p);
          }
          return p;
        };
        return Promise.all(
          found.map(async (orphan) => ({
            orphan,
            summary: await this.summarize(orphan, defaultFor),
          })),
        );
      },
    );
    void this.orphans.refresh();
    if (scanned.length === 0) {
      void vscode.window.showInformationMessage('No orphaned agent worktrees found.');
      return;
    }

    const picked = await vscode.window.showQuickPick(
      scanned.map((entry) => ({
        label: `${entry.orphan.prunable ? '$(warning)' : '$(git-branch)'} ${worktreeLabel(entry.orphan)}`,
        description: entry.orphan.path,
        detail: describeOrphanSummary(entry.orphan, entry.summary),
        picked: !isRiskyOrphan(entry.orphan, entry.summary, { deleteBranch: true }),
        entry,
      })),
      {
        title,
        placeHolder: 'Select the worktrees to remove (clean ones are preselected)',
        canPickMany: true,
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (!picked || picked.length === 0) {
      return;
    }
    let selected = picked.map((p) => p.entry);

    const removeItem = 'Remove Worktrees';
    const removeAllItem = 'Remove Worktrees and Branches';
    const hasBranches = selected.some((e) => e.orphan.branch);
    const choice = await vscode.window.showWarningMessage(
      `Remove ${selected.length} agent worktree(s)?`,
      {
        modal: true,
        detail:
          selected
            .map(
              (e) => `• ${worktreeLabel(e.orphan)} — ${describeOrphanSummary(e.orphan, e.summary)}`,
            )
            .join('\n') +
          (hasBranches
            ? '\n\nKeeping the branches lets you merge or inspect them later; deleting uses git branch -D.'
            : ''),
      },
      ...(hasBranches ? [removeItem, removeAllItem] : [removeItem]),
    );
    if (choice !== removeItem && choice !== removeAllItem) {
      return;
    }
    const deleteBranch = choice === removeAllItem;

    const risky = selected.filter((e) => isRiskyOrphan(e.orphan, e.summary, { deleteBranch }));
    if (risky.length > 0) {
      const anyway = 'Remove Anyway';
      const skip = 'Skip These';
      const forceChoice = await vscode.window.showWarningMessage(
        `${risky.length} worktree(s) contain work that will be lost.`,
        {
          modal: true,
          detail:
            risky
              .map(
                (e) =>
                  `• ${worktreeLabel(e.orphan)} — ${describeOrphanSummary(e.orphan, e.summary)}`,
              )
              .join('\n') +
            '\n\nRemove Anyway uses git worktree remove --force' +
            (deleteBranch ? ' and git branch -D (commits not in the base are discarded).' : '.'),
        },
        anyway,
        skip,
      );
      if (forceChoice === skip) {
        selected = selected.filter((e) => !risky.includes(e));
      } else if (forceChoice !== anyway) {
        return;
      }
    }
    if (selected.length === 0) {
      return;
    }

    const outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Removing agent worktrees…' },
      async (progress) => {
        const counts = { removed: 0, pruned: 0, branches: 0, failures: [] as string[] };
        // Sequential: git locks the repository's worktree metadata and config.
        for (const { orphan, summary } of selected) {
          progress.report({
            message: worktreeLabel(orphan),
            increment: 100 / selected.length,
          });
          const info: WorktreeInfo = {
            path: orphan.path,
            branch: orphan.branch ?? '',
            baseRef: summary.baseRef ?? orphan.baseRef ?? '',
            repoRoot: orphan.repoRoot,
          };
          try {
            const result = await this.service.remove(info, {
              prune: orphan.prunable,
              force: !orphan.prunable && isRiskyOrphan(orphan, summary, { deleteBranch: false }),
              locked: orphan.locked,
              deleteBranch,
            });
            if (orphan.prunable) {
              counts.pruned++;
            } else {
              counts.removed++;
            }
            if (result.branchDeleted) {
              counts.branches++;
            }
            if (result.branchError) {
              counts.failures.push(`${worktreeLabel(orphan)}: branch kept (${result.branchError})`);
            }
          } catch (error) {
            counts.failures.push(`${worktreeLabel(orphan)}: ${gitErrorDetail(error)}`);
          }
        }
        return counts;
      },
    );
    await this.orphans.refresh();

    const parts = [`Removed ${outcome.removed} worktree(s)`];
    if (outcome.pruned > 0) {
      parts.push(`pruned ${outcome.pruned} stale entr${outcome.pruned === 1 ? 'y' : 'ies'}`);
    }
    if (deleteBranch) {
      parts.push(`deleted ${outcome.branches} branch(es)`);
    }
    const message = `${parts.join(', ')}.`;
    if (outcome.failures.length > 0) {
      void vscode.window.showWarningMessage(
        `${message} ${outcome.failures.length} problem(s): ${outcome.failures.join('; ')}`,
      );
    } else {
      void vscode.window.showInformationMessage(message);
    }
  }

  private async summarize(
    orphan: OrphanedWorktree,
    defaultFor: (repoRoot: string) => Promise<string | undefined>,
  ): Promise<OrphanSummary> {
    if (orphan.prunable) {
      return {};
    }
    const summary: OrphanSummary = {};
    try {
      summary.baseRef = await this.validBaseRef(orphan);
      if (!summary.baseRef) {
        summary.baseRef = await defaultFor(orphan.repoRoot);
      }
    } catch {
      summary.baseRef = await defaultFor(orphan.repoRoot);
    }
    const [uncommitted, commits] = await Promise.allSettled([
      this.service.uncommittedChanges(orphan.path),
      summary.baseRef
        ? this.service.countCommitsNotInBase(orphan.path, summary.baseRef)
        : Promise.reject(new Error('no base branch')),
    ]);
    if (uncommitted.status === 'fulfilled') {
      summary.uncommitted = uncommitted.value.length;
    } else {
      summary.error = gitErrorDetail(uncommitted.reason);
    }
    if (commits.status === 'fulfilled') {
      summary.commitsNotInBase = commits.value;
    } else {
      summary.error ??= gitErrorDetail(commits.reason);
    }
    return summary;
  }

  /** Recorded base ref when it still resolves to a commit. */
  private async validBaseRef(orphan: OrphanedWorktree): Promise<string | undefined> {
    if (!orphan.baseRef) {
      return undefined;
    }
    try {
      await this.service.resolveCommit(orphan.repoRoot, orphan.baseRef);
      return orphan.baseRef;
    } catch {
      return undefined;
    }
  }

  /** `WorktreeInfo` for an orphan; base: recorded ref, else the repository's default branch. */
  private async orphanInfo(orphan: OrphanedWorktree): Promise<WorktreeInfo | undefined> {
    let baseRef = await this.validBaseRef(orphan);
    if (!baseRef) {
      try {
        baseRef = await this.service.defaultBranch(orphan.repoRoot);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Cannot determine the base branch of ${worktreeLabel(orphan)}: ${gitErrorDetail(error)}`,
        );
        return undefined;
      }
    }
    return {
      path: orphan.path,
      branch: orphan.branch ?? '',
      baseRef,
      repoRoot: orphan.repoRoot,
    };
  }

  private checkOrphanDirectory(orphan: OrphanedWorktree): boolean {
    if (orphan.prunable || !fs.existsSync(orphan.path)) {
      void vscode.window.showErrorMessage(
        `Worktree directory not found: ${orphan.path}. Use "Remove Worktree" to prune it.`,
      );
      return false;
    }
    return true;
  }

  /** Accepts an `OrphanedWorktree`, `{ orphan }` or a worktree path; otherwise asks with a QuickPick. */
  private async resolveOrphan(arg: unknown, title: string): Promise<OrphanedWorktree | undefined> {
    let candidate: OrphanedWorktree | undefined;
    if (isOrphanedWorktree(arg)) {
      candidate = arg;
    } else if (
      typeof arg === 'object' &&
      arg !== null &&
      isOrphanedWorktree((arg as { orphan?: unknown }).orphan)
    ) {
      candidate = (arg as { orphan: OrphanedWorktree }).orphan;
    }
    if (candidate) {
      return this.findOrphan(candidate.path) ?? candidate;
    }
    if (typeof arg === 'string' && arg) {
      const found =
        this.findOrphan(arg) ?? (await this.orphans.collect()).find((o) => samePath(o.path, arg));
      if (!found) {
        void vscode.window.showErrorMessage(`No orphaned agent worktree at ${arg}.`);
      }
      return found;
    }
    if (arg !== undefined && arg !== null) {
      void vscode.window.showErrorMessage('Orphaned worktree not found.');
      return undefined;
    }
    const candidates = await this.orphans.collect();
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage('No orphaned agent worktrees found.');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      candidates.map((o) => ({
        label: worktreeLabel(o),
        description: o.prunable ? 'directory missing' : o.baseRef ? `from ${o.baseRef}` : undefined,
        detail: o.path,
        orphan: o,
      })),
      { title, placeHolder: 'Select an agent worktree without a session' },
    );
    return picked?.orphan;
  }

  private findOrphan(wtPath: string): OrphanedWorktree | undefined {
    return this.orphans.getOrphans().find((o) => samePath(o.path, wtPath));
  }

  // ---------------------------------------------------------------- helpers

  /** Accepts an `AgentSession`, `{ session }`, or a session id; otherwise asks with a QuickPick. */
  private async resolveSession(arg: unknown, title: string): Promise<AgentSession | undefined> {
    let session: AgentSession | undefined;
    if (typeof arg === 'string') {
      session = this.sessions.getSession(arg);
    } else if (isAgentSession(arg)) {
      session = this.sessions.getSession(arg.id) ?? arg;
    } else if (
      typeof arg === 'object' &&
      arg !== null &&
      isAgentSession((arg as { session?: unknown }).session)
    ) {
      const s = (arg as { session: AgentSession }).session;
      session = this.sessions.getSession(s.id) ?? s;
    }
    if (session) {
      if (!session.worktree) {
        void vscode.window.showInformationMessage(
          `Session "${session.name}" does not run in a worktree.`,
        );
        return undefined;
      }
      return session;
    }
    if (arg !== undefined && arg !== null) {
      void vscode.window.showErrorMessage('Agent session not found.');
      return undefined;
    }
    const candidates = this.sessions.getSessions().filter((s) => s.worktree);
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage('No agent sessions running in a worktree.');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      candidates.map((s) => ({
        label: s.name,
        description: s.worktree?.branch,
        detail: s.worktree?.path,
        session: s,
      })),
      { title, placeHolder: 'Select an agent session with a worktree' },
    );
    return picked?.session;
  }
}

function describeKind(file: ChangedFile): string {
  switch (file.kind) {
    case 'A':
      return 'added';
    case '?':
      return 'untracked';
    case 'D':
      return 'deleted';
    case 'R':
      return `renamed from ${file.originalPath ?? ''}`;
    case 'C':
      return `copied from ${file.originalPath ?? ''}`;
    case 'U':
      return 'conflict';
    default:
      return 'modified';
  }
}

function samePath(a: string, b: string): boolean {
  return normalizePathKey(path.resolve(a)) === normalizePathKey(path.resolve(b));
}

/** Serves base versions of files (`git show <commit>:<path>`) when the Git extension is unavailable. */
class BaseContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly service: WorktreeService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (uri.query === 'empty' || !uri.query) {
      return '';
    }
    try {
      const {
        cwd,
        commit,
        path: relPath,
      } = JSON.parse(uri.query) as {
        cwd: string;
        commit: string;
        path: string;
      };
      return await this.service.showFile(cwd, commit, relPath);
    } catch {
      return '';
    }
  }
}

// Minimal typing of the built-in Git extension API (extensions/git/src/api/git.d.ts).
interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

interface GitApi {
  getRepository(uri: vscode.Uri): unknown;
  openRepository?(root: vscode.Uri): Promise<unknown>;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}
