# 時間窗(time window)設計:生效、分階段、過期移除 v0.1

日期:2026-09-16  狀態:提案,待 YC 確認  依據:YC 需求(過期規則移除;同一疫苗分階段、各階段對象不同;區分 Active regulation 與 archived)
修訂 2026-09-16(同日):§5 由「修剪刪除」改為「歸檔搬移」——YC 的 active/archived 區分比原案好,理由見 §5

## 0. 一句話

規則的每一層都帶「有效期間」;群組可掛「第幾階段」;引擎依檢核日判定「可打 / 尚未開放(X 日起)/ 已結束」;到期或被取代的項目由管線搬進 archive,現行(active)規則集只放現行;archive 供稽核回溯與下一季重建,外掛永遠看不到它。

## 1. 需求

1. 已過期的規則要從現行規則集移除,不能留在裡面靠人記得。
2. 同一支疫苗分階段開打(示範:10/1–10/31 第一階段,11/1 起第二階段),各階段對象不同;前一階段的對象在後續階段仍可打(累加)。
3. 區分 Active regulation 與 archived:移除不等於消失,要能查「當時的規則」。

## 2. 三層時間窗

- 規則集:`effectiveFrom` / `effectiveTo`(既有)。整份檔案的外框。
- 疫苗:`season: { start, end, phases: [ { phase, start, label } ] }`。`phases` 新增;每個階段只需起日,終日 = 季末(累加)。
- 群組:`effective: { from, to }` 新增;或寫 `priorityPhase: N`(既有欄位),建置時展開為 `effective.from = phases[N].start`、`to = season.end`。兩者都不寫 = 沿用規則集外框。

建置後引擎只看群組的 `effective`;`phases`、`priorityPhase` 是寫法糖(sugar),不進引擎。
06 的 `seasonOverride` 併入 `effective`,不再另設。

## 3. 引擎語意

檢核日 `asOf` 對每個群組算狀態:
- `active`:from ≤ asOf ≤ to → 照現有三值邏輯評估。
- `scheduled`:asOf < from → 仍評估條件,但不參與今日資格;條件為 true 或 unknown 的記到 `upcoming[]`,附 `opensOn = from`。
- `expired`:asOf > to → 忽略(理論上已歸檔;還沒歸檔也不會誤放行)。

疫苗結論:
- 先由 `active` 群組依既有規則得出 verdict(eligible / ineligible / needs_input / unknown_source / …)。
- 若非 eligible 且 `upcoming` 有條件為 true 的群組 → verdict 改為 **`scheduled`**,`opensOn` 取最早者;面板寫「符合第二階段對象『50–64 歲成人』,11/1 起可打」。
- 若 `upcoming` 只有 unknown → verdict 維持原值,面板附「11/1 起可能符合第二階段,需確認 ○○」。
- 季末之後所有群組皆 `expired` → verdict `out_of_season`(既有「季後暫不可打」語意,正式命名)。
- 「不能打的原因 / 補什麼能打」照樣列,並註明階段:「第一階段對象不含 50–64 歲;第二階段(11/1 起)含」。

Result 新增:`vaccines[].upcoming: [{ groupId, label, opensOn, value }]`、`vaccines[].window: { from, to }`。
explain 新增鍵:`scheduled`、`out_of_season`。

## 3.1 保底與升級(v0.4.12 起,面板分組;v0.4.26 起五組,新增「已接種」)

同一支疫苗常有「已確定的保底路徑」與「需確認才成立、但較快的路徑」。引擎把兩層合併成一組保底(fallback)/升級(upgrade),寫在 `vaccines[].display`;既有 verdict 語意不變(`scheduled`、`needs_input` 等照舊),只新增欄位。

