// File recognition tests: dates, times, schedule layouts, leads, posts.   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, parseDate, parseTimes, eventKind, findMonthYear } from '../web/assets/js/lib/detect.js';

const ctx = { today: '2026-11-18' };
const base = { ownerName: 'CJ Masujer', today: '2026-11-18' };
const pick = (r) => r.records.map(e => [e.date, e.start, e.end, e.kind, e.title]);

test('parseDate understands common formats', () => {
  const D = (v, c = ctx) => parseDate(v, c)?.date ?? null;
  assert.equal(D('2026-12-01'), '2026-12-01');
  assert.equal(D('12/1/2026'), '2026-12-01');
  assert.equal(D('25/12/2026'), '2026-12-25');          // day first when the first number > 12
  assert.equal(D('Dec 3, 2026'), '2026-12-03');
  assert.equal(D('Thursday, December 3'), '2026-12-03');
  assert.equal(D('3 Dec 2026'), '2026-12-03');
  assert.equal(D('1-Dec'), '2026-12-01');
  assert.equal(D('Jan 5'), '2027-01-05');                // seen in November → next January
  assert.equal(D(46357), '2026-12-01');                  // Excel serial
  assert.equal(D('Dec 2026'), null);                     // month + year is not a day
  assert.equal(D('2/30/2026'), null);
  assert.equal(D('Robinsons'), null);
  assert.deepEqual(parseDate('Dec 3 – Tripping with Maria, 2PM', ctx), { date: '2026-12-03', rest: 'Tripping with Maria, 2PM' });
});

test('parseTimes understands ranges, meridiems and Excel times', () => {
  const T = (v) => { const t = parseTimes(v); return [t.start, t.end]; };
  assert.deepEqual(T('10:00 AM - 7:00 PM'), ['10:00', '19:00']);
  assert.deepEqual(T('10AM-7PM'), ['10:00', '19:00']);
  assert.deepEqual(T('10-7PM'), ['10:00', '19:00']);
  assert.deepEqual(T('1-5pm'), ['13:00', '17:00']);
  assert.deepEqual(T('10:00-7:00'), ['10:00', '19:00']);
  assert.deepEqual(T('9:00 to 18:00'), ['09:00', '18:00']);
  assert.deepEqual(T('2:00 PM'), ['14:00', null]);
  assert.deepEqual(T('12 noon'.replace('noon', 'PM')), ['12:00', null]);
  assert.deepEqual(T(0.375), ['09:00', null]);
  assert.deepEqual(T('Galleria'), [null, null]);
  assert.equal(parseTimes('Galleria 10AM-7PM').rest, 'Galleria');
});

test('event kinds and month context', () => {
  assert.equal(eventKind('Site visit with client'), 'Tripping');
  assert.equal(eventKind('Sales Training'), 'Training');
  assert.equal(eventKind('Team huddle'), 'Sync');
  assert.equal(eventKind('Booth duty Galleria'), 'Manning');
  assert.equal(eventKind('Birthday', 'Other'), 'Other');
  assert.deepEqual(findMonthYear('CJ Masujer — DECEMBER 2026 Manning'), { month: 12, year: 2026 });
  assert.deepEqual(findMonthYear('schedule_2027-01.xlsx'), { month: 1, year: 2027 });
});

test('schedule list (rows read from the Edge-printed PDF)', () => {
  const rows = [
    ['CJ Masujer — December 2026 Manning'], ['Schedule'], ['Prepared by RLC Residences · Sales Team Peñaflor'],
    ['Date', 'Time', 'Activity', 'Location', 'Client'],
    ['Dec 1, 2026', '10:00 AM - 7:00 PM', 'Manning', 'Robinsons Galleria Booth', ''],
    ['Dec 2, 2026', '10:00 AM - 7:00 PM', 'Manning', 'Robinsons Magnolia', ''],
    ['Dec 3, 2026', '2:00 PM', 'Tripping', 'Sierra Valley Gardens', 'Maria Santos'],
    ['Dec 4, 2026', 'OFF', 'Rest day', '', ''],
    ['Dec 5, 2026', '9:00 AM', 'Sales Training', 'RLC Office Ortigas', ''],
  ];
  const r = analyze({ ...base, tables: [{ name: 'PDF', rows }], fileName: 'dec.pdf' });
  assert.equal(r.kind, 'schedule');
  assert.deepEqual(pick(r), [
    ['2026-12-01', '10:00', '19:00', 'Manning', 'Manning — Robinsons Galleria Booth'],
    ['2026-12-02', '10:00', '19:00', 'Manning', 'Manning — Robinsons Magnolia'],
    ['2026-12-03', '14:00', null, 'Tripping', 'Tripping — Maria Santos'],
    ['2026-12-05', '09:00', null, 'Training', 'Sales Training'],
  ]);
  assert.equal(r.records[2].client, 'Maria Santos');
  assert.equal(r.records[0].location, 'Robinsons Galleria Booth');
  assert.equal(r.overview.skipped, 1);
  assert.match(r.summary, /^Schedule: 4 entries, Dec 1, 2026 – Dec 5, 2026/);
});

test('schedule list from Excel serial dates and times, other people filtered out', () => {
  const rows = [['Name', 'Date', 'Start', 'End', 'Assignment'],
    ['CJ Masujer', 46357, 0.4166667, 0.7916667, 'Galleria Booth'],
    ['Ana Cruz', 46357, 0.375, 0.75, 'Magnolia'],
    ['CJ Masujer', 46358, 0.4166667, 0.7916667, 'Day off']];
  const r = analyze({ ...base, tables: [{ name: 'Sheet1', rows }] });
  assert.deepEqual(pick(r), [['2026-12-01', '10:00', '19:00', 'Manning', 'Galleria Booth']]);
});

