// 面板排序(只在渲染層;engine Result 維持規則順序,稽核與匯出不受影響)。純函式,可在 Node 測試。
export const GROUPS = [
  { key: 'go', label: '可接種' },
  { key: 'check', label: '待確認' },
  { key: 'no', label: '不符合' },
];

const CHECK = new Set(['needs_input', 'unknown_source', 'needs_review', 'pending_history']);
const NO = new Set(['ineligible', 'completed', 'not_funded', 'wait', 'not_open', 'out_of_season', 'scheduled']);

/** 可接種 = eligible 且今日可打(dosing due);表上未列的 verdict 一律待確認(不歸入可接種) */
export function groupOf(v) {
  if (v.verdict === 'eligible') return !v.dosing || v.dosing.status === 'due' ? 'go' : 'check';
  if (v.dosing?.alternative || v.dosing?.status === 'pending_case') return 'check';   // 待定 case
  if (CHECK.has(v.verdict)) return 'check';
  if (NO.has(v.verdict)) return 'no';
  return 'check';
}

/** 回 [{ key, label, items }],空組不列;組內維持規則原始順序 */
export function groupVaccines(vaccines) {
  const by = Object.fromEntries(GROUPS.map((g) => [g.key, []]));
  for (const v of vaccines || []) by[groupOf(v)].push(v);
  return GROUPS.map((g) => ({ ...g, items: by[g.key] })).filter((g) => g.items.length);
}

/** 判定依據:true → 未確認 → false;同值維持原順序 */
export function sortTrace(trace) {
  const rank = (x) => (x.value === true ? 0 : x.value === false ? 2 : 1);
  return (trace || []).map((g, i) => [g, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([g]) => g);
}
