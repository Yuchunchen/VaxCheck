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

test('抗癌藥範圍(YC 2026-09-28):IPD 含 L02;COVID 免疫低下只認 L01', () => {
  const at = '2026-10-05';
  const tam = { birth: '1980-01-01', sex: 'F', dx: [['C50911', '2025-06-01']], meds: [['L02BA01', '2026-08-01']], vacc: [] };
  const ipd = V(run(patient(tam), at), 'PNEUMO_PCV20_21');
  assert.equal(ipd.verdict, 'eligible', '乳癌 + tamoxifen(L02)→ IPD 高風險預勾');
  assert.equal(ipd.evidence[0].key, 'ipdHighRisk');
  const cv = V(run(patient(tam), at), 'COVID');
  assert.ok(!cv.matchedGroups.some((g) => g.groupId === 'COVID_IMMUNOCOMPROMISED'), 'L02 不作 COVID 免疫低下證據');
  const chemo = V(run(patient({ ...tam, meds: [['L01CD01', '2026-08-01']] }), at), 'COVID');
  assert.ok(chemo.matchedGroups.some((g) => g.groupId === 'COVID_IMMUNOCOMPROMISED'), 'L01 → COVID 免疫低下預勾');
});

test('移植 Z94 全章預勾(YC 2026-09-28 不排除角膜/皮膚/骨)', () => {
  const v = V(run(patient({ birth: '1980-01-01', dx: [['Z947', '2026-03-01']], vacc: [] }), D), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'eligible');
  assert.equal(v.evidence[0].key, 'ipdHighRisk');
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
  assert.equal(v.matchedGroups[0].groupId, 'FLU_UNDERLYING');
  const w = V(run(patient({ birth: '1986-01-01', vacc: [], flags: ['dialysis'] }), '2026-10-05'), 'FLU');
  assert.equal(w.verdict, 'eligible');
  assert.equal(w.evidence[0].key, 'fluUnderlyingCondition');
});

test('流感 115:25 歲男性開打前 → 尚未開打,決定性條件只列選填提示(不問孕婦、學生、原住民、幼兒)', () => {
  assert.equal(V(run(patient({ birth: '1958-03-02' }), '2027-07-01'), 'FLU').verdict, 'out_of_season');
  const v = V(run(patient({ birth: '2001-01-01' }), D), 'FLU');
  assert.equal(v.verdict, 'not_open');
  // v0.4.12:開打前確認了也不能今天打 → 不符合 + 選填提示,不列入 decisiveManual(docs/10 §3.1)
  assert.equal(v.display.bucket, 'ineligible');
  assert.deepEqual(v.decisiveManual, []);
  assert.equal(v.display.upgrade.date, '2026-10-01');
  assert.equal(v.display.upgrade.decisive, false);
  const keys = [...v.display.upgrade.requires].sort();
  assert.deepEqual(keys, ['animalWorker', 'childcareWorker', 'fluUnderlyingCondition', 'healthcareWorker', 'infantCaregiver', 'ltcResident'].sort());
  const f = V(run(patient({ birth: '2001-01-01', sex: 'F' }), D), 'FLU');
  assert.ok(f.display.upgrade.requires.includes('pregnant'), '女性問孕婦');
  const s = V(run(patient({ birth: '2010-01-01' }), D), 'FLU');
  assert.ok(s.display.upgrade.requires.includes('fluStudent'), '16 歲問學生');
  assert.ok(s.display.upgrade.requires.includes('fluUnderlyingCondition'), '潛在疾病群無年齡上下限(計畫第二章肆),16 歲也問');
  // 開打後(10/15):確認後今日可打 → 待確認,列入 decisiveManual(現行行為)
  const w = V(run(patient({ birth: '2001-01-01', vacc: [] }), '2026-10-15'), 'FLU');
  assert.equal(w.verdict, 'needs_input');
  assert.equal(w.display.bucket, 'confirm');
  assert.deepEqual(w.decisiveManual.map((m) => m.key).sort(), keys);
});

test('代碼比對:細碼區間(重大傷病表)與附件1', () => {
  const cl = rules().codeLists;
  const cat = cl.NHI_CATASTROPHIC_DX.codes, chr = cl.FLU_CHRONIC_DX.codes;
  assert.ok(matchCode('M05.79', cat), 'RA M05.70-M06.09');
  assert.ok(!matchCode('M06.1', cat), 'M06.1 不在 RA 區間');
  assert.ok(matchCode('M068A', cat), 'M06.80-M06.8A 含字母上界');
  assert.ok(matchCode('F01.B0', cat), '失智 F01.A11-F01.C4');
  assert.ok(matchCode('F3240', cat) && !matchCode('F32.1', cat), '情感性疾患 F32.2-F32.5');
  assert.ok(matchCode('C73', cat) && matchCode('C50.911', cat) && matchCode('C7A.00', cat));
  assert.ok(!matchCode('C94.40', cat) && matchCode('C94.30', cat), '不含 C94.4、C94.6');
  assert.ok(matchCode('E119', chr) && matchCode('I110', chr) && matchCode('Z90.81', chr) && matchCode('M941', chr));
  assert.ok(!matchCode('I10', chr), '單純高血壓不算');
  assert.ok(!matchCode('M94.2', chr));
});

