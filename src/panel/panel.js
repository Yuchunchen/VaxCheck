// 結果面板:原生 DOM + Shadow DOM,外掛與示範頁共用。只負責畫,不做判定。
import { CSS } from './panel.css.js';
import { groupVaccines, sortTrace } from './order.js';

const SRC_NAMES = { medication: '用藥', lab: '檢驗', allergy: '過敏', lftp: '特殊給付', summary: '病人資訊', niis: '接種史' };
const SRC_STATE = { ok: '已取得', nodata: '無資料', not_queried: '未查詢', error: '讀取失敗', unknown_shape: '格式不符', unavailable: '未實作', loading: '讀取中' };
const PROVIDER = (g, names) => (g.providedBy === 'county' ? (names[g.jurisdiction] || g.jurisdiction) : '中央');

function head(v, fmtDate) {
  const d = v.dosing || {};
  const own = display(v, fmtDate);   // 分組與 verdict 不一致時,標籤依保底(verdict 本身不改)
  if (own) return own;
  switch (v.verdict) {
    case 'eligible': return ['可打', 'go', `今日可打第 ${d.dose || 1} 劑${d.case ? `(${d.case.label})` : ''}`];
    case 'wait': return ['尚不可打', 'wait', `${fmtDate(d.earliestDate)} 起可打${d.case ? `(${d.case.label})` : ''}`];
    case 'scheduled': return ['尚未開打', 'wait', `符合「${v.matchedGroups[0]?.label}」,${fmtDate(v.opensOn)} 起可打`];
    case 'not_open': return ['尚未開打', 'no', `${fmtDate(v.opensOn)} 開打`];
    case 'pending_history': return ['待查接種史', 'wait', '符合公費對象;查 NIIS 後確認劑次'];
    case 'needs_input': return ['需確認', 'wait', v.dosing?.alternative ? altText(v.dosing.alternative, fmtDate) : '勾選符合的條件後重新判定'];
    case 'needs_review': return ['需人工判定', 'wait', d.note || d.case?.note || '請醫師依接種史評估'];
    case 'unknown_source': return ['資料不足', 'wait', `缺:${v.missingSources.map((s) => SRC_NAMES[s] || s).join('、')}`];
    case 'completed': return ['已完成', 'done', d.case?.note || (d.lastDate ? `本季已於 ${fmtDate(d.lastDate)} 接種` : '已完成建議劑次')];
    case 'not_funded': return ['不再公費', 'no', d.case?.note || ''];
    case 'out_of_season': return ['非公費期間', 'no', '本季公費施打期間已結束'];
    case 'contraindicated': return ['禁忌', 'stop', v.reasons.join(';')];
    default: return ['不可打', 'no', '不符合公費對象'];
  }
}
function altText(alt, fmtDate) {
  if (!alt) return '';
  if (alt.status === 'completed') return '若無下列條件:已完成接種';
  if (alt.status === 'wait') return `若無下列條件:${fmtDate(alt.earliestDate)} 起可打`;
  if (alt.status === 'not_funded') return '若無下列條件:不再公費';
  return '';
}

