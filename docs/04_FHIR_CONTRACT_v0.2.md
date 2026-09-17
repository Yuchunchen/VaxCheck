# FHIR 契約(模組間溝通格式)— v0.2.0

依 YC 決定(2026-09-15):模組之間一律以 **FHIR R4 Bundle(type=collection)** 溝通,profile 標 TW Core IG v1.0.0。
adapters 仍各自產出 facts 片段,由 `toBundle.js` 組成 Bundle;規則引擎以 `evaluateBundle(bundle, rules)` 進入,內部用 `fromBundle.js` 還原成 facts 再評估。

```
adapters(nhi/*, niis/*) ──facts 片段──▶ factsToBundle ──Bundle──▶ evaluateBundle ──Result──▶ panel
NIIS content script ──immunizationsToBundle──▶ background(chrome.storage.session)──Bundle──▶ mergeImmunizations
匯出診斷 JSON = 此 Bundle(去姓名/雜湊)+ Result
```

## 資源對映

| facts | FHIR 資源 | 代碼系統 | 備註 |
|---|---|---|---|
| patient | Patient(TW Core) | identifier = SHA-256(身分證),自訂 system | 不放真實身分證 |
| vaccinations | Immunization(TW Core) | vaccineCode:coding[0] canonical、coding[1] NIIS VaccID(system `niis-vaccid`)、coding[2] CVX(待校對) | `protocolApplied.doseNumberPositiveInt`;Booster → `doseNumberString="booster"`;`series` 放 NIIS 劑別代號;`fundingSource.text` 放 公費/自費/臨床試驗 |
| diagnoses | Condition(TW Core) | ICD-10-CM | 來源(用藥/出院)記在 note |
| medications | MedicationDispense(TW Core) | ATC、健保藥品代碼 | 雲端「用藥紀錄」本質是申報調劑 |
| labs | Observation(TW Core lab) | LOINC(有對照者)+ 自訂 lab-item | |
| allergies | AllergyIntolerance(TW Core) | 純文字 | |
| lftp 藥品 / 醫療服務 / 特材 | MedicationDispense / Procedure / DeviceUseStatement | 健保代碼 | 以 `lftp-category` 標記,反查用 |
| flags(居家醫療…) | Flag | 自訂 summary-flag | |
| manual(醫師勾選) | Observation(social-history, valueBoolean) | 自訂 manual-condition | 未確認者不產生資源 |
| sourceStatus | Parameters `source-status` | | 操作性中繼資料 |
| NIIS 解析中繼(表頭/未對應名稱) | Parameters `niis-meta` | | |

## 已知缺口(誠實列出)
- **未跑官方驗證器**:結構對齊 TW Core,但尚未用 HL7 FHIR Validator + TW Core package 驗證;TW Core Patient 要求身分證 identifier,本專案刻意以雜湊取代,不會完全 conformant。
- 健保醫令 / 特材代碼的 TW Core CodeSystem URI 為推測(`systems.js` 標「待核」)。
- CVX 對照值為初稿,需與 CDC 值集校對(可從 `rules/niis-vaccine-codes.json` 的 `en` 欄逐碼對);TW Core Immunization 的 vaccineCode 綁定值集待確認後替換自訂代碼系統。
- Result(判定結果)仍是本專案 JSON;若要 FHIR 化,候選為 CDS Hooks Card / `GuidanceResponse`,目前不做。
