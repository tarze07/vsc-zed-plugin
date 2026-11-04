/**
 * Pure description of the Zed-like layout preset (#4).
 *
 * No `vscode` import: everything here is unit-testable outside the extension host.
 */
import { getTypographySettings, type TypographyOptions } from '../theme/typography';

/** Where `Apply Zed Layout` writes settings. */
export type LayoutTarget = 'user' | 'workspace';

export type ActivityBarLocation = 'top' | 'hidden';
export type ZedTheme = 'Zed-like Dark' | 'Zed-like Light';

export interface LayoutOptions {
  activityBarLocation: ActivityBarLocation;
  hideBreadcrumbs: boolean;
  applyTheme: boolean;
  theme: ZedTheme;
  typography: TypographyOptions;
}

/** Map of VS Code setting keys to the values written by the preset. */
export type SettingsMap = Record<string, unknown>;

/**
 * Settings whose scope is `application` or `window` (all `window.*` keys, e.g.
 * `window.titleBarStyle`, `window.density.editorTabHeight`). VS Code ignores them in
 * Workspace settings, so they are only written when the target is User settings.
 */
export function isUserOnlySetting(key: string): boolean {
  return key.startsWith('window.');
}

/** Builds the full preset (all keys, regardless of target). */
export function buildPreset(options: LayoutOptions): SettingsMap {
  const settings: SettingsMap = {
    // Workbench layout
    'workbench.activityBar.location': options.activityBarLocation,
    'workbench.sideBar.location': 'left',
    'workbench.panel.defaultLocation': 'bottom',
    'workbench.layoutControl.enabled': false,
    // Compact tabs
    'workbench.editor.tabSizing': 'shrink',
    'window.density.editorTabHeight': 'compact',
    // Less editor chrome
    'editor.minimap.enabled': false,
    'editor.renderLineHighlight': 'gutter',
    'editor.scrollbar.verticalScrollbarSize': 8,
    'editor.scrollbar.horizontalScrollbarSize': 8,
    // Title bar
    'window.titleBarStyle': 'custom',
  };

  if (options.hideBreadcrumbs) {
    settings['breadcrumbs.enabled'] = false;
  }

  if (options.applyTheme) {
    settings['workbench.colorTheme'] = options.theme;
  }

  if (options.typography.enabled) {
    Object.assign(settings, getTypographySettings(options.typography));
  }

  return settings;
}

export interface TargetedPreset {
  /** Settings to write at the target scope. */
  settings: SettingsMap;
  /** Keys left out because they have no effect at the target scope. */
  skipped: string[];
}

/** Drops settings that cannot be written at the given target (Workspace skips `window.*`). */
export function presetForTarget(preset: SettingsMap, target: LayoutTarget): TargetedPreset {
  const settings: SettingsMap = {};
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(preset)) {
    if (target === 'workspace' && isUserOnlySetting(key)) {
      skipped.push(key);
    } else {
      settings[key] = value;
    }
  }
  return { settings, skipped };
}
