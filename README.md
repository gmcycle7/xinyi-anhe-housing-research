# 信義安和站周邊購屋研究（8,000 萬・室內 26 坪）

研究基準日：**2026-09-20**。個人購屋研究筆記，不是購屋或投資建議；本研究沒有聯絡任何房仲，也沒有送出任何表單。

> 公開版說明：應使用者要求，本專案於 2026-09-20 以公開 GitHub repo＋GitHub Pages 發布（含刊登頁截圖，由使用者決定）。`research_raw/`（各平台原始頁面與隔離的 591 資料）與 `qa/*.png` **沒有**上傳，只保留在使用者本機。收藏與筆記存在每位瀏覽者自己的瀏覽器，不會上傳、也不會互相看到。

## 怎麼開

**直接用瀏覽器開啟 `index.html` 即可**（雙擊，或把檔案拖進 Chrome／Safari）。不需要安裝、不需要伺服器、不需要登入。

- 研究內容、篩選、比較、收藏、筆記、截圖全部離線可用；只有地圖底圖需要網路（載入失敗時會自動提示，並有文字版位置清單）。
- 如果你想用本機伺服器：在這個資料夾執行 `python3 -m http.server 8765`，再開 <http://localhost:8765/>。
  注意：`file://` 與 `localhost` 在瀏覽器裡是兩個不同的儲存空間，收藏與筆記不會互通；請固定用一種方式，或用「收藏與筆記」頁的匯出／匯入搬移。
- 純文字版：`research_summary.md`；試算表：`exports/properties.csv`、`exports/comparables.csv`（UTF-8 含 BOM，Excel 可直接開）。

## 網站有什麼

| 分頁 | 內容 |
|---|---|
| 研究總覽 | 研究日期、範圍、預算、兩種面積口徑、候選數與各種「符合／待確認」計數；三個問題的答案；第一輪優先看屋與排序理由；三種行動名單；預算帶與步行帶分析 |
| 房源列表 | 卡片／表格；面積口徑切換（主建物 ≥26／主＋附 ≥26）；可調預算與坪數門檻；總價、坪數、步行、屋齡、房數、電梯、車位、產品類型、確認狀態等篩選 |
| 地圖 | 官方 6 個出入口＋候選物件；概略位置用虛線外框；400／800 公尺為「直線距離圈」 |
| 物件研究頁 | 五個關鍵問題（預算、26 坪組成、步行距離、成交依據、未確認事項）、證據分層、欄位層級來源對照、深度查核紀錄、刊登頁截圖、逐筆成交比較、個人筆記 |
| 並排比較 | 2–4 間並排 |
| 市場與社區 | 開價×主建物、開價×步行時間、同社區成交 vs 在售；社區表、路段成交概況、微區域、都更／危老、預售與新成屋 |
| 收藏與筆記 | 本機儲存、JSON／CSV 匯出、JSON 匯入（合併） |
| 看屋清單 | 每一間要問房仲的問題與現場確認事項，可列印 |
| 方法與來源 | 假設、限制、各平台查閱紀錄、來源清單、更新方式 |

## 資料夾結構

```
index.html                     網站入口
assets/                        app.js（介面）、logic.js（判斷邏輯，網站與測試共用）、charts.js、style.css、vendor/leaflet
data/
  bundle.js                    由下列 JSON 打包而成，讓 index.html 可用 file:// 直接開
  properties.json              候選物件（事實、來源、分析）
  comparables.json             實價登錄比較樣本、路段統計、社區
  sources.json                 來源清單與各平台查閱紀錄
  area.json / newbuild.json / insights.json / station_exits.json
  analysis_overrides.json      深度查核結果（由 tools/apply_verification.py 產生）
  curation.json                研究員最終排序與理由（人工維護）
  manual_merge.json            人工確認的同一戶合併
  id_registry.json             平台:物件編號 → 物件 ID（**不要刪**，確保 ID 穩定）
  screenshots.json             截圖索引
  summary_counts.json          research_summary.md 用的計數（由 build_summary.py 產生）
exports/                       properties.csv、comparables.csv
screenshots/                   自動擷取的原始刊登頁截圖（著作權屬各房仲平台；保留來源與浮水印）
research_raw/                  （只在本機，未上傳）各平台原始頁面、擷取腳本、ACCESS_NOTES；實價登錄 CSV；區域與新建案研究；深度查核結果
                               （太平洋、東森、21世紀、有巢氏都在 research_raw/others/；_merged_stage1.json、geo_cache.json、
                                 _out_of_range.json、_verify_pool.json 是管線的中間產物）
  _quarantine_591_not_used/    591 資料（條款禁止自動擷取 → 未採用，保留待你決定是否刪除）
tools/                         資料管線、測試與截圖工具（test_results.json、test_lvr_results.json 為最近一次測試結果）
qa/                            自動化介面測試的截圖與結果
ASSUMPTIONS.md METHODOLOGY.md RESEARCH_LOG.md QA_REPORT.md research_summary.md
```

## 更新房源（不會破壞收藏與筆記）

```bash
# 1. 重新擷取（各平台資料夾內的腳本），更新 research_raw/<平台>/listings.json
# 2. 重建資料
python3 tools/build_dataset.py        # 合併、去重、步行路由（有快取）
python3 tools/apply_verification.py   # 套用深度查核與人工排序
python3 tools/build_analysis.py       # 成交比對、分級
python3 tools/capture_screenshots.py  # （選用）補截圖；之後再跑一次 build_analysis.py
python3 tools/build_newbuild.py && python3 tools/build_area.py && python3 tools/build_sources.py
python3 tools/build_insights.py && python3 tools/build_summary.py
node tools/build_bundle.js            # 產生 data/bundle.js 與 exports/*.csv
# 3. 測試
node tools/run_tests.js && python3 tools/test_lvr.py && node tools/ui_test.js
```

執行需求：Python 3（需 Pillow，供截圖轉檔）、Node 22 以上（`ui_test.js` 使用內建 WebSocket）、Google Chrome 安裝在 `/Applications/Google Chrome.app`（截圖與介面測試用）。太平洋房屋的資料是以瀏覽器開啟頁面後轉錄，無法以腳本重抓；`research_raw/others/` 的各平台結果需合併成單一 `listings.json`。591 不要用腳本擷取（條款禁止）。

- 收藏、筆記、比較清單與設定存在**瀏覽器 localStorage**（鍵 `xinyiAnhe.userdata.v1`、`xinyiAnhe.settings.v1`），與 `data/` 完全分離；重建資料不會碰到它們。
- 物件 ID 由 `data/id_registry.json` 固定；同一戶下次更新仍是同一個 ID。下架的物件不再出現在列表，但它的筆記會留在「收藏與筆記」頁並標示「已不在目前資料中」。
- 換電腦、換瀏覽器或清除網站資料前，請先在「收藏與筆記」頁匯出 JSON 備份。

## 重要提醒

- 面積、屋齡、登記用途皆為刊登頁揭露，**未以謄本核實**；步行時間為地圖估算（平台座標為概略位置）。
- 「已確認符合」＝刊登頁數字符合條件，不代表房屋品質或仍可售。
- 591 的條款禁止自動化擷取：蒐集階段發現後已停止並隔離其資料（詳見 `RESEARCH_LOG.md`）。是否刪除 `research_raw/_quarantine_591_not_used/` 由你決定。
