# 管轄(jurisdiction)擴充提案 v0.1

日期:2026-09-16  狀態:提案,待 YC 確認  依據:00_PROJECT D-05、D-08
修訂 2026-09-16(同日):依「縣市自購同一疫苗給不同年齡」案例修訂;YC 確認不需裁決付費、只需在系統註明來源 → 拿掉資金優先序與 `centralEligible`,改為來源標註(§4.1)

## 0. 一句話

一個中央規則集 + 每縣市一個疊加(overlay)檔;建置時合併成「每管轄一份 JSON」;引擎幾乎不動,只多兩樣東西:`residentOf` 葉條件、群組上的 `providedBy`(來源標註)。

## 1. 原則

- 疊加只做加法:縣市可新增對象群、代碼清單、人工條件、來源;不得改中央的年齡、劑次、間隔、季節。要改中央 = 中央的事。
- 失敗即關閉:任何鍵名衝突、任何試圖覆蓋中央的寫法 → 建置失敗。
- 引擎不知道「管轄」這回事:它拿到的仍是一份完整規則集。合併在建置期做,不在執行期。
- 兩個「適用依據」分開處理:醫院所在縣市 → 由工作站設定決定載入哪份 JSON;病患設籍/居住 → `residentOf` 葉條件(先 manual,HIS 接上後自動)。
- 不裁決付費:引擎只回答「符合哪些對象、來源是誰」;註明來源由醫師/護理師在院內或 NIIS 系統完成。
- 開源就緒:一縣一檔、ISO 代碼、CODEOWNERS;內容我不猜,由各縣市維護者填。

## 2. 管轄代碼

用 ISO 3166-2:TW:`TW` = 中央;`TW-HUA` = 花蓮縣;`TW-TTT` = 臺東縣。其餘縣市照 ISO 表加。
顯示名稱表 `rules/jurisdictions.json`:`{ "TW": "中央(疾管署)", "TW-HUA": "花蓮縣", "TW-TTT": "臺東縣" }`。

## 3. 檔案與建置

```
rules/
├── vaccines.yaml              # 中央(jurisdiction.code = TW, level = central)
├── overlays/
│   ├── TW-HUA.yaml            # 花蓮縣(level = county)
│   └── TW-TTT.yaml            # 臺東縣
├── jurisdictions.json
└── schema.json

tests/golden/
├── TW/…                        # 中央黃金案例
├── TW-HUA/…                    # 只放縣市群的案例
└── TW-TTT/…

dist/rules/
├── vaccines.TW.json            # 中央
├── vaccines.TW-HUA.json        # 中央 ⊕ 花蓮
├── vaccines.TW-TTT.json        # 中央 ⊕ 臺東
└── manifest.json
```

建置:對每個 overlay,`merge(central, overlay)` → 合併 JSON → 過 schema → 過 `TW` + 該管轄黃金 → 輸出。中央本身也輸出 `vaccines.TW.json`(沒有 overlay 的院所用)。

## 4. 合併規則

允許(overlay 可寫)
- `vaccines[]` 兩種項目:
  - 擴充:`{ extends: FLU, eligibilityGroups: [...], sourceIds: [...], notes }` → 群組附加到中央 FLU 之後。
  - 新疫苗:完整 `vaccine` 定義(縣市自購、中央沒有的);所有群組 `providedBy` 強制為 county。
- `codeLists`、`manualConditions`、`sources`:與中央取聯集;鍵名/id 衝突 → 失敗。
- 群組層 `effective: { from, to }`(縣市開打日/結束日與中央不同時;定義見 07)、`dosingOverride`(schema 已有)。

禁止(建置失敗)
- overlay 內出現 `dosing`、`season`、`historyMatch`、`contraindications` 於 `extends` 項目(縣市自己的期間寫在群組 `effective`)。
- 群組 `groupId` 未以管轄代碼前綴(例 `HUA_FLU_50_64`)。
- 縣市群組沒有 `sourceIds`(每個縣市群必須有公文或公告依據)。
- 使用 `residentOf` 但 overlay 未宣告對應的 `manualConditions` 後備(見 §6)。
- 中央檔使用 `extends`。

