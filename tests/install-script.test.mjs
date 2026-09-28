// scripts/install.ps1(PowerShell 一鍵下載安裝)與 README 貼上區塊同步、Windows PowerShell 5.1 相容、行為。
// 有 pwsh(GitHub ubuntu runner 內建;或 PWSH=路徑)時另做語法解析與實跑(本機假 GitHub API;Windows 上不實跑,以免動到真的桌面)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { ROOT } from '../scripts/lib/rules.mjs';

const BOM = '﻿';
const raw = fs.readFileSync(path.join(ROOT, 'scripts/install.ps1'), 'utf8');
const norm = (s) => s.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
const script = norm(raw);
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('README 貼上區塊 = scripts/install.ps1', () => {
  const m = readme.match(/<!-- install\.ps1 開始[^>]*-->\n```powershell\n([\s\S]*?)\n```\n<!-- install\.ps1 結束 -->/);
  assert.ok(m, 'README 找不到 <!-- install.ps1 開始 --> … <!-- install.ps1 結束 --> 之間的 ```powershell 區塊');
  assert.equal(norm(m[1]), script, 'README 的 PowerShell 區塊與 scripts/install.ps1 不一致:改一邊要同步另一邊');
});

test('install.ps1 存成 UTF-8 含 BOM(Windows PowerShell 5.1 以 -File 執行時才不會把中文當 Big5)', () => {
  assert.ok(raw.startsWith(BOM));
});

test('install.ps1:Windows PowerShell 5.1 相容、貼上安全', () => {
  const lines = script.split('\n');
  assert.ok(!script.includes('\t'), '不可有 Tab(貼進主控台會觸發自動完成)');
  const open = lines.indexOf('& {');
  assert.ok(open > 0 && lines.at(-1) === '}', '整段包在 & { … }:貼上時一次解析、return 只離開區塊,不會關掉視窗');
  assert.equal(lines[open + 1].trim(), "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'", '區塊第一行設 TLS 1.2');
  assert.ok(!lines.slice(open).some((l) => l.trim() === ''), '區塊內不可有空白行(舊主控台貼上時空白行會提早結束輸入)');
  const code = lines.filter((l) => !l.trim().startsWith('#')).join('\n');
  for (const [re, why] of [[/\?\?/, '?? 運算子(PS 7)'], [/\?\./, '?. 運算子(PS 7)'], [/\s(&&|\|\|)\s/, '&& / || 管線鏈(PS 7)'], [/-Parallel\b/, 'ForEach-Object -Parallel(PS 7)'],
    [/\$env:TEMP\b/, '$env:TEMP(改用 [IO.Path]::GetTempPath())'], [/\bexit\b/, 'exit(貼上執行時會關掉視窗)']]) assert.ok(!re.test(code), `不可用 ${why}`);
  const swallow = code.match(/\$[A-Za-z_][A-Za-z0-9_]*(?![A-Za-z0-9_])(?=\p{L})/u);
  assert.equal(swallow, null, `變數後緊接中文會被當成變數名稱的一部分:${swallow?.[0]}(用 \${name} 或加空格)`);
  // 不動登錄檔、不繞過 Chrome
  for (const re of [/HK(LM|CU):/i, /Registry::/i, /\b(Set|New|Remove)-ItemProperty\b/i, /\breg(\.exe)?\s+(add|delete|import)/i, /--load-extension/, /--disable-extensions-except/, /ExtensionInstall(Force|Allow)list/])
    assert.ok(!re.test(code), `不可有 ${re}`);
});

test('install.ps1:下載來源與 release.yml 的外掛 zip 檔名一致,不寫死版號', () => {
  assert.ok(script.includes('https://api.github.com/repos/$repo/releases/latest'));
  assert.ok(script.includes("$repo = 'Yuchunchen/VaxCheck'"));
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
  assert.ok(yml.includes('"dist/vaxcheck-ext-$V.zip"'), 'release.yml 的外掛 zip 檔名改了,install.ps1 要跟著改');
  assert.ok(yml.includes('SHA256SUMS.txt'));
  const pat = new RegExp(script.match(/\$_\.name -match '([^']+)'/)[1]);
  assert.ok(pat.test(`vaxcheck-ext-${pkg.version}.zip`));
  for (const other of [`vaxcheck-web-${pkg.version}.html`, 'SHA256SUMS.txt']) assert.ok(!pat.test(other), other);
  assert.ok(!script.includes(pkg.version), '不可寫死版號');
  assert.ok(script.includes("[Environment]::GetFolderPath('Desktop')") && script.includes("Join-Path $desktop 'vaxcheck'"));
});

// ───────── 以下需要 pwsh ─────────
const PWSH = process.env.PWSH || 'pwsh';
const hasPwsh = spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-Command', '1'], { encoding: 'utf8' }).status === 0;
const hasPy = spawnSync('python3', ['-c', '1']).status === 0;

test('install.ps1:pwsh 語法解析無錯誤', { skip: !hasPwsh && '沒有 pwsh' }, () => {
  const ps = `$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:VX_PS1,[ref]$t,[ref]$e);$e | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" }`;
  const r = spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', env: { ...process.env, VX_PS1: path.join(ROOT, 'scripts/install.ps1') } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '');
});

