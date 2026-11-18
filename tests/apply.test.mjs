// Import / re-upload / Undo logic against an in-memory stand-in for Supabase.   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// ── Tiny fake of the supabase-js query builder (only what apply.js uses) ────
const db = { leads: [], schedule_events: [], content_posts: [], files_metadata: [] };
let clock = Date.parse('2026-11-18T08:00:00Z');
const now = () => new Date(clock += 1000).toISOString();
const val = (row, col) => col.split('->').reduce((o, k) => (o == null ? o : o[k]), row);
const cmp = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? Date.parse(v) : v);
class Q {
  constructor(t) { this.t = t; this.op = 'select'; this.f = []; }
  select(_c, o) { if (this.op === 'select') this.head = o?.head; else this.ret = true; return this; }
  insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this; }
  upsert(rows, o) { this.op = 'upsert'; this.rows = [].concat(rows); this.o = o; return this; }
  update(v) { this.op = 'update'; this.v = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.f.push(r => val(r, c) === v); return this; }
  in(c, vs) { const s = new Set(vs); this.f.push(r => s.has(val(r, c))); return this; }
  gte(c, v) { this.f.push(r => cmp(val(r, c)) >= cmp(v)); return this; }
  lt(c, v) { this.f.push(r => cmp(val(r, c)) < cmp(v)); return this; }
  is(c) { this.f.push(r => val(r, c) == null); return this; }
  not(c) { this.f.push(r => val(r, c) != null); return this; }
  order() { return this; } limit() { return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  single() { this.one = true; return this; } maybeSingle() { this.one = true; return this; }
  then(ok, bad) { return Promise.resolve().then(() => this.run()).then(ok, bad); }
  run() {
    const T = db[this.t], hit = (r) => this.f.every(f => f(r));
    const clone = (x) => structuredClone(x);
    if (this.op === 'insert' || this.op === 'upsert') {
      const out = [];
      for (const r of this.rows) {
        if (this.op === 'upsert' && T.some(x => x.id === r.id)) continue;
        const t = now(); const row = { id: randomUUID(), created_at: t, updated_at: t, ...clone(r) }; T.push(row); out.push(row);
      }
      return { data: out.map(clone), error: null };
    }
    if (this.op === 'update') { const rows = T.filter(hit); rows.forEach(r => Object.assign(r, clone(this.v), { updated_at: now() })); return { data: this.one ? clone(rows[0]) : rows.map(clone), error: null }; }
    if (this.op === 'delete') { db[this.t] = T.filter(r => !hit(r)); return { data: null, error: null }; }
    let rows = T.filter(hit).map(clone);
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    return { data: this.one ? rows[0] ?? null : rows, error: null, count: rows.length };
  }
}
globalThis.window = { supabase: { createClient: () => ({ from: (t) => new Q(t), auth: {}, storage: {} }) } };

const { applyResult, undoApply } = await import('../web/assets/js/lib/apply.js');
const { analyze } = await import('../web/assets/js/lib/detect.js');

const fileRow = (name) => { const r = { id: randomUUID(), file_name: name, file_type: 'xlsx', metrics: {}, summary: null }; db.files_metadata.push(r); return r; };
const sched = (rows) => analyze({ tables: [{ name: 'S', rows: [['Date', 'Time', 'Activity', 'Location', 'Client'], ...rows] }], ownerName: 'CJ Masujer', today: '2026-11-18' });
const events = () => db.schedule_events.map(e => `${e.starts_at.slice(5, 16)} ${e.title}${e.location ? ' @ ' + e.location : ''}`).sort();

