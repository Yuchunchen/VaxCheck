// 發行說明:取 CHANGELOG.md 中 `## v<版號>` 那一節。用法:node scripts/release-notes.mjs [版號],預設 package.json 版號
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function notesFor(version, text = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## v${version}(`) || l === `## v${version}`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const v = (process.argv[2] || pkg.version).replace(/^v/, '');
  const notes = notesFor(v);
  if (!notes) { console.error(`CHANGELOG.md 沒有 v${v} 這一節`); process.exit(1); }
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/rules/vaccines.TW.json'), 'utf8')).ruleSetVersion;
  console.log(`${notes}\n\n---\n外掛 v${v};內建規則 ${rules}。\n\n安裝與更新見 README「院內安裝」;檔案完整性可比對 SHA256SUMS.txt。`);
}
