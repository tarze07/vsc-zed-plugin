/**
 * Reads `zedLayout.layout.*` / `zedLayout.typography.*` into typed options (#4).
 *
 * Pure: the caller passes a getter (backed by `WorkspaceConfiguration.get` in the extension),
 * so invalid / missing values can be tested without VS Code.
 */
import { DEFAULT_TYPOGRAPHY, type TypographyOptions } from '../theme/typography';
import type { ActivityBarLocation, LayoutOptions, ZedTheme } from './preset';

export type ScopeSetting = 'ask' | 'user' | 'workspace';

/** Returns the raw value of a setting key (e.g. `zedLayout.layout.scope`), or undefined. */
export type SettingGetter = (key: string) => unknown;

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

export function readTypographyOptions(get: SettingGetter): TypographyOptions {
  const d = DEFAULT_TYPOGRAPHY;
  return {
    enabled: bool(get('zedLayout.typography.enabled'), d.enabled),
    fontFamily: str(get('zedLayout.typography.fontFamily'), d.fontFamily),
    fontSize: num(get('zedLayout.typography.fontSize'), d.fontSize),
    lineHeight: num(get('zedLayout.typography.lineHeight'), d.lineHeight),
    ligatures: bool(get('zedLayout.typography.ligatures'), d.ligatures),
    applyToTerminal: bool(get('zedLayout.typography.applyToTerminal'), d.applyToTerminal),
  };
}

export function readLayoutOptions(get: SettingGetter): LayoutOptions {
  return {
    activityBarLocation: pick<ActivityBarLocation>(
      get('zedLayout.layout.activityBarLocation'),
      ['top', 'hidden'],
      'top',
    ),
    hideBreadcrumbs: bool(get('zedLayout.layout.hideBreadcrumbs'), false),
    applyTheme: bool(get('zedLayout.layout.applyTheme'), true),
    theme: pick<ZedTheme>(
      get('zedLayout.layout.theme'),
      ['Zed-like Dark', 'Zed-like Light'],
      'Zed-like Dark',
    ),
    typography: readTypographyOptions(get),
  };
}

export function readScopeSetting(get: SettingGetter): ScopeSetting {
  return pick<ScopeSetting>(get('zedLayout.layout.scope'), ['ask', 'user', 'workspace'], 'ask');
}

export function readConfirmBeforeApply(get: SettingGetter): boolean {
  return bool(get('zedLayout.layout.confirmBeforeApply'), true);
}
