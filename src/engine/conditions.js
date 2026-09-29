// 條件樹求值:三值邏輯 true / false / null(未知)。
// 每個節點回傳 Trace:{ v, why[], manual[](未答的人工條件), sources[](缺的資料來源), evidence[](病歷預勾), hits[](命中的清單/旗標與代碼), dxEvidence[](診斷證據,面板逐項列出;v0.4.23), weak[](僅命中寬泛碼的診斷證據:只顯示、不參與判定、不進 hits;v0.4.24) }
import { addInterval, addDays, ageYears, split } from './dates.js';
import { matchCode, normCode } from './codes.js';

const OK = new Set(['ok', 'nodata']);
const T = (v, why = [], extra = {}) => ({ v, why: [].concat(why), manual: [], sources: [], evidence: [], hits: [], dxEvidence: [], weak: [], ...extra });
const uniq = (a) => [...new Set(a)];
// 已有預勾證據時,其他來源的寬泛碼證據仍附在後面(同代碼只留一筆)
const withWeak = (dx, weak) => [...dx, ...weak.filter((w) => !dx.some((d) => normCode(d.code) === normCode(w.code)))];

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
    hits: kids.filter((k) => k.v === true).flatMap((k) => k.hits),
    dxEvidence: kids.filter((k) => k.v === true).flatMap((k) => k.dxEvidence),   // 保持評估順序
    weak: kids.flatMap((k) => k.weak),                                            // 寬泛碼證據不論該葉是否成立都保留(只顯示)
  };
}

