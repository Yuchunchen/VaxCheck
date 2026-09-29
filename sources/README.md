# sources/ — 官方來源原檔封存

規則(`rules/vaccines.yaml`)與病歷證據清單(`rules/codelists/`)所依據的官方公開文件原檔,加上 `pdftotext -layout` 抽出的文字檔。用途:稽核「當時依據什麼」、規則更新時比對新舊版差異。**不進建置、不進外掛**(`scripts/build.mjs` 只打包 `src/`、`rules/`)。

## 結構
- `manifest.yaml`:每份檔案的 id、疫苗、標題、發布/生效日、sha256、頁數、原始檔名、官方網頁、對應的規則來源 id(`ruleSourceIds`)與 codelist。`tests/sources.test.mjs` 每次 `npm test` 驗證雜湊、文字檔存在、規則來源 id 有效。
- `flu/`、`covid19/`、`pneumo/`:各疫苗的計畫、工作手冊、附件。
- `common/`:跨疫苗共用(例如健保重大傷病 ICD)。
- 檔名 `YYYY-MM_<slug>.pdf`(年月 = 發布月),slug 用英文避免跨平台檔名問題;中文原始檔名記在 manifest 的 `originalName`。

## 規則
1. **PDF 不修改。**新版發布 = 新增檔案(新的 `YYYY-MM_`),舊版保留(被取代不刪,manifest 用 `supersededBy` 標記)。
2. **文字檔只供搜尋與 diff。**它是機器抽出的,表格可能錯位;規則依據以 PDF 為準。
3. **人工下載。**cdc.gov.tw 的 robots.txt 不允許機器抓取 `/File/Get/`、`/Uploads/`,一律由人下載後放入,不寫爬蟲繞過。
4. **只放官方公開文件。**不放病患資料、不放非公開的介接文件(例如疾管署 NIIS 介接 API 規格書,含內部主機資訊,見 docs/STATUS.md)。
5. 版權:政府機關公文、公告與計畫屬著作權法第 9 條不受保護之標的;仍請保留 manifest 的來源網址與發布單位(非法律意見)。

## 新增一份來源(流程)
1. 把 PDF 放進對應資料夾,命名 `YYYY-MM_<slug>.pdf`。
2. `pdftotext -layout x.pdf x.txt`。
3. 在 `manifest.yaml` 加一筆(`sha256sum` 取雜湊);規則有引用就填 `ruleSourceIds`。
4. `npm test`。
