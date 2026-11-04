import * as vscode from 'vscode';

import type { AgentSession, SessionManager } from '../agents/types';
import { baseUri, workingUri } from './content';
import {
  changesTitle,
  changeSides,
  changeTriples,
  defaultCommitMessage,
  describeKind,
  fileDiffTitle,
  filesLabel,
  rejectConfirmation,
} from './reviewModel';
import type { ReviewService } from './types';
import {
  isFileNode,
  isSessionNode,
  type AgentChangesTreeDataProvider,
  type FileNode,
  type ReviewNode,
  type SessionNode,
} from './view';

export type AcceptAllAction = 'ask' | 'stage' | 'commit';

/** User interaction used by the commands; replaceable in tests. */
export interface ReviewUi {
  /** Modal warning with one action button; true when the button was chosen. */
  confirm(message: string, detail: string, button: string): Promise<boolean>;
  /** Asks whether "Accept All" should stage or commit. */
  pickAcceptAction(sessionName: string, fileCount: number): Promise<'stage' | 'commit' | undefined>;
  commitMessage(defaultMessage: string): Promise<string | undefined>;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ReviewCommandDeps {
  sessions: SessionManager;
  service: ReviewService;
  provider: AgentChangesTreeDataProvider;
  view?: vscode.TreeView<ReviewNode>;
  ui?: ReviewUi;
  /** Defaults to the `zedLayout.review.acceptAllAction` setting. */
  acceptAllAction?: () => AcceptAllAction;
}

export const defaultUi: ReviewUi = {
  async confirm(message, detail, button) {
    const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, button);
    return choice === button;
  },
  async pickAcceptAction(sessionName, fileCount) {
    const stage = {
      label: '$(add) Stage',
      description: `git add ${filesLabel(fileCount)}`,
      action: 'stage' as const,
    };
    const commit = {
      label: '$(git-commit) Commit…',
      description: 'stage everything and commit',
      action: 'commit' as const,
    };
    const picked = await vscode.window.showQuickPick([stage, commit], {
      title: `Accept All Changes — ${sessionName}`,
      placeHolder: 'Stage or commit the changes?',
    });
    return picked?.action;
  },
  async commitMessage(defaultMessage) {
    const message = await vscode.window.showInputBox({
      title: 'Commit Agent Changes',
      prompt: 'Commit message',
      value: defaultMessage,
      validateInput: (v) => (v.trim() ? undefined : 'Enter a commit message'),
    });
    return message?.trim() || undefined;
  },
  info: (m) => void vscode.window.showInformationMessage(m),
  warn: (m) => void vscode.window.showWarningMessage(m),
  error: (m) => void vscode.window.showErrorMessage(m),
};

function readAcceptAllAction(): AcceptAllAction {
  const value = vscode.workspace
    .getConfiguration('zedLayout.review')
    .get<string>('acceptAllAction', 'ask');
  return value === 'stage' || value === 'commit' ? value : 'ask';
}

/** Git stderr (`GitError.detail`) when available, otherwise the error message. */
export function errorDetail(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string' && detail) {
      return detail;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function isAgentSession(value: unknown): value is AgentSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AgentSession).id === 'string' &&
    typeof (value as AgentSession).agent === 'object'
  );
}

/** Handlers of the `zedLayout.review.*` commands. */
export class ReviewCommands {
  private readonly ui: ReviewUi;
  private readonly acceptAllAction: () => AcceptAllAction;

  constructor(private readonly deps: ReviewCommandDeps) {
    this.ui = deps.ui ?? defaultUi;
    this.acceptAllAction = deps.acceptAllAction ?? readAcceptAllAction;
  }

