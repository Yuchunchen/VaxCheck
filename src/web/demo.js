// 手動模式/示範頁:同一套引擎與面板,用合成病患跑。純靜態,關頁即清。
import rules from '../../dist/rules/vaccines.TW.json';
import { evaluate } from '../engine/index.js';
import { ageYears, todayISO } from '../engine/dates.js';
import { mountPanel, renderPanel } from '../panel/panel.js';
import { SAMPLES, toFacts } from './samples.js';

const $ = (s) => document.querySelector(s);
const manualLabels = Object.fromEntries(rules.manualConditions.map((m) => [m.key, m.label]));
let current = SAMPLES[0];
let manual = {};
let niisQueried = true;
let factsOverride = null;

const { wrap } = mountPanel($('#panel-host'), { floating: false });

function facts() { const f = factsOverride ? structuredClone(factsOverride) : toFacts(current, { niisQueried }); f.manual = manual; return f; }

function render() {
  const f = facts();
  const asOf = $('#asof').value || todayISO();
  let result, error;
  try { result = evaluate(f, rules, { asOf }); } catch (e) { error = `判定失敗:${e.message}`; }
  renderPanel(wrap, {
    user: { name: factsOverride ? '自訂病患' : `示範病患 ${current.id}`, sex: f.patient.sex, age: f.patient.birthDate ? ageYears(f.patient.birthDate, asOf) : null },
    result, error, sourceStatus: f.sourceStatus, manual, manualLabels, jurisdictionNames: { TW: '中央' }, rulesMeta: { source: 'bundled' },
    notice: niisQueried ? null : { tone: 'wait', text: '模擬接種史尚未查詢' },
  }, {
    manual: (k, v) => { if (v === null) delete manual[k]; else manual[k] = v; render(); },
  });
  const { manual: _m, ...shown } = f;
  $('#facts').value = JSON.stringify(shown, null, 1);
}

function syncControls() {
  document.querySelectorAll('#samples button').forEach((b) => b.setAttribute('aria-pressed', String(!factsOverride && b.dataset.id === current.id)));
  $('#niis').checked = niisQueried;
}

$('#samples').append(...SAMPLES.map((s) => {
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.id = s.id; b.textContent = s.title;
  b.onclick = () => { current = s; manual = {}; factsOverride = null; syncControls(); render(); if (window.innerWidth < 860) $('#panel-host').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); };
  return b;
}));
$('#asof').value = todayISO();
$('#asof').onchange = render;
$('#niis').onchange = (e) => { niisQueried = e.target.checked; factsOverride = null; render(); };
$('#apply').onclick = () => {
  try { factsOverride = JSON.parse($('#facts').value); $('#facts-msg').textContent = '已套用自訂事實'; syncControls(); render(); }
  catch (e) { $('#facts-msg').textContent = `JSON 格式錯誤:${e.message}`; }
};
$('#rulever').textContent = rules.ruleSetVersion;
syncControls();
render();
