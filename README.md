# VaxCheck — 疫苗檢核程式

門診插健保卡 → 一鍵檢核這位病患**現在能不能公費打哪些疫苗、為什麼**。
資料來源:健保雲端(medcloud2)+ 特殊給付限制(IMUE0190)+ 疾管署 NIIS 院所版接種史。病患資料只留在瀏覽器。

> 狀態(2026-09-17):規則層(`rules/`)與文件為正本;外掛原始碼(`src/`)需依 `docs/01_ARCHITECTURE_v0.1.md` 重建(v0.3.0 原始碼未保存,僅存 dist)。

## 這個 repo 有什麼

| 目錄 | 內容 | 狀態 |
|---|---|---|
| `rules/vaccines.yaml` | 公費疫苗規則**唯一來源**(肺炎鏈球菌 PCV20/21 正式;流感示範) | 正本 |
| `rules/schema.json` | 規則檔 JSON Schema | 正本 |
| `rules/niis-vaccine-codes.json` | NIIS 疫苗代碼表(CDC API 規格書 1.3.7 附錄二;81 碼 → canonical) | 正本 |
| `rules/AUTHORING.md` / `EXECUTION.md` / `NIIS_CODES.md` | 規則怎麼寫、引擎怎麼執行、NIIS 代碼對照 | 正本 |
| `scripts/validate-rules.mjs` | Ajv + 引用完整性 + 疫苗代碼白名單 | 可用 |
| `scripts/build-rules.mjs` | YAML → `dist/rules/vaccines.json` | 可用 |
| `docs/` | 架構、測試、FHIR 契約、進度 | 正本 |
| `docs/internal/` | 院內探勘筆記(結構,不含個資)— **轉 public 前移除** | 內部 |
| `src/` | Chrome extension(MV3)原始碼 | 待重建 |
| `fixtures/` | 去識別測試資料 | 待補 |

## 快速開始

```bash
npm install
npm run validate-rules   # 規則檔驗證,改 YAML 後必跑
npm run build:rules      # 產出 dist/rules/vaccines.json + niis-vaccine-codes.json
```

## 設計要點(細節見 docs/)

- 規則是**資料不是程式**:YAML 宣告式,引擎是純函式解譯器,三值邏輯(true / false / unknown),資料查不到不會誤判成「不符合」。
- 模組間以 **FHIR R4 Bundle(TW Core IG)** 溝通(`docs/04_FHIR_CONTRACT_v0.2.md`)。
- 規則檔只寫 canonical 疫苗代碼(`PCV13`、`PPV23`、`FLU`…);NIIS 劑別代號 → canonical 由 `rules/niis-vaccine-codes.json` 對照(方案 a,`rules/NIIS_CODES.md`)。
- 規則變更走 AI 產出 + 自動閘門 + 人核;`ruleSetVersion` 寫進每次判定結果。
- 外掛權限只有 `storage` + 兩個 host(medcloud2、NIIS 院所版),不連外部主機。

## 轉 public 前的檢查

1. 移除 `docs/internal/`(探勘筆記雖不含個資,但含院內系統細節)。
2. NIIS 院所版 host(全國同一 IP)改由設定檔或文件說明,不硬寫在 README。
3. 確認 `NOTICE` 對 leescot/NHITW_cloud_analyzer_react_MUI(Apache-2.0)的引用與實際複製的檔案一致。
4. `fixtures/` 只放合成或去識別資料。

## 授權

Apache-2.0(見 `LICENSE`)。部分工具函式來自 [leescot/NHITW_cloud_analyzer_react_MUI](https://github.com/leescot/NHITW_cloud_analyzer_react_MUI)(Apache-2.0),見 `NOTICE`。
