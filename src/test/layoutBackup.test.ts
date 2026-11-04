import * as assert from 'assert';

import {
  applyWithBackup,
  changedKeys,
  isLayoutBackup,
  restoreFromBackup,
  type BackupStorage,
  type LayoutBackup,
  type ScopedSettings,
} from '../layout/backup';

class MemorySettings implements ScopedSettings {
  readonly values = new Map<string, unknown>();
  failOn = new Set<string>();

  constructor(initial: Record<string, unknown> = {}) {
    for (const [k, v] of Object.entries(initial)) {
      this.values.set(k, v);
    }
  }

  get(key: string): unknown {
    return this.values.get(key);
  }

  async update(key: string, value: unknown): Promise<void> {
    if (this.failOn.has(key)) {
      throw new Error(`cannot write ${key}`);
    }
    if (value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, value);
    }
  }

  toObject(): Record<string, unknown> {
    return Object.fromEntries(this.values);
  }
}

class MemoryStorage implements BackupStorage {
  // Round-trip through JSON like a real Memento does.
  private raw: string | undefined;

  get(): LayoutBackup | undefined {
    return this.raw === undefined ? undefined : (JSON.parse(this.raw) as LayoutBackup);
  }

  async set(backup: LayoutBackup | undefined): Promise<void> {
    this.raw = backup === undefined ? undefined : JSON.stringify(backup);
  }
}

const PRESET = {
  'editor.minimap.enabled': false,
  'workbench.sideBar.location': 'left',
  'editor.scrollbar.verticalScrollbarSize': 8,
};

suite('Layout backup', () => {
  test('apply then restore round-trips 1:1, removing previously unset keys', async () => {
    const original = {
      'editor.minimap.enabled': true,
      'editor.fontSize': 13, // not part of the preset: must stay untouched
      'workbench.colorCustomizations': { 'editor.background': '#000000' },
    };
    const settings = new MemorySettings(original);
    const storage = new MemoryStorage();

    await applyWithBackup(settings, storage, PRESET, 'user', new Date('2026-01-01T00:00:00Z'));
    assert.deepStrictEqual(settings.toObject(), { ...original, ...PRESET });

    const backup = storage.get();
    assert.ok(isLayoutBackup(backup));
    assert.strictEqual(backup.target, 'user');
    assert.strictEqual(backup.timestamp, '2026-01-01T00:00:00.000Z');
    assert.deepStrictEqual(backup.entries, [
      { key: 'editor.minimap.enabled', wasSet: true, value: true },
      { key: 'workbench.sideBar.location', wasSet: false },
      { key: 'editor.scrollbar.verticalScrollbarSize', wasSet: false },
    ]);

    const result = await restoreFromBackup(settings, storage);
    assert.ok(result);
    assert.strictEqual(result.restored.length, 3);
    assert.deepStrictEqual(result.failed, []);
    assert.deepStrictEqual(settings.toObject(), original);
    assert.strictEqual(storage.get(), undefined, 'backup is cleared after restore');
  });

  test('second apply keeps the original backup and only adds new keys', async () => {
    const settings = new MemorySettings({ 'editor.minimap.enabled': true });
    const storage = new MemoryStorage();

    await applyWithBackup(settings, storage, PRESET, 'user', new Date('2026-01-01T00:00:00Z'));
    // The user tweaks a preset key, then applies again with an extra key.
    await settings.update('editor.minimap.enabled', 'tweaked');
    await settings.update('breadcrumbs.enabled', true);
    await applyWithBackup(
      settings,
      storage,
      { ...PRESET, 'breadcrumbs.enabled': false },
      'user',
      new Date('2026-02-01T00:00:00Z'),
    );

    const backup = storage.get();
    assert.ok(backup);
    assert.strictEqual(backup.timestamp, '2026-01-01T00:00:00.000Z');
    assert.deepStrictEqual(backup.entries[0], {
      key: 'editor.minimap.enabled',
      wasSet: true,
      value: true,
    });
    assert.deepStrictEqual(backup.entries[3], {
      key: 'breadcrumbs.enabled',
      wasSet: true,
      value: true,
    });

    await restoreFromBackup(settings, storage);
    assert.deepStrictEqual(settings.toObject(), {
      'editor.minimap.enabled': true,
      'breadcrumbs.enabled': true,
    });
  });

  test('backup stores a deep copy of object values', async () => {
    const value = { a: 1 };
    const settings = new MemorySettings({ 'workbench.sideBar.location': value });
    const storage = new MemoryStorage();
    await applyWithBackup(settings, storage, PRESET, 'user');
    value.a = 2;
    await restoreFromBackup(settings, storage);
    assert.deepStrictEqual(settings.get('workbench.sideBar.location'), { a: 1 });
  });

  test('restore without a backup returns undefined and changes nothing', async () => {
    const settings = new MemorySettings({ 'editor.minimap.enabled': true });
    const result = await restoreFromBackup(settings, new MemoryStorage());
    assert.strictEqual(result, undefined);
    assert.deepStrictEqual(settings.toObject(), { 'editor.minimap.enabled': true });
  });

  test('failed restore keeps the failed entries for a retry', async () => {
    const settings = new MemorySettings({ 'editor.minimap.enabled': true });
    const storage = new MemoryStorage();
    await applyWithBackup(settings, storage, PRESET, 'user');

    settings.failOn.add('editor.minimap.enabled');
    const result = await restoreFromBackup(settings, storage);
    assert.ok(result);
    assert.deepStrictEqual(
      result.failed.map((f) => f.key),
      ['editor.minimap.enabled'],
    );
    assert.deepStrictEqual(
      storage.get()?.entries.map((e) => e.key),
      ['editor.minimap.enabled'],
    );

    settings.failOn.clear();
    await restoreFromBackup(settings, storage);
    assert.deepStrictEqual(settings.toObject(), { 'editor.minimap.enabled': true });
    assert.strictEqual(storage.get(), undefined);
  });

  test('backup is written before settings, so a failed apply can be restored', async () => {
    const settings = new MemorySettings({ 'editor.minimap.enabled': true });
    const storage = new MemoryStorage();
    settings.failOn.add('editor.scrollbar.verticalScrollbarSize');
    await assert.rejects(applyWithBackup(settings, storage, PRESET, 'user'));
    assert.strictEqual(settings.get('editor.minimap.enabled'), false);

    settings.failOn.clear();
    await restoreFromBackup(settings, storage);
    assert.deepStrictEqual(settings.toObject(), { 'editor.minimap.enabled': true });
  });

  test('changedKeys reports only differing values', () => {
    const settings = new MemorySettings({
      'editor.minimap.enabled': false,
      'workbench.sideBar.location': 'right',
    });
    assert.deepStrictEqual(changedKeys(settings, PRESET), [
      'workbench.sideBar.location',
      'editor.scrollbar.verticalScrollbarSize',
    ]);
  });

  test('isLayoutBackup rejects malformed state', () => {
    assert.strictEqual(isLayoutBackup(undefined), false);
    assert.strictEqual(
      isLayoutBackup({ version: 2, target: 'user', timestamp: '', entries: [] }),
      false,
    );
    assert.strictEqual(
      isLayoutBackup({ version: 1, target: 'x', timestamp: '', entries: [] }),
      false,
    );
    assert.strictEqual(
      isLayoutBackup({ version: 1, target: 'workspace', timestamp: 't', entries: [{ key: 'a' }] }),
      true,
    );
  });
});