  /** Registers all commands; returns their disposables. */
  register(): vscode.Disposable[] {
    const reg = (id: string, fn: (...args: unknown[]) => Promise<void> | void): vscode.Disposable =>
      vscode.commands.registerCommand(id, fn);
    return [
      reg('zedLayout.review.open', (arg) => this.open(arg)),
      reg('zedLayout.review.refresh', () => this.refresh()),
      reg('zedLayout.review.openAll', (arg) => this.openAll(arg)),
      reg('zedLayout.review.openFile', (arg) => this.openFile(arg)),
      reg('zedLayout.review.accept', (arg, selected) => this.accept(arg, selected)),
      reg('zedLayout.review.reject', (arg, selected) => this.reject(arg, selected)),
      reg('zedLayout.review.acceptAll', (arg) => this.acceptAll(arg)),
      reg('zedLayout.review.rejectAll', (arg) => this.rejectAll(arg)),
      reg('zedLayout.review.mergeIntoBase', (arg) => this.mergeIntoBase(arg)),
    ];
  }

  refresh(): void {
    this.deps.provider.refresh();
  }

  // ---------------------------------------------------------------- open

  /** Reveals the session in the Agent Changes view and opens all its changes. */
  async open(arg?: unknown): Promise<void> {
    const node = await this.resolveSessionNode(arg, 'Review Agent Changes');
    if (!node) {
      return;
    }
    if (this.deps.view) {
      try {
        await this.deps.view.reveal(node, { expand: true, focus: true, select: true });
      } catch {
        // Best effort: the view may not be resolvable yet.
      }
    }
    await this.openAll(node);
  }

  async openAll(arg?: unknown): Promise<void> {
    const node = await this.resolveSessionNode(arg, 'Open All Changes');
    if (!node) {
      return;
    }
    if (node.error) {
      this.ui.error(`Could not list changes of "${node.session.name}": ${node.error}`);
      return;
    }
    if (node.files.length === 0) {
      this.ui.info(`No changes in "${node.session.name}" compared with ${node.target.baseLabel}.`);
      return;
    }
    const title = changesTitle(node.session.name, node.target.baseLabel);
    const triples = changeTriples(node.files, {
      resource: (file) => workingUri(node.target, file),
      base: (file) => baseUri(node.session.id, node.target, file),
    });

    const available = await vscode.commands.getCommands(true);
    if (available.includes('vscode.changes')) {
      try {
        await vscode.commands.executeCommand('vscode.changes', title, triples);
        return;
      } catch {
        // Fall back to single-file diffs below.
      }
    }

    const picked = await vscode.window.showQuickPick(
      node.children.map((child) => ({
        label: child.file.path,
        description: describeKind(child.file),
        child,
      })),
      { title, placeHolder: `${filesLabel(node.files.length)} changed — select one to diff` },
    );
    if (picked) {
      await this.openFile(picked.child);
    }
  }

  async openFile(arg?: unknown): Promise<void> {
    const node = isFileNode(arg) ? arg : this.deps.view?.selection.find(isFileNode);
    if (!node) {
      return;
    }
    const { target, session } = node.parent;
    const { file } = node;
    const sides = changeSides(file.kind);
    try {
      if (!sides.left) {
        await vscode.commands.executeCommand('vscode.open', workingUri(target, file));
      } else if (!sides.right) {
        // Deleted: show the base version (content-provider documents are read-only).
        const doc = await vscode.workspace.openTextDocument(baseUri(session.id, target, file));
        await vscode.window.showTextDocument(doc, { preview: true });
      } else {
        await vscode.commands.executeCommand(
          'vscode.diff',
          baseUri(session.id, target, file),
          workingUri(target, file),
          fileDiffTitle(file, session.name, target.baseLabel),
        );
      }
    } catch (error) {
      this.ui.error(`Could not open ${file.path}: ${errorDetail(error)}`);
    }
  }

  // ---------------------------------------------------------------- accept / reject

  async accept(arg?: unknown, selected?: unknown): Promise<void> {
    const groups = this.selectedFiles(arg, selected);
    if (groups.length === 0) {
      return;
    }
    try {
      for (const group of groups) {
        await this.deps.service.accept(
          group.node.target,
          group.files.map((f) => f.file),
        );
      }
    } catch (error) {
      this.ui.error(`Could not accept changes: ${errorDetail(error)}`);
    } finally {
      this.deps.provider.refresh();
    }
  }

