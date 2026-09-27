# 判定順序與人工條件 v0.1(default-deny、只問決定性的、病歷有證據就預勾)

日期:2026-09-16  狀態:提案,待 YC 確認  依據:YC 2026-09-16 三點:預設打不成;能判定可打就不再問;病歷找得到的條件先自動勾

## 0. 一句話

先用資料自動判;判得出「可打」就不問任何資格條件;判不出的,只問那幾個「勾了就能翻成可打」的條件;而且這幾個條件若病歷裡有證據,先預勾、標明依據、醫師可取消。

## 1. 三條原則

P1 預設不可(default-deny):unknown 永遠不放行;只有證據為 true 的對象群才給「可打」。這是三值邏輯既有語意,現在寫成產品原則。
P2 不多問:任何一支疫苗只要有一個對象群為 true,該疫苗不再顯示資格類人工條件。
P3 病歷先於醫師:人工條件若能從雲端資料偵測,先預勾;醫師只在資料查不到時才被問。

## 2. 人工條件的新結構:證據(evidence)

`manualConditions` 每項可帶 `evidence`(一棵 criteria 樹,只用自動葉條件):

```yaml
manualConditions:
  - key: ipdHighRisk
    label: IPD 高風險對象
    evidence:
      any:
        - diagnosis: { $list: IPD_HIGHRISK_DX }
        - specialPayment: { category: material, $list: COCHLEAR_IMPLANT_MATERIAL }
        - all:
            - diagnosis: { $list: MALIGNANCY_DX }
            - medication: { $list: IMMUNOSUPPRESSANTS, withinDays: 365 }
  - key: dialysis
    label: 洗腎患者
    evidence:
      any:
        - flag: dialysis
        - diagnosis: { codes: ["Z99.2", "N18.6"] }
  - key: pregnant
    label: 孕婦
    askWhen: { all: [ { sex: F }, { age: { min: { years: 12 }, max: { years: 55 } } } ] }
    evidence: { diagnosis: { codes: ["Z33*", "Z34*", "O0*", "O1*", "O2*", "O3*", "O4*", "O9*"], withinDays: 280 } }   # 示範,代碼待校
  - key: ltcResident
    label: 長照機構/安養機構住民或工作人員
    evidence: { flag: longTermCare }          # 摘要句有長照字樣時預勾;召回率低,仍會問
  - key: indigenous
    label: 具原住民身分
    # 無 evidence:雲端與健保卡都沒有;HIS 接上後補
```

`manual: key` 葉條件的判定順序:醫師已答 → 用醫師的;未答且 evidence 為 true → true(來源標「自動」);其餘 → unknown。
evidence 為 false 不等於條件為 false(沒有 ICD 不代表不是高風險)→ 仍是 unknown、仍會問。這就是 B.1 原則:自動判定一律配人工後備。

規則因此變簡單:對象群直接寫 `manual: ipdHighRisk`,證據只在 `manualConditions` 宣告一次。舊寫法(`any: [diagnosis…, manual: …]`)仍合法,但五個條件改用 evidence 形式。06 的 `residentOf` 本來就是同一模式(資料 → manual 後備 → unknown)。

## 3. 只問決定性的(decisive)條件

每支疫苗自動評估後:
- 有對象群為 true → verdict 可打;不列資格類人工條件(P2)。
- 沒有 true → 找「決定性條件」:某對象群裡,除了未答的人工條件之外,其餘葉條件全部為 true。只有這些人工條件勾了才可能翻成可打,其他一律不問。
  - 25 歲、無慢性病:流感「高風險」群的年齡為 true、慢性病證據 unknown → 問 BMI ≥ 30 與慢性病;「65 歲以上」群年齡 false → 它的條件不問。
  - 68 歲:肺鏈「65 歲以上」true → 不問原住民、IPD 高風險。
- 同一條件被多支疫苗需要 → 只問一次,答案全域共用(session 內)。
- 勾選後即時重算;取消預勾即為 false。

Result 新增 `vaccines[].decisiveManual: [{ key, label, prefilled: true|false, evidence: "D73.0 脾臟疾病 2026-03" }]`;面板只渲染這個清單。

## 3.1 決定性 = 確認後「今天」就能打(v0.4.12)

