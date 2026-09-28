import { URL_FIELDS, readOptions, validateWorkspaceOptions } from '../workspace/options.js';

const $ = (id) => document.getElementById(id);
const FIELD_ID = { medcloudEntryUrl: 'medcloud', niisQueryUrl: 'niis' };
$('ver').textContent = `v${chrome.runtime.getManifest().version}`;

function showProblems(problems) {
  const keys = Object.keys(problems || {});
  for (const [k, id] of Object.entries(FIELD_ID)) $(id).classList.toggle('bad', keys.includes(k));
  $('problem').hidden = !keys.length;
  $('problem').textContent = keys.length ? `請先填寫正確的${keys.map((k) => URL_FIELDS[k].label).join('、')}(${keys.map((k) => URL_FIELDS[k].origin).join('、')} 開頭),再按標題列圖示。` : '';
}

(async () => {
  const o = await readOptions(chrome.storage.sync);
  const m = await (await fetch(chrome.runtime.getURL('rules/manifest.json'))).json();
  for (const [code, v] of Object.entries(m.latest)) $('jur').append(new Option(`${v.name || code}(規則 ${v.version})`, code));
  $('jur').value = m.latest[o.jurisdiction] ? o.jurisdiction : 'TW';
  $('auto').checked = o.autoClickNiis; $('switch').checked = o.autoSwitchCard;
  $('medcloud').value = o.medcloudEntryUrl; $('niis').value = o.niisQueryUrl;
  $('remote').value = o.remoteRulesBase; $('pin').checked = o.pinBundled;
  // 按圖示時設定不完整 → background 以 ?problem= 開啟本頁
  if (new URLSearchParams(location.search).get('problem')) showProblems(validateWorkspaceOptions(o));
  // 規則狀態與手動更新(background 抓線上規則,結果寫入快取;面板下次開啟即用新規則)
  const fmt = (t) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '—');
  const showRules = (r) => {
    if (!r?.ok) { $('rstat').textContent = '無法讀取規則狀態'; return; }
    $('rstat').textContent = !r.remoteEnabled
      ? `只用內建規則 ${r.bundled}(線上規則已停用)`
      : `內建 ${r.bundled};線上 ${r.cached || '尚未下載'};上次更新 ${fmt(r.fetchedAt)};下次自動檢查 ${fmt(r.nextCheck)}`;
    $('refresh').disabled = !r.remoteEnabled;
  };
  showRules(await chrome.runtime.sendMessage({ type: 'rules:status' }));
  $('refresh').onclick = async () => {
    $('rmsg').textContent = '更新中…'; $('rmsg').className = ''; $('refresh').disabled = true;
    const r = await chrome.runtime.sendMessage({ type: 'rules:refresh' }).catch((e) => ({ ok: false, error: String(e) }));
    showRules(r);
    if (r?.error || !r?.ok) { $('rmsg').textContent = `更新失敗:${r?.error || r?.reason || '未知'}(面板改用上次下載或內建規則)`; $('rmsg').className = 'err'; }
    else $('rmsg').textContent = `已更新,線上規則 ${r.cached}。已開啟的健保雲端分頁請重新整理`;
    $('refresh').disabled = !r?.remoteEnabled;
  };
  $('save').onclick = async () => {
    $('msg').textContent = '';
    const urls = { medcloudEntryUrl: $('medcloud').value.trim(), niisQueryUrl: $('niis').value.trim() };
    const problems = validateWorkspaceOptions(urls);
    showProblems(problems);
    if (problems) { $('msg').textContent = '網址格式錯誤,未儲存'; return; }
    const remote = $('remote').value.trim();
    if (remote) {
      let origin; try { origin = new URL(remote).origin + '/*'; } catch { $('msg').textContent = '線上規則位址格式錯誤'; return; }
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) { $('msg').textContent = '未授權連線,線上規則未啟用'; return; }
    }
    await chrome.storage.sync.set({ jurisdiction: $('jur').value, ...urls, autoClickNiis: $('auto').checked, autoSwitchCard: $('switch').checked, remoteRulesBase: remote, pinBundled: $('pin').checked });
    await chrome.storage.sync.remove('niisUrl');   // 舊欄位
    await chrome.storage.local.remove('rulesCache');
    $('msg').textContent = '已儲存';
    showRules(await chrome.runtime.sendMessage({ type: 'rules:status' }));
  };
})();
