#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""產生 data/sources.json（來源清單＋各平台查閱紀錄）。數字取自各平台 ACCESS_NOTES.md 與 agent 回報。"""
import json, os, re
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
D = '2026-09-20'
props = json.load(open(os.path.join(ROOT, 'data', 'properties.json'), encoding='utf-8'))['properties']
used = {}
for p in props:
    for l in p['listings']:
        used[l['platform_name']] = used.get(l['platform_name'], 0) + 1

platform_log = [
 {'platform_name': '信義房屋', 'access_method': 'curl 讀公開列表頁與物件頁（內嵌 __NEXT_DATA__）；robots.txt 允許；約 272 次請求', 'scanned_count': 959, 'kept_count': 171,
  'limitations': '地址只到路段；座標由平台提供（可能偏移）；無完工日與更新日；車位是否必買頁面無欄位；無電梯屬研究推論（類型=公寓）。'},
 {'platform_name': '永慶房屋', 'access_method': 'curl 讀 robots.txt 允許的 /list/ 與 /house/ 頁；未呼叫被禁止的 /api、/ws；約 273 次請求', 'scanned_count': 387, 'kept_count': 110,
  'limitations': '座標只存在於編碼過的頁面狀態字串 → 本研究不使用其座標；無刊登日、完工日、車位是否必買；33 筆登記用途非住家已標記。'},
 {'platform_name': '住商不動產', 'access_method': 'curl 讀列表頁自身呼叫的公開 JSON 與物件頁；robots.txt 允許；約 222 次請求', 'scanned_count': 1419, 'kept_count': 117,
  'limitations': '加盟體系同一物件多店重複建檔（已去重，偶有不同開價）；面積以 1㎡=0.3025 坪換算到小數 2 位；14 筆主建物＝總建坪（加盟店未填拆分）；無車位單價與可否分售。'},
 {'platform_name': '台灣房屋', 'access_method': 'curl 讀 /buy/list 與 /buy/<編號>（不在 robots.txt 禁止範圍）；未抓 /sale/、/api/、/tools/', 'scanned_count': 114, 'kept_count': 9,
  'limitations': '範圍內一般住宅很少（多為店面、辦公）；社區名、管理方式欄位皆空；無車位單價。'},
 {'platform_name': '中信房屋', 'access_method': 'curl 讀列表頁自身呼叫的公開 JSON 與物件頁；robots.txt 全部允許', 'scanned_count': 855, 'kept_count': 71,
  'limitations': '6 筆列表有、詳情為空殼 → 未收錄；座標為平台地址定位（頁面自述僅供參考）；無社區名、完工日、電梯欄位；公寓多只有主建物一項。'},
 {'platform_name': '太平洋房屋', 'access_method': '以內建瀏覽器像一般使用者開啟公開頁面後轉錄（頁面為前端渲染）', 'scanned_count': 76, 'kept_count': 8,
  'limitations': '附屬建物組成未拆分；資料為瀏覽器畫面轉錄而非原始回應。'},
 {'platform_name': '東森房屋', 'access_method': 'curl 讀公開列表與物件頁', 'scanned_count': 112, 'kept_count': 12,
  'limitations': '平台只揭露「主建物＋附屬建物」合計，沒有主建物單獨數字 → 這些刊登單獨存在時 A 口徑為「面積待確認」。'},
 {'platform_name': '21世紀不動產', 'access_method': 'curl 讀公開列表與物件頁', 'scanned_count': 73, 'kept_count': 8, 'limitations': '面積四捨五入到小數 2 位；研究當天 13:20 左右網站一度回資料庫錯誤，13:45 恢復。'},
 {'platform_name': '有巢氏房屋', 'access_method': 'curl 讀公開 /region/ 與 /house/ 頁；未呼叫 robots.txt 禁止的 /api', 'scanned_count': 124, 'kept_count': 22,
  'limitations': '頁面主體偶爾渲染成別的物件，只採用編號相符的資料；座標來自編碼狀態字串 → 本研究不使用。'},
 {'platform_name': '大家房屋', 'access_method': '未抓取', 'scanned_count': None, 'kept_count': 0, 'limitations': '物件列表只能經 robots.txt 禁止的 /ajax/ 取得，無合規方式列舉。'},
 {'platform_name': '591 房屋交易', 'access_method': '蒐集後發現條款禁止 → 停止並隔離，未採用', 'scanned_count': 3418, 'kept_count': 0,
  'limitations': '物件頁頁尾聲明禁止未經授權以爬蟲／自動下載程式擷取（並稱每筆收費 3,000 元）。發現前 agent 已發出約 345 次請求；發現後立即停止，591 資料完全未進入本網站與分析，原始檔隔離於 research_raw/_quarantine_591_not_used/。591 常有巷弄門牌與屋主自售物件，缺少它是本研究的覆蓋缺口，請用一般瀏覽器人工補看。'},
 {'platform_name': '樂屋網、樂居', 'access_method': '未抓取', 'scanned_count': None, 'kept_count': 0, 'limitations': '對一般請求回 HTTP 403，未嘗試繞過。'},
]
for r in platform_log:
    r['listings_in_final_dataset'] = used.get(r['platform_name'], 0)

