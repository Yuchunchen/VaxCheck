<p align="center"><img src="assets/brand/vaxcheck-lockup-vertical-zh.png" width="420" alt="VaxCheck｜115年 臺灣公費疫苗檢核"></p>

# VaxCheck｜115年 臺灣公費疫苗檢核

門診插健保卡 → 按瀏覽器標題列的 VaxCheck 圖示 → 看這位病患現在能公費打哪些疫苗、為什麼、確認哪些條件就能打。**使用說明(醫師/護理):[docs/使用說明.md](docs/使用說明.md)**。版本與變更見 `CHANGELOG.md`。

系統架構與判定流程圖:[docs/architecture/VaxCheck架構圖.drawio](docs/architecture/VaxCheck架構圖.drawio)(draw.io,四頁;同資料夾有 PNG 預覽)。第 1 頁帶圈號 ①–⑦ 的主要流程為動態虛線,可在 draw.io 開啟或看 [1-整體架構.svg](docs/architecture/1-整體架構.svg)。

- 涵蓋:肺炎鏈球菌 PCV20/21、流感 115 年度、COVID-19 115–116 年度(皆為疾管署正式規則)。
- 面板四組:**可接種 → 待確認 → 尚未開打 → 不符合**。「待確認」只放確認後今天就能打的疫苗;需確認的條件有「是/否」鈕。
- 判定原則:預設不可;資料查不到回「需確認/資料不足」,不會誤判成可打。能自動判可打就不再問;只問勾了會改變結果的條件;病歷有證據的條件先自動勾選並標依據,醫師可取消(docs/10)。
- 規則:`rules/vaccines.yaml` 是唯一來源;IPD 高風險證據用疾管署官方 ICD 參考表(docs/11)。規則怎麼被執行見 `rules/EXECUTION.md`。
- 隱私:病患資料只在瀏覽器記憶體與 `chrome.storage.session`;身分證只做 SHA-256 比對、不保存、不寫進 Console。唯一的外部連線是下載線上規則(不帶任何病患資料)。
- 線上規則:預設從本 repo 的 `rules` 分支下載(每天自動檢查一次;設定頁可「立即更新規則」),發行時才更新。讀不到、雜湊不符、比內建舊、或需要較新版外掛時,自動改用外掛內建規則;面板頁尾「來源」顯示線上/快取/內建。設定頁勾「只用內建規則」可停用。

## 院內安裝(未封裝)

### 一鍵下載(PowerShell)
Windows「開始」→ 輸入 `powershell` → 開「Windows PowerShell」→ 把下面整段貼上(Ctrl+V 或按右鍵)→ 按 Enter。不需要系統管理員權限;Windows PowerShell 5.1(Windows 10/11 內建)即可。

腳本會:
1. 從 GitHub 取**最新 Release** 的外掛 zip(`vaxcheck-ext-<版號>.zip`),與 `SHA256SUMS.txt` 比對。
2. 放到**桌面\vaxcheck**(桌面被 OneDrive 重導也找得到)。資料夾已存在就**保留同一個資料夾、只清空內容再解壓**;zip 內若多一層資料夾會攤平,確認 `桌面\vaxcheck\manifest.json` 存在,否則報錯停止。
3. 把資料夾路徑複製到剪貼簿,用 Chrome 開 `chrome://extensions`。
4. 印出下一步:**首次安裝** → 右上開「開發人員模式」→「載入未封裝項目」→ 貼上路徑 →「選擇資料夾」,再按工具列拼圖圖示把 VaxCheck 釘選;**更新** → 在擴充功能頁按 VaxCheck 的「重新載入」。

**為什麼更新一定要用同一個資料夾**:未封裝外掛的 ID 由資料夾路徑決定。換路徑等於裝一個新外掛,原本的設定(`chrome.storage.sync`:健保雲端入口、NIIS 網址、適用縣市、線上規則等)全部不見。所以腳本更新時不換位置、不改名,只換裡面的檔案。已照舊說明手動裝在其他資料夾(例 `C:\VaxCheck\ext`)的電腦,請繼續手動更新那個資料夾;改用腳本等於新裝一個,要重新設定並移除舊的。

