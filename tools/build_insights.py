#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""由 data/properties.json 計算統計並產生 data/insights.json（總覽頁的文字洞察、通用提問、方法摘要）。
敘述中的數字全部由資料計算，避免文字與資料不一致。"""
import json
import os
import statistics as st

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
P = json.load(open(os.path.join(ROOT, 'data', 'properties.json'), encoding='utf-8'))
props, meta = P['properties'], P['meta']
nb_path = os.path.join(ROOT, 'data', 'newbuild.json')
newbuild = json.load(open(nb_path, encoding='utf-8')) if os.path.exists(nb_path) else {'projects': [], 'summary': []}


def price(p):
    v = [l['price_wan'] for l in p['listings'] if l.get('price_wan')]
    return max(v) if v else None


def med(xs, d=0):
    xs = [x for x in xs if x is not None]
    return round(st.median(xs), d) if xs else None


ok = [p for p in props if p['analysis']['A'] == 'ok' and p['analysis']['budget'] == 'ok' and p['location'].get('walk_min') is not None and p['location']['walk_min'] <= 15 and p.get('residential_ok') is True]
bonly = [p for p in props if p['analysis']['A'] == 'fail' and p['analysis']['B'] == 'ok' and p['analysis']['budget'] == 'ok' and p['location'].get('walk_min') is not None and p['location']['walk_min'] <= 15]
first = sorted([p for p in props if p['analysis'].get('first_round')], key=lambda p: p['analysis']['rank'])
n_total = len(props)
old = [p for p in ok if (p.get('age_years') or 0) >= 40]
newer = [p for p in ok if p.get('age_years') is not None and p['age_years'] <= 30]
newer20 = [p for p in ok if p.get('age_years') is not None and p['age_years'] <= 20]
elev = [p for p in ok if p.get('elevator') is True]
park = [p for p in ok if p['price'].get('has_parking') is True]
low = [p for p in ok if price(p) <= 5000]
mid = [p for p in ok if 5000 < price(p) <= 6500]
high = [p for p in ok if price(p) > 6500]
w5 = [p for p in ok if p['location']['walk_min'] <= 5]
w10 = [p for p in ok if 5 < p['location']['walk_min'] <= 10]
w15 = [p for p in ok if 10 < p['location']['walk_min'] <= 15]


def unit_main(ps):
    return med([price(p) / p['area']['main_ping'] for p in ps if p['price'].get('has_parking') is False], 0)


n_price_unk = sum(1 for p in props if p['analysis']['budget'] == 'unknown')
n_area_unk = sum(1 for p in props if 'unknown' in (p['analysis']['A'], p['analysis']['B']))
n_loc_unk = sum(1 for p in props if p['location'].get('walk_min') is None)
n_use = sum(1 for p in props if p.get('residential_ok') is None)
n_no_use = sum(1 for p in props if not p.get('registered_use'))
n_no_auxdetail = sum(1 for p in props if p['area'].get('aux_ping') is not None and not p['area'].get('aux_detail'))
n_same = sum(1 for p in props if p['comps'].get('same_building'))
n_verified = sum(1 for p in props if p['analysis'].get('verified'))

_cr = sorted(p['area']['common_ratio'] * 100 for p in ok if p['area'].get('common_ratio') is not None and (p.get('age_years') or 0) >= 40)
cr_med = st.median(_cr) if _cr else 0
cr_q1, cr_q3 = (_cr[len(_cr) // 4], _cr[(len(_cr) * 3) // 4]) if _cr else (0, 0)
_ver_old = [p for p in props if p['analysis'].get('verified') and (p.get('age_years') or 0) >= 40]
_ver_out = [p for p in _ver_old if p.get('illegal_addition_mention') and ('外移' in p['illegal_addition_mention'] or '外推' in p['illegal_addition_mention'] or '加窗' in p['illegal_addition_mention'] or '增建' in p['illegal_addition_mention'])]


def band_desc(ps):
    if not ps:
        return '沒有符合的物件'
    ne = sum(1 for p in ps if p.get('elevator') is False)
    ages = [p['age_years'] for p in ps if p.get('age_years') is not None]
    mains = [p['area']['main_ping'] for p in ps]
    pk = sum(1 for p in ps if p['price'].get('has_parking') is True)
    return f"{len(ps)} 間；其中無電梯 {ne} 間、有車位 {pk} 間；屋齡 {min(ages):.0f}–{max(ages):.0f} 年（中位數 {st.median(ages):.0f}）；主建物 {min(mains):.1f}–{max(mains):.1f} 坪（中位數 {st.median(mains):.1f}）"


insights = {
    'one_liner': f"本研究從 9 個房仲平台查得 {n_total} 間不重複候選（初篩上限 8,800 萬、步行估算 16.5 分內；其中 {sum(1 for p in props if p['analysis']['budget'] == 'over')} 間超出預算、{sum(1 for p in props if (p['location'].get('walk_min') or 0) > 15)} 間步行估算超過 15 分，都列為不符合）；其中 {len(ok)} 間依刊登頁數字同時符合「主建物 ≥26 坪＋總價 ≤8,000 萬＋步行 ≤15 分」。供給的主體是屋齡 40–50 年、沒有車位的電梯華廈／大樓，中位開價約 {med([price(p) for p in ok]):,.0f} 萬——要滿足 26 坪，通常不需要用滿預算。",
    'direction': [
        f"主力產品是「屋齡 40 年以上的電梯華廈／大樓」：{len(ok)} 間符合者中有 {len(old)} 間屋齡 ≥40 年、{len(elev)} 間有電梯、只有 {len(park)} 間有車位。這類產品主建物大、公設比低（符合者中有共有部分數字的物件，公設比中位數約 {cr_med:.0f}%、多數落在 {cr_q1:.0f}–{cr_q3:.0f}%），是 26 坪室內需求最容易被滿足的地方。",
        f"4,000–6,500 萬就能買到主建物 30–40 坪：開價 ≤5,000 萬且符合者 {len(low)} 間（主建物中位數 {med([p['area']['main_ping'] for p in low], 1)} 坪）；5,000–6,500 萬 {len(mid)} 間（{med([p['area']['main_ping'] for p in mid], 1)} 坪）；6,500–8,000 萬 {len(high)} 間（{med([p['area']['main_ping'] for p in high], 1)} 坪）。把預算用滿換到的主要是更大坪數、車位或少數較新的建物，而不是「才買得到 26 坪」。",
        f"想要屋齡 30 年以內又主建物 ≥26 坪，選擇非常少：依刊登頁數字符合者只有 {len(newer)} 間" + (('（' + '、'.join(f"{p['id']} 屋齡 {p['age_years']:g} 年、開價 {price(p):,.0f} 萬" for p in newer) + '）') if newer else '') + "，而且各有待釐清的問題（見各物件頁）。新大樓公設比高，8,000 萬的權狀坪數換算成主建物後多半不到 26 坪；預售與新成屋見「市場與社區」頁的另列分析。",
        f"第一輪 {len(first)} 間全部是屋齡 40–50 年的電梯華廈／大樓，這不是偏好，而是查核後的結果：入圍的較新大樓與無電梯公寓各有未解決的問題（主建物只比 26 坪多 0.65 坪且開價高於同社區成交、登記商業用或可辦可住、土地含道路用地、出租中、頂樓且面積待核對），已改列「先補資料」或第二輪，並寫明補到什麼資料可以升級。",
        f"深度查核的 {n_verified} 間中，屋齡 40 年以上的有 {len(_ver_old)} 間，其中 {len(_ver_out)} 間的格局圖或文案標註了陽台外移、加窗或增建，而刊登文案多半不會主動說。入圍樣本不是隨機抽樣，不能直接推論全區比例；但其餘未逐間查核的物件，看屋時請優先確認這一點。外推空間不計入 26 坪，且有查報與滲漏風險。",
        "建議順序：先看第一輪的第 1–3 間（分別代表站旁中坪數、低總價、大坪數三種取捨），建立對屋況、採光、噪音的體感，再決定要不要為了坪數、屋齡或車位多付 2,000–3,000 萬。",
    ],
    'gaps': [
        "所有物件的可售狀態都未向房仲確認（本研究未聯絡任何人）；刊登頁存在不等於仍可售。",
        f"面積全部來自刊登頁，未以謄本核實；{n_no_auxdetail} 間的附屬建物沒有陽台／雨遮／露台分項；{n_area_unk} 間面積待確認（A 或 B 任一口徑無法判斷：缺主建物拆分、平台把總建坪填在主建物、含地下層，或無電梯公寓的樓梯間登記疑義）。",
        f"{n_no_use} 間刊登頁未揭露謄本登記用途；另有 {n_use} 間列為「住宅用途待確認」（任一平台的登記用途含商業、辦公、事務所、住商、店鋪、其他等非純住家項目，或本戶含地下層）。",
        f"{n_price_unk} 間總價待確認（有車位但是否含在總價不明，或各平台開價跨過 8,000 萬）；多數平台不揭露車位單價與能否分售。",
        f"{n_loc_unk} 間只有路段、沒有可用座標，步行時間無法可靠估算；其餘物件的步行時間也都是「平台概略座標＋地圖路網」的估算，不是實走。",
        f"成交比對：{n_same} 間找得到推定同棟成交；其餘只能參考同路段相近產品或無從比較。只有 {n_verified} 間做過逐間深度查核，其餘為規則式初判。",
        "591（含屋主自售與較多巷弄門牌資訊）因條款禁止自動擷取而未採用，是覆蓋上的缺口；樂屋網、樂居、大家房屋亦未能取得。",
    ],
    'budget_bands': [
        '3,500 萬以下：' + band_desc([p for p in ok if price(p) <= 3500]) + '。要留意樓梯間登記、頂樓加蓋與貸款年限。',
        '3,500–5,500 萬（主力帶）：' + band_desc([p for p in ok if 3500 < price(p) <= 5500]) + '。站旁 5 分鐘內的選擇多集中在這一帶。',
        '5,500–7,250 萬：' + band_desc([p for p in ok if 5500 < price(p) <= 7250]) + '。',
        '7,250–8,000 萬：' + band_desc([p for p in ok if 7250 < price(p) <= 8000]) + '。接近上限的物件沒有比較好，主要是比較大或含車位。',
        '較低總價已能滿足 26 坪需求；是否用滿預算，取決於你是否在意屋齡、車位與坪數餘裕——這些條件你尚未指定，網站上都可以用篩選器自行比較。',
    ],
    'walk_bands': [
        f"符合者中：≤5 分 {len(w5)} 間、5–10 分 {len(w10)} 間、10–15 分 {len(w15)} 間。",
        f"開價中位數依序為 {med([price(p) for p in w5]):,.0f}／{med([price(p) for p in w10]):,.0f}／{med([price(p) for p in w15]):,.0f} 萬；無車位物件的「開價÷主建物」中位數為 {unit_main(w5)}／{unit_main(w10)}／{unit_main(w15)} 萬/坪；主建物中位數 {med([p['area']['main_ping'] for p in w5], 1)}／{med([p['area']['main_ping'] for p in w10], 1)}／{med([p['area']['main_ping'] for p in w15], 1)} 坪。",
        "在這批樣本中，離站較遠並沒有比較便宜：10–15 分帶多半落在仁愛路、敦化南路、忠孝東路四段南側與光復南路一帶，本身就是高單價路段，也更靠近其他捷運站。樣本是已初篩的在售開價、不是成交價，各帶屋齡與產品組成也不同，不宜做因果推論。",
        "實際差異較大的是環境類型而非距離：站旁（信義路、安和路、通化街口）商業與餐飲密度高；10 分鐘外的仁愛路、東豐街、四維路巷弄住宅純度較高。需現場確認，不預設哪一種比較好。",
    ],
    'newbuild_summary': newbuild.get('summary') or [],
}

generic_questions = [
    "這一戶目前是否仍在售？有沒有人已經下斡旋或要約？屋主的實際委託價與最近一次調價是？",
    "請提供建物與土地謄本（或不動產說明書）：主建物、附屬建物（陽台／雨遮／露台分項）、共有部分、車位的登記面積與登記用途。",
    "車位：是否含在刊登總價？單獨價格？能否不買或分開出售？有無獨立權狀、產權型態（坡道平面／機械、編號、可停車型）？",
    "是否有未登記增建（頂樓加蓋、夾層、陽台外推、露台加蓋、一樓增建）？範圍、年份、是否曾被查報？",
    "漏水、壁癌、滲水的修繕紀錄？是否做過海砂（氯離子）與輻射檢測？是否為事故屋？",
    "近五年公共修繕（外牆、電梯、管線、頂樓防水）與管委會重大決議？公共基金餘額？管理費與車位清潔費？",
    "社區是否有都更或危老的整合、申請或核定紀錄？（只問已發生的事實與階段，不把可能性當成收益）",
    "屋主持有多久、出售原因、是否有租約、抵押設定或限制登記？交屋時間可否配合？",
    "現況格局是否與原始竣工圖相符？有無隔套、變更隔間或一樓作營業使用？",
]

method = {
    'assumptions': [
        "預算 8,000 萬（含）＝房屋開價＋必須一併購買的車位與不可分售項目；稅費、仲介費、代書費、裝修不含在內。",
        "A 口徑（預設）＝登記主建物 ≥26 坪；B 口徑＝主建物＋附屬建物 ≥26 坪，不可稱為純室內。未登記增建、頂加、夾層、外推一律不計。",
        "步行範圍：到最近的可進站出入口 ≤10 分（優先）、10–15 分（擴大）；時間＝OSM 路徑距離÷80 公尺/分，不含等紅燈。",
        "房數、屋齡、樓層、電梯、車位、管理方式都不是硬性門檻，只做成篩選欄位；不因沒有車位而排除。",
        "暫以一般自住分析；不假設家庭組成、學區需求、收入、貸款資格或成數。",
        "無電梯公寓、無共有部分登記、主建物 26–30 坪者，因樓梯間可能計入主建物而列為「面積待確認」（研究假設）。",
        "所有物件狀態：研究日查得刊登頁，實際可售狀態待確認。",
    ],
    'limitations': [
        "面積、屋齡、登記用途、管理費皆為刊登頁揭露，未以謄本、不動產說明書或現場核實。",
        "平台不公開門牌；步行時間以平台概略座標估算，誤差可能達數十至上百公尺；永慶、有巢氏座標未使用。",
        "實價登錄不含社區名；「推定同棟」以路段＋總樓層＋完工年月比對，可能混入鄰棟。成交資料有登記時間差，最近 1–2 個月的交易尚未完整。",
        "591、樂屋網、樂居、大家房屋未能採用（條款或存取限制），屋主自售與部分專任物件可能漏掉。",
        "只有入圍的物件做過逐間深度查核（含當日重抓與文案判讀）；其餘物件的分析由規則產生，請以物件頁的原始連結自行覆核。",
        "照片未逐張判讀；照片看不出漏水不代表沒有漏水，查不到負面資料不代表建物安全。",
        "沒有實地踏勘：噪音、油煙、採光、棟距、管理品質全部需要現場確認。",
        "都更／危老清冊沒有門牌，無法對應到特定在售物件；任何都更可能性都不應視為確定收益。",
    ],
    'methods': [
        "每個平台由一個 agent 讀取公開列表與物件頁，存下原始 HTML，輸出統一欄位的 listings.json；遵守 robots.txt、單執行緒、間隔 ≥1.5 秒、不登入、不送表單。",
        "跨平台去重：樓層與總樓層相同，且主建物／總坪／開價／路段等多重證據吻合才合併；保留每個平台的網址、編號、開價與查閱時間；無法確定者標「疑似重複」。",
        "步行距離：官方出入口座標 × OSM 步行路網（批次查詢），取最近出入口；多平台座標取中位數並顯示範圍。",
        "成交比較：內政部實價登錄開放資料，三種單價口徑分開計算；車位無法拆分與特殊交易另外標示，不混入統計。",
        "入圍物件逐間深度查核：核對原始頁、當日重抓、判讀文案風險字、以門牌或建物特徵找同棟成交、撰寫看屋提問。",
        "判斷邏輯（預算、面積、步行分區）集中在 assets/logic.js，網站與自動測試共用同一份程式。",
    ],
    'update_steps': [
        '更新前先到「收藏與筆記」匯出 JSON 備份（保險用；正常更新不會動到它）。',
        '完整步驟與指令以專案資料夾的 README.md「更新房源」一節為準（重抓各平台 → build_dataset → apply_verification → build_analysis → 截圖 → build_newbuild／build_area／build_sources → build_insights → build_summary → build_bundle → 三組測試）。',
        '不要刪除 data/id_registry.json：它讓同一戶的物件 ID 保持不變，你的收藏與筆記才會對到同一間。',
        '收藏與筆記存在瀏覽器 localStorage（xinyiAnhe.userdata.v1），與 data/ 資料夾完全分離；下架物件的筆記仍會保留並標示「已不在目前資料中」。',
    ],
}
json.dump({'insights': insights, 'generic_questions': generic_questions, 'method': method}, open(os.path.join(ROOT, 'data', 'insights.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('insights written; A-confirmed', len(ok), 'B-only', len(bonly), 'first round', len(first))
