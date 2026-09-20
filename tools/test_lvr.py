#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""實價登錄解析器測試（測試夾具只存在於本檔，不進入網站資料）。執行： python3 tools/test_lvr.py"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lvr_lib as L

P = L.SQM_PER_PING
res, ok_all = [], True


def t(name, cond, detail=''):
    global ok_all
    ok_all &= bool(cond)
    res.append({'name': name, 'ok': bool(cond), 'detail': str(detail)})
    print(('PASS' if cond else 'FAIL'), name, ('→ ' + str(detail)) if detail != '' else '')


def row(**kw):
    base = {'鄉鎮市區': '大安區', '交易標的': '房地(土地+建物)+車位', '土地位置建物門牌': '臺北市大安區安和路一段１２巷３號五樓', '交易年月日': '1150301', '移轉層次': '五層', '總樓層數': '十二層',
            '建物型態': '住宅大樓(11層含以上有電梯)', '主要用途': '住家用', '建築完成年月': '0850101', '建物移轉總面積平方公尺': str(50 * P), '建物現況格局-房': '3', '建物現況格局-廳': '2', '建物現況格局-衛': '2',
            '有無管理組織': '有', '總價元': '70000000', '車位類別': '坡道平面', '車位移轉總面積平方公尺': str(8 * P), '車位總價元': '3000000', '備註': '', '編號': 'TESTFIXTURE1',
            '主建物面積': str(27 * P), '附屬建物面積': str(1 * P), '陽台面積': str(2 * P), '電梯': '有', '_file': 'fixture'}
    base.update(kw)
    return base


c = L.to_comp(row())
t('L1 車位面積只扣一次：共有部分 = 50−27−1−2−8 = 12 坪', abs(c['common_ping'] - 12) < 1e-3, c['common_ping'])
t('L2 ①扣車位建坪單價 = (7000−300)÷(50−8) = 159.52', abs(c['unit_net_wan'] - 6700 / 42) < 0.01, c['unit_net_wan'])
t('L3 ②÷主建物 = 6700÷27 = 248.15', abs(c['unit_main_wan'] - 6700 / 27) < 0.01, c['unit_main_wan'])
t('L4 ③÷(主+附+陽台) = 6700÷30 = 223.33；B 口徑的「附」= 附屬建物 + 陽台', abs(c['unit_main_aux_wan'] - 6700 / 30) < 0.01 and abs(c['aux_ping'] - 3) < 1e-3, (c['unit_main_aux_wan'], c['aux_ping']))
c2 = L.to_comp(row(車位總價元='0'))
t('L5 有車位但車位價未拆分 → 不計算扣車位單價，只給含車位指標', c2['parking_split_ok'] is False and c2['unit_net_wan'] is None and c2['unit_main_wan'] is None and c2['unit_gross_incl_parking_wan'] is not None)
c3 = L.to_comp(row(交易標的='房地(土地+建物)', 車位移轉總面積平方公尺='0', 車位總價元='0', 車位類別=''))
t('L6 無車位 → 直接以總價計算', c3['parking_split_ok'] and abs(c3['unit_net_wan'] - 7000 / 50) < 0.01)
c4 = L.to_comp(row(備註='親友、員工、共有人或其他特殊關係間之交易；'))
t('L7 特殊關係交易被標記', '特殊關係' in c4['flags'])
t('L8 店面／土地等非住宅不轉成比較樣本', L.to_comp(row(建物型態='店面(店鋪)')) is None and L.to_comp(row(交易標的='土地')) is None)
t('L9 樓層與民國日期解析', c['floor'] == 5 and c['total_floors'] == 12 and c['trade_date'] == '2026-03-01' and c['built_date'] == '1996-01-01')
t('L10 全形門牌正規化', c['road'] == '安和路一段' and c['lane'] == '12巷' and c['no'] == '3號', (c['road'], c['lane'], c['no']))
json.dump({'pass': sum(r['ok'] for r in res), 'fail': sum(not r['ok'] for r in res), 'results': res}, open(os.path.join(HERE, 'test_lvr_results.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n合計：%d 通過，%d 失敗' % (sum(r['ok'] for r in res), sum(not r['ok'] for r in res)))
sys.exit(0 if ok_all else 1)
