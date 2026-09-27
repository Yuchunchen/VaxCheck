# 疫苗檢核程式 — 進度(v0.4.4)

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
- **v0.4.4**(2026-09-27):依 115 年度流感計畫全文(115 年 7 月版,YC Dropbox 提供)核對——潛在疾病群取消 19–64 歲限制(計畫第二章肆無年齡限制),改為滿 6 個月以上,補上 15–18 歲非在學者;groupId FLU_UNDERLYING_19_64 → FLU_UNDERLYING。年次算法由計畫第二章參「以接種年減出生年計算」確認。附件1(計畫內附與單獨 PDF)61 項逐項核對一致;附件1 與重大傷病 PDF 與 Dropbox 原檔雜湊相符。單元與情境 39/39。
- **v0.4.3**(2026-09-27):流感「潛在疾病」補病歷證據——附件1 高風險慢性病 ICD(61 項,rules/codelists/flu-highrisk-chronic.cdc-115.json)與健保重大傷病項目 ICD(114-01-01 起 2023 版,232 項,依有效期分長期/一年/六個月/一個月,rules/codelists/catastrophic-illness.nhi-1140101.json;診斷碼推估,以證明為準)。代碼比對支援細碼區間(M05.70-M06.09、F01.A11-F01.C4)。單元與情境 38/38。
- **v0.4.2**(2026-09-27):流感改為 115 年度正式規則(取代示範)。第一階段 10/1 起 11 類對象、第二階段 11/2 起 50–64 歲;年齡 65/55/50–64/19–64 用年次算法,幼兒以足月 6 個月計;潛在疾病合併為一個人工條件(透析/CKD 旗標預勾,附件1 ICD 表待補)。引擎 series 新增 variants:依本季第 1 劑時年齡與季前累計劑數決定未滿 9 歲 2 劑。季末技術邊界 2027-06-30。示範區塊移入 rules/archive/。單元與情境 36/36、端對端 17/17。
- **v0.4.1**(2026-09-27):顯示外掛版號——面板頁尾(讀取中、出錯時也顯示)、浮動鈕滑鼠提示、設定頁標題、示範頁頁尾、Console「[疫苗檢核] 已載入 vX」(健保雲端與 NIIS 兩頁)。e2e 加 2 項檢查,17/17。
- **v0.4.0**:src/ 依 docs/01、05–11 重建。引擎(三值邏輯、ageByYear、cases 待定機制、曆法間隔、時間窗與分階段 scheduled/not_open/out_of_season、人工條件 evidence 預勾、只問決定性條件、縣市 overlay 合併與來源標註)、adapters(健保雲端 5 個 API、NIIS 劑別代號最長前綴)、background、content scripts、面板、設定頁、示範頁。IPD 高風險證據改用疾管署官方 ICD 表(1,847 碼,rules/codelists/)。scripts/validate-rules.mjs 併入 build-rules.mjs --check;CI 改為 ci.yml(驗證 + 測試 + 建置)。單元與情境 32/32、端對端 15/15(真 Chromium + 偽造頁面)。FHIR Bundle 轉換尚未重建(引擎直接吃 facts)。
- 2026-09-17:NIIS 疫苗代碼表(81 碼 + Stool;31 碼註記刪除但保留;38 碼自費標記;canonical 對照);validate-rules 加疫苗代碼白名單;build-rules 產出 dist/rules/。
- v0.3.0(2026-09-15):公費肺炎鏈球菌 PCV20/21 規則正式轉譯;引擎 `ageByYear`、`dosing.mode: cases`、曆法間隔、含公/自費的接種史述詞、待定 case、verdict `not_funded`/`needs_review`。單元 46/46、端對端 13/13(原始碼遺失)。
- 院內探勘 7 位病患(docs/internal/03_FIELD_NOTES);解析器 7/7 真實頁面成功。

## 程式待辦(v0.4.x)
1. 院內實測(docs/TESTING_v0.4.md):NIIS 查詢頁網址、肺鏈判定與臨床一致性、IMUE0190 可讀性。
2. FHIR to/from Bundle(04 契約)重建為匯出與模組邊界。
3. 規則管線(05):監看、PDF 確定性解析、歸檔腳本(07 §5)、黃金案例目錄。
4. 流感已上線(v0.4.2–0.4.4);待補:附件1 英文欄 I5A、P91 是否納入(計畫全文同樣只列於英文欄);罕見疾病清單(國健署 1140123 公告,Dropbox 有 PDF)。COVID-19 正式規則待做(115–116 年度計畫 PDF 在 Dropbox)。
5. docs/11 §7 四項待決定後更新 codeLists。

## FHIR 待補
- HL7 Validator + TW Core package 驗證;健保醫令/特材 CodeSystem URI 待核;CVX 對照待校對。

## 仍待(門診遇到再補)
- 網頁劑別代號 Booster 寫法與查詢 API 是否一致(病患 5 初步相符,再看 1 位)。
- lftp special_material / medical_service 真實欄位;人工耳植入特材代碼;特材紀錄端點;NIIS 自動讀卡;佈署方式細節。
