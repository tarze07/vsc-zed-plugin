/**
 * Backup / restore logic for the layout preset (#4).
 *
 * Pure: works against small interfaces (`ScopedSettings`, `BackupStorage`) so it can be
 * tested with in-memory fakes. The VS Code adapters live in `./vscodeAdapters.ts`.
 */
import type { LayoutTarget, SettingsMap } from './preset';

/** Settings at a single scope (User or Workspace). */
export interface ScopedSettings {
  /** Value explicitly set at this scope, or undefined when the key is not set there. */
  get(key: string): unknown;
  /** Writes a value at this scope; `undefined` removes the key. */
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/** Persistent storage for a single backup (globalState for User, workspaceState for Workspace). */
export interface BackupStorage {
  get(): LayoutBackup | undefined;
  set(backup: LayoutBackup | undefined): Thenable<void> | Promise<void>;
}

export interface BackupEntry {
  key: string;
  /** False when the key was not set at the target scope (restore removes it). */
  wasSet: boolean;
  /** Original value (only meaningful when `wasSet`). */
  value?: unknown;
}

export interface LayoutBackup {
  version: 1;
  target: LayoutTarget;
  /** ISO timestamp of the first apply that created this backup. */
  timestamp: string;
  entries: BackupEntry[];
}

export const BACKUP_STATE_KEY = 'zedLayout.layout.backup';

/** Reads a stored value defensively (state may come from an older / foreign version). */
export function isLayoutBackup(value: unknown): value is LayoutBackup {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Partial<LayoutBackup>;
  return (
    v.version === 1 &&
    (v.target === 'user' || v.target === 'workspace') &&
    typeof v.timestamp === 'string' &&
    Array.isArray(v.entries) &&
    v.entries.every((e) => typeof e === 'object' && e !== null && typeof e.key === 'string')
  );
}

function snapshot(settings: ScopedSettings, key: string): BackupEntry {
  const value = settings.get(key);
  // Deep-copy so later mutations of config objects cannot alter the backup.
  return value === undefined
    ? { key, wasSet: false }
    : { key, wasSet: true, value: JSON.parse(JSON.stringify(value)) as unknown };
}

/**
 * Creates or extends the backup for `keys`. An existing backup is never overwritten:
 * its entries (the true pre-extension values) are kept and only keys it does not cover yet
 * are added, so Restore always returns to the state before the first Apply.
 */
export function mergeBackup(
  existing: LayoutBackup | undefined,
  settings: ScopedSettings,
  keys: readonly string[],
  target: LayoutTarget,
  now: Date,
): LayoutBackup {
  const base: LayoutBackup =
    existing && existing.target === target
      ? { ...existing, entries: [...existing.entries] }
      : { version: 1, target, timestamp: now.toISOString(), entries: [] };
  const known = new Set(base.entries.map((e) => e.key));
  for (const key of keys) {
    if (!known.has(key)) {
      base.entries.push(snapshot(settings, key));
      known.add(key);
    }
  }
  return base;
}

/** Saves the backup first, then writes the preset settings at the target scope. */
export async function applyWithBackup(
  settings: ScopedSettings,
  storage: BackupStorage,
  preset: SettingsMap,
  target: LayoutTarget,
  now: Date = new Date(),
): Promise<LayoutBackup> {
  const backup = mergeBackup(storage.get(), settings, Object.keys(preset), target, now);
  await storage.set(backup);
  for (const [key, value] of Object.entries(preset)) {
    await settings.update(key, value);
  }
  return backup;
}

export interface RestoreResult {
  restored: string[];
  failed: { key: string; error: unknown }[];
}

/**
 * Writes back every backed-up value (unset keys are removed) and clears the backup.
 * Returns undefined when there is no backup. If some writes fail, the backup is kept
 * (reduced to the failed keys) so Restore can be retried.
 */
export async function restoreFromBackup(
  settings: ScopedSettings,
  storage: BackupStorage,
): Promise<RestoreResult | undefined> {
  const backup = storage.get();
  if (!backup) {
    return undefined;
  }
  const result: RestoreResult = { restored: [], failed: [] };
  for (const entry of backup.entries) {
    try {
      await settings.update(entry.key, entry.wasSet ? entry.value : undefined);
      result.restored.push(entry.key);
    } catch (error) {
      result.failed.push({ key: entry.key, error });
    }
  }
  if (result.failed.length === 0) {
    await storage.set(undefined);
  } else {
    const failedKeys = new Set(result.failed.map((f) => f.key));
    await storage.set({
      ...backup,
      entries: backup.entries.filter((e) => failedKeys.has(e.key)),
    });
  }
  return result;
}

/** Keys whose current value at the target scope differs from the preset value. */
export function changedKeys(settings: ScopedSettings, preset: SettingsMap): string[] {
  return Object.entries(preset)
    .filter(([key, value]) => JSON.stringify(settings.get(key)) !== JSON.stringify(value))
    .map(([key]) => key);
}
