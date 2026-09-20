#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""由 data/*.json 產生 research_summary.md（離線可讀的完整文字版研究結果；數字全部由資料計算）。"""
import json
import os
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
J = lambda f: json.load(open(os.path.join(ROOT, 'data', f), encoding='utf-8'))
P = J('properties.json')
props, meta = P['properties'], P['meta']
ins = J('insights.json')
nb = J('newbuild.json')
comps = {c['id']: c for c in J('comparables.json')['comparables']}

# 與網站相同的判斷邏輯（呼叫 assets/logic.js），避免兩套邏輯不一致
node = r"""
const L=require('./assets/logic.js');const P=require('./data/properties.json').properties;
const out={};for(const p of P){const a=L.classify(p,{mode:'A'}),b=L.classify(p,{mode:'B'});out[p.id]={A:a.cls,B:b.cls,budget:a.budget.status,breason:a.budget.reason,areaA:a.area.A,areaB:a.area.B,label:a.area.label,mainAux:a.area.mainAux,walk:a.walk.zone,pend:a.pendings,fails:a.fails};}
console.log(JSON.stringify(out));
"""
C = json.loads(subprocess.run(['node', '-e', node], cwd=ROOT, capture_output=True, text=True, check=True).stdout)

nA = sum(1 for p in props if C[p['id']]['A'] == 'confirmed')
nB = sum(1 for p in props if C[p['id']]['A'] != 'confirmed' and C[p['id']]['B'] == 'confirmed')
nPend = sum(1 for p in props if C[p['id']]['A'] != 'confirmed' and C[p['id']]['B'] != 'confirmed' and 'pending' in (C[p['id']]['A'], C[p['id']]['B']))
nNot = len(props) - nA - nB - nPend
need_price = sum(1 for p in props if C[p['id']]['budget'] == 'unknown')
need_area = sum(1 for p in props if 'unknown' in (C[p['id']]['areaA'], C[p['id']]['areaB']))
need_loc = sum(1 for p in props if C[p['id']]['walk'] == 'unknown')
need_use = sum(1 for p in props if p.get('residential_ok') is None)
over = sum(1 for p in props if C[p['id']]['budget'] == 'over')


def price(p):
    v = sorted(set(l['price_wan'] for l in p['listings'] if l.get('price_wan')))
    return (f'{v[0]:,.0f}' if len(v) == 1 else f'{v[0]:,.0f}～{v[-1]:,.0f}') + ' 萬' if v else '未揭露'


def walk(p):
    l = p['location']
    return f"出口{l['nearest_exit']} 約 {l['walk_min']:g} 分（{l['walk_m']:.0f} m，地圖估算）" if l.get('walk_min') is not None else '步行時間待確認'


L = []
A = L.append
A('# 信義安和站周邊購屋研究｜研究摘要\n')
A(f"研究基準日：**{meta['research_date']}**（台北時間）。本檔由 `tools/build_summary.py` 從 `data/` 產生，數字與網站一致。互動版請開啟 `index.html`。\n")
A('> 所有物件的狀態都是「研究日查得刊登頁，實際可售狀態待確認」。本研究沒有聯絡任何房仲、沒有送出任何表單。「符合」指刊登頁揭露的數字符合條件，仍須以謄本與不動產說明書核實。\n')
A('## 1. 一句話結論\n')
A(ins['insights']['one_liner'] + '\n')
A('## 2. 數字總覽\n')
A('| 項目 | 數量 |\n|---|---:|')
A(f"| 各平台初篩保留的刊登數（未去重） | {meta['raw_listing_count']} |")
A(f"| 去除非住宅類型後的刊登數 | {meta['listing_count_after_type_filter']} |")
A(f"| 跨平台去重後的不重複物件 | {meta['unique_units_all']} |")
A(f"| 其中步行估算超過 16.5 分鐘而不列入候選 | {meta['out_of_range_count']} |")
A(f"| **不重複候選（網站列表）** | **{len(props)}** |")
A(f"| A 口徑已確認符合（主建物 ≥26 坪＋總價 ≤8,000 萬＋步行 ≤15 分＋住宅用途未見疑義） | **{nA}** |")
A(f"| 只符合 B 口徑（主＋附 ≥26 坪；主建物未達 26 坪） | **{nB}** |")
A(f"| 關鍵資料待確認（不計入符合） | {nPend} |")
A(f"| 目前不符合（超出預算、兩種面積口徑皆未達、步行估算 >15 分、或非一般完整住宅） | {nNot}（其中超出預算 {over}） |")
A(f"| 逐間深度查核 | {sum(1 for p in props if p['analysis'].get('verified'))} |")
A('\n跨類別的待確認計數（可能重複，也包含已判為不符合者）：\n')
A('| 待確認項目 | 數量 |\n|---|---:|')
A(f"| 總價待確認（車位是否含在總價／是否必買不明，或各平台開價跨過預算） | {need_price} |")
A(f"| 面積待確認（A 或 B 任一口徑無法判斷） | {need_area} |")
A(f"| 位置（步行時間）待確認 | {need_loc} |")
A(f"| 住宅用途待確認 | {need_use} |")
A(f"| 可售狀態待確認 | {len(props)}（全部；本研究未聯絡任何房仲） |\n")
A('## 3. 目前最值得研究的方向\n')
for x in ins['insights']['direction']:
    A(f'- {x}')
