// 幼童 PCV13(v0.4.28):5 歲以下幼童公費 PCV13 接種原則(105.04)、Q&A(105.04)、高危險群 ICD 參考表
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { patient, run, V } from './helpers.mjs';
import { ROOT } from '../scripts/lib/rules.mjs';
import { generate, OUT } from '../scripts/build-pcv13-child-codelist.mjs';

const AT = '2026-11-04';
const P = (p, at = AT) => V(run(patient(p), at), 'PCV13_CHILD');
const caseOf = (v) => v.dosing?.case?.id || null;

test('幼童 PCV13 清單:已提交 JSON 與腳本自原表產生的結果相同;偏離原表 5 處', () => {
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, OUT), 'utf8'));
  assert.deepEqual(committed, generate());
  assert.deepEqual(committed.deviations.map((d) => d.code), ['Q89.0*', 'D82-D83', 'Q25.4*', 'Q25.5-Q25.7', 'Z95.3']);
  assert.equal(committed.sections.malignancy.codes.length, 1135);
  assert.ok(committed.sections.malignancy.codes.every((c) => /^C.*\*$/.test(c.code)));
});

// ---------------- 對象:出生滿 2 個月至未滿 5 歲 ----------------
test('對象:未滿 2 個月、滿 5 歲 → 不符合;成人不受影響', () => {
  assert.equal(P({ birth: '2026-09-05', vacc: [] }).verdict, 'ineligible');            // 1 個月 30 天
  assert.equal(P({ birth: '2026-09-04', vacc: [] }).verdict, 'eligible');              // 滿 2 個月當天
  assert.equal(P({ birth: '2021-11-04', vacc: [] }).verdict, 'ineligible');            // 滿 5 歲當天
  assert.equal(P({ birth: '2021-11-05', vacc: [] }).verdict, 'eligible');              // 未滿 5 歲最後一天
  const adult = P({ birth: '1958-03-02', vacc: [] });
  assert.equal(adult.verdict, 'ineligible');
  assert.equal(adult.display.bucket, 'ineligible');
  assert.deepEqual(adult.decisiveManual, []);
});

test('接種史未查 → 待查接種史;缺接種日期 → 人工(劑次依接種月齡)', () => {
  assert.equal(P({ birth: '2023-06-15' }).verdict, 'pending_history');
  const v = P({ birth: '2023-06-15', vacc: [['PCV13', null]] });
  assert.equal(v.verdict, 'needs_review');
  assert.match(v.dosing.note, /接種日期不明/);
});

test('曾接種 PCV13 以外之結合型疫苗(PCV15 等)→ 人工', () => {
  const v = P({ birth: '2023-06-15', vacc: [['PCV15', '2023-08-15']] });
  assert.equal(v.verdict, 'needs_review');
  assert.equal(caseOf(v), 'PC_OTHER_PCV');
});

// ---------------- 1 歲以下 ----------------
test('1 歲以下:0 劑 → 今日第 1 劑;1 劑 → 與前劑 8 週;第 1 劑於滿 7 個月以後 → 4 週', () => {
  const naive = P({ birth: '2026-09-01', vacc: [] });
  assert.deepEqual([naive.verdict, caseOf(naive), naive.dosing.dose], ['eligible', 'PC_INF_NAIVE', 1]);
  const one = P({ birth: '2026-08-01', vacc: [['PCV13', '2026-10-01']] });
  assert.deepEqual([one.verdict, caseOf(one), one.dosing.dose, one.dosing.earliestDate], ['wait', 'PC_INF_1', 2, '2026-11-26']);
  const late = P({ birth: '2026-01-01', vacc: [['PCV13', '2026-09-28']] });     // 第 1 劑於 8 個月 27 天
  assert.deepEqual([late.verdict, caseOf(late), late.dosing.status], ['eligible', 'PC_INF_1_LATE', 'due']);   // 4 週 = 10/26 已過(8 週要到 11/23)
});

