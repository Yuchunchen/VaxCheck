// 幼童肺炎鏈球菌高危險群 ICD 清單 → rules/codelists/pcv13-child-highrisk.cdc.json(v0.4.28)
// 來源:sources/pneumo/2025-03_pcv13-child-highrisk-icd.(ods|tsv)(主表)、2016-04_…-malignancy.(ods|tsv)(惡性腫瘤 = 重大傷病類別 01)
// 主表只有約 60 列且多為 3 碼類目,逐列轉錄在 TABLE(每列記原表 ICD-10 欄文字 src,腳本核對該文字確實出現在 TSV);
// 惡性腫瘤 1,444 列由 TSV 機械轉換(加小數點、去重、一律前綴比對)。偏離原表之處寫在 deviation,並進 JSON 的 deviations,供 YC 核對。
// 用法:node scripts/build-pcv13-child-codelist.mjs        → 寫檔
//       node scripts/build-pcv13-child-codelist.mjs --check → 與已提交 JSON 比對(tests 用)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_MAIN = 'sources/pneumo/2025-03_pcv13-child-highrisk-icd';
const SRC_MALIG = 'sources/pneumo/2016-04_pcv13-child-highrisk-icd-malignancy';
export const OUT = 'rules/codelists/pcv13-child-highrisk.cdc.json';

