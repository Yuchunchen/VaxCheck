// 條件樹求值:三值邏輯 true / false / null(未知)。
// 每個節點回傳 Trace:{ v, why[], manual[](未答的人工條件), sources[](缺的資料來源), evidence[](病歷預勾) }
import { addInterval, addDays, ageYears, split } from './dates.js';
import { matchCode } from './codes.js';

const OK = new Set(['ok', 'nodata']);
const T = (v, why = [], extra = {}) => ({ v, why: [].concat(why), manual: [], sources: [], evidence: [], ...extra });
const uniq = (a) => [...new Set(a)];

export function sourceOk(facts, name) { return OK.has(facts.sourceStatus?.[name]); }

function combine(kind, kids) {
  let v;
  if (kind === 'all') v = kids.some((k) => k.v === false) ? false : kids.some((k) => k.v === null) ? null : true;
  else v = kids.some((k) => k.v === true) ? true : kids.some((k) => k.v === null) ? null : false;
  const rel = kids.filter((k) => k.v === v);
  return {
    v,
    why: rel.flatMap((k) => k.why),
    manual: uniq(rel.flatMap((k) => k.manual)),
    sources: uniq(rel.flatMap((k) => k.sources)),
    evidence: kids.filter((k) => k.v === true).flatMap((k) => k.evidence),
  };
}

function listCodes(ctx, spec) {
  if (spec.codes) return { codes: spec.codes, label: null };
  const l = ctx.rules.codeLists?.[spec.$list];
  if (!l) throw new Error(`codeList 不存在:${spec.$list}`);
  return { codes: l.codes, label: l.label || spec.$list };
}
const within = (ctx, date, days) => !days || (date && date >= addDays(ctx.asOf, -days));

function ageAdd(birth, a, plusOne) {
  const iv = { years: a.years || 0, months: a.months || 0, days: a.days || 0 };
  if (plusOne) { if (a.days != null) iv.days += 1; else if (a.months != null) iv.months += 1; else iv.years += 1; }
  return addInterval(birth, iv);
}
const fmtAge = (a) => [a.years != null && `${a.years} 歲`, a.months != null && `${a.months} 個月`, a.days != null && `${a.days} 天`].filter(Boolean).join('');

