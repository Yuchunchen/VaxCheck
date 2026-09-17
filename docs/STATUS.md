# 疫苗檢核程式 — 進度(2026-09-17)

> 正本在 Cowork Project「疫苗檢核程式」的 claude/STATUS.md;此檔為 repo 建立時的快照。

## 決策
- 模組間溝通 = FHIR R4 Bundle(TW Core IG profile)→ docs/04_FHIR_CONTRACT_v0.2.md。
- 規則 = YAML 唯一來源,建置時轉 JSON 進外掛 → rules/vaccines.yaml、rules/AUTHORING.md、rules/EXECUTION.md。
- 肺鏈規則:Notion「Canonical Policy」= 人讀的正本;`vaccines.yaml` = 機器正本;兩者以 `sources.SRC_PNEUMO_CANONICAL` + `ruleSetVersion` 互相對照。不採用每日產生 logic artifact 當執行物,也不在執行期讀 Notion。
- NIIS 疫苗代碼:以 CDC API 規格書附錄二為機器正本 → rules/niis-vaccine-codes.json、rules/NIIS_CODES.md。
- 方案 a:規則檔一律寫 canonical 代碼;NIIS 劑別代號 → canonical 由程式載入 niis-vaccine-codes.json 對照。
- 2026-09-16:規則更新全自動 + 自動閘門,高風險差異才人核;外掛執行期從 GitHub 取規則;縣市規則先做花蓮、台東;schema 預留開源給他院;佈署走 Chrome Web Store(unlisted → public);另做獨立 HTML 手動模式。
- 2026-09-17:GitHub repo 建立(private 先起);v0.3.0 原始碼未保存,src/ 待重建。

## 已完成
- 2026-09-17:NIIS 疫苗代碼表(81 碼 + Stool;31 碼註記刪除但保留;38 碼自費標記;canonical 對照);validate-rules 加疫苗代碼白名單;build-rules 產出 dist/rules/。
- v0.3.0(2026-09-15):公費肺炎鏈球菌 PCV20/21 規則正式轉譯;引擎 `ageByYear`、`dosing.mode: cases`、曆法間隔、含公/自費的接種史述詞、待定 case、verdict `not_funded`/`needs_review`。單元 46/46、端對端 13/13(原始碼遺失)。
- 院內探勘 7 位病患(docs/internal/03_FIELD_NOTES);解析器 7/7 真實頁面成功。

## 程式待辦(v0.3.1)
1. 依 docs/01_ARCHITECTURE 重建 src/(engine 先,純函式 + tests)。
2. `parseTable.js`:劑別代號最長前綴比對 → niisCode/canonical/dose;Booster 正規化;Stool 排除;批號類型 → funding。
3. 單元測試:22 種已見劑別代號快照 + 含 `-`/`/` 的碼、無劑次、Booster2 邊界。
4. e2e 重建(Playwright + 偽造 medcloud2 / NIIS 路由)。

## FHIR 待補
- HL7 Validator + TW Core package 驗證;健保醫令/特材 CodeSystem URI 待核;CVX 對照待校對。

## 仍待(門診遇到再補)
- 網頁劑別代號 Booster 寫法與查詢 API 是否一致(病患 5 初步相符,再看 1 位)。
- lftp special_material / medical_service 真實欄位;人工耳植入特材代碼;特材紀錄端點;NIIS 自動讀卡;佈署方式細節。
