// v0.4.12 保底/升級與面板四組(§9)。固定 asOf,情境見 display-cases.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { patient, run, V, rules } from './helpers.mjs';
import { CASES, AT, FLU_PHASE1_KEYS } from './display-cases.mjs';
import { legacyHash, summary } from './snapshot-util.mjs';
import { computeDisplay, BUCKETS } from '../src/engine/display.js';

const C = (name, id) => V(run(patient(CASES[name].p), CASES[name].asOf), id);
const keys = (v) => v.decisiveManual.map((m) => m.key);

// ---------------- 流感(115 年度)55 歲,潛在疾病未確認,NIIS 已查、本季未接種 ----------------
test('流感 55 歲 9/28 → 尚未開打:保底 11/2、升級 10/1(選填,不列入待確認清單)', () => {
  const v = C('flu55_0928', 'FLU');
  assert.equal(v.display.bucket, 'not_open');
  assert.deepEqual([v.display.fallback.kind, v.display.fallback.date, v.display.fallback.groupId], ['phase', '2026-11-02', 'FLU_ADULT_50_64']);
  assert.deepEqual([v.display.upgrade.kind, v.display.upgrade.date, v.display.upgrade.decisive], ['phase', '2026-10-01', false]);
  assert.equal(v.display.upgrade.label, '第一階段');
  assert.ok(v.display.upgrade.requires.includes('fluUnderlyingCondition'));
  assert.deepEqual(keys(v), [], '3b 不問');
});

test('流感 55 歲 10/15 → 待確認(3a):保底 11/2、升級今天;第一階段條件全列、列入待確認清單', () => {
  const res = run(patient(CASES.flu55_1015.p), AT);
  const v = V(res, 'FLU');
  assert.equal(v.verdict, 'scheduled', 'verdict 維持 v0.4.10');
  assert.equal(v.display.bucket, 'confirm');
  assert.equal(v.display.step, '3a');
  assert.deepEqual([v.display.fallback.kind, v.display.fallback.date], ['phase', '2026-11-02']);
  assert.equal(v.display.fallback.phase, '第二階段');
  assert.deepEqual([v.display.upgrade.date, v.display.upgrade.decisive], [AT, true]);
  assert.deepEqual([...v.display.upgrade.requires].sort(), [...FLU_PHASE1_KEYS].sort());
  assert.deepEqual([...keys(v)].sort(), [...FLU_PHASE1_KEYS].sort());
  assert.ok(res.ask.some((a) => a.key === 'fluUnderlyingCondition' && a.vaccines.includes('FLU')), '面板待確認清單(ask)');
  assert.equal(v.display.upgrade.items.find((i) => i.key === 'fluUnderlyingCondition').label.startsWith('具潛在疾病'), true);
});

test('流感 55 歲 10/15 勾潛在疾病 = 是 → 可接種', () => {
  const v = C('flu55_1015_yes', 'FLU');
  assert.equal(v.display.bucket, 'eligible');
  assert.equal(v.display.upgrade, null);
  assert.deepEqual(keys(v), []);
});

test('流感 55 歲 10/15 勾潛在疾病 = 否 → 仍待確認,剩其他 6 項第一階段條件', () => {
  const v = C('flu55_1015_no', 'FLU');
  assert.equal(v.display.bucket, 'confirm');
  assert.deepEqual([...v.display.upgrade.requires].sort(), FLU_PHASE1_KEYS.filter((k) => k !== 'fluUnderlyingCondition').sort());
});

test('流感 55 歲 10/15 第一階段條件全部勾否(以上皆否)→ 尚未開打,upgrade = null', () => {
  const v = C('flu55_1015_allno', 'FLU');
  assert.equal(v.display.bucket, 'not_open');
  assert.equal(v.display.upgrade, null);
  assert.deepEqual([v.display.fallback.kind, v.display.fallback.date], ['phase', '2026-11-02']);
  assert.deepEqual(keys(v), []);
});

