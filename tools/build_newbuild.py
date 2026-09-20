#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""research_raw/newbuild/projects_clean.json → data/newbuild.json

projects_clean.json 只含：內政部實價登錄開放資料（預售 b 檔／成屋 a 檔）的逐筆成交，以及可明確歸屬於非 591 來源
（PLEX、媒體、使用執照）的建商／完工資訊。591（含新建案、實價社區頁）的座標、步行估算、公設比、開價、動態一律未採用，
原始檔隔離於 research_raw/_quarantine_591_not_used/newbuild_591/。

這裡的統計全部由實價登錄逐筆重新計算；主建物為估算值（不參與符合判斷）。"""
import json
import os
import statistics as st

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
src = json.load(open(os.path.join(ROOT, 'research_raw', 'newbuild', 'projects_clean.json'), encoding='utf-8'))
BUDGET = 8000
# 依據：本站旁兩個新成屋（成屋實價登錄有主建物登記值）主建物 ÷ 不含車位權狀 ≈ 0.555–0.572
R_LO, R_HI = 0.555, 0.572
NEED_LO, NEED_HI = 26 / R_HI, 26 / R_LO  # 主建物 26 坪約需 45.5–46.8 坪（不含車位）

out = []
for p in src:
    if not p['transactions'] and not p.get('source_urls'):
        continue  # 唯一來源是 591、且沒有任何實價登錄成交 → 沒有可採用的資料，不列入
    tx = [t for t in p['transactions'] if t.get('total_price_wan') and t.get('area_excl_parking_ping') and not t.get('cancellation')]
    normal = [t for t in tx if not t.get('note')]
    use = normal or tx
    dates = sorted(t['date'] for t in tx)
    units = sorted(t['unit_price_excl_parking_wan_per_ping'] for t in use if t.get('unit_price_excl_parking_wan_per_ping'))
    areas = sorted(t['area_excl_parking_ping'] for t in use)
    big = [t for t in use if t['area_excl_parking_ping'] >= NEED_LO]          # 估算主建物可能 ≥26 坪的戶別
    big_in_budget = [t for t in big if t['total_price_wan'] <= BUDGET]
    big_house_in_budget = [t for t in big if (t.get('house_price_excl_parking_wan') or t['total_price_wan']) <= BUDGET]
    in_budget = [t for t in use if t['total_price_wan'] <= BUDGET]
    size_txt = f"實價登錄（不含車位）{areas[0]:.1f}–{areas[-1]:.1f} 坪（{len(use)} 筆）" if areas else '查詢期間內無實價登錄成交'
    price_txt = '查詢期間內無實價登錄成交'
    if units:
        price_txt = f"實價登錄扣車位單價 {units[0]:.0f}–{units[-1]:.0f} 萬/坪（中位數 {st.median(units):.0f}；{len(units)} 筆，已排除解約" + ('與特殊關係交易' if normal else '；僅有特殊關係或地主戶交易，不宜視為行情') + '）'
        if big:
            tp = sorted(t['total_price_wan'] for t in big)
            price_txt += f"；不含車位 ≥{NEED_LO:.0f} 坪的戶別（估算主建物才可能達 26 坪）成交總價 {tp[0]:,.0f}–{tp[-1]:,.0f} 萬（含車位，{len(big)} 筆）"
    if not use:
        verdict = '無成交資料可判斷'
    elif big_in_budget:
        verdict = f"可能有符合的戶別，但未確認：{len(big_in_budget)} 筆成交同時滿足「含車位總價 ≤8,000 萬」與「不含車位 ≥{NEED_LO:.0f} 坪」；主建物需向建商索取面積表"
    elif big_house_in_budget:
        lo = min((t.get('house_price_excl_parking_wan') or t['total_price_wan']) for t in big_house_in_budget)
        verdict = f"邊緣、未確認：夠大的戶別含車位都超過 8,000 萬；若車位可不買，有 {len(big_house_in_budget)} 筆的屋價在 8,000 萬內（最低 {lo:,.0f} 萬）。車位能否不買未查得 → 總價待確認；主建物為估算"
    elif big:
        verdict = f"不符合（超出預算）：估算主建物可能達 26 坪的戶別（不含車位 ≥{NEED_LO:.0f} 坪）成交總價最低 {min(t['total_price_wan'] for t in big):,.0f} 萬"
    elif in_budget:
        verdict = f"不符合（面積不足）：8,000 萬內成交的最大戶為不含車位 {max(t['area_excl_parking_ping'] for t in in_budget):.1f} 坪，估算主建物約 {max(t['area_excl_parking_ping'] for t in in_budget) * R_LO:.1f}–{max(t['area_excl_parking_ping'] for t in in_budget) * R_HI:.1f} 坪"
    else:
        verdict = '不符合（超出預算）：查詢期間內沒有 8,000 萬以內的成交'
    out.append({
        'name': p['name'], 'builder': p.get('builder') or '未取得', 'stage': p.get('stage'),
        'location_public': p.get('address_lvr') or '實價登錄無成交，位置未取得',
        'size_range_ping': size_txt, 'price_info': price_txt,
        'expected_completion': p.get('expected_completion') or '未取得（可查得的來源只有 591，未採用）',
        'expected_completion_source': '；'.join(u for u in p.get('source_urls', []) if 'plex' in u or 'sinyi' in u)[:300] or ('使用執照／實價登錄' if p.get('expected_completion') else ''),
        'sales_status': '實際是否仍有符合條件的戶別可售，需向建商或代銷確認（本研究未聯絡任何人）',
        'fits_budget_assessment': verdict + '（研究推論；預售實價登錄沒有主建物欄位）',
        'lvr_tx_count': len(tx), 'lvr_tx_period': (dates[0] + '～' + dates[-1]) if dates else None,
        'source_urls': list(dict.fromkeys(p.get('source_urls', []) + ['https://plvr.land.moi.gov.tw/DownloadOpenData'])),
    })

cands = [o for o in out if o['fits_budget_assessment'].startswith(('可能', '邊緣'))]
summary = [
    f"結論：本研究檢視了站區周邊 {len(out)} 個預售屋／建商新成屋建案的實價登錄成交，沒有查到任何可確認「總價 ≤8,000 萬且主建物 ≥26 坪」的戶別。",
    f"原因是新案公設比高：站旁兩個新成屋的成屋實價登錄（有主建物登記值）顯示，主建物只占不含車位權狀的約 {R_LO * 100:.1f}–{R_HI * 100:.1f}%，主建物 26 坪約需 {NEED_LO:.0f}–{NEED_HI:.0f} 坪權狀（不含車位）；而本區新案的預售實登單價多在每坪 150–230 萬，這個坪數的總價通常已超過 8,000 萬，還不含車位。",
    ('最接近的是：' + '、'.join(o['name'] for o in cands) + '——都屬「邊緣、未確認」，主建物需向建商索取面積表，車位能否不買也未查得；預計完工時間見下表。') if cands else '沒有任何建案的成交落在「邊緣」範圍。',
    '因此主要住宅推薦名單全部是中古屋。房仲平台上屋齡 0 年、格局未填的刊登（與預售建案同名）已在房源列表標為「預售屋」，不與中古屋混排，也不與中古成交比價。',
    '資料來源：內政部實價登錄預售屋與成屋成交（官方開放資料）；建商與完工時間取自第三方建案平台（PLEX）、媒體或使用執照資訊。591 新建案頁與 591 實價社區頁的內容（座標、步行估算、公設比、開價、銷售動態）未採用；各建案到捷運站的步行時間因此未估算。預售成交有登記時間差，2026 年 5 月中以後的交易尚未完整揭露。',
]
json.dump({'projects': out, 'summary': summary}, open(os.path.join(ROOT, 'data', 'newbuild.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('newbuild.json', len(out), 'projects; 591 mentions in project rows:', json.dumps(out, ensure_ascii=False).count('591.com'), '| candidates:', [o['name'] for o in cands])
