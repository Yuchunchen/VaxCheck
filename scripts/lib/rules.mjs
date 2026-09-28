// 規則建置:YAML → 內嵌代碼清單 → 展開階段 → 合併縣市 overlay → schema + 語意檢查
import { ENGINE_VERSION } from '../../src/engine/evaluate.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import Ajv from 'ajv';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const R = (...p) => path.join(ROOT, 'rules', ...p);
const clone = (x) => JSON.parse(JSON.stringify(x));

export function loadYaml(file) { return yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.JSON_SCHEMA }); }

export function inlineCodeLists(rs, baseDir = R()) {
  for (const [name, cl] of Object.entries(rs.codeLists || {})) {
    if (!cl.file) continue;
    const [f, section] = cl.file.split('#');
    const doc = JSON.parse(fs.readFileSync(path.join(baseDir, f), 'utf8'));
    const sec = doc.sections?.[section];
    if (!sec) throw new Error(`codeList ${name}:${cl.file} 找不到 section`);
    rs.codeLists[name] = { label: cl.label || sec.label, system: cl.system, codes: sec.codes.map((c) => c.code), source: { id: doc.id, sha256: doc.sourceSha256 }, threeCharAsCategory: cl.threeCharAsCategory };
  }
  for (const cl of Object.values(rs.codeLists || {})) {
    if (!cl.threeCharAsCategory) continue;
    cl.codes = cl.codes.map((c) => (/^[A-Z][0-9][0-9A-Z]$/.test(c) ? `${c}*` : c));   // 類目 = 其下所有細碼
    delete cl.threeCharAsCategory;
  }
  return rs;
}

export function expandPhases(rs, errors) {
  for (const v of rs.vaccines) {
    for (const g of v.eligibilityGroups || []) {
      if (g.priorityPhase == null) continue;
      if (g.effective) { errors.push(`${g.groupId}:priorityPhase 與 effective 不可同時寫`); continue; }
      const ph = v.season?.phases?.find((p) => p.phase === g.priorityPhase);
      if (!ph) { if (v.season?.phases) errors.push(`${g.groupId}:season.phases 沒有第 ${g.priorityPhase} 階段`); continue; }
      g.effective = { from: ph.start, to: v.season.end };
    }
  }
  return rs;
}

function annotate(groups, providedBy, jurisdiction, extraSources = []) {
  for (const g of groups) {
    g.providedBy = providedBy; g.jurisdiction = jurisdiction;
    if (extraSources.length || g.sourceIds) g.sourceIds = [...new Set([...(g.sourceIds || []), ...extraSources])];
  }
}

export function mergeOverlay(central, overlay, errors) {
  const out = clone(central);
  const code = overlay.jurisdiction.code;
  const prefix = code.split('-')[1] + '_';
  out.jurisdiction = { code, level: 'county', name: overlay.jurisdiction.name, central: central.jurisdiction };
  out.ruleSetVersion = `${central.ruleSetVersion}+${overlay.ruleSetVersion}`;
  for (const key of ['codeLists']) {
    for (const [k, v] of Object.entries(overlay[key] || {})) { if (out[key][k]) errors.push(`${code}:${key}.${k} 與中央衝突`); else out[key][k] = v; }
  }
  for (const key of ['manualConditions', 'sources']) {
    const idf = key === 'sources' ? 'id' : 'key';
    for (const item of overlay[key] || []) {
      if ((out[key] || []).some((x) => x[idf] === item[idf])) errors.push(`${code}:${key} ${item[idf]} 與中央衝突`);
      else (out[key] ||= []).push(item);
    }
  }
  for (const v of overlay.vaccines || []) {
    for (const g of v.eligibilityGroups || []) {
      if (!g.groupId.startsWith(prefix)) errors.push(`${code}:群組 ${g.groupId} 必須以 ${prefix} 開頭`);
      if (!(g.sourceIds?.length || v.sourceIds?.length)) errors.push(`${code}:群組 ${g.groupId} 缺 sourceIds(縣市群必須有公告依據)`);
    }
    if (v.extends) {
      const target = out.vaccines.find((x) => x.vaccineId === v.extends);
      if (!target) { errors.push(`${code}:extends 目標不存在 ${v.extends}`); continue; }
      const groups = clone(v.eligibilityGroups);
      annotate(groups, 'county', code, v.sourceIds || []);
      expandPhases({ vaccines: [{ ...target, eligibilityGroups: groups }] }, errors);
      target.eligibilityGroups.push(...groups);
    } else {
      const nv = clone(v);
      annotate(nv.eligibilityGroups, 'county', code, v.sourceIds || []);
      expandPhases({ vaccines: [nv] }, errors);
      out.vaccines.push(nv);
    }
  }
  return out;
}

