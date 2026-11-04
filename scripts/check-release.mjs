// Pre-release checks for the extension (used by .github/workflows/release.yml and locally).
//
// Usage:
//   node scripts/check-release.mjs [--tag vX.Y.Z]   # validate release readiness
//   node scripts/check-release.mjs --notes [--version X.Y.Z]
//                                                   # print the CHANGELOG section (release notes)
//
// The tag defaults to $GITHUB_REF_NAME when $GITHUB_REF_TYPE is "tag" (GitHub Actions).
// Checks: tag matches package.json version, version is semver, CHANGELOG.md has a
// "## [X.Y.Z]" section with content, icon declared in package.json exists and is a PNG >= 128px.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Returns the body of the "## [version]" section of CHANGELOG.md, or undefined. */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = new RegExp(`^## \\[?v?${escaped}\\]?(\\s|$)`);
  const start = lines.findIndex((l) => header.test(l));
  if (start < 0) {
    return undefined;
  }
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) {
    end = lines.length;
  }
  return lines
    .slice(start + 1, end)
    .filter((l) => !/^\[[^\]]+\]:\s/.test(l)) // drop link reference definitions
    .join('\n')
    .trim();
}

if (args.includes('--notes')) {
  const version = argValue('--version') ?? pkg.version;
  const notes = changelogSection(changelog, version);
  if (!notes) {
    console.error(`CHANGELOG.md has no "## [${version}]" section.`);
    process.exit(1);
  }
  process.stdout.write(notes + '\n');
  process.exit(0);
}

const errors = [];
const version = pkg.version;

if (!SEMVER.test(version)) {
  errors.push(`package.json version "${version}" is not valid semver.`);
}

const envTag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
const tag = argValue('--tag') || envTag || undefined;
if (tag !== undefined && tag !== `v${version}`) {
  errors.push(
    `Tag "${tag}" does not match package.json version "${version}" (expected v${version}).`,
  );
}

const notes = changelogSection(changelog, version);
if (notes === undefined) {
  errors.push(`CHANGELOG.md has no "## [${version}]" section.`);
} else if (notes.length === 0) {
  errors.push(`CHANGELOG.md section "## [${version}]" is empty.`);
}

if (!pkg.icon) {
  errors.push('package.json has no "icon".');
} else {
  const iconPath = path.join(root, pkg.icon);
  if (!fs.existsSync(iconPath)) {
    errors.push(`Icon ${pkg.icon} does not exist.`);
  } else {
    const buf = fs.readFileSync(iconPath);
    const isPng = buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47;
    if (!isPng) {
      errors.push(`Icon ${pkg.icon} is not a PNG.`);
    } else {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width < 128 || height < 128) {
        errors.push(
          `Icon ${pkg.icon} is ${width}x${height}; Marketplace requires at least 128x128.`,
        );
      }
    }
  }
}

for (const key of ['publisher', 'license', 'repository']) {
  if (!pkg[key]) {
    errors.push(`package.json has no "${key}".`);
  }
}

if (errors.length > 0) {
  console.error('Release check failed:');
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}
console.log(
  `Release check OK: ${pkg.publisher}.${pkg.name} v${version}${tag ? ` (tag ${tag})` : ''}.`,
);