const LEAVES = {
  age(spec, ctx) {
    const b = ctx.facts.patient?.birthDate;
    if (!b) return T(null, '缺生日', { sources: ['patient'] });
    const okMin = !spec.min || ageAdd(b, spec.min, false) <= ctx.asOf;
    const okMax = !spec.max || ctx.asOf < ageAdd(b, spec.max, true);
    const range = [spec.min && `≥${fmtAge(spec.min)}`, spec.max && `≤${fmtAge(spec.max)}`].filter(Boolean).join(' 且 ');
    return T(okMin && okMax, `年齡 ${ageYears(b, ctx.asOf)} 歲${okMin && okMax ? '' : `,不符 ${range}`}`);
  },
  ageByYear(spec, ctx) {
    const b = ctx.facts.patient?.birthDate;
    if (!b) return T(null, '缺生日', { sources: ['patient'] });
    const a = split(ctx.asOf)[0] - split(b)[0];
    const ok = (spec.min == null || a >= spec.min) && (spec.max == null || a <= spec.max);
    const range = spec.min != null && spec.max != null ? `${spec.min}–${spec.max}` : spec.min != null ? `≥${spec.min}` : `≤${spec.max}`;
    return T(ok, `年次年齡 ${a} 歲${ok ? '' : `,不符 ${range}`}`);
  },
  birthDate(spec, ctx) {
    const b = ctx.facts.patient?.birthDate;
    if (!b) return T(null, '缺生日', { sources: ['patient'] });
    const ok = (!spec.onOrBefore || b <= spec.onOrBefore) && (!spec.onOrAfter || b >= spec.onOrAfter);
    return T(ok, `生日 ${b}`);
  },
  sex(spec, ctx) {
    const s = ctx.facts.patient?.sex;
    if (!s) return T(null, '缺性別', { sources: ['patient'] });
    return T(s === spec, `性別 ${s === 'F' ? '女' : '男'}`);
  },
  diagnosis(spec, ctx) {
    if (!sourceOk(ctx.facts, 'medication')) return T(null, '用藥紀錄(診斷)未取得', { sources: ['medication'] });
    const { codes, label } = listCodes(ctx, spec);
    const hits = (ctx.facts.diagnoses || []).filter((d) => within(ctx, d.date, spec.withinDays) && matchCode(d.code, codes));
    const need = spec.minRecords || 1;
    if (hits.length >= need) {
      const last = [...hits].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      return T(true, `${label ? label + ':' : '診斷 '}${last.code}${last.name ? ' ' + last.name : ''}(${last.date || '日期不明'}${need > 1 ? `,共 ${hits.length} 筆` : ''})`);
    }
    return T(false, `${label || '診斷'}:${hits.length ? `僅 ${hits.length} 筆,需 ${need} 筆` : '無紀錄'}`);
  },
  medication(spec, ctx) {
    if (!sourceOk(ctx.facts, 'medication')) return T(null, '用藥紀錄未取得', { sources: ['medication'] });
    const { codes, label } = listCodes(ctx, spec);
    const hits = (ctx.facts.medications || []).filter((m) => within(ctx, m.date, spec.withinDays) && matchCode(m.atc7, codes));
    if (hits.length >= (spec.minRecords || 1)) {
      const last = [...hits].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      return T(true, `${label ? label + ':' : '用藥 '}${last.name || last.atc7}(${last.date})`);
    }
    return T(false, `${label || '用藥'}:${spec.withinDays ? `近 ${spec.withinDays} 天` : ''}無紀錄`);
  },
  lab(spec, ctx) {
    if (!sourceOk(ctx.facts, 'lab')) return T(null, '檢驗未取得', { sources: ['lab'] });
    const rows = (ctx.facts.labs || []).filter((l) => l.item === spec.item && typeof l.value === 'number' && within(ctx, l.date, spec.withinDays))
      .sort((a, b) => b.date.localeCompare(a.date));
    if (!rows.length) return T(false, `${spec.item}:無資料`);
    const x = rows[0].value, y = spec.value;
    const ok = { '<': x < y, '<=': x <= y, '>': x > y, '>=': x >= y, '==': x === y }[spec.op];
    return T(ok, `${spec.item} ${x}(${rows[0].date})`);
  },
  specialPayment(spec, ctx) {
    if (!sourceOk(ctx.facts, 'lftp')) return T(null, '特殊給付限制未取得', { sources: ['lftp'] });
    const key = { drug: 'drugs', service: 'services', material: 'materials' }[spec.category];
    const { codes, label } = spec.codes || spec.$list ? listCodes(ctx, spec) : { codes: null, label: null };
    const hits = (ctx.facts.specialPayment?.[key] || []).filter((r) => within(ctx, r.date, spec.withinDays) && (!codes || matchCode(r.code, codes)));
    return hits.length ? T(true, `${label || '特殊給付'}:${hits[0].name || hits[0].code}`) : T(false, `${label || '特殊給付'}:無`);
  },
  specialMaterial() { return T(null, '特材紀錄端點未實作', { sources: ['specialMaterial'] }); },
  vaccination(spec, ctx) {
    if (!sourceOk(ctx.facts, 'niis')) return T(null, '接種史未查詢', { sources: ['niis'] });
    let recs = (ctx.facts.vaccinations?.records || []).filter((r) => spec.vaccineCodes.includes(r.code) && within(ctx, r.date, spec.withinDays));
    const n = recs.length;
    let ok = (spec.minDoses == null || n >= spec.minDoses) && (spec.maxDoses == null || n <= spec.maxDoses);
    if (ok && spec.minDaysSinceLast != null && n) {
      const last = recs.map((r) => r.date).filter(Boolean).sort().at(-1);
      ok = !last || addDays(last, spec.minDaysSinceLast) <= ctx.asOf;
    }
    return T(ok, `${spec.vaccineCodes.join('/')} ${n} 劑`);
  },
  flag(spec, ctx) {
    if (!sourceOk(ctx.facts, 'summary')) return T(null, '病人資訊摘要未取得', { sources: ['summary'] });
    const has = (ctx.facts.flags?.values || []).includes(spec);
    const txt = ctx.facts.flags?.evidence?.[spec];
    return T(has, has ? `病人資訊:${txt || spec}` : `病人資訊無 ${spec}`);
  },
  inSeason(spec, ctx) {
    const s = ctx.vaccine?.season;
    const inside = !s || (ctx.asOf >= s.start && ctx.asOf <= s.end);
    return T(inside === spec, inside ? '公費期間內' : '非公費期間');
  },
  residentOf(code, ctx) {
    const r = ctx.facts.patient?.residenceJurisdiction;
    if (r) return T(r === code, `設籍 ${r}`);
    return LEAVES.manual(`resident_${code.replace('-', '_')}`, ctx);
  },
  manual(key, ctx) {
    const def = ctx.manualDefs[key] || { key, label: key };
    const ans = ctx.facts.manual?.[key];
    if (ans === true || ans === false) return T(ans, `${def.label}:醫師${ans ? '確認' : '排除'}`);
    if (def.askWhen && !ctx.inAskWhen) {
      const aw = evalCond(def.askWhen, { ...ctx, inAskWhen: true, assumeManual: false });
      if (aw.v === false) return T(false, `${def.label}:不適用`);
    }
    if (def.evidence && !ctx.inEvidence) {
      const e = evalCond(def.evidence, { ...ctx, inEvidence: true, assumeManual: false });
      if (e.v === true) return T(true, `${def.label}(依病歷自動判定)`, { evidence: [{ key, label: def.label, why: e.why }] });
    }
    if (ctx.assumeManual) return T(true, `${def.label}(若符合)`, { manual: [key] });
    return T(null, `${def.label}:未確認`, { manual: [key] });
  },
};

export function evalCond(node, ctx) {
  if (!node || typeof node !== 'object') throw new Error('條件節點格式錯誤');
  const [k] = Object.keys(node);
  if (k === 'all' || k === 'any') return combine(k, node[k].map((c) => evalCond(c, ctx)));
  if (k === 'not') { const t = evalCond(node.not, ctx); return { ...t, v: t.v === null ? null : !t.v, evidence: [] }; }
  const f = LEAVES[k];
  if (!f) throw new Error(`未知條件:${k}`);
  return f(node[k], ctx);
}
