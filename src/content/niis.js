// NIIS(10.241.219.35)content script:回報頁面狀態 → 偵測結果表 → 解析 → 身分證雜湊 → 交 background 核對;
// 工作區操作時由 background 通知代按「讀取健保卡及醫事人員卡」(#btn_Query)。
import codes from '../../rules/niis-vaccine-codes.json';
import { makeCodeTable, niisVaccinations, parseNiisDocument } from '../adapters/niis/parse.js';
import { sha256Hex } from '../adapters/nhi/token.js';

const table = makeCodeTable(codes);
const log = (...a) => console.info('[疫苗檢核]', ...a);
let lastSig = null;

function toast(text, tone = 'info') {
  let host = document.getElementById('vaxcheck-toast');
  if (!host) { host = document.createElement('div'); host.id = 'vaxcheck-toast'; host.attachShadow({ mode: 'open' }); document.documentElement.append(host); }
  const [bg, fg] = tone === 'stop' ? ['#B3261E', '#fff'] : tone === 'ok' ? ['#1E7B4F', '#fff'] : tone === 'warn' ? ['#F2C94C', '#1C2B3A'] : ['#1C2B3A', '#fff'];
  host.shadowRoot.innerHTML = `<div style="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:${bg};color:${fg};padding:10px 16px;border-radius:6px;font:14px 'Microsoft JhengHei',system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25)">${text}</div>`;
  clearTimeout(toast.t); toast.t = setTimeout(() => host.remove(), tone === 'warn' ? 15000 : 6000);
}

async function scan() {
  const res = document.querySelector('#div_result');
  if (!res || !res.querySelector('table')) return;
  const sig = res.textContent.length + ':' + res.textContent.slice(0, 200);
  if (sig === lastSig) return;
  lastSig = sig;
  const r = parseNiisDocument(document, table);
  const v = await niisVaccinations(r, sha256Hex);
  if (!v) return;
  if (v.status === 'error') {
    // 讀卡失敗頁面仍會送出:身分為空的「查無接種紀錄」不可當成 0 筆
    toast('疫苗檢核:NIIS 未讀到健保卡,接種史未更新', 'warn');
    log('NIIS 未讀到健保卡(#tb_RocID 為空),接種史未更新');
    chrome.runtime.sendMessage({ type: 'niis:no_identity' }).catch(() => {});
    return;
  }
  const reply = await chrome.runtime.sendMessage({ type: 'niis:result', idHash: v.idHash, records: v.records, meta: r.meta });
  if (reply?.ok) toast(`疫苗檢核:已擷取 ${reply.count} 筆接種紀錄${r.meta.unmapped.length ? `(${r.meta.unmapped.length} 筆未對應)` : ''}`, 'ok');
  else if (reply?.reason === 'mismatch') toast('疫苗檢核:NIIS 查詢的身分與健保雲端不同,未併入', 'stop');
  else if (reply?.reason === 'no_session') toast('疫苗檢核:健保雲端尚未開啟本病患', 'stop');
}

// 代按讀卡鈕:inline onclick="return CheckInput();" 會在頁面環境同步讀卡後送出表單。
// 讀卡失敗時頁面自行跳 alert;外掛不重試、不處理 alert。同一操作只點一次。
function autoClick(opId) {
  const btn = document.querySelector('#btn_Query');
  const key = `vaxcheck-clicked:${opId}`;
  if (!btn || document.querySelector('#div_result') || sessionStorage.getItem(key)) return false;
  sessionStorage.setItem(key, '1');
  setTimeout(() => { log('代按 NIIS 讀卡鈕'); btn.click(); }, 300);   // 先回覆 background,再進入同步讀卡
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'niis:autoclick') reply({ ok: true, clicked: autoClick(msg.opId) });
});

new MutationObserver(() => { clearTimeout(scan.t); scan.t = setTimeout(scan, 300); }).observe(document.documentElement, { childList: true, subtree: true });
log(`NIIS 已載入 v${chrome.runtime.getManifest().version}`);
(async () => {
  // 先回報頁面狀態(全新查詢頁或已有結果),再解析,確保 background 先清掉舊的身分雜湊
  await chrome.runtime.sendMessage({ type: 'niis:page', url: location.href, hasResult: !!document.querySelector('#div_result') }).catch(() => {});
  scan();
})();
