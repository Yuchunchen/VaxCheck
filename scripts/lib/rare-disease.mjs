// 國健署公告罕見疾病名單暨 ICD-10-CM 編碼一覽表(115-07-23)→ 結構化資料。純函式,不碰檔案、不呼叫 pdftotext(由 build-rare-disease.mjs 負責)。
//
// 輸入:`pdftotext -raw` 的輸出(內容串流順序)。為何不用 -layout:主表儲存格垂直置中,多碼儲存格的碼會落在相鄰兩列之間
// (例:A8-02 與 A8-03 之間的 E78.00),-layout 只能靠列間空白猜歸屬;-raw 則是 Word 逐格輸出的順序,每列的中文名、英文名、碼各自連續。
//
// 頁碼黏碼(E76.219 + 下一頁頁碼 4 → E76.2194):-raw 每頁第一行是該頁頁碼,頁面串接後就黏在上一頁最後一個碼後面。
// 本檔逐頁處理:每頁第一行必須等於頁碼並丟棄,不會產生黏碼;detectPageNumberGlue() 另外重現「串接後的黏碼」並驗證可還原,作為稽核紀錄。
// 兩表交叉核對只在兩表不一致時列出、取聯集;無法解析或不符 ICD-10-CM 格式的碼一律丟錯,不猜。

export const CODE_TOKEN = /(?<![A-Za-z0-9.])([A-Z]\d{2}(?:\.[0-9A-Z]{1,4})?)(?![A-Za-z0-9])/g;
const CODE_FORMAT = /^[A-Z]\d{2}(?:\.[0-9A-Z]{1,4})?$/;
/** ICD-10-CM:3 碼類目 + 選擇性小數點與最多 4 碼;去掉小數點最長 7 碼 */
export const isValidCode = (c) => CODE_FORMAT.test(c) && c.replace('.', '').length <= 7;

const CATS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1', 'K1', 'L1', 'M1', 'N1'];
const CJK = /[㐀-鿿豈-﫿]/;
const TITLE = /^公告罕見疾病名單暨 ?ICD-10-CM 編碼一覽表/;
const ANNOUNCE = /^中華民國\d+年\d+月\d+日衛授國字第\d+號公告$/;
const HEADER1 = /^中文病名（僅供參考） 英文病名\(縮寫\) ICD-10-CM 編碼$/;
const HEADER2 = /^英文病名\(縮寫\) 中文病名（僅供參考） ICD-10-CM 編碼$/;
const SPLIT = /^(?:分類|序|號)$/;

const codesIn = (s) => [...s.matchAll(CODE_TOKEN)].map((m) => m[1]);
const uniq = (a) => [...new Set(a)];

// ---------- 分頁 ----------
/** 每頁第一行 = 頁碼(-raw 的特性);逐頁驗證後丟棄 */
export function splitPages(raw) {
  const pages = raw.split('\f');
  if (!pages.at(-1).trim()) pages.pop();
  return pages.map((p, i) => {
    const lines = p.split('\n').map((l) => l.trimEnd());
    while (lines.length && !lines[0].trim()) lines.shift();
    if (lines[0]?.trim() !== String(i + 1)) throw new Error(`第 ${i + 1} 頁第一行不是頁碼:「${lines[0]}」`);
    return { no: i + 1, lines: lines.slice(1).map((l) => l.trim()).filter(Boolean) };
  });
}

/** 兩張表的界線:標題含「(依英文字母排序)」的那頁起為字母表 */
export function splitTables(pages) {
  const alpha = pages.findIndex((p) => p.lines.some((l) => TITLE.test(l) && l.includes('依英文字母排序')));
  if (alpha < 0) throw new Error('找不到「依英文字母排序」表');
  // 到「備註」為止(備註內有舊碼,一律不用);備註所在頁之前每頁必須恰有一列表頭
  const cut = (ps, hdr) => {
    const out = [];
    for (const p of ps) {
      const body = p.lines.filter((l) => !TITLE.test(l) && !ANNOUNCE.test(l) && !SPLIT.test(l));
      const h = body.filter((l) => hdr.test(l)).length;
      if (h !== 1) throw new Error(`第 ${p.no} 頁表頭列數 ${h} ≠ 1`);
      const note = body.findIndex((l) => /^備註[:：]/.test(l));
      out.push(...body.slice(0, note < 0 ? body.length : note).filter((l) => !hdr.test(l)).map((text) => ({ page: p.no, text })));
      if (note >= 0) return out;
    }
    throw new Error('找不到「備註」');
  };
  return { classified: cut(pages.slice(0, alpha), HEADER1), alphabetical: cut(pages.slice(alpha), HEADER2) };
}