合併後每個縣市群組由建置自動補上:`providedBy: county`、`jurisdiction: <code>`。

### 4.1 同一疫苗、中央與縣市都符合時:只標來源,不裁決

典型情境:縣市自購 PCV20/21 給 50–60 歲(假想),中央另有 55–64 歲原住民、19–64 歲 IPD 高風險。

- 劑次邏輯共用:縣市群走中央同一支疫苗的 `dosing`;疫苗相同,臨床劑次相同。
- 兩邊都符合 → 兩個群組都列,中央在前(只是排序,不是建議);每個群組帶來源:`providedBy` + 管轄名 + 計畫/公告(`sourceIds`)。
- 醫師/護理師依院內或 NIIS 要求註明來源即可;引擎不做「該用哪邊」的裁決。
- 公告若明寫「未符合中央對象者」才適用 → 屬 v2 選配(`centralEligible` 葉條件),現階段不進 schema,面板多列一個群組而已。

## 5. schema.json 變更

頂層新增:
```json
"jurisdiction": {
  "type": "object",
  "required": ["code", "level"],
  "additionalProperties": false,
  "properties": {
    "code":  { "type": "string", "pattern": "^TW(-[A-Z]{3})?$" },
    "level": { "type": "string", "enum": ["central", "county"] },
    "name":  { "type": "string" }
  }
},
"build": {
  "type": "object",
  "description": "建置期寫入,人不填",
  "properties": {
    "basedOn":   { "type": "object", "properties": { "central": { "type": "string" }, "overlay": { "type": "string" } } },
    "builtAt":   { "type": "string" },
    "snapshots": { "type": "object", "additionalProperties": { "type": "string" } }
  }
}
```

`vaccines[]` 項目改為 `oneOf: [vaccine, vaccineExtension]`;新增:
```json
"vaccineExtension": {
  "type": "object",
  "required": ["extends", "eligibilityGroups"],
  "additionalProperties": false,
  "properties": {
    "extends":           { "type": "string", "pattern": "^[A-Z][A-Z0-9_]*$" },
    "eligibilityGroups": { "type": "array", "minItems": 1, "items": { "$ref": "#/definitions/eligibilityGroup" } },
    "sourceIds":         { "type": "array", "items": { "type": "string" } },
    "notes":             { "type": "string" }
  }
}
```
驗證器另加語意檢查:`vaccineExtension` 只允許在 `jurisdiction.level = county` 的檔案。

`eligibilityGroup` 新增:
```json
"providedBy":     { "type": "string", "enum": ["central", "county"], "default": "central", "description": "疫苗來源標註,供面板顯示與系統註明來源;不參與判定" },
"jurisdiction":   { "type": "string" },
"effective":      { "$ref": "#/definitions/window" }
```
`window`、`season`(含 `phases`)的定義見 07 §4。

`condition` 新增葉條件:
```json
{
  "type": "object",
  "required": ["residentOf"],
  "additionalProperties": false,
  "properties": {
    "residentOf": {
      "type": "string",
      "pattern": "^TW-[A-Z]{3}$",
      "description": "病患設籍/居住縣市。facts.patient.residenceJurisdiction 有值 → 比對;無值 → 查 manual resident_<代碼>;都無 → unknown"
    }
  }
}
```

`sourceRef` 新增:
```json
"watch": { "type": "boolean", "default": false },
"kind":  { "type": "string", "enum": ["plan", "qa", "letter", "bulletin", "other"] }
```

## 6. 事實(facts)與 FHIR 對映

facts 新增:
```jsonc
"context": { "hospitalJurisdiction": "TW-HUA" },          // 工作站設定;未設定 = "TW"
"patient": { …, "residenceJurisdiction": null }            // HIS adapter 接上後才有值;null = 未知
```

