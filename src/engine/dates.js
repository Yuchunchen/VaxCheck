// 日期工具:一律用 'YYYY-MM-DD' 字串,UTC 計算,避免時區偏移
const pad = (n) => String(n).padStart(2, '0');

export function toISO(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
export function split(iso) { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return [y, m, d]; }
export function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
export function daysInMonth(y, m) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }

export function addDays(iso, n) {
  const [y, m, d] = split(iso);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 曆法間隔。月底溢位(如 2/29 + 1 年)取保守的較晚日 → 下月 1 日 */
export function addInterval(iso, { years = 0, months = 0, days = 0 } = {}) {
  let [y, m, d] = split(iso);
  y += years; m += months;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  if (d > daysInMonth(y, m)) { d = 1; m += 1; if (m > 12) { m = 1; y += 1; } }
  return days ? addDays(toISO(y, m, d), days) : toISO(y, m, d);
}

export const maxDate = (...ds) => ds.filter(Boolean).sort().at(-1);
export const minDate = (...ds) => ds.filter(Boolean).sort()[0];

/** 實足年齡(年) */
export function ageYears(birth, asOf) {
  const [by, bm, bd] = split(birth); const [y, m, d] = split(asOf);
  return y - by - ((m < bm || (m === bm && d < bd)) ? 1 : 0);
}

/** 民國 7 碼 YYYMMDD → ISO;亦接受 YYYY/MM/DD、YYYY-MM-DDTHH… */
export function normDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = /^(\d{3})(\d{2})(\d{2})$/.exec(t);
  if (m) return toISO(Number(m[1]) + 1911, Number(m[2]), Number(m[3]));
  m = /^(\d{2,3})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(t);
  if (m && m[1].length <= 3) return toISO(Number(m[1]) + 1911, Number(m[2]), Number(m[3]));
  m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(t);
  if (m) return toISO(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

export function todayISO() {
  const t = new Date();
  return toISO(t.getFullYear(), t.getMonth() + 1, t.getDate());
}
