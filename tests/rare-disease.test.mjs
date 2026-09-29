// 罕見疾病名單(115-07-23)解析與清理(v0.4.24):由歸檔的 pdftotext -raw 文字檔重產,不需要 pdftotext / PDF 即可跑
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../scripts/lib/rules.mjs';
import { generate, FILES, PDF_SHA256 } from '../scripts/build-rare-disease.mjs';
import { splitPages, detectPageNumberGlue, restoreGlued, isValidCode, buildRareDisease, BROAD_CODES, splitRow, splitNames } from '../scripts/lib/rare-disease.mjs';

const raw = fs.readFileSync(FILES.raw, 'utf8');
const doc = JSON.parse(fs.readFileSync(FILES.json, 'utf8'));
const codes = new Map(doc.sections.rare.codes.map((c) => [c.code, c]));
const disease = (serial) => doc.diseases.find((d) => d.serial === serial);

// YC 2026-09-29 列的 22 個頁碼黏碼案例:[黏碼, 還原]
const GLUED_CASES = [
  ['E76.2194', 'E76.219'], ['H49.8195', 'H49.819'], ['E27.4913', 'E27.49'], ['Q87.1915', 'Q87.19'], ['E71.5406', 'E71.540'], ['E72.2321', 'E72.23'],
  ['E84.922', 'E84.9'], ['D84.124', 'D84.1'], ['I27.025', 'I27.0'], ['E75.428', 'E75.4'], ['G23.029', 'G23.0'], ['Q75.431', 'Q75.4'],
  ['E71.52819', 'E71.528'], ['G71.034926', 'G71.0349'], ['E76.0227', 'E76.02'], ['G71.1330', 'G71.13'], ['D82.412', 'D82.4'], ['L74.47', 'L74.4'],
  ['Q85.838', 'Q85.83'], ['Q87.214', 'Q87.2'], ['G71.03810', 'G71.038'], ['M61.17511', 'M61.175'],
];
// 同一機制、YC 清單沒列到(長度未超標所以不易發現):E71.2+頁碼 2、E72.11+頁碼 3、E78.71+20、M61.175+23
const GLUED_EXTRA = [['E71.22', 'E71.2'], ['E72.113', 'E72.11'], ['E78.7120', 'E78.71'], ['M61.17523', 'M61.175']];

test('疾病總數 249;序號連續,24 類', () => {
  assert.equal(doc.diseaseCount, 249);
  assert.equal(doc.diseases.length, 249);
  const cats = [...new Set(doc.diseases.map((d) => d.serial.split('-')[0]))];
  assert.equal(cats.length, 24);
  for (const c of cats) {
    const ns = doc.diseases.filter((d) => d.serial.startsWith(`${c}-`)).map((d) => Number(d.serial.split('-')[1]));
    assert.deepEqual(ns, ns.map((_, i) => i + 1), `${c} 序號不連續`);
  }
  for (const d of doc.diseases) { assert.equal(d.category, 'rare'); assert.ok(d.zh && d.en && d.codes.length, d.serial); }
});

test('所有碼符合 ICD-10-CM 格式,去點後 ≤ 7 碼;無重複、無黏碼', () => {
  const all = doc.diseases.flatMap((d) => d.codes);
  for (const c of all) assert.ok(isValidCode(c), c);
  for (const d of doc.diseases) assert.equal(new Set(d.codes).size, d.codes.length, `${d.serial} 內碼重複`);
  assert.equal(new Set(all).size, doc.sections.rare.codes.length, '碼登記表 = 不重複碼');
  assert.equal(doc.sections.rare.count, doc.sections.rare.codes.length);
  // 格式檢查本身
  for (const bad of ['E76.2194X', 'G71.034926', 'E71.52819', 'M61.17511', 'e11.9', 'E11.', '1E11']) assert.ok(!isValidCode(bad), bad);
});

test('頁碼黏碼:22 個已知案例逐一還原(黏碼可重現、可還原、結果內只有還原後的碼)', () => {
  assert.equal(GLUED_CASES.length, 22);
  const glue = detectPageNumberGlue(raw);
  for (const [glued, restored] of [...GLUED_CASES, ...GLUED_EXTRA]) {
    const g = glue.find((x) => x.glued === glued);
    assert.ok(g, `頁尾碼 + 下一頁頁碼應能重現 ${glued}`);
    assert.equal(g.code, restored, `${glued} 應為 ${restored} + 頁碼 ${g.page + 1}`);
    assert.equal(restoreGlued(glued, g.page + 1), restored);
    assert.ok(codes.has(restored), `${restored} 應在名單內`);
    assert.ok(!codes.has(glued) && !doc.diseases.some((d) => d.codes.includes(glued)), `${glued} 不可出現在名單`);
  }
  assert.equal(glue.length, GLUED_CASES.length + GLUED_EXTRA.length, '頁尾以碼結尾者共 26 處,全部已還原');
  assert.deepEqual(doc.cleaning.pageNumberGlue.map((g) => g.gluedAs).sort(), glue.map((g) => g.glued).sort(), 'JSON 內稽核紀錄');
});

