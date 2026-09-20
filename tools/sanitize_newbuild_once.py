#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性：把 research_raw/newbuild/projects.json（內含 591 來源的文字與座標）轉成只含「官方實價登錄＋可明確歸屬於非 591 來源」的
research_raw/newbuild/projects_clean.json，之後原檔移入隔離資料夾。欄位層級剔除：
- 座標、步行估算、公設比、591 開價、591 動態、591 網址：整欄捨棄。
- 完工時間／建商／銷售狀態：只保留字串中明確標示 PLEX 或媒體的片段；其餘寫「未取得」。
- 成交逐筆：來自內政部實價登錄開放資料，全部保留。"""
import json, os, re, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
src_path = os.path.join(ROOT, 'research_raw', 'newbuild', 'projects.json')
if not os.path.exists(src_path):
    sys.exit('原檔已隔離；projects_clean.json 已存在則不需重跑')
src = json.load(open(src_path, encoding='utf-8'))


def non591_segments(s):
    if not s:
        return None
    s = str(s)
    if '591' not in s:
        return s
    segs = re.split(r'[；;（）()]', s)
    keep = [x.strip() for x in segs if x.strip() and '591' not in x and re.search(r'PLEX|媒體|報導|建商官網|使用執照|使字|實登|實價登錄', x)]
    return '；'.join(keep) or None


out = []
for p in src:
    tx = [t for t in (p.get('presale_transactions') or []) if t.get('date')]
    addr = next((t.get('address_as_registered') for t in tx if t.get('address_as_registered')), None)
    urls = [u for u in (p.get('source_urls') or []) if '591.com.tw' not in u]
    out.append({'name': p.get('name'), 'stage': p.get('stage'), 'builder': non591_segments(p.get('builder')),
                'address_lvr': addr, 'expected_completion': non591_segments(p.get('expected_completion')),
                'sales_status': non591_segments(p.get('sales_status')), 'source_urls': urls,
                'transactions': [{k: t.get(k) for k in ('date', 'floor', 'total_floors', 'unit', 'main_use', 'rooms', 'total_price_wan', 'parking_price_wan', 'house_price_excl_parking_wan', 'total_area_ping', 'parking_area_ping',
                                                        'area_excl_parking_ping', 'main_building_ping', 'balcony_ping', 'unit_price_excl_parking_wan_per_ping', 'parking_type', 'note', 'cancellation', 'serial', 'source_file')} for t in tx]})
json.dump(out, open(os.path.join(ROOT, 'research_raw', 'newbuild', 'projects_clean.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
q = os.path.join(ROOT, 'research_raw', '_quarantine_591_not_used', 'newbuild_591')
os.makedirs(q, exist_ok=True)
os.rename(src_path, os.path.join(q, 'projects_with_591_content.json'))
for f in ('osrm_foot_routes_2026-09-20.json',):
    fp = os.path.join(ROOT, 'research_raw', 'newbuild', f)
    if os.path.exists(fp):
        os.rename(fp, os.path.join(q, f))
print('clean projects:', len(out), '| 591 strings left:', json.dumps(out, ensure_ascii=False).count('591'))
