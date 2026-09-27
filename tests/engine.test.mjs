import test from 'node:test';
import assert from 'node:assert/strict';
import { evalCond, matchCode } from '../src/engine/index.js';
import { addInterval, normDate } from '../src/engine/dates.js';
import { patient, run, V, rules } from './helpers.mjs';

const D = '2026-09-16';
const ctx = (facts, asOf = D) => ({ facts, rules: rules(), asOf, manualDefs: {} });

test('實足年齡邊界:生日當天滿 65', () => {
  assert.equal(evalCond({ age: { min: { years: 65 } } }, ctx(patient({ birth: '1961-09-16' }))).v, true);
  assert.equal(evalCond({ age: { min: { years: 65 } } }, ctx(patient({ birth: '1961-09-17' }))).v, false);
  assert.equal(evalCond({ age: { max: { months: 5 } } }, ctx(patient({ birth: '2026-03-17' }))).v, true);
  assert.equal(evalCond({ age: { max: { months: 5 } } }, ctx(patient({ birth: '2026-03-16' }))).v, false);
});

test('年次年齡:接種年 − 出生年,不看月日', () => {
  assert.equal(evalCond({ ageByYear: { min: 65 } }, ctx(patient({ birth: '1961-12-31' }), '2026-01-01')).v, true);
  assert.equal(evalCond({ ageByYear: { min: 19, max: 64 } }, ctx(patient({ birth: '1962-01-01' }), '2026-12-31')).v, true);
});

test('曆法間隔:2/29 + 1 年 → 3/1;民國日期轉換', () => {
  assert.equal(addInterval('2024-02-29', { years: 1 }), '2025-03-01');
  assert.equal(addInterval('2026-01-31', { months: 1 }), '2026-03-01');
  assert.equal(normDate('1150916'), '2026-09-16');
  assert.equal(normDate('2025/03/23'), '2025-03-23');
  assert.equal(normDate('114/02/05'), '2025-02-05');
});

test('官方 IPD ICD 表:精確比對、截短碼、表外碼不命中', () => {
  const cl = rules().codeLists;
  assert.ok(matchCode('D56.1', cl.IPD_SPLEEN_DX.codes));
  assert.ok(matchCode('D5741', cl.IPD_SPLEEN_DX.codes), '雲端截短碼 D57.41x');
  assert.ok(!matchCode('D70.1', cl.IPD_IMMUNE_DX.codes), 'D70.1 化療後嗜中性球低下不在官方表');
  assert.ok(!matchCode('D73.1', cl.IPD_SPLEEN_DX.codes), '官方表只列 D73.0');
  assert.ok(matchCode('Z94.0', cl.IPD_TRANSPLANT_DX.codes));
  assert.equal(cl.IPD_MALIGNANCY_DX.codes.length, 1635);
});

test('三值邏輯:all/any/not 的 unknown 傳遞', () => {
  const f = patient({ birth: '1958-03-02' });
  const c = ctx(f);
  assert.equal(evalCond({ all: [{ ageByYear: { min: 65 } }, { vaccination: { vaccineCodes: ['PCV13'] } }] }, c).v, null);
  assert.equal(evalCond({ any: [{ ageByYear: { min: 65 } }, { vaccination: { vaccineCodes: ['PCV13'] } }] }, c).v, true);
  assert.equal(evalCond({ not: { vaccination: { vaccineCodes: ['PCV13'] } } }, c).v, null);
  assert.equal(evalCond({ all: [{ ageByYear: { max: 50 } }, { vaccination: { vaccineCodes: ['PCV13'] } }] }, c).v, false);
});

test('肺鏈 68 歲、接種史未查 → 符合對象,待查接種史', () => {
  const v = V(run(patient({ birth: '1958-03-02' }), D), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'pending_history');
  assert.deepEqual(v.matchedGroups.map((g) => g.groupId), ['PNEUMO_ELDER_65']);
  assert.deepEqual(v.decisiveManual, [], '已符合就不再問原住民/IPD');
});

test('肺鏈 Rule A:從未接種 → 今日可打', () => {
  const v = V(run(patient({ birth: '1958-03-02', vacc: [] }), D), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'eligible');
  assert.equal(v.dosing.case.id, 'A_NAIVE');
});

