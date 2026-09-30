// 劑次:mode series(流感等)與 mode cases(肺鏈:依接種史組合逐案判定)
import { addDays, addInterval, maxDate } from './dates.js';
import { evalCond, sourceOk } from './conditions.js';

const recsOf = (facts) => facts.vaccinations?.records || [];
const lastDateOf = (recs) => recs.map((r) => r.date).filter(Boolean).sort().at(-1) || null;

// ---------- series ----------
// variants:依年齡(本季第 1 劑接種日,未打則今日)與季前累計劑數分流,第一個符合者的 series 取代預設
function pickVariant(dosing, allRecs, seasonRecs, s, ctx) {
  if (!dosing.variants?.length) return null;
  const birth = ctx.facts.patient?.birthDate;
  const firstInSeason = seasonRecs.map((r) => r.date).filter(Boolean).sort()[0];
  const refDate = firstInSeason || ctx.asOf;
  const prior = s ? allRecs.filter((r) => !r.date || r.date < s.start).length : 0;
  for (const v of dosing.variants) {
    if (v.age) {
      if (!birth) return { unknown: true };
      const t = evalCond({ age: v.age }, { ...ctx, asOf: refDate });
      if (t.v !== true) continue;
    }
    if (v.priorDoses) {
      if (v.priorDoses.min != null && prior < v.priorDoses.min) continue;
      if (v.priorDoses.max != null && prior > v.priorDoses.max) continue;
    }
    return { variant: v, prior };
  }
  return null;
}

export function computeSeries(dosing, vaccine, ctx) {
  const facts = ctx.facts;
  if (!sourceOk(facts, 'niis')) return { status: 'pending_history' };
  const codes = vaccine.historyMatch?.vaccineCodes || [];
  const allRecs = recsOf(facts).filter((r) => codes.includes(r.code));
  let recs = allRecs;
  const s = vaccine.season;
  // 接種史的季:start ~ historyEnd(未定義則 end)。10/1 前的紀錄算上一季;10/1 起到隔年 9/30 算本季
  if (dosing.seasonal && s) recs = recs.filter((r) => r.date && r.date >= s.start && r.date <= (s.historyEnd || s.end));
  const flags = recs.some((r) => !r.date) ? ['NEED_DATE_CONFIRMATION'] : [];
  const pick = pickVariant(dosing, allRecs, recs, dosing.seasonal ? s : null, ctx);
  if (pick?.unknown) return { status: 'needs_review', note: '缺生日,無法判定本季應接種劑數', flags };
  const variant = pick?.variant ? { id: pick.variant.id, label: pick.variant.label, sourceRef: pick.variant.sourceRef, priorDoses: pick.prior } : null;
  const series = pick?.variant?.series || dosing.series || [];
  const n = recs.length;
  const lastDate = lastDateOf(recs);
  const lastAny = lastDateOf(allRecs);               // 間隔以「前 1 劑」計,不限本季(新冠:與上季末劑間隔 12 週)
  if (n >= series.length) return { status: 'completed', lastDate, dosesGiven: n, dosesRequired: series.length, variant, flags };
  const next = series[n];
  let earliest = ctx.asOf;
  if (next.minIntervalDays && lastAny) earliest = maxDate(earliest, addDays(lastAny, next.minIntervalDays));
  if (next.minAge && facts.patient?.birthDate) earliest = maxDate(earliest, addInterval(facts.patient.birthDate, next.minAge));
  if (next.requiresPrior) {
    const prior = recsOf(facts).filter((r) => next.requiresPrior.vaccineCodes.includes(r.code));
    if (!prior.length) return { status: 'needs_review', note: `需先接種 ${next.requiresPrior.vaccineCodes.join('/')}`, variant, flags };
    const pd = lastDateOf(prior);
    if (pd) earliest = maxDate(earliest, addDays(pd, next.requiresPrior.minIntervalDays));
  }
  return { status: earliest <= ctx.asOf ? 'due' : 'wait', dose: next.dose, label: next.label, earliestDate: earliest, lastDate, dosesGiven: n, dosesRequired: series.length, variant, flags };
}

// ---------- cases ----------
function hasCodes(p) { return Array.isArray(p) ? p : p.codes; }
function evalHist(p, recs) {
  const [k] = Object.keys(p);
  if (k === 'all') return p.all.every((c) => evalHist(c, recs));
  if (k === 'any') return p.any.some((c) => evalHist(c, recs));
  if (k === 'not') return !evalHist(p.not, recs);
  if (k === 'none') return !recs.some((r) => p.none.includes(r.code));
  if (k === 'has') {
    const h = p.has;
    const codes = hasCodes(h);
    const hit = recs.filter((r) => codes.includes(r.code) && (Array.isArray(h) || !h.funding || r.funding === h.funding));
    return hit.length >= (Array.isArray(h) ? 1 : h.minDoses || 1);
  }
  throw new Error(`未知接種史述詞:${k}`);
}
function codesInHas(p, out = new Set()) {
  const [k] = Object.keys(p);
  if (k === 'has') hasCodes(p.has).forEach((c) => out.add(c));
  else if (k === 'all' || k === 'any') p[k].forEach((c) => codesInHas(c, out));
  else if (k === 'not') codesInHas(p.not, out);
  return out;
}
const caseInfo = (c) => ({ id: c.id, label: c.label, note: c.then.note, sourceRef: c.sourceRef });

