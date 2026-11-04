import * as vscode from 'vscode';

import { KEYMAP_COMMANDS, SHOW_AGENTS_CONTAINER_COMMAND, SHOW_EXPLORER_COMMAND } from './commands';

export * from './commands';

/**
 * Keymap (#11): helper commands used by the optional Zed-style keybindings.
 *
 * An extension cannot read workbench context keys such as `sideBarFocus` or `activeViewlet`,
 * so the "hide" half of each toggle lives in `contributes.keybindings` (`when` clauses that call
 * `workbench.action.closeSidebar` / `closeAuxiliaryBar` / `closePanel` while the panel has focus).
 * The helpers below implement the "show and focus" half, which is also what they do when invoked
 * from the Command Palette.
 */
export function register(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(KEYMAP_COMMANDS.toggleAgentsPanel, () =>
      vscode.commands.executeCommand(SHOW_AGENTS_CONTAINER_COMMAND),
    ),
    vscode.commands.registerCommand(KEYMAP_COMMANDS.toggleProjectPanel, () =>
      vscode.commands.executeCommand(SHOW_EXPLORER_COMMAND),
    ),
  );
}
