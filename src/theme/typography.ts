/**
 * Typography settings for the Zed-like preset (#5).
 *
 * CONTRACT (shared with the layout preset, #4): pure function, no `vscode` import,
 * so it can be unit-tested. Returns a map of VS Code setting keys to values that the
 * layout preset writes (and backs up) when `zedLayout.typography.enabled` is true.
 */
export interface TypographyOptions {
  enabled: boolean;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  ligatures: boolean;
  applyToTerminal: boolean;
}

export const DEFAULT_TYPOGRAPHY: TypographyOptions = {
  enabled: true,
  fontFamily: "'IBM Plex Mono', 'Lilex', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
  fontSize: 14,
  lineHeight: 1.6,
  ligatures: false,
  applyToTerminal: true,
};

export function getTypographySettings(_options: TypographyOptions): Record<string, unknown> {
  // TODO(#5): implement.
  return {};
}
