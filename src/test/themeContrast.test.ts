import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { contrastRatio, parseHexColor } from '../theme/contrast';
import { ColorThemeJson, collectContrastChecks } from '../theme/themeChecks';

// Compiled tests live in out/test/, so the repo root is two levels up.
const THEMES_DIR = path.resolve(__dirname, '../../themes');

const THEME_FILES = [
  { file: 'zed-like-dark-color-theme.json', name: 'Zed-like Dark', type: 'dark' },
  { file: 'zed-like-light-color-theme.json', name: 'Zed-like Light', type: 'light' },
] as const;

const ANSI_KEYS = [
  'Black',
  'Red',
  'Green',
  'Yellow',
  'Blue',
  'Magenta',
  'Cyan',
  'White',
  'BrightBlack',
  'BrightRed',
  'BrightGreen',
  'BrightYellow',
  'BrightBlue',
  'BrightMagenta',
  'BrightCyan',
  'BrightWhite',
].map((k) => `terminal.ansi${k}`);

function loadTheme(file: string): ColorThemeJson {
  return JSON.parse(fs.readFileSync(path.join(THEMES_DIR, file), 'utf8')) as ColorThemeJson;
}

suite('Contrast module', () => {
  test('parses #rgb, #rrggbb and #rrggbbaa', () => {
    assert.deepStrictEqual(parseHexColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
    assert.deepStrictEqual(parseHexColor('#102030'), { r: 16, g: 32, b: 48, a: 1 });
    const withAlpha = parseHexColor('#00000080');
    assert.strictEqual(withAlpha.r, 0);
    assert.ok(Math.abs(withAlpha.a - 128 / 255) < 1e-9);
    assert.throws(() => parseHexColor('red'));
    assert.throws(() => parseHexColor('#12345'));
  });

  test('computes WCAG ratios', () => {
    assert.strictEqual(contrastRatio('#000000', '#ffffff'), 21);
    assert.strictEqual(contrastRatio('#ffffff', '#ffffff'), 1);
    // Symmetric.
    assert.strictEqual(contrastRatio('#777', '#fff'), contrastRatio('#fff', '#777'));
    // Known value: #777777 on white is ~4.48.
    assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.48) < 0.01);
  });

  test('composites translucent colors', () => {
    // Fully transparent foreground equals the background.
    assert.strictEqual(contrastRatio('#00000000', '#ffffff'), 1);
    // 50% black over white is mid grey (~#808080).
    const ratio = contrastRatio('#00000080', '#ffffff');
    assert.ok(Math.abs(ratio - contrastRatio('#7f7f7f', '#ffffff')) < 0.05);
    // Translucent background needs a base.
    assert.throws(() => contrastRatio('#000', '#ffffff80'));
    assert.ok(contrastRatio('#000', '#ffffff80', '#000000') > 1);
  });
});

for (const { file, name, type } of THEME_FILES) {
  suite(`Theme ${name}`, () => {
    const theme = loadTheme(file);

    test('has the expected metadata', () => {
      const raw = theme as unknown as Record<string, unknown>;
      assert.strictEqual(raw['$schema'], 'vscode://schemas/color-theme');
      assert.strictEqual(theme.name, name);
      assert.strictEqual(theme.type, type);
      assert.strictEqual(raw['semanticHighlighting'], true);
      assert.ok(theme.tokenColors.length > 10);
      assert.ok(Object.keys(theme.semanticTokenColors ?? {}).length > 10);
    });

    test('uses only valid hex colors', () => {
      for (const [key, value] of Object.entries(theme.colors)) {
        assert.doesNotThrow(() => parseHexColor(value), `${key}: ${value}`);
      }
      for (const rule of theme.tokenColors) {
        if (rule.settings.foreground) {
          assert.doesNotThrow(() => parseHexColor(rule.settings.foreground as string));
        }
      }
    });

    test('defines all 16 ANSI terminal colors, all distinct', () => {
      const values = ANSI_KEYS.map((k) => {
        assert.ok(theme.colors[k], `missing ${k}`);
        return theme.colors[k].toLowerCase();
      });
      assert.strictEqual(new Set(values).size, 16);
    });

    test('distinguishes panels from the editor', () => {
      const editor = theme.colors['editor.background'];
      assert.notStrictEqual(theme.colors['sideBar.background'], editor);
      assert.notStrictEqual(theme.colors['panel.background'], editor);
    });

    test('meets WCAG AA contrast for text', () => {
      const failures = collectContrastChecks(theme)
        .filter((c) => c.ratio < c.minimum)
        .map((c) => `${c.label}: ${c.ratio.toFixed(2)} < ${c.minimum}`);
      assert.deepStrictEqual(failures, []);
    });

    test('ANSI colors are readable on the terminal background', () => {
      const bg = theme.colors['terminal.background'];
      // In the dark theme ANSI black is intentionally close to the background.
      const skipped = type === 'dark' ? ['terminal.ansiBlack'] : [];
      for (const key of ANSI_KEYS.filter((k) => !skipped.includes(k))) {
        const ratio = contrastRatio(theme.colors[key], bg);
        assert.ok(ratio >= 3, `${key}: ${ratio.toFixed(2)} < 3`);
      }
    });
  });
}
