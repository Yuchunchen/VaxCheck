import path from 'node:path';
import fs from 'node:fs';
import { buildAll, writeDist, ROOT } from './lib/rules.mjs';
const check = process.argv.includes('--check');
const { outputs, errors, niis } = buildAll();
if (errors.length) { console.error(`✗ 規則驗證失敗(${errors.length})`); errors.forEach((e) => console.error('  - ' + e)); process.exit(1); }
if (check) { console.log(`✓ 規則驗證通過:${Object.keys(outputs).join(', ')}`); process.exit(0); }
const dist = path.join(ROOT, 'dist', 'rules');
const m = writeDist(outputs, dist);
fs.copyFileSync(path.join(ROOT, 'rules', 'niis-vaccine-codes.json'), path.join(dist, 'niis-vaccine-codes.json'));
console.log(`✓ 規則建置完成 → dist/rules/(${Object.keys(m.latest).join(', ')};${niis.codes.length} 個 NIIS 代碼)`);
