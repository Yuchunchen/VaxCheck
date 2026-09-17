#!/usr/bin/env node
// rules/vaccines.yaml → dist/rules/vaccines.json(註解在此丟掉),
// 並複製 rules/niis-vaccine-codes.json → dist/rules/。
// 外掛執行期讀 dist/rules/*.json;日後由 GitHub raw / Release 發佈同一組檔案。
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

const src = resolve(process.argv[2] ?? 'rules/vaccines.yaml');
const outDir = resolve('dist/rules');
mkdirSync(outDir, { recursive: true });

const rules = yaml.load(readFileSync(src, 'utf8'));
const out = { ...rules, builtAt: new Date().toISOString(), sourceFile: 'rules/vaccines.yaml' };
writeFileSync(resolve(outDir, 'vaccines.json'), JSON.stringify(out, null, 2) + '\n');
copyFileSync(resolve('rules/niis-vaccine-codes.json'), resolve(outDir, 'niis-vaccine-codes.json'));
console.log(`built dist/rules/vaccines.json (ruleSetVersion=${rules.ruleSetVersion}) + niis-vaccine-codes.json`);
