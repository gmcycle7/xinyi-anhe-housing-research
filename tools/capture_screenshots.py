#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""自動擷取候選物件的原始刊登頁截圖（headless Chrome），存成 JPEG 與縮圖，並寫回 data/screenshots.json。

執行： python3 tools/capture_screenshots.py [--tiers visit,need_info] [--limit N] [--force]
- 只開公開頁面，不登入、不送表單；單一行程、每頁間隔 ≥2 秒。
- 使用 headless Chrome 的預設 User-Agent（不偽裝成一般瀏覽器）；被平台阻擋或頁面空白就記為失敗，不重試、不繞過。
- 截圖保留頁面上的來源標誌與浮水印；僅供本機個人研究，請勿對外散布。
- 已存在的截圖不會重抓（除非 --force），因此可以安全重跑。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
OUT = os.path.join(ROOT, 'screenshots')
HEIGHTS = {'sinyi': 2500, 'yungching': 2800, 'hbhousing': 2600, 'cthouse': 2600, 'twhg': 2600}


def safe(s):
    return re.sub(r'[^A-Za-z0-9_\-]', '_', str(s))


def capture(url, png, height):
    cmd = [CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
           f'--window-size=1280,{height}', '--virtual-time-budget=9000', '--lang=zh-TW',
           f'--screenshot={png}', url]
    try:
        subprocess.run(cmd, capture_output=True, timeout=75)
    except subprocess.TimeoutExpired:
        return False
    return os.path.exists(png) and os.path.getsize(png) > 20000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiers', default='visit,need_info')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--ids', default='')
    ap.add_argument('--max-per-property', type=int, default=2)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--reverse', action='store_true', help='由名單尾端往前擷取（可與另一個行程同時跑以加速）')
    ap.add_argument('--index-only', action='store_true', help='不連線，只依 screenshots/ 內現有檔案重建 data/screenshots.json')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    props = json.load(open(os.path.join(ROOT, 'data', 'properties.json'), encoding='utf-8'))['properties']
    idx_path = os.path.join(ROOT, 'data', 'screenshots.json')
    index = json.load(open(idx_path, encoding='utf-8')) if os.path.exists(idx_path) else {}
    tiers = set(a.tiers.split(','))
    ids = set(x for x in a.ids.split(',') if x)
    todo = [p for p in props if (p['id'] in ids if ids else p['analysis']['tier'] in tiers)]
    todo.sort(key=lambda p: ({'visit': 0, 'need_info': 1, 'not_fit': 2}[p['analysis']['tier']], p['analysis'].get('rank') or 999))
    if a.reverse:
        todo.reverse()
    if a.limit:
        todo = todo[:a.limit]
    if a.index_only:
        todo = props
    n_ok = n_fail = 0
    for p in todo:
        shots = [] if a.index_only else index.get(p['id'], [])
        seen_platform = set()
        for l in p['listings']:
            if len([s for s in shots if s.get('ok')]) >= a.max_per_property and not a.force and not a.index_only:
                break
            if l['platform'] in seen_platform:
                continue  # 同平台多店重複刊登只截一張
            base = f"{p['id']}_{safe(l['platform'])}_{safe(l['object_no'])}"
            jpg, thumb = os.path.join(OUT, base + '.jpg'), os.path.join(OUT, base + '_thumb.jpg')
            if os.path.exists(jpg) and not a.force:
                seen_platform.add(l['platform'])
                if not any(s['file'].endswith(base + '.jpg') for s in shots):
                    shots.append({'file': f'screenshots/{base}.jpg', 'thumb': f'screenshots/{base}_thumb.jpg', 'url': l['url'], 'platform_name': l['platform_name'], 'captured_at': time.strftime('%Y-%m-%dT%H:%M:%S+08:00', time.localtime(os.path.getmtime(jpg))), 'ok': True})
                continue
            if a.index_only:
                continue
            if os.path.exists(os.path.join(OUT, base + '.png')):
                continue  # 另一個行程正在擷取這一頁
            png = os.path.join(OUT, base + '.png')
            ok = capture(l['url'], png, HEIGHTS.get(l['platform'], 2600))
            if ok:
                im = Image.open(png).convert('RGB')
                # 全白／空白頁檢查
                small = im.resize((64, 64))
                px = list(small.getdata())
                nonwhite = sum(1 for r, g, b in px if r < 240 or g < 240 or b < 240) / len(px)
                if nonwhite < 0.03:
                    ok = False
                else:
                    im.save(jpg, 'JPEG', quality=72, optimize=True)
                    t = im.crop((0, 0, im.width, int(im.width * 9 / 16) + 60)).resize((640, int(640 * (int(im.width * 9 / 16) + 60) / im.width)))
                    t.save(thumb, 'JPEG', quality=70, optimize=True)
            if os.path.exists(png):
                os.remove(png)
            if ok:
                shots.append({'file': f'screenshots/{base}.jpg', 'thumb': f'screenshots/{base}_thumb.jpg', 'url': l['url'], 'platform_name': l['platform_name'], 'captured_at': time.strftime('%Y-%m-%dT%H:%M:%S+08:00'), 'ok': True})
                seen_platform.add(l['platform'])
                n_ok += 1
            else:
                shots.append({'file': None, 'url': l['url'], 'platform_name': l['platform_name'], 'captured_at': time.strftime('%Y-%m-%dT%H:%M:%S+08:00'), 'ok': False, 'note': '截圖失敗或頁面空白（可能被平台阻擋 headless 瀏覽器）'})
                n_fail += 1
            index[p['id']] = shots
            json.dump(index, open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print(p['id'], l['platform'], l['object_no'], 'OK' if ok else 'FAIL', flush=True)
            time.sleep(2.0)
        index[p['id']] = shots
    json.dump(index, open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done ok', n_ok, 'fail', n_fail)


if __name__ == '__main__':
    main()
