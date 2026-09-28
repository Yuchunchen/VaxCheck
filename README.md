# VaxCheck 疫苗檢核程式

門診插健保卡 → 按瀏覽器標題列的 VaxCheck 圖示 → 看這位病患現在能公費打哪些疫苗、為什麼、確認哪些條件就能打。**使用說明(醫師/護理):[docs/使用說明.md](docs/使用說明.md)**。版本與變更見 `CHANGELOG.md`。

- 涵蓋:肺炎鏈球菌 PCV20/21、流感 115 年度、COVID-19 115–116 年度(皆為疾管署正式規則)。
- 面板四組:**可接種 → 待確認 → 尚未開打 → 不符合**。「待確認」只放確認後今天就能打的疫苗;需確認的條件有「是/否」鈕。
- 判定原則:預設不可;資料查不到回「需確認/資料不足」,不會誤判成可打。能自動判可打就不再問;只問勾了會改變結果的條件;病歷有證據的條件先自動勾選並標依據,醫師可取消(docs/10)。
- 規則:`rules/vaccines.yaml` 是唯一來源;IPD 高風險證據用疾管署官方 ICD 參考表(docs/11)。規則怎麼被執行見 `rules/EXECUTION.md`。
- 隱私:病患資料只在瀏覽器記憶體與 `chrome.storage.session`;身分證只做 SHA-256 比對、不保存、不寫進 Console。唯一的外部連線是下載線上規則(不帶任何病患資料)。
- 線上規則:預設從本 repo 的 `rules` 分支下載(每天自動檢查一次;設定頁可「立即更新規則」),發行時才更新。讀不到、雜湊不符、比內建舊、或需要較新版外掛時,自動改用外掛內建規則;面板頁尾「來源」顯示線上/快取/內建。設定頁勾「只用內建規則」可停用。

## 院內安裝(未封裝)
1. 到 GitHub Releases 下載最新版 `vaxcheck-ext-<版號>.zip`(或 Actions → 最新 ci 執行 → vaxcheck-dist → ext)。
2. 解壓到**固定資料夾**,例 `C:\VaxCheck\ext`。資料夾路徑決定外掛 ID;換路徑等於裝一個新外掛,設定會不見。
3. Chrome 開 `chrome://extensions` → 右上開「開發人員模式」→「載入未封裝項目」→ 選該資料夾。
4. 在 VaxCheck 圖示按右鍵 →「選項」:確認「健保雲端入口網址」與「NIIS 查詢頁網址」;其他先維持預設。
5. 插醫事人員卡與健保卡 → 按圖示 → 健保雲端與 NIIS 分頁開啟、面板自動出現。頁尾可看外掛版號與規則版本。

### 更新
1. 下載新版 zip,**解壓覆蓋同一個資料夾**(先刪掉舊檔再解壓亦可,路徑不變即可)。
2. `chrome://extensions` → VaxCheck 卡片按「重新載入」(圓形箭頭)。
3. 開一位病患確認面板頁尾顯示新版號。設定會保留。

### 回復上一版
到 Releases 下載上一版 zip,照「更新」步驟覆蓋同一資料夾並重新載入。

### 回報問題
院區/電腦、外掛版號、步驟、截圖、F12 Console 中 `[疫苗檢核]` 開頭的訊息。需要時按面板「匯出診斷檔」(已排除姓名與身分證,但仍是病歷資料,傳送前請去識別)。院內測試步驟見 `docs/TESTING_v0.4.md`。

## 開發
```
npm ci
npm run validate-rules   # schema + 語意檢查(代碼清單、人工條件、疫苗代碼白名單、縣市 overlay 規範)
npm test                 # 引擎、規則、adapters、面板分組單元與臨床情境測試
npm run build            # dist/ext(外掛)、dist/vaxcheck-ext-<版號>.zip、dist/web/index.html(示範頁)
node e2e/run.mjs         # 需全域 playwright:真 Chromium 載入外掛,偽造健保雲端與 NIIS;另跑示範頁四組流程
```

## 發行(維護者)
1. `npm version <版號> --no-git-tag-version`;`CHANGELOG.md` 加 `## v<版號>(日期)` 一節;`docs/STATUS.md` 加一行。
2. 本機跑上面四個指令(含 e2e)全過 → commit、推 main,等 ci 綠燈。
3. 觸發 release workflow(二擇一):`git tag v<版號> && git push origin v<版號>`;或 GitHub → Actions → release → Run workflow(分支選 main)。workflow 重跑驗證/測試/建置,建立 tag 與 GitHub Release(外掛 zip、單檔示範頁、SHA256SUMS.txt;說明取自 CHANGELOG 該節)。同版號已發行會失敗,要發新版先升版號。

外掛版本與規則版本分開:改規則也要升外掛 patch 版號,院內才看得出差別。發行時 workflow 會把建置後的規則推到本 repo 的 `rules` 分支(`https://raw.githubusercontent.com/Yuchunchen/VaxCheck/rules/`),已安裝的外掛一天內換新(或在設定頁按「立即更新規則」);repo 須為公開,外掛才讀得到(讀不到就用內建)。`ENGINE_VERSION`(src/engine/evaluate.js)只在引擎本身改動時才升:它寫進規則 manifest 的 `minEngine`,較舊的外掛遇到需要新引擎的規則會自動用內建。

## 目錄
```
rules/        規則 YAML、schema、NIIS 代碼表、官方 ICD 清單(codelists/)
src/engine/   判定引擎(純函式,Node 可測);display.js = 保底/升級與面板分組
src/adapters/ 健保雲端 JSON、NIIS 結果頁 → facts
src/panel/    結果面板(Shadow DOM,外掛與示範頁共用)
src/content/  健保雲端與 NIIS 的 content scripts
src/workspace/ 標題列圖示一鍵工作區(開分頁、換卡、登入備援)
src/background.js  身分核對、NIIS 中繼、人工條件暫存、規則載入
src/options/  設定頁
src/web/      示範頁(手動模式,合成病患)
scripts/      規則建置/驗證、外掛建置、發行說明
tests/  e2e/  fixtures/  docs/
```