test('代碼比對:三碼類目含所有子碼(附件1 E66、G40、I63、J96;重大傷病 F20 同理)', () => {
  const chr = rules().codeLists.FLU_CHRONIC_DX.codes;
  for (const c of ['E6601', 'E669', 'G40909', 'I639', 'I70219', 'J9610', 'M3500', 'D869', 'N039']) assert.ok(matchCode(c, chr), c);
  assert.ok(!matchCode('I10', chr) && !matchCode('E6', chr) && !matchCode('I64', chr));
  // 英文欄 I5A、P91 全類目納入(YC 2026-09-27)
  assert.ok(matchCode('I5A', chr) && matchCode('P91.821', chr) && matchCode('P91.60', chr) && matchCode('P91.2', chr));
  assert.ok(!matchCode('P90', chr) && !matchCode('P92.0', chr));
  // 58 歲只有腦梗塞 I63.9 → 第一階段即可打,不是排 11/2
  const v = V(run(patient({ birth: '1968-05-05', vacc: [], dx: [['I639', '2026-05-01']] }), '2026-10-05'), 'FLU');
  assert.equal(v.verdict, 'eligible');
  assert.ok(v.matchedGroups.some((g) => g.groupId === 'FLU_UNDERLYING'));
});

test('罕見疾病名單(115-07-23):診斷碼推估預勾;通用碼不作證據', () => {
  const rare = rules().codeLists.RARE_DISEASE_DX.codes;
  assert.equal(rare.length, 324);
  for (const c of ['Q87.11', 'E75.21', 'E74.04', 'M61.122', 'G40.833', 'E75.244', 'H47.22']) assert.ok(matchCode(c, rare), c);
  for (const c of ['E78.00', 'E78.01', 'E16.1', 'E23.0', 'E27.49', 'K83.1', 'K52.89', 'D69.8', 'Q82.8', 'E74.31']) assert.ok(!matchCode(c, rare), c);
  const at = '2026-10-05';
  const pw = V(run(patient({ birth: '1996-01-01', vacc: [], dx: [['Q8711', '2026-04-01']] }), at), 'FLU');   // Prader-Willi:不在附件1、重大傷病表
  assert.equal(pw.verdict, 'eligible');
  assert.match(pw.evidence[0].why.join(), /罕見疾病/);
  assert.equal(V(run(patient({ birth: '1996-01-01', vacc: [], dx: [['Q8711', '2026-04-01']] }), at), 'COVID').verdict, 'eligible');
  assert.equal(V(run(patient({ birth: '1996-01-01', vacc: [], dx: [['E7800', '2026-04-01']] }), at), 'FLU').verdict, 'needs_input', '高膽固醇血症不預勾');
});

test('流感 115 潛在疾病證據:附件1、重大傷病推估、時效', () => {
  const at = '2026-10-05';
  const P = (dx, extra = {}) => V(run(patient({ birth: '1986-01-01', vacc: [], dx, ...extra }), at), 'FLU');
  const dm = P([['E119', '2026-06-01']]);
  assert.equal(dm.verdict, 'eligible');
  assert.equal(dm.evidence[0].key, 'fluUnderlyingCondition');
  assert.match(dm.evidence[0].why.join(), /附件1/);
  assert.equal(P([['I10', '2026-06-01']]).verdict, 'needs_input', '單純高血壓 → 仍要問');
  const ca = P([['C50911', '2026-03-01']]);
  assert.equal(ca.verdict, 'eligible');
  assert.match(ca.evidence[0].why.join(), /重大傷病/);
  assert.equal(P([['F05', '2026-02-01']]).verdict, 'needs_input', '譫妄超過六個月');
  assert.equal(P([['F05', '2026-08-01']]).verdict, 'eligible');
  // 醫師取消 → 不再自動
  assert.equal(P([['E119', '2026-06-01']], { manual: { fluUnderlyingCondition: false } }).verdict, 'needs_input');
  // 58 歲糖尿病:第一階段就可打,不用等 11/2
  const d58 = V(run(patient({ birth: '1968-05-05', vacc: [], dx: [['E1165', '2026-05-01']] }), at), 'FLU');
  assert.equal(d58.verdict, 'eligible');
  assert.ok(d58.matchedGroups.some((g) => g.groupId === 'FLU_UNDERLYING'));
});

