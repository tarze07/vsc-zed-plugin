import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'tarze07.vsc-zed-plugin';

suite('Extension', () => {
  test('activates and registers zedLayout.hello', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `Extension ${EXTENSION_ID} not found`);

    await extension.activate();
    assert.strictEqual(extension.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('zedLayout.hello'), 'Command zedLayout.hello is not registered');
  });
});
