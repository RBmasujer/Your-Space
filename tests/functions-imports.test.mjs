// Edge Functions must deploy with `supabase functions deploy --use-api`.
// Supabase's build server refuses code imported from arbitrary web hosts (e.g. cdn.sheetjs.com),
// so functions may import only local files, npm: and jsr: packages.   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'supabase/functions';
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return n === 'vendor' ? [] : files(p);
  return /\.(ts|js|mjs)$/.test(n) ? [p] : [];
});

test('Edge Functions import only local files, npm: or jsr: packages', () => {
  const bad = files(ROOT).flatMap((f) =>
    [...readFileSync(f, 'utf8').matchAll(/(?:import|export)[^'"`]*?from\s*['"]([^'"]+)['"]/g)]
      .map((m) => m[1])
      .filter((spec) => !/^(\.{1,2}\/|npm:|jsr:)/.test(spec))
      .map((spec) => `${f}: ${spec}`));
  assert.deepEqual(bad, []);
});