A('\n## 4. 第一輪優先看屋\n')
first = sorted([p for p in props if p['analysis'].get('first_round')], key=lambda p: p['analysis']['rank'])
for i, p in enumerate(first, 1):
    an, a = p['analysis'], p['area']
    A(f"### {i}. {p['name']}（{p['id']}）\n")
    A(f"- 開價 {price(p)}｜主建物 **{a['main_ping']:g} 坪**｜主＋附 {C[p['id']]['mainAux']:g} 坪｜權狀 {a['total_ping']:g} 坪｜屋齡 {p['age_years']:g} 年｜{p.get('layout_text')}｜{p.get('floor')}/{p.get('total_floors')} 樓｜{walk(p)}")
    A(f"- 為什麼沒有超過 8,000 萬：{C[p['id']]['breason']}" + (f"（{p['price']['note']}）" if p['price'].get('note') else ''))
    A(f"- 26 坪的組成：主建物 {a['main_ping']:g}＋附屬建物 {a.get('aux_ping')}〔{a.get('aux_detail') or '組成未揭露'}〕；共有部分 {a.get('common_ping')} 坪。{C[p['id']]['label']}。")
    A(f"- 排序理由：{an.get('rank_reason')}")
    A(f"- 價格依據：{an['price_view']['text']}")
    J2 = lambda xs: '；'.join(str(x).rstrip('。； ') for x in xs)
    A('- 主要缺點：' + J2(an.get('drawbacks', [])[:4]))
    A('- 還沒確認：' + J2(an.get('missing', [])[:4]))
    A('- 原始刊登：' + '、'.join(f"[{l['platform_name']} {l['object_no']}]({l['url']})" for l in p['listings']) + '\n')
A('## 5. 先補資料再決定（已深度查核者）\n')
for p in sorted([p for p in props if p['analysis']['tier'] == 'need_info' and p['analysis'].get('verified')], key=lambda p: p['analysis']['rank']):
    A(f"- **{p['name']}（{p['id']}）** {price(p)}｜主建物 {p['area']['main_ping']} 坪｜{walk(p)}：{p['analysis'].get('tier_reason')}。要先補：" + '；'.join(str(x).rstrip('。； ') for x in p['analysis'].get('missing', [])[:2]))
others = [p for p in props if p['analysis']['tier'] == 'need_info' and not p['analysis'].get('verified')]
A(f"\n另有 {len(others)} 間由規則判為「先補資料」（多為只符合 B 口徑、面積拆分不明、登記非住家用或只有路段無法估算步行），請在網站列表以「行動名單」篩選檢視。\n")
A('## 6. 第二輪候補與不符合\n')
second = [p for p in props if p['analysis']['tier'] == 'visit' and not p['analysis'].get('first_round')]
A(f"- 條件符合、列為第二輪候補：{len(second)} 間（其中 {sum(1 for p in second if p['analysis'].get('verified'))} 間已深度查核、其餘為規則式初判）。")
A(f"- 目前不符合條件：{sum(1 for p in props if p['analysis']['tier'] == 'not_fit')} 間（超出預算、兩種面積口徑皆未達、步行估算超過 15 分、或非一般完整住宅）。\n")
A('## 7. 不同預算帶、不同步行距離\n')
for x in ins['insights']['budget_bands'] + ins['insights']['walk_bands']:
    A(f'- {x}')
A('\n## 8. 預售屋與新成屋（另列）\n')
for x in nb.get('summary', []):
    A(f'- {x}')
A('\n## 9. 最重要的資料缺口\n')
for x in ins['insights']['gaps']:
    A(f'- {x}')
A('\n## 10. 每一間都該問房仲的問題\n')
for x in ins['generic_questions']:
    A(f'- {x}')
A('\n## 11. 檔案\n')
A('`index.html`（網站）｜`data/properties.json`、`data/comparables.json`、`data/sources.json`｜`exports/properties.csv`、`exports/comparables.csv`｜`screenshots/`（刊登頁截圖）｜`ASSUMPTIONS.md`、`METHODOLOGY.md`、`RESEARCH_LOG.md`、`QA_REPORT.md`、`README.md`\n')
open(os.path.join(ROOT, 'research_summary.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')
json.dump({'candidates': len(props), 'A_confirmed': nA, 'B_only': nB, 'pending': nPend, 'not_fit': nNot, 'over_budget': over, 'need_price': need_price, 'need_area': need_area, 'need_loc': need_loc, 'need_use': need_use,
           'first_round': [p['id'] for p in first]}, open(os.path.join(ROOT, 'data', 'summary_counts.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('summary written:', len(props), 'candidates; A', nA, 'B-only', nB, 'pending', nPend, 'not fit', nNot)