function listCodes(ctx, spec) {
  if (spec.codes) return { codes: spec.codes, label: null };
  const l = ctx.rules.codeLists?.[spec.$list];
  if (!l) throw new Error(`codeList 不存在:${spec.$list}`);
  return { codes: l.codes, label: l.label || spec.$list };
}
// 清單中文名:比對到的清單項(完整碼優先,其次區間/前綴)的名稱;清單沒有名稱 → ''(不外補)
function listName(list, code) {
  const names = list?.names;
  if (!names) return '';
  const n = normCode(code);
  let i = list.codes.findIndex((c, k) => names[k] && normCode(c) === n);
  if (i < 0) i = list.codes.findIndex((c, k) => names[k] && matchCode(code, [c]));
  return i < 0 ? '' : names[i];
}
// 罕見疾病清單的逐碼註記(meta[i] = { broad?, otherCount? }):病歷碼比對到的所有清單項
function matchedMeta(list, code) {
  if (!list?.meta) return [];
  const n = normCode(code);
  const idx = list.codes.map((c, k) => k).filter((k) => normCode(list.codes[k]) === n || matchCode(code, [list.codes[k]]));
  return idx.map((k) => list.meta[k] || {});
}
// 共用碼:同一碼對到多種疾病 → 「第一個病名 等 N 種(公告碼)」,N = otherCount + 1;N = 1 只寫病名
const sharedLabel = (name, otherCount) => (name && otherCount > 0 ? `${name} 等 ${otherCount + 1} 種(公告碼)` : name);
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
    const list = spec.$list ? ctx.rules.codeLists?.[spec.$list] : null;
    const all = (ctx.facts.diagnoses || []).filter((d) => within(ctx, d.date, spec.withinDays) && matchCode(d.code, codes));
    // 寬泛碼(broadEvidence: display-only):只命中寬泛碼者為 weak,只顯示、不計入 minRecords、不進 hits(不影響判定與接種對象別代碼)
    const isWeak = (d) => { if (list?.broadEvidence !== 'display-only') return false; const m = matchedMeta(list, d.code); return m.length > 0 && m.every((x) => x.broad); };
    const hits = all.filter((d) => !isWeak(d));
    const weakHits = all.filter(isWeak);
    const need = spec.minRecords || 1;
    // 依代碼去重:每碼取最近一次(代碼照健保雲端原樣),最近者在前 — 醫師要看得到「抓到哪些 ICD」
    // 單一代碼時文字與 v0.4.10 相同(回歸快照依此比對)
    const dedupe = (rows) => {
      const by = new Map();
      for (const d of rows) {
        const k = normCode(d.code);
        const c = by.get(k);
        if (!c) by.set(k, { code: d.code, name: d.name || '', date: d.date || '', count: 1 });
        else {
          c.count += 1;
          if ((d.date || '') > c.date) { c.code = d.code; c.date = d.date || ''; }
          if (!c.name && d.name) c.name = d.name;
        }
      }
      return [...by.values()].sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code));
    };
    // 診斷證據(v0.4.23):同清單內日期新到舊;名稱只取清單(病歷自帶名稱為備援),沒有就只有代碼
    // v0.4.24:罕見疾病清單另帶 broad / shared / otherCount;非寬泛碼在前、寬泛碼在後
    const toEvidence = (c, weak) => {
      const metas = matchedMeta(list, c.code);
      const otherCount = Math.max(0, ...metas.map((m) => m.otherCount || 0));
      const name = listName(list, c.code) || c.name;
      return {
        code: c.code, label: list?.meta ? sharedLabel(name, otherCount) : name, category: list?.category || null, list: label || null,
        lastDate: c.date, count: c.count,
        ...(list?.validity && { validity: list.validity }), ...(list?.evidenceNote && { note: list.evidenceNote }),
        ...(list?.meta && { broad: weak, shared: otherCount > 0, otherCount }),
      };
    };
    const strong = dedupe(hits); const weak = dedupe(weakHits);
    const weakEvidence = weak.map((c) => toEvidence(c, true));
    if (hits.length >= need) {
      const MAX = 3;   // YC 2026-09-28:只列 3 碼
      const txt = strong.slice(0, MAX).map((c) => `${c.code}${c.name ? ' ' + c.name : ''}(${c.date || '日期不明'}`).join(')、');
      const more = strong.length > MAX ? ` 等 ${strong.length} 碼` : '';
      return T(true, `${label ? label + ':' : '診斷 '}${txt}${need > 1 ? `,共 ${hits.length} 筆` : ''})${more}`,
        { hits: [{ ref: spec.$list || null, label: label || '診斷', codes: strong }], dxEvidence: [...strong.map((c) => toEvidence(c, false)), ...weakEvidence], weak: weakEvidence });
    }
    if (weakEvidence.length) return T(false, `${label || '診斷'}:僅命中寬泛碼(不預勾),需醫師核對`, { weak: weakEvidence });
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
    let recs = (ctx.facts.vaccinations?.records || []).filter((r) => spec.vaccineCodes.includes(r.code) && within(ctx, r.date, spec.withinDays)
      && (!spec.before || !r.date || r.date < spec.before));   // before:只看該日前(無日期視為較早)
    const n = recs.length;
    let ok = (spec.minDoses == null || n >= spec.minDoses) && (spec.maxDoses == null || n <= spec.maxDoses);
    if (ok && spec.minDaysSinceLast != null && n) {
      const last = recs.map((r) => r.date).filter(Boolean).sort().at(-1);
      ok = !last || addDays(last, spec.minDaysSinceLast) <= ctx.asOf;
    }
    return T(ok, `${spec.vaccineCodes.join('/')} ${spec.before ? `${spec.before} 前 ` : ''}${n} 劑`);
  },
  flag(spec, ctx) {
    if (!sourceOk(ctx.facts, 'summary')) return T(null, '病人資訊摘要未取得', { sources: ['summary'] });
    const has = (ctx.facts.flags?.values || []).includes(spec);
    const txt = ctx.facts.flags?.evidence?.[spec];
    return T(has, has ? `病人資訊:${txt || spec}` : `病人資訊無 ${spec}`, has ? { hits: [{ ref: `flag:${spec}`, label: `病人資訊 ${spec}` }] } : {});
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
    let weak = [];
    const ans = ctx.facts.manual?.[key];
    if (ans === true || ans === false) return T(ans, `${def.label}:醫師${ans ? '確認' : '排除'}`);
    if (def.askWhen && !ctx.inAskWhen) {
      const aw = evalCond(def.askWhen, { ...ctx, inAskWhen: true, assumeManual: false });
      if (aw.v === false) return T(false, `${def.label}:不適用`);
    }
    if (def.evidence && !ctx.inEvidence) {
      const e = evalCond(def.evidence, { ...ctx, inEvidence: true, assumeManual: false });
      if (e.v === true) return T(true, `${def.label}(依病歷自動判定)`, { evidence: [{ key, label: def.label, why: e.why, hits: e.hits }], dxEvidence: withWeak(e.dxEvidence, e.weak) });
      weak = e.weak;   // 沒有可預勾的證據;僅寬泛碼者保留 → 問題卡旁顯示,勾選維持未確認
    }
    if (ctx.assumeManual) return T(true, `${def.label}(若符合)`, { manual: [key], weak });
    return T(null, `${def.label}:未確認`, { manual: [key], weak });
  },
};

export function evalCond(node, ctx) {
  if (!node || typeof node !== 'object') throw new Error('條件節點格式錯誤');
  const [k] = Object.keys(node);
  if (k === 'all' || k === 'any') return combine(k, node[k].map((c) => evalCond(c, ctx)));
  if (k === 'not') { const t = evalCond(node.not, ctx); return { ...t, v: t.v === null ? null : !t.v, evidence: [], hits: [], dxEvidence: [], weak: [] }; }   // not 底下的證據不顯示
  const f = LEAVES[k];
  if (!f) throw new Error(`未知條件:${k}`);
  return f(node[k], ctx);
}