test('肺鏈 Rule C:PCV13 滿 1 年 → 直接可打,不問 8 週條件', () => {
  const v = V(run(patient({ birth: '1958-03-02', vacc: [['PCV13', '2025-03-01']] }), D), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'eligible');
  assert.equal(v.dosing.case.id, 'C_PCV_ONLY');
});

test('肺鏈 Rule C:PCV13 未滿 1 年 → 待確認 8 週族群(決定性條件)', () => {
  const v = V(run(patient({ birth: '1958-03-02', vacc: [['PCV13', '2026-06-01']] }), D), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'needs_input');
  assert.ok(v.decisiveManual.some((m) => m.key === 'ipdHighRisk'));
  assert.equal(v.dosing.alternative.earliestDate, '2027-06-01');
});

test('肺鏈 Rule C 8 週:病歷有洗腎 → 自動勾選,今日可打', () => {
  const v = V(run(patient({ birth: '1958-03-02', flags: ['dialysis'], vacc: [['PCV13', '2026-06-01']] }), D), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'eligible');
  assert.equal(v.dosing.case.id, 'C_PCV_ONLY_8WK');
  assert.equal(v.dosing.earliestDate, D);
});

test('肺鏈 Rule D/E:PCV13+PPV23 完成 → 問 IPD 高風險;排除 → 已完成;確認 → 追加', () => {
  const base = { birth: '1955-05-05', vacc: [['PCV13', '2018-01-01'], ['PPV23', '2019-01-01']] };
  assert.equal(V(run(patient(base), D), 'PNEUMO_PCV20_21').verdict, 'needs_input');
  assert.equal(V(run(patient({ ...base, manual: { ipdHighRisk: false } }), D), 'PNEUMO_PCV20_21').verdict, 'completed');
  const e = V(run(patient({ ...base, manual: { ipdHighRisk: true } }), D), 'PNEUMO_PCV20_21');
  assert.equal(e.verdict, 'eligible');
  assert.equal(e.dosing.case.id, 'E_IPD_65_BOOST');
});

test('肺鏈 S3:自費 PPV23 + 公費 PCV13 → 不再公費', () => {
  const v = V(run(patient({ birth: '1955-05-05', vacc: [['PPV23', '2020-01-01', '自費'], ['PCV13', '2024-01-01', '公費']] }), D), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'not_funded');
});

test('肺鏈:型別不明紀錄 → 需人工確認', () => {
  const v = V(run(patient({ birth: '1955-05-05', vacc: [['PNEUMO_UNKNOWN', '2020-01-01']] }), D), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'needs_review');
  assert.ok(v.dosing.flags.includes('NEED_HISTORY_CONFIRMATION'));
});

test('IPD 證據:45 歲地中海型貧血 → 自動勾選 IPD 高風險 → 可打', () => {
  const v = V(run(patient({ birth: '1981-04-01', sex: 'F', dx: [['D561', '2026-02-10']], vacc: [] }), D), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'eligible');
  assert.equal(v.matchedGroups[0].groupId, 'PNEUMO_IPD_19_64');
  assert.equal(v.evidence[0].key, 'ipdHighRisk');
  // 醫師取消 → 回到需確認
  const w = V(run(patient({ birth: '1981-04-01', sex: 'F', dx: [['D561', '2026-02-10']], vacc: [], manual: { ipdHighRisk: false } }), D), 'PNEUMO_PCV20_21');
  assert.equal(w.verdict, 'ineligible');
});

test('IPD 惡性腫瘤需一年內抗癌藥;只有診斷 → 仍要問', () => {
  const only = V(run(patient({ birth: '1970-01-01', dx: [['C509', '2025-01-01']], vacc: [] }), D), 'PNEUMO_PCV20_21');
  assert.equal(only.verdict, 'needs_input');
  const withDrug = V(run(patient({ birth: '1970-01-01', dx: [['C509', '2025-01-01']], meds: [['L01XC03', '2026-05-01']], vacc: [] }), D), 'PNEUMO_PCV20_21');
  assert.equal(withDrug.verdict, 'eligible');
});

