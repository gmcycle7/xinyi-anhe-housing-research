#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第二階段：成交比對 → 規則式分析 → data/properties.json, data/comparables.json

執行： python3 tools/build_analysis.py   （需先跑 tools/build_dataset.py）
- 讀 research_raw/_merged_stage1.json
- 以「路段＋總樓層＋建築完成年月」比對實價登錄（實價登錄不含社區名，無法用社區名直接比對）
- 產生每間物件的：刊登頁事實、研究推論、待確認事項、提問、價格觀察、行動名單
- data/analysis_overrides.json（研究員深度查核後的人工結論，以 ID 為鍵）會覆蓋規則式結果
"""
import datetime as dt
import json
import math
import os
import re
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lvr_lib  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..'))
RAW, DATA = os.path.join(ROOT, 'research_raw'), os.path.join(ROOT, 'data')
RESEARCH_DATE = dt.date(2026, 9, 20)
BUDGET, MIN_PING = 8000, 26
BAD_FLAGS = ('特殊關係', '含增建/未登記', '持分/部分移轉', '急售/債務', '瑕疵/事故', '政府/協議價購', '合建/地主戶', '多層或含地下層移轉', '含租約', '地上權/承租土地', '重建/都更效益', '預售/特殊計價', '車位面積口徑異常')
MAX_WALK_KEEP = 16.5


def isnum(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def U(v):
    return round(v * 10000)


_SEG = {'1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '七'}


def road_of_addr(s):
    s = (s or '').translate(str.maketrans('０１２３４５６７８９', '0123456789'))
    s = re.sub(r'([路街道])([1-7])段', lambda m: m.group(1) + _SEG[m.group(2)] + '段', s)
    s = re.sub(r'(台北市|臺北市|大安區|信義區|\s)', '', s)
    m = re.match(r'(.+?(?:路|街|大道)(?:[一二三四五六七八九十]段)?)(\d+巷)?(\d+弄)?', s)
    return (m.group(1), m.group(2), m.group(3)) if m else (None, None, None)


def built_year_frac(p):
    cd = p.get('completion_date')
    if cd:
        m = re.match(r'(\d{4})\D?(\d{1,2})?', str(cd))
        if m:
            return int(m.group(1)) + ((int(m.group(2)) - 0.5) / 12 if m.group(2) else 0.5), 0.35 if m.group(2) else 0.8
    if isnum(p.get('age_years')):
        now = RESEARCH_DATE.year + (RESEARCH_DATE.timetuple().tm_yday / 365.25)
        return now - p['age_years'], 0.8
    return None, None


def comp_built_frac(c):
    if not c.get('built_date'):
        return None
    y, m, _ = c['built_date'].split('-')
    return int(y) + (int(m) - 0.5) / 12


def months_ago(d):
    y, m, dd = map(int, d.split('-'))
    return (RESEARCH_DATE.year - y) * 12 + (RESEARCH_DATE.month - m) + (RESEARCH_DATE.day - dd) / 30.4


def clean(c):
    return not any(f in BAD_FLAGS for f in c.get('flags', []))


def budget_status(p):
    prices = [l['price_wan'] for l in p['listings'] if isnum(l.get('price_wan'))]
    if p['price'].get('house_price_range_wan'):
        prices = list(p['price']['house_price_range_wan'])
    if not prices:
        return 'unknown'
    lo, hi = min(prices), max(prices)
    pr = p['price']
    if pr['has_parking'] is False or pr['includes_parking'] is True:
        pass
    elif pr['includes_parking'] is False and pr['parking_must_buy'] is False:
        pass
    elif isnum(pr.get('parking_price_wan')) and (pr['includes_parking'] is False or pr['includes_parking'] is None):
        if pr['parking_must_buy'] is True:
            lo, hi = lo + pr['parking_price_wan'], hi + pr['parking_price_wan']
        else:
            hi = hi + pr['parking_price_wan']
    else:
        return 'over' if U(lo) > U(BUDGET) else 'unknown'
    if U(lo) > U(BUDGET):
        return 'over'
    return 'ok' if U(hi) <= U(BUDGET) else 'unknown'


def area_status(p):
    a = p['area']
    m, x = a.get('main_ping'), a.get('aux_ping')
    mpa = a.get('main_plus_aux_ping')
    if not isnum(m) and isnum(mpa):
        B = 'ok' if U(mpa) >= U(MIN_PING) else 'fail'
        A = 'fail' if B == 'fail' else 'unknown'
        if a.get('doubt'):
            B = 'unknown' if B == 'ok' else B
        return A, B
    A = 'unknown' if not isnum(m) else ('ok' if U(m) >= U(MIN_PING) else 'fail')
    if isnum(m) and isnum(x):
        B = 'ok' if U(m) + U(x) >= U(MIN_PING) else 'fail'
    elif A == 'ok':
        B = 'ok'
    else:
        B = 'unknown'
    if a.get('doubt'):
        A = 'unknown' if A == 'ok' else A
        B = 'unknown' if B == 'ok' else B
    return A, B


def asking_units(p):
    prices = [l['price_wan'] for l in p['listings'] if isnum(l.get('price_wan'))]
    if p['price'].get('house_price_range_wan'):
        prices = list(p['price']['house_price_range_wan'])
    if not prices:
        return {}
    ask, a, pr = max(prices), p['area'], p['price']
    net_price = net_area = None
    if pr['has_parking'] is False:
        net_price, net_area = ask, a.get('total_ping')
    elif pr['has_parking'] is True and pr['includes_parking'] is True and isnum(pr.get('parking_price_wan')) and isnum(a.get('parking_ping')):
        net_price, net_area = ask - pr['parking_price_wan'], (a['total_ping'] - a['parking_ping']) if isnum(a.get('total_ping')) else None
    elif pr['has_parking'] is True and pr['includes_parking'] is False:
        net_price = ask
        net_area = (a['total_ping'] - (a['parking_ping'] if a.get('total_includes_parking') and isnum(a.get('parking_ping')) else 0)) if isnum(a.get('total_ping')) else None
    out = {'ask': ask, 'gross': ask / a['total_ping'] if isnum(a.get('total_ping')) and a['total_ping'] > 0 else None}
    if net_price is not None:
        out['net'] = net_price / net_area if isnum(net_area) and net_area > 0 else None
        out['main'] = net_price / a['main_ping'] if isnum(a.get('main_ping')) and a['main_ping'] > 0 else None
    return out


MICRO = {'MA1': '信義路四段北側＋安和路一段巷弄', 'MA2': '安和路二段／敦化南路二段巷弄', 'MA3': '通化街／臨江街夜市周邊', 'MA4': '文昌街／通安街（家具街）',
         'MA5': '敦化南路以西：仁愛路四段／大安路／東豐街／四維路', 'MA6': '光復南路／延吉街南段／國父紀念館南側', 'MA7': '基隆路二段／樂利路／嘉興街', 'MA8': '和平東路三段／敦化南路二段南段'}


def micro_area(p):
    """依概略座標歸入研究者自訂的微區域（界線為工作定義，非官方分區；座標為概略位置）。"""
    lat, lng = p['location'].get('lat'), p['location'].get('lng')
    if not (isnum(lat) and isnum(lng)) or p['location'].get('precision') != 'platform_coord':
        return None, None
    if lng < 121.5490:
        k = 'MA5'
    elif lat >= 25.0333:
        k = 'MA1' if lng < 121.5548 else 'MA6'
    elif lng < 121.5533:
        k = 'MA2' if lat > 25.0288 else 'MA8'
    elif lng > 121.5590 or lat <= 25.0272:
        k = 'MA7'
    elif lat > 25.0305:
        k = 'MA4'
    else:
        k = 'MA3'
    return k, MICRO[k]


def floor_of(p):
    f = p.get('floor')
    return int(float(f)) if f is not None and re.match(r'^-?\d+(\.\d+)?$', str(f)) else None


def fmt(v, d=1):
    return f'{v:,.{d}f}'


def main():
    st = json.load(open(os.path.join(RAW, '_merged_stage1.json'), encoding='utf-8'))
    props = st['props']
    rows = lvr_lib.load_rows()
    comps = [c for c in map(lvr_lib.to_comp, rows) if c and c.get('trade_date')]
    comps_all = comps
    comps = [c for c in comps if months_ago(c['trade_date']) <= 37]
    print('comps loaded', len(comps))

    kept, out_of_range = [], []
    for p in props:
        w = p['location'].get('walk_min')
        if isnum(w) and w > MAX_WALK_KEEP:
            out_of_range.append({'id': p['id'], 'name': p['name'], 'walk_min': w, 'listings': [l['url'] for l in p['listings']]})
        else:
            kept.append(p)
    print('kept', len(kept), 'out of range', len(out_of_range))

    used_comp_ids = {}
    fingerprints = {}
    for p in kept:
        road, lane, _ = road_of_addr(p.get('address_public'))
        tf = p.get('total_floors')
        tf = int(float(tf)) if tf is not None and re.match(r'^\d+(\.\d+)?$', str(tf)) else None
        by, tol = built_year_frac(p)
        is_apt = bool(p.get('property_type') and '公寓' in p['property_type']) or p.get('elevator') is False
        pf = floor_of(p)
        subj_ground = (pf == 1) or ('B' in str(p.get('floor') or ''))
        subj_main = p['area'].get('main_ping')
        exact_date = None
        if p.get('completion_date') and re.match(r'^\d{4}-\d{2}-\d{2}$', str(p['completion_date'])):
            exact_date = str(p['completion_date'])

        def usable(c):
            """可比性的基本條件：住家用、樓層可解析；一樓只和一樓比、樓上只和樓上比。"""
            if '住' not in (c.get('main_use') or ''):
                return False
            if c.get('floor') is None:
                return False
            return (c['floor'] == 1) == bool(subj_ground)

        same, nearby = [], []
        for c in comps:
            if c['road'] != road or not usable(c):
                continue
            cb = comp_built_frac(c)
            if not (tf and c['total_floors'] == tf and by and cb):
                continue
            if lane and c['lane'] and c['lane'] != lane:
                continue
            if exact_date:
                ok_date = c.get('built_date') and abs((dt.date.fromisoformat(c['built_date']) - dt.date.fromisoformat(exact_date)).days) <= 31
            else:
                ok_date = abs(cb - by) <= tol
            if ok_date:
                same.append(c)
        # 同日同門牌（不含樓層）多筆視為同一事件；跨多個巷或多個完工日 → 不是單一建物
        lanes = {c['lane'] for c in same}
        built = {c['built_date'] for c in same}
        single_building = len(built) <= 1 and len(lanes) <= 1 and (bool(lane) or bool(exact_date) or len(same) <= 6)
        same_ids = {c['id'] for c in same}
        for c in comps:
            if c['id'] in same_ids or c['road'] != road or not clean(c) or not c['parking_split_ok'] or not usable(c):
                continue
            if months_ago(c['trade_date']) > 24.5 or not isnum(c.get('main_ping')) or c['main_ping'] < 18:
                continue
            if isnum(subj_main) and not (0.6 * subj_main <= c['main_ping'] <= 1.4 * subj_main):
                continue
            c_apt = c['building_type'] == '公寓'
            if c_apt != is_apt:
                continue
            cb = comp_built_frac(c)
            if by and cb and abs(cb - by) > 10:
                continue
            nearby.append(c)
        same.sort(key=lambda c: c['trade_date'], reverse=True)
        nearby.sort(key=lambda c: ((0 if (lane and c['lane'] == lane) else 1), -int(c['trade_date'].replace('-', ''))))
        nearby = nearby[:10]
        for c in same + nearby:
            used_comp_ids[c['id']] = c
        same24 = [c for c in same if months_ago(c['trade_date']) <= 24.5]
        ext = len(same24) < 2 and len(same) > len(same24)
        same_use = same if ext else same24
        if same_use and single_building:
            note_same = ('比對方式（規則式，未經逐筆查核）：同路段＋總樓層相同＋建築完成' + ('日相同' if exact_date else '年月相近') + '，且只對到單一完工日／單一巷 → 推定同一建物。實價登錄不含社區名，仍可能有誤。' +
                         ('近 24 個月樣本不足，已延伸至 36 個月。' if ext else '期間：近 24 個月。'))
        elif same_use:
            note_same = ('比對方式（規則式，未經逐筆查核）：同路段＋總樓層相同＋完工年月相近，但對到 %d 個不同完工日／%d 個巷 → 這些是「同路段同期興建的建物」，不是單一社區，只能當鄰近參考。' % (len(built), len(lanes)) +
                         ('近 24 個月樣本不足，已延伸至 36 個月。' if ext else '期間：近 24 個月。'))
        else:
            note_same = '依「同路段＋總樓層＋建築完成年月」在近 36 個月實價登錄中找不到可比的成交紀錄（或刊登頁缺少總樓層／屋齡而無法比對）。' + ('本戶為一樓／含地下層：只與一樓成交比較。' if subj_ground else '')
        note_near = '同路段、住家用、同建物類別（電梯／無電梯）、同為一樓或同為樓上、屋齡差 10 年內、主建物為本戶的 60–140%、近 24 個月、無特殊交易備註且車位可拆分；最多列 10 筆（同巷優先、較新優先）。' if nearby else '同路段近 24 個月沒有條件相近且可乾淨比較的成交。'
        p['_single_building'] = bool(same_use and single_building)
        p['comps'] = {'same_building': [c['id'] for c in same_use], 'nearby': [c['id'] for c in nearby], 'same_building_note': note_same, 'nearby_note': note_near}
        if same_use and p.get('_single_building'):
            fp = (road, tf, round(by) if by else None)
            fingerprints.setdefault(fp, {'props': [], 'comps': same_use})['props'].append(p['id'])

        # ---- price view ----
        au = asking_units(p)
        def events(group):
            """同一天、同一門牌（去掉樓層）的多筆成交視為一個事件（多為整棟或整批移轉），只留一筆。"""
            seen_ev, out = set(), []
            for c in group:
                k = (c['trade_date'], re.sub(r'(地下)?[一二三四五六七八九十\d]+樓.*$', '', c['address']))
                if k not in seen_ev:
                    seen_ev.add(k)
                    out.append(c)
            return out
        sized = lambda c: not isnum(subj_main) or (0.6 * subj_main <= c['main_ping'] <= 1.4 * subj_main)
        cl = events([c for c in same_use if clean(c) and c['parking_split_ok'] and isnum(c.get('unit_main_wan')) and isnum(c.get('main_ping')) and sized(c)]) if p.get('_single_building') else []
        pv = {'text': '目前不足以判斷：沒有可乾淨比較的同棟或鄰近成交。', 'caveats': [], 'basis': None, 'premium_pct': None}

        def describe(group, label):
            vals = sorted(c['unit_main_wan'] for c in group)
            if len(vals) >= 3:
                med = statistics.median(vals)
                return f'{label} {len(vals)} 筆可比成交，②（扣車位價÷主建物）範圍 {fmt(vals[0])}–{fmt(vals[-1])}、中位數 {fmt(med)} 萬/坪', med
            return (f'{label}僅 {len(vals)} 筆可比成交，樣本太少不做統計，逐筆列示：' +
                    '；'.join(f"{c['trade_date'][:7]} {c['floor']}樓 ② {fmt(c['unit_main_wan'])} 萬/坪（開價換算較此筆{'高' if au['main'] >= c['unit_main_wan'] else '低'} {abs(au['main'] / c['unit_main_wan'] - 1) * 100:.0f}%）" for c in group)), None
        if p.get('product_stage') == '預售屋':
            pv['text'] = '預售屋不與中古成交比較（產品、交屋時間與付款條件不同）。同建案的預售實價登錄見「市場與社區」頁。'
        elif isnum(au.get('main')):
            near_grp = events([c for c in nearby if isnum(c.get('unit_main_wan'))])
            grp, label = (cl, '推定同一建物') if cl else (near_grp, '同路段相近產品')
            if grp:
                s_txt, med = describe(grp, label)
                pv['basis'], pv['n'] = ('same_building' if cl else 'nearby'), len(grp)
                if med is not None:
                    prem = (au['main'] / med - 1) * 100
                    pv['premium_pct'] = round(prem, 1)
                    pv['text'] = f"開價換算②每主建物坪 {fmt(au['main'])} 萬。{s_txt}。開價較該中位數{'高' if prem >= 0 else '低'} {abs(prem):.0f}%。這是「開價對成交」的差距，不代表可以議價的幅度。"
                else:
                    pv['text'] = f"開價換算②每主建物坪 {fmt(au['main'])} 萬。{s_txt}。以上是「開價對成交」的逐筆差距，不代表可以議價的幅度；樣本少於 3 筆，不提供整體百分比。"
                if not cl:
                    pv['caveats'].append('沒有可確認為同一建物的乾淨成交，改用同路段相近產品；不同棟的屋況、樓層、景觀、管理差異大，僅供粗略參考。')
                if subj_ground:
                    pv['caveats'].append('本戶為一樓／含地下層，只與一樓成交比較；一樓價格受店面效益與增建影響大。')
                pv['caveats'].append('成交樓層、屋況（是否含裝潢）、交易時間不同，未做調整。')
                pv['caveats'].append('本段為規則式自動比對、未經逐筆人工查核：可能混入同路段同期興建的鄰棟。深度查核時曾發現這類比對方向錯誤的案例，請把它當成線索而不是結論，並以下方逐筆成交自行判讀。')
            elif subj_ground:
                pv['text'] = f"開價換算②每主建物坪 {fmt(au['main'])} 萬。本戶為一樓／含地下層，查詢期間同路段沒有可比的一樓住家成交，不與樓上成交比較，因此不提供百分比。"
        elif isnum(au.get('gross')):
            pv['text'] = f"車位價格或面積無法從刊登頁拆分，只能算含車位指標：開價÷總坪 = {fmt(au['gross'])} 萬/坪；此指標不可與扣車位後的成交單價直接比較。目前不足以判斷開價合理性。"
        p['analysis_auto'] = {'price_view': pv, 'asking_units': au}

    # ---- facts / inferences / questions / tier ----
    for p in kept:
        a, pr, loc = p['area'], p['price'], p['location']
        A, B = area_status(p)
        bs = budget_status(p)
        w = loc.get('walk_min')
        prices = [l['price_wan'] for l in p['listings'] if isnum(l.get('price_wan'))]
        facts = []
        if prices:
            facts.append('刊登總價 ' + ('～'.join(f'{x:g}' for x in sorted(set([min(prices), max(prices)])))) + ' 萬（' + '、'.join(f"{l['platform_name']} {l['price_wan']:g}" for l in p['listings'] if isnum(l.get('price_wan'))) + '）')
        if isnum(a.get('main_ping')):
            facts.append(f"主建物 {a['main_ping']:g} 坪、附屬建物 {a['aux_ping']:g} 坪" if isnum(a.get('aux_ping')) else f"主建物 {a['main_ping']:g} 坪（附屬建物未揭露）")
        if isnum(a.get('common_ping')):
            facts.append(f"共有部分 {a['common_ping']:g} 坪、權狀 {a['total_ping']:g} 坪" + (f"、車位 {a['parking_ping']:g} 坪" if isnum(a.get('parking_ping')) else ''))
        if p.get('registered_use'):
            facts.append(f"登記用途：{p['registered_use']}")
        if isnum(p.get('age_years')):
            facts.append(f"屋齡 {p['age_years']:g} 年" + (f"（{p['completion_date']} 完工）" if p.get('completion_date') else ''))
        facts.append(f"{p.get('property_type') or '類型未揭露'}，{p.get('floor')}/{p.get('total_floors')} 樓，{p.get('layout_text') or '格局未揭露'}")
        if p.get('mgmt_fee_text'):
            facts.append(f"管理費：{p['mgmt_fee_text']}" + (f"；管理：{p['management']}" if p.get('management') else ''))
        if pr.get('parking_text'):
            facts.append('車位欄位：' + pr['parking_text'])

        inf, draw, reasons, missing, qs, onsite = [], [], [], [], [], []
        floor_n = int(float(p['floor'])) if p.get('floor') is not None and re.match(r'^-?\d+(\.\d+)?$', str(p['floor'])) else None
        tf_n = int(float(p['total_floors'])) if p.get('total_floors') is not None and re.match(r'^\d+(\.\d+)?$', str(p['total_floors'])) else None
        top = floor_n and tf_n and floor_n == tf_n
        if isnum(w):
            inf.append(f"步行約 {w:g} 分（{loc['walk_m']:.0f} m，地圖估算）到出口{loc['nearest_exit']}" + ('；屬優先範圍' if w <= 10 else '；屬擴大範圍（10–15 分）' if w <= 15 else '；略超過 15 分，列為邊界'))
        if not isnum(w):
            missing.append('位置待確認：刊登頁沒有可用的物件座標或門牌，步行時間無法可靠估算' + (f"（路段代表點粗估約 {loc['rough_walk_min']:g} 分，誤差大）" if isnum(loc.get('rough_walk_min')) else ''))
        elif loc.get('borderline'):
            missing.append('步行時間落在分界附近或各平台座標差異大：需以實際門牌實走確認')
        if isnum(a.get('common_ratio')):
            inf.append(f"公設比約 {a['common_ratio'] * 100:.0f}%（共有部分÷不含車位總面積，研究換算）")
        if isnum(p.get('age_years')) and p['age_years'] >= 40:
            draw.append(f"屋齡 {p['age_years']:g} 年：貸款年限與成數可能受限（各銀行不同，未假設你的條件）、管線與防水需檢查")
            qs.append('近年是否做過管線更新、外牆或頂樓防水、結構補強？有無海砂屋／輻射屋檢測與耐震評估資料？')
            qs.append('社區是否有都更或危老的整合、申請紀錄？（只問進度事實，不當作確定收益）')
        elif isnum(p.get('age_years')) and p['age_years'] >= 30:
            draw.append(f"屋齡 {p['age_years']:g} 年：需留意管線、防水與貸款年限")
        if p.get('elevator') is False:
            draw.append(f"無電梯{'（' + str(p['floor']) + ' 樓）' if p.get('floor') else ''}：長期居住與搬運便利性需評估")
        if top:
            draw.append('頂樓：防水、隔熱與是否有頂樓加蓋（加蓋不計入坪數、且有拆除風險）需查')
            onsite.append('頂樓天花板、牆角有無水痕；屋頂防水層現況；有無頂樓增建及其使用權約定')
        if floor_n == 1:
            onsite.append('一樓：潮濕、採光、隱私、臨路噪音與排水；是否有法定空地占用或增建')
        if p.get('illegal_addition_mention'):
            draw.append('刊登頁提到增建／加蓋／外推相關內容：該部分不計入 26 坪，且有被查報拆除風險')
            qs.append('增建／外推部分的範圍、建造年份、是否曾被查報？成交價是否含這部分的價值？')
        if p.get('layout_note'):
            inf.append('格局備註：' + str(p['layout_note']))
        if p.get('suite_rental_flag'):
            draw.append('刊登文案提到隔套／套房收租：現況可能不是一般自住格局，恢復原格局的費用與合法性需確認')
            qs.append('目前是否隔成套房出租？隔間是否合法、有無租約、能否恢復原格局？')
            missing.append('現況是否為隔套收租產品待確認')
        if p.get('stage_note'):
            missing.append(p['stage_note'])
        if a.get('doubt'):
            missing.append(a['doubt'])
        if not isnum(a.get('main_ping')):
            missing.append('主建物坪數未揭露：無法判斷 A 口徑')
            qs.append('請提供建物謄本或不動產說明書上的主建物、附屬建物（陽台／雨遮／露台分項）、共有部分、車位面積。')
        elif not isnum(a.get('aux_ping')):
            missing.append('附屬建物坪數未揭露')
        if isnum(a.get('aux_ping')) and not a.get('aux_detail'):
            missing.append('附屬建物組成（陽台／雨遮／露台各多少）未揭露')
        if pr['has_parking'] is True and pr['includes_parking'] is None:
            missing.append('有車位，但刊登總價是否含車位、車位價格、能否分售不明')
            qs.append('刊登總價是否已含車位？車位單獨價格多少？車位能否不買或分開出售？車位是否有獨立權狀？')
        elif pr['has_parking'] is True and pr['includes_parking'] is True and not isnum(pr.get('parking_price_wan')):
            missing.append('總價含車位，但車位價格未拆分：無法計算扣車位後單價')
            qs.append('車位在總價中的拆分價格是多少？車位形式、尺寸、是否可停休旅車？')
        elif pr['has_parking'] is None:
            missing.append('有無車位及計價方式未揭露')
            qs.append('這一戶有沒有車位？如果有，是否含在總價、是否必須一起買？')
        if pr['has_parking'] is True and isnum(a.get('parking_ping')) is False:
            missing.append('車位面積未揭露：無法確認權狀坪數中有多少是車位')
        if not p.get('registered_use'):
            missing.append('謄本登記用途未揭露（需確認為住家用）')
        elif p.get('residential_ok') is None:
            missing.append(p.get('residential_note'))
            qs.append('登記用途不是住家用：可否申請住宅貸款？房屋稅、地價稅適用稅率？管委會是否允許純住家使用？')
        if not p.get('mgmt_fee_text'):
            missing.append('管理費未揭露')
        if len(p['listings']) > 1 and prices and min(prices) != max(prices):
            missing.append(f'各平台開價不一致（{min(prices):g}～{max(prices):g} 萬）：需確認屋主實際委託價')
            qs.append('不同仲介的開價不同，屋主目前的委託底價與最新調價是？')
        qs = ['這一戶目前是否仍在售？是否已有人下斡旋或要約？'] + qs + ['是否有漏水、壁癌、滲水修繕紀錄？近五年公共修繕與管委會重大決議？', '屋主持有多久、出售原因、是否有租約或設定？']
        onsite = onsite + ['平日與假日、白天與晚上各去一次：幹道車流、餐飲油煙、夜間人潮與酒吧噪音', '從門口實走到最近的捷運出入口計時（含等紅燈）', '各房間採光、通風與對外窗；梁柱位置與實際可用空間']

        pv = p['analysis_auto']['price_view']
        fails = []
        if bs == 'over':
            fails.append('超出 8,000 萬預算')
        if A == 'fail' and B == 'fail':
            fails.append('主建物與主＋附皆未達 26 坪')
        if isnum(w) and w > 15:
            fails.append('步行超過 15 分鐘')
        pend = []
        if bs == 'unknown':
            pend.append('總價待確認')
        if A == 'unknown' and B != 'ok':
            pend.append('面積待確認')
        if not isnum(w):
            pend.append('位置待確認')
        if p.get('residential_ok') is None:
            pend.append('住宅用途待確認')

        if fails:
            tier, reason = 'not_fit', '；'.join(fails)
        elif pend or (A != 'ok') or p.get('suite_rental_flag'):
            tier = 'need_info'
            reason = '；'.join(pend) if pend else ('文案提到隔套／套房收租，是否為一般自住格局待確認' if (A == 'ok' and p.get('suite_rental_flag')) else ('主＋附符合26坪；主建物未達26坪（只符合 B 口徑）' if B == 'ok' else '面積待確認'))
        else:
            tier, reason = 'visit', '依刊登頁數字：總價、主建物、步行範圍皆符合'
        # 評分（只用於同一名單內排序；公開在 METHODOLOGY.md）
        score = 0.0
        if isnum(w):
            score += max(0, 15 - w) * 2.0
        if isnum(a.get('main_ping')):
            score += min(a['main_ping'] - 26, 10) * 1.0
        if pv.get('premium_pct') is not None:
            score += max(-15, min(15, -pv['premium_pct'])) * 0.6 * (1 if pv.get('basis') == 'same_building' else 0.5)
        if p.get('elevator') is True:
            score += 4
        if isnum(p.get('age_years')):
            score += max(0, (45 - p['age_years'])) * 0.25
        if top or floor_n == 1:
            score -= 3
        if p.get('illegal_addition_mention'):
            score -= 4
        if loc.get('borderline'):
            score -= 2
        if prices and max(prices) > 0:
            score += (BUDGET - max(prices)) / BUDGET * 10  # 較低總價保留較多裝修與稅費空間
        p['analysis'] = {'tier': tier, 'tier_reason': reason, 'score': round(score, 2), 'rank': None, 'first_round': False,
                         'headline_pro': None, 'headline_con': None, 'reasons': reasons, 'drawbacks': draw, 'price_view': pv,
                         'missing': list(dict.fromkeys(m for m in missing if m)), 'questions': list(dict.fromkeys(qs)), 'onsite_checks': list(dict.fromkeys(onsite)),
                         'worth_visit_text': None, 'A': A, 'B': B, 'budget': bs}
        p['facts'], p['inferences'] = facts, inf

        pros = []
        if isnum(w) and w <= 5:
            pros.append(f'步行約 {w:g} 分到捷運出入口')
        if pv.get('premium_pct') is not None and -15 <= pv['premium_pct'] <= 5 and pv.get('basis') == 'same_building' and (pv.get('n') or 0) >= 2:
            pros.append(f"開價與推定同棟 {pv['n']} 筆成交相近（差 {pv['premium_pct']:+.0f}%；規則式比對，待查核）")
        if isnum(a.get('main_ping')) and a['main_ping'] >= 32:
            pros.append(f"主建物 {a['main_ping']:g} 坪，高於門檻 {a['main_ping'] - 26:.1f} 坪")
        if isnum(a.get('common_ratio')) and a['common_ratio'] <= 0.15 and isnum(a.get('common_ping')):
            pros.append(f"公設比低（約 {a['common_ratio'] * 100:.0f}%）")
        if isnum(p.get('age_years')) and p['age_years'] <= 20:
            pros.append(f"屋齡 {p['age_years']:g} 年，相對較新")
        if prices and max(prices) <= 5500 and A == 'ok':
            pros.append(f'總價 {max(prices):g} 萬，保留較多預算空間')
        if isnum(w) and w <= 10 and not pros:
            pros.append(f'步行約 {w:g} 分，屬優先範圍')
        if not pros and A == 'ok':
            pros.append('主建物達 26 坪且在預算內')
        cons = list(draw)
        if fails:
            cons = fails + cons
        elif pend:
            cons = pend + cons
        if pv.get('premium_pct') is not None and pv['premium_pct'] >= 20:
            cons.append(f"開價高於可比成交參考值 {pv['premium_pct']:.0f}%")
        p['analysis']['headline_pro'] = pros[0] if pros else '（目前沒有明確優勢）'
        p['analysis']['headline_con'] = cons[0] if cons else ((p['analysis']['missing'] or ['尚無明顯疑慮，但屋況未經現場確認'])[0])
        p['analysis']['reasons'] = pros
        if pv.get('premium_pct') is not None and pv['premium_pct'] >= 20:
            p['analysis']['drawbacks'] = draw + [f"開價高於可比成交參考值 {pv['premium_pct']:.0f}%（詳見價格比較）"]
        del p['analysis_auto']
        p.pop('_single_building', None)

    # overrides
    ov_path = os.path.join(DATA, 'analysis_overrides.json')
    overrides = json.load(open(ov_path, encoding='utf-8')) if os.path.exists(ov_path) else {}
    for p in kept:
        o = overrides.get(p['id'])
        if o:
            for k, v in o.items():
                if k == 'analysis':
                    for kk, vv in v.items():
                        if kk == 'price_view':
                            p['analysis']['price_view'].update(vv)
                        else:
                            p['analysis'][kk] = vv
                elif k in ('area', 'price', 'location', 'comps') and isinstance(v, dict):
                    p[k].update(v)
                else:
                    p[k] = v

    comp_by_id = {c['id']: c for c in comps_all}
    shots_path = os.path.join(DATA, 'screenshots.json')
    shots = json.load(open(shots_path, encoding='utf-8')) if os.path.exists(shots_path) else {}
    for p in kept:
        for cid in p['comps'].get('same_building', []) + p['comps'].get('nearby', []):
            if cid in comp_by_id:
                used_comp_ids[cid] = comp_by_id[cid]
        p['screenshots'] = [s for s in shots.get(p['id'], []) if s.get('ok')]
        p['micro_area_id'], p['micro_area_name'] = micro_area(p)
        an = p['analysis']
        # 查核後重新判定名單：條件不符一律 not_fit；查核員建議 need_info/exclude 時不列入優先看屋
        A, B = area_status(p)
        bs = budget_status(p)
        w = p['location'].get('walk_min')
        an['A'], an['B'], an['budget'] = A, B, bs
        if an.get('verified'):
            fails = [x for x in [('超出 8,000 萬預算' if bs == 'over' else None), ('主建物與主＋附皆未達 26 坪' if (A == 'fail' and B == 'fail') else None), ('步行超過 15 分鐘' if (isnum(w) and w > 15) else None)] if x]
            if fails:
                an['tier'], an['tier_reason'] = 'not_fit', '；'.join(fails)
            elif an.get('tier_locked'):
                pass
            elif an.get('verify_recommend') == 'exclude':
                an['tier'], an['tier_reason'] = 'not_fit', '深度查核後不建議：' + (an.get('headline_con') or '')
            elif an.get('verify_recommend') == 'need_info' or A != 'ok' or bs != 'ok' or p.get('residential_ok') is None:
                an['tier'] = 'need_info'
                an['tier_reason'] = an.get('headline_con') or an.get('tier_reason')
            else:
                an['tier'], an['tier_reason'] = 'visit', '深度查核後仍符合：' + (an.get('headline_pro') or '')
        if not an.get('verified') and not an.get('tier_locked'):
            w2 = p['location'].get('walk_min')
            f2 = [x for x in [('超出 8,000 萬預算' if bs == 'over' else None), ('主建物與主＋附皆未達 26 坪' if (A == 'fail' and B == 'fail') else None), ('步行超過 15 分鐘' if (isnum(w2) and w2 > 15) else None)] if x]
            if f2:
                an['tier'], an['tier_reason'] = 'not_fit', '；'.join(f2)
        if p.get('residential_ok') is False and an['tier'] != 'not_fit':
            an['tier'], an['tier_reason'] = 'not_fit', p.get('residential_note') or '非一般完整住宅'
        if an['tier'] != 'visit':
            an['first_round'] = False

    for tier in ('visit', 'need_info', 'not_fit'):
        arr = sorted([p for p in kept if p['analysis']['tier'] == tier], key=lambda p: (0 if p['analysis'].get('first_round') else 1, p['analysis'].get('curated_rank') or 999, 0 if p['analysis'].get('verified') else 1, -p['analysis']['score']))
        for i, p in enumerate(arr, 1):
            p['analysis']['rank'] = i

    # communities (fingerprint groups with both listings and comps)
    communities = []
    for (road, tf, by), g in sorted(fingerprints.items(), key=lambda kv: -len(kv[1]['props'])):
        ps = [p for p in kept if p['id'] in g['props']]
        if not ps:
            continue
        cl = [c for c in g['comps'] if clean(c) and c['parking_split_ok'] and isnum(c.get('unit_main_wan'))]
        names = [p['community'] for p in ps if p.get('community')]
        name = (max(set(names), key=names.count) if names else f'{road} {tf}樓建物') + f'（{road}・{tf}F・約{by}年完工）'
        if cl:
            vals = sorted(c['unit_main_wan'] for c in cl)
            summ = f"近 36 個月可比成交 {len(cl)} 筆；②÷主建物 {vals[0]:.1f}–{vals[-1]:.1f} 萬/坪" + (f"，中位數 {statistics.median(vals):.1f}" if len(cl) >= 3 else '（樣本少，逐筆見物件頁）') + f"；最近一筆 {max(c['trade_date'] for c in cl)}"
        else:
            summ = f"有 {len(g['comps'])} 筆成交但皆有特殊備註或車位無法拆分"
        mg = next((p.get('management') for p in ps if p.get('management')), None)
        fee = next((p.get('mgmt_fee_text') for p in ps if p.get('mgmt_fee_text')), None)
        pk = any(p['price'].get('has_parking') for p in ps)
        communities.append({'name': name, 'address_hint': road, 'age_scale': f"約 {RESEARCH_DATE.year - by} 年｜地上 {tf} 層｜戶數未查得" if by else f'{tf} 層',
                            'mgmt_parking': '；'.join(x for x in [mg, ('管理費 ' + fee) if fee else None, '在售戶有車位' if pk else '在售戶無車位或未揭露'] if x),
                            'property_ids': [p['id'] for p in ps], 'comp_ids': [c['id'] for c in g['comps']], 'comp_summary': summ,
                            'todo': '社區總戶數、管委會運作、公共基金與近期修繕需向房仲或管委會確認；比對為推定同棟'})

    # road stats
    roads = {}
    for c in comps:
        if months_ago(c['trade_date']) > 24.5 or not clean(c) or not c['parking_split_ok'] or not isnum(c.get('main_ping')) or c['main_ping'] < 20:
            continue
        if '住' not in (c.get('main_use') or '') or c.get('floor') in (None, 1):
            continue  # 只統計住家用、樓層可解析且非一樓（一樓多為店面效益，另當別論）
        if c['road'] not in {road_of_addr(p.get('address_public'))[0] for p in kept}:
            continue
        roads.setdefault((c['road'], '無電梯公寓' if c['building_type'] == '公寓' else '電梯大樓／華廈'), []).append(c)
    road_stats = []
    for (road, bt), arr in sorted(roads.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        n = len(arr)
        um = sorted(c['unit_main_wan'] for c in arr if isnum(c.get('unit_main_wan')))
        un = [c['unit_net_wan'] for c in arr if isnum(c.get('unit_net_wan'))]
        road_stats.append({'road': road, 'building_type': bt, 'n': n, 'unit_net_median': round(statistics.median(un), 2) if n >= 5 else None, 'unit_main_median': round(statistics.median(um), 2) if n >= 5 else None,
                           'unit_main_min': um[0] if len(um) >= 3 else None, 'unit_main_max': um[-1] if len(um) >= 3 else None, 'price_median': statistics.median(c['net_price_wan'] for c in arr) if n >= 5 else None,
                           'main_median': statistics.median(c['main_ping'] for c in arr) if n >= 5 else None})

    meta = {'research_date': RESEARCH_DATE.isoformat(), 'budget_wan': BUDGET, 'min_ping': MIN_PING, 'raw_listing_count': st['raw_count'], 'listing_count_after_type_filter': st['listing_count'],
            'unique_units_all': len(props), 'out_of_range_count': len(out_of_range), 'candidate_count': len(kept)}
    json.dump({'meta': meta, 'properties': kept}, open(os.path.join(DATA, 'properties.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    dates = sorted(c['trade_date'] for c in used_comp_ids.values()) or ['', '']
    json.dump({'period': f'交易日 {dates[0]}～{dates[-1]}（登記期間 113Q3–115Q2 共 8 季＋115 年 9 月 11 日期；比對視窗：同棟 24→36 個月、鄰近 24 個月）', 'comparables': sorted(used_comp_ids.values(), key=lambda c: c['trade_date'], reverse=True),
               'road_stats': road_stats, 'communities': communities}, open(os.path.join(DATA, 'comparables.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(out_of_range, open(os.path.join(RAW, '_out_of_range.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    from collections import Counter
    print('tiers', Counter(p['analysis']['tier'] for p in kept))
    print('A ok & budget ok', sum(1 for p in kept if p['analysis']['A'] == 'ok' and p['analysis']['budget'] == 'ok'))
    print('comps used', len(used_comp_ids), 'communities', len(communities), 'road_stats', len(road_stats))


if __name__ == '__main__':
    main()
