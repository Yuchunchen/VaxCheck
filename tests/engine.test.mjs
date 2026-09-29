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

// ---------- 罕見疾病名單(115-07-23;v0.4.24 由腳本產生,寬泛碼只顯示不預勾)----------
const grpOf = (v, id) => v.groupTrace.find((g) => g.groupId === id);
const rareAsk = (v) => v.decisiveManual.find((m) => m.key === 'fluUnderlyingCondition');
const AT = '2026-10-05';
const adult = (dx, extra = {}) => patient({ birth: '1996-01-01', vacc: [], dx: dx.map((c) => [c, '2026-04-01']), ...extra });

test('罕見疾病名單:333 碼、寬泛碼 34 碼只顯示不預勾;比對形式與其他清單相同', () => {
  const l = rules().codeLists.RARE_DISEASE_DX;
  assert.equal(l.codes.length, 333);
  assert.equal(l.broadEvidence, 'display-only');
  assert.equal(l.meta.filter((m) => m?.broad).length, 34);
  assert.match(l.evidenceNote, /診斷碼推估.*以證明為準/);
  for (const c of ['Q87.11', 'E75.21', 'E74.04', 'E74.01', 'M61.122', 'M61.129', 'G40.833', 'E75.244', 'H47.22', 'E74.4']) assert.ok(matchCode(c, l.codes), c);
  for (const c of ['E74.31', 'E71.22', 'E72.113', 'E76.2194']) assert.ok(!matchCode(c, l.codes), `${c} 不在名單(E74.31 僅為組合碼成分;其餘為頁碼黏碼)`);
  assert.ok(matchCode('E7524', l.codes), '雲端截短成 5 碼者仍相符(既有行為)');
});

test('罕見疾病:非寬泛碼預勾 —— 證據帶 category、broad=false、shared/otherCount;N=1 只寫病名', () => {
  for (const id of ['FLU', 'COVID']) {
    const v = V(run(adult(['Q8711']), AT), id);   // Prader-Willi:不在附件1、重大傷病表
    assert.equal(v.verdict, 'eligible', id);
    assert.match(v.evidence[0].why.join(), /罕見疾病/);
  }
  const v = V(run(adult(['Q8711']), AT), 'FLU');
  const [e] = grpOf(v, 'FLU_UNDERLYING').evidence;
  assert.deepEqual({ code: e.code, label: e.label, category: e.category, broad: e.broad, shared: e.shared, otherCount: e.otherCount },
    { code: 'Q8711', label: 'Prader-Willi 氏症候群', category: 'rare', broad: false, shared: false, otherCount: 0 });
  assert.match(e.note, /診斷碼推估,以證明為準/);
  assert.equal(e.count, 1);
  assert.equal(e.lastDate, '2026-04-01');
  assert.equal(v.report.primary[0].code, 'F06B');
});

test('罕見疾病:共用碼顯示「第一個病名 等 N 種(公告碼)」;預勾', () => {
  const v = V(run(adult(['G230']), AT), 'FLU');   // G23.0:B1-25 PKAN、B1-26 PLAN、B1-28 BPAN 共用(非寬泛、不在重大傷病/附件1)
  assert.equal(v.verdict, 'eligible');
  const [e] = grpOf(v, 'FLU_UNDERLYING').evidence;
  assert.equal(e.label, '泛酸鹽激酶關聯之神經退化性疾病 等 3 種(公告碼)');
  assert.deepEqual([e.category, e.shared, e.otherCount, e.broad], ['rare', true, 2, false]);
});

