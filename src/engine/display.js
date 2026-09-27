// 面板分組用的「保底(fallback)/升級(upgrade)」彙整(docs/07 §3.1、docs/10 §3.1)。純函式。
// 兩層:對象群層(分階段開打)× 劑次層(cases 待定路徑)。最終可打日 = max(對象群開打日, 劑次 earliestDate)。
import { evalCond } from './conditions.js';
import { computeDosing } from './dosing.js';
import { maxDate } from './dates.js';

const uniq = (a) => [...new Set(a)];
const TERMINAL = new Set(['completed', 'not_funded']);
const GIVE = new Set(['due', 'wait']);
export const BUCKETS = ['eligible', 'confirm', 'not_open', 'ineligible'];

const phaseOf = (g, vaccine) => vaccine.season?.phases?.find((p) => p.phase === g.priorityPhase) || null;

// 一個對象群的路徑:開打日 × 劑次層保底(d.fallback)。劑次未定(接種史未查、需人工)→ doseUnknown,日期暫以開打日計
function groupPath(x, d, vaccine, asOf) {
  const open = x.state === 'scheduled' ? x.win.from : asOf;
  const ph = phaseOf(x.g, vaccine);
  const base = { groupId: x.g.groupId, groupLabel: x.g.label, phase: ph?.label || null, phaseNo: ph?.phase ?? null, open };
  let f = d?.fallback;
  let extra = [];
  if (!f && d?.upgrade && GIVE.has(d.upgrade.status)) { f = d.upgrade; extra = [...(d.upgrade.requires || []), ...(d.upgrade.sources || [])]; }
  if (f && TERMINAL.has(f.status)) return { ...base, kind: f.status, date: null, caseId: f.caseId, label: f.label, dose: null, extra };
  if (f && GIVE.has(f.status)) {
    const doseDate = f.earliestDate || asOf;
    const date = maxDate(open, doseDate);
    return { ...base, kind: x.state === 'scheduled' && open >= doseDate ? 'phase' : 'dose', date, caseId: f.caseId, label: f.label, dose: f.dose, extra };
  }
  return { ...base, kind: x.state === 'scheduled' ? 'phase' : null, date: open, caseId: null, label: null, dose: null, doseUnknown: true, extra };
}

const withManual = (vctx, keys) => (keys.length ? { ...vctx, facts: { ...vctx.facts, manual: { ...(vctx.facts.manual || {}), ...Object.fromEntries(keys.map((k) => [k, true])) } } } : vctx);

/**
 * groups: [{ g, win, state, t }](evaluate.js 已算好);out:既有 Result(verdict、dosing 已定)
 * 回 { bucket, fallback, upgrade, step }。step = §5 命中的步驟(稽核用)
 */
