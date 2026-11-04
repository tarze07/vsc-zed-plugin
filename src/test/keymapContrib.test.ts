import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { KEYMAP_COMMANDS, KEYMAP_WHEN } from '../keymap/commands';

interface Keybinding {
  command?: string;
  key?: string;
  mac?: string;
  linux?: string;
  win?: string;
  when?: string;
}

interface Manifest {
  contributes: {
    commands: { command: string; category?: string }[];
    keybindings: Keybinding[];
    configuration: { properties: Record<string, { default?: unknown }> };
  };
}

/** Built-in VS Code commands the keymap is allowed to reference. */
const BUILTIN_COMMANDS = new Set([
  'workbench.action.closeSidebar',
  'workbench.action.closeAuxiliaryBar',
  'workbench.action.closePanel',
  'workbench.action.terminal.toggleTerminal',
]);

// Compiled to out/test/, so the manifest is two levels up.
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
) as Manifest;
const keybindings = manifest.contributes.keybindings;
const declared = new Set(manifest.contributes.commands.map((c) => c.command));

suite('Keymap contributions', () => {
  test('keymap setting exists and defaults to false', () => {
    const prop = manifest.contributes.configuration.properties['zedLayout.keymap.enabled'];
    assert.ok(prop, 'zedLayout.keymap.enabled is not declared');
    assert.strictEqual(prop.default, false);
  });

  test('covers the shortcuts required by the issue', () => {
    const commands = new Set(keybindings.map((k) => k.command));
    for (const id of [
      KEYMAP_COMMANDS.toggleAgentsPanel,
      KEYMAP_COMMANDS.toggleProjectPanel,
      'workbench.action.terminal.toggleTerminal',
      'zedLayout.agents.newSession',
      'zedLayout.agents.next',
      'zedLayout.agents.previous',
      'zedLayout.review.open',
    ]) {
      assert.ok(commands.has(id), `No keybinding for ${id}`);
    }
  });

  test('every keybinding is gated by the keymap setting', () => {
    for (const kb of keybindings) {
      assert.ok(kb.when, `${kb.command} has no when clause`);
      assert.ok(
        kb.when === KEYMAP_WHEN || kb.when.startsWith(`${KEYMAP_WHEN} && `),
        `${kb.command} (${kb.key}) is not gated by ${KEYMAP_WHEN}: ${kb.when}`,
      );
      assert.ok(!/\|\|/.test(kb.when), `${kb.command}: top-level || would bypass the setting`);
    }
  });

  test('every keybinding references a declared or allow-listed command', () => {
    for (const kb of keybindings) {
      assert.ok(kb.command, 'keybinding without command');
      assert.ok(
        declared.has(kb.command) || BUILTIN_COMMANDS.has(kb.command),
        `Unknown command ${kb.command}`,
      );
    }
  });

  test('every keybinding has Windows/Linux and macOS variants', () => {
    for (const kb of keybindings) {
      assert.ok(kb.key, `${kb.command} has no key`);
      assert.ok(kb.mac, `${kb.command} has no mac key`);
    }
  });

  test('no duplicate key + when combinations', () => {
    for (const platform of ['key', 'mac'] as const) {
      const seen = new Set<string>();
      for (const kb of keybindings) {
        const id = `${kb[platform]}|${kb.when}`;
        assert.ok(!seen.has(id), `Duplicate ${platform} binding: ${id}`);
        seen.add(id);
      }
    }
  });

  test('helper commands are declared in the Zed Layout category', () => {
    for (const id of Object.values(KEYMAP_COMMANDS)) {
      const cmd = manifest.contributes.commands.find((c) => c.command === id);
      assert.ok(cmd, `${id} is not declared in contributes.commands`);
      assert.strictEqual(cmd.category, 'Zed Layout');
    }
  });
});
