// 結果面板:原生 DOM + Shadow DOM,外掛與示範頁共用。只負責畫,不做判定。
import { CSS } from './panel.css.js';

const SRC_NAMES = { medication: '用藥', lab: '檢驗', allergy: '過敏', lftp: '特殊給付', summary: '病人資訊', niis: '接種史' };
const SRC_STATE = { ok: '已取得', nodata: '無資料', not_queried: '未查詢', error: '讀取失敗', unknown_shape: '格式不符', unavailable: '未實作', loading: '讀取中' };
const PROVIDER = (g, names) => (g.providedBy === 'county' ? (names[g.jurisdiction] || g.jurisdiction) : '中央');

function head(v, fmtDate) {
  const d = v.dosing || {};
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
  const list = h('ol', { class: 'vx-list' });
  for (const v of res.vaccines) {
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

    // 病歷自動判定(可取消)
    for (const e of v.evidence) {
      body.append(h('div', { class: 'vx-evid' },
        h('span', {}, `依病歷判定「${e.label}」:${e.why.join(';')}`),
        h('button', { class: 'vx-link', onclick: () => on.manual(e.key, false) }, '不符合,取消')));
    }
    // 決定性條件:只列勾了會改變結果的
    if (v.decisiveManual.length) {
      body.append(h('fieldset', { class: 'vx-ask' },
        h('legend', {}, '若符合下列任一,可能改為可打'),
        v.decisiveManual.map((m) => h('label', { class: 'vx-check' },
          h('input', { type: 'checkbox', checked: manual[m.key] === true, onchange: (ev) => on.manual(m.key, ev.target.checked ? true : null) }),
          h('span', {}, m.label, m.hint && h('small', {}, m.hint))))));
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
    if (v.upcoming?.length && !['eligible', 'scheduled'].includes(v.verdict)) {
      body.append(h('p', { class: 'vx-sub' }, v.upcoming.map((g) => `${fmtDate(g.window.from)} 起:${g.label}${g.value === null ? '(需確認)' : ''}`).join(';')));
    }
    // 判定依據
    body.append(h('details', { class: 'vx-why' }, h('summary', {}, '判定依據'),
      h('ul', {}, v.groupTrace.map((g) => h('li', { class: `g-${g.value === true ? 'y' : g.value === false ? 'n' : 'u'}` },
        h('b', {}, g.value === true ? '符合' : g.value === false ? '不符' : '未確認'),
        ` ${g.label}`, g.providedBy === 'county' ? `(${PROVIDER(g, names)})` : '', g.state !== 'active' ? `〔${g.state === 'scheduled' ? `${fmtDate(g.window.from)} 起` : '已結束'}〕` : '',
        h('small', {}, g.why.join(';'))))),
      v.dosing?.case && h('p', { class: 'vx-sub' }, `劑次依據:${v.dosing.case.label}(${v.dosing.case.sourceRef || ''})`),
      v.dosing?.variant && h('p', { class: 'vx-sub' }, `劑次依據:${v.dosing.variant.label};本季應接種 ${v.dosing.dosesRequired} 劑,季前累計 ${v.dosing.variant.priorDoses} 劑`)));
    list.append(li);
  }
  wrap.append(list);

  wrap.append(h('div', { class: 'vx-actions' },
    on.niis && h('button', { class: 'vx-btn vx-primary', onclick: on.niis }, ss.niis === 'ok' ? '重查接種史(NIIS)' : '查接種史(NIIS 需過卡)'),
    on.refresh && h('button', { class: 'vx-btn', onclick: on.refresh }, '重新讀取'),
    on.export && h('button', { class: 'vx-btn', onclick: on.export }, '匯出診斷檔')));
  wrap.append(footer(res));
}
