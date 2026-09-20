#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""內政部實價登錄開放資料（臺北市買賣 a_lvr_land_a.csv）解析工具。

口徑說明（已用資料驗證）：
- 「附屬建物面積」與「陽台面積」是兩個獨立欄位（多數案件 陽台 > 附屬），
  因此 B 口徑的「主＋附」= 主建物面積 + 附屬建物面積 + 陽台面積。
- 共有部分 = 建物移轉總面積 − 主 − 附 − 陽台 − 車位移轉面積（車位面積不重複扣除）。
- 1 坪 = 3.305785 平方公尺。
"""
import csv
import glob
import os
import re

SQM_PER_PING = 3.305785
HERE = os.path.dirname(os.path.abspath(__file__))
LVR_DIR = os.path.join(HERE, '..', 'research_raw', 'lvr')

_FW = str.maketrans('０１２３４５６７８９', '0123456789')
_CN = {'零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}

RESIDENTIAL_TYPES = ('住宅大樓', '華廈', '公寓')

REMARK_FLAGS = [
    ('特殊關係', r'親友|員工|共有人|特殊關係|二親等|關係人'),
    ('含增建/未登記', r'增建|未登記|頂樓加蓋|頂加|夾層|外推'),
    ('持分/部分移轉', r'持分|部分移轉'),
    ('急售/債務', r'急買急賣|債權債務|債務'),
    ('瑕疵/事故', r'瑕疵|凶宅|非自然|海砂|輻射|傾斜|漏水'),
    ('毛胚/未裝修', r'毛胚'),
    ('含租約', r'租約|租賃'),
    ('地上權/承租土地', r'地上權|承租|租用.{0,4}土地|公有地'),
    ('重建/都更效益', r'重建|都更|都市更新'),
    ('預售/特殊計價', r'預售|毛胚'),
    ('政府/協議價購', r'政府機關|協議價購|標售|法拍|拍賣'),
    ('合建/地主戶', r'合建|地主|建商'),
    ('其他備註', r'.+'),
]


def cn_to_int(s):
    """中文數字（≤99）轉整數；失敗回傳 None。"""
    s = s.strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)
    if s == '十':
        return 10
    if '十' in s:
        a, _, b = s.partition('十')
        tens = _CN.get(a, 1) if a else 1
        ones = _CN.get(b, 0) if b else 0
        return tens * 10 + ones
    if all(ch in _CN for ch in s):
        v = 0
        for ch in s:
            v = v * 10 + _CN[ch]
        return v
    return None


def parse_floor(text):
    """移轉層次 → (樓層整數或 None, 原文, 是否多層/含地下)。"""
    raw = text or ''
    parts = [p for p in re.split(r'[，,、\s]+', raw) if p]
    floors = []
    basement = False
    for p in parts:
        if '地下' in p:
            basement = True
            continue
        m = re.match(r'^(.+?)層$', p)
        if m:
            v = cn_to_int(m.group(1))
            if v is not None:
                floors.append(v)
    if len(floors) == 1:
        return floors[0], raw, basement
    return None, raw, basement or len(floors) > 1


def parse_total_floors(text):
    m = re.match(r'^(.+?)層$', (text or '').strip())
    return cn_to_int(m.group(1)) if m else None


def roc_date(s):
    """民國年月日 1140315 → '2025-03-15'；失敗回傳 None。"""
    s = (s or '').strip()
    if not re.match(r'^\d{6,7}$', s):
        return None
    y, m, d = int(s[:-4]) + 1911, int(s[-4:-2]), int(s[-2:])
    if not (1 <= m <= 12 and 1 <= d <= 31):
        return None
    return f'{y:04d}-{m:02d}-{d:02d}'


def norm_addr(a):
    return (a or '').translate(_FW).replace('臺北市', '').replace('台北市', '').strip()


_ADDR_RE = re.compile(r'^(大安區|信義區)?(?P<road>.+?(?:路|街|大道)(?:[一二三四五六七八九十]段)?)(?P<lane>\d+巷)?(?P<alley>\d+弄)?(?P<no>\d+(?:之\d+)?號)?')


def split_addr(a):
    a = norm_addr(a)
    m = _ADDR_RE.match(a)
    if not m:
        return {'road': None, 'lane': None, 'alley': None, 'no': None, 'norm': a}
    d = m.groupdict()
    d['norm'] = a
    return d


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def load_rows(districts=('大安區', '信義區')):
    rows = []
    seen = set()
    files = sorted(glob.glob(os.path.join(LVR_DIR, 'a_1*.csv'))) + [os.path.join(LVR_DIR, 'a_current.csv')]
    for path in files:
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8-sig') as fh:
            r = csv.reader(fh)
            hdr = next(r)
            next(r)  # 英文欄名列
            for row in r:
                if len(row) < len(hdr):
                    continue
                d = dict(zip(hdr, row))
                if d['鄉鎮市區'] not in districts:
                    continue
                if d['編號'] in seen:
                    continue
                seen.add(d['編號'])
                d['_file'] = os.path.basename(path)
                rows.append(d)
    return rows


def to_comp(d):
    """把一列實價登錄資料轉成比較樣本（住宅、含建物）。不符合回傳 None。"""
    if '建物' not in d['交易標的']:
        return None
    btype = d['建物型態']
    if not btype.startswith(RESIDENTIAL_TYPES):
        return None
    total_sqm = f(d['建物移轉總面積平方公尺'])
    main_sqm = f(d['主建物面積'])
    aux_sqm = f(d['附屬建物面積'])
    bal_sqm = f(d['陽台面積'])
    park_sqm = f(d['車位移轉總面積平方公尺'])
    price = f(d['總價元'])
    park_price = f(d['車位總價元'])
    if total_sqm <= 0 or price <= 0:
        return None
    has_parking = '車位' in d['交易標的'] or park_sqm > 0 or park_price > 0
    # 車位拆分是否可用：有車位時必須同時有車位價與車位面積，才能算「扣車位」單價
    if not has_parking:
        split_ok = True
    else:
        split_ok = park_price > 0 and park_sqm > 0
    P = SQM_PER_PING
    total_p, main_p, aux_p, bal_p, park_p = (total_sqm / P, main_sqm / P, aux_sqm / P, bal_sqm / P, park_sqm / P)
    raw_common = total_p - main_p - aux_p - bal_p - park_p
    parking_anomaly = has_parking and raw_common < -0.2  # 車位面積大於「總−主−附−陽台」：車位可能登記在主建物內或未計入總面積
    if parking_anomaly:
        split_ok = False
    common_p = max(raw_common, 0.0)
    net_price_wan = (price - park_price) / 10000 if split_ok else None
    net_area_p = (total_p - park_p) if split_ok else None
    floor, floor_raw, multi = parse_floor(d['移轉層次'])
    tf = parse_total_floors(d['總樓層數'])
    tdate = roc_date(d['交易年月日'])
    built = roc_date(d['建築完成年月'])
    age = None
    if tdate and built:
        age = round((int(tdate[:4]) - int(built[:4])) + (int(tdate[5:7]) - int(built[5:7])) / 12, 1)
    remark = (d.get('備註') or '').strip()
    flags = []
    if remark:
        for name, pat in REMARK_FLAGS[:-1]:
            if re.search(pat, remark):
                flags.append(name)
        if not flags:
            flags.append('其他備註')
    if parking_anomaly:
        flags.append('車位面積口徑異常')
    if multi:
        flags.append('多層或含地下層移轉')
    if floor == 1:
        flags.append('一樓')
    if floor and tf and floor == tf:
        flags.append('頂樓')
    main_aux_p = main_p + aux_p + bal_p
    ad = split_addr(d['土地位置建物門牌'])
    comp = {
        'id': d['編號'],
        'district': d['鄉鎮市區'],
        'address': norm_addr(d['土地位置建物門牌']),
        'road': ad['road'], 'lane': ad['lane'], 'alley': ad['alley'], 'no': ad['no'],
        'trade_date': tdate,
        'target': d['交易標的'],
        'building_type': btype.split('(')[0],
        'main_use': d['主要用途'] or None,
        'floor': floor, 'floor_raw': floor_raw, 'total_floors': tf,
        'built_date': built, 'age_at_trade': age,
        'rooms': int(f(d['建物現況格局-房'])), 'halls': int(f(d['建物現況格局-廳'])), 'baths': int(f(d['建物現況格局-衛'])),
        'has_mgmt': d['有無管理組織'] == '有', 'elevator': {'有': True, '無': False}.get(d['電梯']),
        'price_wan': price / 10000,
        'parking_type': d['車位類別'] or None,
        'parking_price_wan': park_price / 10000 if park_price > 0 else None,
        'parking_ping': round(park_p, 4) if park_p > 0 else None,
        'has_parking': has_parking,
        'parking_split_ok': split_ok,
        'total_ping': round(total_p, 4),
        'main_ping': round(main_p, 4) if main_p > 0 else None,
        'aux_ping': round(aux_p + bal_p, 4) if main_p > 0 else None,
        'aux_other_ping': round(aux_p, 4), 'balcony_ping': round(bal_p, 4),
        'common_ping': round(common_p, 4) if main_p > 0 else None,
        'net_price_wan': round(net_price_wan, 2) if net_price_wan is not None else None,
        # 單價①：扣車位後建坪單價
        'unit_net_wan': round(net_price_wan / net_area_p, 2) if split_ok and net_area_p > 0 else None,
        # 單價②：扣車位後價格 ÷ 主建物
        'unit_main_wan': round(net_price_wan / main_p, 2) if split_ok and main_p > 0 else None,
        # 單價③：扣車位後價格 ÷（主＋附）
        'unit_main_aux_wan': round(net_price_wan / main_aux_p, 2) if split_ok and main_aux_p > 0 else None,
        # 含車位指標（車位無法拆分時僅能看這個；不可混入扣車位比較）
        'unit_gross_incl_parking_wan': round(price / 10000 / total_p, 2),
        'remark': remark or None,
        'flags': flags,
        'source_file': d['_file'],
        'source': '內政部不動產成交案件實際資訊資料供應系統（開放資料）',
    }
    return comp


if __name__ == '__main__':
    rows = load_rows()
    comps = [c for c in (to_comp(d) for d in rows) if c]
    print('rows', len(rows), 'residential comps', len(comps))
    print(comps[0])
