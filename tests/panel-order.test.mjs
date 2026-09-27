import test from 'node:test';
import assert from 'node:assert/strict';
import { groupOf, groupVaccines, sortTrace } from '../src/panel/order.js';

const v = (id, bucket, verdict = 'x') => ({ vaccineId: id, verdict, display: bucket ? { bucket } : undefined });

test('分組:可接種 → 待確認 → 尚未開打 → 不符合,組內維持規則順序,空組不列', () => {
  const vaccines = [
    v('A', 'ineligible'), v('B', 'eligible'), v('C', 'confirm'), v('D', 'not_open'), v('E', 'confirm'), v('F', 'eligible'),
    v('G', 'ineligible'), v('H', 'not_open'), v('I', 'confirm'),
  ];
  const g = groupVaccines(vaccines);
  assert.deepEqual(g.map((x) => [x.key, x.label, x.items.map((i) => i.vaccineId).join('')]), [
    ['eligible', '可接種', 'BF'],
    ['confirm', '待確認', 'CEI'],
    ['not_open', '尚未開打', 'DH'],
    ['ineligible', '不符合', 'AG'],
  ]);
  assert.deepEqual(vaccines.map((x) => x.vaccineId).join(''), 'ABCDEFGHI', 'Result 本身不改順序');
  assert.deepEqual(groupVaccines([v('X', 'ineligible'), v('Y', 'eligible')]).map((x) => x.key), ['eligible', 'ineligible'], '空組不顯示');
  assert.deepEqual(groupVaccines([v('Z', 'not_open')]).map((x) => x.label), ['尚未開打']);
});

test('分組只看 display.bucket:verdict、pending_case、alternative 不影響', () => {
  assert.equal(groupOf({ verdict: 'needs_input', dosing: { status: 'pending_case', alternative: { status: 'wait' } }, display: { bucket: 'not_open' } }), 'not_open');
  assert.equal(groupOf({ verdict: 'scheduled', display: { bucket: 'confirm' } }), 'confirm');
  assert.equal(groupOf({ verdict: 'needs_input', dosing: { status: 'pending_case', alternative: { status: 'completed' } }, display: { bucket: 'ineligible' } }), 'ineligible');
});

test('分組:沒有 display 或 bucket 不在表上 → 待確認,不歸入可接種', () => {
  assert.equal(groupOf(v('X', undefined, 'eligible')), 'confirm');
  assert.equal(groupOf(v('Y', 'something_new', 'eligible')), 'confirm');
  assert.equal(groupOf({ vaccineId: 'Z' }), 'confirm');
  assert.equal(groupOf(undefined), 'confirm');
});

test('判定依據:✓ → 未確認 → ✗,同值維持規則順序', () => {
  const t = [{ id: 1, value: false }, { id: 2, value: null }, { id: 3, value: true }, { id: 4, value: false }, { id: 5, value: true }, { id: 6, value: undefined }];
  assert.deepEqual(sortTrace(t).map((x) => x.id), [3, 5, 2, 6, 1, 4]);
  assert.deepEqual(t.map((x) => x.id), [1, 2, 3, 4, 5, 6], '不改原陣列');
});
