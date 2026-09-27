# 規則供應鏈(rule supply chain)設計 v0.1

日期:2026-09-16  狀態:提案,待 YC 確認  依據:00_PROJECT D-04、D-07、D-08

## 0. 一句話

CDC 頁面變了 → 機器改 YAML → 兩道自動閘門 → 低風險自動合併上線、高風險等你在手機上按一下核准 → 外掛下次開面板就用新規則。

## 1. 範圍(v1)

- 自動產生:只針對中央疾管署四組來源(疫苗總覽、COVID-19、流感、肺鏈),及它們連出的接種計畫、Q&A、致醫界通函頁。
- 只監看提醒:縣市衛生局公告(格式未知),差異一律高風險,由 YC 透過 Claude 修改(08)。
- 不做:PDF 附件解析(v2)、執行期讀 Notion、規則以外的任何內容。

## 2. 流程

```
[排程]  GitHub Actions 每日一次
   │
   ├─ 1 監看   抓來源頁 → 轉純文字 → 比對「最後更新」+ 內容雜湊
   │           無變動 → 結束(零成本)
   │
   ├─ 1b 歸檔  純日期運算:effective.to + 寬限 14 天已過 → 連同黃金案例搬進
   │           rules/archive/;開「歸檔 PR」,低風險自動合併(07 §5)
   │
   ├─ 2 解讀   LLM:來源全文 + 現行該疫苗 YAML 區塊 + AUTHORING + schema
   │           → 新 YAML 區塊 + 變更清單(每條附引用句與網址)
   │           → 第二次呼叫扮演審核者,逐條核對引用句;不符即標記
   │
   ├─ 3 閘門一 validate-rules + npm test + 黃金案例;任一失敗 → 擋
   │
   ├─ 4 閘門二 語意差異分級:低 → 自動合併;高 → 開 PR 等 YC 核准
   │
   ├─ 5 發佈   合併到 main → 建置 → dist/rules/*.json + manifest.json + 人讀版
   │           → GitHub Pages
   │
   └─ 6 取用   外掛 background 抓 manifest → 校驗 sha256 → 快取 → 面板重算
```

## 3. 各階段細節

### 3.1 監看
- 監看清單寫在規則檔的 `sources[].watch: true`(schema 改動見 06);狀態(上次雜湊、上次更新日)存 `sources/state.json`,不進 YAML。
- 每次抓到的頁面存 `sources/snapshots/<date>/<sourceId>.md`,進 repo;這是稽核用的「當時看到什麼」。
- 一級爬取:List 頁 → 標題含「計畫」「Q&A」「通函」的連結頁。深度固定,不擴張。
- 待驗:CDC 站對機器抓取的態度(擋不擋、要不要 JS)。第一次跑就知道。

### 3.2 解讀(LLM)
- 輸入:來源純文字、現行 `vaccines.yaml` 中對應疫苗區塊、`rules/AUTHORING.md`、`rules/schema.json`、該疫苗現有黃金案例(讓它知道哪些判定不能動)。
- 輸出:(a)整個疫苗區塊的新 YAML;(b)`changes.json`:每條變更 = 路徑、舊值、新值、引用句、來源網址、快照雜湊。
- 硬規則:只改該疫苗區塊;不得改黃金案例;不得改其他疫苗;無引用句的數值/日期/代碼變更視為「無依據」→ 擋。
- 模板規則:active 沒有該疫苗區塊(例如新一季流感)時,以最近一筆同疫苗、同管轄的 archived 區塊為模板,只改日期與差異處;被取代的舊區塊在同一個 PR 搬進 `rules/archive/`(07 §5)。
- 審核者呼叫:獨立一次,只給 `changes.json` + 來源全文,回答每條「引用句是否支持此變更」;任一「否」→ 整批標高風險。
- 跑在哪:待 YC 決定(Claude API 經 Actions secret,或院內平台)。CDC 內容公開、無病患資料,雲端可接受。
- 中央 + 縣市:縣市頁面 v1 只到 3.1,不進解讀。