有保底路徑時(已符合較晚開打的階段、或劑次有較慢的確定 case),未確認條件只在「確認後今天就能打」時才算決定性(docs/07 §3.1 第 3a 步):
- 列入 `decisiveManual` 與 Result 的 `ask`(同一條件多支疫苗只問一次)。
- 卡片放「是/否」;勾「是」重算 → 可接種;勾「否」重算 → 尚未開打或不符合。多項時有「以上皆否」。再按一次同一鈕 = 取消;已排除的條件照舊可「還原」。
- 保底今日可打 → 不問(P2 不變)。

確認後可打日仍在未來(3b、開打前無保底、已完成但滿 5 年才可追加)→ 不列入 `decisiveManual`,只在卡片內放選填提示(可展開勾選)。
無保底、今天開打中(例:25 歲、10/15)→ 沿用 §3,列入決定性條件。

例:55 歲 10/15 → 問第一階段全部未確認條件(7 項);9/28 → 不問,只有選填提示「可提早至 10/1」。70 歲僅 PCV13 3 週前 → 不問 IPD(8 週路徑也要到 +56 天)。

## 4. 面板的兩層語彙

醫師看到的只有兩個結論:
- 可打:對象群、來源徽章、劑次與最早可打日。
- 不可打:一句原因 + 「若有以下條件可打」的勾選清單(只列決定性的;預勾的顯示依據);沒有任何決定性條件 → 只顯示原因,不列清單。

內部 verdict(eligible / ineligible / needs_input / unknown_source / scheduled / …)照舊存在,供稽核與測試;`needs_input` 與 `unknown_source` 在面板上都歸入「不可打」,差別只在下面那一行寫什麼(勾選清單 vs「接種史未查」)。

v0.4.12 起面板分四組:可接種 → 待確認 → 尚未開打 → 不符合,依 `display.bucket`(docs/07 §3.1);卡片保留原狀態標籤,分組與 verdict 不一致時標籤依保底(例:肺鏈 `needs_input` 但保底為已完成 → 「已完成」;開打前無保底的 `not_open` → 「不可打」)。

禁忌症(嚴重過敏、急性發燒)不在資格清單裡:可打時以一行提醒顯示,醫師勾了才把結論改成「不可打:禁忌」。這是我的預設,見 §7。

## 5. 五個條件的證據來源(現況)

- IPD 高風險:用藥紀錄 ICD(IPD_HIGHRISK_DX)、惡性腫瘤 + 一年內免疫抑制劑、lftp 特材(人工耳,代碼待查)。可預勾。
- 洗腎:病人資訊摘要旗標、ICD Z99.2 / N18.6;lftp 醫療服務透析代碼待查。可預勾。
- 孕婦:用藥紀錄 ICD 只涵蓋有開藥的診斷,召回率低;可預勾但多半仍要問。
- 機構住民:摘要旗標 `longTermCare` 不等於住民;可預勾,標「請確認」。
- 原住民:無來源;只在決定性時問;HIS 戶籍註記接上後再補 evidence。

## 6. 對現有檔案的改動

- `rules/schema.json`:`manualCondition.evidence`(criteria,限自動葉條件;驗證器擋 `manual` 巢狀)。
- `engine/conditions.js`:`manual` 葉條件三段解析(醫師 → evidence → unknown)。
- `engine/evaluate.js`:`decisiveManual` 計算;P2 過濾。
- `engine/explain.js`:「不可打」句型 + 決定性清單。
- 面板:兩層語彙;預勾顯示依據與取消鈕;全域共用答案。
- `rules/vaccines.yaml`:五個條件改 evidence 形式;`PNEUMO_IPD_19_64` 的 `any` 收斂為 `manual: ipdHighRisk`。
- `rules/AUTHORING.md`:evidence 寫法;`05` §3.4:`manualConditions[].evidence` 改動列高風險(它影響判定)。
- 黃金案例:每個條件各加「有證據預勾」與「無證據被問」兩例。

## 7. 待決

- 禁忌症的呈現:一行提醒(預設)還是也做成勾選清單。
- 孕婦的 ICD 證據代碼與回溯天數(280)由誰校:管線來源沒有,屬院內臨床判斷,建議 YC 直接定。
- 預勾的證據要不要顯示日期與代碼全文(建議顯示,方便醫師取消時心裡有數)。