// ---------- 頁碼黏碼 ----------
/** 重現「頁面串接」的黏碼:上一頁最後一行以碼結尾者 → 碼 + 下一頁頁碼。回傳稽核紀錄 */
export function detectPageNumberGlue(raw) {
  const pages = raw.split('\f');
  if (!pages.at(-1).trim()) pages.pop();
  const out = [];
  for (let i = 0; i + 1 < pages.length; i++) {
    const last = pages[i].split('\n').map((l) => l.trim()).filter(Boolean).at(-1) || '';
    const m = /(?<![A-Za-z0-9.])([A-Z]\d{2}(?:\.[0-9A-Z]{1,4})?)$/.exec(last);
    if (m) out.push({ page: i + 1, code: m[1], glued: `${m[1]}${i + 2}` });
  }
  return out;
}
/** 由黏碼還原:去掉下一頁頁碼後綴。不符格式就丟錯(不猜) */
export function restoreGlued(glued, nextPage) {
  const suffix = String(nextPage);
  if (!glued.endsWith(suffix)) throw new Error(`${glued} 不以頁碼 ${suffix} 結尾,無法還原`);
  const code = glued.slice(0, -suffix.length);
  if (!isValidCode(code)) throw new Error(`${glued} 還原為 ${code} 仍不符 ICD-10-CM 格式`);
  return code;
}

// ---------- 主表(依疾病分類排序) ----------
const ANCHOR = /^(?:([A-N]\d{1,2})\s+)?(\d{2})(?:\s+(.*))?$/;
const CJKISH = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;   // 中日韓字與全形標點
const joinLines = (ls) => ls.reduce((a, l) => (!a ? l : /-$/.test(a) || (CJKISH.test(a.at(-1)) && CJKISH.test(l[0])) ? a + l : `${a} ${l}`), '');

/** 名稱區:第一個含碼的行之前 + 該行碼之前的文字(儲存格在同一基線被併成一行);「Type …」標籤行與「xxx:」前綴屬碼儲存格 */
export function splitRow(lines) {
  const first = lines.findIndex((l) => codesIn(l).length);
  if (first < 0) throw new Error(`列內沒有任何碼:${lines.join(' | ')}`);
  const head = lines.slice(0, first);
  const prefix = lines[first].slice(0, lines[first].search(CODE_TOKEN)).trim();
  let label = false;
  while (head.length && /^type\s+[IVX]+[A-Z]?\b/i.test(head.at(-1))) { head.pop(); label = true; }   // 黏多醣症:「Type I Hurler's」「Type IV Other」
  if (prefix && !label && !/[:：]$/.test(prefix)) head.push(prefix);
  return { head, codes: codesIn(lines.slice(first).join('\n')) };
}