test('roster grid: people × day numbers, month from the title', () => {
  const rows = [
    ['DECEMBER 2026 MANNING SCHEDULE'],
    ['Name', 1, 2, 3, 4, 5, 6, 7],
    ['Ana Cruz', 'Galleria', 'Galleria', 'OFF', 'Magnolia', '', '', ''],
    ['CJ Masujer', 'Magnolia 10-7PM', 'OFF', 'Galleria', 'Tripping 2PM', '', 'RD', 'Galleria'],
  ];
  const r = analyze({ ...base, tables: [{ name: 'Roster', rows }] });
  assert.equal(r.overview.layout, 'roster');
  assert.deepEqual(pick(r), [
    ['2026-12-01', '10:00', '19:00', 'Manning', 'Manning — Magnolia'],
    ['2026-12-03', null, null, 'Manning', 'Manning — Galleria'],
    ['2026-12-04', '14:00', null, 'Tripping', 'Tripping'],
    ['2026-12-07', null, null, 'Manning', 'Manning — Galleria'],
  ]);
  assert.equal(r.overview.skipped, 2);
});

test('monthly calendar grid with spill-over days', () => {
  const rows = [
    ['December 2026'],
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    [29, 30, 1, 2, 3, 4, 5],
    ['', '', 'Galleria 10AM-7PM', 'Magnolia', 'Tripping w/ Maria 2PM', 'OFF', 'Training 9AM'],
    [6, 7, 8, 9, 10, 11, 12],
    ['RD', 'Galleria', '', '', '', '', ''],
    [27, 28, 29, 30, 31, 1, 2],
    ['', '', '', '', 'Year-end sync 4PM', 'Galleria', 'Galleria'],
  ];
  const r = analyze({ ...base, tables: [{ name: 'Cal', rows }] });
  assert.equal(r.overview.layout, 'calendar');
  assert.deepEqual(r.records.map(e => [e.date, e.kind, e.start]), [
    ['2026-12-01', 'Manning', '10:00'], ['2026-12-02', 'Manning', null], ['2026-12-03', 'Tripping', '14:00'],
    ['2026-12-05', 'Training', '09:00'], ['2026-12-07', 'Manning', null], ['2026-12-31', 'Sync', '16:00'],
  ]);
  assert.equal(r.overview.skipped, 2);
  // same grid with the day number and text in one cell
  const one = [['December 2026'], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], ['', '1\nGalleria', '2\nOFF', '3 Training 9AM', '4']];
  assert.deepEqual(analyze({ ...base, tables: [{ name: 'c', rows: one }] }).records.map(e => [e.date, e.kind]), [['2026-12-01', 'Manning'], ['2026-12-03', 'Training']]);
});

test('plain text lines (Word/PDF without a table)', () => {
  const text = 'My schedule for December 2026\nDec 1 – Galleria booth 10AM-7PM\nDec 2 – OFF\nDec 3 – Tripping with Maria Santos at Sierra Valley Gardens, 2 PM\nThanks!';
  const r = analyze({ ...base, text });
  assert.equal(r.kind, 'schedule');
  assert.deepEqual(r.records.map(e => [e.date, e.kind, e.start, e.client, e.location]), [
    ['2026-12-01', 'Manning', '10:00', null, null], ['2026-12-03', 'Tripping', '14:00', 'Maria Santos', 'Sierra Valley Gardens'],
  ]);
});

test('leads list and content plan are recognised', () => {
  const leads = analyze({ ...base, tables: [{ name: 'Leads', rows: [['LEADS TRACKER'], [], ['Name', 'Phone', 'Email', 'Lead Status', 'Income Class'], ['Juan Dela Cruz', '09171234567', 'juan@x.com', 'Contacted', 'High'], ['Ana Reyes', '', '', 'Closed', '']] }] });
  assert.equal(leads.kind, 'leads');
  assert.deepEqual(leads.records.map(l => [l.full_name, l.status, l.income_class]), [['Juan Dela Cruz', 'Contacted', 'High'], ['Ana Reyes', 'New', null]]);
  const posts = analyze({ ...base, tables: [{ name: 'Plan', rows: [['Date', 'Platform', 'Topic', 'Caption'], ['Dec 5', 'FB, IG', 'Holiday promo', 'Own a home this Christmas!'], ['', 'TikTok', 'Unit tour', 'Watch the tour']] }] });
  assert.equal(posts.kind, 'posts');
  assert.deepEqual(posts.records.map(p => [p.title, p.platforms.join('+'), p.date, p.status]), [['Holiday promo', 'Facebook+Instagram', '2026-12-05', 'Scheduled'], ['Unit tour', 'TikTok', null, 'Draft']]);
});

test('anything else just gets an overview', () => {
  const r = analyze({ ...base, text: 'Price list as of Nov 18, 2026. Studio unit ₱3,250,000 and 1BR PHP 4,800,000.50. Contact cj@rlc.com or 0917 123 4567.' });
  assert.equal(r.kind, null);
  assert.equal(r.records.length, 0);
  assert.equal(r.overview.amounts.count, 2);
  assert.equal(r.overview.amounts.max, 4800000.5);
  assert.equal(r.overview.emails, 1);
  assert.equal(r.overview.phones, 1);
  assert.match(r.summary, /words · 2 peso amount\(s\), largest ₱4,800,000\.5/);
});