// ---------- 語意檢查 ----------
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, fn));
  fn(node);
  for (const v of Object.values(node)) walk(v, fn);
}
const FLAGS = new Set(['homeCare', 'dialysis', 'ckd', 'hospice', 'longTermCare']);
export function semanticCheck(rs, niisCodes, errors) {
  const canon = new Set(niisCodes.codes.map((c) => c.canonical));
  const lists = new Set(Object.keys(rs.codeLists || {}));
  const manual = new Set((rs.manualConditions || []).map((m) => m.key));
  const sources = new Set((rs.sources || []).map((s) => s.id));
  const ids = new Set(); const gids = new Set();
  const checkTree = (tree, where, { allowManual = true } = {}) => walk(tree, (n) => {
    for (const k of ['diagnosis', 'medication', 'specialPayment', 'specialMaterial']) if (n[k]?.$list && !lists.has(n[k].$list)) errors.push(`${where}:代碼清單不存在 ${n[k].$list}`);
    if (typeof n.manual === 'string') { if (!allowManual) errors.push(`${where}:evidence 不可含 manual`); else if (!manual.has(n.manual)) errors.push(`${where}:人工條件未宣告 ${n.manual}`); }
    if (typeof n.residentOf === 'string') { const k = `resident_${n.residentOf.replace('-', '_')}`; if (!manual.has(k)) errors.push(`${where}:residentOf 需宣告後備人工條件 ${k}`); }
    if (n.vaccination?.vaccineCodes) n.vaccination.vaccineCodes.forEach((c) => canon.has(c) || errors.push(`${where}:疫苗代碼不在對照表 ${c}`));
  });
  for (const m of rs.manualConditions || []) {
    if (m.evidence) checkTree(m.evidence, `manual.${m.key}.evidence`, { allowManual: false });
    if (m.askWhen) checkTree(m.askWhen, `manual.${m.key}.askWhen`, { allowManual: false });
  }
  for (const v of rs.vaccines) {
    if (ids.has(v.vaccineId)) errors.push(`vaccineId 重複 ${v.vaccineId}`); ids.add(v.vaccineId);
    (v.sourceIds || []).forEach((s) => sources.has(s) || errors.push(`${v.vaccineId}:來源不存在 ${s}`));
    const unk = new Set(v.dosing?.unknownTypeCodes || []);
    const okCode = (c) => canon.has(c) || unk.has(c);
    (v.historyMatch?.vaccineCodes || []).forEach((c) => okCode(c) || errors.push(`${v.vaccineId}:historyMatch 代碼不在對照表 ${c}`));
    for (const g of v.eligibilityGroups) {
      if (gids.has(g.groupId)) errors.push(`groupId 重複 ${g.groupId}`); gids.add(g.groupId);
      (g.sourceIds || []).forEach((s) => sources.has(s) || errors.push(`${g.groupId}:來源不存在 ${s}`));
      checkTree(g.criteria, `${v.vaccineId}.${g.groupId}`);
      if (g.effective && v.season && (g.effective.from < v.season.start || (g.effective.to && g.effective.to > v.season.end))) errors.push(`${g.groupId}:effective 超出 season`);
      if (g.reportCodes) {
        const table = new Set((v.reportCodes?.table || []).map((r) => r.code));
        if (!table.size) errors.push(`${g.groupId}:有 reportCodes 但 ${v.vaccineId} 未定義 reportCodes.table`);
        for (const e of g.reportCodes) {
          const code = typeof e === 'string' ? e : e.code;
          if (table.size && !table.has(code)) errors.push(`${g.groupId}:接種對象別代碼不在表內 ${code}`);
          for (const r of (typeof e === 'string' ? [] : e.evidence)) {
            if (r.startsWith('flag:')) { if (!FLAGS.has(r.slice(5))) errors.push(`${g.groupId}:reportCodes 證據旗標不存在 ${r}`); }
            else if (!lists.has(r)) errors.push(`${g.groupId}:reportCodes 證據清單不存在 ${r}`);
          }
        }
      }
    }
    if (v.reportCodes) {
      const seen = new Set();
      for (const r of v.reportCodes.table) { if (seen.has(r.code)) errors.push(`${v.vaccineId}:接種對象別代碼重複 ${r.code}`); seen.add(r.code); }
      if (v.reportCodes.sourceRef && !sources.has(v.reportCodes.sourceRef)) errors.push(`${v.vaccineId}:reportCodes 來源不存在 ${v.reportCodes.sourceRef}`);
    }
    for (const c of v.contraindications || []) { if (c.criteria) checkTree(c.criteria, `${v.vaccineId}.${c.id}`); if (c.manual && !manual.has(c.manual)) errors.push(`${v.vaccineId}.${c.id}:人工條件未宣告 ${c.manual}`); }
    for (const c of v.dosing?.cases || []) {
      if (c.criteria) checkTree(c.criteria, `${v.vaccineId}.${c.id}`);
      walk(c.when, (n) => {
        const arr = n.none || (Array.isArray(n.has) ? n.has : n.has?.codes);
        (arr || []).forEach((x) => okCode(x) || errors.push(`${v.vaccineId}.${c.id}:疫苗代碼不在對照表 ${x}`));
      });
      (c.then.intervalFrom || []).forEach((x) => okCode(x) || errors.push(`${v.vaccineId}.${c.id}:intervalFrom 代碼不在對照表 ${x}`));
    }
  }
}

