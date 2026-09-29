// evaluate(facts, rules, { asOf }) → Result。純函式:不碰 DOM、不碰 chrome API。
import { evalCond } from './conditions.js';
import { normCode } from './codes.js';
import { computeDosing } from './dosing.js';
import { ageYears, todayISO } from './dates.js';
import { computeDisplay, decisiveKeys } from './display.js';

export const ENGINE_VERSION = '0.4.12';

const uniq = (a) => [...new Set(a)];
function windowOf(g, vaccine) {
  if (g.effective) return { from: g.effective.from, to: g.effective.to || vaccine.season?.end || null };
  if (vaccine.season) return { from: vaccine.season.start, to: vaccine.season.end };
  return null;
}
function stateOf(win, asOf) {
  if (!win) return 'active';
  if (asOf < win.from) return 'scheduled';
  if (win.to && asOf > win.to) return 'expired';
  return 'active';
}
// 診斷證據:只在該群判定為符合時附上;依評估順序、同代碼只留第一筆(v0.4.23,純顯示,不影響判定)
function groupEvidence(t) {
  if (t.v !== true) return [];
  const seen = new Set();
  return (t.dxEvidence || []).filter((e) => { const k = normCode(e.code); return seen.has(k) ? false : seen.add(k); });
}
const groupOut = (g, t, state, win) => ({
  groupId: g.groupId, label: g.label, state, window: win, value: t.v, why: t.why,
  providedBy: g.providedBy || 'central', jurisdiction: g.jurisdiction || 'TW', sourceIds: g.sourceIds || [],
  evidence: groupEvidence(t),
});

const DOSING_TO_VERDICT = {
  due: 'eligible', wait: 'wait', completed: 'completed', not_funded: 'not_funded',
  needs_review: 'needs_review', pending_history: 'pending_history',
};

function evaluateVaccine(vaccine, ctx) {
  const vctx = { ...ctx, vaccine };
  const groups = vaccine.eligibilityGroups.map((g) => {
    const win = windowOf(g, vaccine);
    return { g, win, state: stateOf(win, ctx.asOf), t: evalCond(g.criteria, vctx) };
  });
  const out = legacyVerdict(vaccine, vctx, groups);
  // v0.4.12:保底/升級 → 面板分組;decisiveManual 只留「確認後今日可打」的條件(docs/10 §3.1)
  out.display = computeDisplay(vaccine, vctx, groups, out);
  out.decisiveManual = decisiveKeys(out.display, out.decisiveManual);
  if (out.display.upgrade) out.display.upgrade.items = out.display.upgrade.requires.map((k) => (ctx.manualDefs[k]
    ? { key: k, type: 'manual', label: ctx.manualDefs[k].label || k, hint: ctx.manualDefs[k].hint }
    : { key: k, type: 'source', label: k }));
  return finish(out, vaccine, ctx);
}