// ---------- 保底 / 升級(v0.4.12,docs/07 §3.1)----------
const caseNote = (v) => v.dosing?.alternative?.case?.note || v.dosing?.case?.note || '';
/** 保底行 */
function fallbackLine(fb, fmtDate, v) {
  if (!fb) return '';
  if (fb.kind === 'phase') return `已符合${fb.phase || ''}「${fb.groupLabel}」,${fmtDate(fb.date)} 起可打`;
  if (fb.kind === 'dose') return `未確認前:${fmtDate(fb.date)} 起可打${fb.label ? `(${fb.label})` : ''}`;
  if (fb.kind === 'completed') return `目前視為已完成${fb.label ? `(${fb.label})` : ''}`;
  if (fb.kind === 'not_funded') return `目前不再公費${fb.label ? `(${fb.label})` : ''}`;
  return caseNote(v);
}
/** 「〔A、B〕」或「下列任一(N 項)」 */
function whatText(up) {
  const names = up.items.map((i) => (i.type === 'source' ? `缺${SRC_NAMES[i.key] || i.key}` : i.label));
  if (names.length <= 2) return `〔${names.join('、')}〕${names.length > 1 ? '任一' : ''}`;
  return `下列任一(${names.length} 項)`;
}
/** 升級結果:今天 / 提早至某日 */
function upgradeOutcome(up, fb, fmtDate) {
  const when = up.decisive ? '今天' : `${fmtDate(up.date)} 起`;
  const lbl = up.label ? `(${up.label})` : '';
  const later = fb ? `可提早至 ${fmtDate(up.date)}${lbl}` : `${fmtDate(up.date)} 起可打${lbl}`;   // 無保底(開打前)不說「提早」
  if (up.kind === 'phase') return up.decisive ? `屬${up.label},今天即可打` : later;
  if (fb && (fb.kind === 'completed' || fb.kind === 'not_funded')) return `${when}可追加 ${up.dose || 1} 劑${lbl}`;
  return up.decisive ? `今天可打${lbl}` : later;
}
function display(v, fmtDate) {
  const dp = v.display;
  if (!dp) return null;
  const fb = dp.fallback;
  if (dp.bucket === 'confirm' && dp.step === '3a') return ['需確認', 'wait', fallbackLine(fb, fmtDate, v)];
  if (dp.bucket === 'not_open' && fb) {   // 「{日期} 起可打(第 N 階段 / 與前劑間隔)」
    const why = fb.kind === 'phase' ? `${fb.phase || '開打日'}:${fb.groupLabel}` : `與前劑間隔${fb.label ? `:${fb.label}` : ''}`;
    return [fb.kind === 'phase' ? '尚未開打' : '尚不可打', 'wait', `${fmtDate(fb.date)} 起可打(${why})`];
  }
  if (dp.bucket === 'ineligible' && fb?.kind === 'completed' && v.verdict !== 'completed') return ['已完成', 'done', caseNote(v) || fallbackLine(fb, fmtDate, v)];
  if (dp.bucket === 'ineligible' && fb?.kind === 'not_funded' && v.verdict !== 'not_funded') return ['不再公費', 'no', caseNote(v)];
  if (dp.bucket === 'ineligible' && v.verdict === 'not_open') return ['不可打', 'no', `目前不符合公費對象;${fmtDate(v.opensOn)} 開打`];
  return null;
}

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
};

export function mountPanel(host, { floating = true } = {}) {
  const root = host.attachShadow({ mode: 'open' });
  root.append(h('style', {}, CSS));
  const wrap = h('div', { class: floating ? 'vx vx-floating' : 'vx' });
  root.append(wrap);
  return { root, wrap };
}

/**
 * state: { user:{name,age,sex}, result, sourceStatus, manual, loading, error, notice, jurisdictionNames, rulesMeta, appVersion }
 * on: { manual(key, value), niis(), refresh(), export(), close() }
 */
