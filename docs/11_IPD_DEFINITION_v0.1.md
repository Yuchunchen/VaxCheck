# IPD 高風險對象:官方定義與 ICD 參考表 v0.1

日期:2026-09-16  狀態:查證結果 + 提案  依據:疾管署網站(2026-09-16 檢索)
附件:`ipd-highrisk.cdc-1140310.json`(由官方 PDF 直接解析,1,847 碼,含來源雜湊)

## 0. 一句話

IPD = 侵襲性肺炎鏈球菌感染症(invasive pneumococcal disease)。疾管署對「19–64 歲 IPD 高風險對象」有明文定義(五類)與一份官方 ICD-10-CM 參考表(26 頁、2025-03-10 製、2025-07-11 更新)。現行 YAML 的 `IPD_HIGHRISK_DX` 是推測,與官方表有實質出入,應整份換掉。

## 1. 官方定義(五類)

疾管署 19–64 歲 IPD 高風險對象 Q&A 與 2025-03-27 致醫界通函第 571 號、2026-01-13 第 596 號一致:
1. 脾臟功能缺損
2. 先天或後天免疫功能不全
3. 人工耳植入
4. 腦脊髓液滲漏
5. 一年內接受免疫抑制劑或放射治療的惡性腫瘤者及器官移植者。「惡性腫瘤者」指一年內曾接受任何治療癌症之藥物(注射式化療藥、口服化療藥、生物製劑、標靶藥物、免疫療法)或放射治療者。

適用方式(Q&A 原文要旨):民眾檢具診斷書等佐證,或經醫師依健保就醫資料或病歷評估後接種。年齡以「接種年 − 出生年」計(現行 YAML 的 `ageByYear` 正確)。

參考表本身註明:僅供醫師評估參考,優先依診斷書或病歷判斷。→ 它是「證據」不是「門檻」,正好對應 10 的 evidence 預勾 + 醫師可改。

## 2. 官方 ICD 表內容(ICD-10-CM 2023 年版)

- 脾臟功能缺損(60 碼):D56 地中海型貧血全系列(含 D56.3 輕型)、D57 鐮刀狀紅血球全系列(含 D57.3 帶因)、D73.0 脾臟機能不足、Q89.0x 先天無脾/脾畸形。
- 先天或後天免疫功能不全(125 碼):B20、B97.35、D46 骨髓分化不良、D60/D61 再生不良性貧血與骨髓衰竭(含 D61.810 化療引起全血球減少)、D70 嗜中性白血球缺乏、D71、D80–D84 免疫缺乏、D89 整章(含 GVHD、細胞激素釋放症候群、肥大細胞活化)。
- 人工耳植入(5 碼):Z45.31、Z45.32x(來院調整/處理植入性聽力裝置)。
- 腦脊髓液滲漏(6 碼):G96.0x。
- 惡性腫瘤(1,635 碼):C00–C96 全部(2023 年版,無 C4A/C7A/C7B)、D00–D09 原位癌、E34.0 類癌症候群、Q85.81/Q85.82、Z85 惡性腫瘤個人史全部、Z86.00x 原位癌個人史。
- 移植(16 碼):Z94 全部(含 Z94.5 皮膚、Z94.6 骨骼、Z94.7 角膜)。

## 3. 與現行 YAML 推測清單的差異

現行 `IPD_HIGHRISK_DX`:D73*、Z90.81、D57*、D80–D84、B20、Z21、G96.0*、Z96.21、Z94*;另 `MALIGNANCY_DX` C00–C96 + `IMMUNOSUPPRESSANTS` L04A*/L01* 一年內。

官方表有、現行沒有:D56 地中海型貧血(花東病人常見,影響大)、Q89.0x、B97.35、D46、D60、D61、D70、D71、D89、Z45.3x、D00–D09、E34.0、Q85.8x、Z85、Z86.00x。
現行有、官方表沒有:Z90.81 後天無脾、Z21 無症狀 HIV、Z96.21 人工耳植入狀態、D73.1/D73.9(表只列 D73.0)。
→ 這三個「表沒有」的碼臨床上明顯符合定義(脾切除後、HIV 帶原、人工耳狀態碼)。官方表不是窮舉;依 10 的設計,表內碼自動預勾,表外由醫師勾——但建議把 Z90.81、Z21、Z96.21 列為「院內擴充證據」,預勾時標「非官方表,依定義推定」。是否採用由 YC 定。

## 4. 建議的證據規則(取代現行 any 寫法)

