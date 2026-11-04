/**
 * Contrast checks for the Zed-like color themes (#5, WCAG AA acceptance criterion).
 *
 * Pure module (no `vscode` import): used by unit tests and by `scripts/contrast-report.mjs`.
 */
import { contrastRatio, WCAG_AA_LARGE, WCAG_AA_NORMAL } from './contrast';

export interface ColorThemeJson {
  name: string;
  type: 'dark' | 'light';
  colors: Record<string, string>;
  tokenColors: Array<{
    name?: string;
    scope?: string | string[];
    settings: { foreground?: string; background?: string; fontStyle?: string };
  }>;
  semanticTokenColors?: Record<string, string | { foreground?: string }>;
}

export interface ContrastCheck {
  label: string;
  foreground: string;
  background: string;
  ratio: number;
  minimum: number;
}

/** Workbench text pairs (foreground key, background key) that must meet WCAG AA (4.5:1). */
export const WORKBENCH_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['editor.foreground', 'editor.background'],
  ['editorLineNumber.activeForeground', 'editor.background'],
  ['sideBar.foreground', 'sideBar.background'],
  ['sideBarSectionHeader.foreground', 'sideBarSectionHeader.background'],
  ['panelTitle.activeForeground', 'panel.background'],
  ['terminal.foreground', 'terminal.background'],
  ['statusBar.foreground', 'statusBar.background'],
  ['titleBar.activeForeground', 'titleBar.activeBackground'],
  ['activityBar.foreground', 'activityBar.background'],
  ['tab.activeForeground', 'tab.activeBackground'],
  ['tab.inactiveForeground', 'tab.inactiveBackground'],
  ['list.activeSelectionForeground', 'list.activeSelectionBackground'],
  ['list.inactiveSelectionForeground', 'list.inactiveSelectionBackground'],
  ['input.foreground', 'input.background'],
  ['dropdown.foreground', 'dropdown.background'],
  ['button.foreground', 'button.background'],
  ['button.secondaryForeground', 'button.secondaryBackground'],
  ['badge.foreground', 'badge.background'],
  ['quickInput.foreground', 'quickInput.background'],
  ['quickInputList.focusForeground', 'quickInputList.focusBackground'],
  ['notifications.foreground', 'notifications.background'],
  ['editorWidget.foreground', 'editorWidget.background'],
  ['menu.foreground', 'menu.background'],
];

/** Secondary text that should stay readable but may use the "large text / UI" threshold (3:1). */
export const WORKBENCH_SECONDARY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['editorLineNumber.foreground', 'editor.background'],
  ['input.placeholderForeground', 'input.background'],
  ['panelTitle.inactiveForeground', 'panel.background'],
  ['activityBarTop.inactiveForeground', 'activityBarTop.background'],
];

const COMMENT_SCOPE = 'comment';

function isCommentRule(scope: string | string[] | undefined): boolean {
  const scopes = Array.isArray(scope) ? scope : scope ? [scope] : [];
  return scopes.includes(COMMENT_SCOPE);
}

function requireColor(theme: ColorThemeJson, key: string): string {
  const value = theme.colors[key];
  if (typeof value !== 'string') {
    throw new Error(`${theme.name}: missing color "${key}"`);
  }
  return value;
}

/** Computes every contrast check for a theme. Translucent backgrounds are placed over the editor. */
export function collectContrastChecks(theme: ColorThemeJson): ContrastCheck[] {
  const editorBg = requireColor(theme, 'editor.background');
  const checks: ContrastCheck[] = [];

  const addPair = (fgKey: string, bgKey: string, minimum: number): void => {
    const foreground = requireColor(theme, fgKey);
    const background = requireColor(theme, bgKey);
    checks.push({
      label: `${fgKey} / ${bgKey}`,
      foreground,
      background,
      ratio: contrastRatio(foreground, background, editorBg),
      minimum,
    });
  };
  WORKBENCH_TEXT_PAIRS.forEach(([fg, bg]) => addPair(fg, bg, WCAG_AA_NORMAL));
  WORKBENCH_SECONDARY_PAIRS.forEach(([fg, bg]) => addPair(fg, bg, WCAG_AA_LARGE));

  for (const rule of theme.tokenColors) {
    const foreground = rule.settings.foreground;
    if (!foreground) {
      continue;
    }
    checks.push({
      label: `token: ${rule.name ?? String(rule.scope)}`,
      foreground,
      background: editorBg,
      ratio: contrastRatio(foreground, editorBg),
      minimum: isCommentRule(rule.scope) ? WCAG_AA_LARGE : WCAG_AA_NORMAL,
    });
  }

  for (const [selector, style] of Object.entries(theme.semanticTokenColors ?? {})) {
    const foreground = typeof style === 'string' ? style : style.foreground;
    if (!foreground) {
      continue;
    }
    checks.push({
      label: `semantic: ${selector}`,
      foreground,
      background: editorBg,
      ratio: contrastRatio(foreground, editorBg),
      minimum: selector === COMMENT_SCOPE ? WCAG_AA_LARGE : WCAG_AA_NORMAL,
    });
  }

  return checks;
}