  async reject(arg?: unknown, selected?: unknown): Promise<void> {
    const groups = this.selectedFiles(arg, selected);
    if (groups.length === 0) {
      return;
    }
    const files = groups.flatMap((g) => g.files.map((f) => f.file));
    const { message, detail } = rejectConfirmation(files);
    if (!(await this.ui.confirm(message, detail, 'Discard'))) {
      return;
    }
    try {
      for (const group of groups) {
        await this.deps.service.reject(
          group.node.target,
          group.files.map((f) => f.file),
        );
      }
    } catch (error) {
      this.ui.error(`Could not discard changes: ${errorDetail(error)}`);
    } finally {
      this.deps.provider.refresh();
    }
  }

  async acceptAll(arg?: unknown): Promise<void> {
    const node = await this.resolveSessionNode(arg, 'Accept All Changes');
    if (!node || !this.hasChanges(node)) {
      return;
    }
    let action: AcceptAllAction | undefined = this.acceptAllAction();
    if (action === 'ask') {
      action = await this.ui.pickAcceptAction(node.session.name, node.files.length);
    }
    if (!action) {
      return;
    }
    try {
      if (action === 'stage') {
        await this.deps.service.accept(node.target, node.files);
        this.ui.info(`Staged ${filesLabel(node.files.length)} from "${node.session.name}".`);
      } else {
        const message = await this.ui.commitMessage(defaultCommitMessage(node.session.name));
        if (!message) {
          return;
        }
        await this.deps.service.commitAll(node.target, message);
        this.ui.info(`Committed ${filesLabel(node.files.length)} from "${node.session.name}".`);
      }
    } catch (error) {
      this.ui.error(`Could not accept changes: ${errorDetail(error)}`);
    } finally {
      this.deps.provider.refresh();
    }
  }

  async rejectAll(arg?: unknown): Promise<void> {
    const node = await this.resolveSessionNode(arg, 'Reject All Changes');
    if (!node || !this.hasChanges(node)) {
      return;
    }
    const confirmed = await this.ui.confirm(
      `Discard all ${filesLabel(node.files.length)} changed by "${node.session.name}"?`,
      `Every file is restored to ${node.target.baseLabel} in ${node.target.root}; added files are deleted.` +
        (node.target.worktree
          ? '\nCommits already made on the agent branch are not rewritten.'
          : '') +
        '\n\nThis cannot be undone.',
      'Discard All',
    );
    if (!confirmed) {
      return;
    }
    try {
      await this.deps.service.reject(node.target, node.files);
    } catch (error) {
      this.ui.error(`Could not discard changes: ${errorDetail(error)}`);
    } finally {
      this.deps.provider.refresh();
    }
  }