export function computeDisplay(vaccine, vctx, groups, out) {
  const asOf = vctx.asOf;
  const live = groups.filter((x) => x.state !== 'expired');

  // ---------- 保底 ----------
  let fb = null;
  const activeTrue = live.filter((x) => x.state === 'active' && x.t.v === true);
  if (activeTrue.length && out.verdict !== 'contraindicated') {
    fb = groupPath(activeTrue[0], out.dosing, vaccine, asOf);   // out.dosing 已依 v0.4.10 規則(dosingOverride)算好
    if (out.dosing?.upgrade) {
      const u = out.dosing.upgrade;
      fb.doseUpgrade = { kind: 'dose', date: maxDate(fb.open, u.earliestDate || asOf), groupId: fb.groupId, caseId: u.caseId, label: u.label, dose: u.dose,
        status: u.status, manual: u.requires || [], sources: u.sources || [] };
    }
  } else if (!activeTrue.length) {
    const cand = live.filter((x) => x.state === 'scheduled' && x.t.v === true)
      .map((x) => { const d = computeDosing(x.g.dosingOverride || vaccine.dosing, vaccine, vctx); return { p: groupPath(x, d, vaccine, asOf), d }; });
    const dated = cand.filter((c) => c.p.date).sort((a, b) => a.p.date.localeCompare(b.p.date));
    const pick = dated[0] || cand[0];
    if (pick) {
      fb = pick.p;
      const u = pick.d?.upgrade;
      if (u) fb.doseUpgrade = { kind: 'dose', date: maxDate(fb.open, u.earliestDate || asOf), groupId: fb.groupId, caseId: u.caseId, label: u.label, dose: u.dose, status: u.status, manual: u.requires || [], sources: u.sources || [] };
    }
  }

  // ---------- 升級候選 ----------
  const cands = [];
  if (fb?.doseUpgrade) cands.push(fb.doseUpgrade);
  if (out.verdict !== 'contraindicated') {
    for (const x of live.filter((y) => y.t.v === null)) {
      const a = evalCond(x.g.criteria, { ...vctx, assumeManual: true });
      if (a.v === false) continue;
      const manual = a.v === true ? uniq(a.manual) : uniq(x.t.manual);
      const sources = a.v === true ? [] : uniq(x.t.sources);
      const d = computeDosing(x.g.dosingOverride || vaccine.dosing, vaccine, withManual(vctx, manual));   // 假設確認後的劑次
      const p = groupPath(x, d, vaccine, asOf);
      if (!p.date) continue;                                                // 確認後仍已完成/不再公費 → 不算升級
      cands.push({ kind: 'phase', date: p.date, groupId: p.groupId, caseId: p.caseId, label: p.groupLabel, phase: p.phase, phaseNo: p.phaseNo, dose: p.dose,
        manual: uniq([...manual, ...p.extra.filter((k) => vctx.manualDefs[k])]), sources: uniq([...sources, ...p.extra.filter((k) => !vctx.manualDefs[k])]) });
    }
  }
  const fbComparable = fb && fb.date && !TERMINAL.has(fb.kind);                 // 劑次未定的保底以開打日比較
  const better = cands.filter((c) => !fbComparable || c.date < fb.date).sort((a, b) => a.date.localeCompare(b.date));

  let upgrade = null;
  if (better.length) {
    const best = better.filter((c) => c.date === better[0].date);
    const manual = uniq(best.flatMap((c) => c.manual));
    const sources = uniq(best.flatMap((c) => c.sources));
    const top = best[0];
    upgrade = {
      kind: top.kind, date: top.date, groupId: top.kind === 'phase' ? top.groupId : (fb?.groupId || null), caseId: top.caseId || null,
      label: top.kind === 'phase' ? (top.phase || top.label) : top.label, phase: top.phase || null, dose: top.dose ?? null,
      requires: [...manual, ...sources], manual, sources,
      decisive: top.date <= asOf,
      paths: better.map((c) => ({ kind: c.kind, date: c.date, groupId: c.groupId, caseId: c.caseId || null, label: c.label, requires: [...c.manual, ...c.sources] })),
    };
  }

  // ---------- §5 分組 ----------
  const fbOut = fb && { kind: fb.kind, date: fb.date, groupId: fb.groupId, caseId: fb.caseId || null, label: fb.kind === 'phase' ? fb.groupLabel : (fb.label || fb.groupLabel),
    phase: fb.phase, groupLabel: fb.groupLabel, dose: fb.dose ?? null, doseUnknown: !!fb.doseUnknown };
  const res = (bucket, step, up = upgrade) => ({ bucket, step, fallback: fbOut || null, upgrade: up });

  if (out.verdict === 'contraindicated') return res('ineligible', 1, null);
  const dueToday = out.verdict === 'eligible' && out.dosing?.status === 'due';        // 可接種只來自既有 eligible + 今日可打
  if (fb && fb.kind === 'dose' && fb.date <= asOf && dueToday) return res('eligible', 2, null);   // 保底今日可打:不列升級、不問
  if (fb && (TERMINAL.has(fb.kind) || (fb.kind && fb.date > asOf))) {              // 未開打、間隔未滿、已完成、不再公費
    const end = TERMINAL.has(fb.kind) ? 'ineligible' : 'not_open';
    if (upgrade?.decisive) return res('confirm', '3a');
    return res(end, upgrade ? '3b' : '3c');
  }
  if (!fb && upgrade) return res(upgrade.decisive ? 'confirm' : 'ineligible', 4);   // 無保底:確認後今日可打 → 待確認;否則不符合 + 選填提示
  if (['pending_history', 'needs_review', 'unknown_source', 'needs_input'].includes(out.verdict)) return res('confirm', 5, null);
  if (['out_of_season', 'ineligible', 'not_open'].includes(out.verdict)) return res('ineligible', 6, null);
  return res('confirm', 7, null);                                                   // 表上未涵蓋:待確認,不歸入可接種
}

/** §5 問醫師的規則:只有 3a(與沿用現行的第 4 步今日可打)列入 decisiveManual;3b 與不符合卡片的提示為選填 */
export function decisiveKeys(display, legacyKeys) {
  if (display.bucket === 'confirm' && display.step === '3a') return display.upgrade.manual;
  if (display.bucket === 'confirm') return legacyKeys;
  return [];
}
