import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { ROOT } from '../scripts/lib/rules.mjs';

const dir = path.join(ROOT, 'sources');
const manifest = yaml.load(fs.readFileSync(path.join(dir, 'manifest.yaml'), 'utf8'));
const ruleSourceIds = new Set(
  yaml.load(fs.readFileSync(path.join(ROOT, 'rules', 'vaccines.yaml'), 'utf8')).sources.map((s) => s.id),
);

test('來源封存:manifest 每筆的 PDF 存在且 sha256、大小相符', () => {
  assert.ok(manifest.files.length > 0);
  const ids = new Set();
  for (const f of manifest.files) {
    assert.ok(!ids.has(f.id), `id 重複:${f.id}`);
    ids.add(f.id);
    const pdf = path.join(dir, f.file);
    assert.ok(fs.existsSync(pdf), `缺 PDF:${f.file}`);
    const buf = fs.readFileSync(pdf);
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), f.sha256, `sha256 不符:${f.file}`);
    assert.equal(buf.length, f.bytes, `大小不符:${f.file}`);
    assert.ok(buf.subarray(0, 5).toString() === '%PDF-', `不是 PDF:${f.file}`);
    assert.ok(/^\d{4}-\d{2}_/.test(path.basename(f.file)), `檔名需 YYYY-MM_ 開頭:${f.file}`);
  }
});

test('來源封存:文字檔存在;沒有未登錄的檔案', () => {
  const listed = new Set();
  for (const f of manifest.files) {
    assert.ok(fs.existsSync(path.join(dir, f.textFile)), `缺文字檔:${f.textFile}`);
    listed.add(f.file);
    listed.add(f.textFile);
    if (f.rawTextFile) { assert.ok(fs.existsSync(path.join(dir, f.rawTextFile)), `缺文字檔:${f.rawTextFile}`); listed.add(f.rawTextFile); }   // pdftotext -raw(供腳本解析)
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(dir, path.join(d, e.name)).split(path.sep).join('/')]));
  const extra = walk(dir).filter((p) => /\.(pdf|txt)$/i.test(p) && !listed.has(p));
  assert.deepEqual(extra, [], '有 PDF/文字檔未登錄在 manifest.yaml');
});

test('來源封存:ruleSourceIds 存在於規則檔、codelist 存在且雜湊相符', () => {
  for (const f of manifest.files) {
    for (const id of f.ruleSourceIds || []) assert.ok(ruleSourceIds.has(id), `${f.id} 引用不存在的規則來源 ${id}`);
    for (const c of f.codelists || []) {
      const p = path.join(ROOT, c);
      assert.ok(fs.existsSync(p), `codelist 不存在:${c}`);
      const cl = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (cl.sourceSha256) assert.equal(cl.sourceSha256, f.sha256, `${c} 的 sourceSha256 與封存檔不同`);
    }
  }
});
