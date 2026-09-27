# VaxCheck 疫苗檢核程式 v0.4.0

門診插健保卡 → 健保雲端右下角按「疫苗檢核」→ 看這位病患現在能不能公費打哪些疫苗、為什麼、補什麼條件就能打。

- 判定原則:預設不可;資料查不到回「需確認/資料不足」,不會誤判成可打。能自動判可打就不再問;判不出只問「勾了會改變結果」的條件;病歷有證據的條件先自動勾選並標依據,醫師可取消(docs/10)。
- 規則:`rules/vaccines.yaml` 是唯一來源(肺鏈 PCV20/21、流感 115 年度、COVID-19 115–116 年度皆為正式);IPD 高風險證據用疾管署官方 ICD 參考表(docs/11)。
- 病患資料只在瀏覽器記憶體與 `chrome.storage.session`;身分證只做 SHA-256 比對、不保存;不連任何外部主機(線上規則為選配)。

## 指令
```
npm install
npm run validate-rules   # schema + 語意檢查(代碼清單、人工條件、疫苗代碼白名單、縣市 overlay 規範)
npm test                 # 引擎、規則、adapters 單元與臨床情境測試
npm run build            # dist/ext(外掛)、dist/vaxcheck-ext-<版本>.zip、dist/web/index.html(示範頁)
NPM_GLOBAL=$(npm root -g) node e2e/run.mjs   # 需 playwright:真 Chromium 載入外掛,偽造健保雲端與 NIIS
```

## 院內安裝(未封裝)
1. 解壓 `vaxcheck-ext-0.4.0.zip` 到固定資料夾(例 `C:\VaxCheck\ext`)。
2. Chrome 開 `chrome://extensions` → 開「開發人員模式」→「載入未封裝項目」→ 選該資料夾。
3. 按工具列的 VaxCheck 圖示進設定頁;先維持預設(中央規則、不自動點查詢)。

院內測試步驟見 `docs/TESTING_v0.4.md`。

## 目錄
```
rules/        規則 YAML、schema、NIIS 代碼表、官方 IPD ICD 清單
src/engine/   判定引擎(純函式,Node 可測)
src/adapters/ 健保雲端 JSON、NIIS 結果頁 → facts
src/panel/    結果面板(Shadow DOM,外掛與示範頁共用)
src/content/  medcloud2 與 NIIS 的 content scripts
src/background.js  身分核對、NIIS 中繼、人工條件暫存、規則載入
src/web/      示範頁(手動模式)
tests/  e2e/  fixtures/  docs/
```

`docs/internal/` 為院內探勘筆記(結構,不含個資),轉 public 前移除。