<!-- install.ps1 開始:與 scripts/install.ps1 內容相同(tests/install-script.test.mjs 檢查),改一邊要同步另一邊 -->
```powershell
# VaxCheck 下載安裝/更新(Windows PowerShell 5.1 以上):整段貼進 PowerShell 視窗後按 Enter。
# 取 GitHub 最新 Release 的外掛 zip → 桌面\vaxcheck。更新時資料夾路徑不變、只換內容(路徑決定外掛 ID,換路徑設定會遺失)。
# 不改登錄檔、不改 Chrome 設定;最後一步(載入/重新載入)需在 Chrome 手動按。
& {
  [Net.ServicePointManager]::SecurityProtocol = 'Tls12'
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $repo = 'Yuchunchen/VaxCheck'
  $ua = @{ 'User-Agent' = 'VaxCheck-install' }
  function Fail($why, $hint) {
    Write-Host ''
    Write-Host "失敗:$why" -ForegroundColor Red
    if ($hint) { Write-Host $hint -ForegroundColor Yellow }
  }
  $net = '可能是院內網路擋 github.com:請資訊室開放 api.github.com、github.com、*.githubusercontent.com,或改用可連外的電腦下載 zip(見 README「院內安裝」)。'
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop) { Fail '找不到桌面資料夾。' '請改用 README「院內安裝」手動步驟。'; return }
  $dest = Join-Path $desktop 'vaxcheck'
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('vaxcheck-' + [Guid]::NewGuid().ToString('N'))
  # 公司代理伺服器需要登入時,用目前 Windows 帳號
  try { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch { }
  try {
    Write-Host '1/4 查詢最新版…'
    try {
      $rel = Invoke-RestMethod -UseBasicParsing -TimeoutSec 30 -Headers $ua -Uri "https://api.github.com/repos/$repo/releases/latest"
    } catch {
      $code = 0
      if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
      if ($code -eq 403 -or $code -eq 429) { Fail "GitHub 暫時限制查詢次數(HTTP $code;同一個對外 IP 每小時 60 次)。" "請一小時後再試,或到 https://github.com/$repo/releases 手動下載。" }
      else { Fail "連不到 GitHub(api.github.com):$($_.Exception.Message)" $net }
      return
    }
    $asset = @($rel.assets | Where-Object { $_.name -match '^vaxcheck-ext-.+\.zip$' })[0]
    if (-not $asset) { Fail "最新版 $($rel.tag_name) 沒有外掛 zip(vaxcheck-ext-<版號>.zip)。" "請到 https://github.com/$repo/releases 確認,或回報維護者。"; return }
    $sums = @($rel.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' })[0]
    Write-Host "2/4 下載 $($asset.name)…"
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    $zip = Join-Path $tmp $asset.name
    try {
      Invoke-WebRequest -UseBasicParsing -Headers $ua -Uri $asset.browser_download_url -OutFile $zip
      if ($sums) { Invoke-WebRequest -UseBasicParsing -Headers $ua -Uri $sums.browser_download_url -OutFile (Join-Path $tmp 'SHA256SUMS.txt') }
    } catch { Fail "下載失敗:$($_.Exception.Message)" $net; return }
    if ($sums) {
      $want = ''
      foreach ($line in Get-Content -LiteralPath (Join-Path $tmp 'SHA256SUMS.txt')) {
        if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$' -and $Matches[2].Trim() -eq $asset.name) { $want = $Matches[1].ToLower() }
      }
      $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower()
      if ($want -ne $got) { Fail "檔案校驗不符(SHA256),下載可能不完整或被竄改,未安裝。" '請重新執行;持續發生請回報維護者。'; return }
    } else { Write-Host '(此版沒有 SHA256SUMS.txt,略過校驗)' -ForegroundColor Yellow }
    Write-Host '3/4 解壓縮…'
    $stage = Join-Path $tmp 'unzip'
    try { Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force } catch { Fail "解壓縮失敗:$($_.Exception.Message)" '請重新執行;持續發生請回報維護者。'; return }
    # zip 內若多包一層(或多層)資料夾,往下找到 manifest.json 所在層
    $root = $stage
    for ($i = 0; $i -lt 3 -and -not (Test-Path -LiteralPath (Join-Path $root 'manifest.json')); $i++) {
      $sub = @(Get-ChildItem -LiteralPath $root -Force | Where-Object { $_.Name -ne '__MACOSX' })
      if ($sub.Count -eq 1 -and $sub[0].PSIsContainer) { $root = $sub[0].FullName } else { break }
    }
    $mf = Join-Path $root 'manifest.json'
    if (-not (Test-Path -LiteralPath $mf)) { Fail 'zip 內找不到 manifest.json,不是 VaxCheck 外掛。' '請回報維護者。'; return }
    $ver = (Get-Content -LiteralPath $mf -Raw -Encoding UTF8 | ConvertFrom-Json).version
    Write-Host "4/4 放到 $dest …"
    try {
      if (Test-Path -LiteralPath $dest) {
        $old = @(Get-ChildItem -LiteralPath $dest -Force)
        $oldName = ''
        if (Test-Path -LiteralPath (Join-Path $dest 'manifest.json')) { try { $oldName = (Get-Content -LiteralPath (Join-Path $dest 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).name } catch { } }
        if ($old.Count -gt 0 -and $oldName -notmatch 'VaxCheck') { Fail "$dest 裡已有其他檔案,不是 VaxCheck,為避免誤刪已停止。" '請確認該資料夾內容後自行清空或改名,再重新執行。'; return }
        # 保留資料夾本身(路徑 = 外掛 ID),只清空內容
        $old | Remove-Item -Recurse -Force
      } else {
        New-Item -ItemType Directory -Path $dest | Out-Null
      }
      # 先放 manifest.json:中途失敗時資料夾仍認得出是 VaxCheck,可直接重跑
      Copy-Item -LiteralPath $mf -Destination $dest -Force
      Get-ChildItem -LiteralPath $root -Force | Where-Object { $_.Name -ne 'manifest.json' } | Copy-Item -Destination $dest -Recurse -Force
    } catch {
      $e = $_.Exception
      if ($e -is [UnauthorizedAccessException] -or $e -is [Security.SecurityException]) { Fail "沒有寫入權限:$dest" '可能是桌面被院內政策鎖定或被防毒「受控資料夾存取」阻擋,請資訊室協助。' }
      elseif ($e -is [IO.IOException]) { Fail "無法寫入 ${dest}:$($e.Message)" '請關閉開著該資料夾的檔案總管視窗後重新執行。' }
      else { Fail "無法寫入 ${dest}:$($e.Message)" }
      return
    }
    if (-not (Test-Path -LiteralPath (Join-Path $dest 'manifest.json'))) { Fail "$dest\manifest.json 不存在,安裝未完成。" '請重新執行;持續發生請回報維護者。'; return }
    $clip = ''
    try { Set-Clipboard -Value $dest; $clip = '(路徑已複製到剪貼簿)' } catch { }
    $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    $opened = $false
    if ($chrome) { try { Start-Process -FilePath $chrome -ArgumentList 'chrome://extensions'; $opened = $true } catch { } }
    Write-Host ''
    if (-not $opened) { Write-Host '找不到 Chrome(Program Files、Program Files (x86)、LOCALAPPDATA 都沒有 chrome.exe):請自行開 Chrome,網址列輸入 chrome://extensions。' -ForegroundColor Yellow }
    Write-Host "已下載 VaxCheck v$ver 到 $dest $clip" -ForegroundColor Green
    Write-Host '首次安裝:在 chrome://extensions 右上開「開發人員模式」→ 按「載入未封裝項目」→ 貼上路徑(Ctrl+V)→「選擇資料夾」;再按工具列拼圖圖示把 VaxCheck 釘選。'
    Write-Host '更新:在擴充功能頁找到 VaxCheck,按「重新載入」(圓形箭頭);設定會保留。'
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
```
<!-- install.ps1 結束 -->