```yaml
codeLists:
  IPD_SPLEEN_DX:      { system: ICD-10-CM, file: codelists/ipd-highrisk.cdc-1140310.json#spleen }
  IPD_IMMUNE_DX:      { system: ICD-10-CM, file: codelists/ipd-highrisk.cdc-1140310.json#immune }
  IPD_COCHLEAR_DX:    { system: ICD-10-CM, file: codelists/ipd-highrisk.cdc-1140310.json#cochlear }
  IPD_CSF_LEAK_DX:    { system: ICD-10-CM, file: codelists/ipd-highrisk.cdc-1140310.json#csf_leak }
  IPD_MALIGNANCY_DX:  { system: ICD-10-CM, file: codelists/ipd-highrisk.cdc-1140310.json#malignancy }
  IPD_TRANSPLANT_DX:  { system: ICD-10-CM, file: codelists/ipd-highrisk.cdc-1140310.json#transplant }
  IPD_LOCAL_EXTRA_DX: { system: ICD-10-CM, codes: [Z90.81, Z21, Z96.21] }   # 院內擴充,待 YC 決定
  ANTINEOPLASTIC_ATC: { system: ATC, codes: ["L01*"] }                       # L02 荷爾蒙療法是否算,待決

manualConditions:
  - key: ipdHighRisk
    label: IPD 高風險對象
    hint: 疾管署定義五類;參考表僅供評估,優先依診斷書或病歷
    evidence:
      any:
        - diagnosis: { $list: IPD_SPLEEN_DX }
        - diagnosis: { $list: IPD_IMMUNE_DX }
        - diagnosis: { $list: IPD_COCHLEAR_DX }
        - diagnosis: { $list: IPD_CSF_LEAK_DX }
        - all:                                                   # 惡性腫瘤:ICD + 一年內抗癌藥
            - diagnosis: { $list: IPD_MALIGNANCY_DX }
            - medication: { $list: ANTINEOPLASTIC_ATC, withinDays: 365 }
        - diagnosis: { $list: IPD_TRANSPLANT_DX }                # 移植:待決是否加一年內免疫抑制劑
```

schema 小改:`codeList` 允許 `file: <路徑>#<section>`,建置時內嵌;大清單不塞 YAML。

## 5. 資料面的限制(誠實列)

- 惡性腫瘤的「一年內治療」:雲端用藥紀錄能看到抗癌藥(ATC L01);放射治療不在用藥紀錄,雲端其他頁籤是否可見待查。看不到時,ICD 命中 + 無用藥 → 仍 unknown → 問醫師,符合 default-deny。
- 移植者:定義句「一年內…及器官移植者」語意不清;官方表把 Z94 整章列入,含皮膚/骨/角膜移植。建議:Z94.0–Z94.4、Z94.81–Z94.84 直接預勾;Z94.5/6/7 標「請確認」。待 YC 定。
- 荷爾蒙療法(ATC L02):通函列舉未提;「任何治療癌症之藥物」字面涵蓋。待 YC 定。
- 雲端 `icd_code` 無小數點且長度不一(3–7 碼);adapter 對照官方表要先正規化,不能只比前 5 碼。
- ICD-10-CM 2023 年版:健保 2026 起是否換版,換版時官方表也會更新,由管線監看。

## 6. 對管線的影響(05 修正)

- 這份來源是 PDF。05 原本把 PDF 解析放 v2,現在必須提前:此表是肺鏈規則的核心證據,且格式規整(逐行「碼 英文 中文」),可用確定性解析,不需 LLM。解析器就是本次用的那段程式。
- 監看清單加入該頁面與 PDF;PDF 變動 → 重新解析 → 產出新 JSON → 差異分級(碼增減 = 高風險)。
- cdc.gov.tw 的 `/Uploads/` 在 robots.txt 標為 disallow;本次以一般瀏覽器身分下載一次。管線抓取頻率要低(每週一次足夠),並在 09 的資安/合規文件註明資料來源與用途。
- 附帶發現:疾管署 PCV13/PPV23 舊頁面已下架、2025 年的 IPD 專屬公告頁已改導首頁 → 監看要對「頁面消失」也發警示,不能只看內容雜湊。

## 7. 要 YC 決定

1. 院內擴充證據(Z90.81、Z21、Z96.21)是否採用。
2. 移植:Z94 全章預勾,還是排除皮膚/骨/角膜;是否加「一年內免疫抑制劑」。
3. 抗癌藥範圍:只 L01,或加 L02。
4. 是否把這份 JSON 直接當 v0.4.0 的正式代碼清單(建議是;肺鏈規則版本遞增)。

## 8. 來源

- 19–64 歲 IPD 高風險對象接種 Q&A:https://www.cdc.gov.tw/Category/QAPage/dZTLnY71Q5uscglyj2_hSQ
- ICD 參考表頁:https://www.cdc.gov.tw/Category/ListContent/PiUlO1cbz0SD6d4S7ycpcA?uaid=GaDwQQXY5JbTNanLifKKDA(更新 2025-07-11)
- PDF:https://www.cdc.gov.tw/Uploads/fc2391c8-d38a-49dd-a74e-fcf300083dba.pdf,sha256 8f353edb…194e4a
- 致醫界通函第 571 號(2025-03-27):https://www.cdc.gov.tw/Bulletin/Detail/UClT7NkLH3Sr0w7Eo5U7iA?typeid=48
- 致醫界通函第 596 號(2026-01-13):https://www.cdc.gov.tw/Bulletin/Detail/By0KOxI7cSsrybfeeRRdxw?typeid=48
