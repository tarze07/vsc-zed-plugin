import * as vscode from 'vscode';

import * as agents from './agents';
import * as layout from './layout';
import * as profile from './profile';
import * as review from './review';
import * as theme from './theme';
import * as views from './views';
import * as worktrees from './worktrees';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('zedLayout.hello', () => {
      void vscode.window.showInformationMessage('Hello from Zed-like Agent Workspace!');
    }),
  );

  layout.register(context);
  theme.register(context);
  profile.register(context);
  const sessions = agents.register(context);
  worktrees.register(context, sessions);
  review.register(context, sessions);
  views.register(context, sessions);
}

export function deactivate(): void {
  // Nothing to clean up yet; disposables are tracked via context.subscriptions.
}
