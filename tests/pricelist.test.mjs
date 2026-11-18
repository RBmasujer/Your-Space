// Price list reading for the Quotation page.   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePriceList, money } from '../web/assets/js/lib/pricelist.js';

const pick = (r, ...keys) => r.units.map(u => keys.map(k => u[k]));

test('money() reads peso amounts in many styles', () => {
  assert.equal(money('₱ 4,800,000.00'), 4800000);
  assert.equal(money('PHP4,800,000'), 4800000);
  assert.equal(money('P 3,250,000'), 3250000);
  assert.equal(money('4.8M'), 4800000);
  assert.equal(money('(150,000)'), -150000);
  assert.equal(money(5600000), 5600000);
  for (const x of ['', '-', 'SOLD', 'n/a', null]) assert.equal(money(x), null);
});

test('typical list: title row, list price, discount, net TCP, monthly dues', () => {
  const r = parsePriceList([{ name: 'Sheet1', rows: [
    ['SIERRA VALLEY GARDENS – PRICE LIST as of November 2026'], [],
    ['Tower', 'Floor', 'Unit No.', 'Unit Type', 'Floor Area (sqm)', 'List Price', 'Discount', 'Net TCP', 'Monthly Dues'],
    ['Tower 1', '12', '1201', 'Studio', 24.5, '₱3,500,000.00', '₱175,000.00', '₱3,325,000.00', 2450],
    ['', '12', '1205', '1BR', 36, 5200000, 260000, 4940000, 3600],
    ['Tower 2', '8', '805', '2BR', '54.2', 7800000, '', 7800000, 5420],
    ['TOTAL', '', '', '', '', 16500000, '', '', ''],
  ] }]);
  assert.deepEqual(pick(r, 'project', 'tower', 'unit', 'type', 'area', 'price', 'discount', 'net', 'dues'), [
    ['SIERRA VALLEY GARDENS', 'Tower 1', '1201', 'Studio', 24.5, 3500000, 175000, 3325000, 2450],
    ['SIERRA VALLEY GARDENS', 'Tower 1', '1205', '1BR', 36, 5200000, 260000, 4940000, 3600],   // tower carried down
    ['SIERRA VALLEY GARDENS', 'Tower 2', '805', '2BR', 54.2, 7800000, 0, 7800000, 5420],
  ]);
  assert.equal(r.units[0].label, 'SIERRA VALLEY GARDENS · Tower 1 · Unit 1201 · Studio · 24.5 sqm');
  assert.equal(r.mapping.headers[r.mapping.map.net], 'Net TCP');
});

test('two-row header, list + net without a discount column', () => {
  const r = parsePriceList([{ name: 'Galleria Residences', rows: [
    ['UNIT', '', 'AREA', 'PRICE', ''],
    ['No.', 'Type', '(sqm)', 'List', 'Net'],
    ['3A', '1BR', 32, 4500000, 4275000],
    ['3B', '2BR', 48, 6900000, 6555000],
  ] }]);
  assert.deepEqual(pick(r, 'project', 'unit', 'type', 'area', 'price', 'discount', 'net'), [
    ['Galleria Residences', '3A', '1BR', 32, 4500000, 225000, 4275000],
    ['Galleria Residences', '3B', '2BR', 48, 6900000, 345000, 6555000],
  ]);
});

test('TCP only, sold units flagged, price-per-sqm column ignored, % discount', () => {
  const r = parsePriceList([{ name: 'Sheet1', rows: [
    ['Unit', 'Type', 'Size', 'Price/sqm', 'Total Contract Price', 'Promo Discount', 'Status'],
    ['501', 'Studio', 22, 150000, 3300000, '5%', 'Available'],
    ['502', 'Studio', 22, 150000, 3300000, '', 'SOLD'],
  ] }]);
  assert.deepEqual(pick(r, 'unit', 'area', 'price', 'discount', 'net', 'status'), [
    ['501', 22, 3300000, 165000, 3135000, ''],
    ['502', 22, 3300000, 0, 3300000, 'SOLD'],
  ]);
});

test('condo dues given per sqm become a monthly amount', () => {
  const r = parsePriceList([{ name: 'S', rows: [['Unit', 'Type', 'Floor Area', 'Selling Price', 'Assoc Dues / sqm'], ['1', '1BR', 30, 4000000, 95]] }]);
  assert.equal(r.units[0].dues, 2850);
  assert.match(r.warnings.join(' '), /per-sqm/);
});

test('rows read from a PDF price list (strings everywhere)', () => {
  const r = parsePriceList([{ name: 'PDF', rows: [
    ['RLC Residences'], ['Bridgetowne Destination Estate - Price List'],
    ['Unit Code', 'Unit Type', 'Area (sqm)', 'Total Selling Price', 'Monthly Dues'],
    ['T1-0712', 'Studio', '23.10', 'PHP 3,895,000.00', 'PHP 2,310.00'],
    ['T1-0715', '1 Bedroom', '35.40', 'PHP 5,612,500.00', 'PHP 3,540.00'],
  ] }]);
  assert.deepEqual(pick(r, 'project', 'unit', 'price', 'dues'), [['RLC Residences', 'T1-0712', 3895000, 2310], ['RLC Residences', 'T1-0715', 5612500, 3540]]);
});

test('nothing usable → helpful warning; a manual column choice is honoured', () => {
  const rows = [['Code', 'Kind', 'Peso'], ['A', 'Studio', 3000000], ['B', '1BR', 4500000]];
  const none = parsePriceList([{ name: 'S', rows }]);
  assert.equal(none.units.length, 0);
  assert.match(none.warnings[0], /Fix columns/);
  const fixed = parsePriceList([{ name: 'S', rows }], { mapping: { sheet: 'S', head: 0, start: 1, headers: rows[0], map: { unit: 0, type: 1, price: 2 } } });
  assert.deepEqual(pick(fixed, 'unit', 'type', 'price'), [['A', 'Studio', 3000000], ['B', '1BR', 4500000]]);
});
