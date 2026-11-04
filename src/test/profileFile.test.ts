import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { buildPreset, type SettingsMap } from '../layout/preset';
import {
  buildCodeProfile,
  buildDefaultCodeProfile,
  DEFAULT_PROFILE_NAME,
  defaultLayoutOptions,
  EXTENSION_ID,
  parseCodeProfile,
  serializeCodeProfile,
} from '../profile/profile';
import { DEFAULT_TYPOGRAPHY, getTypographySettings } from '../theme/typography';

const PROFILE_FILE = path.resolve(__dirname, '../../profiles/zed-like.code-profile');

suite('Profile: buildCodeProfile', () => {
  test('resources are JSON strings, settings double-encoded', () => {
    const profile = buildDefaultCodeProfile();
    assert.strictEqual(profile.name, DEFAULT_PROFILE_NAME);
    assert.strictEqual(typeof profile.settings, 'string');
    assert.strictEqual(typeof profile.extensions, 'string');
    const wrapper = JSON.parse(profile.settings) as { settings: unknown };
    assert.deepStrictEqual(Object.keys(wrapper), ['settings']);
    assert.strictEqual(typeof wrapper.settings, 'string');
    assert.ok((wrapper.settings as string).startsWith('{\n  "'), 'settings.json is pretty-printed');
    assert.deepStrictEqual(JSON.parse(profile.extensions), [
      { identifier: { id: EXTENSION_ID }, displayName: 'Zed-like Agent Workspace' },
    ]);
  });

  test('round-trips through parseCodeProfile', () => {
    const options = { ...defaultLayoutOptions(), theme: 'Zed-like Light' as const };
    const profile = buildCodeProfile({
      name: 'Mine',
      layoutOptions: options,
      extensions: [{ id: 'a.b' }, { id: EXTENSION_ID }],
    });
    const parsed = parseCodeProfile(serializeCodeProfile(profile));
    assert.strictEqual(parsed.name, 'Mine');
    assert.deepStrictEqual(parsed.extensions, ['a.b', EXTENSION_ID]);
    const expected: SettingsMap = { ...buildPreset(options), 'zedLayout.enabled': true };
    assert.deepStrictEqual(parsed.settings, expected);
    assert.strictEqual(parsed.settings['workbench.colorTheme'], 'Zed-like Light');
  });

  test('default settings = full preset (theme, typography, window.*) + zedLayout.enabled', () => {
    const { settings } = parseCodeProfile(serializeCodeProfile(buildDefaultCodeProfile()));
    const preset = buildPreset(defaultLayoutOptions());
    const expected: SettingsMap = { ...preset, 'zedLayout.enabled': true };
    assert.deepStrictEqual(settings, expected);
    assert.strictEqual(settings['workbench.colorTheme'], 'Zed-like Dark');
    assert.strictEqual(settings['window.titleBarStyle'], 'custom');
    assert.strictEqual(settings['window.density.editorTabHeight'], 'compact');
    for (const [key, value] of Object.entries(getTypographySettings(DEFAULT_TYPOGRAPHY))) {
      assert.deepStrictEqual(settings[key], value, key);
    }
  });

  test('parseCodeProfile rejects malformed input', () => {
    assert.throws(() => parseCodeProfile('{}'));
    assert.throws(() => parseCodeProfile('{"name":"x","settings":"{\\"settings\\":1}"}'));
    assert.throws(() => parseCodeProfile('{"name":"x","extensions":"[{}]"}'));
  });
});

suite('Profile: committed profiles/zed-like.code-profile', () => {
  test('matches buildDefaultCodeProfile() (regenerate: node scripts/generate-profile.mjs)', () => {
    const text = fs.readFileSync(PROFILE_FILE, 'utf8');
    assert.strictEqual(text, serializeCodeProfile(buildDefaultCodeProfile()));
    assert.deepStrictEqual(JSON.parse(text), buildDefaultCodeProfile());
  });
});