// v0.4.10 的 verdict 判定(既有欄位語意不變)
function legacyVerdict(vaccine, vctx, groups) {
  const ctx = vctx;
  const out = {
    vaccineId: vaccine.vaccineId, name: vaccine.name?.zh || vaccine.vaccineId,
    groupTrace: groups.map(({ g, t, state, win }) => groupOut(g, t, state, win)),
    matchedGroups: [], decisiveManual: [], evidence: [], missingSources: [], reminders: [], precautions: [],
    dosing: null, opensOn: null, reasons: [], report: null,
  };
  const active = groups.filter((x) => x.state === 'active');
  const matched = active.filter((x) => x.t.v === true);

  if (matched.length) {
    out.matchedGroups = matched.map(({ g, t, state, win }) => groupOut(g, t, state, win));
    out.evidence = matched.flatMap((x) => x.t.evidence);
    // 禁忌:absolute 成立 → 不可打;人工禁忌未答 → 一行提醒,不擋
    for (const c of vaccine.contraindications || []) {
      const node = c.criteria && c.manual ? { any: [c.criteria, { manual: c.manual }] } : c.criteria || { manual: c.manual };
      const t = evalCond(node, vctx);
      if (t.v === true && c.severity === 'absolute') { out.verdict = 'contraindicated'; out.reasons.push(c.label); }
      else if (t.v === true) out.precautions.push({ id: c.id, label: c.label });
      else if (t.v === null && c.manual) out.reminders.push({ id: c.id, key: c.manual, label: c.label });
    }
    if (out.verdict) return out;
    out.report = reportOf(vaccine, matched);
    const override = matched.find((x) => x.g.dosingOverride)?.g.dosingOverride;
    const d = computeDosing(override || vaccine.dosing, vaccine, vctx);
    out.dosing = d;
    if (d.status === 'pending_case') {
      if (d.pendingManual?.length) { out.verdict = 'needs_input'; out.decisiveManual = d.pendingManual; }
      else { out.verdict = 'needs_review'; out.missingSources = d.pendingSources || []; }
    } else out.verdict = DOSING_TO_VERDICT[d.status];
    return out;
  }

  const upcoming = groups.filter((x) => x.state === 'scheduled' && x.t.v !== false);
  out.upcoming = upcoming.map(({ g, t, state, win }) => groupOut(g, t, state, win));
  const sched = upcoming.filter((x) => x.t.v === true).sort((a, b) => a.win.from.localeCompare(b.win.from));
  if (sched.length) { out.report = reportOf(vaccine, sched.filter((x) => x.win.from === sched[0].win.from)); out.verdict = 'scheduled'; out.opensOn = sched[0].win.from; out.matchedGroups = [groupOut(sched[0].g, sched[0].t, 'scheduled', sched[0].win)]; return out; }
  if (groups.length && groups.every((x) => x.state === 'expired')) { out.verdict = 'out_of_season'; return out; }

  // 尚未開打(所有群組都還沒到期間):仍算出「若符合哪些條件」供事先確認
  const notOpen = !active.length && upcoming.length > 0;
  const pool = notOpen ? upcoming : active;
  if (notOpen) out.opensOn = upcoming.map((x) => x.win.from).sort()[0];
  // 只問決定性條件:假設未答的人工條件成立時,群組能變成 true 者
  const reach = pool.filter((x) => x.t.v === null)
    .map((x) => ({ x, a: evalCond(x.g.criteria, { ...vctx, assumeManual: true }) }))
    .filter(({ a }) => a.v === true);
  out.missingSources = uniq(pool.filter((x) => x.t.v === null).flatMap((x) => x.t.sources));
  if (notOpen) {
    out.verdict = 'not_open';
    out.decisiveManual = uniq(reach.flatMap(({ a }) => a.manual));
    out.reachableGroups = reach.map(({ x }) => ({ groupId: x.g.groupId, label: x.g.label, providedBy: x.g.providedBy || 'central' }));
    return out;
  }
  if (reach.length) {
    out.verdict = 'needs_input';
    out.decisiveManual = uniq(reach.flatMap(({ a }) => a.manual));
    out.reachableGroups = reach.map(({ x }) => ({ groupId: x.g.groupId, label: x.g.label, providedBy: x.g.providedBy || 'central' }));
  } else if (out.missingSources.length) out.verdict = 'unknown_source';
  else out.verdict = 'ineligible';
  out.reasons = active.filter((x) => x.t.v === false).map((x) => `${x.g.label}:${x.t.why.join(';')}`);
  return out;
}