test('流感 55 歲 11/3 → 可接種,不列潛在疾病', () => {
  const v = C('flu55_1103', 'FLU');
  assert.equal(v.display.bucket, 'eligible');
  assert.deepEqual(keys(v), []);
  assert.equal(v.display.upgrade, null);
});

test('流感 70 歲 10/15 → 可接種,不列任何人工條件', () => {
  const res = run(patient(CASES.flu70_1015.p), AT);
  const v = V(res, 'FLU');
  assert.equal(v.display.bucket, 'eligible');
  assert.deepEqual(keys(v), []);
  assert.ok(!res.ask.some((a) => a.vaccines.includes('FLU')));
});

test('流感 55 歲 10/15 接種史未查 → 待確認(保底 11/2 劑次未定,升級今天)', () => {
  const v = V(run(patient({ birth: CASES.flu55_1015.p.birth }), AT), 'FLU');
  assert.equal(v.display.bucket, 'confirm');
  assert.equal(v.display.fallback.doseUnknown, true);
  assert.equal(v.display.upgrade.decisive, true);
});

test('流感 70 歲 10/15 接種史未查 → 待確認(待查接種史),不問第一階段其他條件', () => {
  const v = V(run(patient({ birth: CASES.flu70_1015.p.birth }), AT), 'FLU');
  assert.equal(v.verdict, 'pending_history');
  assert.equal(v.display.bucket, 'confirm');
  assert.equal(v.display.upgrade, null);
  assert.deepEqual(keys(v), []);
});

// ---------------- 肺鏈(asOf 2026-10-15,70 歲,NIIS 已查)----------------
const P = (name) => C(name, 'PNEUMO_PCV20_21');

test('肺鏈 僅 PCV13 14 個月前 → 可接種,不問 IPD', () => {
  const v = P('pn_pcv13_14m');
  assert.equal(v.display.bucket, 'eligible');
  assert.equal(v.dosing.case.id, 'C_PCV_ONLY');
  assert.deepEqual(keys(v), []);
  assert.equal(v.dosing.upgrade, null);
});

test('肺鏈 僅 PCV13 10 週前 → 待確認:升級今天(8 週)、保底 PCV13 + 1 年', () => {
  const v = P('pn_pcv13_10w');
  assert.equal(v.display.bucket, 'confirm');
  assert.deepEqual([v.display.fallback.kind, v.display.fallback.date, v.display.fallback.caseId], ['dose', '2027-08-06', 'C_PCV_ONLY']);
  assert.deepEqual([v.display.upgrade.kind, v.display.upgrade.date, v.display.upgrade.caseId, v.display.upgrade.decisive], ['dose', AT, 'C_PCV_ONLY_8WK', true]);
  assert.ok(keys(v).includes('ipdHighRisk'));
  assert.deepEqual([v.dosing.fallback.caseId, v.dosing.fallback.status, v.dosing.upgrade.caseId, v.dosing.upgrade.status], ['C_PCV_ONLY', 'wait', 'C_PCV_ONLY_8WK', 'due']);
  assert.ok(v.dosing.alternative, 'alternative 保留');
});

test('肺鏈 僅 PCV13 3 週前 → 尚未開打:保底 +1 年、升級 +56 天(選填,不問)', () => {
  const v = P('pn_pcv13_3w');
  assert.equal(v.display.bucket, 'not_open');
  assert.equal(v.display.fallback.date, '2027-09-24');
  assert.deepEqual([v.display.upgrade.date, v.display.upgrade.decisive], ['2026-11-19', false]);
  assert.deepEqual(keys(v), []);
});

test('肺鏈 僅 PCV13 3 週前 + 透析旗標(病歷預勾)→ 尚未開打,+56 天,無升級提示', () => {
  const v = P('pn_pcv13_3w_dialysis');
  assert.equal(v.display.bucket, 'not_open');
  assert.deepEqual([v.display.fallback.date, v.display.fallback.caseId], ['2026-11-19', 'C_PCV_ONLY_8WK']);
  assert.equal(v.display.upgrade, null);
});