| 腳本訊息 | 原因與處理 |
|---|---|
| 連不到 GitHub/下載失敗 | 院內網路擋 github.com。請資訊室開放 `api.github.com`、`github.com`、`*.githubusercontent.com`,或在可連外的電腦下載 zip 後照下方「手動安裝」。 |
| GitHub 暫時限制查詢次數 | 同一個對外 IP 每小時 60 次,多台同時更新可能遇到;一小時後再試。 |
| 檔案校驗不符 | 下載不完整或被竄改,未安裝、舊版不動;重跑,持續發生請回報。 |
| 沒有寫入權限 | 桌面被院內政策鎖定或防毒「受控資料夾存取」阻擋,請資訊室協助。 |
| 裡已有其他檔案,不是 VaxCheck | 桌面已有同名資料夾,腳本不刪;確認內容後自行清空或改名再跑。 |
| 找不到 Chrome | 檔案已放好;自行開 Chrome,網址列輸入 `chrome://extensions`。 |
| 「載入未封裝項目」反灰或不見 | 院內政策停用了開發人員模式,需資訊室派送(見下節)。 |

### 為什麼不能全自動
- Chrome 137 起,官方版 Google Chrome 移除 `--load-extension` 命令列參數,程式無法代為載入未封裝外掛;「開發人員模式」「載入未封裝項目」「重新載入」只能在 Chrome 裡手動按。
- 要全自動(不必按任何鈕、也不用開發人員模式),需資訊室以群組原則 `ExtensionInstallForcelist` 派送:上架 Chrome 線上應用程式商店(可設不公開)後派送商店 ID;或自架 CRX 與更新資訊檔(update manifest),但 Windows 上自架來源只對加入網域的電腦有效。
- 本腳本不改登錄檔、不改 Chrome 設定,也不繞過 Chrome 的任何安全機制。

