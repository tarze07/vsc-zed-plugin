import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'tarze07.vsc-zed-plugin';

suite('Layout commands (integration)', () => {
  test('registers zedLayout.apply and zedLayout.restore', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('zedLayout.apply'));
    assert.ok(commands.includes('zedLayout.restore'));
  });

  test('restore without a backup is a no-op', async () => {
    const before = vscode.workspace
      .getConfiguration()
      .inspect('editor.minimap.enabled')?.globalValue;
    await vscode.commands.executeCommand('zedLayout.restore');
    const after = vscode.workspace
      .getConfiguration()
      .inspect('editor.minimap.enabled')?.globalValue;
    assert.strictEqual(after, before);
  });
});
