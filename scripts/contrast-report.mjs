// Prints a Markdown table with WCAG contrast ratios for both Zed-like themes.
// Usage: npm run compile-tests && node scripts/contrast-report.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { collectContrastChecks } = require(resolve(root, 'out/theme/themeChecks.js'));

const themes = ['zed-like-dark', 'zed-like-light'].map((id) =>
  JSON.parse(readFileSync(resolve(root, `themes/${id}-color-theme.json`), 'utf8')),
);
const [dark, light] = themes.map(collectContrastChecks);

let failed = false;
console.log('| Para | Min | Dark | Light |');
console.log('| --- | ---: | ---: | ---: |');
dark.forEach((d, i) => {
  const l = light[i];
  const cell = (c) => {
    const ok = c.ratio >= c.minimum;
    failed ||= !ok;
    return `${c.ratio.toFixed(2)}${ok ? '' : ' ✗'}`;
  };
  console.log(`| \`${d.label}\` | ${d.minimum} | ${cell(d)} | ${cell(l)} |`);
});
process.exitCode = failed ? 1 : 0;