test('頁碼黏碼:無法還原就失敗,不猜', () => {
  assert.equal(restoreGlued('E76.2194', 4), 'E76.219');
  assert.equal(restoreGlued('G71.034926', 26), 'G71.0349');
  assert.throws(() => restoreGlued('E76.2194', 5), /無法還原/);              // 後綴不是該頁碼
  assert.throws(() => restoreGlued('E76.2194', 2194), /無法還原|格式/);
  assert.throws(() => restoreGlued('E76', 76), /格式/);                      // 去掉後綴後不是碼
  // 每頁第一行必須是頁碼,否則整份解析失敗
  assert.throws(() => splitPages('1\nE11.9\n\f3\nE10.9\n'), /第 2 頁第一行不是頁碼/);
});

test('兩表交叉核對:只有 A4-02、H1-05 不一致;A4-02 採 E74.04 不採 E74.4;H1-05 取聯集', () => {
  assert.deepEqual(doc.cleaning.tableMismatches.map((m) => m.serial), ['A4-02', 'H1-05']);
  const [a, h] = doc.cleaning.tableMismatches;
  assert.deepEqual([a.classifiedOnly, a.alphabeticalOnly], [['E74.04'], ['E74.4']]);
  assert.match(a.resolution, /覆寫.*E74\.4/);
  assert.deepEqual([h.classifiedOnly, h.alphabeticalOnly, h.resolution], [['M61.122', 'M61.129'], [], '取聯集']);
  // A4-02 肝醣儲積症:E74.04(第五型)、E74.01(第一型,兩表都有)在;E74.4 不屬於它
  assert.ok(disease('A4-02').codes.includes('E74.04') && disease('A4-02').codes.includes('E74.01'));
  assert.ok(!disease('A4-02').codes.includes('E74.4'));
  // E74.4 仍因 A6-06 丙酮酸鹽脫氫酶缺乏症(兩表皆列)而在名單內;規格「E74.4 不存在」只適用於肝醣儲積症
  assert.deepEqual(codes.get('E74.4').diseases, ['A6-06']);
  assert.ok(codes.has('E74.04') && codes.has('E74.01'));
  // 進行性骨化性肌炎:M61.122、M61.129 在(字母表漏列)
  assert.ok(disease('H1-05').codes.includes('M61.122') && disease('H1-05').codes.includes('M61.129'));
  assert.ok(codes.has('M61.122') && codes.has('M61.129'));
});

test('兩表不一致的覆寫過時會失敗(不默默沿用)', () => {
  const tweaked = raw.replace('E74.4:Type Ⅴ', 'E74.04:Type Ⅴ');   // 字母表改成與分類表一致 → A4-02 不再有不一致
  assert.notEqual(tweaked, raw);
  assert.throws(() => buildRareDisease(tweaked), /覆寫已過時|覆寫沒有對應/);
});

test('組合碼「+」拆開;E74.31 單獨不納入並註記原因;斜線拆兩碼', () => {
  assert.deepEqual(doc.cleaning.combos.map((c) => [c.serial, ...c.parts]), [['A2-15', 'E74.31', 'E70.0'], ['A2-23', 'E71.120', 'E72.11']]);
  assert.ok(!codes.has('E74.31') && !doc.diseases.some((d) => d.codes.includes('E74.31')), 'E74.31 不單獨出現');
  assert.deepEqual(disease('A2-15').codes, ['E70.0']);
  assert.ok(codes.has('E70.0') && codes.get('E70.0').diseases.includes('A2-05'), 'E70.0 已在清單(A2-05 苯酮尿症)');
  const ex = doc.excluded.find((e) => e.code === 'E74.31');
  assert.ok(ex && ex.diseases.includes('A2-15') && /E70\.0/.test(ex.reason));
  assert.deepEqual(doc.excluded.map((e) => e.code), ['E74.31'], '只有 E74.31 排除');
  assert.deepEqual(disease('A2-23').codes.sort(), ['E71.120', 'E72.11']);
  // 斜線 G35/G36.0
  assert.deepEqual(doc.cleaning.slash.map((s) => [s.serial, ...s.parts]), [['B1-01', 'G35', 'G36.0']]);
  assert.deepEqual(disease('B1-01').codes.sort(), ['G35', 'G36.0']);
  assert.ok(!codes.has('G35/G36.0'));
});

test('備註裡的舊碼一律不用', () => {
  for (const c of ['G40.311', 'G37.8', 'E25.0', 'G12.9', 'M31.1', 'G12.2', 'E72.8', 'E74.8', 'F78', 'Q87.1', 'G12.20-']) assert.ok(!codes.has(c), c);
});