兩層:
- 對象群層(分階段):保底 = 值為 true 的對象群中最早可打者(已開打 = 今天,未開打 = 開打日)。升級 = 值為 unknown 的對象群中,確認後可打日最早且早於保底者;附需確認的人工條件或缺少的資料來源。候選對象群的劑次以「假設其人工條件已確認」重算(例:假設 IPD 高風險 → 肺鏈 8 週 case 直接成立)。確認後仍已完成/不再公費者不算升級。
- 劑次層(`dosing.mode: cases`):保底 = 第一個確定(criteria 為 true 或無 criteria)且 `when` 命中的 case 結果;升級 = 在它之前遇到、criteria 為 unknown 的第一個 case 確認後的結果(`give` 算 earliestDate 與劑數),只在比保底好時列出。見 `dosing.fallback`、`dosing.upgrade`;既有 `alternative` 不動。
- 最終可打日 = max(對象群開打日, 劑次 earliestDate)。兩層都有升級時取確認後最早者;同日的需確認條件取聯集,各路徑列在 `upgrade.paths`。

分組(依序,第一個成立者為準;today = asOf):
1. absolute 禁忌命中 → 不符合(保留「禁忌」標籤)。
2. 保底今日可打(對象群已開打且劑次 due)→ 可接種;不列升級、不問任何條件。
3. 保底存在但非今日可打(未開打、間隔未滿、已完成、不再公費):
   - a. 升級確認後今日可打 → 待確認;卡片「保底行 + 升級行 + 是/否」。
   - b. 升級確認後可打日較早但仍在未來 → 保底未開打/間隔未滿者歸「尚未開打」,已完成者歸「已接種」、不再公費者歸「不符合」;兩者都附選填提示(「若確認〔…〕可提早至 {日期}」)。
   - c. 無升級 → 未開打/間隔未滿歸「尚未開打」(「{日期} 起可打(第 N 階段 / 與前劑間隔)」);已完成歸「已接種」、不再公費歸「不符合」。
4. 無保底、有升級:確認後今日可打 → 待確認(現行行為);否則(例:開打前、無任何確定對象群)→ 不符合 + 選填提示。
5. 待查接種史、需人工判定、資料不足 → 待確認。
6. 季末已過、全部對象群為 false → 不符合。
7. (v0.4.26)公費期間已過(全部對象群 expired),但仍在 `season.historyEnd` 內,且本季已完成 → 已接種(步驟 3d;verdict `completed`,無保底/升級)。沒有本季紀錄 → 維持 `out_of_season` → 不符合。

**接種史的季(v0.4.26)**:`season.historyEnd`(選填,≥ `end`)。本季接種紀錄的日期窗 = `start` ~ `historyEnd`(未寫則 `end`)。流感:start 10/1、end(公費)隔年 6/30、historyEnd 隔年 9/30。10/1 前的紀錄算上一季;10/1 起接種到 9/30 前都算本季。`end` 不延長,否則 7~9 月未接種者會被判可接種(疫苗已用罄)。NIIS 已查無紀錄 = 未接種;NIIS 未查仍是待查接種史。
7. 表上未涵蓋 → 待確認(不歸入可接種)。

走一遍(115 年度流感,55 歲男,潛在疾病未確認,NIIS 已查、本季未接種)
- 9/28:保底第二階段 11/2;升級第一階段 10/1(未來)→ 尚未開打,選填「若確認下列任一,可提早至 10/1」。
- 10/15:升級今天 → 待確認;「已符合第二階段,11/2 起可打」+「若確認下列任一(7 項)→ 屬第一階段,今天即可打」。7 項 = 第一階段所有未確認的人工條件(潛在疾病、醫事人員、55 歲以上原住民、機構、嬰兒照顧者、托育、禽畜);「以上皆否」→ 尚未開打。
- 11/3:第二階段已開打 → 可接種,不問。

肺鏈(70 歲,僅 PCV13,IPD 未確認):10 週前 → 待確認(8 週路徑今天可打;否則 +1 年);3 週前 → 尚未開打(+1 年;選填「若確認…可提早至 +56 天」);PCV13+PPV23 最後一劑 6 年前 → 待確認(目前視為已完成;若確認 IPD 高風險今天可追加),3 年前 → 不符合(已完成;選填「+5 年起可追加」)。