test('罕見疾病:只有寬泛碼 —— 顯示證據、不預勾;問題卡旁附證據「寬泛碼」', () => {
  for (const id of ['FLU', 'COVID']) {
    const v = V(run(adult(['Q8789']), AT), id);   // Q87.89 共 10 種病;只有這個碼
    assert.equal(v.verdict, 'needs_input', `${id} 不預勾`);
    assert.deepEqual(v.evidence, [], `${id} 沒有預勾證據`);
    assert.ok(v.groupTrace.every((g) => g.value !== true), id);
    const ask = rareAsk(v);
    assert.ok(ask, `${id} 仍問「具潛在疾病」`);
    assert.equal(ask.evidence.length, 1);
    const [e] = ask.evidence;
    assert.deepEqual({ code: e.code, label: e.label, category: e.category, broad: e.broad, shared: e.shared, otherCount: e.otherCount },
      { code: 'Q8789', label: '腦肋小頜症候群 等 10 種(公告碼)', category: 'rare', broad: true, shared: true, otherCount: 9 });
    assert.match(e.note, /以證明為準/);
  }
  const res = run(adult(['Q8789']), AT);
  assert.equal(res.ask.find((a) => a.key === 'fluUnderlyingCondition').evidence[0].code, 'Q8789', '頂層 ask 也帶證據');
  // 醫師確認「是」→ 可打;「否」→ 不可打
  assert.equal(V(run(adult(['Q8789'], { manual: { fluUnderlyingCondition: true } }), AT), 'FLU').verdict, 'eligible');
  assert.notEqual(V(run(adult(['Q8789'], { manual: { fluUnderlyingCondition: false } }), AT), 'FLU').verdict, 'eligible');
  assert.equal(rareAsk(V(run(adult(['Q8789'], { manual: { fluUnderlyingCondition: false } }), AT), 'FLU')), undefined);
});

test('罕見疾病:寬泛碼 + 非寬泛碼 —— 預勾,證據非寬泛在前、寬泛碼在後並標 broad;填報碼只依非寬泛碼', () => {
  const v = V(run(adult(['Q8789', 'Q8711']), AT), 'FLU');   // Q87.89 較新,仍排在 Q87.11 之後
  assert.equal(v.verdict, 'eligible');
  const ev = grpOf(v, 'FLU_UNDERLYING').evidence;
  assert.deepEqual(ev.map((e) => [e.code, e.broad]), [['Q8711', false], ['Q8789', true]]);
  assert.deepEqual(v.report.primary.map((o) => o.code), ['F06B']);
  assert.deepEqual(v.report.primary[0].icd, ['Q8711'], '依據 ICD 不含寬泛碼');
});

test('罕見疾病:寬泛碼 + 高風險慢性病 —— 由慢性病預勾,不誤填 F06B;寬泛碼仍列出', () => {
  const v = V(run(adult(['Q8789', 'E1165']), AT), 'FLU');
  assert.equal(v.verdict, 'eligible');
  const codes = [...v.report.primary, ...v.report.others].map((o) => o.code);
  assert.ok(codes.includes('F06A') && !codes.includes('F06B'), codes.join());
  const ev = grpOf(v, 'FLU_UNDERLYING').evidence;
  assert.deepEqual(ev.map((e) => e.code), ['E1165', 'Q8789']);
  assert.equal(ev[1].broad, true);
  assert.equal(ev[0].broad, undefined, '慢性病證據沒有 broad 欄位(結構不變)');
});

test('罕見疾病:不接進肺鏈 IPD(疾管署定義不得擴張)', () => {
  const pn = rules().vaccines.find((x) => x.vaccineId === 'PNEUMO_PCV20_21');
  assert.ok(!/RARE_DISEASE/.test(JSON.stringify(pn)), '肺鏈規則不引用罕見疾病清單');
  for (const dx of [['Q8711'], ['Q8789'], ['E7119']]) {
    const base = V(run(patient({ birth: '1971-01-01', vacc: [] }), AT), 'PNEUMO_PCV20_21');
    const got = V(run(adult(dx, { birth: '1971-01-01' }), AT), 'PNEUMO_PCV20_21');
    assert.equal(got.verdict, base.verdict, dx.join());
    assert.deepEqual(got.decisiveManual.map((m) => m.key), base.decisiveManual.map((m) => m.key));
    assert.deepEqual(got.matchedGroups.map((g) => g.groupId), base.matchedGroups.map((g) => g.groupId));
  }
});

