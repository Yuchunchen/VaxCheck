// §9 固定情境(v0.4.12 保底/升級):單元測試與 v0.4.10 回歸快照共用。生日以 2026 年次推算年齡。
export const B55 = '1971-05-05';   // 年次 55 歲(流感第二階段 50–64)
export const B70 = '1956-03-02';   // 年次 70 歲
export const AT = '2026-10-15';
// 流感第一階段的人工條件(55 歲男性會被問到的全部)
export const FLU_PHASE1_KEYS = ['healthcareWorker', 'indigenous', 'ltcResident', 'fluUnderlyingCondition', 'infantCaregiver', 'childcareWorker', 'animalWorker'];
export const FLU_PHASE1_NO = Object.fromEntries(FLU_PHASE1_KEYS.map((k) => [k, false]));

export const CASES = {
  flu55_0928: { p: { birth: B55, vacc: [] }, asOf: '2026-09-28' },
  flu55_1015: { p: { birth: B55, vacc: [] }, asOf: AT },
  flu55_1015_yes: { p: { birth: B55, vacc: [], manual: { fluUnderlyingCondition: true } }, asOf: AT },
  flu55_1015_no: { p: { birth: B55, vacc: [], manual: { fluUnderlyingCondition: false } }, asOf: AT },
  flu55_1015_allno: { p: { birth: B55, vacc: [], manual: FLU_PHASE1_NO }, asOf: AT },
  flu55_1103: { p: { birth: B55, vacc: [] }, asOf: '2026-11-03' },
  flu70_1015: { p: { birth: B70, vacc: [] }, asOf: AT },
  pn_pcv13_14m: { p: { birth: B70, vacc: [['PCV13', '2025-08-15']] }, asOf: AT },
  pn_pcv13_10w: { p: { birth: B70, vacc: [['PCV13', '2026-08-06']] }, asOf: AT },
  pn_pcv13_3w: { p: { birth: B70, vacc: [['PCV13', '2026-09-24']] }, asOf: AT },
  pn_pcv13_3w_dialysis: { p: { birth: B70, flags: ['dialysis'], vacc: [['PCV13', '2026-09-24']] }, asOf: AT },
  pn_ppv23_10w_ipd: { p: { birth: B70, vacc: [['PPV23', '2026-08-06']], manual: { ipdHighRisk: true } }, asOf: AT },
  pn_pcv_ppv_6y: { p: { birth: B70, vacc: [['PCV13', '2019-06-01'], ['PPV23', '2020-10-15']] }, asOf: AT },
  pn_pcv_ppv_3y: { p: { birth: B70, vacc: [['PCV13', '2022-06-01'], ['PPV23', '2023-10-15']] }, asOf: AT },
};
