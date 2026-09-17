# YAML 規則如何被執行(v0.3.0)

## 一句話
YAML **不會被翻譯成程式碼**。它是宣告式資料;引擎是一個「解譯器」(interpreter),在執行時走訪規則樹、對照病患事實逐條判定。沒有 `eval`、沒有程式碼產生。

## 流程

```
[撰寫]   rules/vaccines.yaml(人寫,有註解)
            │ npm run validate-rules  ← Ajv 對 schema.json + 引用完整性 + 疫苗代碼白名單
            │ npm run build:rules     ← js-yaml 解析 → JSON.stringify(註解在此丟掉)
[外掛]   dist/rules/vaccines.json + dist/rules/niis-vaccine-codes.json
            │ content script fetch() → JS 物件(規則樹)
[執行]   evaluateBundle(bundle, rules)
            ├─ bundleToFacts(bundle)       FHIR Bundle → facts(引擎內部檢視)
            └─ evaluate(facts, rules)
                 for 每支疫苗:
                   for 每個 eligibilityGroup:
                     evalCondition(criteria, facts) ─┐  遞迴走訪
                   contraindications 同上             │  all/any/not → 三值邏輯
                   → verdict                          │  葉條件 → 各自的小函式
                   → computeNextDose(dosing, 接種史)  │
                   → explain(模板代入)               ─┘
[輸出]   Result JSON → 面板
```

## 引擎怎麼「讀」一個條件

`criteria` 是一棵樹。每個節點只有一個 key,引擎依 key 分派:

| 節點 | 引擎動作 |
|---|---|
| `all: [...]` | 逐一評估子節點;任一 false → false;否則有 unknown → unknown;否則 true |
| `any: [...]` | 任一 true → true;否則有 unknown → unknown;否則 false |
| `not: {...}` | true↔false;unknown 仍是 unknown |
| `age: {min, max}` | 生日 + min ≤ 檢核日 < 生日 + (max+1 單位) |
| `diagnosis: {$list, minRecords, withinDays}` | 展開代碼清單 → 對 facts.diagnoses 逐筆比對(完整/前綴/區間)→ 命中筆數 ≥ minRecords |
| `medication` | 同上,比對 ATC |
| `lab: {item, op, value}` | 取最新一筆該項目 → 比較 |
| `vaccination: {vaccineCodes, minDoses…}` | 接種史未查 → unknown;否則數劑次 |
| `specialPayment / specialMaterial / flag` | 來源不可用 → unknown;否則比對 |
| `manual: key` | 醫師未勾 → unknown;勾了 → true/false |
| `ageByYear: {min, max}` | 檢核年 − 出生年(年次算法),不看月日 |

**unknown 是第三個值,不是 false。** 這是引擎最重要的設計:資料查不到時不會誤判成「不符合」,而是回「資料不足」或「需醫師確認」。

## 走一遍:68 歲男性,接種史尚未查

```
FLU
  FLU_ELDER_65:  age ≥ 65 → 68 ✓ → true
  (其他 group 略;已有 true)
  → matched
  dosing: seasonal, series[dose 1]
  接種史未查 → nextDose = unknown
  → verdict: eligible(解釋用 eligiblePending 模板:「接種史尚未查詢,劑次待 NIIS 確認」)

PCV13
  PCV_ELDER_65:
    all:
      age ≥ 65 → true
      not(vaccination PCV ≥ 1 劑) → 接種史未查 → unknown → not(unknown) = unknown
    → all(true, unknown) = unknown
  PCV_HIGHRISK_19_64:
    age 19–64 → 68 ✗ → false(all 短路,不看後面)
  → 沒有 true;有 unknown,且 unknown 來自資料來源(niis)而非人工條件
  → verdict: unknown_source(黃色「資料不足」,列出缺 接種史)
```

NIIS 查完合併進 Bundle 後重跑同一段:`vaccination` 變成 true/false,PCV13 落到 ineligible(已打過)或 eligible。

## `mode: cases` 的走法(肺鏈)

```
computeByCases(dosing, 接種史):
  接種史未查 → unknown
  for case in cases(由上往下):
    when 不命中 → 下一個
    criteria 存在且 unknown → 記住第一個「待定 case」,繼續往下
    criteria false → 下一個
    then:
      complete   → 若有待定 case:回待定 + alternative=completed;否則 completed
      notFunded  → not_funded
      review     → needs_review
      give       → 算 earliestDate = max(今日, 最近一劑 + 間隔)
                   due(今日可打)→ 直接回
                   wait → 若有待定 case:回待定 + alternative=wait;否則 wait
  沒命中 → 待定 case 或 needs_review(組合未定義)
```

待定機制的用意:例如「IPD 高風險(醫師未勾)且僅打過 PCV13」,8 週路徑未知、但 1 年路徑已經到期 → 直接給「今日可打」,不必等醫師勾選;反之若 1 年路徑還要等,面板顯示「待確認 IPD 高風險;否則 YYYY-MM-DD 可打」。

## 安全與可測性
- 規則是資料,不是程式:規則檔再怎麼寫都不能執行任意程式碼。
- 引擎是純函式:同樣的 Bundle + 規則 → 同樣的結果;單元測試直接餵 facts 跑,不需瀏覽器。
- 規則版本(`ruleSetVersion`)寫進每一次 Result,面板底部顯示,稽核可追。

## 換規則要做什麼
改 YAML → `npm run validate-rules` → `npm run build:rules` → 重新載入外掛。**不改任何 JS。** 若日後走院內伺服器(選項 C),同一個 `evaluate` 搬過去,規則檔由伺服器發佈,外掛不用重裝。

## 什麼時候才需要真的「翻譯」
只有要把規則**輸出成別的標準**時(CDC CDSi XML、FHIR PlanDefinition + CQL)才需要一個轉譯器;那是另一個獨立的匯出工具,不影響執行路徑。
