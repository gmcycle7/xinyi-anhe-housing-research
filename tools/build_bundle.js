#!/usr/bin/env node
/* 把 data/*.json 打包成 data/bundle.js（讓 index.html 可以用 file:// 直接開啟，不需伺服器），
 * 並輸出 exports/properties.csv、exports/comparables.csv。
 * 執行： node tools/build_bundle.js
 * 這個步驟只讀寫 data/ 與 exports/，不會碰使用者瀏覽器內的收藏與筆記。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const L = require(path.join(ROOT, 'assets', 'logic.js'));
const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const opt = (f, d) => fs.existsSync(path.join(ROOT, 'data', f)) ? rd(f) : d;

const propsFile = rd('properties.json');
const compsFile = opt('comparables.json', { comparables: [], road_stats: [], communities: [] });
const sourcesFile = opt('sources.json', { sources: [], platform_log: [] });
const areaFile = opt('area.json', {});
const insights = opt('insights.json', {});
const newbuild = opt('newbuild.json', { projects: [] });
const exits = rd('station_exits.json');

const bundle = {
  meta: Object.assign({}, propsFile.meta, { station: exits.station, exits: exits.exits, exits_source: exits.source, generated_at: new Date().toISOString(), lvr_period: compsFile.period || null }),
  properties: propsFile.properties,
  comparables: compsFile.comparables,
  road_stats: compsFile.road_stats || [],
  communities: compsFile.communities || [],
  newbuild_projects: newbuild.projects || [],
  area: areaFile,
  insights: insights.insights || {},
  generic_questions: insights.generic_questions || [],
  method: insights.method || {},
  sources: sourcesFile.sources || [],
  platform_log: sourcesFile.platform_log || []
};
const LS = new RegExp(String.fromCharCode(0x2028), 'g'), PS = new RegExp(String.fromCharCode(0x2029), 'g');
const js = '/* 自動產生，請勿手動編輯。來源：data/*.json；產生指令：node tools/build_bundle.js */\nwindow.RESEARCH_DATA = ' + JSON.stringify(bundle).replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029') + ';\n';
fs.writeFileSync(path.join(ROOT, 'data', 'bundle.js'), js);

// ---- CSV ----
const cell = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const TIER = { visit: '優先看屋', need_info: '先補資料再決定', not_fit: '目前不符合條件' };
const head = ['物件ID', '行動名單', '名稱', '社區', '公開地址', '行政區', '產品階段', '住宅類型', '登記用途', '格局', '樓層', '總樓層', '屋齡(年)', '電梯', '管理費', '最低刊登價(萬)', '最高刊登價(萬)', '有車位', '總價含車位', '車位價(萬)', '車位必買', '預算判斷(8000萬)', '可確認總價(萬)', '預算判斷說明', '主建物(坪)', '附屬建物(坪)', '主+附(坪)', '平台僅揭露之主+附合計(坪)', '共有部分(坪)', '車位(坪)', '權狀總坪', 'A口徑(主建物>=26)', 'B口徑(主+附>=26)', '面積標示', '最近出入口', '步行公尺(估算)', '步行分鐘(估算)', '步行測量方式', '位置精度', '開價÷主建物(萬/坪)', '扣車位建坪單價(萬/坪)', '可售狀態', '平台數', '平台與物件編號', '原始網址', '查閱時間', '臨路或巷內', '主要生活機能', '已深度查核', '第一輪', '主要優點', '主要疑慮', '待確認事項'];
const rows = [head];
for (const p of propsFile.properties) {
  const b = L.budgetStatus(p, 8000), a = L.areaStatus(p, 26), pr = L.priceRange(p) || {}, u = L.askingUnitPrices(p) || {}, an = p.analysis || {}, loc = p.location || {}, price = p.price || {}, ar = p.area || {};
  const S = { ok: '符合', fail: '不符合', unknown: '待確認', over: '超出預算' };
  rows.push([p.id, TIER[an.tier] || '', p.name, p.community, p.address_public, p.district, p.product_stage, p.property_type, p.registered_use, p.layout_text, p.floor, p.total_floors, p.age_years,
    p.elevator === true ? '有' : p.elevator === false ? '無' : '', p.mgmt_fee_text, pr.min, pr.max, price.has_parking === true ? '有' : price.has_parking === false ? '無' : '', price.includes_parking === true ? '是' : price.includes_parking === false ? '否' : '', price.parking_price_wan, price.parking_must_buy === true ? '是' : price.parking_must_buy === false ? '否' : '',
    S[b.status], b.totalWan, b.reason, ar.main_ping, ar.aux_ping, a.mainAux, ar.main_plus_aux_ping, ar.common_ping, ar.parking_ping, ar.total_ping, S[a.A], S[a.B], a.label, loc.nearest_exit, loc.walk_m, loc.walk_min, loc.walk_method, loc.precision,
    L.isNum(u.main) ? u.main.toFixed(2) : '', L.isNum(u.net) ? u.net.toFixed(2) : '', p.availability_status, (p.listings || []).length, (p.listings || []).map(l => l.platform_name + ':' + l.object_no).join(' | '), (p.listings || []).map(l => l.url).join(' | '), (p.listings || []).map(l => l.fetched_at).join(' | '),
    p.street_position, (p.amenities || []).join('、'), an.verified ? '是' : '', an.first_round ? '是' : '', an.headline_pro, an.headline_con, (an.missing || []).join('；')]);
}
fs.mkdirSync(path.join(ROOT, 'exports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'exports', 'properties.csv'), '﻿' + rows.map(r => r.map(cell).join(',')).join('\n') + '\n');

const ch = ['編號', '行政區', '門牌', '交易日', '建物型態', '主要用途', '樓層', '總樓層', '交易時屋齡', '總價(萬)', '有車位', '車位價(萬)', '車位(坪)', '車位可拆分', '總坪', '主建物(坪)', '附屬+陽台(坪)', '共有部分(坪)', '①扣車位建坪單價', '②÷主建物', '③÷主+附', '含車位單價(僅參考)', '備註標記', '備註原文', '來源檔'];
const crow = [ch];
for (const c of compsFile.comparables) crow.push([c.id, c.district, c.address, c.trade_date, c.building_type, c.main_use, c.floor != null ? c.floor : c.floor_raw, c.total_floors, c.age_at_trade, c.price_wan, c.has_parking ? '有' : '無', c.parking_price_wan, c.parking_ping, c.parking_split_ok ? '是' : '否', c.total_ping, c.main_ping, c.aux_ping, c.common_ping, c.unit_net_wan, c.unit_main_wan, c.unit_main_aux_wan, c.unit_gross_incl_parking_wan, (c.flags || []).join('、'), c.remark, c.source_file]);
fs.writeFileSync(path.join(ROOT, 'exports', 'comparables.csv'), '﻿' + crow.map(r => r.map(cell).join(',')).join('\n') + '\n');
console.log('bundle.js', (js.length / 1024).toFixed(0) + ' KB;', propsFile.properties.length, 'properties;', compsFile.comparables.length, 'comparables');