test('肺鏈 僅 PPV23 10 週前、IPD 已確認 → 尚未開打,+1 年(Rule B 不縮短)', () => {
  const v = P('pn_ppv23_10w_ipd');
  assert.equal(v.display.bucket, 'not_open');
  assert.deepEqual([v.display.fallback.date, v.display.fallback.caseId], ['2027-08-06', 'B_PPV_ONLY']);
  assert.equal(v.display.upgrade, null);
});

test('肺鏈 PCV13 + PPV23 最後一劑 6 年前 → 待確認:目前視為已完成,若確認 IPD 今天可追加', () => {
  const v = P('pn_pcv_ppv_6y');
  assert.equal(v.display.bucket, 'confirm');
  assert.equal(v.display.fallback.kind, 'completed');
  assert.deepEqual([v.display.upgrade.caseId, v.display.upgrade.date, v.display.upgrade.dose, v.display.upgrade.decisive], ['E_IPD_65_BOOST', AT, 1, true]);
  assert.deepEqual(keys(v), ['ipdHighRisk']);
});

test('肺鏈 PCV13 + PPV23 最後一劑 3 年前 → 已接種(已完成),選填提示 +5 年起可追加', () => {
  const v = P('pn_pcv_ppv_3y');
  assert.equal(v.display.bucket, 'done');
  assert.equal(v.display.fallback.kind, 'completed');
  assert.deepEqual([v.display.upgrade.date, v.display.upgrade.decisive], ['2028-10-15', false]);
  assert.deepEqual(keys(v), []);
});

// ---------------- 已接種(v0.4.26):流感接種史的季 = 10/1 ~ 隔年 9/30 ----------------
const FLU = (vacc, asOf, birth = '1955-05-05') => V(run(patient({ birth, vacc }), asOf), 'FLU');

test('流感 10/1 前接種(8 月、9/30)算上一季 → 10/1 起仍可接種', () => {
  for (const d of ['2026-08-20', '2026-09-30']) {
    const v = FLU([['FLU', d]], '2026-10-05');
    assert.equal(v.verdict, 'eligible', d);
    assert.equal(v.display.bucket, 'eligible', d);
  }
});

test('流感 10/1 起接種 → 已接種(10/1 當天也算本季)', () => {
  for (const [d, asOf] of [['2026-10-01', '2026-10-05'], ['2026-11-02', '2027-01-15']]) {
    const v = FLU([['FLU', d]], asOf);
    assert.equal(v.verdict, 'completed', d);
    assert.equal(v.display.bucket, 'done', d);
  }
});

test('流感 公費期間(6/30)後到隔年 9/30 → 本季有紀錄者仍是已接種;期間內的 8 月紀錄也算本季', () => {
  for (const [d, asOf] of [['2026-11-02', '2027-06-30'], ['2026-11-02', '2027-07-01'], ['2026-11-02', '2027-09-30'], ['2027-08-10', '2027-08-15']]) {
    const v = FLU([['FLU', d]], asOf);
    assert.equal(v.verdict, 'completed', `${d} @ ${asOf}`);
    assert.equal(v.display.bucket, 'done', `${d} @ ${asOf}`);
    assert.equal(v.dosing.lastDate, d);
  }
  const late = FLU([['FLU', '2026-11-02']], '2027-07-15');
  assert.deepEqual([late.display.step, late.display.fallback, late.display.upgrade], ['3d', null, null]);
  assert.match(late.explanation, /本季已完成/);
});

test('流感 隔年 10/1 之後、或公費期間後沒紀錄(NIIS 已查)→ 視為沒接種:非公費期間,不符合', () => {
  for (const [vacc, asOf] of [[[], '2027-07-15'], [[['FLU', '2025-11-02']], '2027-07-15'], [[['FLU', '2026-11-02']], '2027-10-01']]) {
    const v = FLU(vacc, asOf);
    assert.equal(v.verdict, 'out_of_season', asOf);
    assert.equal(v.display.bucket, 'ineligible', asOf);
  }
});

test('流感 NIIS 已查、本季無紀錄 → 視為沒接種(可接種);去年的紀錄不算本季', () => {
  for (const vacc of [[], [['FLU', '2025-10-20']]]) {
    const v = FLU(vacc, '2026-11-05');
    assert.equal(v.verdict, 'eligible');
    assert.equal(v.display.bucket, 'eligible');
  }
});

