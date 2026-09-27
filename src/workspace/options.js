// 工作站設定(chrome.storage.sync):預設值、讀取、網址檢查。background 與設定頁共用。
export const MEDCLOUD_ORIGIN = 'https://medcloud2.nhi.gov.tw';
export const NIIS_ORIGIN = 'https://10.241.219.35';

export const DEFAULTS = {
  jurisdiction: 'TW',
  // 待院內確認插卡後的實際路徑(參考 repo 寫 /imu/IMUE2000/IMUE2000)
  medcloudEntryUrl: `${MEDCLOUD_ORIGIN}/imu/IMUE1000/IMUE2000`,
  niisQueryUrl: `${NIIS_ORIGIN}/`,
  autoClickNiis: false,
  autoSwitchCard: true,
  remoteRulesBase: '',
  pinBundled: false,
};

/** 讀設定;舊版欄位 niisUrl 沿用為 niisQueryUrl */
export async function readOptions(sync) {
  const stored = await sync.get([...Object.keys(DEFAULTS), 'niisUrl']);
  if (stored.niisQueryUrl === undefined && stored.niisUrl) stored.niisQueryUrl = stored.niisUrl;
  delete stored.niisUrl;
  return { ...DEFAULTS, ...stored };
}

/** 空白 → 'empty';無法解析或不在外掛可存取的主機 → 'invalid';正確 → null */
export function checkUrl(value, origin) {
  if (typeof value !== 'string' || !value.trim()) return 'empty';
  let u;
  try { u = new URL(value.trim()); } catch { return 'invalid'; }
  return u.origin === origin ? null : 'invalid';
}

export const URL_FIELDS = {
  medcloudEntryUrl: { origin: MEDCLOUD_ORIGIN, label: '健保雲端入口網址' },
  niisQueryUrl: { origin: NIIS_ORIGIN, label: 'NIIS 查詢頁網址' },
};

/** 回傳 { 欄位: 'empty'|'invalid' };全部正確回 null */
export function validateWorkspaceOptions(o) {
  const out = {};
  for (const [k, f] of Object.entries(URL_FIELDS)) { const p = checkUrl(o[k], f.origin); if (p) out[k] = p; }
  return Object.keys(out).length ? out : null;
}

/** 同一頁:origin + pathname 相同(忽略查詢字串、#、結尾斜線) */
export function samePage(a, b) {
  try {
    const x = new URL(a); const y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '');
  } catch { return false; }
}