`residentOf: TW-HUA` 的判定順序:`patient.residenceJurisdiction` → `manual.resident_TW_HUA` → unknown。
overlay 必須宣告後備:
```yaml
manualConditions:
  - key: resident_TW_HUA
    label: 設籍花蓮縣            # 依該縣公告用語:設籍 / 設籍或居住
    hint: 健保卡與雲端無戶籍資料;請依病患自述或掛號地址勾選
```
面板:`residentOf` 落到 unknown 時,顯示這個 manual 勾選項(用現有 needs_input 機制,不加新 UI)。

接種史的來源欄位(NIIS adapter):
- `records[].funding` 維持二值 `公費 | 自費`,供中央 cases 的述詞用;政府來源(中央配送、縣市自購)一律正規化為 `公費`。
- 另存 `records[].source`:NIIS 原始字串(批號類型或來源欄),只顯示、不判定。
- FHIR:`Immunization.fundingSource.text` 放正規化值,原始字串放 `Immunization.note`(04 契約 v0.3 待改)。

FHIR(04 契約 v0.3 待改):
- `context` → `Parameters` 資源 `exec-context`(與現有 `source-status` 同型)。
- `residenceJurisdiction` → `Patient.address`(TW Core 欄位選擇待定,先放 `address.state`,標「待核」)。
- Result 新增 `jurisdiction`、`matchedGroups[].providedBy`、`matchedGroups[].sourceIds`。

## 7. 引擎與面板改動(小)

引擎
- `conditions.js`:新增 `residentOf`(約 15 行)。
- `evaluate.js`:`matchedGroups` 帶出 `providedBy`、`jurisdiction`、`sourceIds`,排序中央在前;群組時間窗依 07 §3。
- `explain.js`:模板新增 `{providedBy}` 變數(中央 / 花蓮縣自購);`ineligible` 的 `{missing}` 也分中央與縣市列出,讓「補什麼條件就能打」同時涵蓋縣市路徑。
- `dosing`、三值邏輯、cases 都不動。

面板
- 標題列:「規則:中央 + 花蓮縣 · v2026.09.15-pneumo1+HUA.1 · 更新 09-20」。
- 每支疫苗:疫苗卡標題列直接標「中央」或「花蓮縣」(取自符合群組的 `providedBy` 聯集;兩邊都符合就兩個徽章並列);展開後每個群組各自標來源與公告字號。
- 不符合時:「補什麼條件就能打」同樣分中央與縣市兩路列出。
- 工作站設定:`chrome.storage.sync.jurisdiction`(`TW-HUA` / `TW-TTT`),未設定 = `TW`;設定入口先用 console(同 `autoClickNiis` 作法),日後加選項頁。

## 8. overlay 示範(只示範結構;內容是佔位,不是花蓮縣政策)

```yaml
# rules/overlays/TW-HUA.yaml
ruleSetVersion: HUA.2026.09.0
effectiveFrom: "2026-10-01"
jurisdiction: { code: TW-HUA, level: county, name: 花蓮縣 }

sources:
  - id: SRC_HUA_FLU_2026
    title: 【待填】花蓮縣衛生局 115 年度流感疫苗擴大接種對象公告
    issuer: 花蓮縣衛生局
    docNo: 【待填】
    url: 【待填】
    watch: true
    kind: bulletin

manualConditions:
  - key: resident_TW_HUA
    label: 設籍花蓮縣
    hint: 依該縣公告用語調整(設籍 / 設籍或居住)

vaccines:
  - extends: FLU
    sourceIds: [SRC_HUA_FLU_2026]
    notes: 【示範結構】縣市擴大對象;年齡與條件以公告為準
    eligibilityGroups:
      - groupId: HUA_FLU_EXPANDED_EXAMPLE
        label: 【待填】公告原文對象名稱
        criteria:
          all:
            - residentOf: TW-HUA
            - age: { min: { years: 50 }, max: { years: 64 } }   # 佔位數字
        effective: { from: "2026-10-01", to: "2027-03-31" }   # 佔位;縣市期間與中央不同時才寫
```