test('流感 115 潛在疾病群不限年齡:18 歲氣喘 → 可打;5 個月大重大傷病 → 未滿 6 個月不符', () => {
  const at = '2026-10-05';
  const y18 = V(run(patient({ birth: '2008-03-01', vacc: [], dx: [['J45909', '2026-05-01']] }), at), 'FLU');
  assert.equal(y18.verdict, 'eligible');
  assert.ok(y18.matchedGroups.some((g) => g.groupId === 'FLU_UNDERLYING'));
  const baby = V(run(patient({ birth: '2026-05-01', vacc: [], dx: [['Q211', '2026-06-01']] }), at), 'FLU');
  assert.notEqual(baby.verdict, 'eligible');
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

// ---------------- COVID-19 115–116 年度 ----------------
const CV = (p, at) => V(run(patient(p), at), 'COVID');

test('COVID 115:68 歲開打前 → 10/1 起;10/5 可打第 1 劑;打完 → 180 天後可再增加 1 劑', () => {
  const s = CV({ birth: '1958-03-02' }, D);
  assert.equal(s.verdict, 'scheduled');
  assert.equal(s.opensOn, '2026-10-01');
  const v = CV({ birth: '1958-03-02', vacc: [] }, '2026-10-05');
  assert.equal(v.verdict, 'eligible');
  assert.equal(v.dosing.dose, 1);
  const w = CV({ birth: '1958-03-02', vacc: [['COVID', '2026-10-05']] }, '2026-11-01');
  assert.equal(w.verdict, 'wait');
  assert.equal(w.dosing.dose, 2);
  assert.equal(w.dosing.earliestDate, '2027-04-03');
  assert.match(w.explanation, /可再增加 1 劑/);
  const c = CV({ birth: '1958-03-02', vacc: [['COVID', '2026-10-05'], ['COVID', '2027-04-10']] }, '2027-05-01');
  assert.equal(c.verdict, 'completed');
});

test('COVID 115:曾接種者與前 1 劑間隔 12 週,不限本季(上季 8/1 打 → 10/24 起)', () => {
  const v = CV({ birth: '1958-03-02', vacc: [['COVID', '2026-08-01']] }, '2026-10-05');
  assert.equal(v.verdict, 'wait');
  assert.equal(v.dosing.earliestDate, '2026-10-24');
  assert.equal(CV({ birth: '1958-03-02', vacc: [['COVID', '2026-06-01']] }, '2026-10-05').verdict, 'eligible');
});

test('COVID 115:40 歲糖尿病 → 第一階段(沿用流感潛在疾病);ADHD → 其他風險預勾;僅 1 劑', () => {
  const dm = CV({ birth: '1986-01-01', vacc: [], dx: [['E119', '2026-06-01']] }, '2026-10-05');
  assert.equal(dm.verdict, 'eligible');
  assert.ok(dm.matchedGroups.some((g) => g.groupId === 'COVID_HIGHRISK'));
  assert.equal(dm.evidence[0].key, 'fluUnderlyingCondition');
  assert.equal(dm.dosing.dosesRequired, 1);
  const adhd = CV({ birth: '1996-01-01', vacc: [], dx: [['F900', '2026-06-01']] }, '2026-10-05');
  assert.equal(adhd.verdict, 'eligible');
  assert.equal(adhd.evidence[0].key, 'covidOtherRisk');
  // 結核病只看一年內
  assert.notEqual(CV({ birth: '1996-01-01', vacc: [], dx: [['A150', '2024-06-01']] }, '2026-10-05').verdict, 'eligible');
  // 輕微先天畸形(舌繫帶 Q38.1)不預勾
  assert.notEqual(CV({ birth: '1996-01-01', vacc: [], dx: [['Q381', '2026-06-01']] }, '2026-10-05').verdict, 'eligible');
});

test('COVID 115:免疫低下(TNF 阻斷劑、洗腎)→ 自動預勾,本季可再增加 1 劑', () => {
  const tnf = CV({ birth: '1986-01-01', vacc: [], meds: [['L04AB02', '2026-08-20']] }, '2026-10-05');
  assert.equal(tnf.verdict, 'eligible');
  assert.ok(tnf.matchedGroups.some((g) => g.groupId === 'COVID_IMMUNOCOMPROMISED'));
  assert.equal(tnf.dosing.dosesRequired, 2);
  const hd = CV({ birth: '1986-01-01', vacc: [], flags: ['dialysis'] }, '2026-10-05');
  assert.equal(hd.dosing.dosesRequired, 2);
  // 免疫抑制劑超過 90 天 → 不預勾
  const old = CV({ birth: '1986-01-01', vacc: [], meds: [['L04AB02', '2026-05-01']] }, '2026-10-05');
  assert.ok(!old.matchedGroups.some((g) => g.groupId === 'COVID_IMMUNOCOMPROMISED'));
});

test('COVID 115:58 歲無高風險 → 第一階段排 11/2;11/2 可打', () => {
  assert.equal(CV({ birth: '1968-05-05' }, '2026-10-15').opensOn, '2026-11-02');
  assert.equal(CV({ birth: '1968-05-05', vacc: [] }, '2026-11-01').verdict, 'scheduled');
  assert.equal(CV({ birth: '1968-05-05', vacc: [] }, '2026-11-02').verdict, 'eligible');
});

test('COVID 115 幼兒:從未接種 2 歲 → 2 劑間隔 4 週;曾接種 → 不在幼兒群;5 歲首次 → 1 劑;6 歲 → 不符', () => {
  const at = '2026-10-05';
  const t = CV({ birth: '2024-06-01', vacc: [] }, at);
  assert.equal(t.verdict, 'eligible');
  assert.ok(t.matchedGroups.some((g) => g.groupId === 'COVID_NAIVE_CHILD'));
  assert.equal(t.dosing.variant.id, 'COVID_UNDER5_NAIVE_2DOSE');
  assert.equal(t.dosing.dosesRequired, 2);
  const t2 = CV({ birth: '2024-06-01', vacc: [['COVID', '2026-10-05']] }, '2026-10-20');
  assert.equal(t2.verdict, 'wait', '本季第 1 劑後仍屬「開打前從未接種」,可打第 2 劑');
  assert.equal(t2.dosing.earliestDate, '2026-11-02');
  const prior = CV({ birth: '2024-06-01', vacc: [['COVID', '2025-12-01']] }, at);
  assert.ok(!prior.matchedGroups.some((g) => g.groupId === 'COVID_NAIVE_CHILD'));
  assert.notEqual(prior.verdict, 'eligible');
  const five = CV({ birth: '2021-03-01', vacc: [] }, at);
  assert.equal(five.verdict, 'eligible');
  assert.equal(five.dosing.dosesRequired, 1);
  const six = CV({ birth: '2020-09-01', vacc: [] }, at);
  assert.ok(!six.matchedGroups.some((g) => g.groupId === 'COVID_NAIVE_CHILD'));
  assert.notEqual(CV({ birth: '2026-05-01', vacc: [] }, at).verdict, 'eligible', '未滿 6 個月');
});

test('COVID 115 幼兒免疫低下:從未接種 2 歲 → 2 劑 + 再增加 1 劑', () => {
  const t = CV({ birth: '2024-06-01', vacc: [], dx: [['D801', '2026-03-01']] }, '2026-10-05');
  assert.equal(t.dosing.variant.id, 'COVID_UNDER5_NAIVE_2DOSE_PLUS1');
  assert.equal(t.dosing.dosesRequired, 3);
});

test('COVID 115:25 歲男性開打前 → 只列選填提示;開打後只問決定性條件,潛在疾病與流感共用同一題', () => {
  const pre = V(run(patient({ birth: '2001-01-01' }), D), 'COVID');
  assert.equal(pre.verdict, 'not_open');
  assert.equal(pre.display.bucket, 'ineligible');
  assert.deepEqual(pre.decisiveManual, []);
  const res = run(patient({ birth: '2001-01-01', vacc: [] }), '2026-10-15');
  const v = V(res, 'COVID');
  assert.equal(v.verdict, 'needs_input');
  const keys = v.decisiveManual.map((m) => m.key).sort();
  assert.deepEqual(keys, ['childcareWorker', 'covidImmunocompromised', 'covidOtherRisk', 'fluUnderlyingCondition', 'healthcareWorker', 'infantCaregiver', 'ltcResident'].sort());
  const q = res.ask.find((a) => a.key === 'fluUnderlyingCondition');
  assert.deepEqual(q.vaccines.sort(), ['COVID', 'FLU']);
  assert.equal(res.ask.filter((a) => a.key === 'fluUnderlyingCondition').length, 1);
});

test('COVID 115 禁忌:嚴重過敏 → 不可打', () => {
  assert.equal(CV({ birth: '1958-03-02', vacc: [], manual: { severeAllergyToVaccine: true } }, '2026-10-05').verdict, 'contraindicated');
});

test('vaccination 條件 before:只看該日前,無日期視為較早', () => {
  const f = patient({ birth: '2024-06-01', vacc: [['COVID', '2026-10-05']] });
  assert.equal(evalCond({ vaccination: { vaccineCodes: ['COVID'], maxDoses: 0, before: '2026-10-01' } }, ctx(f, '2026-10-20')).v, true);
  const g = patient({ birth: '2024-06-01', vacc: [['COVID', null]] });
  assert.equal(evalCond({ vaccination: { vaccineCodes: ['COVID'], maxDoses: 0, before: '2026-10-01' } }, ctx(g, '2026-10-20')).v, false);
});