// v0.4.8 曾排除的 7 個通用碼:YC 2026-09-29 核可列入寬泛清單 → 只顯示、不預勾(E78.00 高膽固醇血症門診極常見)
test('通用碼(v0.4.8 排除,現列寬泛):只顯示不預勾,證據標寬泛碼', () => {
  for (const [c, name] of [['E7800', '豆固醇血症(植物性)'], ['E7801', '同合子家族性高膽固醇血症'], ['E161', '持續性幼兒型胰島素過度分泌低血糖症'], ['E230', 'Kallmann 氏症候群'],
    ['E2749', '腎上腺皮促素抗性'], ['K831', '進行性家族性肝內膽汁滯留症'], ['D698', '史托摩根症候群']]) {
    const v = V(run(adult([c]), AT), 'FLU');
    assert.equal(v.verdict, 'needs_input', `${c} 不預勾`);
    const [e] = rareAsk(v).evidence;
    assert.deepEqual([e.category, e.broad], ['rare', true], c);
    assert.ok(e.label.startsWith(name), `${c} 病名 ${e.label}`);
  }
  assert.equal(rareAsk(V(run(adult(['E7800']), AT), 'COVID')).evidence[0].label, '豆固醇血症(植物性)');   // E78.00 只對到 A8-03
  assert.equal(V(run(adult(['K5289']), AT), 'FLU').verdict, 'needs_input');
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

test('流感潛在疾病:列出所有命中的 ICD(去重、最近在前)', () => {
  const at = '2026-10-05';
  const v = V(run(patient({ birth: '1986-01-01', vacc: [], dx: [['E1165', '2026-06-01'], ['E1165', '2026-03-01'], ['J449', '2026-08-01'], ['I10', '2026-08-01']] }), at), 'FLU');
  assert.equal(v.verdict, 'eligible');
  const why = v.evidence[0].why.join('|');
  assert.match(why, /J449\(2026-08-01\)、E1165\(2026-06-01\)/, '兩碼都列出,最近在前,同碼合併取最近');
  assert.ok(!/I10/.test(why), '單純高血壓不在附件1,不列');
  const hit = v.evidence[0].hits.find((h) => h.ref === 'FLU_CHRONIC_DX');
  assert.deepEqual(hit.codes.map((c) => c.code), ['J449', 'E1165']);
});

test('流感 NIIS 接種對象別代碼(工作手冊附件14)', () => {
  const at = '2026-10-05';
  const R = (p) => V(run(patient({ vacc: [], ...p }), at), 'FLU').report;
  // 65 歲以上 → F03A,附 F03B 提示與職業別提醒
  const e = R({ birth: '1958-01-01' });
  assert.deepEqual(e.primary.map((o) => o.code), ['F03A']);
  assert.match(e.primary[0].note, /F03B/);
  assert.ok(e.hint);
  // 慢性病證據 → F06A,附 ICD
  const dm = R({ birth: '1986-01-01', dx: [['E1165', '2026-06-01']] });
  assert.deepEqual(dm.primary.map((o) => o.code), ['F06A']);
  assert.deepEqual(dm.primary[0].icd, ['E1165']);
  // 同時慢性病 + 重大傷病 → F06A 為主,F06C 列為亦符合
  const both = R({ birth: '1986-01-01', dx: [['E1165', '2026-06-01'], ['C50911', '2026-03-01']] });
  assert.equal(both.primary[0].code, 'F06A');
  assert.ok(both.others.some((o) => o.code === 'F06C'));
  // 只有重大傷病 → F06C;只有罕病 → F06B
  assert.equal(R({ birth: '1986-01-01', dx: [['C50911', '2026-03-01']] }).primary[0].code, 'F06C');
  assert.equal(R({ birth: '1996-01-01', dx: [['Q8711', '2026-04-01']] }).primary[0].code, 'F06B');
  // 醫師手動勾潛在疾病(無病歷證據,如 BMI≥30)→ F06A/F06B/F06C 擇一
  const m = R({ birth: '1986-01-01', manual: { fluUnderlyingCondition: true } });
  assert.equal(m.choose, true);
  assert.deepEqual(m.primary.map((o) => o.code), ['F06A', 'F06B', 'F06C']);
  // 職業別優先:68 歲醫事人員 → F07A/B/C 擇一,F03A 列為亦符合,不再出職業別提醒
  const hcw = R({ birth: '1958-01-01', manual: { healthcareWorker: true } });
  assert.deepEqual(hcw.primary.map((o) => o.code), ['F07A', 'F07B', 'F07C']);
  assert.ok(hcw.others.some((o) => o.code === 'F03A'));
  assert.equal(hcw.hint, null);
  // 未開打前(scheduled)也給代碼
  assert.equal(V(run(patient({ birth: '1958-01-01', vacc: [] }), '2026-09-28'), 'FLU').report.primary[0].code, 'F03A');
  // 不符合者不給
  assert.equal(V(run(patient({ birth: '1996-01-01', vacc: [] }), at), 'FLU').report, null);
  // 肺鏈、COVID 無代碼表 → null
  assert.equal(V(run(patient({ birth: '1958-01-01', vacc: [] }), at), 'PNEUMO_PCV20_21').report, null);
});

test('命中 ICD 只列 3 碼(YC 2026-09-28),多的以「等 N 碼」表示', () => {
  const dx = [['E1165', '2026-06-01'], ['J449', '2026-08-01'], ['I509', '2026-07-01'], ['G20', '2026-05-01']];
  const v = V(run(patient({ birth: '1986-01-01', vacc: [], dx }), '2026-10-05'), 'FLU');
  const w = v.evidence[0].why.find((x) => /附件1/.test(x));
  assert.match(w, /J449\(2026-08-01\)、I509\(2026-07-01\)、E1165\(2026-06-01\) 等 4 碼$/);
  assert.ok(!/G20/.test(w));
});

// ---------- v0.4.23 診斷證據(面板判定依據下列出命中診斷;純顯示層)----------

test('診斷證據:跨類別依規則樹順序(慢性病 → 重大傷病 → 罕見疾病),同類別日期新到舊', () => {
  // E1165 附件1 慢性病;C73 甲狀腺癌(重大傷病長期);E75.00 罕見(僅在罕病清單)
  const dx = [['E75.00', '2026-09-01'], ['C73', '2026-08-01'], ['E1165', '2026-03-01'], ['J449', '2026-07-01']];
  const v = V(run(patient({ birth: '1986-01-01', vacc: [], dx }), '2026-10-05'), 'FLU');
  const ev = grpOf(v, 'FLU_UNDERLYING').evidence;
  assert.deepEqual(ev.map((e) => e.code), ['J449', 'E1165', 'C73', 'E75.00'], '慢性病(新→舊)→ 重大傷病 → 罕見');
  assert.deepEqual(ev.map((e) => e.category), ['chronic', 'chronic', 'catastrophic', 'rare']);
});

test('診斷證據:同碼多次就診去重,count 與 lastDate 正確;欄位齊全', () => {
  const dx = [['E1165', '2026-03-01'], ['E1165', '2026-06-01'], ['E1165', '2025-12-01']];
  const v = V(run(patient({ birth: '1986-01-01', vacc: [], dx }), '2026-10-05'), 'FLU');
  const ev = grpOf(v, 'FLU_UNDERLYING').evidence;
  assert.equal(ev.length, 1);
  assert.equal(ev[0].count, 3);
  assert.equal(ev[0].lastDate, '2026-06-01');
  assert.equal(ev[0].code, 'E1165');
  assert.ok(ev[0].label, '清單有中文名稱');
  assert.equal(ev[0].category, 'chronic');
});

test('診斷證據:重大傷病帶有效期別與推估註記;一年內只在時效內命中', () => {
  const v = V(run(patient({ birth: '1986-01-01', vacc: [], dx: [['C73', '2026-08-01']] }), '2026-10-05'), 'FLU');
  const [e] = grpOf(v, 'FLU_UNDERLYING').evidence;
  assert.equal(e.category, 'catastrophic');
  assert.equal(e.validity, '長期');
  assert.match(e.note, /推估.*以證明為準/);
  const v2 = V(run(patient({ birth: '1986-01-01', vacc: [], dx: [['T31.20', '2026-05-01']] }), '2026-10-05'), 'FLU');
  assert.equal(grpOf(v2, 'FLU_UNDERLYING').evidence[0].validity, '一年');
});

test('診斷證據:清單沒有名稱 → label 為空、只有代碼(不外補);非診斷命中(醫師勾選)不帶證據', () => {
  const rs = structuredClone(rules());
  rs.codeLists.FLU_CHRONIC_DX.names = rs.codeLists.FLU_CHRONIC_DX.names.map(() => '');
  const v = V(run(patient({ birth: '1986-01-01', vacc: [], dx: [['E1165', '2026-06-01']] }), '2026-10-05', rs), 'FLU');
  assert.equal(grpOf(v, 'FLU_UNDERLYING').evidence[0].label, '');
  const m = V(run(patient({ birth: '1986-01-01', vacc: [], manual: { fluUnderlyingCondition: true } }), '2026-10-05'), 'FLU');
  assert.deepEqual(grpOf(m, 'FLU_UNDERLYING').evidence, []);
});

test('診斷證據:零命中、unknown(用藥資料未取得)不帶證據;判定結果不變', () => {
  const none = V(run(patient({ birth: '1986-01-01', vacc: [], dx: [['I10', '2026-06-01']] }), '2026-10-05'), 'FLU');
  assert.ok(none.groupTrace.every((g) => g.evidence.length === 0));
  const unk = V(run(patient({ birth: '1986-01-01', vacc: [], dx: [['E1165', '2026-06-01']], sources: { medication: 'error' } }), '2026-10-05'), 'FLU');
  assert.ok(unk.groupTrace.every((g) => g.evidence.length === 0), 'unknown 不顯示證據');
});

test('診斷證據:通用機制 — 肺鏈 IPD、COVID 也帶證據;IPD 惡性腫瘤(+抗癌藥)命中', () => {
  const p = patient({ birth: '1970-01-01', vacc: [], dx: [['C50.911', '2026-05-01'], ['C50.911', '2026-06-01']], meds: [['L01XX01', '2026-08-01']] });
  const res = run(p, '2026-10-05');
  const ipd = V(res, 'PNEUMO_PCV20_21');
  const ev = ipd.groupTrace.flatMap((g) => g.evidence);
  assert.ok(ev.some((e) => /^C50/.test(e.code) && e.count === 2), 'IPD 群帶惡性腫瘤證據');
  assert.ok(V(res, 'COVID').groupTrace.flatMap((g) => g.evidence).length > 0, 'COVID 群也帶');
});

test('診斷證據:不影響判定(證據移除後 verdict、劑次同)', async () => {
  const { legacyHash } = await import('./snapshot-util.mjs');
  const a = V(run(patient({ birth: '1986-01-01', vacc: [], dx: [['E1165', '2026-06-01'], ['E1165', '2026-05-01']] }), '2026-10-05'), 'FLU');
  const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'evidence' && Array.isArray(x) && x.every((e) => e.count) ? undefined : x)));
  assert.equal(legacyHash(a), legacyHash(strip(a)));
});
