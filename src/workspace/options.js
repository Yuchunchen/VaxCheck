// 工作站設定(chrome.storage.sync):預設值、讀取、網址檢查。background 與設定頁共用。
export const MEDCLOUD_ORIGIN = 'https://medcloud2.nhi.gov.tw';
export const NIIS_ORIGIN = 'https://10.241.219.35';

export const DEFAULTS = {
  jurisdiction: 'TW',
  // 登入頁 + type=icc → 實體健保卡自動登入(健保署未公開參數,備援見 login.js)
  medcloudEntryUrl: `${MEDCLOUD_ORIGIN}/imu/IMUE1000/?type=icc`,
  niisQueryUrl: `${NIIS_ORIGIN}/`,
  autoClickNiis: false,
  autoSwitchCard: true,
  remoteRulesBase: '',
  pinBundled: false,
};

/** v0.4.9 的預設入口(未登入會停在 /imu/IMUE1000/);升級時換成新預設,使用者自訂值不動 */
export const OLD_DEFAULT_ENTRY = `${MEDCLOUD_ORIGIN}/imu/IMUE1000/IMUE2000`;

/** 讀設定;舊版欄位 niisUrl 沿用為 niisQueryUrl;舊預設入口視同新預設 */
export async function readOptions(sync) {
  const stored = await sync.get([...Object.keys(DEFAULTS), 'niisUrl']);
  if (stored.niisQueryUrl === undefined && stored.niisUrl) stored.niisQueryUrl = stored.niisUrl;
  delete stored.niisUrl;
  if (stored.medcloudEntryUrl === OLD_DEFAULT_ENTRY) stored.medcloudEntryUrl = DEFAULTS.medcloudEntryUrl;
  return { ...DEFAULTS, ...stored };
}

/** 升級遷移(寫回 storage):只換掉舊預設值。回傳是否有變更 */
export async function migrateOptions(sync) {
  const { medcloudEntryUrl } = await sync.get('medcloudEntryUrl');
  if (medcloudEntryUrl !== OLD_DEFAULT_ENTRY) return false;
  await sync.set({ medcloudEntryUrl: DEFAULTS.medcloudEntryUrl });
  return true;
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
