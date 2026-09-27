# 疫苗檢核程式 — 架構草案 v0.1

日期:2026-09-14  狀態:已依此實作 v0.1–v0.3.0(原始碼待重建,見 src/README.md)

## 0. 決定

走 **B 獨立輕量外掛**。理由見對話。附加原則:

- 規則引擎 `engine/` 是純函式(pure function),不碰 DOM、不碰 chrome API,可在 Node 直接測;日後若改走 C,整個目錄搬到院內服務即可。
- 從 repo 只複製 `tokenUtils.js`、`userInfoUtils.js` 兩檔(Apache-2.0,保留 NOTICE),其餘自己寫。
- 相容現有「更好的健保雲端 2.0」的 `localStorage.NHITW_DATA` 列為選配 adapter,不是預設路徑。

## 1. 使用流程(醫師視角)

v0.4.9 起(標題列 icon = 一鍵工作區):

```
插健保卡 → 按標題列 VaxCheck 圖示
   ↓
健保雲端分頁:有且已登入 → 切過去(並代按「請換卡再按我」);沒有或未登入 → 開「健保雲端入口網址」(預設 /imu/IMUE1000/?type=icc 自動登入;失效則 15 秒後代按「實體健保卡」)
NIIS 分頁:沒有 → 在健保雲端右側開背景分頁;同一病患 → 不動;不同病患/未查詢 → 導回查詢頁
   ↓ 健保雲端取得本次病患 token(最多等 120 秒)
結果面板自動開啟(第一層):身分/年齡 + 雲端資料能判的每支疫苗
   ↓ NIIS 需按一次「讀取健保卡及醫事人員卡」(可由外掛代按,設定 autoClickNiis,預設關)
PostBack 完成 → 外掛自動解析 → 面板自動更新:劑次、間隔、已完成
```

- 第二層需按一次讀卡鈕(可由外掛代按);PIN 推定不需要(NIIS 頁面程式中簽章與 PIN 相關程式碼已被註解),待院內確認。
- 代按條件(全部成立才按,每次按圖示最多一次):來自按圖示、健保雲端已取得本次病患 token(避免兩個讀卡元件同時搶健保卡)、NIIS 在查詢頁且無 `#div_result`、本次尚未按過。
- NIIS 讀卡失敗時頁面仍會送出表單(`#tb_RocID` 為空)。此時的「本個案查無接種紀錄」一律視為 `error/niis_no_identity`,不寫入接種史,面板顯示「NIIS 未讀到健保卡,接種史未更新」(否則 0 筆會讓肺鏈誤判為從未接種)。
- 面板分三組:可接種 → 待確認 → 不符合(只在渲染層排序,engine Result 維持規則順序;src/panel/order.js)。
- 健保雲端右下浮動鈕「疫苗檢核」保留為備援入口;面板內「查接種史」按鈕仍可開/切到 NIIS 分頁(不代按)。
- 設定:`medcloudEntryUrl`、`niisQueryUrl`(空白或主機不符 → 按圖示改開設定頁)、`autoSwitchCard`(預設開)、`autoClickNiis`(預設關)。
- 實作:`src/workspace/`(workspace.js 分頁決策與代按條件、login.js 自動登入與備援、switch.js 換卡與等 token、options.js 設定與遷移);background 的 `openWorkspace` 由 `chrome.action.onClicked` 與 runtime 訊息 `{type:"workspace:open"}`(e2e 用,只接受外掛自己的頁面)觸發。manifest 的 action 不可設 `default_popup`。

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
│   │   │   ├── lftp.js          # imue0190 s01 → specialPayment(結構依院內探勘,筆記未公開)
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
2. 按標題列圖示(或面板「查接種史」)→ background 開/聚焦 NIIS 分頁(§1 的分頁決策)。
3. NIIS content 在 PostBack 後解析表格,並讀頁面上的 `tb_RocID`,同樣 SHA-256 後送 background。
4. background 比對 idHash 相同才把 vaccinations 寫進 `chrome.storage.session`(關瀏覽器即清)並通知 medcloud 分頁重算;不同則丟棄並警示「NIIS 查的不是同一人」。
5. 換卡(UserID 變)→ 清 session storage。

只用 `chrome.storage.session`,不用 `local`/`sync`,病患資料不落地。

## 5. 範圍護欄

本專案只回答「這位病患現在能不能公費打哪些疫苗、為什麼」。以下都算長歪:
重做健保雲端任何頁籤的瀏覽器功能、慢性病管理提醒、自費疫苗推薦、把用藥/檢驗資料做成儀表板、接 LLM 產生解釋(規則模板已足夠)。
