#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""合併各平台 listings.json → 去重 → 定位 → 步行路由 → 成交比對 → data/properties.json, data/comparables.json

執行： python3 tools/build_dataset.py
重跑安全：
- 物件 ID 由 data/id_registry.json 維護（"平台:物件編號" → ID）。既有 ID 不會變動，
  因此使用者在瀏覽器的收藏與筆記（以 ID 為鍵）不會因更新房源而錯位或被覆蓋。
- 路由與地理編碼結果快取在 research_raw/geo_cache.json，避免重複請求公開服務。
- 人工／研究員撰寫的分析放在 data/analysis_overrides.json（以 ID 為鍵），重跑時會被保留並合併。
"""
import json
import math
import os
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lvr_lib  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..'))
RAW = os.path.join(ROOT, 'research_raw')
DATA = os.path.join(ROOT, 'data')
# 591 已排除：其頁尾條款禁止自動化擷取（見 research_raw/_quarantine_591_not_used/README_QUARANTINE.md）
PLATFORM_DIRS = ['sinyi', 'yungching', 'hbhousing', 'twhg', 'cthouse', 'others']
# 這兩個平台的座標只存在於頁面內嵌、經編碼（非明碼）的狀態字串中；為避免有繞過平台防護之嫌，本研究不使用其座標
COORD_NOT_USED = {'yungching', 'utrust'}
PLATFORM_NAMES = {'sinyi': '信義房屋', 'yungching': '永慶房屋', 'hbhousing': '住商不動產', 'twhg': '台灣房屋', 'cthouse': '中信房屋', 'pacific': '太平洋房屋',
                  'etwarm': '東森房屋', 'century21': '21世紀不動產', 'utrust': '有巢氏房屋', 'greathome': '大家房屋'}
UA = 'xinyi-anhe-personal-research/1.0 (local, non-commercial study)'
WALK_M_PER_MIN = 80.0
RESEARCH_DATE = '2026-09-20'
STATUS_TEXT = '研究日查得刊登頁，實際可售狀態待確認'
BUDGET, MIN_PING = 8000, 26

_ex = json.load(open(os.path.join(DATA, 'station_exits.json'), encoding='utf-8'))
EXITS, STATION = _ex['exits'], _ex['station']

NON_RES_TYPE = re.compile(r'店面|店辦|辦公|商辦|純車位|土地|廠|倉|攤位')
# 任一平台的登記用途含下列字樣 → 住宅用途待確認（取最不利者）
MIXED_USE = re.compile(r'事務所|辦公|商業|店|零售|工業|廠|旅館|診所|補習|餐|住商|工商|其他|防空避難|儲藏')
NON_RES_USE = re.compile(r'事務所|辦公|商業|店|零售|工業|廠|旅館|診所|補習|餐')


def num(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(v) else None
    m = re.search(r'-?\d+(?:\.\d+)?', str(v).replace(',', ''))
    return float(m.group(0)) if m else None


def haversine(lat1, lng1, lat2, lng2):
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def load_cache():
    p = os.path.join(RAW, 'geo_cache.json')
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {'route': {}, 'geocode': {}}


def save_cache(c):
    json.dump(c, open(os.path.join(RAW, 'geo_cache.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


def http_json(url):
    """用系統 curl 取 JSON（此機器的 python.org Python 沒有安裝 CA 憑證；不關閉憑證驗證）。"""
    import subprocess
    out = subprocess.run(['curl', '-sS', '--max-time', '40', '-A', UA, '-H', 'Accept: application/json', url], capture_output=True, check=True)
    return json.loads(out.stdout.decode('utf-8'))


def _key(lat, lng):
    return f'{float(lat):.6f},{float(lng):.6f}'


def prefetch_routes(coords, cache, batch=40):
    """一次請求送多個起點（OSRM table：多起點 × 6 個出入口），把對公開路由服務的請求數降到最低。"""
    todo = [c for c in dict.fromkeys(_key(*c) for c in coords) if c not in cache['route'] or 'error' in cache['route'][c]]
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        pts = ';'.join(f"{k.split(',')[1]},{k.split(',')[0]}" for k in chunk) + ';' + ';'.join(f"{e['lng']},{e['lat']}" for e in EXITS)
        n = len(chunk)
        url = (f'https://routing.openstreetmap.de/routed-foot/table/v1/foot/{pts}?sources=' + ';'.join(map(str, range(n))) +
               '&destinations=' + ';'.join(str(n + j) for j in range(len(EXITS))) + '&annotations=distance')
        stamp = time.strftime('%Y-%m-%dT%H:%M:%S+08:00')
        for attempt in range(4):
            try:
                j = http_json(url)
                if j.get('code') != 'Ok':
                    raise RuntimeError(str(j.get('code') or j)[:120])
                for k, row, src in zip(chunk, j['distances'], j['sources']):
                    cache['route'][k] = {'distances': row, 'snap_m': src.get('distance'), 'fetched_at': stamp}
                break
            except Exception as ex:  # noqa: BLE001
                err = str(ex)[:160]
                time.sleep(20 * (attempt + 1))  # 遇到 429／逾時就退避，不硬撞
        else:
            for k in chunk:
                cache['route'][k] = {'error': err, 'fetched_at': stamp}
        save_cache(cache)
        print(f'  routed batch {i // batch + 1}: {len(chunk)} points', flush=True)
        time.sleep(6)


def route_to_exits(lat, lng, cache):
    """OSM 步行路網（routing.openstreetmap.de, foot profile）到六個出入口的路徑距離（讀快取；需先 prefetch_routes）。"""
    key = _key(lat, lng)
    if key not in cache['route']:
        prefetch_routes([(lat, lng)], cache)
    r = cache['route'][key]
    if 'error' in r:
        return None
    ds = [(d if d is not None else 1e12) for d in r['distances']]
    best = min(range(len(EXITS)), key=lambda i: ds[i])
    if ds[best] >= 1e12:
        return None
    snap = r.get('snap_m') or 0
    d = ds[best] + snap  # 起點吸附到路網的距離也算進去
    return {'exit_no': EXITS[best]['no'], 'exit_desc': EXITS[best]['desc'], 'walk_m': round(d, 1),
            'all_exits_m': {e['no']: (round(x + snap, 1) if x < 1e12 else None) for e, x in zip(EXITS, ds)},
            'fetched_at': r['fetched_at']}


def geocode_road(addr, cache):
    """僅在平台未提供座標時使用：以 Nominatim 查「路段」的概略位置（不是門牌）。"""
    q = re.sub(r'\d+(?:之\d+)?號.*$', '', addr or '').strip()
    if not q:
        return None
    if q not in cache['geocode']:
        url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': q, 'format': 'json', 'limit': 1, 'countrycodes': 'tw'})
        try:
            j = http_json(url)
            cache['geocode'][q] = {'lat': float(j[0]['lat']), 'lng': float(j[0]['lon']), 'display': j[0]['display_name'], 'bbox': j[0].get('boundingbox')} if j else {'none': True}
        except Exception as ex:  # noqa: BLE001
            cache['geocode'][q] = {'error': str(ex)}
        save_cache(cache)
        time.sleep(1.2)
    g = cache['geocode'][q]
    return g if 'lat' in g else None


def norm_floor(v):
    """樓層字串正規化：'11樓'、'11F'、'１１' → '11'；'B1~3'、'B1-3' → 'B1-3'；'1~2' → '1-2'。"""
    if v is None:
        return None
    t = str(v).translate(str.maketrans('０１２３４５６７８９', '0123456789')).strip().upper()
    t = re.sub(r'樓|層|F|\s', '', t)
    t = re.sub(r'地下', 'B', t)
    t = re.sub(r'[~～–—至]', '-', t)
    if re.match(r'^-\d+$', t):
        t = 'B' + t[1:]
    m = re.match(r'^(\d+)(?:\.0+)?$', t)
    return str(int(m.group(1))) if m else (t or None)


def floor_key(v):
    return norm_floor(v)


_SEG = {'1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '七'}


def norm_addr_text(s):
    """把「安和路1段」「信義路４段」統一成「安和路一段」，並去除縣市區。"""
    s = (s or '').translate(str.maketrans('０１２３４５６７８９', '0123456789'))
    s = re.sub(r'([路街道])([1-7])段', lambda m: m.group(1) + _SEG[m.group(2)] + '段', s)
    return re.sub(r'(台北市|臺北市|大安區|信義區|\s)', '', s)


def road_of(x):
    s = norm_addr_text(x.get('address_public'))
    m = re.match(r'(.+?(?:路|街|大道)(?:[一二三四五六七八九十]段)?)', s)
    return m.group(1) if m else s[:5]


SINGLE_BROKER = {'sinyi', 'yungching', 'cthouse', 'pacific', 'etwarm'}  # 直營體系：通常同一戶不會用兩個編號、兩種價格刊登（有例外，以 data/manual_merge.json 覆寫）


def same_unit(a, b):
    """回傳 ('same'|'suspect'|'distinct'|None, 說明)。
    證據：樓層、總樓層、主建物、總坪、土地持分、開價、路段／社區／座標。
    平台常見的口徑差異：主建物未拆分（＝總坪）、主建物含陽台或地下室、總坪含不含車位、樓層寫法不同。"""
    fa, fb = floor_key(a.get('floor')), floor_key(b.get('floor'))
    ta, tb = num(a.get('total_floors')), num(b.get('total_floors'))
    if ta is not None and tb is not None and ta != tb:
        return None, ''

    def base_floor(f, total):
        # 「7-8／7」這類寫法（頂樓＋加蓋層）：上界超過總樓層時，以登記樓層（下界）比對
        m = re.match(r'^(\d+)-(\d+)$', f or '')
        if m and total and int(m.group(2)) > total:
            return m.group(1)
        return f
    fa, fb = base_floor(fa, ta or tb), base_floor(fb, tb or ta)
    ma, mb = num(a.get('area_main_ping')), num(b.get('area_main_ping'))
    za, zb = num(a.get('area_total_ping')), num(b.get('area_total_ping'))
    la, lb = num(a.get('area_land_ping')), num(b.get('area_land_ping'))
    pa, pb = num(a.get('price_wan')), num(b.get('price_wan'))
    ra, rb = road_of(a), road_of(b)
    very_near = False
    if all(num(v) is not None for v in (a.get('lat'), a.get('lng'), b.get('lat'), b.get('lng'))):
        very_near = haversine(a['lat'], a['lng'], b['lat'], b['lng']) <= 60
    loc = (bool(ra) and ra == rb) or (bool(a.get('community')) and a.get('community') == b.get('community')) or very_near
    dm = abs(ma - mb) if ma is not None and mb is not None else None
    dz = abs(za - zb) if za is not None and zb is not None else None
    dp = abs(pa - pb) / max(pa, pb) if pa and pb else None
    main_exact, main_close = dm is not None and dm <= 0.021, dm is not None and dm <= 0.1
    tot_exact, tot_close = dz is not None and dz <= 0.06, dz is not None and dz <= 0.2
    price_exact, price_close = dp is not None and dp <= 0.005, dp is not None and dp <= 0.03
    land_exact = la is not None and lb is not None and la > 0 and abs(la - lb) <= 0.02
    pk = num(a.get('area_parking_ping')) or num(b.get('area_parking_ping')) or 0
    tot_parking = dz is not None and pk and abs(dz - pk) <= 0.1
    floors_known = fa is not None and fb is not None
    floors_same = floors_known and fa == fb
    verdict, why = None, ''

    if floors_known and not floors_same:
        # 樓層不同：通常是不同戶；但其餘全部吻合時，可能是某平台樓層登錄錯誤 → 只標疑似
        if loc and tot_exact and land_exact and (main_exact or dm is None) and dp is not None and dp <= 0.05:
            return 'suspect', f'樓層各平台不一致（{fa}／{fb}），但總坪、土地持分相同且開價相近：可能是同一戶（樓層登錄錯誤）或同棟上下樓層，需向房仲確認'
        return None, ''

    if not floors_known:
        # 一方沒有樓層：需要更強的證據
        if tot_exact and land_exact and price_exact and loc:
            return 'same', '一個平台未揭露樓層；總坪、土地持分、開價完全相同且位置吻合'
        if tot_exact and price_close and loc:
            return 'suspect', '一個平台未揭露樓層；總坪相同、開價相近'
        return None, ''

    if main_exact and tot_exact and (loc or price_exact):
        verdict, why = 'same', '樓層、主建物、總坪相同'
    elif main_exact and price_exact and loc:
        verdict, why = 'same', '樓層、主建物、開價相同（總坪差異推定為車位或共有部分口徑不同）'
    elif main_exact and tot_parking and loc:
        verdict, why = 'same', '樓層、主建物相同；總坪差額等於車位坪數'
    elif dm is None and tot_exact and price_close and loc:
        verdict, why = 'same', '樓層、總坪相同且開價相近（其中一個平台未揭露主建物）'
    elif main_close and tot_close and price_close and loc:
        verdict, why = 'same', '樓層相同；主建物與總坪僅有小數差異、開價相近（平台登載差異）'
    elif tot_exact and price_close and loc and (land_exact or (ma is not None and za is not None and abs(ma - za) <= 0.02) or (mb is not None and zb is not None and abs(mb - zb) <= 0.02)):
        verdict, why = 'same', '樓層、總坪相同且開價相近' + ('、土地持分相同' if land_exact else '') + '；主建物數字不同是因為其中一個平台未拆分或把陽台／地下室併入主建物'
    elif main_exact and loc:
        verdict, why = 'suspect', '同樓層、主建物相同，但總坪與開價不同'
    elif loc and (tot_close or land_exact) and dp is not None and dp <= 0.05:
        verdict, why = 'suspect', '同樓層，總坪或土地持分相同、開價相近，但主建物數字不同'
    elif dm is None and tot_exact and loc:
        verdict, why = 'suspect', '同樓層、總坪相同，但缺主建物且開價不同'
    if verdict and a.get('platform') == b.get('platform') and a.get('platform') in SINGLE_BROKER and str(a.get('object_no')) != str(b.get('object_no')) and not price_exact:
        return 'distinct', '同一直營平台以不同編號、不同價格刊登 → 規則判定為同樓層的不同戶（未經人工複核）'
    return verdict, why


def derive_parking(items):
    """回傳 has_parking(True/False/None), includes, must_buy, price, type, text"""
    has, includes, must, price, ptype, texts, ppings, small_shelter = None, None, None, None, None, [], [], []
    rent_note = None
    for x in items:
        t = ' '.join(str(x.get(k) or '') for k in ('parking_type', 'parking_text'))
        if x.get('parking_text'):
            ptxt = str(x.get('parking_text'))
            if ptxt.strip().startswith('{'):
                ptxt = '無車位（平台欄位 isParking=false）' if re.search(r'"isParking"\s*:\s*false', ptxt) else '有車位（平台欄位，細節未揭露）'
            texts.append(f"{x.get('platform_name')}：{ptxt}")
        pp = num(x.get('area_parking_ping'))
        explicit = x.get('price_includes_parking') is True or num(x.get('parking_price_wan')) or re.search(r'平面|機械|坡道|升降|塔式|車位[:：]?\s*有|含車位|\d\s*個', t)
        if pp and pp < 4 and not explicit:
            pp = None  # 小於 4 坪且無任何車位說明：多為「防空避難室兼停車場」共有持分，不是可用車位
            small_shelter.append(num(x.get('area_parking_ping')))
        if pp and pp > 0:
            ppings.append(pp)
        yes = (pp and pp > 0) or x.get('price_includes_parking') is True or num(x.get('parking_price_wan')) or re.search(r'平面|機械|坡道|升降|塔式|車位[:：]?\s*有|含車位', t)
        no = re.search(r'無車位|車位[:：]?\s*無|^無$|沒有車位|未列車位|車位[:：]?\s*--', t.strip()) or (str(x.get('parking_type') or '').strip() == '無')
        if yes and not (no and not pp):
            has = True
        elif no and has is None:
            has = False
        if x.get('price_includes_parking') is not None and includes is None:
            includes = x.get('price_includes_parking')
        if x.get('parking_must_buy') is not None and must is None:
            must = x.get('parking_must_buy')
        if num(x.get('parking_price_wan')) and price is None:
            price = num(x.get('parking_price_wan'))
        pt = str(x.get('parking_type') or '').strip()
        if pt and pt != '無' and ptype is None and not re.search(r'可租|承租|抽籤|登記使用|租用', pt):
            ptype = pt
        if re.search(r'可租|承租|抽籤|登記使用|租用', pt):
            rent_note = '社區車位為「' + pt + '」：是承租或抽籤使用，不是隨屋移轉的產權車位'
    if has is False:
        includes, must, price = None, None, None
    return has, includes, must, price, ptype, '；'.join(dict.fromkeys(texts)) or None, (ppings[0] if ppings else None), (small_shelter[0] if small_shelter else None), rent_note


def main():
    cache = load_cache()
    raw = []
    for d in PLATFORM_DIRS:
        p = os.path.join(RAW, d, 'listings.json')
        if os.path.exists(p):
            items = json.load(open(p, encoding='utf-8'))
            for it in items:
                it['_dir'] = d
                it['platform_name'] = PLATFORM_NAMES.get(it.get('platform'), it.get('platform_name'))
                for k in ('area_aux_ping', 'area_common_ping', 'area_parking_ping', 'area_land_ping', 'area_main_ping', 'area_total_ping'):
                    if num(it.get(k)) == 0:
                        it[k] = None  # 平台以 0 或「--」表示未揭露 → 一律視為缺值
                it['floor'], it['total_floors'] = norm_floor(it.get('floor')), norm_floor(it.get('total_floors'))
                if it.get('platform') in COORD_NOT_USED:
                    it['lat'] = it['lng'] = None
                    it['coord_source'] = None
                    it['location_precision'] = 'road_only'
            raw.extend(items)
            print(f'{d}: {len(items)}')
    print('total raw listings', len(raw))

    seen, listings, dropped = set(), [], []
    for it in raw:
        k = f"{it.get('platform')}:{it.get('object_no')}"
        if k in seen or not it.get('source_url') or not it.get('object_no'):
            continue
        seen.add(k)
        ptype = str(it.get('property_type') or '') + str(it.get('property_type_raw') or '')
        if NON_RES_TYPE.search(ptype) or re.search(r'持分|店面|辦公室$|車位$', str(it.get('title') or '')) and not re.search(r'宅|房|樓', str(it.get('title') or '')):
            dropped.append((k, '非住宅類型'))
            continue
        listings.append(it)
    print('after type filter', len(listings), 'dropped', len(dropped))

    parent = list(range(len(listings)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    suspects, distinct_pairs, merge_why = [], [], {}
    for i in range(len(listings)):
        for j in range(i + 1, len(listings)):
            r, why = same_unit(listings[i], listings[j])
            if r == 'distinct':
                distinct_pairs.append((i, j))
    blocked = set()
    for i, j in distinct_pairs:
        blocked.add((i, j))
    for i in range(len(listings)):
        for j in range(i + 1, len(listings)):
            r, why = same_unit(listings[i], listings[j])
            if r == 'same':
                # 不把已判定為不同戶的兩筆間接串在一起
                gi = [k for k in range(len(listings)) if find(k) == find(i)]
                gj = [k for k in range(len(listings)) if find(k) == find(j)]
                if any((min(x, y), max(x, y)) in blocked for x in gi for y in gj):
                    suspects.append((i, j, why))
                    continue
                parent[find(j)] = find(i)
                merge_why[(i, j)] = why
            elif r == 'suspect':
                suspects.append((i, j, why))
    # 人工合併（深度查核後確認為同一戶、但規則判為不同戶者）
    mm_path = os.path.join(DATA, 'manual_merge.json')
    manual_notes = {}
    if os.path.exists(mm_path):
        key_idx = {f"{x.get('platform')}:{x.get('object_no')}": i for i, x in enumerate(listings)}
        for g in json.load(open(mm_path, encoding='utf-8')).get('groups', []):
            idxs = [key_idx[k] for k in g['keys'] if k in key_idx]
            for j in idxs[1:]:
                parent[find(j)] = find(idxs[0])
            for k in g['keys']:
                manual_notes[k] = g.get('note')
    groups = {}
    for i in range(len(listings)):
        groups.setdefault(find(i), []).append(i)
    print('unique units after merge', len(groups), '| suspect pairs', len(suspects))

    reg_path = os.path.join(DATA, 'id_registry.json')
    reg = json.load(open(reg_path, encoding='utf-8')) if os.path.exists(reg_path) else {'next': 1, 'map': {}}

    def assign_id(keys):
        found = sorted(reg['map'][k] for k in keys if k in reg['map'])
        pid = found[0] if found else None
        if pid is None:
            pid = f"XA-{reg['next']:03d}"
            reg['next'] += 1
        for k in keys:
            reg['map'][k] = pid  # 人工合併後，舊編號一律指向保留的 ID
        return pid

    def completeness(x):
        return sum(x.get(k) is not None for k in ('area_main_ping', 'area_aux_ping', 'area_common_ping', 'lat', 'mgmt_fee_text', 'registered_use', 'community', 'completion_date'))

    prefetch_routes([(x['lat'], x['lng']) for x in listings if num(x.get('lat')) and num(x.get('lng'))], cache)
    ordered = sorted(groups.values(), key=lambda g: min(f"{listings[i].get('platform')}:{listings[i].get('object_no')}" for i in g))
    idx_pid, props = {}, []
    for g in ordered:
        items = sorted([listings[i] for i in g], key=completeness, reverse=True)
        prim = items[0]
        pid = assign_id([f"{x.get('platform')}:{x.get('object_no')}" for x in items])
        for i in g:
            idx_pid[i] = pid

        def first(k, items=items):
            for x in items:
                v = x.get(k)
                if v is not None and v != '' and v != []:
                    return v
            return None

        # 位置：每個有座標的刊登各算一次路由，取中位數（各平台座標偏移不同）
        ests = []
        for x in items:
            la, ln = num(x.get('lat')), num(x.get('lng'))
            if la and ln:
                r = route_to_exits(la, ln, cache)
                if r:
                    ests.append((r['walk_m'], r, x))
        loc = {'lat': None, 'lng': None, 'precision': 'district_only', 'precision_note': None, 'nearest_exit': None, 'nearest_exit_desc': None, 'walk_m': None, 'walk_min': None,
               'walk_method': None, 'straight_m': None, 'platform_walk_claim': None, 'borderline': False, 'all_exits_m': None, 'estimates': []}
        if ests:
            ests.sort(key=lambda t: t[0])
            wm, r, x = ests[len(ests) // 2] if len(ests) % 2 else ests[len(ests) // 2 - 1]
            loc.update({'lat': x['lat'], 'lng': x['lng'], 'precision': 'platform_coord', 'nearest_exit': r['exit_no'], 'nearest_exit_desc': r['exit_desc'], 'walk_m': wm,
                        'walk_min': math.ceil(wm / WALK_M_PER_MIN * 2) / 2, 'all_exits_m': r['all_exits_m'],
                        'walk_method': '地圖估算：OpenStreetMap 步行路網路由（routing.openstreetmap.de，foot profile），起點＝' + x.get('platform_name', '') + '刊登頁提供的物件座標，終點＝官方出入口座標；時間＝路徑距離÷80 公尺/分，不含等紅燈',
                        'precision_note': '房仲平台不公開門牌，座標可能經過偏移；' + ('%d 個平台座標的估算範圍 %d–%d 公尺' % (len(ests), ests[0][0], ests[-1][0]) if len(ests) > 1 else '僅一個平台提供座標'),
                        'straight_m': round(min(haversine(x['lat'], x['lng'], e['lat'], e['lng']) for e in EXITS), 0)})
            loc['estimates'] = [{'platform_name': t[2].get('platform_name'), 'walk_m': t[0], 'exit': t[1]['exit_no']} for t in ests]
            mins = [math.ceil(t[0] / WALK_M_PER_MIN * 2) / 2 for t in ests]
            loc['borderline'] = any(9 <= m <= 11 or 14 <= m <= 16 for m in mins) or (min(mins) <= 10 < max(mins)) or (min(mins) <= 15 < max(mins))
        else:
            addr_has_road = bool(re.search(r'路|街|大道', norm_addr_text(max([x.get('address_public') or '' for x in items], key=len))))
            g2 = geocode_road(first('address_public'), cache) if addr_has_road else None
            if not addr_has_road:
                loc.update({'precision': 'district_only', 'precision_note': '刊登頁只揭露行政區，沒有路段與可用座標；無法估算步行時間'})
            if g2:
                r = route_to_exits(g2['lat'], g2['lng'], cache)
                loc.update({'lat': g2['lat'], 'lng': g2['lng'], 'precision': 'road_only', 'precision_note': '沒有可用的物件座標；以 Nominatim 查得「路段」代表點（不是門牌），同一路段不同巷號可能相差數百公尺，步行時間僅為粗估', 'borderline': False})
                if r:
                    # 只有路段、沒有門牌或座標：路由結果只當「粗估」，不填入正式步行時間（避免把不可靠的數字當成已測量）
                    loc.update({'rough_walk_m': r['walk_m'], 'rough_walk_min': math.ceil(r['walk_m'] / WALK_M_PER_MIN * 2) / 2, 'rough_exit': r['exit_no'],
                                'walk_method': '無法估算：可用的公開資訊只有路段。僅提供「路段代表點（Nominatim）→ OSM 步行路網」的粗估供參考，誤差可達數百公尺；需取得門牌後重算或實走',
                                'straight_m': None})
        claims = [f"{x.get('platform_name')}：" + re.sub(r'[；;]\s*JSON\s*原值.*$', '', str(x.get('platform_walk_claim'))) for x in items if x.get('platform_walk_claim')]
        loc['platform_walk_claim'] = '；'.join(claims) or None

        has_p, inc_p, must_p, price_p, ptype, ptext, pping, shelter_ping, rent_note = derive_parking(items)
        main_p, aux_p = num(first('area_main_ping')), num(first('area_aux_ping'))
        total_p, common_p = num(first('area_total_ping')), num(first('area_common_ping'))
        # 來源優先：用「同一個」刊登的拆分，避免不同平台口徑混用
        def split_quality(x):
            m, z = num(x.get('area_main_ping')), num(x.get('area_total_ping'))
            if m is None:
                return -1
            q = 1
            if z is not None and m < z - 0.02:
                q += 2  # 主建物小於總坪：有真正拆分
            q += (num(x.get('area_aux_ping')) is not None) + (num(x.get('area_common_ping')) is not None) + bool(x.get('area_aux_detail'))
            return q
        cands = sorted([x for x in items if num(x.get('area_main_ping')) is not None], key=lambda x: (-split_quality(x), num(x.get('area_main_ping'))))
        if cands:
            area_src = cands[0]
            main_p, aux_p = num(area_src.get('area_main_ping')), num(area_src.get('area_aux_ping'))
            total_p, common_p = num(area_src.get('area_total_ping')), num(area_src.get('area_common_ping'))
        else:
            area_src = prim
        main_plus_aux = next((num(x.get('area_main_plus_aux_ping')) for x in items if num(x.get('area_main_plus_aux_ping'))), None)
        if aux_p is None:
            aux_p = next((num(x.get('area_aux_ping')) for x in items if num(x.get('area_aux_ping')) is not None), None)
        park_in_common = area_src.get('area_parking_in_common')
        if isinstance(park_in_common, str):
            park_in_common = True if park_in_common.lower().startswith('true') else False if park_in_common.lower().startswith('false') else None
        pping = num(area_src.get('area_parking_ping')) or pping
        # 總坪是否含車位：若 主+附+共+車 ≈ 總 → 含
        total_includes_parking = None
        if total_p and main_p is not None and pping:
            s = main_p + (aux_p or 0) + (common_p or 0)
            if abs(s + pping - total_p) <= 0.15:
                total_includes_parking = True
            elif abs(s - total_p) <= 0.15:
                total_includes_parking = False if not park_in_common else True
        common_ratio = None
        if common_p is not None and total_p:
            base = total_p - (pping if (pping and total_includes_parking and not park_in_common) else 0)
            cpure = common_p - (pping if (pping and park_in_common) else 0)
            if base > 0 and cpure >= 0:
                common_ratio = round(cpure / base, 4)

        ages = sorted(num(x.get('age_years')) for x in items if num(x.get('age_years')) is not None)
        age_val = (statistics.median_low(ages) if ages else None)
        age_note = ('各平台屋齡不一致（' + '、'.join(f'{a:g}' for a in ages) + ' 年），採中位數；需以謄本建築完成日確認') if ages and ages[-1] - ages[0] > 3 else None
        ptype_txt = first('property_type')
        elevator = first('elevator')
        if elevator is None and ptype_txt:
            elevator = True if re.search(r'電梯|大樓|華廈', ptype_txt) else (False if '公寓' in ptype_txt else None)
        uses = list(dict.fromkeys(str(x.get('registered_use')).strip() for x in items if x.get('registered_use') and not re.search(r'詳見|謄本或使照|^--$', str(x.get('registered_use')))))
        reg_use = ' ／ '.join(uses) or None
        residential_ok, res_note = True, None
        bad_uses = [u for u in uses if MIXED_USE.search(u)]
        if bad_uses:
            residential_ok, res_note = None, f"登記用途含非純住家項目（{'、'.join(bad_uses)}）：能否作住宅使用、貸款成數與稅率需另行確認；不列入優先看屋"
        elif not reg_use:
            res_note = '刊登頁未揭露謄本登記用途（平台分類為住宅）；需以謄本確認為「住家用」'
        blob = ' '.join(str(v) for x in items for v in ([x.get('title')] + list(x.get('flags') or []) + list(x.get('features_claimed') or [])) if v)
        if re.search(r'地上權|租賃權|權利型態|使用權住宅|無土地持分', blob):
            residential_ok, res_note = False, '刊登資料顯示為地上權／租賃權等非一般所有權產品，不是一般完整產權住宅'
        elif 'B' in str(first('floor') or '') and residential_ok is True:
            residential_ok, res_note = None, '本戶含地下層（' + str(first('floor')) + ' 樓）：地下層多登記為防空避難室／儲藏室／店鋪，是否為一般住宅需以謄本確認'
        suite_flag = bool(re.search(r'隔套|分租套房|(?:[3-9]|\d{2})\s*間?套房|套房收租|收租套房|收租透天|隔成.{0,4}套', blob))
        doubt, unsplit_note = None, None
        if ptype_txt and '公寓' in ptype_txt and elevator is not True and main_p is not None and MIN_PING <= main_p < 30 and not (common_p and common_p > 0.5):
            doubt = '無電梯公寓且刊登頁無共有部分：樓梯間可能已計入主建物登記面積，扣除後可能低於 26 坪，需調閱謄本與建物測量成果圖核對'
        if main_p is not None and total_p is not None and abs(main_p - total_p) <= 0.02 and not aux_p and not common_p:
            if main_p < 40:
                doubt = f'刊登頁的主建物等於總建坪（{main_p:g} 坪），沒有附屬建物與共有部分的拆分：平台可能未拆分陽台、樓梯間或公設，主建物實際數字需以謄本確認'
            else:
                unsplit_note = f'刊登頁的主建物等於總建坪（{main_p:g} 坪），未拆分陽台或公設；即使扣除仍應高於 26 坪，但實際數字需以謄本確認'
        fl = str(first('floor') or '')
        if 'B' in fl and main_p is not None:
            doubt = (doubt + '；' if doubt else '') + f'本戶含地下層（{fl} 樓）：部分平台把獨立權狀地下室併入主建物，地面層主建物需以謄本確認；地下室不應視為一般居住室內面積'
        if area_src.get('area_main_ping') is None:
            doubt = None

        stage, stage_note = first('product_stage') or '中古屋', None
        if age_val is not None and age_val <= 0.05 and not num(first('rooms')):
            stage, stage_note = '預售屋', '平台屋齡 0 年且格局未填；同建案在實價登錄為預售交易 → 列為預售屋。預計交屋時間刊登頁未揭露（建案層級的完工資訊見「市場與社區」頁的預售表）'
        elif stage == '預售屋':
            stage_note = '預計交屋時間刊登頁未揭露，需向代銷或建商確認'
        fl_n, tf_n = num(first('floor')) if re.match(r'^\d+$', str(first('floor') or '')) else None, num(first('total_floors'))
        over_floor_note = '刊登樓層高於總樓層：可能含頂樓增建層，增建不計入坪數' if (fl_n and tf_n and fl_n > tf_n) else None
        ill = '；'.join(dict.fromkeys(str(x.get('illegal_addition_mention')) for x in items if x.get('illegal_addition_mention'))) or None
        lay_note = first('layout_note')
        flags = list(dict.fromkeys(f for x in items for f in (x.get('flags') or []) if isinstance(f, str)))
        claims_all = list(dict.fromkeys(c for x in items for c in (x.get('features_claimed') or []) if isinstance(c, str)))[:10]

        lst = [{'platform': x.get('platform'), 'platform_name': x.get('platform_name'), 'url': x.get('source_url'), 'object_no': str(x.get('object_no')), 'title': x.get('title'),
                'price_wan': num(x.get('price_wan')), 'price_original_wan': num(x.get('price_original_wan')), 'fetched_at': x.get('fetched_at'), 'first_listed': x.get('first_listed'),
                'listing_updated': x.get('listing_updated'), 'raw_html_path': x.get('raw_html_path')} for x in items]
        lst.sort(key=lambda l: (l['platform'] or '', l['object_no']))
        prices = [l['price_wan'] for l in lst if l['price_wan']]

        def fs(label, key, fmt=lambda v: v):
            vals = []
            for l in lst:
                x = next(i for i in items if str(i.get('object_no')) == l['object_no'] and i.get('platform') == l['platform'])
                v = x.get(key)
                vals.append(None if v is None or v == '' else str(fmt(v)))
            return {'label': label, 'values': vals}
        field_sources = {
            'price': fs('刊登總價（萬）', 'price_wan'), 'main': fs('主建物（坪）', 'area_main_ping'), 'aux': fs('附屬建物（坪）', 'area_aux_ping'), 'aux_detail': fs('附屬建物組成', 'area_aux_detail'),
            'common': fs('共有部分（坪）', 'area_common_ping'), 'parking_area': fs('車位面積（坪）', 'area_parking_ping'), 'total': fs('權狀／建物總坪', 'area_total_ping'),
            'parking': fs('車位說明', 'parking_text', lambda v: ('無車位（平台欄位 isParking=false）' if re.search(r'"isParking"\s*:\s*false', str(v)) else '有車位（平台欄位，細節未揭露）') if str(v).strip().startswith('{') else v), 'floor': fs('樓層', 'floor'), 'total_floors': fs('總樓層', 'total_floors'), 'age': fs('屋齡（年）', 'age_years'),
            'use': fs('登記用途', 'registered_use'), 'mgmt': fs('管理費', 'mgmt_fee_text'), 'community': fs('社區', 'community'), 'address': fs('公開地址', 'address_public'),
        }
        dup_note = None
        mnote = next((manual_notes[f"{l['platform']}:{l['object_no']}"] for l in lst if f"{l['platform']}:{l['object_no']}" in manual_notes), None)
        if len(lst) > 1:
            whys = list(dict.fromkeys(w for (i2, j2), w in merge_why.items() if i2 in g and j2 in g))
            dup_note = '判定為同一戶的依據：' + '；'.join(whys or ['樓層、面積、位置吻合']) + f'。共 {len(lst)} 筆刊登' + (f'，開價 {min(prices):g}～{max(prices):g} 萬不一致（可能是含／不含車位的不同銷售組合，或各店委託價不同），全部保留。' if prices and min(prices) != max(prices) else '，開價一致。')

        addrs = [x.get('address_public') for x in items if x.get('address_public')]
        best_addr = max(addrs, key=lambda t: len(norm_addr_text(t))) if addrs else None
        if best_addr:
            best_addr = re.sub(r'[^\s市區]*里\d+鄰', '', best_addr)
        mains = sorted(set(round(num(x.get('area_main_ping')), 4) for x in items if num(x.get('area_main_ping')) is not None))
        main_note = None
        if len(mains) > 1 and mains[-1] - mains[0] <= 0.021:
            main_p = mains[0]  # 四捨五入差異：取較小者，不另外提示
        elif len(mains) > 1:
            main_note = '各平台主建物數字不一致（' + '、'.join(f'{m:g}' for m in mains) + ' 坪），以較小者判斷'
            main_p = mains[0]
            if mains[0] < MIN_PING <= mains[-1]:
                doubt = (doubt + '；' if doubt else '') + main_note + '，且跨過 26 坪門檻，需以謄本確認'
        name = first('community') or prim.get('title')
        title = prim.get('title') or ''
        disp = (first('community') + '｜' if first('community') else '') + title
        props.append({
            'id': pid, 'name': disp[:40], 'title': title, 'community': first('community'), 'address_public': best_addr, 'district': first('district'),
            'street_position': None, 'amenities': None, 'suite_rental_flag': suite_flag,
            'property_type': ptype_txt, 'registered_use': reg_use, 'residential_ok': residential_ok, 'residential_note': res_note, 'product_stage': stage, 'stage_note': stage_note,
            'rooms': num(first('rooms')), 'halls': num(first('halls')), 'baths': num(first('baths')), 'layout_text': first('layout_text'), 'layout_note': lay_note,
            'floor': first('floor'), 'total_floors': first('total_floors'), 'age_years': age_val, 'age_note': age_note, 'completion_date': (first('completion_date') if not age_note else None), 'elevator': elevator,
            'structure': first('structure'), 'management': first('management'), 'mgmt_fee_text': first('mgmt_fee_text'), 'mgmt_fee_monthly': num(first('mgmt_fee_monthly')), 'facing': first('facing'),
            'price': {'listing_price_wan': max(prices) if prices else None, 'has_parking': has_p, 'includes_parking': inc_p, 'parking_must_buy': must_p, 'parking_price_wan': price_p,
                      'parking_type': ptype, 'parking_text': ptext, 'other_mandatory_wan': None, 'note': rent_note},
            'area': {'total_ping': total_p, 'main_ping': main_p, 'aux_ping': aux_p, 'aux_detail': area_src.get('area_aux_detail') or first('area_aux_detail'), 'common_ping': common_p,
                     'parking_ping': pping, 'land_ping': num(first('area_land_ping')), 'parking_in_common': park_in_common, 'total_includes_parking': total_includes_parking,
                     'common_ratio': common_ratio, 'raw_text': '\n'.join(f"【{x.get('platform_name')}】{x.get('area_raw_text')}" for x in items if x.get('area_raw_text')) or None, 'main_note': main_note or unsplit_note, 'doubt': doubt, 'main_plus_aux_ping': (main_plus_aux if main_p is None else None), 'shelter_share_ping': shelter_ping, 'estimated_main_ping': None, 'source_platform': area_src.get('platform_name')},
            'location': loc, 'listings': lst,
            'duplicates': {'merged_count': len(lst), 'suspected_with': [], 'note': (mnote or dup_note)},
            'availability_status': STATUS_TEXT, 'claims': claims_all, 'illegal_addition_mention': ill, 'photo_observations': first('photo_observations'),
            'flags': flags + ([over_floor_note] if over_floor_note else []), 'field_sources': field_sources, 'screenshots': [], 'facts': [], 'inferences': [], 'analysis': {}, 'comps': {},
        })
    for i, j in distinct_pairs:
        a, b = idx_pid[i], idx_pid[j]
        if a != b:
            for x, y in ((a, b), (b, a)):
                px = next(p for p in props if p['id'] == x)
                px['duplicates'].setdefault('auto_distinct', [])
                if y not in px['duplicates']['auto_distinct']:
                    px['duplicates']['auto_distinct'].append(y)
    plat = {p['id']: {l['platform'] for l in p['listings']} for p in props}
    for i, j, swhy in suspects:
        a, b = idx_pid[i], idx_pid[j]
        if a != b and '樓層各平台不一致' in swhy and (plat[a] & plat[b]):
            continue  # 同一個平台同時刊登這兩個樓層 → 是同棟不同樓層的兩戶，不是樓層登錄錯誤
        if a != b and b in (next(p for p in props if p['id'] == a)['duplicates'].get('auto_distinct') or []):
            continue
        if a != b:
            pa = next(p for p in props if p['id'] == a)
            pb = next(p for p in props if p['id'] == b)
            if b not in pa['duplicates']['suspected_with']:
                pa['duplicates']['suspected_with'].append(b)
            if a not in pb['duplicates']['suspected_with']:
                pb['duplicates']['suspected_with'].append(a)
            for px, other in ((pa, b), (pb, a)):
                notes = px['duplicates'].setdefault('suspected_notes', [])
                t = f'與 {other}：{swhy}'
                if t not in notes:
                    notes.append(t)

    json.dump(reg, open(reg_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump({'props': props, 'dropped': dropped, 'raw_count': len(raw), 'listing_count': len(listings)}, open(os.path.join(RAW, '_merged_stage1.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('stage1 written:', len(props), 'units')


if __name__ == '__main__':
    main()
