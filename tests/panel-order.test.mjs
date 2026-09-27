import test from 'node:test';
import assert from 'node:assert/strict';
import { groupOf, groupVaccines, sortTrace } from '../src/panel/order.js';

const v = (id, verdict, dosing = null) => ({ vaccineId: id, verdict, dosing });

test('分組:可接種 → 待確認 → 不符合,組內維持規則順序,空組不列', () => {
  const vaccines = [
    v('A', 'completed'), v('B', 'eligible', { status: 'due' }), v('C', 'needs_input'), v('D', 'wait', { status: 'wait' }),
    v('E', 'pending_history', { status: 'pending_history' }), v('F', 'eligible', { status: 'due' }), v('G', 'ineligible'),
    v('H', 'unknown_source'), v('I', 'needs_review'), v('J', 'not_funded'), v('K', 'not_open'), v('L', 'out_of_season'), v('M', 'scheduled'),
  ];
  const g = groupVaccines(vaccines);
  assert.deepEqual(g.map((x) => [x.key, x.label, x.items.map((i) => i.vaccineId).join('')]), [
    ['go', '可接種', 'BF'],
    ['check', '待確認', 'CEHI'],
    ['no', '不符合', 'ADGJKLM'],
  ]);
  assert.deepEqual(vaccines.map((x) => x.vaccineId).join(''), 'ABCDEFGHIJKLM', 'Result 本身不改順序');
  assert.deepEqual(groupVaccines([v('X', 'ineligible')]).map((x) => x.key), ['no'], '空組不顯示');
});

test('分組:待定 case(含 alternative)→ 待確認;eligible 但非今日可打 → 待確認', () => {
  assert.equal(groupOf(v('P', 'needs_input', { status: 'pending_case', alternative: { status: 'completed' } })), 'check');
  assert.equal(groupOf(v('Q', 'needs_review', { status: 'pending_case', alternative: null })), 'check');
  assert.equal(groupOf(v('R', 'eligible', { status: 'wait' })), 'check');
});

test('分組:表上未列的 verdict(含 contraindicated)→ 待確認,不歸入可接種', () => {
  assert.equal(groupOf(v('X', 'contraindicated')), 'check');
  assert.equal(groupOf(v('Y', 'something_new')), 'check');
  assert.equal(groupOf(v('Z', undefined)), 'check');
});

test('判定依據:✓ → 未確認 → ✗,同值維持規則順序', () => {
  const t = [{ id: 1, value: false }, { id: 2, value: null }, { id: 3, value: true }, { id: 4, value: false }, { id: 5, value: true }, { id: 6, value: undefined }];
  assert.deepEqual(sortTrace(t).map((x) => x.id), [3, 5, 2, 6, 1, 4]);
  assert.deepEqual(t.map((x) => x.id), [1, 2, 3, 4, 5, 6], '不改原陣列');
});
