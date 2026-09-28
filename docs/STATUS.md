# 疫苗檢核程式 — 進度(v0.4.16)

> 正本在 Cowork Project「疫苗檢核程式」的 claude/STATUS.md;此檔為 repo 建立時的快照。

## 決策
- 模組間溝通 = FHIR R4 Bundle(TW Core IG profile)→ docs/04_FHIR_CONTRACT_v0.2.md。
- 規則 = YAML 唯一來源,建置時轉 JSON 進外掛 → rules/vaccines.yaml、rules/AUTHORING.md、rules/EXECUTION.md。
- 肺鏈規則:Notion「Canonical Policy」= 人讀的正本;`vaccines.yaml` = 機器正本;兩者以 `sources.SRC_PNEUMO_CANONICAL` + `ruleSetVersion` 互相對照。不採用每日產生 logic artifact 當執行物,也不在執行期讀 Notion。
- NIIS 疫苗代碼:以 CDC API 規格書附錄二為機器正本 → rules/niis-vaccine-codes.json、rules/NIIS_CODES.md。
- 方案 a:規則檔一律寫 canonical 代碼;NIIS 劑別代號 → canonical 由程式載入 niis-vaccine-codes.json 對照。
- 2026-09-16:規則更新全自動 + 自動閘門,高風險差異才人核;外掛執行期從 GitHub 取規則;縣市規則先做花蓮、台東;schema 預留開源給他院;佈署走 Chrome Web Store(unlisted → public);另做獨立 HTML 手動模式。
- 2026-09-17:GitHub repo 建立(private 先起);v0.3.0 原始碼未保存,src/ 待重建。
- 2026-09-28:VaxCheck 轉公開;線上規則統一從本 repo rules 分支下載,只在發行時更新;使用說明放 repo(YC;取代同日稍早「另開 VaxCheck-rules」)。
- 2026-09-28:面板四組(可接種/待確認/尚未開打/不符合)與保底/升級判定;待確認只收「確認後今天可打」;第一階段未確認條件全列 + 以上皆否;開打前無保底 → 不符合 + 選填提示;decisiveManual 依 §5 變更,其餘 Result 既有欄位不變(YC,v0.4.12)。
- 2026-09-28:COVID 結核/失能/精神/失智 ICD 轉錄核准;IPD 抗癌藥含 L02;Z94 全章不排除(YC;docs/11 §7 第 2、3 項結案)。COVID 免疫低下證據維持 L01(計畫原文「免疫抑制治療」)。
- 2026-09-28:院內安裝走 PowerShell 一鍵下載(桌面\vaxcheck 固定路徑,更新只換內容)+ Chrome 手動載入/重新載入;Chrome 137 起官方版移除 --load-extension,全自動只能由資訊室以 ExtensionInstallForcelist 派送(商店或自架 CRX,自架限網域電腦)。不改登錄檔、不繞過 Chrome 安全機制(YC,v0.4.16)。
- 2026-09-28:標誌採原創「盾牌 + 勾」(不使用榮民醫院/退輔會徽章);備選 B 疫苗瓶、C 圓印山海留待 YC 替換(v0.4.16)。
- 2026-09-27:罕見疾病改用國健署完整名單(115-07-23)作病歷證據(YC;取代同日稍早「不另建清單」之決定)。通用碼不作證據,見 v0.4.8。

