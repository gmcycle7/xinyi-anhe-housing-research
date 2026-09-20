#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""research_raw/verify/<ID>.json（逐間深度查核結果）→ data/analysis_overrides.json

- 只接受白名單欄位的更正；comp_ids 必須真的存在於實價登錄資料中。
- data/curation.json（主研究員的最終排序與理由）優先於查核 agent 的建議。
"""
import glob
import re
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lvr_lib  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..'))
ALLOWED_TOP = {'address_public', 'community', 'age_years', 'completion_date', 'registered_use', 'mgmt_fee_text', 'management', 'layout_note', 'facing',
               'street_position', 'amenities', 'illegal_addition_mention', 'residential_ok', 'residential_note', 'floor', 'total_floors', 'elevator', 'property_type', 'structure'}
ALLOWED_AREA = {'main_ping', 'aux_ping', 'aux_detail', 'common_ping', 'parking_ping', 'total_ping', 'doubt', 'land_ping'}
ALLOWED_PRICE = {'has_parking', 'includes_parking', 'parking_must_buy', 'parking_price_wan', 'parking_type', 'note'}

comp_ids = {c['id'] for c in map(lvr_lib.to_comp, lvr_lib.load_rows()) if c}
cur_path = os.path.join(ROOT, 'data', 'curation.json')
cur = json.load(open(cur_path, encoding='utf-8')) if os.path.exists(cur_path) else {}
BLOCKING = set(cur.get('area_doubt_blocking', []))
reg = json.load(open(os.path.join(ROOT, 'data', 'id_registry.json'), encoding='utf-8'))
valid_ids = set(reg['map'].values())


def tidy(x):
    """清掉查核員的內部作業語與『同批三間』這種對讀者沒有意義的比較語。"""
    if isinstance(x, str):
        x = re.sub(r'[（(，,]\s*(看完|看後)?已刪除[^）)。；]*[）)]?', lambda m: '）' if m.group(0).startswith(('（', '(')) and not m.group(0).endswith(('）', ')')) else ('' if not m.group(0).startswith(('（', '(')) else ''), x)
        x = x.replace('（）', '').replace('()', '')
        for a, b in (('三間之中，', '同批查核的三間之中，'), ('三間中', '同批查核的三間中'), ('三間裡', '同批查核的三間裡'), ('為三間最低', '為同批查核三間中最低')):
            x = x.replace(a, b)
        return x
    if isinstance(x, list):
        return [tidy(i) for i in x]
    if isinstance(x, dict):
        return {k: tidy(v) for k, v in x.items()}
    return x


out = {}
for f in sorted(glob.glob(os.path.join(ROOT, 'research_raw', 'verify', 'XA-*.json'))):
    v = tidy(json.load(open(f, encoding='utf-8')))
    raw_text = open(f, encoding='utf-8').read()
    pid = v['id']
    if pid not in valid_ids:
        print(pid, '已併入其他物件（不再是有效 ID），略過其查核檔')
        continue
    o = {}
    cor = v.get('corrections') or {}
    for k, val in cor.items():
        if k in ALLOWED_TOP:
            o[k] = val
        elif k == 'area' and isinstance(val, dict):
            o['area'] = {kk: (None if (kk in ('parking_ping', 'common_ping', 'land_ping') and vv == 0) else vv) for kk, vv in val.items() if kk in ALLOWED_AREA}
            if 'doubt' in o['area']:
                # 查核員的面積備註：只有研究員判定「會動搖主建物是否達 26 坪」者才當成阻擋性疑義，其餘作為說明
                note = o['area'].pop('doubt')
                if pid in BLOCKING:
                    o['area']['doubt'] = note
                else:
                    o['area']['doubt'] = None
                    o['area']['verify_note'] = note
        elif k == 'price' and isinstance(val, dict):
            o['price'] = {kk: vv for kk, vv in val.items() if kk in ALLOWED_PRICE}
    pr = o.get('price') or {}
    if pr.get('has_parking') is False and (pr.get('parking_price_wan') or pr.get('parking_type')):
        pr['has_parking'] = True
        pr.setdefault('includes_parking', False)
        print(pid, '一致性修正：有車位價或車位形式 → has_parking 改為 True')
    for k in ('street_position', 'amenities'):
        if v.get(k) and k not in o:
            o[k] = v[k]
    if v.get('claims'):
        o['claims'] = v['claims'][:10]
    if v.get('photo_observations'):
        o['photo_observations'] = v['photo_observations']
    sb = v.get('same_building_comps') or {}
    good = [c for c in (sb.get('comp_ids') or []) if c in comp_ids]
    bad = [c for c in (sb.get('comp_ids') or []) if c not in comp_ids]
    if bad:
        print(pid, 'WARNING comp ids not found, dropped:', bad)
    refs = [c for c in dict.fromkeys(re.findall(r'RP[A-Z0-9]{12,}', raw_text)) if c in comp_ids and c not in good]
    if sb.get('method'):
        o['comps'] = {'verified_refs': refs, 'same_building': good, 'same_building_note': f"比對方式：{sb.get('method')}。" + (sb.get('note') or '') + '（本物件已由研究員逐筆查核）'}
    pv = v.get('price_view') or {}
    an = {'reasons': v.get('reasons') or [], 'drawbacks': v.get('drawbacks') or [], 'missing': v.get('missing') or [], 'questions': v.get('questions') or [],
          'onsite_checks': v.get('onsite_checks') or [], 'headline_pro': v.get('headline_pro'), 'headline_con': v.get('headline_con'),
          'worth_visit_text': v.get('recommend_reason'), 'verify_recommend': v.get('recommend'), 'verified': True, 'verified_at': v.get('verified_at'),
          'risk_keywords': v.get('risk_keywords') or [], 'live_check': v.get('live_check') or [], 'field_check': v.get('field_check') or []}
    if pv.get('text'):
        an['price_view'] = {'text': pv['text'], 'caveats': pv.get('caveats') or [], 'premium_pct': pv.get('premium_pct_vs_median_or_single'), 'n': pv.get('n_clean'), 'basis': 'verified'}
    o['analysis'] = an
    out[pid] = o

for pid, c in (cur.get('properties') or {}).items():
    o = out.setdefault(pid, {})
    for k, v in c.items():
        if isinstance(v, dict):
            o.setdefault(k, {}).update(v)
        else:
            o[k] = v
json.dump(out, open(os.path.join(ROOT, 'data', 'analysis_overrides.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('overrides written for', len(out), 'properties')