test('25 歲無病史:只問決定性條件,同一條件只問一次', () => {
  const res = run(patient({ birth: '2001-01-01' }), D);
  const p = V(res, 'PNEUMO_PCV20_21');
  assert.equal(p.verdict, 'needs_input');
  assert.deepEqual(p.decisiveManual.map((m) => m.key), ['ipdHighRisk']);
  assert.ok(!p.decisiveManual.some((m) => m.key === 'indigenous'), '年齡不到 55,不問原住民');
  assert.equal(res.ask.filter((a) => a.key === 'ipdHighRisk').length, 1);
});

test('流感 115:68 歲開打前 → 已符合,10/1 起可打;10/5 → 可打第 1 劑', () => {
  const v = V(run(patient({ birth: '1958-03-02' }), D), 'FLU');
  assert.equal(v.verdict, 'scheduled');
  assert.equal(v.opensOn, '2026-10-01');
  const w = V(run(patient({ birth: '1958-03-02', vacc: [] }), '2026-10-05'), 'FLU');
  assert.equal(w.verdict, 'eligible');
  assert.equal(w.dosing.dose, 1);
  assert.equal(w.dosing.dosesRequired, 1);
});

test('流感 115:年次算法 — 1961-12-31 生於 2026-10-05 算 65 歲(第一階段)', () => {
  const v = V(run(patient({ birth: '1961-12-31', vacc: [] }), '2026-10-05'), 'FLU');
  assert.equal(v.verdict, 'eligible');
  assert.ok(v.matchedGroups.some((g) => g.groupId === 'FLU_ELDER_65'));
});

test('流感 115:58 歲無勾選 → 第一階段期間排 11/2;第二階段 → 可打;已打 → 完成', () => {
  assert.equal(V(run(patient({ birth: '1968-05-05' }), '2026-10-15'), 'FLU').verdict, 'scheduled');
  assert.equal(V(run(patient({ birth: '1968-05-05' }), '2026-10-15'), 'FLU').opensOn, '2026-11-02');
  assert.equal(V(run(patient({ birth: '1968-05-05', vacc: [] }), '2026-11-01'), 'FLU').verdict, 'scheduled', '11/1 尚未開放');
  assert.equal(V(run(patient({ birth: '1968-05-05', vacc: [] }), '2026-11-02'), 'FLU').verdict, 'eligible');
  assert.equal(V(run(patient({ birth: '1968-05-05', vacc: [['FLU', '2026-11-02']] }), '2026-11-05'), 'FLU').verdict, 'completed');
  // 去年那劑不算本季
  assert.equal(V(run(patient({ birth: '1968-05-05', vacc: [['FLU', '2025-10-20']] }), '2026-11-05'), 'FLU').verdict, 'eligible');
});

test('流感 115:40 歲具潛在疾病(醫師勾)→ 第一階段可打;透析旗標 → 自動預勾', () => {
  const v = V(run(patient({ birth: '1986-01-01', vacc: [], manual: { fluUnderlyingCondition: true } }), '2026-10-05'), 'FLU');
  assert.equal(v.verdict, 'eligible');
  assert.equal(v.matchedGroups[0].groupId, 'FLU_UNDERLYING_19_64');
  const w = V(run(patient({ birth: '1986-01-01', vacc: [], flags: ['dialysis'] }), '2026-10-05'), 'FLU');
  assert.equal(w.verdict, 'eligible');
  assert.equal(w.evidence[0].key, 'fluUnderlyingCondition');
});

test('流感 115:25 歲男性開打前 → 尚未開打,只問決定性條件(不問孕婦、學生、原住民、幼兒)', () => {
  assert.equal(V(run(patient({ birth: '1958-03-02' }), '2027-07-01'), 'FLU').verdict, 'out_of_season');
  const v = V(run(patient({ birth: '2001-01-01' }), D), 'FLU');
  assert.equal(v.verdict, 'not_open');
  const keys = v.decisiveManual.map((m) => m.key).sort();
  assert.deepEqual(keys, ['animalWorker', 'childcareWorker', 'fluUnderlyingCondition', 'healthcareWorker', 'infantCaregiver', 'ltcResident'].sort());
  const f = V(run(patient({ birth: '2001-01-01', sex: 'F' }), D), 'FLU');
  assert.ok(f.decisiveManual.some((m) => m.key === 'pregnant'), '女性問孕婦');
  const s = V(run(patient({ birth: '2010-01-01' }), D), 'FLU');
  assert.ok(s.decisiveManual.some((m) => m.key === 'fluStudent'), '16 歲問學生');
  assert.ok(!s.decisiveManual.some((m) => m.key === 'fluUnderlyingCondition'), '未滿 19 歲不走潛在疾病群');
});