### 手動安裝
1. 到 GitHub Releases 下載最新版 `vaxcheck-ext-<版號>.zip`(或 Actions → 最新 ci 執行 → vaxcheck-dist → ext)。
2. 解壓到**固定資料夾**,例 `桌面\vaxcheck` 或 `C:\VaxCheck\ext`。資料夾路徑決定外掛 ID;換路徑等於裝一個新外掛,設定會不見。
3. Chrome 開 `chrome://extensions` → 右上開「開發人員模式」→「載入未封裝項目」→ 選該資料夾。按工具列拼圖圖示把 VaxCheck 釘選。
4. 在 VaxCheck 圖示按右鍵 →「選項」:確認「健保雲端入口網址」與「NIIS 查詢頁網址」;其他先維持預設。
5. 插醫事人員卡與健保卡 → 按圖示 → 健保雲端與 NIIS 分頁開啟、面板自動出現。頁尾可看外掛版號與規則版本。

### 更新
- **用腳本**:再貼一次上面那段 → `chrome://extensions` 在 VaxCheck 卡片按「重新載入」(圓形箭頭)→ 開一位病患確認面板頁尾顯示新版號。設定會保留。
- **手動**:下載新版 zip,**解壓覆蓋同一個資料夾**(先刪掉舊檔再解壓亦可,路徑不變即可)→ 按「重新載入」→ 確認頁尾版號。

### 回復上一版
到 Releases 下載上一版 zip,照「更新 → 手動」覆蓋同一資料夾並重新載入(腳本只抓最新版)。

### 回報問題
院區/電腦、外掛版號、步驟、截圖、F12 Console 中 `[疫苗檢核]` 開頭的訊息。需要時按面板「匯出診斷檔」(已排除姓名與身分證,但仍是病歷資料,傳送前請去識別)。院內測試步驟見 `docs/TESTING_v0.4.md`。