test('1 歲以下已接種 2 劑:追加劑等到滿 12 個月;是否高危險群決定今天能否打第 3 劑(待確認)', () => {
  const base = { birth: '2026-03-01', vacc: [['PCV13', '2026-05-01'], ['PCV13', '2026-07-01']] };
  const v = P(base);
  assert.equal(v.display.bucket, 'confirm');
  assert.equal(v.display.step, '3a');
  assert.deepEqual(v.decisiveManual.map((m) => m.key), ['pcvChildHighRisk']);
  assert.deepEqual([v.display.fallback.caseId, v.display.fallback.date], ['PC_INF_BOOSTER', '2027-03-01']);   // 滿 12 個月
  const no = P({ ...base, manual: { pcvChildHighRisk: false } });
  assert.deepEqual([no.verdict, caseOf(no), no.dosing.dose, no.dosing.earliestDate], ['wait', 'PC_INF_BOOSTER', 3, '2027-03-01']);
  const yes = P({ ...base, manual: { pcvChildHighRisk: true } });
  assert.deepEqual([yes.verdict, caseOf(yes), yes.dosing.dose], ['eligible', 'PC_HR_INF_3RD_PRIMARY', 3]);
});

// ---------------- 滿 1 歲–未滿 2 歲 ----------------
test('1–2 歲:0 劑、1 歲前 1 劑、1 歲前 2–3 劑、已完成', () => {
  assert.equal(caseOf(P({ birth: '2025-05-01', vacc: [] })), 'PC_TOD_NAIVE');
  const b1 = P({ birth: '2025-08-01', vacc: [['PCV13', '2025-10-01']] });
  assert.deepEqual([caseOf(b1), b1.dosing.dose, b1.verdict], ['PC_TOD_B1', 2, 'eligible']);
  const b1m1 = P({ birth: '2025-06-01', vacc: [['PCV13', '2025-08-01'], ['PCV13', '2026-07-01']] });
  assert.deepEqual([caseOf(b1m1), b1m1.dosing.dose, b1m1.verdict], ['PC_TOD_B1_M1', 3, 'eligible']);
  const b0m1 = P({ birth: '2025-06-01', vacc: [['PCV13', '2026-07-01']] });
  assert.deepEqual([caseOf(b0m1), b0m1.dosing.dose], ['PC_TOD_B0_M1', 2]);
  const b2 = P({ birth: '2025-10-01', vacc: [['PCV13', '2025-12-01'], ['PCV13', '2026-02-01']] });
  assert.deepEqual([caseOf(b2), b2.dosing.dose, b2.verdict], ['PC_TOD_B2', 3, 'eligible']);
  const done = P({ birth: '2025-06-01', vacc: [['PCV13', '2025-08-01'], ['PCV13', '2025-10-01'], ['PCV13', '2026-06-05']], manual: { pcvChildHighRisk: false } });
  assert.deepEqual([done.verdict, caseOf(done), done.display.bucket], ['completed', 'PC_TOD_DONE', 'done']);
});

test('接種月齡邊界:滿 12 個月當天算「1 歲以後」,前一天算「1 歲前」', () => {
  // 生日 2025-08-10;第 2 劑在 2026-08-09(11 個月)vs 2026-08-10(12 個月);今日 2026-11-04(1 歲 2 個月)
  const before = P({ birth: '2025-08-10', vacc: [['PCV13', '2025-10-10'], ['PCV13', '2026-08-09']], manual: { pcvChildHighRisk: false } });
  assert.equal(caseOf(before), 'PC_TOD_B2');                 // 1 歲前 2 劑 → 再 1 劑
  const after = P({ birth: '2025-08-10', vacc: [['PCV13', '2025-10-10'], ['PCV13', '2026-08-10']], manual: { pcvChildHighRisk: false } });
  assert.equal(caseOf(after), 'PC_TOD_B1_M1');               // 1 歲前 1 劑 + 1 歲後 1 劑 → 再 1 劑
});

// ---------------- 滿 2 歲–未滿 5 歲 ----------------
test('2–5 歲:1 歲以後未曾接種 → 1 劑;2 歲以後已接種 1 劑 → 完成;表未列 → 人工', () => {
  const naive = P({ birth: '2023-06-15', vacc: [] });
  assert.deepEqual([naive.verdict, caseOf(naive), naive.dosing.dose], ['eligible', 'PC_PRE_NONE_AFTER1', 1]);
  const b2 = P({ birth: '2023-06-15', vacc: [['PCV13', '2023-08-15'], ['PCV13', '2023-10-15']] });
  assert.deepEqual([caseOf(b2), b2.dosing.dose], ['PC_PRE_NONE_AFTER1', 3]);
  const after2 = P({ birth: '2023-06-15', vacc: [['PCV13', '2025-12-20']], manual: { pcvChildHighRisk: false } });
  assert.deepEqual([after2.verdict, caseOf(after2)], ['completed', 'PC_PRE_AFTER2']);
  const b1m1 = P({ birth: '2023-06-15', vacc: [['PCV13', '2023-08-15'], ['PCV13', '2024-08-01']] });
  assert.deepEqual([caseOf(b1m1), b1m1.dosing.dose], ['PC_PRE_B1_M1', 3]);
  const unlisted = P({ birth: '2023-06-15', vacc: [['PCV13', '2024-08-01']] });
  assert.deepEqual([unlisted.verdict, caseOf(unlisted)], ['needs_review', 'PC_PRE_B0_M1']);
});

