// 端對端用的偽造健保雲端與 NIIS:本機 HTTPS + CONNECT 代理(Chromium 以 --proxy-server 指向此處)。
// 外掛自己用 chrome.tabs.create / update 開的分頁不經 Playwright 路由,所以改走真的網路層。
// NIIS 頁面只模擬結構(#btn_Query、#tb_RocID、#tb_bd、#cb_reader、PostBack 回根網址),不含疾管署原始程式碼。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

export const jwt = (p) => 'h.' + Buffer.from(JSON.stringify(p)).toString('base64url') + '.s';

function selfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-cert-'));
  const key = path.join(dir, 'k.pem'); const cert = path.join(dir, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=vaxcheck-e2e',
    '-addext', 'subjectAltName=DNS:medcloud2.nhi.gov.tw,IP:10.241.219.35'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const NIIS_RECORDS = {
  A123456789: [['13PCV-1', '13價結合型肺炎鏈球菌疫苗', '1150601'], ['Flu-1', '流感疫苗', '1141020']],
  Z999999999: [['Flu-1', '流感疫苗', '1131020']],
};

/**
 * state.mc: { current, next, tokenDelayMs, switchDelayMs, tokenAt[], iccWorks, iccDelayMs, loginHits[type], loginBtnClicks }
 * state.niis: { card(身分證或 null=未插卡), gets, posts[{ at, rocId }] }
 */
export async function startFakeSites({ fake }) {
  const state = {
    mc: { current: null, next: null, tokenDelayMs: 0, switchDelayMs: 2000, tokenAt: [], iccWorks: true, iccDelayMs: 2000, loginHits: [], loginBtnClicks: 0 },
    niis: { card: null, gets: 0, posts: [] },
  };

  const medcloudHtml = (p) => `<!doctype html><html><head><meta charset="utf-8"><title>健保雲端(偽)</title></head><body style="font-family:sans-serif;background:#f6f7f9">
<h2>健保醫療資訊雲端查詢系統(測試頁)</h2><p>病患:<span id="who">${p ? p.UserName : '(未登入)'}</span></p>
<p><a id="sw" href="javascript:void(0)">請換卡再按我</a></p>
<script>
const TOKEN = ${JSON.stringify(p ? jwt(p) : '')};
const mark = () => fetch('/imu/__token_set', { method: 'POST' });
function setToken(t) { if (!t) return; sessionStorage.setItem('token', t); mark(); }
${state.mc.tokenDelayMs ? `setTimeout(() => setToken(TOKEN), ${state.mc.tokenDelayMs});` : 'setToken(TOKEN);'}
document.getElementById('sw').addEventListener('click', () => {
  fetch('/imu/__switch', { method: 'POST' }).then((r) => r.text()).then((t) => { if (t) setTimeout(() => setToken(t), ${state.mc.switchDelayMs}); });
});
</script></body></html>`;

  // 登入頁(/imu/IMUE1000/,history mode):mounted() 清空 sessionStorage;type=icc → 模擬實體健保卡登入;
  // 登入成功 → 寫 token、pushState 到 IMUE2000(同一份文件,content script 不重載)。只模擬結構,不含健保署程式碼。
  const loginHtml = (type) => `<!doctype html><html><head><meta charset="utf-8"><title>健保雲端登入(偽)</title></head><body style="font-family:sans-serif">
<div id="login"><h2>健保醫療資訊雲端查詢系統 登入</h2>
<a class="login-btn" href="javascript:void(0)" id="icc">健保雲端系統2.0(實體健保卡)</a> <a class="login-btn" href="javascript:void(0)">健保雲端系統2.0(虛擬健保卡)</a></div>
<div id="main" hidden><p>病患:<span id="who"></span></p><p><a id="sw" href="javascript:void(0)">請換卡再按我</a></p></div>
<script>
sessionStorage.clear();
const mark = () => fetch('/imu/__token_set', { method: 'POST' });
function setToken(t) { if (!t) return; sessionStorage.setItem('token', t); mark(); }
function login() {
  fetch('/imu/__login', { method: 'POST' }).then((r) => r.text()).then((t) => {
    setToken(t);
    history.pushState({}, '', '/imu/IMUE1000/IMUE2000');
    document.getElementById('login').hidden = true; document.getElementById('main').hidden = false;
  });
}
${type === 'icc' && state.mc.iccWorks ? `setTimeout(login, ${state.mc.iccDelayMs});` : ''}
document.getElementById('icc').addEventListener('click', () => { fetch('/imu/__login_btn', { method: 'POST' }); setTimeout(login, 1000); });
document.getElementById('sw').addEventListener('click', () => {
  fetch('/imu/__switch', { method: 'POST' }).then((r) => r.text()).then((t) => { if (t) setTimeout(() => setToken(t), ${state.mc.switchDelayMs}); });
});
</script></body></html>`;

  const niisPage = ({ rocId = '', result = null }) => `<!doctype html><html><head><meta charset="utf-8"><title>NIIS(偽)</title></head><body style="font-family:sans-serif">
<h2>全國性預防接種資訊管理系統(測試頁)</h2>
<form method="post" action="/" id="form1">
<input type="hidden" id="tb_RocID" name="tb_RocID" value="${rocId}"><input type="hidden" id="tb_bd" name="tb_bd" value="">
<label><input type="checkbox" id="cb_reader" name="cb_reader" checked>使用健保IC卡讀卡機</label>
<input type="submit" id="btn_Query" name="btn_Query" value="讀取健保卡及醫事人員卡" onclick="return CheckInput();">
</form>
<script>
const CARD = ${JSON.stringify(state.niis.card)};
// 模擬讀卡:成功則填入隱藏欄位;失敗時真實頁面只跳 alert,仍回傳 true 送出表單
function CheckInput() {
  if (CARD) { document.getElementById('tb_RocID').value = CARD; document.getElementById('tb_bd').value = '0470302'; }
  else window.__readFailed = true;
  return true;
}
</script>
${result === null ? '' : `<div id="div_result"><section class="tabs"><span class="tabItem active">預防接種紀錄</span><div class="tabContent"><div class="dataTb"><table>
<tr><td>序號</td><td>劑別代號</td><td>疫苗中文名稱</td><td>接種日</td><td>批號類型</td><td>接種單位</td></tr>
${result.length ? result.map(([l, n, d], i) => `<tr><td>${i + 1}</td><td>${l}</td><td>${n}</td><td>${d}</td><td>公費</td><td>某衛生所</td></tr>`).join('') : '<tr><td colspan="6">本個案查無接種紀錄</td></tr>'}
</table></div></div></section></div>`}
</body></html>`;

  const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
  const html = (res, s) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(s); };

  async function app(req, res) {
    const host = (req.headers.host || '').split(':')[0];
    const u = new URL(req.url, `https://${host}`);
    if (host === 'medcloud2.nhi.gov.tw') {
      if (u.pathname === '/imu/__token_set') { state.mc.tokenAt.push(Date.now()); res.end(); return; }
      if (u.pathname === '/imu/__login') { res.end(state.mc.current ? jwt(state.mc.current) : ''); return; }
      if (u.pathname === '/imu/__login_btn') { state.mc.loginBtnClicks++; res.end(); return; }
      if (u.pathname === '/imu/IMUE1000/' || u.pathname === '/imu/IMUE1000') {
        const type = u.searchParams.get('type') || '';
        state.mc.loginHits.push(type);
        return html(res, loginHtml(type));
      }
      if (u.pathname === '/imu/__switch') { const n = state.mc.next; state.mc.next = null; if (n) state.mc.current = n; res.end(n ? jwt(n) : ''); return; }
      if (u.pathname.startsWith('/imu/api/')) {
        if (!(req.headers.authorization || '').startsWith('Bearer ')) { res.writeHead(401); res.end(); return; }
        const p = u.pathname;
        const data = p.includes('imue0008') ? fake.medication : p.includes('imue0060') ? fake.lab : p.includes('imue0040') ? fake.allergy
          : p.includes('imue2000') ? fake.summary : p.includes('imue0190') ? { robject: { drugs: [], medical_service: [], special_material: [] } } : {};
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); return;
      }
      return html(res, medcloudHtml(state.mc.current));
    }
    if (host === '10.241.219.35') {
      if (req.method === 'POST') {
        const rocId = new URLSearchParams(await body(req)).get('tb_RocID') || '';
        state.niis.posts.push({ at: Date.now(), rocId });
        return html(res, niisPage({ rocId, result: NIIS_RECORDS[rocId] || [] }));   // 身分為空也照樣回「查無」(真實伺服器行為的最壞情況)
      }
      if (u.pathname === '/') state.niis.gets++;
      return html(res, niisPage({}));
    }
    res.writeHead(404); res.end();
  }

  const tlsServer = https.createServer(selfSignedCert(), (req, res) => { app(req, res).catch((e) => { res.writeHead(500); res.end(String(e)); }); });
  const proxy = http.createServer((req, res) => { res.writeHead(403); res.end(); });
  proxy.on('connect', (req, socket, head) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) socket.unshift(head);
    tlsServer.emit('connection', socket);
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  return { state, proxyUrl: `http://127.0.0.1:${proxy.address().port}`, close: () => { proxy.close(); tlsServer.close(); } };
}