// NIIS 接種對象別代碼(填報用,不影響資格):
// 每個符合的群 → 代碼;有 evidence 的依病歷命中清單決定,否則多碼 = 醫師擇一(basis: choose)
// 排序:職業別優先(occupationalFirst),其次依代碼表順序
function reportOf(vaccine, matched) {
  const rc = vaccine.reportCodes;
  if (!rc?.table?.length) return null;
  const table = new Map(rc.table.map((r, i) => [r.code, { ...r, order: i }]));
  const options = [];
  for (const { g, t } of matched) {
    const entries = (g.reportCodes || []).map((e) => (typeof e === 'string' ? { code: e } : e));
    if (!entries.length) continue;
    const refs = new Set(t.evidence.flatMap((e) => (e.hits || []).map((h) => h.ref)).filter(Boolean));
    const byEv = entries.filter((e) => e.evidence?.some((r) => refs.has(r)));
    const chosen = byEv.length ? byEv : entries;
    const basis = byEv.length ? 'evidence' : chosen.length > 1 ? 'choose' : 'group';
    for (const e of chosen) {
      const row = table.get(e.code) || { code: e.code, label: e.code, order: 999 };
      const hits = t.evidence.flatMap((x) => x.hits || []).filter((h) => e.evidence?.includes(h.ref));
      options.push({ code: row.code, label: row.label, occupational: !!row.occupational, note: row.note || null, order: row.order,
        groupId: g.groupId, groupLabel: g.label, basis, icd: hits.flatMap((h) => (h.codes || []).map((c) => c.code)) });
    }
  }
  if (!options.length) return null;
  const seen = new Set();
  const uniqOpts = options
    .sort((a, b) => (rc.occupationalFirst ? (b.occupational - a.occupational) : 0) || a.order - b.order)
    .filter((o) => (seen.has(o.code) ? false : seen.add(o.code)));
  const first = uniqOpts[0];
  const primary = first.basis === 'choose'
    ? uniqOpts.filter((o) => o.groupId === first.groupId && o.basis === 'choose').sort((a, b) => a.order - b.order)
    : [first];
  const pset = new Set(primary.map((o) => o.code));
  const others = uniqOpts.filter((o) => !pset.has(o.code));
  const hasOccInTable = rc.table.some((r) => r.occupational);
  const hint = rc.occupationalFirst && hasOccInTable && !primary.some((o) => o.occupational)
    ? '職業別優先填報:若為醫事人員、托育或機構照顧工作人員、防疫或禽畜業人員,改填對應 F02B/F04B/F07 代碼' : null;
  return { label: rc.label || '接種對象別', sourceRef: rc.sourceRef || null, primary, others, choose: primary.length > 1, hint };
}

function fill(tpl, vars) { return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')); }
function finish(out, vaccine, ctx) {
  const labels = (keys) => keys.map((k) => ({ key: k, label: ctx.manualDefs[k]?.label || k, hint: ctx.manualDefs[k]?.hint }));
  out.decisiveManual = labels(out.decisiveManual);
  out.reminders = out.reminders.map((r) => ({ ...r, label: r.label }));
  out.providedBy = uniq(out.matchedGroups.map((g) => g.providedBy));
  const d = out.dosing || {};
  const vars = {
    name: out.name, groupLabels: out.matchedGroups.map((g) => g.label).join('、'),
    caseLabel: d.case?.label || '', caseReason: d.case?.note || d.note || '',
    age: ctx.facts.patient?.birthDate ? `${ageYears(ctx.facts.patient.birthDate, ctx.asOf)} 歲` : '年齡不明',
    missing: out.reasons.join(';'), nextDose: d.dose || '', doseLabel: d.label ? `(${d.label})` : '', dosesRequired: d.dosesRequired || '', variantLabel: d.variant?.label || '', lastDate: d.lastDate || '', opensOn: out.opensOn || '',
  };
  const key = { eligible: 'eligible', wait: 'eligible', ineligible: 'ineligible', completed: 'completed', not_funded: 'not_funded', needs_review: 'needs_review', pending_history: 'eligiblePending' }[out.verdict];
  const tpl = key && vaccine.explain?.[key];
  out.explanation = tpl ? fill(tpl, vars) : null;
  return out;
}

export function evaluate(facts, rules, opts = {}) {
  const asOf = opts.asOf || facts.asOf || todayISO();
  const manualDefs = Object.fromEntries((rules.manualConditions || []).map((m) => [m.key, m]));
  const ctx = { facts, rules, asOf, manualDefs };
  const vaccines = rules.vaccines.map((v) => evaluateVaccine(v, ctx));
  // 同一條件多支疫苗要,只問一次
  const ask = new Map();
  for (const v of vaccines) for (const m of v.decisiveManual) { if (!ask.has(m.key)) ask.set(m.key, { ...m, vaccines: [] }); ask.get(m.key).vaccines.push(v.vaccineId); }
  return {
    engineVersion: ENGINE_VERSION, ruleSetVersion: rules.ruleSetVersion, jurisdiction: rules.jurisdiction?.code || 'TW',
    asOf, vaccines, ask: [...ask.values()], sourceStatus: facts.sourceStatus || {},
  };
}