// 一個 case 的 then → 劑次結果(complete / notFunded / review / give 算 earliestDate)
function caseResult(c, recs, ctx, flags) {
  const info = caseInfo(c);
  const a = c.then.action;
  if (a === 'complete') return { status: 'completed', case: info, lastDate: lastDateOf(recs.filter((r) => codesInHas(c.when).has(r.code))), flags };
  if (a === 'notFunded') return { status: 'not_funded', case: info, flags };
  if (a === 'review') return { status: 'needs_review', case: info, flags };
  // give
  const from = c.then.intervalFrom || [...codesInHas(c.when)];
  const prior = recs.filter((r) => from.includes(r.code));
  if (prior.some((r) => !r.date)) flags.push('NEED_DATE_CONFIRMATION');
  const last = lastDateOf(prior);
  let earliest = ctx.asOf;
  if (last && c.then.minInterval) earliest = maxDate(earliest, addInterval(last, c.then.minInterval));
  if (last && c.then.minIntervalDays != null) earliest = maxDate(earliest, addDays(last, c.then.minIntervalDays));
  return { status: earliest <= ctx.asOf ? 'due' : 'wait', case: info, dose: c.then.dose || 1, earliestDate: earliest, lastDate: last, flags };
}

/** 劑次層摘要(dosing.fallback / dosing.upgrade 共用) */
export function brief(r) {
  if (!r) return null;
  return { status: r.status, caseId: r.case?.id || null, label: r.case?.label || r.label || null, earliestDate: r.earliestDate || null, dose: r.dose ?? null, lastDate: r.lastDate || null };
}
const GIVE = new Set(['due', 'wait']);
// 待定 case 確認後是否比保底更好:give 且較早,或保底為已完成/不再公費/需人工/不存在;review 視為「今天可能可打」
function improves(up, fb, asOf) {
  if (!up || !(GIVE.has(up.status) || up.status === 'needs_review')) return false;
  if (!fb || !GIVE.has(fb.status)) return true;
  return (up.earliestDate || asOf) < fb.earliestDate;
}

export function computeCases(dosing, vaccine, ctx) {
  const facts = ctx.facts;
  if (!sourceOk(facts, 'niis')) return { status: 'pending_history', fallback: null, upgrade: null };
  const recs = recsOf(facts);
  const flags = [];
  if (dosing.unknownTypeCodes?.length && recs.some((r) => dosing.unknownTypeCodes.includes(r.code))) {
    const res = { status: 'needs_review', flags: ['NEED_HISTORY_CONFIRMATION'], note: '接種史有型別不明的肺鏈紀錄,請人工確認' };
    return { ...res, fallback: brief(res), upgrade: null };
  }
  let pending = null;
  // §4 劑次層:fallback = 第一個確定 case 的結果;upgrade = 其前第一個待定 case 確認後的結果(較好時才列)
  const layers = (res) => ({
    fallback: brief(res),
    upgrade: pending && improves(pending.res, res, ctx.asOf) ? { ...brief(pending.res), requires: pending.manual, sources: pending.sources } : null,
  });
  const withPending = (res) => (pending ? { status: 'pending_case', case: pending.info, pendingManual: pending.manual, pendingSources: pending.sources, alternative: res, flags, ...layers(res) } : { ...res, ...layers(res) });

  for (const c of dosing.cases) {
    if (!evalHist(c.when, recs)) continue;
    if (c.criteria) {
      const t = evalCond(c.criteria, ctx);
      if (t.v === false) continue;
      if (t.v === null) { if (!pending) pending = { info: caseInfo(c), manual: t.manual, sources: t.sources, res: caseResult(c, recs, ctx, []) }; continue; }
    }
    const res = caseResult(c, recs, ctx, flags);
    if (res.status === 'needs_review') return { ...res, ...layers(res), upgrade: null };
    if (res.status === 'due') return { ...res, ...layers(res) };   // 今日已可打:不必等待定條件
    return withPending(res);
  }
  if (pending) return { status: 'pending_case', case: pending.info, pendingManual: pending.manual, pendingSources: pending.sources, alternative: null, flags, ...layers(null) };
  const res = { status: 'needs_review', note: '接種史組合未定義,請人工判定', flags };
  return { ...res, fallback: brief(res), upgrade: null };
}

export function computeDosing(dosing, vaccine, ctx) {
  if (dosing.mode === 'cases') return computeCases(dosing, vaccine, ctx);
  const d = computeSeries(dosing, vaccine, ctx);
  return { ...d, fallback: d.status === 'pending_history' ? null : brief(d), upgrade: null };   // series 無待定路徑
}