### 8.2 範例二(假想):縣市自購同一疫苗、不同年齡

情境:某市自購 PCV20/21 給 50–60 歲設籍市民(非真實)。

```yaml
# rules/overlays/TW-TPE.yaml(假想)
ruleSetVersion: TPE.2026.09.0
effectiveFrom: "2026-10-01"
jurisdiction: { code: TW-TPE, level: county, name: 臺北市 }

sources:
  - { id: SRC_TPE_PCV_2026, title: 【假想】臺北市自購肺炎鏈球菌疫苗接種計畫, issuer: 臺北市衛生局, watch: true, kind: plan }

manualConditions:
  - key: resident_TW_TPE
    label: 設籍臺北市
    askWhen: { ageByYear: { min: 50, max: 60 } }   # 只在年齡可能符合時才問,減少面板雜訊

vaccines:
  - extends: PNEUMO_PCV20_21            # 同一支疫苗;劑次邏輯沿用中央 cases,不重寫
    sourceIds: [SRC_TPE_PCV_2026]
    eligibilityGroups:
      - groupId: TPE_PNEUMO_50_60
        label: 【公告原文】50–60 歲設籍本市市民
        criteria:
          all:
            - residentOf: TW-TPE
            - ageByYear: { min: 50, max: 60 }
```

走一遍
- 58 歲、非原住民、設籍(勾)、從未接種:中央三群 false → 縣市群 true → 劑次走中央 `A_NAIVE` → 1 劑;面板「符合:臺北市自購(計畫 ○○)」,醫師據此註明來源。
- 58 歲原住民:中央 `PNEUMO_INDIGENOUS_55_64` 與縣市群皆 true → 兩個都列,中央在前;來源由醫師擇一註明。
- 58 歲、原住民未勾、設籍已勾:縣市群 true → 可打;中央原住民群顯示「未確認」,要註明中央來源時再勾。
- 同一人 65 歲再來:NIIS 有一筆 PCV20,來源欄寫縣市自購 → adapter 正規化為 `公費` → 中央 `D_PCV20_21_PUBLIC` → 已完整;原始來源字串照樣顯示。

## 9. 驗證器新增檢查(validate-rules)

- overlay:`level = county`、`code` 與檔名一致、`groupId` 前綴、每個縣市群有 `sourceIds`、`residentOf` 有 manual 後備、無禁止鍵。
- 合併後:過完整 schema;`vaccineId` 唯一;`groupId` 唯一;所有 `$list`、`manual`、`sourceIds` 引用可解析。
- 黃金:`TW` 黃金對每個管轄的合併輸出都要過(縣市加法不得改變中央判定);縣市黃金只對該管轄跑。

## 10. 開源就緒慣例

- 一縣一檔:`rules/overlays/<ISO>.yaml`;`CODEOWNERS` 指定維護者;PR 觸及某 overlay 需該維護者核准。
- 縣市來源 `watch: true` → 管線監看提醒(05 §1);不自動產生。
- 人讀版:`docs/rules/<vaccineId>.<jurisdiction>.md` 自動產生,含中央與縣市群分節。
- 他院採用:設定工作站 `jurisdiction` 即可;沒有 overlay 的縣市自動退回中央。

## 11. 待決/待驗

- 花蓮、台東公告的實際內容與適用依據(設籍 / 居住 / 在地接種)→ 公告由 YC 提供,Claude 依 08 填寫,不猜。
- 縣市規則是否曾出現「限縮」或改劑次的情形 → 若有,v2 再設計受閘門保護的 `overrides`。
- HIS 地址接上後,`residenceJurisdiction` 的欄位對映與 FHIR 表達。
- 中央黃金對合併輸出「不得改變判定」這條,是否有例外 → 若有,屬 v2。
- NIIS 上縣市自購疫苗的來源/批號類型實際字串 → 補進 adapter 對照表(政府來源 → `公費`);院內驗證時看一筆縣市自購紀錄即可。