// code:清單碼(3 碼類目在 vaccines.yaml 以 threeCharAsCategory 展開;4 碼以上需涵蓋 2023 版細碼者用 * 前綴或區間)
const TABLE = {
  spleen: {
    label: '一、脾臟功能缺損',
    rows: [
      { zh: '脾臟異常', en: 'Anomalies of spleen', src: 'Q89', code: 'Q89.0*',
        deviation: '原表 Q89 為整個類目,含 Q89.1 腎上腺、Q89.2 其他內分泌腺、Q89.3 內臟逆位、Q89.4 連體、Q89.7–Q89.9 等非脾臟畸形;依病名(ICD-9 759.0 脾臟異常)收斂為 Q89.0*(Q89.01 無脾、Q89.09 其他脾臟先天畸形)' },
      { zh: '鐮刀狀紅血球貧血', en: 'Sickle-cell anemia', src: 'D57', code: 'D57' },
      { zh: '地中海型貧血', en: 'Thalassemias', src: 'D56', code: 'D56', note: '含 D56.3 輕型地中海型貧血(原表類目;成人 IPD 表 1140310 亦列)' },
    ],
  },
  immune: {
    label: '二、先天或後天免疫功能不全(包括愛滋病毒感染者)',
    rows: [
      { zh: '體液免疫缺乏症', en: 'Deficiency of humoral immunity', src: 'D80', code: 'D80' },
      { zh: '細胞性免疫缺乏症', en: 'Deficiency of cell-mediated immunity', src: 'D83-82', code: 'D82-D83', deviation: '原表寫「D83-82」,依區間寫法改為 D82-D83' },
      { zh: '複合性免疫力缺乏症', en: 'Combined immunity deficiency', src: 'D81', code: 'D81' },
      { zh: '未明示之免疫疾病', en: 'Unspecified disorder of immune mechanism', src: 'D89', code: 'D89' },
      { zh: '人類免疫不全病毒感染疾病', en: 'Human immunodeficiency virus (HIV) infection disease', src: 'B20', code: 'B20' },
      { zh: '特定情況之第二型人類免疫不全病毒感染', en: 'HIV-2 infections in conditions classified elsewhere and of unspecified site', src: 'B97.35', code: 'B97.35' },
      { zh: '再生不良性貧血', en: 'Aplastic anemia', src: 'D60-61,D46', code: 'D60' },
      { zh: '再生不良性貧血', en: 'Aplastic anemia', src: 'D60-61,D46', code: 'D61' },
      { zh: '骨髓化生不良症候群', en: 'Myelodysplastic syndromes', src: 'D60-61,D46', code: 'D46', note: '原表與再生不良性貧血同列(D60-61,D46)' },
    ],
  },
  chronic: {
    label: '四、慢性疾病(慢性腎病變含腎病症候群、先天發紺性心臟病含心臟衰竭、慢性肺臟病〔氣喘除外〕、糖尿病)',
    rows: [
      { zh: '腎徵候群', en: 'Nephrotic syndrome', src: 'N04', code: 'N04' },
      { zh: '慢性絲球腎炎', en: 'Chronic glomerulonephritis', src: 'N03,N08', code: 'N03' },
      { zh: '慢性絲球腎炎', en: 'Chronic glomerulonephritis', src: 'N03,N08', code: 'N08' },
      { zh: '慢性腎衰竭', en: 'Chronic renal failure', src: 'N18', code: 'N18' },
      { zh: '腎衰竭,未明示者', en: 'Renal failure, unspecified', src: 'N19', code: 'N19' },
      { zh: '高血壓性腎臟病', en: 'Hypertensive renal disease', src: 'I12', code: 'I12' },
      { zh: '高血壓性心臟及腎臟病', en: 'Hypertensive heart and renal disease', src: 'I13', code: 'I13', note: '原表 4 列(含惡性、良性、未明示)皆為 I13' },
      { zh: '共同動脈幹、大血管轉位、共同單一心室、兩腔心', en: 'Common truncus; transposition of great vessels; common ventricle; cor biloculare', src: 'Q20', code: 'Q20', note: '原表 4 列皆為 Q20' },
      { zh: '法洛氏四合症', en: 'Tetralogy of fallot', src: 'Q21.3', code: 'Q21.3*' },
      { zh: '心內膜墊缺陷', en: 'Endocardial cushion defects', src: 'Q21.2', code: 'Q21.2*' },
      { zh: '主動脈縮窄', en: 'Coarctation of aorta', src: 'Q25.1', code: 'Q25.1*' },
      { zh: '主動脈弓畸形', en: 'Anomalies of aortic arch', src: 'Q25.2', code: 'Q25.2*' },
      { zh: '主動脈閉鎖及狹窄、其他主動脈畸形', en: 'Atresia and stenosis of aorta; other anomalies of aorta', src: 'Q25.4', code: 'Q25.4*',
        deviation: '原表「其他之主動脈畸形」「其他主動脈畸形」兩列寫 Q25(整個類目,含 Q25.0 開放性動脈導管等非發紺性畸形);依病名(ICD-9 747.2/747.29 其他主動脈畸形)收斂為 Q25.4*,與「主動脈閉鎖及狹窄」(原表 Q25.4)同碼' },
      { zh: '肺動脈畸形', en: 'Anomalies of pulmonary artery', src: 'Q25.5-25.7', code: 'Q25.5-Q25.7', deviation: '原表寫「Q25.5-25.7」,補上字母為 Q25.5-Q25.7' },
      { zh: '大靜脈畸形', en: 'Anomalies of great veins', src: 'Q26.9', code: 'Q26.9' },
      { zh: '心臟衰竭', en: 'Heart failure', src: 'I50', code: 'I50' },
      { zh: '周產期引起之慢性呼吸性疾病', en: 'Chronic respiratory disease arising in the perinatal period', src: 'P27', code: 'P27' },
      { zh: '支氣管擴張症', en: 'Bronchiectasis', src: 'J47', code: 'J47' },
      { zh: '糖尿病', en: 'Diabetes mellitus', src: 'E08-E11,E13', code: 'E08-E11' },
      { zh: '糖尿病', en: 'Diabetes mellitus', src: 'E08-E11,E13', code: 'E13' },
    ],
  },
  csf_leak: {
    label: '五、腦脊髓液滲漏',
    rows: [
      { zh: '腦脊髓液滲漏', en: 'Cerebrospinal fluid leak', src: 'G96.0', code: 'G96.0*', note: '2023 版細分 G96.00–G96.09' },
    ],
  },
  transplant: {
    label: '六(二)、器官移植',
    rows: [
      { zh: '器官或組織之移植術後', en: 'Organ or tissue replaced by transplant', src: 'Z94', code: 'Z94' },
      { zh: '腎臟移植術後', en: 'Kidney replaced by transplant', src: 'Z94.0', code: 'Z94.0' },
      { zh: '心臟移植術後', en: 'Heart replaced by transplant', src: 'Z94.1', code: 'Z94.1' },
      { zh: '肺臟移植術後', en: 'Lung replaced by transplant', src: 'Z94.2', code: 'Z94.2' },
      { zh: '肝臟移植術後', en: 'Liver replaced by transplant', src: 'Z94.4', code: 'Z94.4' },
      { zh: '其他特定器官或組織移植術後', en: 'Other specified organ or tissue replaced by transplant', src: 'Z94.89', code: 'Z94.89' },
      { zh: '未明示之器官或組織之移植術後', en: 'Unspecified organ or tissue replaced by transplant', src: 'Z94.9', code: 'Z94.9' },
      { zh: '心臟瓣膜移植術後', en: 'Heart valve replaced by transplant', src: 'Z95', code: 'Z95.3',
        deviation: '原表 Z95 為整個類目(含 Z95.0 心律調節器、Z95.1 冠狀動脈繞道、Z95.5 冠狀動脈支架等非移植植入物);依病名(心臟瓣膜移植)收斂為 Z95.3 異種心臟瓣膜、Z95.4 其他心臟瓣膜置換' },
      { zh: '心臟瓣膜移植術後', en: 'Heart valve replaced by transplant', src: 'Z95', code: 'Z95.4' },
    ],
  },
};
// 原表「三、人工耳植入者」只列 ICD-10-PCS 處置碼(健保雲端診斷資料不含處置碼)→ 本清單不收;vaccines.yaml 以成人 IPD 表(1140310)的人工耳診斷碼代替
const NOT_TRANSCRIBED = [
  { section: '三、人工耳植入者', reason: '原表只列 ICD-10-PCS 處置碼(09HD…、09PD…,含 O9HD… 筆誤),健保雲端診斷資料無處置碼;證據改用成人 IPD 參考表 1140310 的人工耳診斷碼(IPD_COCHLEAR_DX)' },
  { section: '六(一)、惡性腫瘤', reason: '原表寫「參照重大傷病對照表(類別1:惡性腫瘤)」→ 見 malignancy 段(另一試算表)' },
];

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
const dotted = (c) => (c.length > 3 ? `${c.slice(0, 3)}.${c.slice(3)}` : c);

