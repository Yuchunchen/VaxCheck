// 健保雲端 API 回傳 → PatientFacts 片段。純函式,可在 Node 測試。
import { normDate } from '../../engine/dates.js';

const rows = (json) => (json ? json.rObject || json.robject || [] : []);
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** IMUE0008 用藥紀錄 → 診斷(去重到每次就醫)+ 用藥 */
export function medicationToFacts(json) {
  const dx = new Map(); const meds = [];
  for (const r of rows(json)) {
    const date = normDate(r.drug_date || r.func_date);
    if (r.icd_code) {
      const key = `${r.icd_code}|${date}|${r.hosp_id || r.hosp || ''}`;
      if (!dx.has(key)) dx.set(key, { code: r.icd_code, name: r.icd_cname || '', date, source: 'medication' });
    }
    if (r.drug_atc7_code) meds.push({ atc7: r.drug_atc7_code, name: r.drug_ename || r.drug_ing_name || '', date });
  }
  return { diagnoses: [...dx.values()], medications: meds };
}

const LAB_ITEMS = [[/egfr/i, 'eGFR'], [/hba1c|a1c|醣化/i, 'HbA1c'], [/cd4/i, 'CD4']];
export function labToFacts(json) {
  const labs = []; const dx = new Map();
  for (const r of rows(json)) {
    const date = normDate(r.real_inspect_date || r.recipe_date);
    const name = `${r.assay_item_name || ''} ${r.order_name || ''}`;
    const hit = LAB_ITEMS.find(([re]) => re.test(name));
    const value = Number.parseFloat(String(r.assay_value).replace(/[^\d.-]/g, ''));
    if (hit && Number.isFinite(value)) labs.push({ item: hit[1], value, unit: r.unit_data || '', date });
    if (r.icd_code) { const k = `${r.icd_code}|${date}`; if (!dx.has(k)) dx.set(k, { code: r.icd_code, name: r.icd_cname || '', date, source: 'lab' }); }
  }
  return { labs, diagnoses: [...dx.values()] };
}

export function allergyToFacts(json) {
  return { allergies: rows(json).map((r) => ({ text: String(r.drug_name || '').replace(/^;+/, ''), severity: r.allerg_severity_level || '', date: normDate(r.upload_d) })) };
}

/** IMUE0190 特殊給付限制(lftp):robject = { drugs, medical_service, special_material } */
export function lftpToFacts(json) {
  const ro = json?.robject || json?.rObject;
  if (!ro || typeof ro !== 'object' || Array.isArray(ro) || !('drugs' in ro || 'medical_service' in ro || 'special_material' in ro)) {
    return { status: 'unknown_shape', specialPayment: { drugs: [], services: [], materials: [] } };
  }
  const map = (list) => arr(list).map((r) => ({ code: r.order_code || '', name: r.cure_cname || '', date: normDate(r.func_date), icd: r.icd_code || null }));
  const sp = { drugs: map(ro.drugs), services: map(ro.medical_service), materials: map(ro.special_material) };
  const empty = !sp.drugs.length && !sp.services.length && !sp.materials.length;
  const dx = [...sp.drugs, ...sp.services, ...sp.materials].filter((r) => r.icd).map((r) => ({ code: r.icd, name: '', date: r.date, source: 'lftp' }));
  return { status: empty ? 'nodata' : 'ok', specialPayment: sp, diagnoses: dx };
}

const FLAG_RULES = [
  ['homeCare', /居家醫療|居家照護/],
  ['dialysis', /透析|洗腎/],
  ['ckd', /慢性腎臟病/],
  ['hospice', /安寧/],
  ['longTermCare', /長照|長期照護|長期照顧/],
];
/** IMUE2000 病人資訊摘要句 → 旗標 */
export function summaryToFlags(json) {
  const values = []; const evidence = {};
  for (const r of rows(json)) {
    const t = stripHtml(r.txt);
    for (const [flag, re] of FLAG_RULES) if (re.test(t) && !values.includes(flag)) { values.push(flag); evidence[flag] = t.length > 60 ? t.slice(0, 60) + '…' : t; }
  }
  return { values, evidence };
}

/** 組合全部來源 → facts(身分證不進 facts) */
export function buildFacts({ user, med, lab, allergy, lftp, summary, status = {}, vaccinations, manual, residenceJurisdiction = null }) {
  const m = med ? medicationToFacts(med) : { diagnoses: [], medications: [] };
  const l = lab ? labToFacts(lab) : { labs: [], diagnoses: [] };
  const a = allergy ? allergyToFacts(allergy) : { allergies: [] };
  const lf = lftp ? lftpToFacts(lftp) : { status: status.lftp || 'error', specialPayment: { drugs: [], services: [], materials: [] }, diagnoses: [] };
  const flags = summary ? summaryToFlags(summary) : { values: [], evidence: {} };
  return {
    patient: { sex: user?.sex || null, birthDate: user?.birthDate || null, residenceJurisdiction },
    diagnoses: [...m.diagnoses, ...l.diagnoses, ...lf.diagnoses],
    medications: m.medications, labs: l.labs, allergies: a.allergies,
    specialPayment: lf.specialPayment, flags,
    vaccinations: vaccinations || { status: 'not_queried', records: [] },
    manual: manual || {},
    sourceStatus: {
      medication: status.medication || (med ? (rows(med).length ? 'ok' : 'nodata') : 'error'),
      lab: status.lab || (lab ? (rows(lab).length ? 'ok' : 'nodata') : 'error'),
      allergy: status.allergy || (allergy ? 'ok' : 'error'),
      lftp: lftp ? lf.status : status.lftp || 'error',
      summary: status.summary || (summary ? 'ok' : 'error'),
      niis: vaccinations?.status || 'not_queried',
      patient: user?.birthDate ? 'ok' : 'error',
    },
  };
}
