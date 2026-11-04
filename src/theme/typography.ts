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

/** Font size bounds (match `zedLayout.typography.fontSize` in package.json). */
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 72;
/** VS Code treats `editor.lineHeight` values below this as a multiplier of the font size. */
export const LINE_HEIGHT_PIXEL_THRESHOLD = 8;
/** Upper bound for the terminal line height multiplier (keeps output readable). */
export const MAX_TERMINAL_LINE_HEIGHT = 3;

/** Mapping of `zedLayout.typography.*` keys (without the prefix) to option fields. */
export const TYPOGRAPHY_SETTING_KEYS: Readonly<Record<keyof TypographyOptions, string>> = {
  enabled: 'enabled',
  fontFamily: 'fontFamily',
  fontSize: 'fontSize',
  lineHeight: 'lineHeight',
  ligatures: 'ligatures',
  applyToTerminal: 'applyToTerminal',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Converts the configured line height to the value for `terminal.integrated.lineHeight`,
 * which is always a multiplier (>= 1). Editor values >= 8 are pixels, so they are divided
 * by the font size.
 */
export function toTerminalLineHeight(lineHeight: number, fontSize: number): number {
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    return 1;
  }
  const multiplier =
    lineHeight < LINE_HEIGHT_PIXEL_THRESHOLD ? lineHeight : lineHeight / Math.max(fontSize, 1);
  return round2(clamp(multiplier, 1, MAX_TERMINAL_LINE_HEIGHT));
}

/**
 * Normalizes the configured line height for `editor.lineHeight`: values below 8 are a
 * multiplier (kept, but at least 1), values >= 8 are pixels (rounded). `0` lets VS Code
 * compute the line height from the font size.
 */
export function toEditorLineHeight(lineHeight: number): number {
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    return 0;
  }
  if (lineHeight < LINE_HEIGHT_PIXEL_THRESHOLD) {
    return round2(Math.max(lineHeight, 1));
  }
  return Math.round(lineHeight);
}

/** Returns the VS Code settings for the given typography options (empty when disabled). */
export function getTypographySettings(options: TypographyOptions): Record<string, unknown> {
  if (!options.enabled) {
    return {};
  }
  const fontSize = clamp(options.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
  const settings: Record<string, unknown> = {
    'editor.fontFamily': options.fontFamily,
    'editor.fontSize': fontSize,
    'editor.lineHeight': toEditorLineHeight(options.lineHeight),
    'editor.fontLigatures': options.ligatures,
  };
  if (options.applyToTerminal) {
    settings['terminal.integrated.fontFamily'] = options.fontFamily;
    settings['terminal.integrated.fontSize'] = fontSize;
    settings['terminal.integrated.lineHeight'] = toTerminalLineHeight(options.lineHeight, fontSize);
  }
  return settings;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown, fallback: number, valid: (n: number) => boolean): number {
  return typeof value === 'number' && Number.isFinite(value) && valid(value) ? value : fallback;
}

function readFontFamily(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/**
 * Reads typography options through a getter (e.g. `key => config.get(key)` on the
 * `zedLayout.typography` section). Missing or invalid values fall back to
 * {@link DEFAULT_TYPOGRAPHY}.
 */
export function readTypographyOptions(get: (key: string) => unknown): TypographyOptions {
  const d = DEFAULT_TYPOGRAPHY;
  const k = TYPOGRAPHY_SETTING_KEYS;
  return {
    enabled: readBoolean(get(k.enabled), d.enabled),
    fontFamily: readFontFamily(get(k.fontFamily), d.fontFamily),
    fontSize: readNumber(
      get(k.fontSize),
      d.fontSize,
      (n) => n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE,
    ),
    lineHeight: readNumber(get(k.lineHeight), d.lineHeight, (n) => n >= 0),
    ligatures: readBoolean(get(k.ligatures), d.ligatures),
    applyToTerminal: readBoolean(get(k.applyToTerminal), d.applyToTerminal),
  };
}
