import * as assert from 'assert';

import { readLayoutOptions, readScopeSetting } from '../layout/options';
import {
  buildPreset,
  isUserOnlySetting,
  presetForTarget,
  type LayoutOptions,
} from '../layout/preset';
import { DEFAULT_TYPOGRAPHY, getTypographySettings } from '../theme/typography';

const BASE: LayoutOptions = {
  activityBarLocation: 'top',
  hideBreadcrumbs: false,
  applyTheme: true,
  theme: 'Zed-like Dark',
  typography: { ...DEFAULT_TYPOGRAPHY, enabled: false },
};

suite('Layout preset: buildPreset', () => {
  test('contains the core layout settings', () => {
    const preset = buildPreset(BASE);
    assert.strictEqual(preset['workbench.activityBar.location'], 'top');
    assert.strictEqual(preset['workbench.sideBar.location'], 'left');
    assert.strictEqual(preset['workbench.panel.defaultLocation'], 'bottom');
    assert.strictEqual(preset['workbench.layoutControl.enabled'], false);
    assert.strictEqual(preset['workbench.editor.tabSizing'], 'shrink');
    assert.strictEqual(preset['window.density.editorTabHeight'], 'compact');
    assert.strictEqual(preset['editor.minimap.enabled'], false);
    assert.strictEqual(preset['editor.renderLineHighlight'], 'gutter');
    assert.strictEqual(preset['editor.scrollbar.verticalScrollbarSize'], 8);
    assert.strictEqual(preset['editor.scrollbar.horizontalScrollbarSize'], 8);
    assert.strictEqual(preset['window.titleBarStyle'], 'custom');
  });

  test('activity bar location follows the option', () => {
    const preset = buildPreset({ ...BASE, activityBarLocation: 'hidden' });
    assert.strictEqual(preset['workbench.activityBar.location'], 'hidden');
  });

  test('breadcrumbs are only touched when hideBreadcrumbs is on', () => {
    assert.ok(!('breadcrumbs.enabled' in buildPreset(BASE)));
    assert.strictEqual(
      buildPreset({ ...BASE, hideBreadcrumbs: true })['breadcrumbs.enabled'],
      false,
    );
  });

  test('color theme is set only when applyTheme is on', () => {
    assert.strictEqual(buildPreset(BASE)['workbench.colorTheme'], 'Zed-like Dark');
    assert.strictEqual(
      buildPreset({ ...BASE, theme: 'Zed-like Light' })['workbench.colorTheme'],
      'Zed-like Light',
    );
    assert.ok(!('workbench.colorTheme' in buildPreset({ ...BASE, applyTheme: false })));
  });

  test('typography settings are merged only when enabled', () => {
    const typography = { ...DEFAULT_TYPOGRAPHY, enabled: true };
    const expected = getTypographySettings(typography);
    const withTypography = buildPreset({ ...BASE, typography });
    for (const [key, value] of Object.entries(expected)) {
      assert.deepStrictEqual(withTypography[key], value, key);
    }

    const without = buildPreset(BASE);
    const layoutOnlyKeys = new Set(Object.keys(without));
    for (const key of Object.keys(expected)) {
      if (!layoutOnlyKeys.has(key)) {
        assert.ok(!(key in without), `${key} must not be set when typography is disabled`);
      }
    }
  });
});

suite('Layout preset: presetForTarget', () => {
  test('user target keeps every setting', () => {
    const preset = buildPreset(BASE);
    const { settings, skipped } = presetForTarget(preset, 'user');
    assert.deepStrictEqual(settings, preset);
    assert.deepStrictEqual(skipped, []);
  });

  test('workspace target skips window.* settings and reports them', () => {
    const preset = buildPreset(BASE);
    const { settings, skipped } = presetForTarget(preset, 'workspace');
    assert.deepStrictEqual(skipped.sort(), [
      'window.density.editorTabHeight',
      'window.titleBarStyle',
    ]);
    for (const key of Object.keys(settings)) {
      assert.ok(!isUserOnlySetting(key), key);
    }
    assert.strictEqual(Object.keys(settings).length + skipped.length, Object.keys(preset).length);
    assert.strictEqual(settings['workbench.colorTheme'], 'Zed-like Dark');
  });
});

suite('Layout preset: options', () => {
  test('defaults when nothing is configured', () => {
    const options = readLayoutOptions(() => undefined);
    assert.deepStrictEqual(options, {
      activityBarLocation: 'top',
      hideBreadcrumbs: false,
      applyTheme: true,
      theme: 'Zed-like Dark',
      typography: DEFAULT_TYPOGRAPHY,
    });
    assert.strictEqual(
      readScopeSetting(() => undefined),
      'ask',
    );
  });

  test('reads configured values and ignores invalid ones', () => {
    const values: Record<string, unknown> = {
      'zedLayout.layout.activityBarLocation': 'hidden',
      'zedLayout.layout.hideBreadcrumbs': true,
      'zedLayout.layout.applyTheme': false,
      'zedLayout.layout.theme': 'Nope',
      'zedLayout.layout.scope': 'workspace',
      'zedLayout.typography.enabled': false,
      'zedLayout.typography.fontSize': 16,
      'zedLayout.typography.lineHeight': 'big',
    };
    const get = (key: string) => values[key];
    const options = readLayoutOptions(get);
    assert.strictEqual(options.activityBarLocation, 'hidden');
    assert.strictEqual(options.hideBreadcrumbs, true);
    assert.strictEqual(options.applyTheme, false);
    assert.strictEqual(options.theme, 'Zed-like Dark');
    assert.strictEqual(options.typography.enabled, false);
    assert.strictEqual(options.typography.fontSize, 16);
    assert.strictEqual(options.typography.lineHeight, DEFAULT_TYPOGRAPHY.lineHeight);
    assert.strictEqual(readScopeSetting(get), 'workspace');
  });
});