let _ajv;
export function schemaValidate(rs, errors, where) {
  if (!_ajv) { _ajv = new Ajv({ allErrors: true, strict: false }); _ajv.addSchema(JSON.parse(fs.readFileSync(R('schema.json'), 'utf8')), 'rules'); }
  const validate = _ajv.getSchema('rules');
  if (!validate(rs)) for (const e of validate.errors.slice(0, 20)) errors.push(`${where}${e.instancePath}:${e.message}`);
}

export function buildAll({ centralFile = R('vaccines.yaml'), overlayDir = R('overlays') } = {}) {
  const errors = [];
  const niis = JSON.parse(fs.readFileSync(R('niis-vaccine-codes.json'), 'utf8'));
  const raw = loadYaml(centralFile);
  schemaValidate(raw, errors, 'central(原始)');
  const central = expandPhases(inlineCodeLists(clone(raw)), errors);
  for (const v of central.vaccines) annotate(v.eligibilityGroups, 'central', 'TW');
  const outputs = { TW: central };
  const overlayFiles = fs.existsSync(overlayDir) ? fs.readdirSync(overlayDir).filter((f) => /^TW-[A-Z]{3}\.ya?ml$/.test(f)) : [];
  for (const f of overlayFiles) {
    const ov = loadYaml(path.join(overlayDir, f));
    const code = f.replace(/\.ya?ml$/, '');
    schemaValidate(ov, errors, `${code}(原始)`);
    if (ov.jurisdiction?.code !== code || ov.jurisdiction?.level !== 'county') { errors.push(`${f}:jurisdiction 必須為 {code: ${code}, level: county}`); continue; }
    for (const v of ov.vaccines || []) if (v.extends && (v.dosing || v.season || v.historyMatch || v.contraindications)) errors.push(`${code}:extends 項目不可含 dosing/season/historyMatch/contraindications`);
    if (!(ov.vaccines || []).length) continue;          // 空 overlay(全部歸檔)→ 退回中央
    outputs[code] = mergeOverlay(central, inlineCodeLists(ov, R()), errors);
  }
  for (const [code, rs] of Object.entries(outputs)) {
    schemaValidate(rs, errors, `${code}(合併)`);
    semanticCheck(rs, niis, errors);
    rs.build = { builtAt: new Date().toISOString(), engine: '0.4.5' };
  }
  return { outputs, errors, niis };
}

export function writeDist(outputs, distDir) {
  fs.mkdirSync(distDir, { recursive: true });
  const latest = {};
  for (const [code, rs] of Object.entries(outputs)) {
    const file = `vaccines.${code}.json`;
    const body = JSON.stringify(rs);
    fs.writeFileSync(path.join(distDir, file), body);
    latest[code] = { version: rs.ruleSetVersion, file, sha256: crypto.createHash('sha256').update(body).digest('hex'), name: rs.jurisdiction.name };
  }
  // minEngine:建置這份規則的引擎版本;舊外掛讀到較新引擎的線上規則時改用內建(src/rulesource.js)
  const manifest = { publishedAt: new Date().toISOString(), minEngine: ENGINE_VERSION, latest };
  fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}
