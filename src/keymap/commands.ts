/**
 * Keymap (#11) constants shared by the extension code and the unit tests.
 * Kept free of `vscode` imports so it can be loaded from plain mocha tests.
 */

/** Setting that gates every keybinding contributed by the extension. */
export const KEYMAP_SETTING = 'zedLayout.keymap.enabled';

/** `when`-clause prefix every contributed keybinding must start with. */
export const KEYMAP_WHEN = `config.${KEYMAP_SETTING}`;

/** View container that hosts the Agents and Agent Changes views. */
export const AGENTS_CONTAINER_ID = 'zedLayoutAgents';

/** Helper commands registered by `src/keymap/index.ts`. */
export const KEYMAP_COMMANDS = {
  toggleAgentsPanel: 'zedLayout.keymap.toggleAgentsPanel',
  toggleProjectPanel: 'zedLayout.keymap.toggleProjectPanel',
} as const;

/** Built-in command that shows (and focuses) the Agents view container, wherever it is docked. */
export const SHOW_AGENTS_CONTAINER_COMMAND = `workbench.view.extension.${AGENTS_CONTAINER_ID}`;

/** Built-in command that shows (and focuses) the Explorer, wherever it is docked. */
export const SHOW_EXPLORER_COMMAND = 'workbench.view.explorer';