export function generate() {
  const mainTsv = fs.readFileSync(path.join(ROOT, `${SRC_MAIN}.tsv`), 'utf8');
  const cells = new Set(mainTsv.split('\n').flatMap((l) => l.split('\t').map((x) => x.trim())));
  const sections = {};
  const deviations = [];
  for (const [key, sec] of Object.entries(TABLE)) {
    for (const r of sec.rows) if (!cells.has(r.src)) throw new Error(`${key}:原表 ICD-10 欄找不到「${r.src}」(${r.zh})`);
    sections[key] = {
      label: sec.label,
      count: sec.rows.length,
      codes: sec.rows.map((r) => ({ code: r.code, en: r.en, zh: r.zh, src: r.src, ...(r.note && { note: r.note }) })),
    };
    for (const r of sec.rows) if (r.deviation) deviations.push({ section: key, code: r.code, src: r.src, reason: r.deviation });
  }
  // 惡性腫瘤:第 1 列標題、第 2 列欄名;欄 5 = ICD-10-CM(無小數點)、欄 7 = 中文名;去重保留第一個名稱
  const malig = fs.readFileSync(path.join(ROOT, `${SRC_MALIG}.tsv`), 'utf8').split('\n').slice(2).filter(Boolean).map((l) => l.split('\t'));
  const seen = new Map();
  for (const row of malig) {
    if (row[0] !== '01') throw new Error(`惡性腫瘤表:重大傷病類別不是 01:${row.join('|')}`);
    const c = row[4]?.trim();
    if (!/^C[0-9][0-9A-Z]{1,4}$/.test(c || '')) throw new Error(`惡性腫瘤表:ICD-10-CM 格式不符:${c}`);
    if (!seen.has(c)) seen.set(c, { code: `${dotted(c)}*`, en: row[5]?.trim() || '', zh: row[6]?.trim() || '' });   // 一律前綴:涵蓋 2023 版新增細碼(C 碼之下皆為惡性腫瘤)
  }
  sections.malignancy = { label: '六(一)、接受免疫抑制劑或放射治療的惡性腫瘤(重大傷病類別 01)', count: seen.size, rows: malig.length, codes: [...seen.values()] };
  return {
    id: 'CDC_PCV13_CHILD_HIGHRISK_ICD',
    title: '幼童肺炎鏈球菌高危險群之ICD code參考表(含惡性腫瘤分表)',
    issuer: '衛生福利部疾病管制署',
    icdVersion: '原表 ICD-10-CM 2015 年版;3 碼類目在規則中展開為其下所有細碼(含 2023 版)',
    sourceFiles: { main: `${SRC_MAIN}.ods`, malignancy: `${SRC_MALIG}.ods` },
    sourceSha256: sha(`${SRC_MAIN}.ods`),
    malignancySourceSha256: sha(`${SRC_MALIG}.ods`),
    generatedBy: 'scripts/build-pcv13-child-codelist.mjs',
    note: '供醫師評估參考:高危險群幼童請主動出具診斷書等證明文件(Q&A Q9)。病歷診斷碼只用來預勾「肺鏈高危險群幼童」,醫師可取消。惡性腫瘤須另有接受免疫抑制劑或放射治療(規則以一年內抗癌藥處方推估,同成人 IPD)。',
    deviations,
    notTranscribed: NOT_TRANSCRIBED,
    sections,
  };
}

const body = () => `${JSON.stringify(generate(), null, 1)}\n`;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(ROOT, OUT);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== body()) { console.error(`✗ ${OUT} 與腳本產生結果不同;請執行 node scripts/build-pcv13-child-codelist.mjs`); process.exit(1); }
    console.log(`✓ ${OUT} 與來源一致`);
  } else {
    fs.writeFileSync(out, body());
    const j = generate();
    console.log(`寫入 ${OUT}:${Object.entries(j.sections).map(([k, s]) => `${k} ${s.codes.length}`).join('、')};偏離原表 ${j.deviations.length} 處`);
  }
}