export function renderPanel(wrap, state, on) {
  const fmtDate = (d) => (d ? `${Number(d.slice(0, 4)) - 1911}/${d.slice(5, 7)}/${d.slice(8, 10)}` : '');
  const names = state.jurisdictionNames || {};
  wrap.replaceChildren();
  const u = state.user || {};
  wrap.append(h('header', { class: 'vx-head' },
    h('div', { class: 'vx-who' }, h('strong', {}, u.name || '病患'), h('span', {}, [u.age != null && `${u.age} 歲`, u.sex === 'M' ? '男' : u.sex === 'F' ? '女' : ''].filter(Boolean).join(' '))),
    on.close && h('button', { class: 'vx-x', 'aria-label': '關閉', onclick: on.close }, '×')));

  if (state.notice) wrap.append(h('div', { class: `vx-notice vx-${state.notice.tone || 'info'}` }, state.notice.text));
  // 頁尾:外掛版號永遠顯示(讀取中、出錯時也要看得到,回報問題用)
  const footer = (res) => {
    const rm = state.rulesMeta || {};
    const parts = [state.appVersion && `VaxCheck v${state.appVersion}`];
    if (res) parts.push(`判定日 ${fmtDate(res.asOf)}`, `規則 ${res.ruleSetVersion}`, `適用 ${names[res.jurisdiction] || res.jurisdiction}`,
      rm.source && `來源 ${rm.source === 'bundled' ? '內建' : rm.source === 'cache' ? '快取' : '線上'}`);
    const text = parts.filter(Boolean).join(';');
    return text && h('footer', { class: 'vx-foot' }, text);
  };
  if (state.error) { wrap.append(h('div', { class: 'vx-notice vx-stop' }, state.error)); }
  if (state.loading) { wrap.append(h('div', { class: 'vx-loading' }, '讀取健保雲端資料…'), footer(null) || ''); return; }
  if (state.error && !state.result && !state.sourceStatus) { const f = footer(null); if (f) wrap.append(f); return; }   // 只有訊息(例如尚未登入)

  const ss = state.sourceStatus || {};
  wrap.append(h('ul', { class: 'vx-sources', 'aria-label': '資料來源' },
    Object.keys(SRC_NAMES).map((k) => h('li', { class: `s-${ss[k] || 'loading'}` }, `${SRC_NAMES[k]} ${SRC_STATE[ss[k]] || ss[k] || ''}`))));

  const res = state.result;
  if (!res) { const f = footer(null); if (f) wrap.append(f); return; }
  const manual = state.manual || {};
  // 分組顯示:可接種 → 待確認 → 尚未開打 → 不符合(依 display.bucket;組內維持規則順序;Result 本身不改順序)
  for (const grp of groupVaccines(res.vaccines)) {
    const list = h('ol', { class: `vx-list vx-list-${grp.key}`, 'aria-label': grp.label });
    wrap.append(h('h3', { class: `vx-grp vx-grp-${grp.key}` }, grp.label, ' ', h('span', { class: 'vx-grp-n' }, String(grp.items.length))));
    for (const v of grp.items) {
      const [word, tone, line] = head(v, fmtDate);
      const providers = [...new Set(v.matchedGroups.map((g) => PROVIDER(g, names)))];
      const li = h('li', { class: `vx-v t-${tone}` },
        h('div', { class: 'vx-verdict' }, word),
        h('div', { class: 'vx-body' },
          h('div', { class: 'vx-name' }, v.name, providers.map((p) => h('span', { class: 'vx-badge' }, p))),
          h('p', { class: 'vx-line' }, line),
          v.explanation && v.verdict !== 'ineligible' && h('p', { class: 'vx-sub' }, v.explanation),
          v.verdict === 'ineligible' && v.reasons.length > 0 && h('p', { class: 'vx-sub' }, v.reasons[0].split(':')[1] || v.reasons[0]),
        ));
      const body = li.querySelector('.vx-body');

      // NIIS 接種對象別代碼(填報用;職業別優先)
      const rp = v.report;
      if (rp && v.display?.bucket !== 'ineligible' && !['completed', 'not_funded', 'contraindicated'].includes(v.verdict)) {   // 只要有已符合的群(今日或開打後)就給填報代碼
        const opt = (o) => `${o.code} ${o.label}`;
        const notes = [...new Set(rp.primary.map((o) => o.note).filter(Boolean))];
        body.append(h('div', { class: 'vx-code' },
          h('div', { class: 'vx-code-main' }, h('span', { class: 'vx-code-k' }, rp.label),
            rp.primary.flatMap((o, i) => [i ? h('span', { class: 'vx-code-or' }, '/') : null, h('b', { class: 'vx-code-v' }, o.code)]),
            h('span', {}, rp.choose ? `(擇一:${rp.primary.map(opt).join('、')})` : rp.primary[0].label)),
          rp.primary.some((o) => o.icd.length) && h('small', {}, ((icd) => `依據 ICD:${icd.slice(0, 3).join('、')}${icd.length > 3 ? ` 等 ${icd.length} 碼` : ''}`)([...new Set(rp.primary.flatMap((o) => o.icd))])),
          rp.others.length > 0 && h('small', {}, `亦符合:${rp.others.map(opt).join('、')}`),
          notes.map((n) => h('small', {}, n)),
          rp.hint && h('small', {}, rp.hint)));
      }
      // 病歷自動判定(可取消):逐項列出命中的 ICD / 旗標
      for (const e of v.evidence) {
        body.append(h('div', { class: 'vx-evid' },
          h('div', { class: 'vx-evid-t' }, h('span', {}, `依病歷判定「${e.label}」`),
            h('button', { class: 'vx-link', onclick: () => on.manual(e.key, false) }, '不符合,取消')),
          h('ul', { class: 'vx-evid-l' }, e.why.map((w) => h('li', {}, w)))));
      }
      // 是/否勾選:勾「是」「否」都重算;再按一次同一鈕 = 取消。多項時可「以上皆否」
      const yn = (items) => {
        const man = items.filter((i) => i.type === 'manual');
        return [...man.map((m) => h('div', { class: 'vx-check', role: 'group', 'aria-label': m.label },
          h('span', {}, m.label, m.hint && h('small', {}, m.hint)),
          h('span', { class: 'vx-yn' },
            h('button', { type: 'button', class: 'vx-yes', 'aria-pressed': String(manual[m.key] === true), onclick: () => on.manual(m.key, manual[m.key] === true ? null : true) }, '是'),
            h('button', { type: 'button', class: 'vx-no', 'aria-pressed': String(manual[m.key] === false), onclick: () => on.manual(m.key, manual[m.key] === false ? null : false) }, '否')))),
        man.length > 1 && h('button', { type: 'button', class: 'vx-link vx-allno', onclick: async () => { for (const m of man) await on.manual(m.key, false); } }, '以上皆否'),
        items.some((i) => i.type === 'source') && h('p', { class: 'vx-sub' }, `另需:${items.filter((i) => i.type === 'source').map((i) => SRC_NAMES[i.key] || i.key).join('、')}`)];
      };
      const dp = v.display || {};
      const up = dp.upgrade;
      if (dp.bucket === 'confirm' && dp.step === '3a' && up) {
        // 3a:保底行(上方 vx-line)+ 升級行 + 是/否(決定性,列入待確認清單)
        body.append(h('fieldset', { class: 'vx-ask vx-up' },
          h('legend', {}, '確認後今天可打'),
          h('p', { class: 'vx-upline' }, `若確認${whatText(up)} → ${upgradeOutcome(up, dp.fallback, fmtDate)}`),
          yn(up.items)));
      } else if (up && !up.decisive) {
        // 3b、不符合:選填提示,不列入待確認清單
        body.append(h('details', { class: 'vx-opt' },
          h('summary', {}, `選填:若確認${whatText(up)},${upgradeOutcome(up, dp.fallback, fmtDate)}`),
          yn(up.items)));
      } else if (v.decisiveManual.length) {
        // 無保底、今天開打中(現行行為):只列勾了會改變結果的
        body.append(h('fieldset', { class: 'vx-ask' },
          h('legend', {}, '若符合下列任一,可能改為可打'),
          yn(v.decisiveManual.map((m) => ({ ...m, type: 'manual' })))));
      }
      // 已被醫師排除的條件可還原
      const ml = state.manualLabels || {};
      const excluded = Object.entries(manual).filter(([k, val]) => val === false && v.groupTrace.some((g) => g.why.some((w) => w.startsWith(`${ml[k] || k}:醫師排除`))));
      if (excluded.length) {
        body.append(h('div', { class: 'vx-evid' }, h('span', {}, `已排除:${excluded.map(([k]) => ml[k] || k).join('、')}`),
          h('button', { class: 'vx-link', onclick: () => excluded.forEach(([k]) => on.manual(k, null)) }, '還原')));
      }
      // 禁忌提醒(一行,不擋)
      for (const r of v.reminders) {
        body.append(h('label', { class: 'vx-remind' },
          h('input', { type: 'checkbox', checked: manual[r.key] === true, onchange: (ev) => on.manual(r.key, ev.target.checked ? true : null) }),
          h('span', {}, `施打前確認:${r.label}`)));
      }
      for (const p of v.precautions) body.append(h('p', { class: 'vx-sub vx-warn' }, `注意:${p.label}`));
      for (const f of v.dosing?.flags || []) body.append(h('p', { class: 'vx-sub vx-warn' }, f === 'NEED_DATE_CONFIRMATION' ? '接種紀錄缺日期,請確認' : '接種史有型別不明紀錄,請確認'));
      if (v.upcoming?.length && !['eligible', 'scheduled'].includes(v.verdict) && !v.display?.upgrade) {
        body.append(h('p', { class: 'vx-sub' }, v.upcoming.map((g) => `${fmtDate(g.window.from)} 起:${g.label}${g.value === null ? '(需確認)' : ''}`).join(';')));
      }
      // 判定依據
      body.append(h('details', { class: 'vx-why' }, h('summary', {}, '判定依據'),
        h('ul', {}, sortTrace(v.groupTrace).map((g) => h('li', { class: `g-${g.value === true ? 'y' : g.value === false ? 'n' : 'u'}` },
          h('b', {}, g.value === true ? '符合' : g.value === false ? '不符' : '未確認'),
          ` ${g.label}`, g.providedBy === 'county' ? `(${PROVIDER(g, names)})` : '', g.state !== 'active' ? `〔${g.state === 'scheduled' ? `${fmtDate(g.window.from)} 起` : '已結束'}〕` : '',
          h('small', {}, g.why.join(';'))))),
        v.dosing?.case && h('p', { class: 'vx-sub' }, `劑次依據:${v.dosing.case.label}(${v.dosing.case.sourceRef || ''})`),
        v.dosing?.variant && h('p', { class: 'vx-sub' }, `劑次依據:${v.dosing.variant.label};本季應接種 ${v.dosing.dosesRequired} 劑,季前累計 ${v.dosing.variant.priorDoses} 劑`)));
      list.append(li);
    }
    wrap.append(list);
  }

  wrap.append(h('div', { class: 'vx-actions' },
    on.niis && h('button', { class: 'vx-btn vx-primary', onclick: on.niis }, ss.niis === 'ok' ? '重查接種史(NIIS)' : '查接種史(NIIS 需過卡)'),
    on.refresh && h('button', { class: 'vx-btn', onclick: on.refresh }, '重新讀取'),
    on.export && h('button', { class: 'vx-btn', onclick: on.export }, '匯出診斷檔')));
  wrap.append(footer(res));
}