### 3.3 閘門一(機械)
- `npm run validate-rules`:schema、引用完整性、空 facts 乾跑。
- `npm test`:現有 46 個單元/情境測試。
- 黃金案例:`tests/golden/<jurisdiction>/<vaccineId>.yaml`,格式見 §4;任一不符 → 擋。每條有 `validUntil`(建置自動填),過期者隨規則區塊一起歸檔(07 §5)。
- 建置合併(06):每個管轄的合併輸出也要過 schema + 該管轄黃金案例。

### 3.4 閘門二(語意差異分級)
比對「建置後 JSON」而非文字差異;每個變更路徑分級:

高風險(開 PR、等核准;任一命中即整批高)
- 疫苗新增/移除;`vaccineId`、`historyMatch` 改動。
- `eligibilityGroups` 新增/移除;`criteria` 內任何改動;`priorityPhase`;`dosingOverride`;`seasonOverride`。
- `dosing.*` 任何改動(series、cases、when、then、間隔)。
- `season.*`(含 `phases[].start`)、群組 `effective.*`、`effectiveFrom`、`effectiveTo`。
- `contraindications` 新增/移除;`severity`、`criteria`、`manual`。
- `codeLists.*.codes`、`.system`。
- `manualConditions` 移除;`askWhen`、`evidence` 改動(evidence 影響預勾與判定,10 §2)。
- 頂層 `jurisdiction`。
- 黃金案例檔:管線永遠不得改。

低風險(自動合併)
- `name`、`label`、`hint`、`notes`、`explain.*`、`then.note`、`sourceRef` 文字。
- `sources[]` 中繼資料(title、date、url、docNo)。
- 註解、鍵順序、`ruleSetVersion`(自動遞增)。
- 過期型歸檔 PR:只把到期區塊搬到 `rules/archive/`、每筆附當初核准的 `to` 日期、由獨立腳本產生(07 §5);`phases[].label` 文字。

未列入的路徑 → 一律高。閘門一失敗 → 一律高。審核者呼叫任一「否」→ 一律高。

### 3.5 核准動線(手機)
- 管線開 PR:標題「[高] 肺鏈:年齡切點 65→60(來源:Q&A 2026-xx-xx)」;內文 = 變更清單 + 引用句 + 黃金案例結果 + 人讀版差異連結。
- 你在 GitHub 手機 app 按 Approve → 分支保護放行 → 自動合併 → 發佈。
- YC 發起的修改(新公告、縣市 overlay、黃金、撤銷)走同一條動線:Claude 開的 PR 標 `origin: assistant`,過同一套閘門(08)。
- 黃金案例若因政策真的變了而失敗:PR 會列出哪幾條、為何;你在同一個 PR 補黃金案例(人改),再核准。管線可附「建議的黃金案例修改」為另一個 commit,但仍要你核。

### 3.6 發佈
- 合併 main → Actions 建置 → 產物:
  - `rules/vaccines.TW.json`、`vaccines.TW-HUA.json`、`vaccines.TW-TTT.json`
  - `rules/manifest.json`:`{ publishedAt, latest: { "TW": {version, file, sha256}, "TW-HUA": {...}, ... }, run: <Actions 網址> }`
  - `docs/rules/<vaccineId>.<jurisdiction>.md|html`:人讀版(取代 Notion 手維護)
- 放 GitHub Pages(固定網域、有 CDN 快取)。網址例:`https://<帳號>.github.io/<repo>/rules/manifest.json`。
- 回滾:main 還原到前一版 → 管線重發;外掛端另有釘住版本(§3.7)。
- 簽章(選配):ECDSA P-256 對 manifest 簽,公鑰內建外掛。主要防護仍是 repo 存取控制與必要審核;簽章多擋「Pages 被改但 secrets 未失」。待 YC 決定。

### 3.7 外掛取用
- `manifest.json` 新增 `host_permissions: https://<帳號>.github.io/*`;只有 background 抓,content script 不直連。
- 節奏:開面板時若快取超過 6 小時 → 抓 manifest;版本較新才下載規則檔;sha256 不符 → 丟棄並記錄。
- 快取:`chrome.storage.local.rules[<jurisdiction>]`(規則不是病患資料;病患資料仍只在 session)。
- 後備順序:快取 → 外掛內建(每次 dist 建置都同時打包當時的規則)。抓不到網路 = 不更新,不報錯給醫師,只在面板底部標「規則版本 x(離線)」。
- 釘住:`chrome.storage.sync.pinRuleSetVersion` 可鎖定版本(緊急用);面板顯示「已釘住」。
- 管轄檔不存在(例如 TW-TTT 尚未寫)→ 退回 `TW`,面板標「僅中央規則」。

