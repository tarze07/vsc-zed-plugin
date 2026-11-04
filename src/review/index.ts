import * as vscode from 'vscode';

import type { SessionManager } from '../agents/types';
import { ReviewCommands } from './commands';
import { REVIEW_BASE_SCHEME, ReviewBaseContentProvider } from './content';
import { GitReviewService } from './service';
import type { ReviewService } from './types';
import { createAgentChangesView } from './view';

/** Review (#10): Agent Changes view, multi-diff and accept/reject actions. */
export function register(
  context: vscode.ExtensionContext,
  sessions: SessionManager,
  service: ReviewService = new GitReviewService(),
): void {
  const changesView = createAgentChangesView(sessions, service);
  const commands = new ReviewCommands({
    sessions,
    service,
    provider: changesView.provider,
    view: changesView.view,
  });

  context.subscriptions.push(
    changesView,
    vscode.workspace.registerTextDocumentContentProvider(
      REVIEW_BASE_SCHEME,
      new ReviewBaseContentProvider(service),
    ),
    ...commands.register(),
  );
}