## 已完成
- **v0.4.16**(2026-09-28):(YC)scripts/install.ps1(PowerShell 5.1 相容;GitHub API releases/latest 取 `vaxcheck-ext-*.zip`、SHA256SUMS 校驗、桌面\vaxcheck 保留資料夾只清內容、攤平多一層、防誤刪非 VaxCheck 資料夾、Set-Clipboard、開 chrome://extensions)與 README 貼上區塊;tests/install-script.test.mjs 檢查兩者同步、5.1 語法限制、不動登錄檔,有 pwsh 時解析 + 本機假 API 實跑。標誌 assets/logo.svg(48/128)、assets/logo-small.svg(16/24/32),scripts/icons.mjs 以 @resvg/resvg-js(新 devDependency)產生 PNG,取代 build.mjs 手繪 PNG;manifest icons 加 32、action.default_icon 16/24/32;設定頁標題、示範頁 favicon。截圖 docs/img/toolbar-icon.png、options-page.png、demo-page.png、logo-alternatives.png。v0.4.14–0.4.15 未單獨發行,隨本版發行(線上規則 v0412)。單元與情境 132/132、端對端 56/56。
- **v0.4.15**(2026-09-28):(YC)病歷證據 ICD 最多列 3 碼(conditions.js MAX=3;面板依據 ICD 同)。線上規則每天更新一次:rulesource.js REFRESH_MS=24h、needsRefresh();background 拆 refreshRemote()、chrome.alarms `rules-daily`(1440 分,已存在不重建)+ onStartup;抓不到沿用快取(仍過 rejectRemote)。設定頁規則狀態 + 「立即更新規則」(rules:status / rules:refresh,後者限外掛頁)。權限加 alarms。單元與情境 124/124、端對端 56/56。
- **v0.4.14**(2026-09-28):規則 2026.09.28-v0412。(1)病歷證據列出所有命中 ICD(去重、最近在前、每碼筆數,最多 5 碼),面板逐條顯示;(2)流感可打/尚未開打者顯示 NIIS 接種對象別代碼(工作手冊 115 年 7 月附件14):潛在疾病依命中清單分 F06A 慢性病/F06B 罕病/F06C 重大傷病,醫師手勾則三者擇一;醫事 F07A/B/C、機構 F04A/B、學生 F02A01–03 為擇一;職業別優先(第四章壹五(四)),非職業別間手冊未定序 → 依附件14 表列順序;F03A 附「社區/到宅改 F03B」。schema 新增 vaccine.reportCodes、eligibilityGroup.reportCodes,建置檢查代碼與證據引用。單一代碼時證據文字與 v0.4.10 相同;回歸快照 top 改 v0412、legacyView 排除新欄位 report 與 evidence.hits。單元與情境 122/122、端對端 53/53。
- **v0.4.13**(2026-09-28):repo 轉公開(YC);移除 docs/internal(結構筆記,無個資;仍在 git 歷史)。使用說明 docs/使用說明.md(含示範頁截圖)。線上規則預設開啟,來源 `https://raw.githubusercontent.com/Yuchunchen/VaxCheck/rules/`(release workflow 以 GITHUB_TOKEN 推 rules 分支,只在發行時)。取捨(src/rulesource.js):雜湊不符、manifest `minEngine` 高於本外掛引擎、或版本不同且發布時間早於內建 → 用內建。空白位址視同預設;停用改勾 pinBundled。host_permissions 加 raw.githubusercontent.com。單元與情境 120/120。
- **發行**(2026-09-28):v0.4.12 為院內第一個正式發行版(GitHub Release,未封裝安裝;YC 決定走院內,商店未列出另議)。新增 CHANGELOG.md、.github/workflows/release.yml(推 tag vX.Y.Z 自動發行:zip、單檔示範頁、SHA256SUMS)、scripts/release-notes.mjs;README 改寫(安裝/更新/回復/發行);移除過期的 docs/manifest.draft.json。src 與規則未動。
- **v0.4.12**(2026-09-28):面板四組(可接種 → 待確認 → 尚未開打 → 不符合)+ 保底/升級判定(docs/07 §3.1、docs/10 §3.1)。引擎新增 `vaccines[].display`(bucket、fallback、upgrade)、`dosing.fallback`/`dosing.upgrade`(待定 case 確認後的結果);既有欄位語意不變,v0.4.10 引擎快照 50 情境回歸比對(規則 v0411 重產)。只有「確認後今天可打」(3a)列入 decisiveManual/ask:55 歲 10/1–11/1 問第一階段全部未確認條件(7 項,附「以上皆否」);未來才生效的升級(55 歲 10/1 前、PCV13 未滿 8 週、PCV13+PPV23 未滿 5 年、開打前無保底者)改為卡片內選填提示。YC 決定:開打前無保底 → 不符合 + 選填;禁忌改歸不符合(v0.4.10 歸待確認)。卡片人工條件改「是/否」鈕。示範頁加病患 J(55 歲)、K(PCV13 10 週)。規則檔未改。單元與情境 116/116、端對端 53/53。院內測試 TESTING_v0.4.md N1–N4。
- **v0.4.11**(2026-09-28):規則 2026.09.28-v0411。IPD 惡性腫瘤證據的抗癌藥擴為 L01+L02(乳癌荷爾蒙治療、攝護腺癌去勢治療等可預勾 IPD 高風險);COVID 免疫低下證據另立 COVID_CANCER_TX_ATC 仍為 L01;移植 Z94 全章預勾確定;COVID 其他風險 ICD 移除「待核准」標記。單元與情境 96/96、端對端 43/43。
- **v0.4.10**(2026-09-27):健保雲端自動登入——預設入口改為 `/imu/IMUE1000/?type=icc`(依院內 IMUE1000S01 原始碼,實體健保卡登入);舊預設 `…/IMUE2000` 升級時自動遷移,自訂值不動。既有分頁:無 token 或在登入頁 → 導向入口;已有 token 不導向(走換卡);換卡逾時且找不到換卡連結 → 導向一次。備援:15 秒仍在登入頁 → 代按「實體健保卡」一次,再 30 秒提示「登入未完成」。面板分三組(可接種/待確認/不符合,含筆數,組內維持規則順序;未列 verdict 如 contraindicated 歸待確認),判定依據 ✓→未確認→✗;engine Result 順序不變。單元與情境 94/94、端對端 43/43。院內測試 TESTING_v0.4.md L1–L3。
- **v0.4.9**(2026-09-27):標題列 icon 一鍵工作區——插卡 → 按 icon → 健保雲端(有則切過去並代按「請換卡再按我」,無則開 medcloudEntryUrl)+ NIIS 背景分頁(同病患不動、不同/未查詢導回根網址)→ token 出現後自動開面板(最多等 120 秒)。NIIS 代按讀卡鈕(autoClickNiis,預設關;健保雲端取得本次病患 token 後才按,每次按 icon 最多一次)。**安全修正**:NIIS 讀卡失敗仍送出、`#tb_RocID` 為空的「查無接種紀錄」改為 error/niis_no_identity,不當 0 筆(原可能讓肺鏈誤判從未接種)。設定頁新增健保雲端入口網址、NIIS 查詢頁網址(沿用舊 niisUrl)、autoSwitchCard。浮動鈕保留。無新增權限。e2e 改用本機 HTTPS 代理(外掛自開分頁不經 Playwright 路由)。單元與情境 80/80、端對端 33/33。院內測試見 TESTING_v0.4.md W1–W7。
- **v0.4.8**(2026-09-27):「具潛在疾病」證據加入國健署公告罕見疾病 ICD(115-07-23,249 項、324 碼,rules/codelists/rare-disease.hpa-1150723.json;依分類表轉錄,與字母表交叉比對,後者漏列 E74.04、M61.122、M61.129)。通用碼 9 個(E78.00、E78.01、E16.1、E23.0、E27.49、K83.1、K52.89、D69.8、Q82.8)與組合碼成分 E74.31 不作證據。流感、COVID-19 高風險同受惠。
- **v0.4.7**(2026-09-27):P91 改為全類目納入(YC 決定;v0.4.6 只取 P91.82x 新生兒腦梗塞)。I5A 維持全類目。
- **v0.4.6**(2026-09-27):流感附件1 英文病名欄 I5A(非缺血性心肌損傷)、P91(新生兒腦梗塞,取 P91.82x)依 YC 決定納入,附件1 共 63 項。
- **v0.4.5**(2026-09-27):COVID-19 115–116 年度正式規則(計畫 1150727 全文,YC Dropbox 提供)。第一階段 10/1 起 9 類(免疫低下另立一群以套用再增加 1 劑)、第二階段 11/2 起 50–64 歲;年齡 65/55/50–64 年次算法,從未接種幼兒以足歲未滿 6 歲;劑次:滿 6 個月至 4 歲未曾接種 2 劑間隔 28 天,其餘 1 劑,曾接種者與前劑間隔 84 天(不限本季);65 歲以上、55 歲以上原住民、免疫低下者 180 天後可再增加 1 劑。高風險沿用流感潛在疾病條件(同一題),另加結核病、失能、精神疾病、失智症(covidOtherRisk,ICD 證據為 Claude 轉錄待核);免疫低下證據:HIV、官方 IPD 免疫不全表、移植、洗腎、癌症+一年內抗癌藥、90 天內 L04A 免疫抑制劑。引擎:series 間隔改以前 1 劑計(不限本季)、vaccination 條件加 before、說明樣板加 {doseLabel}。**修正**:流感附件1 三碼類目(E66、G40、I63、J96…)原被當完整碼,漏判 I63.9 等細碼(58 歲腦梗塞誤排 11/2);codeList 新增 threeCharAsCategory。單元與情境 50/50。
- **v0.4.4**(2026-09-27):依 115 年度流感計畫全文(115 年 7 月版,YC Dropbox 提供)核對——潛在疾病群取消 19–64 歲限制(計畫第二章肆無年齡限制),改為滿 6 個月以上,補上 15–18 歲非在學者;groupId FLU_UNDERLYING_19_64 → FLU_UNDERLYING。年次算法由計畫第二章參「以接種年減出生年計算」確認。附件1(計畫內附與單獨 PDF)61 項逐項核對一致;附件1 與重大傷病 PDF 與 Dropbox 原檔雜湊相符。單元與情境 39/39。
- **v0.4.3**(2026-09-27):流感「潛在疾病」補病歷證據——附件1 高風險慢性病 ICD(61 項,rules/codelists/flu-highrisk-chronic.cdc-115.json)與健保重大傷病項目 ICD(114-01-01 起 2023 版,232 項,依有效期分長期/一年/六個月/一個月,rules/codelists/catastrophic-illness.nhi-1140101.json;診斷碼推估,以證明為準)。代碼比對支援細碼區間(M05.70-M06.09、F01.A11-F01.C4)。單元與情境 38/38。
- **v0.4.2**(2026-09-27):流感改為 115 年度正式規則(取代示範)。第一階段 10/1 起 11 類對象、第二階段 11/2 起 50–64 歲;年齡 65/55/50–64/19–64 用年次算法,幼兒以足月 6 個月計;潛在疾病合併為一個人工條件(透析/CKD 旗標預勾,附件1 ICD 表待補)。引擎 series 新增 variants:依本季第 1 劑時年齡與季前累計劑數決定未滿 9 歲 2 劑。季末技術邊界 2027-06-30。示範區塊移入 rules/archive/。單元與情境 36/36、端對端 17/17。
- **v0.4.1**(2026-09-27):顯示外掛版號——面板頁尾(讀取中、出錯時也顯示)、浮動鈕滑鼠提示、設定頁標題、示範頁頁尾、Console「[疫苗檢核] 已載入 vX」(健保雲端與 NIIS 兩頁)。e2e 加 2 項檢查,17/17。
- **v0.4.0**:src/ 依 docs/01、05–11 重建。引擎(三值邏輯、ageByYear、cases 待定機制、曆法間隔、時間窗與分階段 scheduled/not_open/out_of_season、人工條件 evidence 預勾、只問決定性條件、縣市 overlay 合併與來源標註)、adapters(健保雲端 5 個 API、NIIS 劑別代號最長前綴)、background、content scripts、面板、設定頁、示範頁。IPD 高風險證據改用疾管署官方 ICD 表(1,847 碼,rules/codelists/)。scripts/validate-rules.mjs 併入 build-rules.mjs --check;CI 改為 ci.yml(驗證 + 測試 + 建置)。單元與情境 32/32、端對端 15/15(真 Chromium + 偽造頁面)。FHIR Bundle 轉換尚未重建(引擎直接吃 facts)。
- 2026-09-17:NIIS 疫苗代碼表(81 碼 + Stool;31 碼註記刪除但保留;38 碼自費標記;canonical 對照);validate-rules 加疫苗代碼白名單;build-rules 產出 dist/rules/。
- v0.3.0(2026-09-15):公費肺炎鏈球菌 PCV20/21 規則正式轉譯;引擎 `ageByYear`、`dosing.mode: cases`、曆法間隔、含公/自費的接種史述詞、待定 case、verdict `not_funded`/`needs_review`。單元 46/46、端對端 13/13(原始碼遺失)。
- 院內探勘 7 位病患(筆記 docs/internal 已於公開前移除,見 git 歷史);解析器 7/7 真實頁面成功。

## 程式待辦(v0.4.x)
1. 院內實測(docs/TESTING_v0.4.md):W1–W7 工作區流程(健保雲端入口實際路徑、換卡代按副作用、NIIS 是否需 PIN、代按讀卡)、肺鏈判定與臨床一致性、IMUE0190 可讀性。
1b. B 健保卡重大傷病(待院內探勘;不在 v0.4.9 範圍)。
2. FHIR to/from Bundle(04 契約)重建為匯出與模組邊界。
3. 規則管線(05):監看、PDF 確定性解析、歸檔腳本(07 §5)、黃金案例目錄。
4. 流感已上線(v0.4.2–0.4.7)、COVID-19 已上線(v0.4.5)。COVID-19 待補:「視接種情形擴大全國尚未接種者」公告後加群組;免疫低下但無病歷證據者,系統不會主動詢問再增加 1 劑。
5. docs/11 §7 剩第 1 項(院內擴充 Z90.81、Z21、Z96.21)、第 4 項待決定。

## FHIR 待補
- HL7 Validator + TW Core package 驗證;健保醫令/特材 CodeSystem URI 待核;CVX 對照待校對。

## 仍待(門診遇到再補)
- 網頁劑別代號 Booster 寫法與查詢 API 是否一致(病患 5 初步相符,再看 1 位)。
- lftp special_material / medical_service 真實欄位;人工耳植入特材代碼;特材紀錄端點;NIIS 自動讀卡(v0.4.9 已實作代按,待院內 W5 驗證後改預設);佈署方式細節。