  async mergeIntoBase(arg?: unknown): Promise<void> {
    const node = await this.resolveSessionNode(arg, 'Merge Agent Branch into Base', true);
    const worktree = node?.target.worktree ?? node?.session.worktree;
    if (!node || !worktree) {
      if (node) {
        this.ui.info(`Session "${node.session.name}" does not run in a worktree.`);
      }
      return;
    }
    const confirmed = await this.ui.confirm(
      `Merge "${worktree.branch}" into "${worktree.baseRef}"?`,
      `Runs "git merge --no-ff ${worktree.branch}" in ${worktree.repoRoot}.\n\n` +
        `Requires: no uncommitted changes in the worktree, and "${worktree.baseRef}" checked out ` +
        'with a clean working tree in the main repository. On conflicts the merge is aborted.',
      'Merge',
    );
    if (!confirmed) {
      return;
    }
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Merging ${worktree.branch} into ${worktree.baseRef}…`,
        },
        () => this.deps.service.mergeIntoBase(node.target),
      );
      if (result.merged) {
        this.ui.info(result.message);
      } else {
        this.ui.warn(result.message);
      }
    } catch (error) {
      this.ui.error(`Could not merge ${worktree.branch}: ${errorDetail(error)}`);
    } finally {
      this.deps.provider.refresh();
    }
  }

  // ---------------------------------------------------------------- helpers

  private hasChanges(node: SessionNode): boolean {
    if (node.error) {
      this.ui.error(`Could not list changes of "${node.session.name}": ${node.error}`);
      return false;
    }
    if (node.files.length === 0) {
      this.ui.info(`No changes in "${node.session.name}".`);
      return false;
    }
    return true;
  }

  /**
   * File nodes a per-file command acts on, grouped by session: the multi-selection when the
   * clicked node is part of it, otherwise the clicked node (or the view selection when invoked
   * without arguments).
   */
  private selectedFiles(
    arg: unknown,
    selected: unknown,
  ): { node: SessionNode; files: FileNode[] }[] {
    let nodes: FileNode[];
    const selection = Array.isArray(selected) ? selected.filter(isFileNode) : [];
    if (isFileNode(arg)) {
      nodes = selection.includes(arg) ? selection : [arg];
    } else if (arg === undefined) {
      nodes = (this.deps.view?.selection ?? []).filter(isFileNode);
    } else {
      nodes = [];
    }
    const groups = new Map<SessionNode, FileNode[]>();
    for (const n of nodes) {
      const list = groups.get(n.parent) ?? [];
      if (!list.some((f) => f.file.path === n.file.path)) {
        list.push(n);
      }
      groups.set(n.parent, list);
    }
    return [...groups].map(([node, files]) => ({ node, files }));
  }

  /**
   * Accepts a session node, a file node (→ its session), an `AgentSession`, `{ session }` or a
   * session id; otherwise asks with a QuickPick over sessions with reviewable changes.
   */
  async resolveSessionNode(
    arg: unknown,
    title: string,
    worktreeOnly = false,
  ): Promise<SessionNode | undefined> {
    if (isSessionNode(arg)) {
      return (await this.deps.provider.findSessionNode(arg.session.id)) ?? arg;
    }
    if (isFileNode(arg)) {
      return (await this.deps.provider.findSessionNode(arg.parent.session.id)) ?? arg.parent;
    }
    let id: string | undefined;
    if (typeof arg === 'string') {
      id = arg;
    } else if (isAgentSession(arg)) {
      id = arg.id;
    } else if (
      typeof arg === 'object' &&
      arg !== null &&
      isAgentSession((arg as { session?: unknown }).session)
    ) {
      id = (arg as { session: AgentSession }).session.id;
    }
    if (id !== undefined) {
      const node = await this.deps.provider.findSessionNode(id);
      if (!node) {
        const session = this.deps.sessions.getSession(id);
        this.ui.error(
          session
            ? `Session "${session.name}" is not inside a git repository.`
            : 'Agent session not found.',
        );
      }
      return node;
    }
    if (arg !== undefined && arg !== null) {
      this.ui.error('Agent session not found.');
      return undefined;
    }

    const selected = this.deps.view?.selection[0];
    if (selected) {
      return selected.type === 'session' ? selected : selected.parent;
    }

    const candidates = (await this.deps.provider.getSessionNodes()).filter(
      (n) => !worktreeOnly || n.target.worktree || n.session.worktree,
    );
    if (candidates.length === 0) {
      this.ui.info(
        worktreeOnly
          ? 'No agent sessions running in a worktree.'
          : 'No agent sessions with reviewable changes (sessions must run inside a git repository).',
      );
      return undefined;
    }
    if (candidates.length === 1) {
      return candidates[0];
    }
    const picked = await vscode.window.showQuickPick(
      candidates.map((n) => ({
        label: n.session.name,
        description: `${filesLabel(n.files.length)} · vs ${n.target.baseLabel}`,
        detail: n.target.root,
        node: n,
      })),
      { title, placeHolder: 'Select an agent session' },
    );
    return picked?.node;
  }
}
