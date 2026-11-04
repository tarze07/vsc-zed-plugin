import * as assert from 'assert';
import {
  DEFAULT_TYPOGRAPHY,
  getTypographySettings,
  readTypographyOptions,
  toEditorLineHeight,
  toTerminalLineHeight,
  TypographyOptions,
} from '../theme/typography';

function options(overrides: Partial<TypographyOptions> = {}): TypographyOptions {
  return { ...DEFAULT_TYPOGRAPHY, ...overrides };
}

suite('Typography: getTypographySettings', () => {
  test('returns editor and terminal settings for the defaults', () => {
    assert.deepStrictEqual(getTypographySettings(DEFAULT_TYPOGRAPHY), {
      'editor.fontFamily': DEFAULT_TYPOGRAPHY.fontFamily,
      'editor.fontSize': 14,
      'editor.lineHeight': 1.6,
      'editor.fontLigatures': false,
      'terminal.integrated.fontFamily': DEFAULT_TYPOGRAPHY.fontFamily,
      'terminal.integrated.fontSize': 14,
      'terminal.integrated.lineHeight': 1,
    });
  });

  test('returns an empty object when disabled', () => {
    assert.deepStrictEqual(getTypographySettings(options({ enabled: false })), {});
  });

  test('omits terminal settings when applyToTerminal is false', () => {
    const settings = getTypographySettings(options({ applyToTerminal: false }));
    assert.deepStrictEqual(Object.keys(settings).sort(), [
      'editor.fontFamily',
      'editor.fontLigatures',
      'editor.fontSize',
      'editor.lineHeight',
    ]);
  });

  test('passes ligatures through', () => {
    assert.strictEqual(
      getTypographySettings(options({ ligatures: true }))['editor.fontLigatures'],
      true,
    );
  });

  test('keeps the terminal line height at 1 regardless of the editor line height', () => {
    const settings = getTypographySettings(options({ fontSize: 16, lineHeight: 24 }));
    assert.strictEqual(settings['editor.lineHeight'], 24);
    assert.strictEqual(settings['terminal.integrated.lineHeight'], 1);
    assert.strictEqual(
      getTypographySettings(options({ lineHeight: 1.6 }))['terminal.integrated.lineHeight'],
      1,
    );
  });

  test('clamps font size to the allowed range', () => {
    assert.strictEqual(getTypographySettings(options({ fontSize: 2 }))['editor.fontSize'], 6);
    assert.strictEqual(getTypographySettings(options({ fontSize: 200 }))['editor.fontSize'], 72);
  });
});

suite('Typography: line height helpers', () => {
  test('editor line height keeps multipliers and rounds pixels', () => {
    assert.strictEqual(toEditorLineHeight(1.6), 1.6);
    assert.strictEqual(toEditorLineHeight(0.5), 1);
    assert.strictEqual(toEditorLineHeight(22.4), 22);
    assert.strictEqual(toEditorLineHeight(0), 0);
    assert.strictEqual(toEditorLineHeight(Number.NaN), 0);
  });

  test('terminal line height is a multiplier in [1, 3]', () => {
    assert.strictEqual(toTerminalLineHeight(1.6, 14), 1.6);
    assert.strictEqual(toTerminalLineHeight(0.8, 14), 1);
    assert.strictEqual(toTerminalLineHeight(0, 14), 1);
    assert.strictEqual(toTerminalLineHeight(21, 14), 1.5);
    assert.strictEqual(toTerminalLineHeight(7.5, 14), 3);
    assert.strictEqual(toTerminalLineHeight(100, 14), 3);
  });
});

suite('Typography: readTypographyOptions', () => {
  test('falls back to defaults when nothing is set', () => {
    assert.deepStrictEqual(
      readTypographyOptions(() => undefined),
      DEFAULT_TYPOGRAPHY,
    );
  });

  test('reads valid values', () => {
    const values: Record<string, unknown> = {
      enabled: false,
      fontFamily: '  Lilex  ',
      fontSize: 15,
      lineHeight: 22,
      ligatures: true,
      applyToTerminal: false,
    };
    assert.deepStrictEqual(
      readTypographyOptions((key) => values[key]),
      {
        enabled: false,
        fontFamily: 'Lilex',
        fontSize: 15,
        lineHeight: 22,
        ligatures: true,
        applyToTerminal: false,
      },
    );
  });

  test('ignores invalid values', () => {
    const values: Record<string, unknown> = {
      enabled: 'yes',
      fontFamily: '   ',
      fontSize: 500,
      lineHeight: -1,
      ligatures: 1,
      applyToTerminal: null,
    };
    assert.deepStrictEqual(
      readTypographyOptions((key) => values[key]),
      DEFAULT_TYPOGRAPHY,
    );
  });

  test('rejects non-finite numbers', () => {
    const opts = readTypographyOptions((key) =>
      key === 'fontSize' ? Number.NaN : key === 'lineHeight' ? Infinity : undefined,
    );
    assert.strictEqual(opts.fontSize, DEFAULT_TYPOGRAPHY.fontSize);
    assert.strictEqual(opts.lineHeight, DEFAULT_TYPOGRAPHY.lineHeight);
  });
});
