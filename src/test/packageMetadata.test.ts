import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Marketplace/Open VSX metadata checks for package.json (issue #14). No `vscode` import:
// runs both under the VS Code test host and plain mocha.

const ROOT = path.resolve(__dirname, '../..');

interface PackageJson {
  name?: string;
  displayName?: string;
  description?: string;
  version?: string;
  publisher?: string;
  license?: string;
  icon?: string;
  galleryBanner?: { color?: string; theme?: string };
  categories?: string[];
  keywords?: string[];
  repository?: { type?: string; url?: string } | string;
  preview?: boolean;
  pricing?: string;
  scripts?: Record<string, string>;
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as PackageJson;

/** Categories accepted by the VS Code Marketplace (package.json schema of VS Code >= 1.95). */
const MARKETPLACE_CATEGORIES = new Set([
  'AI',
  'Azure',
  'Chat',
  'Data Science',
  'Debuggers',
  'Education',
  'Extension Packs',
  'Formatters',
  'Keymaps',
  'Language Packs',
  'Linters',
  'Machine Learning',
  'Notebooks',
  'Other',
  'Programming Languages',
  'SCM Providers',
  'Snippets',
  'Testing',
  'Themes',
  'Visualization',
]);

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width/height from the IHDR chunk of a PNG file. */
function pngSize(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return undefined;
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    return undefined;
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

suite('Package metadata (Marketplace / Open VSX)', () => {
  test('icon is a PNG of at least 128x128 inside the package', () => {
    assert.ok(pkg.icon, 'package.json must declare "icon"');
    assert.ok(!pkg.icon.toLowerCase().endsWith('.svg'), 'Marketplace does not accept SVG icons');
    const iconPath = path.join(ROOT, pkg.icon);
    assert.ok(fs.existsSync(iconPath), `${pkg.icon} must exist`);
    const size = pngSize(fs.readFileSync(iconPath));
    assert.ok(size, `${pkg.icon} must be a valid PNG`);
    assert.ok(size.width >= 128 && size.height >= 128, `icon is ${size.width}x${size.height}`);
    assert.strictEqual(size.width, size.height, 'icon must be square');
  });

  test('icon is not excluded by .vscodeignore', () => {
    const ignore = fs
      .readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim());
    const dir = pkg.icon?.split('/')[0];
    assert.ok(!ignore.includes(`${dir}/**`), `${dir}/** must not be in .vscodeignore`);
    assert.ok(!ignore.includes(pkg.icon ?? ''), `${pkg.icon} must not be in .vscodeignore`);
  });

  test('categories are valid Marketplace categories', () => {
    assert.ok(Array.isArray(pkg.categories) && pkg.categories.length > 0);
    for (const c of pkg.categories) {
      assert.ok(MARKETPLACE_CATEGORIES.has(c), `invalid category "${c}"`);
    }
    assert.strictEqual(new Set(pkg.categories).size, pkg.categories.length, 'duplicate category');
    assert.ok(pkg.categories.includes('Themes'), 'extension contributes color themes');
  });

  test('keywords: at most 30, unique, non-empty', () => {
    assert.ok(Array.isArray(pkg.keywords));
    assert.ok(pkg.keywords.length <= 30, `${pkg.keywords.length} keywords (max 30)`);
    assert.strictEqual(new Set(pkg.keywords).size, pkg.keywords.length, 'duplicate keyword');
    for (const k of pkg.keywords) {
      assert.ok(k.trim().length > 0, 'empty keyword');
    }
  });

  test('galleryBanner has a hex color and a valid theme', () => {
    assert.ok(pkg.galleryBanner, 'package.json must declare "galleryBanner"');
    assert.match(pkg.galleryBanner.color ?? '', /^#[0-9a-fA-F]{6}$/);
    assert.ok(['dark', 'light'].includes(pkg.galleryBanner.theme ?? ''));
  });

  test('publisher, license, repository and description are present', () => {
    assert.strictEqual(pkg.publisher, 'tarze07');
    assert.ok(pkg.license, 'license');
    const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    assert.match(repoUrl ?? '', /^https:\/\/github\.com\/[^/]+\/[^/]+(\.git)?$/);
    assert.ok(pkg.displayName && pkg.displayName.length > 0, 'displayName');
    assert.ok(pkg.description && pkg.description.length > 0, 'description');
  });

  test('version is semver', () => {
    assert.match(pkg.version ?? '', SEMVER);
  });

  test('0.x releases are marked as preview', () => {
    if (pkg.version?.startsWith('0.')) {
      assert.strictEqual(pkg.preview, true);
    }
  });

  test('release scripts are defined', () => {
    for (const s of ['package', 'release:check', 'publish:vsce', 'publish:ovsx']) {
      assert.ok(pkg.scripts?.[s], `missing npm script "${s}"`);
    }
  });
});