`display` 欄位:
```
display = {
  bucket: "eligible" | "confirm" | "not_open" | "ineligible",
  step: 1 | 2 | "3a" | "3b" | "3c" | 4 | 5 | 6 | 7,
  fallback: { kind: "phase" | "dose" | "completed" | "not_funded" | null, date, groupId, caseId, label, phase, groupLabel, dose, doseUnknown } | null,
  upgrade:  { kind: "phase" | "dose", date, groupId, caseId, label, phase, dose, requires: [manualKey | sourceKey], manual, sources,
              decisive, paths: [...], items: [{ key, type: "manual" | "source", label, hint }] } | null
}
```
`kind: "phase"` 指對象群層(含無分階段疫苗的對象群,例如肺鏈 19–64 歲 IPD 高風險)。

## 4. schema.json 變更

```json
"window": {
  "type": "object",
  "required": ["from"],
  "additionalProperties": false,
  "properties": { "from": { "$ref": "#/definitions/isoDate" }, "to": { "$ref": "#/definitions/isoDate" } }
},
"season": {
  "type": "object",
  "required": ["start", "end"],
  "additionalProperties": false,
  "properties": {
    "start":  { "$ref": "#/definitions/isoDate" },
    "end":    { "$ref": "#/definitions/isoDate" },
    "phases": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object", "required": ["phase", "start"], "additionalProperties": false,
        "properties": { "phase": { "type": "integer", "minimum": 1 }, "start": { "$ref": "#/definitions/isoDate" }, "label": { "type": "string" } }
      }
    }
  }
}
```
`eligibilityGroup` 新增 `"effective": { "$ref": "#/definitions/window" }`;`priorityPhase` 保留。
驗證器:`priorityPhase` 必須存在於 `season.phases`;`effective` 必須落在 `season` 與規則集外框內;`from ≤ to`;`priorityPhase` 與 `effective` 不可同時寫。

## 5. 歸檔(archive):Active regulation 與 archived 分開

為什麼改採歸檔而不是刪除:(a)季節性規則每年重建,拿上一季的 archived 區塊當模板,比從零產生可靠得多;(b)稽核問「當時的規則是什麼」時,一個帶日期與理由的檔案比 git 提交好交;(c)引擎是純函式,archive + Result 裡的版本號就能重現當時判定。git 仍是原始紀錄,archive 是整理過的索引,不是第二份現行。

現行(active)= `rules/vaccines.yaml` + `rules/overlays/*.yaml`;只有這些會建置進外掛。
歸檔(archived)= `rules/archive/<年>/<vaccineId>.<管轄>.<ruleSetVersion>.yaml`;引擎與外掛永遠看不到。

- 什麼會進 archive:過期(`to` + 寬限 14 天已過)、被新版取代、主動撤銷。三種都是搬移,不是刪除;active 裡任何時候只有現行。
- 每個 archive 檔帶表頭,其後是原封不動的規則區塊(疫苗或群組)與它的黃金案例:
  `archive: { archivedAt, reason: expired | superseded | withdrawn, activeFrom, activeTo, ruleSetVersion, schemaVersion, supersededBy, snapshotHashes }`
- 不可變:archive 只增不改。要「復用」= 以它為模板產生新的 active 區塊(新日期、新版本號)。
- 誰搬:過期 → 歸檔腳本(純日期運算,不經 LLM,低風險 PR,自動合併;影子模式期間仍只開 PR);取代 → 在同一個 LLM 更新 PR 內把舊區塊搬走(整批高風險,人核);撤銷 → YC 透過 Claude 發起的 PR(08)。
- 搬移層級:群組 → 疫苗(所有群組都走了時)→ overlay(所有項目都走了時,檔案留 `vaccines: []`,建置視同無 overlay,該縣市退回中央)。中央規則集不會整份歸檔;整份換版走取代路徑。
- 黃金案例:每條有 `validUntil`(建置時由所測群組的 `effective.to` 自動填);隨規則區塊一起搬進 archive,不刪。這是「管線不得改黃金」的唯一例外,而且只是搬移。
- 季節性重建:下一季 active 沒有該疫苗區塊時,05 的解讀步驟以「最近一筆同疫苗、同管轄的 archived 區塊」為模板,只改日期與差異處;差異仍走高風險人核。
- 回溯判定:`npm run eval -- --ruleset rules/archive/2026/FLU.TW.<版本>.yaml --asOf 2026-10-15 --facts case.json` 重現當時結果;Result 裡的 `ruleSetVersion` 就是索引鍵。
- 紀錄:`CHANGELOG.md` 自動追加「2027-04-14 歸檔 FLU 2026 季(reason: expired,activeTo 2027-03-31)」;人讀版分「現行」「歷年」兩區。
- schema 演進:archive 檔不用現行 schema 驗證,只驗 YAML 可解析與表頭完整;要回溯時用表頭的 `schemaVersion` 對應的引擎版本(git tag)。
- 保存期限:預設永久(檔案很小);是否依院內稽核要求設年限,待 YC 決定。
- 寬限期用意:CDC 常在季末公告延長(例如「至疫苗用罄」);14 天內若頁面更新把 `to` 延後,就不會搬了又搬回來。

