/**
 * VS Code Profile export of the Zed-like preset (#13).
 *
 * Pure: no `vscode` import (also not transitively), so the profile can be built in unit
 * tests and by `scripts/generate-profile.mjs` from the compiled output.
 *
 * Format of a `.code-profile` file (VS Code `IUserDataProfileTemplate`), as written by
 * `Profiles: Export Profile...`:
 *
 * ```jsonc
 * {
 *   "name": "Zed Layout",
 *   "settings": "{\"settings\":\"{\\n  \\\"editor.fontSize\\\": 14\\n}\\n\"}",
 *   "extensions": "[{\"identifier\":{\"id\":\"tarze07.vsc-zed-plugin\"},\"displayName\":\"...\"}]"
 * }
 * ```
 *
 * Each resource is a JSON *string*. `settings` is double-encoded: the outer string holds
 * `{ "settings": "<content of settings.json>" }`. Optional resources (`keybindings`,
 * `snippets`, `tasks`, `globalState`) are omitted, so importing leaves them at defaults.
 */
import { readLayoutOptions } from '../layout/options';
import { buildPreset, type LayoutOptions, type SettingsMap } from '../layout/preset';

/** Identifier of this extension (`publisher.name` from package.json). */
export const EXTENSION_ID = 'tarze07.vsc-zed-plugin';
export const EXTENSION_DISPLAY_NAME = 'Zed-like Agent Workspace';

/** Default profile name (also used by `zedLayout.profile.save`). */
export const DEFAULT_PROFILE_NAME = 'Zed Layout';

export interface ProfileExtension {
  /** `publisher.name`. */
  id: string;
  displayName?: string;
}

export interface CodeProfileInput {
  name: string;
  layoutOptions: LayoutOptions;
  /** Defaults to this extension (it provides the Zed-like themes). */
  extensions?: ProfileExtension[];
}

/** The `.code-profile` JSON object (resources are JSON strings). */
export interface CodeProfile {
  name: string;
  settings: string;
  extensions: string;
}

export interface ParsedCodeProfile {
  name: string;
  settings: Record<string, unknown>;
  extensions: string[];
}

export const DEFAULT_PROFILE_EXTENSIONS: readonly ProfileExtension[] = [
  { id: EXTENSION_ID, displayName: EXTENSION_DISPLAY_NAME },
];

/** Layout options with all `zedLayout.*` settings at their defaults. */
export function defaultLayoutOptions(): LayoutOptions {
  return readLayoutOptions(() => undefined);
}

/** Settings written into the profile: the full preset (incl. `window.*`) + `zedLayout.enabled`. */
export function profileSettings(layoutOptions: LayoutOptions): SettingsMap {
  return { ...buildPreset(layoutOptions), 'zedLayout.enabled': true };
}

/** Builds the `.code-profile` object for the given preset options. */
export function buildCodeProfile(input: CodeProfileInput): CodeProfile {
  const settingsJson = JSON.stringify(profileSettings(input.layoutOptions), null, 2) + '\n';
  const extensions = (input.extensions ?? DEFAULT_PROFILE_EXTENSIONS).map((e) => ({
    identifier: { id: e.id },
    ...(e.displayName !== undefined ? { displayName: e.displayName } : {}),
  }));
  return {
    name: input.name,
    settings: JSON.stringify({ settings: settingsJson }),
    extensions: JSON.stringify(extensions),
  };
}

/** The profile committed as `profiles/zed-like.code-profile` (defaults). */
export function buildDefaultCodeProfile(): CodeProfile {
  return buildCodeProfile({ name: DEFAULT_PROFILE_NAME, layoutOptions: defaultLayoutOptions() });
}

/** Serializes a profile as written to disk (pretty-printed, trailing newline). */
export function serializeCodeProfile(profile: CodeProfile): string {
  return JSON.stringify(profile, null, 2) + '\n';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decodes a `.code-profile` file (inverse of {@link buildCodeProfile}). Throws on bad input. */
export function parseCodeProfile(text: string): ParsedCodeProfile {
  const root: unknown = JSON.parse(text);
  if (!isRecord(root) || typeof root.name !== 'string') {
    throw new Error('Invalid code profile: missing "name".');
  }

  let settings: Record<string, unknown> = {};
  if (typeof root.settings === 'string') {
    const wrapper: unknown = JSON.parse(root.settings);
    if (!isRecord(wrapper) || typeof wrapper.settings !== 'string') {
      throw new Error('Invalid code profile: "settings" must wrap a settings.json string.');
    }
    const content: unknown = JSON.parse(wrapper.settings);
    if (!isRecord(content)) {
      throw new Error('Invalid code profile: settings.json must be an object.');
    }
    settings = content;
  }

  let extensions: string[] = [];
  if (typeof root.extensions === 'string') {
    const list: unknown = JSON.parse(root.extensions);
    if (!Array.isArray(list)) {
      throw new Error('Invalid code profile: "extensions" must be an array.');
    }
    extensions = list.map((e: unknown) => {
      if (!isRecord(e) || !isRecord(e.identifier) || typeof e.identifier.id !== 'string') {
        throw new Error('Invalid code profile: extension without identifier.id.');
      }
      return e.identifier.id;
    });
  }

  return { name: root.name, settings, extensions };
}
