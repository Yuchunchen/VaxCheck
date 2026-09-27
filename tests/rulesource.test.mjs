// 線上規則來源:預設 VaxCheck rules 分支、空白 = 預設、取捨條件(引擎版本、比內建舊)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, DEFAULT_RULES_BASE, readOptions } from '../src/workspace/options.js';
import { rejectRemote, versionLess } from '../src/rulesource.js';
import { ENGINE_VERSION } from '../src/engine/evaluate.js';
import { buildAll, writeDist } from '../scripts/lib/rules.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sync = (stored) => ({ get: async () => ({ ...stored }) });

test('線上規則預設來源 = VaxCheck repo 的 rules 分支;空白視同預設;pinBundled 預設關', async () => {
  assert.equal(DEFAULT_RULES_BASE, 'https://raw.githubusercontent.com/Yuchunchen/VaxCheck/rules/');
  assert.equal(DEFAULTS.remoteRulesBase, DEFAULT_RULES_BASE);
  assert.equal(DEFAULTS.pinBundled, false);
  assert.equal((await readOptions(sync({}))).remoteRulesBase, DEFAULT_RULES_BASE, '新安裝');
  assert.equal((await readOptions(sync({ remoteRulesBase: '' }))).remoteRulesBase, DEFAULT_RULES_BASE, '舊版存過空白');
  assert.equal((await readOptions(sync({ remoteRulesBase: 'https://x.github.io/r/' }))).remoteRulesBase, 'https://x.github.io/r/', '自訂保留');
});

test('建置的 manifest 帶 minEngine = 目前引擎版本', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-rules-'));
  const m = writeDist(buildAll().outputs, dir);
  assert.equal(m.minEngine, ENGINE_VERSION);
  assert.ok(m.latest.TW.sha256 && m.latest.TW.file);
});

test('線上規則取捨:需要較新引擎、比內建舊 → 用內建;同版或較新 → 用線上', () => {
  const man = (publishedAt, version, minEngine = '0.4.12') => ({ publishedAt, minEngine, latest: { TW: { version, file: 'vaccines.TW.json', sha256: 'x' } } });
  const bundled = man('2026-10-01T00:00:00Z', 'R2');
  assert.equal(rejectRemote(man('2026-10-05T00:00:00Z', 'R3'), bundled, 'TW', '0.4.13'), null, '較新 → 用');
  assert.equal(rejectRemote(man('2026-09-01T00:00:00Z', 'R2'), bundled, 'TW', '0.4.13'), null, '同版(發布時間不同)→ 用');
  assert.match(rejectRemote(man('2026-09-01T00:00:00Z', 'R1'), bundled, 'TW', '0.4.13'), /比內建 R2 舊/);
  assert.match(rejectRemote(man('2026-10-05T00:00:00Z', 'R3', '0.5.0'), bundled, 'TW', '0.4.13'), /需要引擎 0.5.0/);
  assert.match(rejectRemote({ latest: {} }, bundled, 'TW', '0.4.13'), /缺該管轄/);
  assert.equal(rejectRemote({ latest: { TW: { version: 'R3', file: 'f', sha256: 's' } } }, bundled, 'TW', '0.4.13'), null, '舊格式 manifest(無 minEngine/publishedAt)仍可用');
  assert.ok(versionLess('0.4.9', '0.4.12') && !versionLess('0.4.12', '0.4.12') && versionLess('0.4.12', '0.5'));
});