## 6. 差異分級補充(接 05 §3.4)

高風險:`season.phases.*`、群組 `effective.*`、`effectiveFrom/To` 的任何改動(供應量導致的階段提前/延後也算;流感一季推估 2–3 次快速核准);取代型歸檔隨所屬更新 PR 一起高風險。
低風險:過期型歸檔 PR(§5);`phases[].label` 文字。

## 7. 流感示範(結構示範,日期為 YC 舉例,非公告)

```yaml
  - vaccineId: FLU
    season:
      start: "2026-10-01"
      end: "2027-03-31"
      phases:
        - { phase: 1, start: "2026-10-01", label: 第一階段 }
        - { phase: 2, start: "2026-11-01", label: 第二階段 }
    eligibilityGroups:
      - groupId: FLU_ELDER_65
        priorityPhase: 1              # 建置展開:effective { from: 2026-10-01, to: 2027-03-31 }
        criteria: { age: { min: { years: 65 } } }
      - groupId: FLU_ADULT_50_64
        priorityPhase: 2              # 建置展開:effective { from: 2026-11-01, to: 2027-03-31 }
        criteria: { age: { min: { years: 50 }, max: { years: 64 } } }
```

縣市 overlay 的群組直接寫 `effective`(開打日與中央不同時):
```yaml
      - groupId: HUA_FLU_EXAMPLE
        effective: { from: "2026-10-15", to: "2026-12-31" }
```

走一遍(58 歲、無慢性病、非原住民)
- 10/15:`FLU_ADULT_50_64` 為 scheduled 且條件 true → verdict `scheduled`,「第二階段對象,11/1 起可打」。
- 11/05:同群組 active → `eligible`。
- 2027-04-20:全部 expired → `out_of_season`;歸檔腳本在 2027-04-14 之後把本季 FLU 區塊搬進 `rules/archive/2027/`;下一季 CDC 公告後,解讀步驟以它為模板重建(季節日期 = 高風險,一年一次人核)。

## 8. 對現有檔案的改動

- `rules/schema.json`:§4。
- `build.mjs`:展開 `priorityPhase` → `effective`;黃金 `validUntil` 自動填。
- `engine/evaluate.js`:群組時間狀態、`upcoming`、`scheduled` / `out_of_season`;`conditions.js` 的 `inSeason` 葉條件保留,語意改為「疫苗 season 內」。
- `engine/explain.js`:兩個新模板鍵;`{missing}` 加階段註記。
- `scripts/archive.mjs`:§5;`rules/archive/` 目錄;`npm run eval` 回溯指令;`05_RULE_PIPELINE` §2 流程圖加「歸檔」一格、§3.2 加模板規則、§3.4 加 §6 兩行。
- `06_JURISDICTION_SCHEMA`:`seasonOverride` → `effective`。
- `rules/AUTHORING.md`:階段寫法、`effective` 寫法、寬限期說明。

## 9. 待決

- 寬限 14 天是否合適(可改成 0,或依疫苗別設定)。
- ~~`scheduled` 是否要出現在「可施打畫面」的主清單,或另列「即將開放」區。~~ v0.4.12 決定:另列「尚未開打」組(§3.1)。
- 歸檔是否也套用到中央規則集的疫苗層(例如某疫苗公費計畫整個結束)→ 提案是套用,但整份規則集不動。
- archive 保存期限:永久,或依院內稽核年限。
