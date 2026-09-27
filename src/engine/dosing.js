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
  if (dosing.seasonal && s) recs = recs.filter((r) => r.date && r.date >= s.start && r.date <= s.end);
  const flags = recs.some((r) => !r.date) ? ['NEED_DATE_CONFIRMATION'] : [];
  const pick = pickVariant(dosing, allRecs, recs, dosing.seasonal ? s : null, ctx);
  if (pick?.unknown) return { status: 'needs_review', note: '缺生日,無法判定本季應接種劑數', flags };
  const variant = pick?.variant ? { id: pick.variant.id, label: pick.variant.label, sourceRef: pick.variant.sourceRef, priorDoses: pick.prior } : null;
  const series = pick?.variant?.series || dosing.series || [];
  const n = recs.length;
  const lastDate = lastDateOf(recs);
  if (n >= series.length) return { status: 'completed', lastDate, dosesGiven: n, dosesRequired: series.length, variant, flags };
  const next = series[n];
  let earliest = ctx.asOf;
  if (next.minIntervalDays && lastDate) earliest = maxDate(earliest, addDays(lastDate, next.minIntervalDays));
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

export function computeCases(dosing, vaccine, ctx) {
  const facts = ctx.facts;
  if (!sourceOk(facts, 'niis')) return { status: 'pending_history' };
  const recs = recsOf(facts);
  const flags = [];
  if (dosing.unknownTypeCodes?.length && recs.some((r) => dosing.unknownTypeCodes.includes(r.code))) {
    return { status: 'needs_review', flags: ['NEED_HISTORY_CONFIRMATION'], note: '接種史有型別不明的肺鏈紀錄,請人工確認' };
  }
  let pending = null;
  const withPending = (res) => (pending ? { status: 'pending_case', case: pending.info, pendingManual: pending.manual, pendingSources: pending.sources, alternative: res, flags } : res);

  for (const c of dosing.cases) {
    if (!evalHist(c.when, recs)) continue;
    if (c.criteria) {
      const t = evalCond(c.criteria, ctx);
      if (t.v === false) continue;
      if (t.v === null) { if (!pending) pending = { info: caseInfo(c), manual: t.manual, sources: t.sources }; continue; }
    }
    const info = caseInfo(c);
    const a = c.then.action;
    if (a === 'complete') return withPending({ status: 'completed', case: info, lastDate: lastDateOf(recs.filter((r) => codesInHas(c.when).has(r.code))), flags });
    if (a === 'notFunded') return withPending({ status: 'not_funded', case: info, flags });
    if (a === 'review') return { status: 'needs_review', case: info, flags };
    // give
    const from = c.then.intervalFrom || [...codesInHas(c.when)];
    const prior = recs.filter((r) => from.includes(r.code));
    if (prior.some((r) => !r.date)) flags.push('NEED_DATE_CONFIRMATION');
    const last = lastDateOf(prior);
    let earliest = ctx.asOf;
    if (last && c.then.minInterval) earliest = maxDate(earliest, addInterval(last, c.then.minInterval));
    if (last && c.then.minIntervalDays != null) earliest = maxDate(earliest, addDays(last, c.then.minIntervalDays));
    const res = { status: earliest <= ctx.asOf ? 'due' : 'wait', case: info, dose: c.then.dose || 1, earliestDate: earliest, lastDate: last, flags };
    if (res.status === 'due') return res;            // 今日已可打:不必等待定條件
    return withPending(res);
  }
  if (pending) return { status: 'pending_case', case: pending.info, pendingManual: pending.manual, pendingSources: pending.sources, alternative: null, flags };
  return { status: 'needs_review', note: '接種史組合未定義,請人工判定', flags };
}

export function computeDosing(dosing, vaccine, ctx) {
  return dosing.mode === 'cases' ? computeCases(dosing, vaccine, ctx) : computeSeries(dosing, vaccine, ctx);
}
