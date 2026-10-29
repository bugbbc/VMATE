import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await rm(`${root}dist`, { recursive: true, force: true });
await mkdir(`${root}dist`, { recursive: true });
// Explicit allowlist: never publish credentials, source, tests or local databases.
for (const file of ['index.html', 'astrum-detail.html', 'community.html', 'assets', 'desktop', '_headers', '_routes.json']) {
  await cp(`${root}${file}`, `${root}dist/${file}`, { recursive: true });
}
console.log('Built website into dist/');