test('install.ps1 實跑:攤平多一層的 zip、更新保留同一資料夾、校驗不符不動舊檔、不刪別人的資料夾',
  { skip: (!hasPwsh && '沒有 pwsh') || (process.platform === 'win32' && 'Windows 上不實跑') || (!hasPy && '沒有 python3'), timeout: 120000 }, async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-ps1-'));
    try {
      // 假 Release:zip 內多包一層 vaxcheck-ext-9.9.9/
      const src = path.join(T, 'src', 'vaxcheck-ext-9.9.9');
      fs.mkdirSync(path.join(src, 'icons'), { recursive: true });
      fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ name: 'VaxCheck 疫苗檢核', version: '9.9.9', manifest_version: 3 }));
      fs.writeFileSync(path.join(src, 'background.js'), '// v9.9.9');
      fs.writeFileSync(path.join(src, 'icons', 'icon16.png'), 'png');
      const zipBase = path.join(T, 'ext');
      assert.equal(spawnSync('python3', ['-c', `import shutil;shutil.make_archive(${JSON.stringify(zipBase)},'zip',${JSON.stringify(path.join(T, 'src'))})`]).status, 0);
      const zip = fs.readFileSync(zipBase + '.zip');
      const sha = crypto.createHash('sha256').update(zip).digest('hex');
      let badHash = false;
      const server = http.createServer((req, res) => {
        const base = `http://127.0.0.1:${server.address().port}`;
        if (req.url === '/repos/Yuchunchen/VaxCheck/releases/latest') {
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ tag_name: 'v9.9.9', assets: [
            { name: 'vaxcheck-web-9.9.9.html', browser_download_url: `${base}/dl/web` },
            { name: 'vaxcheck-ext-9.9.9.zip', browser_download_url: `${base}/dl/zip` },
            { name: 'SHA256SUMS.txt', browser_download_url: `${base}/dl/sums` }] }));
        }
        res.setHeader('content-type', 'application/octet-stream');
        if (req.url === '/dl/zip') return res.end(zip);
        if (req.url === '/dl/sums') return res.end(`${badHash ? '0'.repeat(64) : sha}  vaxcheck-ext-9.9.9.zip\n${'1'.repeat(64)}  vaxcheck-web-9.9.9.html\n`);
        res.statusCode = 404; res.end();
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const ps1 = path.join(T, 'install.ps1');
      fs.writeFileSync(ps1, raw.replace('https://api.github.com', `http://127.0.0.1:${server.address().port}`));
      const run = (home) => new Promise((resolve) => execFile(PWSH, ['-NoProfile', '-NonInteractive', '-File', ps1],
        { env: { ...process.env, HOME: home, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, encoding: 'utf8', timeout: 60000 },
        (err, stdout, stderr) => resolve({ code: err?.code ?? 0, out: stdout + stderr })));
      try {
        const home = path.join(T, 'home');
        fs.mkdirSync(path.join(home, 'Desktop'), { recursive: true });
        const dest = path.join(home, 'Desktop', 'vaxcheck');
        // 1. 首次安裝:攤平
        let r = await run(home);
        assert.match(r.out, /已下載 VaxCheck v9\.9\.9/, r.out);
        assert.ok(fs.existsSync(path.join(dest, 'manifest.json')) && fs.existsSync(path.join(dest, 'icons', 'icon16.png')), '攤平後 manifest.json 在資料夾第一層');
        assert.ok(!fs.existsSync(path.join(dest, 'vaxcheck-ext-9.9.9')));
        // 2. 更新:同一資料夾(路徑 = 外掛 ID)、舊檔清掉
        const ino = fs.statSync(dest).ino;
        fs.writeFileSync(path.join(dest, 'old-version-only.js'), 'x');
        r = await run(home);
        assert.match(r.out, /已下載 VaxCheck v9\.9\.9/, r.out);
        assert.equal(fs.statSync(dest).ino, ino, '資料夾本身不重建');
        assert.ok(!fs.existsSync(path.join(dest, 'old-version-only.js')), '舊版多出的檔案要清掉');
        // 3. 校驗不符:停止、不動現有安裝
        badHash = true;
        fs.writeFileSync(path.join(dest, 'keep.txt'), 'x');
        r = await run(home);
        assert.match(r.out, /校驗不符/, r.out);
        assert.ok(fs.existsSync(path.join(dest, 'keep.txt')) && fs.existsSync(path.join(dest, 'manifest.json')));
        badHash = false;
        // 4. 桌面已有同名但不是 VaxCheck 的資料夾:不刪
        const home2 = path.join(T, 'home2');
        fs.mkdirSync(path.join(home2, 'Desktop', 'vaxcheck'), { recursive: true });
        fs.writeFileSync(path.join(home2, 'Desktop', 'vaxcheck', 'notes.txt'), '我的筆記');
        r = await run(home2);
        assert.match(r.out, /為避免誤刪已停止/, r.out);
        assert.equal(fs.readFileSync(path.join(home2, 'Desktop', 'vaxcheck', 'notes.txt'), 'utf8'), '我的筆記');
        assert.ok(!fs.existsSync(path.join(home2, 'Desktop', 'vaxcheck', 'manifest.json')));
      } finally { server.close(); }
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });
