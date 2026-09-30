// 合成病患(虛構,不含任何真實資料)。vacc: [canonical, 日期, 公費|自費]
export const SAMPLES = [
  { id: 'A', title: '68 歲男,從未接種肺鏈', birth: '1958-03-02', sex: 'M', vacc: [] },
  { id: 'B', title: '68 歲男,今年 6 月打過 PCV13', birth: '1958-03-02', sex: 'M', vacc: [['PCV13', '2026-06-01']] },
  { id: 'C', title: '67 歲男,洗腎,今年 6 月打過 PCV13', birth: '1959-07-07', sex: 'M', flags: ['dialysis'], vacc: [['PCV13', '2026-06-01']] },
  { id: 'D', title: '45 歲女,地中海型貧血(D56.1)', birth: '1981-04-01', sex: 'F', dx: [['D561', '2026-02-10', '乙型地中海型貧血']], vacc: [] },
  { id: 'E', title: '71 歲男,已打 PCV13 + PPV23', birth: '1955-05-05', sex: 'M', vacc: [['PCV13', '2018-01-01'], ['PPV23', '2019-01-01']] },
  { id: 'F', title: '25 歲男,無病史', birth: '2001-01-01', sex: 'M', vacc: [] },
  { id: 'G', title: '58 歲女,糖尿病規律就醫', birth: '1968-05-05', sex: 'F', dx: [['E119', '2026-01-10', '第二型糖尿病'], ['E119', '2026-04-10', '第二型糖尿病']], vacc: [] },
  { id: 'H', title: '66 歲女,自費 PPV23 + 公費 PCV13', birth: '1960-02-02', sex: 'F', vacc: [['PPV23', '2020-01-01', '自費'], ['PCV13', '2024-01-01', '公費']] },
  { id: 'I', title: '52 歲男,乳癌化療中', birth: '1974-08-08', sex: 'M', dx: [['C509', '2025-11-01', '乳房惡性腫瘤']], meds: [['L01CD01', '2026-08-20', 'Paclitaxel']], vacc: [] },
  { id: 'J', title: '55 歲男,潛在疾病未確認(流感第二階段)', birth: '1971-05-05', sex: 'M', vacc: [] },
  { id: 'K', title: '70 歲男,8/6 打過 PCV13(8 週 vs 1 年)', birth: '1956-03-02', sex: 'M', vacc: [['PCV13', '2026-08-06']] },
  { id: 'L', title: '30 歲男,只有寬泛碼 Q87.89(罕見疾病名單,只顯示不預勾)', birth: '1996-01-01', sex: 'M', dx: [['Q8789', '2026-04-01', '其他特定先天畸形症候群']], vacc: [] },
  { id: 'M', title: '30 歲男,Prader-Willi(Q87.11,罕見疾病預勾)', birth: '1996-01-01', sex: 'M', dx: [['Q8711', '2026-04-01', 'Prader-Willi 症候群']], vacc: [] },
  { id: 'N', title: '66 歲女,10/5 已打流感(10/1 起算本季)', birth: '1960-02-02', sex: 'F', vacc: [['FLU', '2026-10-05']] },
];

export function toFacts(s, { niisQueried = true } = {}) {
  return {
    patient: { sex: s.sex, birthDate: s.birth, residenceJurisdiction: null },
    diagnoses: (s.dx || []).map(([code, date, name]) => ({ code, date, name })),
    medications: (s.meds || []).map(([atc7, date, name]) => ({ atc7, date, name })),
    labs: [], allergies: [],
    specialPayment: { drugs: [], services: [], materials: [] },
    flags: { values: s.flags || [], evidence: Object.fromEntries((s.flags || []).map((f) => [f, f === 'dialysis' ? '此病人為洗腎(透析)個案' : f])) },
    vaccinations: niisQueried ? { status: 'ok', records: (s.vacc || []).map(([code, date, funding = '公費']) => ({ code, date, funding })) } : { status: 'not_queried', records: [] },
    manual: {},
    sourceStatus: { medication: 'ok', lab: 'ok', allergy: 'ok', lftp: 'nodata', summary: 'ok', niis: niisQueried ? 'ok' : 'not_queried' },
  };
}