## 4. 黃金案例格式

```yaml
# tests/golden/TW/PNEUMO_PCV20_21.yaml
- id: PNEUMO_G01
  why: Rule B 僅 PPV23,間隔滿 1 年 → 今日可打
  asOf: "2026-10-15"
  facts:
    patient: { sex: M, birthDate: "1958-03-02" }
    vaccinations: { status: ok, records: [ { vaccineCode: PPV23, date: "2024-09-01", funding: 公費 } ] }
    sourceStatus: { medication: ok, allergy: ok, lab: ok, lftp: nodata, niis: ok }
  expect:
    verdict: eligible
    caseId: B_PPV_ONLY
    earliestDate: "2026-10-15"
```

- 黃金 = 人工驗證過的判定記憶;只由 YC 發起、Claude 修改的 PR 增修,且一律高風險。管線讀它、不能寫它(過期隨區塊歸檔除外)。
- 第一批:從現有情境測試抽肺鏈 A–E、S1–S3 各一;院內驗證後補真實去識別案例。
- 每個管轄一套;縣市黃金只放縣市群的案例。

## 5. 失敗即關閉清單

- 來源抓不到 → 不動,記錄。
- LLM 輸出非法 YAML / 改到區塊外 → 不開 PR,發通知。
- 變更無引用句 → 高風險。
- 黃金失敗 → 高風險。
- 差異路徑未分類 → 高風險。
- 頁面結構大改(快照差異 > 閾值)→ 高風險,附整頁差異。
- 外掛 sha256 不符 → 沿用快取。

## 6. 影子模式與啟用條件

- 影子模式:管線全跑,但即使低風險也只開 PR、不自動合併。
- 啟用自動合併的條件:已見過 2–3 次真實 CDC 更新,且低風險分級無誤判;由 YC 決定切換。
- 切換是 repo 內一個設定值,不是改程式。

## 7. 跑在哪、多常、成本

- GitHub Actions 排程,每日一次(台北 06:00);無變動時只花抓頁面的時間。
- LLM 只在有變動時呼叫,推估一年幾次;另加第一次跑(流感、COVID-19 草稿)。
- 縣市來源加入監看後同樣頻率。

## 8. 稽核軌跡

- 每次 Result:`ruleSetVersion`、`jurisdiction`、`sourceSnapshotHashes`(來自 manifest)。
- 每個規則版本:對應的 PR、快照、變更清單、核准者、黃金結果,全在 GitHub。
- 人讀版每頁底部列出:規則版本、來源網址與抓取日、最後人核日。

## 9. 需要 YC 決定/提供

- LLM 步驟位置(API 或院內)與模型。
- 是否簽章。
- GitHub repo 名稱與是否公開(規則本身無個資;公開有利他院採用)。
- 通知通道:GitHub 內建(email、手機 app)是否足夠。
- 縣市來源網址(花蓮、台東)。

## 10. 對現有檔案的改動

- `manifest.json`:加 GitHub Pages host;`web_accessible_resources` 保留給內建後備。
- `background.js`:規則抓取、校驗、快取、釘住。
- `content/medcloud.js`:改向 background 要規則;面板底部顯示版本與管轄。
- `rules/schema.json`:`sources[].watch`(其餘見 06)。
- `scripts/`:新增 `watch.mjs`、`interpret.mjs`、`archive.mjs`、`diff-tier.mjs`、`golden.mjs`、`render-docs.mjs`、`eval.mjs`(回溯判定)。
- `.github/workflows/`:`rules-pipeline.yml`(排程)、`publish.yml`(合併觸發);PR 標籤 `origin: pipeline | assistant | manual`。
- `.claude/skills/rules-editor/SKILL.md`:由 08 轉成,給 Claude Code / Cowork 用。
- `02_TESTING.md` §B.3:權限描述改為「向 GitHub Pages 下載規則,不上傳任何資料」。
- `STATUS.md`:決策與下一步(見 00_PROJECT §12)。
