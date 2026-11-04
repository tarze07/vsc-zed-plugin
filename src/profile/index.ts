import * as vscode from 'vscode';

import { readLayoutOptions } from '../layout/options';
import { buildCodeProfile, DEFAULT_PROFILE_NAME, serializeCodeProfile } from './profile';

/** Docs opened by "Open Docs" (docs/** is not packaged in the VSIX, so use the repo URL). */
export const PROFILE_DOCS_URL =
  'https://github.com/tarze07/vsc-zed-plugin/blob/main/docs/PROFILE.md';

/** Built-in command behind `Profiles: Import Profile...`. */
export const IMPORT_PROFILE_COMMAND = 'workbench.profiles.actions.importProfile';

/** Profile export (#13): `zedLayout.profile.save` writes the preset as a `.code-profile` file. */
export function register(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('zedLayout.profile.save', () => saveProfile()),
  );
}

function defaultSaveUri(): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  return folder ? vscode.Uri.joinPath(folder, 'zed-layout.code-profile') : undefined;
}

async function saveProfile(): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: 'Save Zed Layout as Profile File',
    prompt: 'Name of the VS Code profile',
    value: DEFAULT_PROFILE_NAME,
    validateInput: (value) => (value.trim() === '' ? 'Enter a profile name.' : undefined),
  });
  if (name === undefined) {
    return;
  }

  const config = vscode.workspace.getConfiguration();
  const layoutOptions = readLayoutOptions((key) => config.get<unknown>(key));
  const content = serializeCodeProfile(buildCodeProfile({ name: name.trim(), layoutOptions }));

  const uri = await vscode.window.showSaveDialog({
    title: 'Save Zed Layout as Profile File',
    saveLabel: 'Save Profile',
    defaultUri: defaultSaveUri(),
    filters: { 'Code Profile': ['code-profile'] },
  });
  if (!uri) {
    return;
  }

  try {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Zed Layout: could not save the profile: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const importAction = 'Import Profile…';
  const docsAction = 'Open Docs';
  const choice = await vscode.window.showInformationMessage(
    `Zed Layout: profile "${name.trim()}" saved to ${uri.fsPath}. Import it with "Profiles: Import Profile..." to use the Zed layout in a separate profile.`,
    importAction,
    docsAction,
  );
  if (choice === importAction) {
    try {
      await vscode.commands.executeCommand(IMPORT_PROFILE_COMMAND);
    } catch {
      void vscode.window.showWarningMessage(
        `Zed Layout: could not open the import dialog. Run "Profiles: Import Profile..." from the Command Palette and select ${uri.fsPath}.`,
      );
    }
  } else if (choice === docsAction) {
    await vscode.env.openExternal(vscode.Uri.parse(PROFILE_DOCS_URL));
  }
}
