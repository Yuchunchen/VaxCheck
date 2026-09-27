# 規則撰寫說明(給規則整理 agent 與人)

- **唯一來源:`rules/vaccines.yaml`**。建置時自動轉成 JSON 進外掛;不要直接改 JSON。
- 結構由 `rules/schema.json` 定義(JSON Schema),YAML 只是寫法,鍵名與值完全相同。
- 每支疫苗、每個對象群(eligibilityGroup)旁邊**請寫註解**:公文字號、CDC 原文用語、為什麼這樣設(例:`minRecords: 2` 是為了避免單次誤打 ICD)。註解是給醫師與衛生局看的,不進外掛。
- 日期一律 `"YYYY-MM-DD"` **加引號**(YAML 會把裸日期當日期型別,不同工具行為不一);年齡用 `age: { min/max: { years|months|days } }`,含端點;CDC 公告「民國 xx 年 xx 月 xx 日(含)以前出生」時改用 `birthDate: { onOrBefore: … }`。
- 代碼寫法:完整碼 `E11.9`、前綴 `"E11*"`(類目含所有細碼,例 `"F90*"`)、區間 `E08-E13`(三碼類目)、細碼區間 `M05.70-M06.09`(逐字比對,含端點與上界子碼)。含 `*` 的要加引號。**只寫三碼 `E66` = 只比對 `E66` 本身**;官方表的三碼若指整個類目(如流感附件1),在該 codeList 加 `threeCharAsCategory: true`,IPD 表等逐碼列舉者不可加。
- 在 `{ … }` 一行式寫法裡,值含逗號或冒號時要加引號(例 `label: "發燒,建議延後"`),否則會被切成新欄位。
- 疫苗代碼(`historyMatch.vaccineCodes`、`has`、`none`、`intervalFrom`、`vaccination.vaccineCodes`)**只寫 canonical**(`PCV13`、`PPV23`、`FLU`…),值集合 = `rules/niis-vaccine-codes.json` 的 `canonical` 欄;不寫 NIIS 原碼(`13PCV`、`PPV`)。`validate-rules` 會擋。
- 三個來源查不到的條件(原住民、孕婦、機構住民、醫事人員、BMI…)一律用 `manual: key`,並在 `manualConditions` 宣告。
- 病人資訊摘要句自動旗標:`flag: homeCare | dialysis | ckd | hospice | longTermCare`。
- 特材紀錄端點尚未實作 → 引用 `specialMaterial` 的條件會永遠落在「資料不足」;建議正式版先不引用,或只用 `specialPayment`。
- 驗證:`npm run validate-rules`(讀 YAML)。通過才交付。

## 條件葉節點速查

| 寫法 | 意思 | 資料來源 |
|---|---|---|
| `age: { min: { years: 65 } }` | 年滿 65(以生日精算) | JWT 生日 |
| `ageByYear: { min: 65 }` | 年次算法:接種年 − 出生年(CDC 肺鏈公告用法,當年滿 65 歲即算) | JWT 生日 |
| `birthDate: { onOrBefore: 1961-12-31 }` | 世代切點 | JWT 生日 |
| `sex: F` | 性別 | JWT |
| `diagnosis: { $list: X, minRecords: 2, withinDays: 365 }` | ICD 命中 | 用藥紀錄的 icd_code |
| `medication: { $list: X, withinDays: 180 }` | ATC 命中 | 用藥紀錄 |
| `lab: { item: eGFR, op: "<", value: 30 }` | 最新檢驗值 | 檢驗結果 |
| `specialPayment: { category: drug|service|material, $list: X }` | 特殊給付限制 | IMUE0190 |
| `vaccination: { vaccineCodes: [PCV13], minDoses: 1 }` | 接種史 | NIIS |
| `flag: homeCare` | 摘要旗標 | 病人資訊 |
| `manual: key` | 醫師勾選 | 面板 |
| `inSeason: true` | 在公費期間內 | vaccine.season |
| `all: [...]` / `any: [...]` / `not: {...}` | 組合 | |

## 劑次規則的兩種寫法

### `mode: series`(預設,流感等簡單時程)
```yaml
dosing:
  series:
    - { dose: 1 }
    - { dose: 2, minIntervalDays: 28, requiresPrior: true }
```

### `mode: cases`(肺鏈這種「看接種史組合決定下一步」的規則)
由上往下,第一個 `when` 命中的 case 決定結果;`criteria`(可省略)為該 case 的附加對象條件,未知時延後(見 EXECUTION.md)。

```yaml
dosing:
  mode: cases
  unknownTypeCodes: [PNEUMO_UNKNOWN, PCV]   # NIIS 名稱對不出型別時 → 掛 NEED_HISTORY_CONFIRMATION
  cases:
    - id: B_PPV_ONLY
      label: 僅接種 PPV23
      when:
        all:
          - has: { codes: [PPV23] }          # 可加 funding: 公費|自費、minDoses
          - none: [PCV13, PCV15, PCV20, PCV21]
      then: { action: give, dose: 1, minInterval: { years: 1 }, intervalFrom: [PPV23], note: "……" }
      sourceRef: SRC_PNEUMO_CANONICAL#RuleB
```

- `when` 述詞:`has`(陣列或 `{codes, funding, minDoses}`)、`none`、`all`、`any`、`not`。
- `then.action`:`give`(→ 可打/等待)、`complete`(→ 已完成)、`notFunded`(→ 不再公費)、`review`(→ 醫師評估)。
- 間隔:`minInterval: { years, months, days }` 走曆法(同月同日,閏年 2/29 起算則落到 3/1,取保守的較晚日),`minIntervalDays` 走天數;`intervalFrom` 指定從哪些疫苗的最近一劑起算。
- 沒有任何 case 命中 → 引擎回 `needs_review`(接種史組合未定義),不會靜默放行。
- 接種紀錄沒有日期 → 掛 `NEED_DATE_CONFIRMATION`,並以「今日可打」保守輸出。
