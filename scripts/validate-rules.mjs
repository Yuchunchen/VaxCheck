#!/usr/bin/env node
// 規則檔驗證:rules/vaccines.yaml 對 rules/schema.json(Ajv),
// 加上引用完整性與「疫苗代碼必須存在於 niis-vaccine-codes.json 的 canonical 值集合」檢查。
// 用法:node scripts/validate-rules.mjs [rules/vaccines.yaml]
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import Ajv from 'ajv';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rulesPath = resolve(process.argv[2] ?? 'rules/vaccines.yaml');
const schema = JSON.parse(readFileSync(resolve(ROOT, 'rules/schema.json'), 'utf8'));
const codeTable = JSON.parse(readFileSync(resolve(ROOT, 'rules/niis-vaccine-codes.json'), 'utf8'));
const rules = yaml.load(readFileSync(rulesPath, 'utf8'));

const errors = [];
const fail = (msg) => errors.push(msg);

// 1. JSON Schema
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
if (!validate(rules)) {
  for (const e of validate.errors) fail(`schema ${e.instancePath || '/'} ${e.message}`);
}

// 2. 引用完整性
const codeLists = new Set(Object.keys(rules.codeLists ?? {}));
const manualKeys = new Set((rules.manualConditions ?? []).map((m) => m.key));
const sourceIds = new Set((rules.sources ?? []).map((s) => s.id));
const canonical = new Set(codeTable.codes.map((c) => c.canonical));

function walk(node, path, ctx) {
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`, ctx));
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    const p = `${path}.${k}`;
    if (k === '$list' && !codeLists.has(v)) fail(`${p}: 未宣告的 codeList「${v}」`);
    if (k === 'manual' && typeof v === 'string' && !manualKeys.has(v)) fail(`${p}: 未宣告的 manualCondition「${v}」`);
    if (k === 'sourceIds') for (const s of v) if (!sourceIds.has(s)) fail(`${p}: 未宣告的 source「${s}」`);
    // 疫苗代碼:historyMatch.vaccineCodes / vaccination.vaccineCodes / has / none / intervalFrom
    if (['vaccineCodes', 'none', 'intervalFrom'].includes(k)) checkCodes(v, p, ctx);
    if (k === 'has') checkCodes(Array.isArray(v) ? v : v.codes, p, ctx);
    if (k === 'codes' && path.endsWith('.has')) continue; // 已由 has 處理
    walk(v, p, ctx);
  }
}
function checkCodes(list, p, ctx) {
  if (!Array.isArray(list)) return;
  for (const c of list) {
    if (!canonical.has(c) && !ctx.unknownTypeCodes.has(c)) {
      fail(`${p}: 疫苗代碼「${c}」不在 niis-vaccine-codes.json 的 canonical 值集合,也不在該疫苗的 unknownTypeCodes`);
    }
  }
}

for (const [i, v] of (rules.vaccines ?? []).entries()) {
  const ctx = { unknownTypeCodes: new Set(v.dosing?.unknownTypeCodes ?? []) };
  walk(v, `vaccines[${i}](${v.vaccineId})`, ctx);
  // 葉條件單一 key
  checkLeafKeys(v, `vaccines[${i}](${v.vaccineId})`);
}
walk(rules.manualConditions ?? [], 'manualConditions', { unknownTypeCodes: new Set() });

function checkLeafKeys(node, path) {
  if (Array.isArray(node)) return node.forEach((n, i) => checkLeafKeys(n, `${path}[${i}]`));
  if (!node || typeof node !== 'object') return;
  if (path.endsWith('.criteria') || /\.(all|any)\[\d+\]$/.test(path) || path.endsWith('.not') || path.endsWith('.askWhen')) {
    const keys = Object.keys(node);
    if (keys.length !== 1) fail(`${path}: 條件節點必須只有一個 key,實際 ${JSON.stringify(keys)}`);
  }
  for (const [k, v] of Object.entries(node)) checkLeafKeys(v, `${path}.${k}`);
}

// 3. 代碼表本身
const seen = new Set();
for (const c of codeTable.codes) {
  if (seen.has(c.code)) fail(`niis-vaccine-codes: 重複 code「${c.code}」`);
  seen.add(c.code);
  if (!/^[A-Z][A-Z0-9_]*$/.test(c.canonical)) fail(`niis-vaccine-codes: canonical「${c.canonical}」不符命名規則`);
}

if (errors.length) {
  console.error(`✗ ${rulesPath}\n` + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`✓ ${rulesPath} ruleSetVersion=${rules.ruleSetVersion} vaccines=${rules.vaccines.length} canonical codes=${canonical.size}`);