const CLOSERS = /[)）」』】、，；：。]/;   // 緊接中日韓字之後的收括號與全形標點,屬中文名
const lastCjk = (l) => { for (let j = l.length - 1; j >= 0; j--) if (CJK.test(l[j])) return j; return -1; };
/** 中文名 / 英文名:每行中文到最後一個中日韓字(含其後的收括號),其餘為英文;英文名已開始後以「(」起頭的行整行屬英文(如 Huntington 的「(又稱 …)」) */
export function splitNames(head) {
  const zh = []; const en = [];
  for (const l of head) {
    if (en.length && /^[(（]/.test(l)) { en.push(l); continue; }
    const k = lastCjk(l);
    if (k < 0) { en.push(l); continue; }   // 沒有中日韓字的行 = 英文名
    let e = k + 1; while (e < l.length && CLOSERS.test(l[e])) e++;
    zh.push(l.slice(0, e).trim());
    if (l.slice(e).trim()) en.push(l.slice(e).trim());
  }
  const dropSpaces = (t) => t.replace(/(?<=[\u3400-\u9fff)）]) (?=[\u3400-\u9fff(（])/g, '');
  return { zh: dropSpaces(joinLines(zh)), en: joinLines(en) };
}

export function parseClassified(stream) {
  const rows = [];
  let cur = null; let catIdx = -1; let stopped = false;
  for (const { text: t } of stream) {
    if (/^Z\./.test(t)) { stopped = true; continue; }
    if (stopped) throw new Error(`Z 類之後仍有內容:${t}`);
    if (/^◎/.test(t) || /^[A-N]\.\S/.test(t)) continue;   // 分類標題
    const m = ANCHOR.exec(t);
    if (m) {
      const [, cat, num, rest] = m;
      if (cat && cat === CATS[catIdx + 1] && num === '01') { catIdx++; cur = { cat, n: 1, lines: [] }; rows.push(cur); if (rest) cur.lines.push(rest); continue; }
      if (!cat && cur && Number(num) === cur.n + 1) { cur = { cat: cur.cat, n: cur.n + 1, lines: [] }; rows.push(cur); if (rest) cur.lines.push(rest); continue; }
    }
    if (!cur) throw new Error(`第一列之前有未辨識內容:${t}`);
    cur.lines.push(t);
  }
  if (!stopped) throw new Error('沒有讀到 Z 類標題(表尾)');
  return rows.map((r) => {
    const { head, codes } = splitRow(r.lines);
    const { zh, en } = splitNames(head);
    return { serial: `${r.cat}-${String(r.n).padStart(2, '0')}`, zh, en, raw: codes, lines: r.lines };
  });
}

// ---------- 字母表 ----------
const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * 以主表英文名在字母表串流中定位每個疾病的起點;起點之間即該病的儲存格內容。
 * 長名稱先佔位(病名可能是另一病名的續行,例:Homocystinuria 也出現在 Cobalamin C 病名的最後一行);
 * 已被佔位的行不再當起點,仍有 0 或 2 個以上候選就丟錯。
 */
export function parseAlphabetical(stream, diseases) {
  const lines = stream.map((l) => l.text);
  const N = lines.map(norm);
  const claimed = new Array(lines.length).fill(null);
  const starts = [];
  for (const d of [...diseases].sort((a, b) => norm(b.en).length - norm(a.en).length)) {
    const target = norm(d.en);
    if (!target) throw new Error(`${d.serial} 沒有英文名,無法在字母表定位`);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      if (claimed[i]) continue;
      let acc = '';
      for (let j = i; j < Math.min(lines.length, i + 6) && !claimed[j]; j++) {
        acc += N[j];
        if (acc.length >= target.length) { if (acc.startsWith(target)) hits.push([i, j]); break; }
      }
    }
    if (hits.length !== 1) throw new Error(`字母表定位失敗:${d.serial} ${d.en}(候選 ${hits.length} 處:${hits.map((h) => h[0]).join(',')})`);
    for (let k = hits[0][0]; k <= hits[0][1]; k++) claimed[k] = d.serial;
    starts.push({ serial: d.serial, at: hits[0][0] });
  }
  starts.sort((a, b) => a.at - b.at);
  const map = new Map();
  starts.forEach((s, i) => {
    const seg = lines.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : lines.length);
    map.set(s.serial, { text: seg.join('\n'), raw: codesIn(seg.join('\n')) });
  });
  return map;
}

// ---------- 組裝 ----------
/** 初版寬泛碼(YC 2026-09-29 固定清單;Claude Code 不得自行增減,改動需 YC 核可)。命中只顯示、不參與人工條件預勾 */
export const BROAD_CODES = ['F84.8', 'K52.89', 'G71.8', 'G71.9', 'E72.9', 'E70.9', 'E72.89', 'D81.9', 'E79.8', 'E79.9', 'G11.8', 'G11.9', 'E34.8', 'H35.50',
  'Q87.0', 'Q87.19', 'Q87.2', 'Q87.89', 'Q89.8', 'Q82.8', 'Q79.8', 'Q74.8', 'Q28.8', 'Q43.8', 'Q80.8', 'E77.8', 'G31.89'];

/** 兩表不一致時的人工決定(YC 2026-09-29);決定只針對列出的碼,其餘不一致一律取聯集 */
export const TABLE_OVERRIDES = {
  'A4-02': { drop: ['E74.4'], reason: '肝醣儲積症第五型:分類表為 E74.04,字母表為 E74.4;YC 判定字母表 E74.4 為筆誤,採 E74.04。E74.4 仍因 A6-06 丙酮酸鹽脫氫酶缺乏症而在名單內。' },
};

/** 組合碼的成分中不單獨納入者(YC 2026-09-29) */
export const EXCLUDED_COMPONENTS = {
  'E74.31': { reason: '僅以組合碼 E74.31+E70.0 出現(A2-15 典型苯酮尿症合併蔗糖酶同麥芽糖酶缺乏症);E70.0 已單列於 A2-05,E74.31 單獨不代表罕病,不納入。' },
};

const COMBO = /([A-Z]\d{2}(?:\.[0-9A-Z]{1,4})?)\s*\+\s*([A-Z]\d{2}(?:\.[0-9A-Z]{1,4})?)/;
const SLASH = /([A-Z]\d{2}(?:\.[0-9A-Z]{1,4})?)\s*\/\s*([A-Z]\d{2}(?:\.[0-9A-Z]{1,4})?)/;

