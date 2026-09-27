const $ = (id) => document.getElementById(id);
const DEFAULTS = { jurisdiction: 'TW', niisUrl: 'https://10.241.219.35/', autoClickNiis: false, remoteRulesBase: '', pinBundled: false };
(async () => {
  const o = { ...DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(DEFAULTS))) };
  const m = await (await fetch(chrome.runtime.getURL('rules/manifest.json'))).json();
  for (const [code, v] of Object.entries(m.latest)) $('jur').append(new Option(`${v.name || code}(規則 ${v.version})`, code));
  $('jur').value = m.latest[o.jurisdiction] ? o.jurisdiction : 'TW';
  $('auto').checked = o.autoClickNiis; $('niis').value = o.niisUrl; $('remote').value = o.remoteRulesBase; $('pin').checked = o.pinBundled;
  $('save').onclick = async () => {
    const remote = $('remote').value.trim();
    if (remote) {
      let origin; try { origin = new URL(remote).origin + '/*'; } catch { $('msg').textContent = '線上規則位址格式錯誤'; return; }
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) { $('msg').textContent = '未授權連線,線上規則未啟用'; return; }
    }
    await chrome.storage.sync.set({ jurisdiction: $('jur').value, autoClickNiis: $('auto').checked, niisUrl: $('niis').value.trim() || DEFAULTS.niisUrl, remoteRulesBase: remote, pinBundled: $('pin').checked });
    await chrome.storage.local.remove('rulesCache');
    $('msg').textContent = '已儲存';
  };
})();
