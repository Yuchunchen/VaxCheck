// NIIS(10.241.219.35)content script:偵測結果表 → 解析 → 身分證雜湊 → 交 background 核對
import codes from '../../rules/niis-vaccine-codes.json';
import { makeCodeTable, parseNiisDocument } from '../adapters/niis/parse.js';
import { sha256Hex } from '../adapters/nhi/token.js';

const table = makeCodeTable(codes);
let lastSig = null;

function toast(text, tone = 'info') {
  let host = document.getElementById('vaxcheck-toast');
  if (!host) { host = document.createElement('div'); host.id = 'vaxcheck-toast'; host.attachShadow({ mode: 'open' }); document.documentElement.append(host); }
  const bg = tone === 'stop' ? '#B3261E' : tone === 'ok' ? '#1E7B4F' : '#1C2B3A';
  host.shadowRoot.innerHTML = `<div style="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:${bg};color:#fff;padding:10px 16px;border-radius:6px;font:14px 'Microsoft JhengHei',system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25)">${text}</div>`;
  clearTimeout(toast.t); toast.t = setTimeout(() => host.remove(), 6000);
}

async function scan() {
  const res = document.querySelector('#div_result');
  if (!res || !res.querySelector('table')) return;
  const sig = res.textContent.length + ':' + res.textContent.slice(0, 200);
  if (sig === lastSig) return;
  lastSig = sig;
  const r = parseNiisDocument(document, table);
  if (!r.found) return;
  if (!r.rocId) { toast('疫苗檢核:頁面上找不到身分證欄位,無法核對身分,未擷取', 'stop'); return; }
  const idHash = await sha256Hex(r.rocId);
  const reply = await chrome.runtime.sendMessage({ type: 'niis:result', idHash, records: r.records, meta: r.meta });
  if (reply?.ok) toast(`疫苗檢核:已擷取 ${reply.count} 筆接種紀錄${r.meta.unmapped.length ? `(${r.meta.unmapped.length} 筆未對應)` : ''}`, 'ok');
  else if (reply?.reason === 'mismatch') toast('疫苗檢核:NIIS 查詢的身分與健保雲端不同,未併入', 'stop');
  else if (reply?.reason === 'no_session') toast('疫苗檢核:健保雲端尚未開啟本病患', 'stop');
}

async function maybeAutoClick() {
  if (!location.hash.includes('vaxcheck') || sessionStorage.getItem('vaxcheck-clicked')) return;
  const r = await chrome.runtime.sendMessage({ type: 'options:get' });
  if (!r?.options?.autoClickNiis) return;
  const btn = document.querySelector('#btn_Query');
  if (btn) { sessionStorage.setItem('vaxcheck-clicked', '1'); setTimeout(() => btn.click(), 800); }
}

new MutationObserver(() => { clearTimeout(scan.t); scan.t = setTimeout(scan, 300); }).observe(document.documentElement, { childList: true, subtree: true });
scan();
maybeAutoClick();