sources = [
 {'title': '台北捷運官方車站資訊：信義安和站（SID=101）', 'url': 'https://web.metro.taipei/pages/tw/station/101', 'type': '官方', 'used_for': '6 個出入口的編號、位置描述、座標、電梯', 'accessed': D},
 {'title': '內政部不動產成交案件實際資訊資料供應系統（開放資料下載）', 'url': 'https://plvr.land.moi.gov.tw/DownloadOpenData', 'type': '官方', 'used_for': '臺北市買賣成交 113Q3–115Q2 與 115/9/11 期；預售屋成交 113Q3–115Q2 與當期（新建案分析）', 'accessed': D},
 {'title': 'OpenStreetMap 步行路由（FOSSGIS routing.openstreetmap.de，foot profile）', 'url': 'https://routing.openstreetmap.de/', 'type': '開放圖資', 'used_for': '物件座標到各出入口的步行路徑距離（批次查詢）', 'accessed': D},
 {'title': 'OpenStreetMap Nominatim', 'url': 'https://nominatim.openstreetmap.org/', 'type': '開放圖資', 'used_for': '無座標物件的「路段代表點」粗估（不列入判斷）', 'accessed': D},
 {'title': '信義房屋 買屋', 'url': 'https://www.sinyi.com.tw/buy/list/Taipei-city/106-110-zip/default-desc/index', 'type': '房仲刊登', 'used_for': '刊登開價、面積拆分、物件描述', 'accessed': D},
 {'title': '永慶房屋 買屋', 'url': 'https://buy.yungching.com.tw/', 'type': '房仲刊登', 'used_for': '刊登開價、面積拆分、登記用途', 'accessed': D},
 {'title': '住商不動產 買屋', 'url': 'https://www.hbhousing.com.tw/BuyHouse/', 'type': '房仲刊登', 'used_for': '刊登開價、面積拆分、管理費', 'accessed': D},
 {'title': '中信房屋 買屋', 'url': 'https://buy.cthouse.com.tw/', 'type': '房仲刊登', 'used_for': '刊登開價、謄本面積明細', 'accessed': D},
 {'title': '台灣房屋 買屋', 'url': 'https://www.twhg.com.tw/', 'type': '房仲刊登', 'used_for': '刊登開價、面積拆分', 'accessed': D},
 {'title': '太平洋房屋', 'url': 'https://www.pacific.com.tw/', 'type': '房仲刊登', 'used_for': '刊登開價、總坪', 'accessed': D},
 {'title': '東森房屋', 'url': 'https://www.etwarm.com.tw/', 'type': '房仲刊登', 'used_for': '刊登開價、主＋附合計面積', 'accessed': D},
 {'title': '21世紀不動產', 'url': 'https://www.century21.com.tw/', 'type': '房仲刊登', 'used_for': '刊登開價、面積', 'accessed': D},
 {'title': '有巢氏房屋', 'url': 'https://buy.u-trust.com.tw/', 'type': '房仲刊登', 'used_for': '刊登開價、面積', 'accessed': D},
 {'title': '591 房屋交易（僅供人工瀏覽；本研究未採用其資料）', 'url': 'https://sale.591.com.tw/', 'type': '房仲刊登（未採用）', 'used_for': '請自行以瀏覽器查看；條款禁止自動化擷取', 'accessed': D},
]
area = json.load(open(os.path.join(ROOT, 'data', 'area.json'), encoding='utf-8'))
seen = {s['url'] for s in sources}
def add(u, t, typ, used_for, acc):
    if u and u not in seen and u.startswith('http'):
        seen.add(u); sources.append({'title': t or u, 'url': u, 'type': typ, 'used_for': used_for, 'accessed': acc or D})
for m in area.get('micro_areas', []):
    for s in m.get('sources', []):
        add(s.get('url'), s.get('title'), '區域研究', '微區域：' + (m.get('name') or '')[:20] + ('（' + s['note'][:40] + '）' if s.get('note') else ''), s.get('accessed'))
for n in area.get('area_wide_notes', []) or []:
    for s in n.get('sources', []):
        add(s.get('url'), s.get('title'), '區域研究', n.get('topic'), s.get('accessed'))
for t in area.get('transaction_costs', []):
    for s in t.get('sources') or []:
        add(s.get('url'), s.get('title'), '法規／官方', '交易成本規則：' + (t.get('item') or ''), s.get('accessed'))
def stat_type(u):
    return '官方統計' if re.search(r'\.gov\.|gov\.taipei|data\.taipei', u or '') else '第三方平台統計（非官方）'


for m in area.get('market_stats', []) or []:
    for s in (m.get('sources') or []):
        add(s.get('url'), s.get('title'), stat_type(s.get('url')), m.get('name'), s.get('accessed'))
    if m.get('source_url'):
        add(m.get('source_url'), m.get('name'), stat_type(m.get('source_url')), m.get('name'), m.get('accessed'))
add('https://uro.gov.taipei/cp.aspx?n=E06DCE2A43AF2B4F&s=C21E0D057C081F16', '臺北市都市更新處—更新審議辦理情形', '官方', '都更案件階段', D)
for x in sources:
    if re.search(r'leju\.com|myhousing|travel\.taipei', x['url']):
        x['type'] = '未能開啟（HTTP 403）'
        x['used_for'] = '僅引用搜尋引擎摘要，未開啟原頁；不作為任何數字依據。' + (x.get('used_for') or '')
json.dump({'sources': sources, 'platform_log': platform_log}, open(os.path.join(ROOT, 'data', 'sources.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('sources', len(sources), 'platform_log', len(platform_log), used)
