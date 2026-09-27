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
  };
})();
