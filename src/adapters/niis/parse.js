// NIIS 院所版結果頁 → 接種紀錄。劑別代號(官方 VaccID-劑次)最長前綴比對 → canonical
import { normDate } from '../../engine/dates.js';

export function makeCodeTable(niisJson) {
  const list = niisJson.codes.map((c) => ({ ...c, _len: c.code.length })).sort((a, b) => b._len - a._len);
  const byZh = new Map(niisJson.codes.map((c) => [c.zh.replace(/\s+/g, ''), c]));
  return { list, byZh, stool: niisJson.stoolCard?.code || 'Stool' };
}

// 網頁顯示名稱與代碼表中文不同者(探勘所見)
const ZH_ALIAS = { 流感疫苗: 'FLU', 帶狀皰疹疫苗: 'ZOSTER_UNSPEC', A型肝炎疫苗: 'HEPA' };

export function parseDoseLabel(label, table) {
  let s = String(label || '').trim();
  const lot = /\((?:批號)?([^)]*)\)\s*$/.exec(s);
  if (lot) s = s.slice(0, lot.index).trim();
  if (!s) return null;
  for (const c of table.list) {
    if (s === c.code) return { niisCode: c.code, canonical: c.canonical, active: c.active, dose: null, doseString: null, lot: lot?.[1] || null };
    if (s.startsWith(c.code + '-')) {
      const raw = s.slice(c.code.length + 1);
      const out = { niisCode: c.code, canonical: c.canonical, active: c.active, dose: null, doseString: null, lot: lot?.[1] || null };
      let m;
      if (/^\d+$/.test(raw)) out.dose = Number(raw);
      else if ((m = /^Booster(\d*)$/i.exec(raw)) || (m = /^B(\d*)$/.exec(raw))) { out.doseString = 'booster'; out.boosterSeq = m[1] ? Number(m[1]) : 1; }
      else { out.doseString = raw; out.unparsedDose = true; }
      return out;
    }
  }
  return null;
}

export function normFunding(s) {
  const t = String(s || '').trim();
  if (t === '公費' || t === '自費') return t;
  if (/公費|地方|縣|市/.test(t) && !/自費/.test(t)) return '公費';   // 政府來源(含縣市自購)→ 公費;原字串另存
  return null;
}

const HEAD = { seq: /序號/, label: /劑別/, name: /疫苗.*名稱|中文名稱/, date: /接種日/, funding: /批號類型|類型/, site: /接種單位|單位/ };

function pickTable(doc) {
  const root = doc.querySelector('#div_result') || doc;
  const tabs = [...root.querySelectorAll('span.tabItem, .tabItem')];
  const allTab = tabs.find((t) => /預防接種紀錄/.test(t.textContent));
  if (allTab) {
    let n = allTab.nextElementSibling;
    while (n && !n.classList?.contains('tabContent')) n = n.nextElementSibling;
    const t = n?.querySelector('table');
    if (t) return t;
  }
  return root.querySelector('table');
}

/** 解析結果頁。回傳 { found, records, meta, rocId }(rocId 只供雜湊比對,呼叫端不可保存) */
export function parseNiisDocument(doc, table) {
  const t = pickTable(doc);
  const rocId = doc.querySelector('#tb_RocID')?.value?.trim() || null;
  if (!t) return { found: false, records: [], meta: {}, rocId };
  const trs = [...t.querySelectorAll('tr')];
  const cells = (tr) => [...tr.querySelectorAll('th,td')].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  const header = cells(trs[0] || { querySelectorAll: () => [] });
  const col = Object.fromEntries(Object.entries(HEAD).map(([k, re]) => [k, header.findIndex((h) => re.test(h))]));
  const meta = { header, unmapped: [], unknownFunding: [], unparsedDose: [], emptyMessage: null, excluded: 0 };
  const records = [];
  for (const tr of trs.slice(1)) {
    const c = cells(tr);
    if (c.length === 1) { meta.emptyMessage = c[0]; continue; }
    const get = (k) => (col[k] >= 0 ? c[col[k]] : '');
    const label = get('label'); const name = get('name');
    if (label === table.stool || label.startsWith(table.stool + '-')) { meta.excluded++; continue; }   // 大便卡非疫苗
    let p = parseDoseLabel(label, table);
    if (!p) {
      const z = table.byZh.get(name.replace(/\s+/g, ''));
      const alias = ZH_ALIAS[name.replace(/\s+/g, '')];
      if (z) p = { niisCode: z.code, canonical: z.canonical, dose: null, doseString: null, viaName: true };
      else if (alias) p = { niisCode: null, canonical: alias, dose: null, doseString: null, viaName: true };
      else if (/肺炎鏈球菌/.test(name)) p = { niisCode: null, canonical: 'PNEUMO_UNKNOWN', dose: null, doseString: null, viaName: true };
      else { meta.unmapped.push(`${label}|${name}`); continue; }
      const m = /-(\d+)/.exec(label); if (m) p.dose = Number(m[1]);
    }
    if (p.unparsedDose) meta.unparsedDose.push(label);
    const fundingRaw = get('funding');
    const funding = normFunding(fundingRaw);
    if (fundingRaw && !funding) meta.unknownFunding.push(fundingRaw);
    records.push({ code: p.canonical, niisCode: p.niisCode, label, name, dose: p.dose, doseString: p.doseString, boosterSeq: p.boosterSeq, date: normDate(get('date')), funding, source: fundingRaw || null, site: get('site'), viaName: !!p.viaName });
  }
  records.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return { found: true, records, meta, rocId };
}
