import { buildAll } from '../scripts/lib/rules.mjs';
import { evaluate } from '../src/engine/index.js';

let _rules;
export function rules() {
  if (!_rules) { const { outputs, errors } = buildAll(); if (errors.length) throw new Error(errors.join('\n')); _rules = outputs.TW; }
  return _rules;
}
const OK = { medication: 'ok', lab: 'ok', allergy: 'ok', lftp: 'nodata', summary: 'ok' };
/** 建立病患事實;vacc = null 表示接種史未查 */
export function patient({ birth, sex = 'M', dx = [], meds = [], flags = [], vacc = null, manual = {}, sources = {} }) {
  return {
    patient: { sex, birthDate: birth },
    diagnoses: dx.map(([code, date]) => ({ code, date })),
    medications: meds.map(([atc7, date]) => ({ atc7, date })),
    labs: [], allergies: [],
    specialPayment: { drugs: [], services: [], materials: [] },
    flags: { values: flags, evidence: {} },
    vaccinations: vacc ? { status: 'ok', records: vacc.map(([code, date, funding = '公費']) => ({ code, date, funding })) } : { status: 'not_queried', records: [] },
    manual,
    sourceStatus: { ...OK, niis: vacc ? 'ok' : 'not_queried', ...sources },
  };
}
export function run(facts, asOf, rs = rules()) { return evaluate(facts, rs, { asOf }); }
export const V = (res, id) => res.vaccines.find((v) => v.vaccineId === id);
