// The Rust store's contract fixtures (apps/desktop/src-tauri/store/tests/fixtures) come from this
// codec and the Node reference store. This test fails when they drift; run it with
// HAFB_WRITE_FIXTURES=1 to rewrite them after a schema or codec change.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { encodePlan } from '../src/codec.ts';
import { samplePlan } from './fixtures/samplePlan.ts';
import { applyRows, loadTables, openMemoryPlan } from './helpers/sqliteStore.ts';

const DIR = join(import.meta.dirname, '../../../apps/desktop/src-tauri/store/tests/fixtures');

it('the Rust fixtures match the codec and the reference store', () => {
  const changes = encodePlan(samplePlan());
  const db = openMemoryPlan();
  applyRows(db, changes);
  const loaded = loadTables(db);
  const files = { 'sample-changes.json': changes, 'sample-loaded.json': loaded };
  for (const [name, value] of Object.entries(files)) {
    const text = `${JSON.stringify(value, null, 1)}\n`;
    if (process.env.HAFB_WRITE_FIXTURES === '1') writeFileSync(join(DIR, name), text);
    expect(JSON.parse(readFileSync(join(DIR, name), 'utf8'))).toEqual(JSON.parse(text));
  }
});
