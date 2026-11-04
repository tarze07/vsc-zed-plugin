// Generates profiles/zed-like.code-profile from the layout preset (single source of truth:
// src/profile/profile.ts -> buildDefaultCodeProfile()).
// Usage: npm run compile-tests && node scripts/generate-profile.mjs
// Verified by src/test/profileFile.test.ts (the committed file must match the preset).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compiled = path.join(root, 'out/profile/profile.js');
if (!fs.existsSync(compiled)) {
  console.error(`Missing ${path.relative(root, compiled)} - run "npm run compile-tests" first.`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const { buildDefaultCodeProfile, serializeCodeProfile } = require(compiled);

const target = path.join(root, 'profiles/zed-like.code-profile');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, serializeCodeProfile(buildDefaultCodeProfile()));
console.log(`Wrote ${path.relative(root, target)}`);
