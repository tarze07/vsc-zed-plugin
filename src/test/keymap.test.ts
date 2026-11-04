import * as assert from 'assert';
import * as vscode from 'vscode';

import { KEYMAP_COMMANDS } from '../keymap/commands';

const EXTENSION_ID = 'tarze07.vsc-zed-plugin';

suite('Keymap helper commands', () => {
  test('are registered on activation', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `Extension ${EXTENSION_ID} not found`);
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    for (const id of Object.values(KEYMAP_COMMANDS)) {
      assert.ok(commands.includes(id), `Command ${id} is not registered`);
    }
  });
});
