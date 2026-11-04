/**
 * Thin adapters between the pure layout logic and the VS Code API (#4).
 */
import * as vscode from 'vscode';

import {
  BACKUP_STATE_KEY,
  isLayoutBackup,
  type BackupStorage,
  type ScopedSettings,
} from './backup';
import type { LayoutTarget } from './preset';

export function configurationTarget(target: LayoutTarget): vscode.ConfigurationTarget {
  return target === 'user'
    ? vscode.ConfigurationTarget.Global
    : vscode.ConfigurationTarget.Workspace;
}

/** Settings at the User (`globalValue`) or Workspace (`workspaceValue`) scope. */
export function scopedSettings(target: LayoutTarget): ScopedSettings {
  return {
    get(key) {
      // Fresh configuration on each read: earlier updates must be visible.
      const inspected = vscode.workspace.getConfiguration().inspect(key);
      return target === 'user' ? inspected?.globalValue : inspected?.workspaceValue;
    },
    update(key, value) {
      return vscode.workspace.getConfiguration().update(key, value, configurationTarget(target));
    },
  };
}

/** Backup for User settings lives in globalState, for Workspace settings in workspaceState. */
export function backupStorage(
  context: vscode.ExtensionContext,
  target: LayoutTarget,
): BackupStorage {
  const memento = target === 'user' ? context.globalState : context.workspaceState;
  return {
    get() {
      const value = memento.get<unknown>(BACKUP_STATE_KEY);
      return isLayoutBackup(value) && value.target === target ? value : undefined;
    },
    set(backup) {
      return memento.update(BACKUP_STATE_KEY, backup);
    },
  };
}
