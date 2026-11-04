import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { AgentSession, SessionManager, WorktreeInfo } from '../agents/types';
import { gitErrorDetail } from './git';
import { shortBranchName, type ChangedFile } from './model';
import { WorktreeService } from './service';

/** Worktrees: `git worktree` management for isolated agent sessions (#9). */

const BASE_SCHEME = 'zedlayout-worktree-base';

export function register(context: vscode.ExtensionContext, sessions: SessionManager): void {
  const service = new WorktreeService();
  const commands = new WorktreeCommands(service, sessions);

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
  );
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
    const info = session?.worktree;
    if (!info) {
      return;
    }
    if (!fs.existsSync(info.path)) {
      void vscode.window.showErrorMessage(`Worktree directory not found: ${info.path}`);
      return;
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(info.path), {
      forceNewWindow: true,
    });
  }

  // ---------------------------------------------------------------- compare

  async compareWithBase(arg?: unknown): Promise<void> {
    const session = await this.resolveSession(arg, 'Compare Worktree with Base');
    const info = session?.worktree;
    if (!info) {
      return;
    }
    if (!fs.existsSync(info.path)) {
      void vscode.window.showErrorMessage(`Worktree directory not found: ${info.path}`);
      return;
    }
    let changes: { baseCommit: string; files: ChangedFile[] };
    try {
      changes = await this.service.changes(info);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Could not compare ${info.branch} with ${info.baseRef}: ${gitErrorDetail(error)}`,
      );
      return;
    }
    if (changes.files.length === 0) {
      void vscode.window.showInformationMessage(
        `No changes in ${info.branch} compared with ${info.baseRef}.`,
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
    const title = `${info.branch} ↔ ${info.baseRef}`;

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
      `${entry.file.path} (${info.baseRef} ↔ ${info.branch})`,
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
  }

  private async removeWorktree(
    info: WorktreeInfo,
    sessionsToStop: readonly AgentSession[],
    options: { confirm: boolean },
  ): Promise<void> {
    const exists = fs.existsSync(info.path);
    if (options.confirm) {
      const live = sessionsToStop.filter((s) => s.status !== 'exited').length;
      const removeItem = 'Remove';
      const confirmed = await vscode.window.showWarningMessage(
        `Remove worktree for branch "${info.branch}"?`,
        {
          modal: true,
          detail:
            `${info.path}\n` +
            (exists ? '' : '(directory no longer exists — only git metadata will be pruned)\n') +
            (live > 0 ? `\n${live} running agent session(s) will be stopped.` : ''),
        },
        removeItem,
      );
      if (confirmed !== removeItem) {
        return;
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
          lines.push(
            `• ${uniqueCommits} commit(s) on "${info.branch}" are not in "${info.baseRef}".`,
          );
        }
        if (checkFailed) {
          lines.push(`• Could not check the worktree state: ${checkFailed}`);
        }
        const anyway = 'Remove Anyway';
        const choice = await vscode.window.showWarningMessage(
          `Worktree "${info.branch}" contains work that is not in "${info.baseRef}".`,
          { modal: true, detail: lines.join('\n') },
          anyway,
        );
        if (choice !== anyway) {
          return;
        }
        force = true;
      }
    }

    // Branch deletion (default: keep).
    let deleteBranch = false;
    if (options.confirm) {
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
          title: `Removing worktree ${info.branch}…`,
        },
        () => this.service.remove(info, { force, deleteBranch }),
      );
      if (result.branchError) {
        void vscode.window.showWarningMessage(
          `Worktree removed, but branch "${info.branch}" could not be deleted: ${result.branchError}`,
        );
      } else {
        void vscode.window.showInformationMessage(
          result.branchDeleted
            ? `Removed worktree and branch "${info.branch}".`
            : `Removed worktree; branch "${info.branch}" was kept.`,
        );
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not remove worktree: ${gitErrorDetail(error)}`);
    }
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
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? na.toLowerCase() === nb.toLowerCase()
    : na === nb;
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