## 開發
```
npm ci
npm run validate-rules   # schema + 語意檢查(代碼清單、人工條件、疫苗代碼白名單、縣市 overlay 規範)
npm test                 # 引擎、規則、adapters、面板分組單元與臨床情境測試;install.ps1 與 README 同步(有 pwsh 時另做語法與實跑)
npm run build            # dist/ext(外掛,圖示直接使用 assets/icons/*.png)、dist/vaxcheck-ext-<版號>.zip、dist/web/index.html(示範頁)
node e2e/run.mjs         # 需全域 playwright:真 Chromium 載入外掛,偽造健保雲端與 NIIS;另跑示範頁四組流程
```

## 發行(維護者)
1. `npm version <版號> --no-git-tag-version`;`CHANGELOG.md` 加 `## v<版號>(日期)` 一節;`docs/STATUS.md` 加一行。
2. 本機跑上面四個指令(含 e2e)全過 → commit、推 main,等 ci 綠燈。
3. 觸發 release workflow(二擇一):`git tag v<版號> && git push origin v<版號>`;或 GitHub → Actions → release → Run workflow(分支選 main)。workflow 重跑驗證/測試/建置,建立 tag 與 GitHub Release(外掛 zip、單檔示範頁、SHA256SUMS.txt;說明取自 CHANGELOG 該節)。同版號已發行會失敗,要發新版先升版號。

外掛版本與規則版本分開:改規則也要升外掛 patch 版號,院內才看得出差別。發行時 workflow 會把建置後的規則推到本 repo 的 `rules` 分支(`https://raw.githubusercontent.com/Yuchunchen/VaxCheck/rules/`),已安裝的外掛一天內換新(或在設定頁按「立即更新規則」);repo 須為公開,外掛才讀得到(讀不到就用內建)。`ENGINE_VERSION`(src/engine/evaluate.js)只在引擎本身改動時才升:它寫進規則 manifest 的 `minEngine`,較舊的外掛遇到需要新引擎的規則會自動用內建。

## 品牌與圖示
目前識別以「臺灣輪廓 + 疫苗針劑 + 勾選」為核心；配色採藍、綠、金色調。Chrome 擴充功能圖示一律不放文字；文字只留在大型品牌素材。

標誌原圖放在 `assets/source/`(10 張,依圖形命名,見該資料夾 README 與總覽圖)。以下檔案由 `python3 scripts/make-brand.py` 從原圖產生後提交,建置時不需重跑:

- `assets/brand/vaxcheck-lockup-vertical-zh.png`:README 主圖(標誌 + 字標 + 中文標語)。
- `assets/brand/vaxcheck-lockup-horizontal.png`:橫式(標誌 + 字標)。
- `assets/brand/vaxcheck-mark.png`:純圖形 512 px。
- `assets/icons/icon{16,24,32,48,128}.png`:擴充功能圖示,不含文字。16/24/32 px(工具列)為方形小圖示「藍底 + 白色針筒 + 黃勾」,由腳本繪製;48/128 px(擴充功能清單)用原圖白描邊版。預覽見 `docs/img/toolbar-icon.png`。`scripts/icons.mjs` 建置時直接複製。

## 目錄
```
assets/       source/ 標誌原圖;brand/ 與 icons/ 由 scripts/make-brand.py 產生
rules/        規則 YAML、schema、NIIS 代碼表、官方 ICD 清單(codelists/)
src/engine/   判定引擎(純函式,Node 可測);display.js = 保底/升級與面板分組
src/adapters/ 健保雲端 JSON、NIIS 結果頁 → facts
src/panel/    結果面板(Shadow DOM,外掛與示範頁共用)
src/content/  健保雲端與 NIIS 的 content scripts
src/workspace/ 標題列圖示一鍵工作區(開分頁、換卡、登入備援)
src/background.js  身分核對、NIIS 中繼、人工條件暫存、規則載入
src/options/  設定頁
src/web/      示範頁(手動模式,合成病患)
scripts/      規則建置/驗證、外掛建置、圖示、發行說明、install.ps1(一鍵下載)
tests/  e2e/  fixtures/  docs/
```