test('共用碼:Q87.89→10、Q87.0→9、Q87.19→7、Q89.8→4;diseases 依序號排序;shared/otherCount 一致', () => {
  assert.equal(codes.get('Q87.89').diseases.length, 10);
  assert.equal(codes.get('Q87.0').diseases.length, 9);
  assert.equal(codes.get('Q87.19').diseases.length, 7);
  assert.equal(codes.get('Q89.8').diseases.length, 4);
  const order = doc.diseases.map((d) => d.serial);
  for (const c of doc.sections.rare.codes) {
    assert.deepEqual(c.diseases, [...c.diseases].sort((a, b) => order.indexOf(a) - order.indexOf(b)), `${c.code} diseases 未依序號排序`);
    assert.equal(!!c.shared, c.diseases.length > 1, `${c.code} shared`);
    assert.equal(c.otherCount ?? 0, c.diseases.length > 1 ? c.diseases.length - 1 : 0, `${c.code} otherCount`);
    assert.equal(c.zh, disease(c.diseases[0]).zh, `${c.code} 名稱 = 序號最前的病名`);
    for (const s of c.diseases) assert.ok(disease(s).codes.includes(c.code), `${c.code} ↔ ${s}`);
  }
  assert.equal(codes.get('Q87.89').zh, '腦肋小頜症候群', '第一個病名(H1-11)');
  assert.equal(codes.get('Q87.89').otherCount, 9);
});

test('寬泛碼:清單完全等於規格的 27 碼,且都在名單內;JSON 頂層可供審核', () => {
  const expected = ['F84.8', 'K52.89', 'G71.8', 'G71.9', 'E72.9', 'E70.9', 'E72.89', 'D81.9', 'E79.8', 'E79.9', 'G11.8', 'G11.9', 'E34.8', 'H35.50',
    'Q87.0', 'Q87.19', 'Q87.2', 'Q87.89', 'Q89.8', 'Q82.8', 'Q79.8', 'Q74.8', 'Q28.8', 'Q43.8', 'Q80.8', 'E77.8', 'G31.89'];
  assert.equal(expected.length, 27);
  assert.deepEqual(BROAD_CODES, expected);
  assert.deepEqual(doc.broadCodes, expected);
  assert.deepEqual(doc.sections.rare.codes.filter((c) => c.broad).map((c) => c.code).sort(), [...expected].sort());
});

test('已知內容抽查(對照 v0.4.8 手工轉錄:324 碼全數在內,另含當時排除的通用碼 9 個)', () => {
  assert.equal(doc.sections.rare.codes.length, 333);
  for (const [serial, c] of [['A1-01', 'E72.20'], ['A3-04', 'E75.249'], ['A3-09', 'E76.3'], ['B1-32', 'F78.A9'], ['H1-03', 'M88.9'], ['G1-09', 'G71.0341'], ['N1-03', 'H35.50']]) {
    assert.ok(disease(serial).codes.includes(c), `${serial} ${c}`);
  }
  for (const c of ['E78.00', 'E78.01', 'E16.1', 'E23.0', 'E27.49', 'K83.1', 'K52.89', 'D69.8', 'Q82.8']) assert.ok(codes.has(c), `${c}(v0.4.8 排除,v0.4.24 改為納入;通用度以寬泛碼處理)`);
  assert.equal(disease('A8-03').codes.join(), 'E78.00,E78.01', '垂直置中的多碼儲存格歸屬正確(-layout 會錯歸給 A8-02)');
  assert.equal(disease('A8-02').codes.join(), 'E78.3');
});

test('名稱切分:兩格併成一行、標籤行、(又稱 …)', () => {
  assert.equal(disease('A1-04').zh, '鳥胺酸氨甲醯基轉移酶缺乏症');
  assert.equal(disease('A1-04').en, 'Ornithine transcarbamylase deficiency');
  assert.equal(disease('B1-04').en, "Huntington disease (又稱 Huntington's chorea)");
  assert.equal(disease('A3-09').en, 'Mucopolysaccharidoses', '「Type …」標籤行屬碼儲存格');
  assert.equal(disease('A3-02').en, 'GM1/GM2 gangliosidosis');
  assert.equal(disease('A2-23').en, 'Cobalamin C defect (Methylmalonic acidemia and Homocystinuria, cb1C type)');
  assert.deepEqual(splitRow(['乏症 Ornithine deficiency E72.4']).head, ['乏症 Ornithine deficiency']);
  assert.deepEqual(splitNames(['甲乙丙 Foo bar']), { zh: '甲乙丙', en: 'Foo bar' });
});

test('可重跑:由歸檔文字檔重產的 JSON 與已提交的逐字相同', () => {
  const { text, result } = generate(raw);
  assert.equal(text, fs.readFileSync(FILES.json, 'utf8'));
  assert.equal(result.diseases.length, 249);
});

test('來源:PDF 雜湊與 JSON 記載相符;有 pdftotext 時 -raw 輸出與歸檔文字檔一致', (t) => {
  const pdf = fs.readFileSync(FILES.pdf);
  assert.equal(crypto.createHash('sha256').update(pdf).digest('hex'), PDF_SHA256);
  assert.equal(doc.sourceSha256, PDF_SHA256);
  let out;
  try { out = execFileSync('pdftotext', ['-raw', FILES.pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return t.skip('沒有 pdftotext'); }
  assert.equal(out, raw);
});
