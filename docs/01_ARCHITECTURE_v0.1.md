# 疫苗檢核程式 — 架構草案 v0.1

日期:2026-09-14  狀態:已依此實作 v0.1–v0.3.0(原始碼待重建,見 src/README.md)

## 0. 決定

走 **B 獨立輕量外掛**。理由見對話。附加原則:

- 規則引擎 `engine/` 是純函式(pure function),不碰 DOM、不碰 chrome API,可在 Node 直接測;日後若改走 C,整個目錄搬到院內服務即可。
- 從 repo 只複製 `tokenUtils.js`、`userInfoUtils.js` 兩檔(Apache-2.0,保留 NOTICE),其餘自己寫。
- 相容現有「更好的健保雲端 2.0」的 `localStorage.NHITW_DATA` 列為選配 adapter,不是預設路徑。

## 1. 使用流程(醫師視角)

```
插健保卡 → 開健保雲端 → 按外掛浮動鈕「疫苗檢核」
   ↓ (1–2 秒)
結果面板(第一層):身分/年齡 + 雲端資料能判的每支疫苗
   接種史欄位顯示「未查詢」
   ↓ 按面板內「查接種史」
開/切到 NIIS 分頁 → 醫師過卡+PIN(硬性限制,無法免)
   ↓ PostBack 完成,外掛自動解析
結果面板自動更新:劑次、間隔、已完成
```

一鍵能做到的上限是「第一層」。第二層一定多一次過卡。NIIS 頁面能否由外掛程式化觸發 `btn_Query`(省掉醫師再按一次)待實測。

## 2. 目錄結構

```
VaxCheck/
├── manifest.json
├── package.json                 # 只依賴 esbuild(打包)+ node --test
├── build.mjs                    # 三個入口各打成 IIFE:background / content-medcloud / content-niis
├── NOTICE                       # Apache-2.0 attribution for leescot/NHITW_cloud_analyzer_react_MUI
├── src/
│   ├── background.js            # service worker:跨 origin 中繼、開 NIIS 分頁、storage 清理
│   ├── content/
│   │   ├── medcloud.js          # medcloud2:浮動鈕、抓資料、組 facts、呼叫 engine、渲染面板
│   │   ├── niis.js              # NIIS 院所版:偵測結果表 → 解析 → 寫 chrome.storage.session
│   │   └── panel/               # 結果面板(vanilla + Shadow DOM,不引 UI 框架)
│   │       ├── panel.js
│   │       └── panel.css
│   ├── adapters/                # 原始資料 → PatientFacts;每個來源一檔,回傳統一的 {status, data}
│   │   ├── nhi/
│   │   │   ├── tokenUtils.js    # ← repo 原檔
│   │   │   ├── userInfoUtils.js # ← repo 原檔
│   │   │   ├── api.js           # fetch 包裝:cli_datetime、headers、credentials
│   │   │   ├── medication.js    # imue0008 s02 → diagnoses[] + medications[]
│   │   │   ├── allergy.js       # imue0040 s02 → allergies[](僅顯示,不自動判定)
│   │   │   ├── lab.js           # imue0060 s02 → labs[](eGFR/HbA1c/CD4 正規化)
│   │   │   ├── lftp.js          # imue0190 s01 → specialPayment(結構見 docs/internal 探勘筆記)
│   │   │   └── specialMaterial.js # 10.1 特材(端點待定,stub)
│   │   └── niis/
│   │       ├── parseTable.js    # 結果頁 HTML table → vaccinations[](劑別代號最長前綴比對,見 rules/NIIS_CODES.md)
│   │       └── (vaccineMap.json 已由 rules/niis-vaccine-codes.json 取代;中文名稱只作備援)
│   ├── engine/                  # 純函式,零依賴
│   │   ├── evaluate.js          # evaluate(facts, ruleSet, {asOf}) → Result
│   │   ├── conditions.js        # 每種葉條件的判定,回 true/false/unknown
│   │   ├── codes.js             # ICD/ATC 前綴與區間比對
│   │   ├── age.js               # 實足年齡(年/月/日)、民國轉西元
│   │   ├── dosing.js            # 下一劑、最早可打日、序貫檢查
│   │   └── explain.js           # 模板代入,產生醫師向病患解釋的句子
│   └── rules/                   # 由 scripts/build-rules.mjs 從 rules/ 產出到 dist/rules/
├── fixtures/
│   ├── nhi/fake_patient.json    # 由 repo Fake_Data_250402.json 衍生(medication/allergy/lab)
│   ├── nhi/lftp_*.json          # 去識別
│   └── niis/result_*.html       # 去識別
├── tests/                       # node --test,只測 engine 與 adapters
└── scripts/validate-rules.mjs   # 規則 YAML 對 schema 驗證,CI 用
```

