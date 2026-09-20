#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""research_raw/area/area_research.json → data/area.json（網站用的精簡結構）"""
import json, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
src = json.load(open(os.path.join(ROOT, 'research_raw', 'area', 'area_research.json'), encoding='utf-8'))


def first_url(x):
    if x.get('source_url'):
        return x['source_url']
    s = x.get('sources') or []
    return s[0]['url'] if s else None


renewal = []
for r in src.get('renewal_cases', []):
    renewal.append({'name': r.get('name'), 'location': r.get('location'), 'stage_category': r.get('stage_category'), 'detail': r.get('detail'),
                    'source_url': first_url(r), 'accessed': r.get('accessed'), 'micro_area': r.get('micro_area'), 'kind': '都更／危老'})
devs = []
for r in src.get('developments', []):
    devs.append({'name': r.get('name'), 'location': r.get('relevance'), 'stage_category': r.get('category') or '周邊開發', 'detail': r.get('status'),
                 'source_url': first_url(r), 'accessed': (r.get('sources') or [{}])[0].get('accessed'), 'kind': '周邊開發', 'sources': r.get('sources')})
costs = [{'item': t.get('item'), 'rule': t.get('rule'), 'payer': t.get('payer'), 'official': t.get('official'), 'source_url': first_url(t), 'sources': t.get('sources')} for t in src.get('transaction_costs', [])]
out = {'meta': src.get('meta'), 'micro_areas': src.get('micro_areas'), 'area_wide_notes': src.get('area_wide_notes'), 'renewal_cases': renewal, 'renewal_notes': src.get('renewal_notes'),
       'developments': devs, 'market_stats': src.get('market_stats'), 'transaction_costs': costs}
json.dump(out, open(os.path.join(ROOT, 'data', 'area.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('area.json', len(renewal), 'renewal', len(devs), 'developments', len(costs), 'costs', len(out['micro_areas']), 'micro areas')