test('schedule: first upload, updated re-upload replaces, manual + edited entries kept, Undo restores', async () => {
  db.leads.push({ id: 'lead-maria', full_name: 'Maria Santos', created_at: now(), updated_at: now() });
  db.schedule_events.push({ id: 'manual', title: 'Team lunch', kind: 'Other', starts_at: '2026-12-02T12:00:00+08:00', created_at: now(), updated_at: now() });

  // v1: November's planner publishes December
  const f1 = fileRow('Dec schedule v1.xlsx');
  const r1 = await applyResult(f1, sched([
    ['Dec 1, 2026', '10AM-7PM', 'Manning', 'Galleria', ''],
    ['Dec 2, 2026', '10AM-7PM', 'Manning', 'Magnolia', ''],
    ['Dec 3, 2026', '2PM', 'Tripping', 'Sierra Valley', 'Maria Santos'],
    ['Dec 5, 2026', '9AM', 'Training', 'Ortigas', ''],
  ]));
  assert.equal(r1.applied.inserted.length, 4);
  assert.equal(db.schedule_events.find(e => e.kind === 'Tripping').lead_id, 'lead-maria');
  assert.equal(db.schedule_events.find(e => e.kind === 'Tripping').ends_at, null);
  assert.equal(db.schedule_events.find(e => e.location === 'Galleria').ends_at, '2026-12-01T19:00:00+08:00');

  // the user edits one imported entry by hand (marks Dec 2 as Done)
  const dec2 = db.schedule_events.find(e => e.location === 'Magnolia');
  Object.assign(dec2, { status: 'Done', updated_at: now() });

  // v2: updated schedule for the same dates
  const f2 = fileRow('Dec schedule v2.xlsx');
  f1.metrics = r1.row.metrics; Object.assign(db.files_metadata.find(x => x.id === f1.id), r1.row);
  const r2 = await applyResult(f2, sched([
    ['Dec 1, 2026', '10AM-7PM', 'Manning', 'Magnolia', ''],      // changed location
    ['Dec 2, 2026', '10AM-7PM', 'Manning', 'Magnolia', ''],      // same as the edited one → not duplicated
    ['Dec 4, 2026', '10AM-7PM', 'Manning', 'Galleria', ''],      // new day
    ['Dec 5, 2026', '9AM', 'Training', 'Ortigas', ''],           // same
  ]));
  assert.equal(r2.applied.replaced.length, 3, 'unedited v1 entries in range replaced');
  assert.equal(r2.applied.skipped, 1, 'edited Dec 2 entry not duplicated');
  assert.deepEqual(events(), [
    '12-01T10:00 Manning — Magnolia @ Magnolia', '12-02T10:00 Manning — Magnolia @ Magnolia', '12-02T12:00 Team lunch',
    '12-04T10:00 Manning — Galleria @ Galleria', '12-05T09:00 Training @ Ortigas',
  ]);
  assert.equal(db.schedule_events.find(e => e.id === dec2.id).status, 'Done', 'hand-edited entry kept');

  // Undo v2 → back to v1 (+ the edit)
  Object.assign(db.files_metadata.find(x => x.id === f2.id), r2.row);
  const u = await undoApply(r2.row);
  assert.equal(u.removed, 3); assert.equal(u.restored, 3);
  assert.deepEqual(events(), [
    '12-01T10:00 Manning — Galleria @ Galleria', '12-02T10:00 Manning — Magnolia @ Magnolia', '12-02T12:00 Team lunch',
    '12-03T14:00 Tripping — Maria Santos @ Sierra Valley', '12-05T09:00 Training @ Ortigas',
  ]);
  assert.equal(u.row.metrics.applied, null);
  assert.match(u.row.summary, /import undone$/);
});

test('re-reading the same file does not duplicate', async () => {
  const before = db.schedule_events.length;
  const f = db.files_metadata.find(x => x.file_name === 'Dec schedule v1.xlsx');
  const again = await applyResult(f, sched([['Dec 1, 2026', '10AM-7PM', 'Manning', 'Galleria', ''], ['Dec 3, 2026', '2PM', 'Tripping', 'Sierra Valley', 'Maria Santos'], ['Dec 5, 2026', '9AM', 'Training', 'Ortigas', '']]));
  assert.equal(db.schedule_events.length, before);
  assert.equal(again.applied.replaced.length, 3);
});

test('leads: only new people are added; Undo keeps leads edited since', async () => {
  db.leads.push({ id: 'old', full_name: 'Juan Dela Cruz', email: 'juan@x.com', phone: '+639171234567', created_at: now(), updated_at: now() });
  const f = fileRow('leads.xlsx');
  const res = analyze({ tables: [{ name: 'L', rows: [['Name', 'Phone', 'Email'], ['Juan Dela Cruz', '09171234567', ''], ['Ana Reyes', '9181234567', 'ana@x.com'], ['Ben Cruz', '', 'ben@x.com']] }], ownerName: 'CJ', today: '2026-11-18' });
  const r = await applyResult(f, res);
  assert.equal(r.applied.inserted.length, 2); assert.equal(r.applied.skipped, 1);
  assert.equal(db.leads.find(l => l.full_name === 'Ana Reyes').phone, '+639181234567');
  Object.assign(db.leads.find(l => l.full_name === 'Ben Cruz'), { status: 'Contacted', updated_at: now() });
  const u = await undoApply(r.row);
  assert.equal(u.removed, 1); assert.equal(u.kept, 1);
  assert.ok(db.leads.some(l => l.full_name === 'Ben Cruz') && !db.leads.some(l => l.full_name === 'Ana Reyes'));
});

test('a file with nothing to apply only gets an overview', async () => {
  const f = fileRow('price list.pdf');
  const r = await applyResult(f, analyze({ text: 'Studio ₱3,250,000', ownerName: 'CJ', today: '2026-11-18' }));
  assert.equal(r.applied, null);
  assert.equal(r.row.metrics.overview.amounts.count, 1);
});
