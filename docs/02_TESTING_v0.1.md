# 疫苗檢核程式 — 測試說明 v0.2(2026-09-15;原始碼待重建時以此為驗收標準)

## A. 沙箱測試層(不需院內網路)

| 層 | 指令 | 內容 | v0.3.0 結果 |
|---|---|---|---|
| 規則引擎 + FHIR | `npm test` | 年齡邊界、代碼比對、三值邏輯、adapters、臨床情境、NIIS 解析、FHIR Bundle 往返與合併 | 46/46 |
| 規則檔 | `npm run validate-rules` | schema、引用完整性、疫苗代碼白名單、葉條件單一 key | ✓ |
| 端對端 | `node e2e/run.mjs` | Chromium 載入外掛,本機 HTTPS 代理偽造 medcloud2 與 NIIS(v0.4.9 起;外掛自己開的分頁不經 Playwright 路由),含標題列工作區、換卡、NIIS 代按、空身分;跑「按鍵 → 第一層 → 勾人工條件 → 開 NIIS → 過卡 → 回寫 → 身分不符 → 換卡」 | 33/33(v0.4.9)|

**2026-09-15 院內實地探勘已結案**:JWT UserID 完整 10 碼 ✓;lftp 回傳結構已取得 ✓;NIIS 結果表結構已取得,解析器在 7 位真實病患頁面上全數成功 ✓(細節見 `docs/internal/03_FIELD_NOTES_2026-09-15.md`)。

**仍待院內驗**:特材紀錄(10.1)端點;lftp 的 special_material / medical_service 真實欄位(目前假設同 drugs);NIIS 劑別代號 Booster 寫法再確認一位;ServiSign 讀卡能否被 `#btn_Query.click()` 觸發;院內 Chrome 政策是否允許載入未打包外掛。

## B. 院內安裝(未打包)

1. 解壓 `vaccine-checker-dist.zip` 到固定資料夾(例 `C:\vaccine-checker\dist`)。
2. Chrome → `chrome://extensions` → 右上「開發人員模式」開 → 「載入未封裝項目」→ 選 `dist` 資料夾。
3. 權限只有 `storage` + `medcloud2.nhi.gov.tw` + NIIS 院所版 host,不連任何外部主機。

## C. 院內測試腳本(請照順序,每步記錄結果)

| # | 步驟 | 預期 | 要回報什麼 |
|---|---|---|---|
| 1 | 插卡登入健保雲端,進任一頁 | 右下角出現藍色「疫苗檢核」浮動鈕 | 沒出現 → 開 F12 Console,找 `[疫苗檢核]` 訊息 |
| 2 | 按浮動鈕 | 1–2 秒內出面板;標題列顯示姓名·年齡·性別;來源列 6 個 chip | 年齡是否正確(驗 UserBirthday 轉換);各 chip 狀態 |
| 3 | 看「特殊給付」chip | 無資料 → 「無資料」;有資料 → 「已載入」 | 若出現「結構未知」→ 匯出診斷 JSON 的 `rawLftp`(表示欄位與探勘不同) |
| 4 | 展開任一疫苗「判定依據」 | 每條 group 有 ✓/✗/未確認 與理由 | 有沒有理由讀起來不對 |
| 5 | 按「查接種史(NIIS 需過卡)」 | 開新分頁或切到既有 NIIS 分頁 | 分頁有沒有開 |
| 6 | 在 NIIS 頁照常過卡查詢 | 結果出來後底部出現「疫苗檢核:已擷取 N 筆」toast | toast 文字;若寫「未核對身分證」代表頁上抓不到 `#tb_RocID` |
| 7 | 回健保雲端分頁 | 面板自動更新,「接種史」chip 變「已載入」,劑次欄出現內容 | 若面板底部出現「NIIS 未對應的疫苗名稱:…」→ 把名稱列表記下 |
| 8 | 按「匯出診斷 JSON」 | 下載 `vaccine-checker-diag-*.json`,內含 `bundle`(FHIR R4 Bundle,TW Core profile)與 `result` | 若 chip 出現「結構未知」或「未對應名稱」,保留 `rawLftp` / `niisMeta` |
| 9 | 換一位病患插卡 | 面板自動關閉、浮動鈕計數清空;再按鈕顯示新病患 | 是否殘留上一位的資料 |
| 10 | (選配)F12 在 NIIS 頁 Console 執行 `document.querySelector('#btn_Query').click()` | 若 ServiSign 讀卡流程被觸發 → 可開自動點擊 | 有無跳讀卡/PIN;有錯誤訊息全文 |

自動點擊 NIIS 讀卡鈕預設關閉;若步驟 10 可行,之後在 Console 執行 `chrome.storage.sync.set({autoClickNiis:true})`(在任一外掛頁面)即可開啟。

## D. 匯出檔的個資注意

「匯出診斷 JSON」已排除姓名與身分證,但含診斷碼、用藥、檢驗值與 lftp 原始回傳,仍屬病歷資料。**永不進 repo**(`.gitignore` 已擋 `vaccine-checker-diag-*.json`);要作 fixture 前先去識別(至少刪 `hosp_id`、日期粗化到月)。

## E. 已知限制(這一版故意不做)

- 特材紀錄(10.1)端點未知 → chip 永遠「未實作」,規則裡引用特材的條件會落在「資料不足」。
- lftp 已解析 drugs/medical_service/special_material 三區為 {code,name,date,icd};但 lftp 的藥品沒有 ATC,免疫抑制劑判定仍走用藥頁。
- 病人資訊摘要句自動產生旗標:homeCare / dialysis / ckd / hospice / longTermCare(規則可用 `{ "flag": "homeCare" }`)。
- 流感規則是**示範**,數字不是正式公費規則;肺鏈為正式轉譯。
- 過敏紀錄只顯示,不自動判禁忌。
- 面板沒有自費選項,也不會再做。
