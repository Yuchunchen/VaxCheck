# src/ — 待重建

v0.3.0 的外掛原始碼(engine / adapters / content scripts / panel / tests / e2e)在 2026-09-15 的沙箱中完成並通過測試(單元 46/46、端對端 13/13),但原始碼未保存,僅有 dist。

重建依據:
- `docs/01_ARCHITECTURE_v0.1.md` — 目錄結構、PatientFacts、三值邏輯、Result 格式、跨來源合併
- `docs/04_FHIR_CONTRACT_v0.2.md` — 模組間 FHIR Bundle 契約
- `rules/EXECUTION.md` — 引擎解譯規則的方式(含 `mode: cases` 與待定機制)
- `rules/NIIS_CODES.md` §實作規格 — NIIS 解析器(劑別代號最長前綴比對)
- `docs/02_TESTING_v0.1.md` — 測試層與院內測試腳本
- `docs/internal/03_FIELD_NOTES_2026-09-15.md` — 真實頁面/API 結構

重建順序建議:engine(純函式 + tests)→ rules 載入與 FHIR from/to → NIIS parseTable → NHI adapters → content scripts + panel → e2e。