## 3. 資料模型

### 3.1 PatientFacts(engine 的輸入)

```jsonc
{
  "asOf": "2026-10-15",
  "patient": { "sex": "M", "birthDate": "1958-03-02", "ageYears": 68, "ageMonths": 823 },
  "diagnoses":   [ { "code": "E11.9", "system": "ICD-10-CM", "date": "2026-08-01", "source": "medication" } ],
  "medications": [ { "atc7": "L04AA06", "atc5": "L04AA", "ingredient": "...", "date": "2026-08-01" } ],
  "labs":        [ { "item": "eGFR", "value": 42, "unit": "mL/min/1.73m2", "date": "2026-07-20" } ],
  "allergies":   [ { "text": "PENICILLIN", "severity": "3-輕度", "date": null } ],
  "specialPayment":  { "status": "nodata" },          // ok | nodata | unknown_shape | error
  "specialMaterial": { "status": "unavailable" },
  "vaccinations": { "status": "not_queried", "records": [] }, // records: {vaccineCode, date, dose, site, funding}
  "manual": { "indigenous": null, "pregnant": null },  // null = 未問;true/false = 醫師勾選
  "sourceStatus": { "medication": "ok", "allergy": "ok", "lab": "ok", "lftp": "nodata", "niis": "not_queried" }
}
```

身分證字號**不進 facts**。合併鍵只在 background 用,比對後即丟。

### 3.2 三值邏輯

每個葉條件回 `true | false | unknown`。來源 `status ≠ ok` 或人工條件 `null` → unknown。
`all`:任一 false → false;否則有 unknown → unknown;否則 true。`any` 對稱。
因此每支疫苗的結論是四種之一:

| 結論 | 意義 | 面板呈現 |
|---|---|---|
| eligible | 至少一個 group 為 true,無 absolute 禁忌 | 綠,列出 group、建議劑次 |
| ineligible | 所有 group 為 false | 灰,列出每個 group 差在哪(解釋用) |
| needs_input | 沒有 true,但有 unknown 且來自人工條件 | 黃,顯示要勾的項目 |
| unknown_source | 沒有 true,unknown 來自資料來源缺失 | 黃,顯示「接種史未查詢」等 |

(v0.3.0 另加 `not_funded`、`needs_review` 兩種 verdict,見 rules/EXECUTION.md。)

「不符合」的解釋就是把 false 的 group 逐一翻成人話:`{groupLabel}:年齡 {age} 不在 {range}`。

### 3.3 Result(engine 的輸出,面板直接渲染)

```jsonc
{
  "ruleSetVersion": "2026.10.0",
  "asOf": "2026-10-15",
  "vaccines": [
    {
      "vaccineId": "PCV13", "name": "…", "verdict": "eligible",
      "matchedGroups": ["PCV_ELDER_65"],
      "groupTrace": [ { "groupId": "…", "value": true, "why": [ "age 68 ≥ 65" ] } ],
      "nextDose": { "dose": 1, "earliestDate": "2026-10-15", "blockedBy": null },
      "contraindications": [ { "id": "…", "value": "unknown" } ],
      "explanation": "…", "pendingManual": ["severeAllergyToVaccine"]
    }
  ],
  "sourceStatus": { … }
}
```

## 4. 跨來源合併(background)

1. medcloud content 讀 JWT → `UserID`、生日 → 送 background `{type:"session:start", idHash, birthDate}`(idHash = SHA-256(UserID),不存明文)。
2. 按「查接種史」→ background `chrome.tabs.create` 或聚焦既有 NIIS 分頁。
3. NIIS content 在 PostBack 後解析表格,並讀頁面上的 `tb_RocID`,同樣 SHA-256 後送 background。
4. background 比對 idHash 相同才把 vaccinations 寫進 `chrome.storage.session`(關瀏覽器即清)並通知 medcloud 分頁重算;不同則丟棄並警示「NIIS 查的不是同一人」。
5. 換卡(UserID 變)→ 清 session storage。

只用 `chrome.storage.session`,不用 `local`/`sync`,病患資料不落地。

## 5. 範圍護欄

本專案只回答「這位病患現在能不能公費打哪些疫苗、為什麼」。以下都算長歪:
重做健保雲端任何頁籤的瀏覽器功能、慢性病管理提醒、自費疫苗推薦、把用藥/檢驗資料做成儀表板、接 LLM 產生解釋(規則模板已足夠)。
