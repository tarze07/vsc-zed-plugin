import * as vscode from 'vscode';

import { applyWithBackup, changedKeys, restoreFromBackup } from './backup';
import {
  readConfirmBeforeApply,
  readLayoutOptions,
  readScopeSetting,
  type SettingGetter,
} from './options';
import { buildPreset, presetForTarget, type LayoutTarget } from './preset';
import { backupStorage, scopedSettings } from './vscodeAdapters';

/**
 * Layout preset: applies the Zed-like settings preset and backs up / restores previous
 * values (M1, #4). See docs/LAYOUT.md.
 */
export function register(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('zedLayout.apply', () => applyLayout(context)),
    vscode.commands.registerCommand('zedLayout.restore', () => restoreLayout(context)),
  );
}

/** Workbench commands run after applying settings (best effort, in this order). */
export const LAYOUT_COMMANDS = [
  'workbench.action.closePanel',
  'workbench.action.focusAuxiliaryBar',
  'workbench.action.focusActiveEditorGroup',
] as const;

const TARGET_LABEL: Record<LayoutTarget, string> = {
  user: 'User settings',
  workspace: 'Workspace settings',
};

function settingGetter(): SettingGetter {
  const config = vscode.workspace.getConfiguration();
  return (key) => config.get<unknown>(key);
}

function hasWorkspace(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

async function pickTarget(): Promise<LayoutTarget | undefined> {
  const scope = readScopeSetting(settingGetter());
  if (scope === 'user') {
    return 'user';
  }
  if (scope === 'workspace') {
    if (!hasWorkspace()) {
      void vscode.window.showWarningMessage(
        'Zed Layout: "zedLayout.layout.scope" is set to "workspace", but no folder is open. Open a folder or change the scope.',
      );
      return undefined;
    }
    return 'workspace';
  }

  const items: (vscode.QuickPickItem & { target: LayoutTarget })[] = [
    { label: 'User', description: 'All windows (User settings)', target: 'user' },
  ];
  if (hasWorkspace()) {
    items.push({
      label: 'Workspace',
      description: 'This workspace only (window.* settings are skipped)',
      target: 'workspace',
    });
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Apply Zed Layout',
    placeHolder: 'Where should the Zed layout settings be written?',
  });
  return picked?.target;
}

async function runLayoutCommands(): Promise<void> {
  for (const command of LAYOUT_COMMANDS) {
    try {
      await vscode.commands.executeCommand(command);
    } catch {
      // Best effort: a missing / failing workbench command must not fail the apply.
    }
  }
}

async function applyLayout(context: vscode.ExtensionContext): Promise<void> {
  const target = await pickTarget();
  if (!target) {
    return;
  }

  const get = settingGetter();
  const { settings: preset, skipped } = presetForTarget(
    buildPreset(readLayoutOptions(get)),
    target,
  );
  const scoped = scopedSettings(target);
  const changed = changedKeys(scoped, preset);

  if (readConfirmBeforeApply(get)) {
    const lines = Object.entries(preset).map(
      ([key, value]) => `${changed.includes(key) ? '•' : '✓'} ${key}: ${JSON.stringify(value)}`,
    );
    if (skipped.length > 0) {
      lines.push('', `Skipped in Workspace scope: ${skipped.join(', ')}`);
    }
    lines.push('', 'Previous values are backed up; use "Restore Previous Layout" to undo.');
    const answer = await vscode.window.showWarningMessage(
      `Apply Zed Layout to ${TARGET_LABEL[target]}? ${changed.length} of ${Object.keys(preset).length} settings will change.`,
      { modal: true, detail: lines.join('\n') },
      'Apply',
    );
    if (answer !== 'Apply') {
      return;
    }
  }

  try {
    await applyWithBackup(scoped, backupStorage(context, target), preset, target);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Zed Layout: failed to apply settings (${String(error)}). Use "Restore Previous Layout" to undo partial changes.`,
    );
    return;
  }

  await runLayoutCommands();

  const skippedNote =
    skipped.length > 0
      ? ` Skipped (not supported in Workspace settings): ${skipped.join(', ')}.`
      : '';
  const action = await vscode.window.showInformationMessage(
    `Zed Layout applied to ${TARGET_LABEL[target]} (${changed.length} settings changed).${skippedNote}`,
    'Restore Previous',
  );
  if (action === 'Restore Previous') {
    await restoreLayout(context, target);
  }
}

async function restoreLayout(
  context: vscode.ExtensionContext,
  preferred?: LayoutTarget,
): Promise<void> {
  const available = (['user', 'workspace'] as const).filter(
    (t) => backupStorage(context, t).get() !== undefined,
  );
  let target: LayoutTarget | undefined;
  if (preferred && available.includes(preferred)) {
    target = preferred;
  } else if (available.length === 1) {
    target = available[0];
  } else if (available.length > 1) {
    const picked = await vscode.window.showQuickPick(
      available.map((t) => {
        const backup = backupStorage(context, t).get();
        return {
          label: t === 'user' ? 'User' : 'Workspace',
          description: backup ? `backup from ${new Date(backup.timestamp).toLocaleString()}` : '',
          target: t,
        };
      }),
      { title: 'Restore Previous Layout', placeHolder: 'Which settings should be restored?' },
    );
    target = picked?.target;
    if (!target) {
      return;
    }
  }

  if (!target) {
    void vscode.window.showInformationMessage(
      'Zed Layout: there is no backup to restore (the layout has not been applied, or it was already restored).',
    );
    return;
  }

  const result = await restoreFromBackup(scopedSettings(target), backupStorage(context, target));
  if (!result) {
    void vscode.window.showInformationMessage('Zed Layout: there is no backup to restore.');
  } else if (result.failed.length > 0) {
    void vscode.window.showErrorMessage(
      `Zed Layout: restored ${result.restored.length} settings, failed: ${result.failed
        .map((f) => f.key)
        .join(', ')}. Run "Restore Previous Layout" again to retry.`,
    );
  } else {
    void vscode.window.showInformationMessage(
      `Zed Layout: restored ${result.restored.length} settings in ${TARGET_LABEL[target]}.`,
    );
  }
}
