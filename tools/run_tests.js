#!/usr/bin/env node
/* 資料邏輯測試。執行： node tools/run_tests.js
 * 測試用的物件全部是「測試夾具」，只存在於這個檔案，不會進入網站資料。 */
'use strict';
const path = require('path');
const fs = require('fs');
const L = require(path.join(__dirname, '..', 'assets', 'logic.js'));

let pass = 0, fail = 0; const results = [];
function t(name, cond, detail) {
  if (cond) pass++; else fail++;
  results.push({ name, ok: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  → ' + detail : ''));
}
function mk(o) {
  return Object.assign({
    residential_ok: true,
    listings: [{ price_wan: 7000 }],
    price: { has_parking: false, includes_parking: null, parking_must_buy: null, parking_price_wan: null },
    area: { main_ping: 28, aux_ping: 3, total_ping: 45, common_ping: 14, parking_ping: null },
    location: { walk_min: 6 }
  }, o);
}

// 1. 預算邊界
t('T1a 8,000 萬整通過', L.budgetStatus(mk({ listings: [{ price_wan: 8000 }] }), 8000).status === 'ok');
t('T1b 8,000.01 萬不通過', L.budgetStatus(mk({ listings: [{ price_wan: 8000.01 }] }), 8000).status === 'over');
t('T1c 8,001 萬不通過', L.budgetStatus(mk({ listings: [{ price_wan: 8001 }] }), 8000).status === 'over');
t('T1d 超過預算不因可議價而放行（classify=not_fit）', L.classify(mk({ listings: [{ price_wan: 8200 }] })).cls === 'not_fit');

// 2. 房價＋必買車位超標
const p2 = mk({ listings: [{ price_wan: 7800 }], price: { has_parking: true, includes_parking: false, parking_must_buy: true, parking_price_wan: 400 } });
const b2 = L.budgetStatus(p2, 8000);
t('T2a 7,800＋必買車位 400 = 8,200 → 超出預算', b2.status === 'over' && b2.totalWan === 8200, JSON.stringify(b2.reason));
const p2b = mk({ listings: [{ price_wan: 7800 }], price: { has_parking: true, includes_parking: false, parking_must_buy: false, parking_price_wan: 400 } });
t('T2b 車位可不買 → 以房價 7,800 判斷通過', L.budgetStatus(p2b, 8000).status === 'ok');
const p2c = mk({ listings: [{ price_wan: 7800 }], price: { has_parking: true, includes_parking: false, parking_must_buy: null, parking_price_wan: 400 } });
t('T2c 車位是否必買不明且最壞情況超標 → 總價待確認（不是已確認符合）', L.budgetStatus(p2c, 8000).status === 'unknown' && L.classify(p2c).cls === 'pending');
const p2d = mk({ listings: [{ price_wan: 7000 }], price: { has_parking: true, includes_parking: false, parking_must_buy: null, parking_price_wan: 400 } });
t('T2d 即使必買也不超標（7,000+400）→ 通過', L.budgetStatus(p2d, 8000).status === 'ok');
const p2e = mk({ listings: [{ price_wan: 7900 }], price: { has_parking: true, includes_parking: null, parking_must_buy: null, parking_price_wan: null } });
t('T2e 有車位但是否含在總價不明 → 總價待確認', L.budgetStatus(p2e, 8000).status === 'unknown');
const p2f = mk({ listings: [{ price_wan: 7900 }], price: { has_parking: true, includes_parking: true, parking_must_buy: null, parking_price_wan: null } });
t('T2f 總價已含車位 → 不重複加車位價', L.budgetStatus(p2f, 8000).status === 'ok' && L.budgetStatus(p2f, 8000).totalWan === 7900);

// 3. 25.99 坪不得因四捨五入通過
const p3 = mk({ area: { main_ping: 25.99, aux_ping: 0, total_ping: 40 } });
t('T3a 主建物 25.99 → A 不通過', L.areaStatus(p3).A === 'fail');
t('T3b 主建物 25.9999 → A 不通過', L.areaStatus(mk({ area: { main_ping: 25.9999, aux_ping: 0 } })).A === 'fail');
t('T3c 顯示格式：25.999 顯示為 25.99（不進位成 26.00）', L.fmtPing(25.999) === '25.99', L.fmtPing(25.999));
t('T3d 主建物 26.00 → A 通過', L.areaStatus(mk({ area: { main_ping: 26, aux_ping: 0 } })).A === 'ok');
t('T3e 浮點相加：23.4＋2.6 = 26 → B 通過（不受浮點誤差影響）', L.areaStatus(mk({ area: { main_ping: 23.4, aux_ping: 2.6 } })).B === 'ok');
t('T3f 25.1＋0.89 = 25.99 → B 不通過', L.areaStatus(mk({ area: { main_ping: 25.1, aux_ping: 0.89 } })).B === 'fail');

// 4. 主 25 + 附 4
const a4 = L.areaStatus(mk({ area: { main_ping: 25, aux_ping: 4 } }));
t('T4a 主25＋附4 → A 不通過、B 通過', a4.A === 'fail' && a4.B === 'ok');
t('T4b 標示文字正確', a4.label === '主＋附符合26坪；主建物未達26坪', a4.label);
const c4A = L.classify(mk({ area: { main_ping: 25, aux_ping: 4 } }), { mode: 'A' });
const c4B = L.classify(mk({ area: { main_ping: 25, aux_ping: 4 } }), { mode: 'B' });
t('T4c A 模式不列入符合；B 模式列入符合', c4A.cls === 'not_fit' && c4B.cls === 'confirmed');

// 5. 缺關鍵資料不得顯示已確認
t('T5a 主建物缺 → 面積待確認', L.classify(mk({ area: { main_ping: null, aux_ping: null, total_ping: 50 } })).cls === 'pending');
t('T5b 只有估算主建物（估算 30 坪）→ 仍為待確認', L.classify(mk({ area: { main_ping: null, aux_ping: null, total_ping: 50, estimated_main_ping: 30 } })).cls === 'pending');
t('T5c 開價缺 → 總價待確認', L.classify(mk({ listings: [{ price_wan: null }], price: { has_parking: false } })).cls === 'pending');
t('T5d 車位資訊完全未揭露 → 總價待確認', L.budgetStatus(mk({ price: { has_parking: null, includes_parking: null } })).status === 'unknown');
t('T5e 步行時間缺 → 位置待確認', L.classify(mk({ location: { walk_min: null } })).cls === 'pending');
t('T5f 登記疑義（area.doubt）→ 即使數字達標仍待核對', L.classify(mk({ area: { main_ping: 30, aux_ping: 2, doubt: '公寓樓梯間是否計入主建物待核對' } })).cls === 'pending');
t('T5g 主建物達標、附屬未揭露 → A 通過且 B 視為成立', (function () { const r = L.areaStatus(mk({ area: { main_ping: 27, aux_ping: null } })); return r.A === 'ok' && r.B === 'ok'; })());
t('T5h 主建物未達標、附屬未揭露 → B 待確認', L.areaStatus(mk({ area: { main_ping: 25, aux_ping: null } })).B === 'unknown');

// 6. 車位面積不重複扣除
const p6 = mk({ listings: [{ price_wan: 7000 }], price: { has_parking: true, includes_parking: true, parking_price_wan: 300, parking_must_buy: null }, area: { total_ping: 50, main_ping: 27, aux_ping: 3, common_ping: 12, parking_ping: 8 } });
const u6 = L.askingUnitPrices(p6);
t('T6a 扣車位單價 = (7000-300) ÷ (50-8) = 159.52', Math.abs(u6.net - 6700 / 42) < 1e-9, String(u6.net));
t('T6b 主建物換算單價 = 6700 ÷ 27', Math.abs(u6.main - 6700 / 27) < 1e-9);
t('T6c 主＋附換算單價 = 6700 ÷ 30', Math.abs(u6.mainAux - 6700 / 30) < 1e-9);
const p6n = mk({ price: { has_parking: true, includes_parking: true, parking_price_wan: null }, area: { total_ping: 50, main_ping: 27, aux_ping: 3, parking_ping: 8 } });
const u6n = L.askingUnitPrices(p6n);
t('T6d 車位價未揭露 → 不捏造拆分，只給含車位指標', u6n.net === null && u6n.main === null && u6n.grossInclParking !== null);
// 實價登錄解析器（Python）的車位不重複扣除由 tools/test_lvr.py 測試

// 平台只揭露「主＋附」合計
const mpaLo = L.areaStatus(mk({ area: { main_ping: null, aux_ping: null, main_plus_aux_ping: 24.17 } }));
t('T7a 只有主＋附合計 24.17 → A、B 皆不符合（不是待確認）', mpaLo.A === 'fail' && mpaLo.B === 'fail');
const mpaHi = L.areaStatus(mk({ area: { main_ping: null, aux_ping: null, main_plus_aux_ping: 38.5 } }));
t('T7b 只有主＋附合計 38.5 → B 符合、A 待確認', mpaHi.A === 'unknown' && mpaHi.B === 'ok' && L.classify(mk({ area: { main_ping: null, aux_ping: null, main_plus_aux_ping: 38.5 } }), { mode: 'A' }).cls === 'pending');
// 同一戶含／不含車位兩種刊登、車位可不買 → 以屋價判斷
const hp = mk({ listings: [{ price_wan: 6360 }, { price_wan: 6988 }], price: { has_parking: true, includes_parking: false, parking_must_buy: false, parking_price_wan: 300, house_price_range_wan: [6360, 6688] } });
t('T8 屋價範圍 6,360–6,688（車位選配）→ 以屋價判斷並通過；單價不以含車位的 6,988 計算', L.budgetStatus(hp).status === 'ok' && L.budgetStatus(hp).totalWan === 6688 && L.priceRange(hp).max === 6688);
// 非一般完整住宅
t('T9 residential_ok=false → 不符合；null → 待確認', L.classify(mk({ residential_ok: false })).cls === 'not_fit' && L.classify(mk({ residential_ok: null })).cls === 'pending');

// 步行分區
t('T-walk 10.0 分=優先、10.5=擴大、15.5=超出', L.walkStatus(mk({ location: { walk_min: 10 } })).zone === 'primary' && L.walkStatus(mk({ location: { walk_min: 10.5 } })).zone === 'extended' && L.walkStatus(mk({ location: { walk_min: 15.5 } })).zone === 'out');
// 多平台價格不一致
const pm = mk({ listings: [{ price_wan: 7980 }, { price_wan: 8080 }] });
t('T-multi 同戶多平台開價 7,980／8,080 → 總價待確認（不任選一個）', L.budgetStatus(pm, 8000).status === 'unknown');
// 可調預算
t('T-adjust 預算調為 7,000 後 7,500 萬物件不通過', L.budgetStatus(mk({ listings: [{ price_wan: 7500 }] }), 7000).status === 'over');

// 7 & 11. 正式資料檢查（若資料檔已存在）
const dataDir = path.join(__dirname, '..', 'data');
const pf = path.join(dataDir, 'properties.json');
if (fs.existsSync(pf)) {
  const props = JSON.parse(fs.readFileSync(pf, 'utf8')).properties;
  const ids = new Set(props.map(p => p.id));
  t('D1 物件 ID 唯一', ids.size === props.length, props.length + ' 筆');
  const urls = []; props.forEach(p => (p.listings || []).forEach(l => urls.push(l.url)));
  t('D2 同一刊登網址不會出現在兩個物件（重複刊登不膨脹候選數）', new Set(urls).size === urls.length, urls.length + ' 個刊登網址');
  const keyset = new Map(); let dupUnits = [];
  props.forEach(p => {
    const a = p.area || {};
    if (L.isNum(a.main_ping) && L.isNum(a.total_ping) && p.floor) {
      const k = [p.floor, p.total_floors, a.main_ping.toFixed(2), a.total_ping.toFixed(2)].join('|');
      if (keyset.has(k) && !((p.duplicates || {}).auto_distinct || []).includes(keyset.get(k))) dupUnits.push(k + ' ' + keyset.get(k) + '/' + p.id);
      keyset.set(k, p.id);
    }
  });
  t('D3 沒有「樓層＋總樓層＋主建物＋總坪完全相同」卻未合併的物件', dupUnits.length === 0, dupUnits.join('; '));
  const bad = props.filter(p => (p.listings || []).some(l => !/^https?:\/\/[^\s]+$/.test(l.url) || /example\.|localhost|placeholder|TODO/i.test(l.url)));
  t('D4 所有刊登網址為真實 http(s) 連結、無佔位內容', bad.length === 0, bad.map(p => p.id).join(','));
  const text = fs.readFileSync(pf, 'utf8');
  t('D5 資料檔沒有示範/佔位字樣', !/lorem|示範資料|範例物件|placeholder|TODO|TBD|xxx/i.test(text));
  const zeroFake = props.filter(p => (p.area || {}).main_ping === 0 || (p.listings || []).some(l => l.price_wan === 0));
  t('D6 沒有用 0 冒充缺值', zeroFake.length === 0, zeroFake.map(p => p.id).join(','));
  const confirmedA = props.filter(p => L.classify(p, { mode: 'A' }).cls === 'confirmed');
  const leak = confirmedA.filter(p => !L.isNum((p.area || {}).main_ping) || p.area.main_ping < 26 || L.budgetStatus(p).status !== 'ok' || !L.isNum((p.location || {}).walk_min));
  t('D7 「已確認符合(A)」名單內每一筆都有主建物≥26、總價 ok、步行時間', leak.length === 0, confirmedA.length + ' 筆符合；洩漏：' + leak.map(p => p.id).join(','));
  const parkIncons = props.filter(p => (p.price || {}).has_parking === false && (L.isNum(p.price.parking_price_wan) || p.price.parking_type));
  t('D10 沒有「無車位」卻又有車位價或車位形式的自相矛盾資料', parkIncons.length === 0, parkIncons.map(p => p.id).join(','));
  const sig = new Map(); const miss = [];
  props.forEach(p => { const a = p.area || {}; const pr = L.priceRange(p); if (!L.isNum(a.total_ping) || !L.isNum(a.land_ping) || !pr || !p.floor) return; const k = [p.floor, p.total_floors, a.total_ping.toFixed(2), a.land_ping.toFixed(2), pr.max].join('|'); if (sig.has(k)) { const o = sig.get(k); const d = p.duplicates || {}; if (!(d.suspected_with || []).includes(o) && !(d.auto_distinct || []).includes(o)) miss.push(o + '/' + p.id); } sig.set(k, p.id); });
  t('D11 沒有「樓層＋總坪＋土地持分＋開價完全相同」卻既未合併也未標示疑似的物件', miss.length === 0, miss.join('; '));
  const unsplit = props.filter(p => { const a = p.area || {}; return L.isNum(a.main_ping) && L.isNum(a.total_ping) && Math.abs(a.main_ping - a.total_ping) <= 0.02 && a.main_ping < 40 && !a.aux_ping && !a.common_ping && L.classify(p, { mode: 'A' }).cls === 'confirmed'; });
  t('D12 主建物＝總建坪（未拆分、<40 坪）的物件不會顯示為已確認符合', unsplit.length === 0, unsplit.map(p => p.id).join(','));
  const nonres = props.filter(p => /商業|辦公|事務所|住商|店/.test(p.registered_use || '') && L.classify(p, { mode: 'A' }).cls === 'confirmed');
  t('D13 登記用途含商業／辦公／住商／店鋪者不會顯示為已確認符合', nonres.length === 0, nonres.map(p => p.id).join(','));
  const pre = props.filter(p => p.product_stage === '預售屋' && ((p.analysis || {}).price_view || {}).premium_pct != null);
  t('D14 預售屋不與中古成交計算溢價', pre.length === 0, pre.map(p => p.id).join(','));
  const zero = props.filter(p => ['aux_ping', 'common_ping', 'parking_ping', 'land_ping'].some(k => (p.area || {})[k] === 0 && !(k === 'aux_ping' && (p.analysis || {}).verified && /無附屬|無陽台/.test((p.area || {}).aux_detail || ''))));
  t('D15 面積欄位沒有用 0 冒充缺值（查核確認「無附屬建物登記」者除外）', zero.length === 0, zero.map(p => p.id).join(','));
  const txt = JSON.stringify(props) + fs.readFileSync(path.join(dataDir, 'newbuild.json'), 'utf8').replace(/591[^"]{0,40}未採用|未採用[^"]{0,60}591|只有 591|來源只有 591/g, '');
  t('D16 網站資料中沒有 591 網址或 591 來源欄位', !/591\.com\.tw/.test(txt) && !/"platform":"591"/.test(txt));
  const noStatus = props.filter(p => !/實際可售狀態待確認/.test(p.availability_status || ''));
  t('D8 每筆都標示「實際可售狀態待確認」', noStatus.length === 0, noStatus.map(p => p.id).join(','));
  const noSrc = props.filter(p => !(p.listings || []).length || (p.listings || []).some(l => !l.platform || !l.object_no || !l.fetched_at));
  t('D9 每筆都有平台、物件編號、查閱時間', noSrc.length === 0, noSrc.map(p => p.id).join(','));
} else {
  console.log('（data/properties.json 尚未建立，略過正式資料檢查）');
}

console.log('\n合計：' + pass + ' 通過，' + fail + ' 失敗');
fs.writeFileSync(path.join(__dirname, 'test_results.json'), JSON.stringify({ ran_at: new Date().toISOString(), pass, fail, results }, null, 2));
process.exit(fail ? 1 : 0);