test('2–5 歲高危險群:第 1 劑於滿 12 個月以後只打 1 劑 → 確認後今日第 2 劑;從未接種 → 說明 2 劑', () => {
  const v = P({ birth: '2023-06-15', vacc: [['PCV13', '2025-12-20']] });
  assert.equal(v.display.bucket, 'confirm');
  assert.deepEqual(v.decisiveManual.map((m) => m.key), ['pcvChildHighRisk']);
  assert.equal(v.display.fallback.kind, 'completed');
  const yes = P({ birth: '2023-06-15', vacc: [['PCV13', '2025-12-20']], manual: { pcvChildHighRisk: true } });
  assert.deepEqual([yes.verdict, caseOf(yes), yes.dosing.dose], ['eligible', 'PC_HR_LATE_START_2ND', 2]);
  const naiveHr = P({ birth: '2023-06-15', dx: [['D571', '2026-01-01']], vacc: [] });   // 鐮刀型貧血 → 預勾
  assert.deepEqual([naiveHr.verdict, caseOf(naiveHr)], ['eligible', 'PC_HR_NAIVE_2Y']);
  assert.match(naiveHr.dosing.case.note, /2 劑/);
});

test('常規 3 劑完成的 1–5 歲:未確認高危險群 → 待確認(高危險群應 4 劑,補種原則未明示 → 人工);否 → 已接種', () => {
  const vacc = [['PCV13', '2023-08-15'], ['PCV13', '2023-10-15'], ['PCV13', '2024-06-20']];
  const v = P({ birth: '2023-06-15', vacc });
  assert.equal(v.display.bucket, 'confirm');
  assert.equal(v.display.upgrade.caseId, 'PC_HR_MISSED_PRIMARY');
  assert.equal(P({ birth: '2023-06-15', vacc, manual: { pcvChildHighRisk: true } }).verdict, 'needs_review');
  const no = P({ birth: '2023-06-15', vacc, manual: { pcvChildHighRisk: false } });
  assert.deepEqual([no.verdict, caseOf(no), no.display.bucket], ['completed', 'PC_PRE_DONE', 'done']);
});

// ---------------- 高危險群證據(預勾) ----------------
test('高危險群證據:表列碼預勾;偏離原表收斂的碼不預勾(仍會詢問)', () => {
  const base = { birth: '2026-03-01', vacc: [['PCV13', '2026-05-01'], ['PCV13', '2026-07-01']] };   // 8 個月、2 劑:高危險群才今日可打
  // 預勾 → 今日可打第 3 劑(eligible);未預勾 → 待確認(needs_input,pending 的 case 才是高危險群)
  const hr = (dx, meds = []) => P({ ...base, dx: dx.map((c) => [c, '2026-09-01']), meds }).verdict;
  for (const code of ['N049', 'Q8901', 'D561', 'D8100', 'Q213', 'Q2541', 'Q256', 'G9600', 'Z940', 'Z954', 'P271', 'E1010', 'Z45321'])
    assert.equal(hr([code]), 'eligible', `${code} 應預勾高危險群`);
  for (const code of ['Q893', 'Q250', 'Z950', 'J4520', 'I10'])           // 內臟逆位、開放性動脈導管、心律調節器、氣喘、單純高血壓
    assert.equal(hr([code]), 'needs_input', `${code} 不應預勾`);
  assert.equal(hr(['C910']), 'needs_input', '惡性腫瘤無一年內抗癌藥 → 不預勾');
  assert.equal(hr(['C9100'], [['L01BB02', '2026-09-15']]), 'eligible', '惡性腫瘤 + 抗癌藥 → 預勾');
});