test('不再公費(自費 PPV23 + 公費 PCV13)→ 仍歸不符合,不進已接種', () => {
  const v = V(run(patient({ birth: '1955-05-05', vacc: [['PPV23', '2020-01-01', '自費'], ['PCV13', '2024-01-01', '公費']] }), AT), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'not_funded');
  assert.equal(v.display.bucket, 'ineligible');
});

test('肺鏈 PCV20 公費已完整接種 → 已接種', () => {
  const v = V(run(patient({ birth: '1955-05-05', vacc: [['PCV20', '2025-03-01', '公費']] }), AT), 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'completed');
  assert.equal(v.display.bucket, 'done');
});

// ---------------- 回歸:既有欄位與 v0.4.10 相同 ----------------
test('回歸:§9 情境與示範病患的 Result 既有欄位與 v0.4.10 相同;decisiveManual 只依 §5 變動', () => {
  const snap = JSON.parse(fs.readFileSync(new URL('./fixtures/v0410-results.json', import.meta.url), 'utf8'));
  const changed = [];
  for (const [name, c] of Object.entries(snap.cases)) {
    const r = run(c.facts, c.asOf);
    assert.deepEqual({ ruleSetVersion: r.ruleSetVersion, jurisdiction: r.jurisdiction, asOf: r.asOf }, c.top, name);
    assert.deepEqual(r.vaccines.map((v) => v.vaccineId), Object.keys(c.vaccines), `${name}:疫苗順序維持規則原始順序`);
    for (const v of r.vaccines) {
      const old = c.vaccines[v.vaccineId];
      const now = summary(v);
      assert.equal(legacyHash(v), old.hash, `${name} ${v.vaccineId}:既有欄位與 v0.4.10 不同(現 ${JSON.stringify(now)};舊 ${JSON.stringify(old)})`);
      assert.ok(BUCKETS.includes(v.display.bucket), `${name} ${v.vaccineId}:bucket`);
      const expect = v.display.step === '3a' ? v.display.upgrade.manual : v.display.bucket === 'confirm' ? old.ask : [];
      assert.deepEqual(now.ask, expect, `${name} ${v.vaccineId}:decisiveManual`);
      if (v.display.bucket === 'eligible') assert.ok(v.verdict === 'eligible' && v.dosing?.status === 'due', `${name} ${v.vaccineId}:可接種必須今日可打`);
      if (JSON.stringify(now.ask) !== JSON.stringify(old.ask)) changed.push(name);
    }
  }
  assert.ok(changed.includes('flu55_1015') && changed.includes('pn_pcv13_3w') && changed.includes('pn_pcv_ppv_3y'), '§5 刻意變更有生效');
});

// ---------------- 未涵蓋 verdict ----------------
test('未涵蓋的 verdict → 待確認,不歸入可接種', () => {
  const vctx = { facts: patient({ birth: '1956-03-02', vacc: [] }), rules: rules(), asOf: AT, manualDefs: {}, vaccine: { eligibilityGroups: [] } };
  for (const verdict of ['something_new', undefined, 'eligible']) {
    const d = computeDisplay(vctx.vaccine, vctx, [], { verdict, dosing: null });
    assert.equal(d.bucket, 'confirm', String(verdict));
  }
});

test('禁忌(absolute)→ 不符合,保留「禁忌」verdict,不列升級', () => {
  const v = V(run(patient({ birth: '1956-03-02', vacc: [], manual: { severeAllergyToVaccine: true } }), AT), 'FLU');
  assert.equal(v.verdict, 'contraindicated');
  assert.equal(v.display.bucket, 'ineligible');
  assert.equal(v.display.upgrade, null);
});

test('季末已過 → 不符合', () => {
  const v = V(run(patient({ birth: '1956-03-02', vacc: [] }), '2027-07-01'), 'FLU');
  assert.equal(v.verdict, 'out_of_season');
  assert.equal(v.display.bucket, 'ineligible');
});
