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
