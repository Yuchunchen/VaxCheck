# AI 修改規則的操作規範 v0.1(rules-editor)

日期:2026-09-16  狀態:提案,待 YC 確認  依據:YC 決定「將來不直接修改規則,透過 AI 修改」

## 0. 一句話

YC 不碰 YAML。YC 說要改什麼、依據是什麼;Claude 改、搬 archive、補黃金、跑閘門、開 PR;YC 在手機上按核准。
閘門不分作者:管線 LLM 的 PR、Claude 的 PR、緊急人工 PR,過同一套 validate / test / 黃金 / 差異分級。

## 1. 三種作者,一套閘門

- 管線(origin: pipeline):無人值守,來源是 CDC 頁面變動,05。
- 助理(origin: assistant):有人值守,來源是 YC 給的公告/公文/決定,本文。
- 人工(origin: manual):緊急例外,仍過同一套閘門。

合併只看兩件事:閘門全過、高風險有 YC 核准。誰寫的不重要。

## 2. YC 發起時要給什麼

- 來源:網址、公文字號、PDF、或貼上的原文。沒有來源 → Claude 不改任何數值、日期、代碼,只能開「待補來源」草稿 PR。
- 適用日期(生效、結束、階段)。
- 管轄(中央 / 哪個縣市)。
- 要動哪支疫苗;若是新疫苗,說明是否納入範圍(00 §6)。

## 3. Claude 的固定步驟

1. 讀:`rules/AUTHORING.md`、`rules/schema.json`、現行區塊、同疫苗最近一筆 archive、該疫苗黃金案例、00 §2 護欄。
2. 寫變更清單:每條 = 路徑、舊值、新值、引用句、來源、日期;格式同管線的 `changes.json`。先給 YC 看清單,再動檔案。
3. 改檔:active YAML;被取代區塊搬進 `rules/archive/`(表頭 `reason: superseded`);黃金案例增修並填 `validUntil`;`CHANGELOG.md`;`ruleSetVersion` 遞增。
4. 跑:`npm run validate-rules` → `npm test` → 黃金 → `npm run build` → 差異分級。失敗先修,不硬推。
5. 開 PR:標題「[高|低] 疫苗:一句話(來源日期)」;內文 = 變更清單 + 引用句 + 測試與黃金結果 + 人讀版差異連結;標籤 `origin: assistant`。
6. 回報 YC 一段話:改了什麼、哪幾條是高風險、到 GitHub app 核准。

不做
- 不改 archive 既有檔(只增)。
- 不繞過閘門、不直接推 main。
- 不憑記憶補任何數字、日期、代碼;引用句對不上就停。
- 不一次改多支疫苗,除非同一份公告涵蓋。
- 不擴張到 00 §2 的非目標(自費推薦、儀表板、LLM 解釋)。

## 4. 執行環境

- 要能跑 npm、推 git:Claude Code,或 Cowork 掛 repo。
- claude.ai 對話:可做步驟 1–2(讀、擬變更清單、擬 YAML),落地交 Claude Code。沙箱能跑測試但不能推 repo。
- 秘密與權限:Claude 用 YC 的 git 身分開 PR,不持有合併權;合併靠分支保護 + YC 核准。

## 5. 黃金案例的歸屬

- 黃金 = 人工驗證過的判定記憶。只由 `origin: assistant` 或 `manual` 的 PR 增修,且一律高風險;管線只讀不寫(過期時隨區塊搬 archive 除外)。
- 新增黃金時,`why` 欄寫清楚政策依據與案別(Rule/MCB 編號),讓下一次的 Claude 看得懂。

## 6. 轉為 Skill

本文可直接成為專案 repo 的 `.claude/skills/rules-editor/SKILL.md`(觸發:「改規則」「新公告」「加縣市」「補黃金」),放進 YC 的 skills 慣例。步驟 3 的檢查表就是 Skill 主體;`changes.json` 與 PR 模板放 `references/`。

## 7. 對現有文件的影響

- 00 §7:YC 的角色改為「發起與核准」,不是編輯者;維護門檻不再是 YAML + Git。
- 05 §1、§3.5、§4:縣市差異與黃金改動「人改」一律改讀為「YC 透過 Claude 改」。
- 06 §11、07 §5:同上。
- `rules/AUTHORING.md`:加一段「AI 修改時的必要輸出(變更清單、引用句)」。

## 8. 待決

- 是否允許 Claude 以外的 AI 當作者(ChatGPT 等);閘門不分作者,但 YC 的工作分工慣例是系統契約層只給 Claude。
- 緊急直接改 main 的例外流程(誰、何時、事後補 PR)。