export function buildRareDisease(raw) {
  const pages = splitPages(raw);
  const { classified, alphabetical } = splitTables(pages);
  const diseases = parseClassified(classified);
  const alpha = parseAlphabetical(alphabetical, diseases);

  // 頁碼黏碼:逐頁處理已不會產生;另外重現「頁面串接」的黏碼並驗證每個都能還原到本表的碼(稽核紀錄)
  const allRaw = new Set([...diseases.flatMap((d) => d.raw), ...[...alpha.values()].flatMap((a) => a.raw)]);
  const pageNumberGlue = detectPageNumberGlue(raw).map((g) => {
    const restored = restoreGlued(g.glued, g.page + 1);
    if (restored !== g.code || !allRaw.has(restored)) throw new Error(`黏碼 ${g.glued} 無法還原到表內的碼(得 ${restored})`);
    return { page: g.page, code: g.code, gluedAs: g.glued };
  });
  const gluedForms = new Set(pageNumberGlue.map((g) => g.gluedAs));
  for (const c of allRaw) if (gluedForms.has(c)) throw new Error(`解析結果含黏碼 ${c}`);

  const combos = []; const slash = []; const tableMismatches = []; const excluded = new Map();
  const overridesUsed = new Set();
  const out = diseases.map((d) => {
    const text = d.lines.join('\n');
    const cm = COMBO.exec(text); if (cm) combos.push({ serial: d.serial, parts: [cm[1], cm[2]] });
    const sm = SLASH.exec(text); if (sm) slash.push({ serial: d.serial, parts: [sm[1], sm[2]] });
    const t1 = uniq(d.raw); const t2 = uniq(alpha.get(d.serial).raw);
    const only1 = t1.filter((c) => !t2.includes(c)); const only2 = t2.filter((c) => !t1.includes(c));
    let codes = uniq([...t1, ...t2]);                                     // 兩表不一致:聯集
    if (only1.length || only2.length) {
      const ov = TABLE_OVERRIDES[d.serial];
      const dropped = ov ? ov.drop.filter((c) => codes.includes(c)) : [];
      if (ov && dropped.length !== ov.drop.length) throw new Error(`${d.serial} 的覆寫已過時:要丟棄的碼不在聯集內(${ov.drop})`);
      if (ov) { codes = codes.filter((c) => !ov.drop.includes(c)); overridesUsed.add(d.serial); }
      tableMismatches.push({ serial: d.serial, zh: d.zh, classifiedOnly: only1, alphabeticalOnly: only2, resolution: ov ? `覆寫:丟棄 ${ov.drop.join('、')}` : '取聯集', ...(ov && { reason: ov.reason }) });
    }
    for (const c of codes.filter((c) => EXCLUDED_COMPONENTS[c])) {
      if (!excluded.has(c)) excluded.set(c, { code: c, reason: EXCLUDED_COMPONENTS[c].reason, diseases: [] });
      excluded.get(c).diseases.push(d.serial);
    }
    codes = codes.filter((c) => !EXCLUDED_COMPONENTS[c]);
    for (const c of codes) if (!isValidCode(c)) throw new Error(`${d.serial} 的碼不符 ICD-10-CM 格式或去點後超過 7 碼:${c}`);
    return { serial: d.serial, zh: d.zh, en: d.en, category: 'rare', codes };
  });
  for (const s of Object.keys(TABLE_OVERRIDES)) if (!overridesUsed.has(s)) throw new Error(`${s} 的覆寫沒有對應的兩表不一致(已過時)`);
  for (const c of Object.keys(EXCLUDED_COMPONENTS)) if (!excluded.has(c)) throw new Error(`排除碼 ${c} 不在任何疾病內(已過時)`);

  // 碼登記表:依序號順序;同碼多病 → shared,diseases[] 依序號排序
  const reg = new Map();
  for (const d of out) for (const c of d.codes) { if (!reg.has(c)) reg.set(c, { code: c, zh: d.zh, diseases: [] }); reg.get(c).diseases.push(d.serial); }
  const missingBroad = BROAD_CODES.filter((c) => !reg.has(c));
  if (missingBroad.length) throw new Error(`寬泛碼不在名單內:${missingBroad}`);
  const broad = new Set(BROAD_CODES);
  const codes = [...reg.values()].map((r) => ({
    code: r.code, zh: r.zh,
    ...(r.diseases.length > 1 && { shared: true, otherCount: r.diseases.length - 1 }),
    ...(broad.has(r.code) && { broad: true }),
    diseases: r.diseases,
  }));
  return { diseases: out, codes, excluded: [...excluded.values()], cleaning: { pageNumberGlue, tableMismatches, combos, slash }, pages: pages.length };
}
