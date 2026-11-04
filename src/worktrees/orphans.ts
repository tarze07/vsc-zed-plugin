import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type {
  OrphanedWorktree,
  OrphanTracker,
  SessionHistory,
  SessionManager,
} from '../agents/types';
import { resolveWorktreesDir } from './model';
import { findOrphans, normalizePathKey, orphansSignature } from './orphanModel';
import { WorktreeService } from './service';

/** Delay of the first scan, so restored terminals can be adopted (#16a) before we look. */
const STARTUP_DELAY_MS = 2_000;
const DEBOUNCE_MS = 300;

/** Orphaned agent worktrees (#16): worktrees on agent branches with no live or detached session. */
export function createOrphanTracker(
  _context: vscode.ExtensionContext,
  sessions: SessionManager,
  history: SessionHistory,
  service: WorktreeService = new WorktreeService(),
): OrphanTrackerImpl {
  return new OrphanTrackerImpl(sessions, history, service);
}

export class OrphanTrackerImpl implements OrphanTracker, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  private orphans: readonly OrphanedWorktree[] = [];
  private signature = orphansSignature([]);
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queued: Promise<void> | undefined;
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly sessions: SessionManager,
    private readonly history: SessionHistory,
    private readonly service: WorktreeService,
  ) {
    this.disposables.push(
      this.emitter,
      sessions.onDidChangeSessions(() => this.scheduleRefresh()),
      history.onDidChange(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('zedLayout.worktrees')) {
          this.scheduleRefresh();
        }
      }),
    );
    this.scheduleRefresh(STARTUP_DELAY_MS);
  }

  getOrphans(): readonly OrphanedWorktree[] {
    return this.orphans;
  }

  /** Debounced refresh (event bursts collapse into one scan). */
  scheduleRefresh(delay = DEBOUNCE_MS): void {
    if (this.disposed) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, delay);
  }

  /** Scans now; calls made while a scan is pending share it, calls during a scan queue one more. */
  refresh(): Promise<void> {
    if (this.queued) {
      return this.queued;
    }
    const run = this.tail.then(async () => {
      this.queued = undefined;
      if (this.disposed) {
        return;
      }
      const next = await this.scan();
      this.update(next);
    });
    this.queued = run;
    this.tail = run.catch(() => undefined);
    return run;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const d of this.disposables.splice(0)) {
      d.dispose();
    }
  }

  private update(next: readonly OrphanedWorktree[]): void {
    if (this.disposed) {
      return;
    }
    const signature = orphansSignature(next);
    if (signature === this.signature) {
      return;
    }
    this.orphans = next;
    this.signature = signature;
    this.emitter.fire();
  }

  private async scan(): Promise<OrphanedWorktree[]> {
    const show = vscode.workspace
      .getConfiguration('zedLayout.worktrees')
      .get<boolean>('showOrphaned', true);
    return show ? this.collect() : [];
  }

  /**
   * Scans the repositories of the workspace folders now, ignoring `showOrphaned` (used by the
   * clean-up command, which works even when orphans are hidden in the view).
   */
  async collect(): Promise<OrphanedWorktree[]> {
    const folders = (vscode.workspace.workspaceFolders ?? []).filter(
      (f) => f.uri.scheme === 'file',
    );
    if (folders.length === 0) {
      return [];
    }

    // Worktrees in use: live sessions, and worktrees open as workspace folders in this window.
    const livePaths: string[] = folders.map((f) => f.uri.fsPath);
    for (const s of this.sessions.getSessions()) {
      if (s.worktree) {
        livePaths.push(s.worktree.path);
      }
      if (s.cwd) {
        livePaths.push(s.cwd);
      }
    }
    const detachedPaths: string[] = [];
    for (const r of this.history.getDetached()) {
      if (r.worktree) {
        detachedPaths.push(r.worktree.path);
      }
    }

    const roots = await Promise.all(
      folders.map(async (folder) => ({
        folder,
        root: await this.service.tryGetRepoRoot(folder.uri.fsPath),
      })),
    );
    const seen = new Set<string>();
    const result: OrphanedWorktree[] = [];
    for (const { folder, root } of roots) {
      if (!root) {
        continue;
      }
      try {
        const entries = await this.service.list(root);
        // The first entry is the main worktree, also when `root` is a linked worktree.
        const main = entries[0]?.path ? path.normalize(entries[0].path) : root;
        const key = normalizePathKey(main);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const config = vscode.workspace.getConfiguration('zedLayout.worktrees', folder.uri);
        const orphans = findOrphans(entries, {
          repoRoot: main,
          worktreesDir: resolveWorktreesDir(
            main,
            config.get<string>('directory', ''),
            path,
            os.homedir(),
          ),
          branchPrefix: config.get<string>('branchPrefix', 'agent/') ?? 'agent/',
          livePaths,
          detachedPaths,
        }).filter((o) => !this.history.findByWorktreePath(o.path));
        if (orphans.length === 0) {
          continue;
        }
        const bases = await this.service.readBaseRefs(main);
        for (const o of orphans) {
          o.path = path.normalize(o.path);
          const base = o.branch ? bases.get(o.branch) : undefined;
          if (base) {
            o.baseRef = base;
          }
          result.push(o);
        }
      } catch {
        // Repository unreadable (git missing, corrupt…): skip it, keep the others.
      }
    }
    return result;
  }
}
