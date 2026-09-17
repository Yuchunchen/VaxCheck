# NIIS 疫苗代碼(VaccID)— 對照說明 v1.1(2026-09-17)

機器正本:`rules/niis-vaccine-codes.json`(version `2026.09.17-niis1`)。本文只講來源、格式與對規則引擎的影響。

## 決定(2026-09-17,YC)
**方案 a**:規則檔(`vaccines.yaml`)一律寫 canonical 代碼(`PCV13`、`PPV23`、`FLU`…),不寫 NIIS 原碼。NIIS 劑別代號 → canonical 的對照由程式載入 `niis-vaccine-codes.json` 完成。`schema.json` 的 `NIIS-VACCINE` 與 `historyMatch` 描述已同步改。

## 來源
| 檔 | 版本 | 取用 |
|---|---|---|
| 疫苗接種紀錄 API 規格書 | 1.3.7(115/09/01) | 附錄二 疫苗/大便卡代碼表(81 碼 + Stool)、附錄三 身分別代碼(F 公費流感、R 常規補種) |
| 預注資料查詢 API 規格書 | 0.9.2(115/08/01) | `ImmuRcd.VaccineID` = `{code}-{dose}`;`BatchType` = 公費/自費/臨床試驗 |
| 自費疫苗名稱及代碼表 | 114 年 10 月 | 38 碼標 `selfPayListed`;含自費劑別與對象 |
| 疫苗庫存 API、檢驗結果登錄 API | — | 與規則引擎無關,未取用 |

## 關鍵發現
1. **NIIS 網頁「劑別代號」欄 = 官方 VaccID-劑次**。探勘看到的 `Flu-1`、`CoV_Moderna-Booster2`、`13PCV-1`、`JE-CV_LiveAtd-2` 全部能對上本表 → 解析器改以劑別代號比對,中文名稱降為顯示與備援。
2. **肺鏈代碼確定**:`PPV`=PPV23、`13PCV`、`15PCV`、`20PCV`、`21PCV`(115/04 新增,劑次 1)、歷史 `7PCV`/`10PCV`。
3. **公/自費來源**:查詢 API `BatchType` 公費/自費/臨床試驗;網頁「批號類型」欄同義。上傳端批號字尾:`-CDC` 中央公費、`-HPA` 公費 HPV、`-{縣市碼}-hb` 地方自購、無字尾自費。肺鏈 S3 例外所需的 funding 欄位有官方依據。
4. **流感四碼**:`Flu`、`LAIV`(114/10/13 啟用)、`FluHD`、`FluAdj`(115/08 新增)皆 canonical `FLU`;公費流感身分別 F01–F09 見規格書附錄三(F02B、F05B 為 115/09 新增)。
5. **註記刪除 ≠ 可忽略**:31 碼(`JE`、`Zoster`、`7PCV`、`10PCV`、`OPV`、`DTP`、`pHepB`、`MMRV`、`4MPSV`、各 CoV 原始株/雙價/XBB…)已停止上傳,但探勘病患的歷史紀錄裡大量出現。對照表保留,`active:false`。

## 實作規格(方案 a,給下一次改程式用)

### 1. 檔案
- `rules/niis-vaccine-codes.json` 隨 `vaccines.yaml` 一起進 build,打包到 `dist/rules/`。取代原 `src/adapters/niis/vaccineMap.json`(中文名稱猜測表)。
- 引擎不讀原碼:`fromBundle.js` / adapter 輸出的 `vaccinations[].code` 已是 canonical。

### 2. 解析器 `adapters/niis/parseTable.js`
```
parseDoseLabel(label):
  s = label.trim()
  for code in CODES sorted by length desc:
    if s == code            → {niisCode: code, dose: null}
    if s.startsWith(code + '-') → {niisCode: code, doseRaw: s.slice(code.length+1)}
  → null(未對應)
doseRaw 正規化:
  /^\d+$/           → doseNumber = int
  /^Booster(\d*)$/  → doseString = 'booster', boosterSeq = n||1
  /^B(\d*)$/        → 同上(上傳格式,保險)
  其他              → doseString = raw,標 niisMeta.unparsedDose
```
- 對到 `code` 後:`canonical = table[code].canonical`,`active`、`group` 一併帶入 Immunization(`series` 放原劑別代號,`vaccineCode.coding[0]` 放 canonical,`coding[1]` 放 NIIS 原碼 system=`niis-vaccid`)。
- `Stool` 排除,不進 Immunization。
- 劑別代號空白或對不上 → 才走中文名稱備援(舊 vaccineMap 邏輯保留為 fallback),仍對不上 → `niisMeta.unmapped` 原樣回報(現有行為)。
- funding:網頁「批號類型」欄原字串 → `公費` / `自費` / `臨床試驗`;其他值原樣保留,`has.funding` 比對不命中。

### 3. 規則檔
- `historyMatch.vaccineCodes`、`has/none/intervalFrom` 全部用 canonical;現有 `vaccines.yaml` 已符合。
- `unknownTypeCodes: [PNEUMO_UNKNOWN, PCV]` 保留,但只有名稱備援路徑會產生這兩個碼。

### 4. 驗證(`scripts/validate-rules.mjs`,已實作)
- 規則檔內所有 `historyMatch.vaccineCodes`、`has`、`none`、`intervalFrom`、`vaccination.vaccineCodes` 出現的代碼,必須存在於 `niis-vaccine-codes.json` 的 `canonical` 值集合 ∪ 該疫苗的 `unknownTypeCodes`;否則 fail。

### 5. 測試
- 單元:探勘所見 22 種劑別代號 → 期望 niisCode/canonical/dose 各一筆快照。
- 邊界:`CoV_bModerna_BA4/5-B2`、`DTaP-HepB-IPV-3`、`JE-CV_LiveAtd-2`(含 `-`/`/` 的碼)、`BCG`(無劑次)、`rHepB`(無劑次允許)、`CoV_Moderna-Booster2`。

## 未決
- `MMRV` 在 1.3.7 為註記刪除,但 114/10 自費表仍列且 R03C 提到 MMRV-2 臨床試驗;實際紀錄可能兩者都有,對照表兩邊保留。
- `21PCV` 不在 114/10 自費表(晚於該表),自費 PCV21 紀錄的 `BatchType` 仍應為「自費」,不影響規則。
- 網頁「劑別代號」Booster 寫法是否與查詢 API `VaccineID` 完全同格式,再看 1 位有 COVID 追加劑的病患確認;探勘病患 5 已見 `CoV_Moderna-Booster`,初步相符。
- CVX 對照:可從本表 `en` 欄逐碼對 CDC CVX 值集,補進 FHIR `vaccineCode.coding[2]`;尚未做。
