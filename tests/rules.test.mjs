import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildAll, ROOT } from '../scripts/lib/rules.mjs';
import { evaluate } from '../src/engine/index.js';
import { patient } from './helpers.mjs';

const fx = (d) => path.join(ROOT, 'tests', 'fixtures', d);

test('正式規則集通過 schema 與語意檢查', () => {
  const { errors, outputs } = buildAll();
  assert.deepEqual(errors, []);
  assert.equal(outputs.TW.jurisdiction.code, 'TW');
  const flu = outputs.TW.vaccines.find((v) => v.vaccineId === 'FLU');
  assert.deepEqual(flu.eligibilityGroups.find((g) => g.groupId === 'FLU_ADULT_50_64').effective, { from: '2026-11-02', to: '2027-06-30' });
  assert.deepEqual(flu.eligibilityGroups.find((g) => g.groupId === 'FLU_ELDER_65').effective, { from: '2026-10-01', to: '2027-06-30' });
  assert.equal(flu.eligibilityGroups.filter((g) => g.priorityPhase === 1).length, 11, '第一階段 11 類');
});

test('縣市 overlay:合併後標示來源為縣市,中央判定不變', () => {
  const { errors, outputs } = buildAll({ overlayDir: fx('overlays-ok') });
  assert.deepEqual(errors, []);
  const rs = outputs['TW-TPE'];
  const f = patient({ birth: '1968-05-05', sex: 'F', vacc: [], manual: { resident_TW_TPE: true } });
  const v = evaluate(f, rs, { asOf: '2026-09-16' }).vaccines.find((x) => x.vaccineId === 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'eligible');
  assert.deepEqual(v.providedBy, ['county']);
  assert.equal(v.matchedGroups[0].jurisdiction, 'TW-TPE');
  // 68 歲在臺北:中央符合,縣市群年齡不符 → 只標中央
  const w = evaluate(patient({ birth: '1958-03-02', vacc: [] }), rs, { asOf: '2026-09-16' }).vaccines.find((x) => x.vaccineId === 'PNEUMO_PCV20_21');
  assert.deepEqual(w.providedBy, ['central']);
  // 58 歲、未勾設籍 → 問「設籍臺北市」
  const u = evaluate(patient({ birth: '1968-05-05', vacc: [] }), rs, { asOf: '2026-09-16' }).vaccines.find((x) => x.vaccineId === 'PNEUMO_PCV20_21');
  assert.ok(u.decisiveManual.some((m) => m.key === 'resident_TW_TPE'));
});

test('縣市 overlay 違規 → 建置失敗(改劑次、缺來源、前綴錯、缺設籍後備)', () => {
  const { errors } = buildAll({ overlayDir: fx('overlays-bad') });
  const all = errors.join('\n');
  assert.match(all, /不可含 dosing/);
  assert.match(all, /必須以 TPE_ 開頭/);
  assert.match(all, /缺 sourceIds/);
  assert.match(all, /resident_TW_TPE/);
});
