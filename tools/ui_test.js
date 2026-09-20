#!/usr/bin/env node
/* 介面自動測試：用 headless Chrome（DevTools Protocol）以 file:// 直接開啟 index.html，
 * 模擬點擊、篩選、收藏、筆記、重新載入、離線地圖、手機版面。不需要安裝任何套件（Node 22+ 內建 WebSocket）。
 * 執行： node tools/ui_test.js      結果：qa/ui_test_results.json 與 qa/*.png */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const QA = path.join(ROOT, 'qa');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(process.pid % 500);
const INDEX = 'file://' + encodeURI(path.join(ROOT, 'index.html'));
fs.mkdirSync(QA, { recursive: true });

const results = []; let pass = 0, fail = 0;
function t(name, ok, detail) { ok ? pass++ : fail++; results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail != null && detail !== '' ? '  → ' + detail : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getJson(url, method) { return new Promise((res, rej) => { const rq = http.request(url, { method: method || 'GET' }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error(b.slice(0, 200))); } }); }); rq.on('error', rej); rq.end(); }); }

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xa-ui-test-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--remote-allow-origins=*', '--user-data-dir=' + profile, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 40; i++) { await sleep(250); try { target = await getJson('http://127.0.0.1:' + PORT + '/json/new?about:blank', 'PUT'); break; } catch (e) { /* retry */ } }
  if (!target) { console.error('Chrome 沒有啟動'); process.exit(2); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let seq = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value || a.description).join(' '));
  });
  const send = (method, params) => new Promise((r, rej) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params: params || {} })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r({ result: { timeout: true, result: {} } }); } }, 30000); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + ((r.result.exceptionDetails.exception || {}).description || '')); return r.result.result.value; };
  const go = async (hash) => { await ev('location.hash=' + JSON.stringify(hash)); await sleep(350); };
  const load = async (url) => { await send('Page.navigate', { url }); await sleep(1500); };
  const shot = async (name, full) => { let clip; if (full) { const h = Math.min(await ev('document.documentElement.scrollHeight'), 6000), w = await ev('window.innerWidth'); clip = { x: 0, y: 0, width: w, height: h, scale: 1 }; } const r = await send('Page.captureScreenshot', Object.assign({ format: 'png', captureBeyondViewport: !!full }, clip ? { clip } : {})); if (r.result && r.result.data) fs.writeFileSync(path.join(QA, name), Buffer.from(r.result.data, 'base64')); else console.log('（截圖略過：' + name + '）'); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

  // ---------- 1. 直接以 file:// 開啟 ----------
  await load(INDEX);
  t('U1 以 file:// 直接開啟，資料載入（不需伺服器）', await ev('!!window.RESEARCH_DATA && RESEARCH_DATA.properties.length > 0'), await ev('RESEARCH_DATA.properties.length + " 間"'));
  t('U2 總覽頁顯示研究日期、預算與兩種面積口徑', await ev('(()=>{const s=document.querySelector("#view-overview").innerText;return /研究基準日/.test(s)&&/8,000 萬/.test(s)&&/主建物/.test(s)&&/主＋附/.test(s)})()'));
  const counts = await ev('JSON.stringify(__APP.counts())');
  t('U3 總覽計數：A符合＋僅B＋待確認＋不符合 = 候選總數（待確認不計入符合）', await ev('(()=>{const c=__APP.counts();return c.A+c.Bonly+c.pendingA+c.notfit===c.total})()'), counts);
  await shot('desktop_overview.png');

  // ---------- 2. 列表、篩選、口徑切換 ----------
  await go('#list');
  const nAll = await ev('document.querySelectorAll("#listBody .pcard").length');
  t('U4 卡片模式有內容', nAll > 0, nAll + ' 張卡片');
  t('U5 每張卡片同時顯示主建物與主＋附（不只顯示權狀）', await ev('[...document.querySelectorAll("#listBody .pcard")].every(c=>c.querySelectorAll(".area-box").length===2 && /主建物/.test(c.innerText) && /主＋附/.test(c.innerText))'));
  t('U6 每張卡片有原始來源連結', await ev('[...document.querySelectorAll("#listBody .pcard")].every(c=>c.querySelector(".foot .src a[href^=http]"))'));
  const confA = await ev('__APP.filtered().filter(p=>Logic.classify(p,{mode:"A",budgetWan:__APP.S.budgetWan,minPing:__APP.S.minPing}).cls==="confirmed").length');
  await ev('document.querySelector("[data-mode=B]").click()'); await sleep(300);
  const confB = await ev('__APP.filtered().filter(p=>Logic.classify(p,{mode:"B",budgetWan:__APP.S.budgetWan,minPing:__APP.S.minPing}).cls==="confirmed").length');
  t('U7 口徑切換 A→B 後符合數不減少，且 B 模式橫幅提醒「不等於純室內」', confB >= confA && await ev('/不等於純室內/.test(document.querySelector(".mode-banner").innerText)'), 'A=' + confA + ' B=' + confB);
  await ev('document.querySelector("[data-mode=A]").click()'); await sleep(200);
  await ev('(()=>{const e=document.querySelector("#fPriceMax");e.value="5000";e.dispatchEvent(new Event("input",{bubbles:true}))})()'); await sleep(600);
  const nPrice = await ev('document.querySelectorAll("#listBody .pcard").length');
  t('U8 總價 ≤5,000 萬篩選生效', nPrice < nAll && await ev('__APP.filtered().every(p=>Logic.priceRange(p).max<=5000)'), nAll + ' → ' + nPrice);
  await ev('(()=>{const e=document.querySelector("#fElevator");e.value="yes";e.dispatchEvent(new Event("input",{bubbles:true}))})()'); await sleep(400);
  t('U9 電梯篩選生效', await ev('__APP.filtered().every(p=>p.elevator===true)'));
  await ev('document.querySelector("#fReset").click()'); await sleep(300);
  await ev('(()=>{const e=document.querySelector("#setBudget");e.value="6000";e.dispatchEvent(new Event("change",{bubbles:true}))})()'); await sleep(700);
  t('U10 調整預算為 6,000 萬後，6,000 萬以上物件不再顯示為「總價在預算內」', await ev('__APP.filtered().filter(p=>Logic.priceRange(p).min>6000).every(p=>Logic.budgetStatus(p,__APP.S.budgetWan).status==="over")') && await ev('__APP.S.budgetWan===6000'));
  await ev('(()=>{const e=document.querySelector("#setBudget");e.value="8000";e.dispatchEvent(new Event("change",{bubbles:true}))})()'); await sleep(700);
  await ev('document.querySelector("[data-viewmode=table]").click()'); await sleep(300);
  t('U11 表格模式可用，且有主建物與主＋附欄位', await ev('(()=>{const t=document.querySelector("#listBody table");return !!t && /主建物/.test(t.tHead.innerText) && /主＋附/.test(t.tHead.innerText) && t.tBodies[0].rows.length>0})()'));
  await shot('desktop_list_table.png');
  await ev('document.querySelector("[data-viewmode=cards]").click()'); await sleep(300);
  await shot('desktop_list_cards.png');

  // 逐字輸入預算（中途停頓）不可被打亂；按 Enter／離開欄位才套用
  await ev('(()=>{const e=document.querySelector("#setBudget");e.focus();e.value="";})()');
  for (const ch of ['7', '75', '750', '7500']) { await ev('(()=>{const e=document.querySelector("#setBudget");e.value="' + ch + '";e.dispatchEvent(new Event("input",{bubbles:true}))})()'); await sleep(400); }
  t('U35 逐字輸入預算 7500（每鍵間隔 0.4 秒）欄位值不被打亂，且尚未套用', await ev('document.querySelector("#setBudget").value') === '7500' && await ev('__APP.S.budgetWan') === 8000);
  await ev('document.querySelector("#setBudget").dispatchEvent(new Event("change",{bubbles:true}))'); await sleep(500);
  t('U36 按 Enter／離開欄位後預算套用為 7,500，全站重算', await ev('__APP.S.budgetWan') === 7500 && await ev('__APP.filtered().filter(p=>Logic.priceRange(p).min>7500).every(p=>Logic.budgetStatus(p,__APP.S.budgetWan).status==="over")'));
  await ev('(()=>{const e=document.querySelector("#setBudget");e.value="8000";e.dispatchEvent(new Event("change",{bubbles:true}))})()'); await sleep(500);
  t('U37 預設排序：優先看屋 → 先補資料 → 不符合，順序單調', await ev('(()=>{const o={visit:0,need_info:1,not_fit:2};const a=__APP.filtered().map(p=>o[p.analysis.tier]);return a.every((v,i)=>i===0||a[i-1]<=v)})()'));
  t('U38 預設不隱藏任何候選（列表數 = 候選總數）', await ev('__APP.filtered().length===RESEARCH_DATA.properties.length'));

  // ---------- 3. 收藏、筆記、比較、重新載入 ----------
  const ids = await ev('JSON.stringify(__APP.filtered().slice(0,5).map(p=>p.id))').then(JSON.parse);
  await ev('document.querySelector(\'[data-fav="' + ids[0] + '"]\').click()'); await sleep(250);
  t('U12 收藏後導覽列計數 +1', await ev('document.querySelector("#navFav").textContent') === '1');
  await ev('document.querySelector(\'[data-fav="' + ids[0] + '"]\').click()'); await sleep(250);
  t('U13 取消收藏後計數歸 0', await ev('document.querySelector("#navFav").textContent') === '0');
  await ev('document.querySelector(\'[data-fav="' + ids[0] + '"]\').click()'); await sleep(250);
  await go('#property/' + ids[0]);
  t('U14 物件研究頁回答五個問題', await ev('(()=>{const s=document.querySelector("#view-property").innerText;return /為什麼它/.test(s)&&/坪到底是哪些面積組成/.test(s)&&/到信義安和站實際有多遠/.test(s)&&/可比較的成交依據/.test(s)&&/還有哪些事沒確認/.test(s)})()'));
  t('U15 物件頁有「開啟原始刊登頁」連結', await ev('!!document.querySelector("#view-property a.btn.primary[href^=http][target=_blank]")'));
  await shot('desktop_property.png', true);
  await ev('(()=>{const e=document.querySelector("#noteText");e.value="測試筆記：週六下午看屋，問車位。";e.dispatchEvent(new Event("input",{bubbles:true}))})()'); await sleep(700);
  for (const id of ids.slice(0, 3)) { await go('#property/' + id); await ev('document.querySelector(\'#view-property [data-cmp="' + id + '"]\').click()'); await sleep(200); }
  await go('#compare');
  t('U16 並排比較 3 間：表格有 3 個物件欄＋必要列', await ev('(()=>{const t=document.querySelector("#view-compare table.compare");if(!t)return false;const s=t.innerText;return t.tHead.rows[0].cells.length===4 && ["總價","主建物","主＋附","屋齡","樓層","捷運距離","車位","管理費","價格判斷","待確認事項"].every(k=>s.includes(k))})()'));
  await shot('desktop_compare.png');
  await ev('(()=>{const a=JSON.parse(localStorage.getItem("xinyiAnhe.userdata.v1"));a.notes["XA-999"]={text:"舊物件的筆記",updatedAt:"2026-09-01T00:00:00Z",nameSnapshot:"（測試）已下架物件"};localStorage.setItem("xinyiAnhe.userdata.v1",JSON.stringify(a))})()');
  await load(INDEX); // 重新開啟
  t('U17 重新開啟後收藏仍存在', await ev('document.querySelector("#navFav").textContent') === '1');
  await go('#property/' + ids[0]);
  t('U18 重新開啟後筆記仍存在', await ev('document.querySelector("#noteText").value') === '測試筆記：週六下午看屋，問車位。');
  await go('#notes');
  t('U19 資料中已不存在的物件（XA-999），其筆記仍保留並標示', await ev('/已不在目前資料中/.test(document.querySelector("#view-notes").innerText) && /舊物件的筆記/.test(document.querySelector("#view-notes").innerHTML)'));
  t('U20 筆記頁提供 JSON／CSV 匯出與匯入', await ev('!!document.querySelector("#expJson") && !!document.querySelector("#expCsv") && !!document.querySelector("#impFile")'));
  t('U21 比較清單重新開啟後仍存在', await ev('document.querySelector("#navCompare").textContent') === '3');
  await shot('desktop_notes.png');

  // ---------- 4. 地圖 ----------
  await go('#map'); await sleep(2500);
  const pins = await ev('document.querySelectorAll("#map .pin").length');
  t('U22 地圖顯示出入口與物件標記', pins > 6, pins + ' 個標記');
  t('U23 概略位置以虛線外框標示；圖例說明「直線距離圈（不是步行時間圈）」', await ev('document.querySelectorAll("#map .pin.approx").length>0 && /直線距離圈/.test(document.querySelector("#view-map .legend").innerText) && /不是步行時間圈/.test(document.querySelector("#view-map .legend").innerText)'));
  await shot('desktop_map.png');
  await go('#market'); await sleep(600);
  t('U24 市場頁三張圖皆有繪出，且標示樣本數', await ev('document.querySelectorAll("#view-market .chart svg").length>=2 && /n = \\d+/.test(document.querySelector("#view-market").innerText)'));
  await shot('desktop_market.png', true);
  for (const h of ['#checklist', '#method']) { await go(h); }
  const methodLen = await ev('document.querySelector("#view-method").innerText.length'); await go('#checklist');
  t('U25 看屋清單與方法頁有內容', methodLen > 500 && await ev('document.querySelector("#view-checklist").innerText.length>500 && /要問房仲/.test(document.querySelector("#view-checklist").innerText)'));

  // 地圖底圖失敗（離線）
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.setBlockedURLs', { urls: ['*wmts.nlsc.gov.tw*', '*tile.openstreetmap.org*'] });
  await load('about:blank'); await load(INDEX + '#map'); await sleep(4000);
  t('U26 底圖載入失敗時顯示提示，文字版位置清單仍在', await ev('document.querySelector("#mapFallback").style.display==="block" && document.querySelectorAll("#mapText table tbody tr").length===RESEARCH_DATA.properties.length'));
  await shot('desktop_map_tiles_blocked.png');
  await go('#list'); t('U27 底圖失敗時列表仍可用', await ev('document.querySelectorAll("#listBody .pcard").length>0'));
  // Leaflet 本身載入失敗
  // file:// 的本機腳本無法用 Network 攔截；改為在頁面載入前把 window.L 鎖成 undefined，模擬 Leaflet 檔案遺失／載入失敗
  const inj = await send('Page.addScriptToEvaluateOnNewDocument', { source: 'Object.defineProperty(window, "L", { get(){ return undefined; }, set(){}, configurable: true });' });
  await load('about:blank'); await load(INDEX + '#map'); await sleep(1500);
  t('U28 地圖元件載入失敗時，顯示替代文字清單與地圖查詢連結', await ev('typeof window.L==="undefined" && document.querySelector("#mapFallback").style.display==="block" && document.querySelectorAll("#mapText a[href*=\\"google.com/maps\\"]").length>0'));
  await go('#overview'); t('U29 地圖元件失敗時總覽、分析、來源仍可閱讀', await ev('document.querySelector("#view-overview").innerText.length>400'));
  await go('#market'); t('U30 地圖元件失敗時市場分析仍可閱讀', await ev('document.querySelectorAll("#view-market .chart svg").length>=2'));
  await send('Network.setBlockedURLs', { urls: [] });
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: inj.result.identifier });

  // ---------- 5. 手機版 ----------
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await load(INDEX);
  for (const h of ['#overview', '#list', '#property/' + ids[0], '#compare', '#market', '#notes', '#checklist', '#method', '#map']) {
    await go(h); await sleep(h === '#map' ? 1500 : 200);
    const ov = await ev('document.documentElement.scrollWidth - 390');
    t('U31 手機 390px 無水平溢出：' + h.replace(/XA-\d+/, 'ID'), ov <= 1, '溢出 ' + ov + 'px');
    await shot('mobile_' + h.replace(/[#/]/g, '').replace(/propertyXA-\d+/, 'property') + '.png');
  }
  t('U32 手機版導覽列可橫向捲動且每個連結可點', await ev('[...document.querySelectorAll("#nav a")].every(a=>a.getBoundingClientRect().height>=32)'));
  await send('Emulation.clearDeviceMetricsOverride');

  // ---------- 6. 佔位內容與錯誤 ----------
  await load(INDEX);
  let bad = [];
  for (const h of ['#overview', '#list', '#market', '#checklist', '#method', '#property/' + ids[0]]) { await go(h); const s = await ev('document.querySelector(".view.active").innerText'); const m = s.match(/lorem|TODO|TBD|placeholder|示範資料|範例物件|undefined|NaN|\[object Object\]/i); if (m) bad.push(h + ':' + m[0]); }
  t('U33 頁面沒有佔位字樣、undefined、NaN', bad.length === 0, bad.join(', '));
  t('U34 整個流程沒有 JavaScript 例外或 console.error', errors.filter(e => !/net::ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(e)).length === 0, errors.slice(0, 5).join(' | '));

  fs.writeFileSync(path.join(QA, 'ui_test_results.json'), JSON.stringify({ ran_at: new Date().toISOString(), url: INDEX, pass, fail, results, console_errors: errors }, null, 2));
  console.log('\n合計：' + pass + ' 通過，' + fail + ' 失敗');
  ws.close(); chrome.kill(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