test('流感 115 幼兒:未滿 6 個月不符;2 歲首次 → 本季 2 劑、第 2 劑間隔 4 週', () => {
  const baby = V(run(patient({ birth: '2026-05-01', vacc: [] }), '2026-10-05'), 'FLU');
  assert.notEqual(baby.verdict, 'eligible', '5 個月大');
  const t = V(run(patient({ birth: '2024-06-01', vacc: [] }), '2026-10-05'), 'FLU');
  assert.equal(t.verdict, 'eligible');
  assert.equal(t.evidence[0].key, 'preschoolChild', '未滿 6 歲自動預勾入學前');
  assert.equal(t.dosing.variant.id, 'FLU_UNDER3_2DOSE');
  assert.equal(t.dosing.dosesRequired, 2);
  const t2 = V(run(patient({ birth: '2024-06-01', vacc: [['FLU', '2026-10-05']] }), '2026-10-20'), 'FLU');
  assert.equal(t2.verdict, 'wait');
  assert.equal(t2.dosing.dose, 2);
  assert.equal(t2.dosing.earliestDate, '2026-11-02');
  const t3 = V(run(patient({ birth: '2024-06-01', vacc: [['FLU', '2026-10-05'], ['FLU', '2026-11-02']] }), '2026-11-10'), 'FLU');
  assert.equal(t3.verdict, 'completed');
});

test('流感 115 幼兒劑次:未滿 3 歲曾打 1 劑仍 2 劑、曾打 2 劑 → 1 劑;3–8 歲曾打 1 劑 → 1 劑、首次 → 2 劑', () => {
  const under3one = V(run(patient({ birth: '2024-06-01', vacc: [['FLU', '2025-12-01']] }), '2026-10-05'), 'FLU');
  assert.equal(under3one.dosing.dosesRequired, 2);
  const under3two = V(run(patient({ birth: '2024-06-01', vacc: [['FLU', '2025-12-01'], ['FLU', '2026-01-02']] }), '2026-10-05'), 'FLU');
  assert.equal(under3two.dosing.dosesRequired, 1);
  const five = V(run(patient({ birth: '2021-03-01', vacc: [['FLU', '2023-11-01']] }), '2026-10-05'), 'FLU');
  assert.equal(five.dosing.dosesRequired, 1);
  const fiveNaive = V(run(patient({ birth: '2021-03-01', vacc: [] }), '2026-10-05'), 'FLU');
  assert.equal(fiveNaive.dosing.dosesRequired, 2);
  // 7 歲學生首次 → 2 劑
  const seven = V(run(patient({ birth: '2019-03-01', vacc: [], manual: { fluStudent: true } }), '2026-10-05'), 'FLU');
  assert.equal(seven.verdict, 'eligible');
  assert.equal(seven.dosing.dosesRequired, 2);
  // 年齡以本季第 1 劑日計:第 1 劑時 8 歲、現在已 9 歲 → 仍需 2 劑
  const turn9 = V(run(patient({ birth: '2017-10-20', vacc: [['FLU', '2026-10-05']], manual: { fluStudent: true } }), '2026-11-05'), 'FLU');
  assert.equal(turn9.dosing.dosesRequired, 2);
  assert.equal(turn9.verdict, 'eligible');
});

test('禁忌:醫師勾嚴重過敏 → 不可打;未勾 → 只提醒', () => {
  const v = V(run(patient({ birth: '1958-03-02', vacc: [], manual: { severeAllergyToVaccine: true } }), D), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'contraindicated');
  const w = V(run(patient({ birth: '1958-03-02', vacc: [] }), D), 'PNEUMO_PCV20_21');
  assert.equal(w.reminders[0].key, 'severeAllergyToVaccine');
});

test('資料來源失敗 → 不誤判成可打', () => {
  const v = V(run(patient({ birth: '1981-04-01', dx: [['D561', '2026-02-10']], vacc: [], sources: { medication: 'error' } }), D), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'needs_input', '病歷讀不到就改問醫師,不放行');
});
