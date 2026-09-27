import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';
import { makeCodeTable, parseDoseLabel, parseNiisDocument } from '../src/adapters/niis/parse.js';
import { buildFacts, lftpToFacts, summaryToFlags, medicationToFacts } from '../src/adapters/nhi/facts.js';
import { decodeJwt, userFromPayload } from '../src/adapters/nhi/token.js';
import { evaluate } from '../src/engine/index.js';
import { rules } from './helpers.mjs';

const table = makeCodeTable(JSON.parse(fs.readFileSync('rules/niis-vaccine-codes.json', 'utf8')));
const doc = (f) => parseHTML(fs.readFileSync(f, 'utf8')).document;

test('劑別代號:最長前綴、含 - 與 / 的代碼、無劑次、Booster、批號', () => {
  const p = (s) => parseDoseLabel(s, table);
  assert.deepEqual([p('CoV_bModerna_BA4/5-B2').niisCode, p('CoV_bModerna_BA4/5-B2').boosterSeq], ['CoV_bModerna_BA4/5', 2]);
  assert.deepEqual([p('DTaP-HepB-IPV-3').niisCode, p('DTaP-HepB-IPV-3').dose], ['DTaP-HepB-IPV', 3]);
  assert.deepEqual([p('JE-CV_LiveAtd-2').canonical, p('JE-CV_LiveAtd-2').dose], ['JE', 2]);
  assert.deepEqual([p('BCG').canonical, p('BCG').dose], ['BCG', null]);
  assert.equal(p('CoV_Moderna-Booster2').boosterSeq, 2);
  assert.equal(p('CoV_Moderna-Booster').doseString, 'booster');
  assert.deepEqual([p('CoV_AZ-1(批號D006A)').dose, p('CoV_AZ-1(批號D006A)').lot], [1, 'D006A']);
  assert.equal(p('13PCV-1').canonical, 'PCV13');
  assert.equal(p('PPV-1').canonical, 'PPV23');
  assert.equal(p('21PCV-1').canonical, 'PCV21');
  assert.equal(p('rHepB').canonical, 'HEPB');
});

test('03_FIELD_NOTES 見過的劑別代號全部可對應', () => {
  for (const s of ['Flu-1', 'CoV_AZ-2', 'CoV_BioNTech-3', 'CoV_Moderna_JN-1', 'Zoster-1', 'HBIG', 'BCG', 'MV', 'pHepB-3', 'DTP-4', 'OPV-5', 'MMR-1', 'JE-3', '2HepA-2', 'CoV_Moderna-Booster', 'CoV_Moderna-Booster2', 'CoV_Moderna_XBB-1', 'CoV_Moderna_LP-1']) {
    assert.ok(parseDoseLabel(s, table), s);
  }
});

test('NIIS 結果頁解析:公/自費、排除大便卡、名稱備援、未對應回報', () => {
  const r = parseNiisDocument(doc('fixtures/niis/result_synthetic.html'), table);
  assert.equal(r.found, true);
  assert.equal(r.rocId, 'A123456789');
  const codes = r.records.map((x) => x.code);
  assert.ok(!codes.includes('Stool'));
  assert.equal(r.meta.excluded, 1);
  assert.ok(codes.includes('PNEUMO_UNKNOWN'), '空白劑別 + 肺炎鏈球菌名稱 → 型別不明');
  assert.deepEqual(r.meta.unmapped, ['XYZ-1|未知疫苗']);
  const pcv = r.records.find((x) => x.code === 'PCV13');
  assert.deepEqual([pcv.funding, pcv.date], ['自費', '2024-03-01']);
  assert.equal(r.records[0].date <= r.records.at(-1).date, true, '依日期排序,不依賴頁面列順序');
});

test('NIIS 查無紀錄頁 → 找到、0 筆、保留訊息', () => {
  const r = parseNiisDocument(doc('fixtures/niis/result_empty.html'), table);
  assert.deepEqual([r.found, r.records.length, r.meta.emptyMessage], [true, 0, '本個案查無接種紀錄']);
});

test('JWT:民國生日與性別', () => {
  const payload = { UserID: 'A123456789', UserName: '測試', UserSex: 'M', UserBirthday: '0470302' };
  const tok = 'x.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.y';
  assert.deepEqual(userFromPayload(decodeJwt(tok)), { userId: 'A123456789', name: '測試', sex: 'M', birthDate: '1958-03-02', exp: null });
});

test('健保雲端假資料 → facts:診斷去重、居家醫療旗標、慢性腎臟病旗標', () => {
  const fx = JSON.parse(fs.readFileSync('fixtures/nhi/fake_patient.json', 'utf8'));
  const m = medicationToFacts(fx.medication);
  assert.ok(m.diagnoses.length < fx.medication.robject.length, '用藥逐筆 → 診斷依就醫去重');
  const f = summaryToFlags(fx.summary);
  assert.ok(f.values.includes('homeCare') && f.values.includes('ckd'));
  const facts = buildFacts({ user: { sex: 'M', birthDate: '1958-03-02' }, med: fx.medication, lab: fx.lab, allergy: fx.allergy, summary: fx.summary, lftp: JSON.parse(fs.readFileSync('fixtures/nhi/lftp_synthetic.json', 'utf8')) });
  assert.equal(facts.sourceStatus.lftp, 'ok');
  const res = evaluate(facts, rules(), { asOf: '2026-09-16' });
  assert.equal(res.vaccines.find((v) => v.vaccineId === 'PNEUMO_PCV20_21').verdict, 'pending_history');
});

test('lftp 結構不同 → unknown_shape(不當成無資料)', () => {
  assert.equal(lftpToFacts({ robject: [{ x: 1 }] }).status, 'unknown_shape');
  assert.equal(lftpToFacts({ robject: { drugs: [], medical_service: [], special_material: [] } }).status, 'nodata');
});

test('端對端(純函式):NIIS 解析結果併入 facts 後重算', () => {
  const r = parseNiisDocument(doc('fixtures/niis/result_synthetic.html'), table);
  const facts = buildFacts({ user: { sex: 'M', birthDate: '1955-01-01' }, med: { robject: [] }, lab: { robject: [] }, allergy: { robject: [] }, summary: { robject: [] }, lftp: { robject: { drugs: [], medical_service: [], special_material: [] } }, vaccinations: { status: 'ok', records: r.records } });
  const v = evaluate(facts, rules(), { asOf: '2026-09-16' }).vaccines.find((x) => x.vaccineId === 'PNEUMO_PCV20_21');
  assert.equal(v.verdict, 'needs_review', '有型別不明的肺鏈紀錄 → 人工確認');
});
