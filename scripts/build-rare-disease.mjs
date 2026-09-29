// 罕見疾病名單 PDF → rules/codelists/rare-disease.hpa-1150723.json(可重跑,不手打)。
//   node scripts/build-rare-disease.mjs            用已歸檔的 -raw 文字檔重產 JSON
//   node scripts/build-rare-disease.mjs --from-pdf 先用 pdftotext 由歸檔 PDF 重產文字檔(-raw 供解析、-layout 供人讀),再重產 JSON
//   node scripts/build-rare-disease.mjs --check    只檢查:重產的 JSON 與已提交的相同才通過(CI/測試用)
// 解析邏輯與說明見 scripts/lib/rare-disease.mjs。兩表不一致、頁碼黏碼、無法還原的碼都會在輸出列出;無法還原就失敗,不猜。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildRareDisease, BROAD_CODES } from './lib/rare-disease.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SRC = path.join(ROOT, 'sources', 'hpa');
const BASE = '2026-07_hpa-rare-disease-icd-1150723';
export const FILES = { pdf: path.join(SRC, `${BASE}.pdf`), layout: path.join(SRC, `${BASE}.txt`), raw: path.join(SRC, `${BASE}.raw.txt`),
  json: path.join(ROOT, 'rules', 'codelists', 'rare-disease.hpa-1150723.json') };
export const PDF_SHA256 = '3406bda4aec53f768a1ffa19007a8cb17b7edbf87cb5973ac8588769f755d9ae';

const META = {
  id: 'HPA_RARE_DISEASE_ICD_1150723',
  title: '公告罕見疾病名單暨ICD-10-CM編碼一覽表(依疾病分類排序為主表,依英文字母排序交叉核對)',
  issuer: '衛生福利部(國民健康署)',
  icdVersion: 'ICD-10-CM 2023年版',
  announced: '2026-07-23',
  announcementNo: '衛授國字第1150461436號(115-07-23,含 106-10-25 起歷次公告)',
  sourceSha256: PDF_SHA256,
  fetchedAt: '2026-09-27',
  archivedAt: '2026-09-29',
  receivedFrom: 'YC 提供 PDF(Dropbox 3.Project.YuLi/20260916.疫苗施打檢核/115年疫苗接種須知);歸檔於 sources/hpa/',
  note: '罕見疾病以健保卡註記或證明為準,本表診斷碼僅作病歷證據推估(醫師可取消)。本檔由 scripts/build-rare-disease.mjs 自 PDF 產生(pdftotext -raw),請勿手改;要改請改腳本或來源。'
    + '主表 249 項(24 類,序號連續),以字母表交叉核對,兩表不一致取聯集(cleaning.tableMismatches)。碼的比對形式與其他清單相同(完整碼,病歷碼被截短時前綴相符)。'
    + '共用碼(同一碼對到多種疾病)標 shared,證據列顯示「第一個病名 等 N 種(公告碼)」,N = diseases 數;otherCount = N−1。'
    + 'broadCodes 為寬泛碼(YC 核可清單:初版 27 碼 + v0.4.8 曾排除的 7 個通用碼):命中只顯示、不參與人工條件預勾,證據列標「寬泛碼,需核對」。excluded 所列碼不納入,理由見各項。',
};

/** 小型序列化:頂層與物件逐鍵展開,物件陣列一項一行 → diff 好讀 */
function fmt(v, depth) {
  const pad = ' '.repeat(depth + 1); const end = ' '.repeat(depth);
  if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return `[\n${v.map((x) => pad + JSON.stringify(x)).join(',\n')}\n${end}]`;
  if (v && typeof v === 'object' && !Array.isArray(v)) return `{\n${Object.entries(v).map(([k, x]) => `${pad}${JSON.stringify(k)}: ${fmt(x, depth + 1)}`).join(',\n')}\n${end}}`;
  return JSON.stringify(v);
}

export function generate(rawText) {
  const r = buildRareDisease(rawText);
  if (r.diseases.length !== 249) throw new Error(`疾病總數 ${r.diseases.length} ≠ 249`);
  const doc = {
    ...META,
    diseaseCount: r.diseases.length,
    generatedBy: 'scripts/build-rare-disease.mjs',
    broadCodes: BROAD_CODES,
    excluded: r.excluded,
    cleaning: r.cleaning,
    diseases: r.diseases,
    sections: { rare: { label: '罕見疾病(國健署公告名單)', count: r.codes.length, codes: r.codes } },
  };
  return { text: `${fmt(doc, 0)}\n`, result: r };
}

function pdftotext(mode) {
  const args = mode === 'layout' ? ['-layout'] : ['-raw'];
  return execFileSync('pdftotext', [...args, FILES.pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--from-pdf')) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(FILES.pdf)).digest('hex');
    if (sha !== PDF_SHA256) throw new Error(`歸檔 PDF 的 sha256 不符:${sha}`);
    fs.writeFileSync(FILES.raw, pdftotext('raw'));
    fs.writeFileSync(FILES.layout, pdftotext('layout'));
    console.log('已由 PDF 重產文字檔(-raw、-layout)');
  }
  const { text, result } = generate(fs.readFileSync(FILES.raw, 'utf8'));
  const c = result.cleaning;
  console.log(`疾病 ${result.diseases.length} 項;不重複碼 ${result.codes.length};共用碼 ${result.codes.filter((x) => x.shared).length};寬泛碼 ${result.codes.filter((x) => x.broad).length}`);
  console.log(`頁碼黏碼(頁尾碼+下一頁頁碼,已還原)${c.pageNumberGlue.length} 處:${c.pageNumberGlue.map((g) => `${g.gluedAs}→${g.code}`).join('、')}`);
  console.log(`兩表不一致 ${c.tableMismatches.length} 處:`);
  for (const m of c.tableMismatches) console.log(`  ${m.serial} ${m.zh}:分類表獨有 [${m.classifiedOnly}] / 字母表獨有 [${m.alphabeticalOnly}] → ${m.resolution}`);
  console.log(`組合碼(+)${c.combos.map((x) => `${x.serial} ${x.parts.join('+')}`).join('、')};斜線 ${c.slash.map((x) => `${x.serial} ${x.parts.join('/')}`).join('、')};排除 ${result.excluded.map((x) => x.code).join('、')}`);
  console.log('無法還原的碼:0(有則腳本已失敗)');
  if (args.has('--check')) {
    const cur = fs.existsSync(FILES.json) ? fs.readFileSync(FILES.json, 'utf8') : '';
    if (cur !== text) { console.error(`${path.relative(ROOT, FILES.json)} 與重產結果不同;請執行 node scripts/build-rare-disease.mjs`); process.exit(1); }
    console.log('OK:JSON 與重產結果相同');
    return;
  }
  fs.writeFileSync(FILES.json, text);
  console.log(`已寫入 ${path.relative(ROOT, FILES.json)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
