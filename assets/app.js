/* 信義安和站購屋研究 — 主程式（純前端、無後端、無登入）
 * 資料：data/bundle.js（由 tools/build_bundle.js 從 data/*.json 產生）
 * 個人資料（收藏／筆記／比較清單／設定）只存在瀏覽器 localStorage，
 * 與房源資料完全分離：更新 data/ 不會覆蓋或刪除個人資料。 */
(function () {
  'use strict';
  var D = window.RESEARCH_DATA;
  var L = window.Logic;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  if (!D || !L) {
    var be = document.getElementById('bootError');
    be.style.display = 'block';
    be.innerHTML = '<p><b>資料檔沒有載入。</b>請確認 <code>data/bundle.js</code> 與 <code>assets/logic.js</code> 和 index.html 在同一個資料夾結構內。文字版研究結果請開啟 <a href="research_summary.md">research_summary.md</a>。</p>';
    return;
  }

  /* ---------- helpers ---------- */
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : '#'; }
  function relUrl(u) { return /^[\w\-./%]+$/.test(u || '') ? u : ''; }
  var isNum = L.isNum, fmt = L.fmt, fmtPing = L.fmtPing;
  function wan(n) { return isNum(n) ? fmt(n) + ' 萬' : '未揭露'; }
  function ping(n) { return isNum(n) ? fmtPing(n) + ' 坪' : '未揭露'; }
  function val(v, suffix) { return (v == null || v === '') ? '<span class="muted">未揭露／待確認</span>' : esc(v) + (suffix || ''); }
  function yn(v) { return v === true ? '有' : v === false ? '無' : '未揭露'; }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function byId(id) { return PROPS_BY_ID[id]; }
  function dateOnly(s) { return (s || '').slice(0, 10); }

  var PROPS = D.properties || [];
  var PROPS_BY_ID = {}; PROPS.forEach(function (p) { PROPS_BY_ID[p.id] = p; });
  var COMPS = D.comparables || [];
  var COMPS_BY_ID = {}; COMPS.forEach(function (c) { COMPS_BY_ID[c.id] = c; });
  var TIER = { visit: { label: '優先看屋', cls: 'ok', icon: '★' }, need_info: { label: '先補資料再決定', cls: 'warn', icon: '？' }, not_fit: { label: '目前不符合條件', cls: 'bad', icon: '✕' } };

  /* ---------- storage（個人資料與房源資料分離） ---------- */
  var UKEY = 'xinyiAnhe.userdata.v1', SKEY = 'xinyiAnhe.settings.v1';
  var memoryStore = {};
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return memoryStore[k] || null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { memoryStore[k] = v; return false; } }
  var U = lsGet(UKEY) || { version: 1, favorites: {}, notes: {}, compare: [] };
  U.favorites = U.favorites || {}; U.notes = U.notes || {}; U.compare = U.compare || [];
  var S = Object.assign({ budgetWan: L.DEFAULTS.budgetWan, minPing: L.DEFAULTS.minPing, mode: 'A', viewMode: 'cards', sort: 'rank', theme: null,
    f: { priceMax: null, priceMin: null, mainMin: null, mainAuxMin: null, walkMax: null, ageMax: null, roomsMin: null, elevator: 'any', parking: 'any', stage: 'all', status: 'all', tier: 'all', favOnly: false, q: '' } }, lsGet(SKEY) || {});
  if (!isNum(S.budgetWan) || S.budgetWan <= 0) S.budgetWan = L.DEFAULTS.budgetWan;
  if (!isNum(S.minPing) || S.minPing <= 0) S.minPing = L.DEFAULTS.minPing;
  if (!S.f || typeof S.f !== 'object') S.f = {};
  var storageWarned = false;
  function saveU() { var ok = lsSet(UKEY, U); updateCounts(); if (!ok && !storageWarned) { storageWarned = true; toast('⚠ 這個瀏覽器不允許本機儲存（可能是隱私模式）：收藏與筆記在關閉分頁後會消失，請先匯出備份'); } return ok; }
  function saveS() { lsSet(SKEY, S); }
  function opts() { return { mode: S.mode, budgetWan: S.budgetWan, minPing: S.minPing }; }
  function cls(p, mode) { var o = opts(); if (mode) o.mode = mode; return L.classify(p, o); }

  if (S.theme) document.documentElement.setAttribute('data-theme', S.theme);
  $('#themeBtn').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    S.theme = cur === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', S.theme); saveS();
  });

  /* ---------- shared renderers ---------- */
  function statusBadges(p) {
    var c = cls(p), out = [];
    var b = c.budget, a = c.area, w = c.walk;
    out.push('<span class="badge ' + (b.status === 'ok' ? 'ok' : b.status === 'over' ? 'bad' : 'warn') + '" title="' + esc(b.reason) + '">' + (b.status === 'ok' ? '✓ 總價在預算內' : b.status === 'over' ? '✕ 超出預算' : '？ 總價待確認') + '</span>');
    if (a.A === 'ok') out.push('<span class="badge ok">✓ 主建物≥' + S.minPing + '坪</span>');
    else if (a.B === 'ok') out.push('<span class="badge info">△ 主＋附符合' + S.minPing + '坪；主建物未達' + S.minPing + '坪</span>');
    else if (a.A === 'fail' && a.B === 'fail') out.push('<span class="badge bad">✕ 兩種口徑皆未達' + S.minPing + '坪</span>');
    else out.push('<span class="badge warn">？ 面積待確認</span>');
    out.push('<span class="badge ' + (w.zone === 'primary' ? 'ok' : w.zone === 'extended' ? 'info' : w.zone === 'out' ? 'bad' : 'warn') + '">' + (w.zone === 'primary' ? '✓ ' : w.zone === 'extended' ? '△ ' : w.zone === 'out' ? '✕ ' : '？ ') + esc(w.label) + '</span>');
    if (p.residential_ok === false) out.push('<span class="badge bad">✕ 非一般完整住宅</span>');
    else if (p.residential_ok == null) out.push('<span class="badge warn">？ 登記用途待確認</span>');
    return '<div class="badges">' + out.join('') + '</div>';
  }
  function tierBadge(p) { var t = TIER[(p.analysis || {}).tier]; return t ? '<span class="badge ' + t.cls + '">' + t.icon + ' ' + t.label + '</span>' : ''; }
  function stageBadge(p) { return '<span class="badge neutral">' + esc(p.product_stage || '類型待確認') + '</span>'; }
  function priceText(p) {
    var pr = L.priceRange(p); if (!pr) return '開價未揭露';
    return pr.min !== pr.max ? fmt(pr.min) + '～' + fmt(pr.max) + ' 萬' : fmt(pr.max) + ' 萬';
  }
  function walkText(p) {
    var l = p.location || {}; if (!isNum(l.walk_min)) return '步行時間待確認' + (isNum(l.rough_walk_min) ? '（路段粗估約 ' + l.rough_walk_min + ' 分，誤差大）' : '');
    return '出口' + esc(l.nearest_exit) + ' 約 ' + l.walk_min + ' 分（' + fmt(l.walk_m, 0) + ' m）';
  }
  function precisionNote(p) {
    var pr = (p.location || {}).precision;
    return pr === 'platform_coord' ? '平台提供座標（可能偏移，非門牌）' : pr === 'road_only' ? '僅知路段，概略位置' : pr === 'district_only' ? '僅知行政區' : '位置待確認';
  }
  function layoutText(p) { return p.layout_text || (isNum(p.rooms) ? p.rooms + '房' + (isNum(p.halls) ? p.halls + '廳' : '') + (isNum(p.baths) ? p.baths + '衛' : '') : '格局未揭露'); }
  function floorText(p) { return (p.floor != null ? esc(p.floor) : '？') + ' / ' + (p.total_floors != null ? esc(p.total_floors) : '？') + ' 樓'; }
  function sourceLinks(p, max) {
    return (p.listings || []).slice(0, max || 9).map(function (l) {
      return '<a href="' + esc(safeUrl(l.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(l.platform_name) + ' ↗</a>';
    }).join('');
  }
  function favBtn(p, small) { var on = !!U.favorites[p.id]; return '<button type="button" class="btn fav ' + (small ? 'small' : '') + '" data-fav="' + esc(p.id) + '" aria-pressed="' + on + '">' + (on ? '★ 已收藏' : '☆ 收藏') + '</button>'; }
  function cmpBtn(p, small) { var on = U.compare.indexOf(p.id) >= 0; return '<button type="button" class="btn ' + (small ? 'small' : '') + '" data-cmp="' + esc(p.id) + '" aria-pressed="' + on + '">' + (on ? '✓ 已加入比較' : '＋ 比較') + '</button>'; }

  /* ---------- OVERVIEW ---------- */
  function counts() {
    var c = { total: PROPS.length, A: 0, Bonly: 0, pendingA: 0, notfit: 0, over: 0, needPrice: 0, needArea: 0, needLoc: 0, needUse: 0, primary: 0, extended: 0 };
    PROPS.forEach(function (p) {
      var a = cls(p, 'A'), b = cls(p, 'B');
      if (a.cls === 'confirmed') c.A++;
      else if (b.cls === 'confirmed') c.Bonly++;
      else if (a.cls === 'pending' || b.cls === 'pending') c.pendingA++;
      else c.notfit++;
      if (a.budget.status === 'over') c.over++;
      if (a.budget.status === 'unknown') c.needPrice++;
      if (a.area.A === 'unknown' || a.area.B === 'unknown') c.needArea++;
      if (a.walk.zone === 'unknown') c.needLoc++;
      if (p.residential_ok == null) c.needUse++;
      if (a.walk.zone === 'primary') c.primary++; if (a.walk.zone === 'extended') c.extended++;
    });
    return c;
  }
  function renderOverview() {
    var m = D.meta, c = counts(), ins = D.insights || {};
    var allVisit = PROPS.filter(function (p) { return (p.analysis || {}).tier === 'visit'; }).sort(function (a, b) { return (a.analysis.rank || 999) - (b.analysis.rank || 999); });
    var picks = allVisit.filter(function (p) { return p.analysis.first_round; });
    var second = allVisit.filter(function (p) { return !p.analysis.first_round; });
    var h = '';
    h += '<div class="card hero"><h1 id="h-overview">信義安和站周邊購屋研究</h1>' +
      '<p class="lead">' + esc(ins.one_liner || '') + '</p>' +
      '<div class="kv-row"><span>研究基準日 <b>' + esc(m.research_date) + '</b></span><span>搜尋中心 <b>捷運信義安和站（R04，大安區）6 個出入口</b></span>' +
      '<span>範圍 <b>步行 ≤10 分（優先）／10–15 分（擴大）</b></span><span>預算上限 <b class="num">' + fmt(S.budgetWan) + ' 萬（含）</b></span>' +
      '<span>面積口徑 <b>A 主建物 ≥' + S.minPing + ' 坪（預設）／B 主＋附 ≥' + S.minPing + ' 坪</b></span></div>' +
      (S.budgetWan !== L.DEFAULTS.budgetWan || S.minPing !== L.DEFAULTS.minPing ? '<div class="callout warn" style="margin-top:12px"><p>你已調整預算或坪數門檻，以下數字依調整後條件即時重算。<button class="btn small" type="button" id="resetCriteria">恢復 8,000 萬／26 坪</button></p></div>' : '') +
      '</div>';

    h += '<div class="grid cols-4 section" style="margin-top:14px">' +
      stat('查得不重複候選', c.total, '跨平台去重後；含不符合者', '') +
      stat('A 口徑已確認符合', c.A, '主建物≥' + S.minPing + '坪＋總價≤預算＋步行≤15分（依刊登頁數字）', 'ok') +
      stat('僅 B 口徑符合', c.Bonly, '主＋附≥' + S.minPing + '坪，但主建物未達', '') +
      stat('關鍵資料待確認', c.pendingA, '總價、面積、位置或用途至少一項不明；不計入符合', 'warn') +
      '</div>' +
      '<div class="grid cols-4" style="margin-top:14px">' +
      stat('目前不符合', c.notfit, '其中超出預算 ' + c.over + ' 間', 'bad') +
      stat('總價待確認', c.needPrice, '多為車位是否含在總價／是否必買不明', '') +
      stat('面積待確認', c.needArea, '缺主建物或附屬建物拆分、或登記疑義', '') +
      stat('步行範圍', c.primary + '／' + c.extended, '≤10 分／10–15 分（地圖估算）', '') +
      '</div>' +
      '<div class="grid cols-4" style="margin-top:14px">' +
      stat('位置待確認', c.needLoc, '只有路段或行政區，沒有可用座標', '') +
      stat('住宅用途待確認', c.needUse, '登記用途含非住家項目或含地下層', '') +
      stat('已逐間深度查核', PROPS.filter(function (p) { return (p.analysis || {}).verified; }).length, '核對原始頁、當日重抓、逐筆找同棟成交', '') +
      stat('有刊登頁截圖', PROPS.filter(function (p) { return (p.screenshots || []).length; }).length, '自動擷取；其餘可由原始連結開啟', '') +
      '</div>' +
      '<p class="small muted" style="margin-top:8px">「總價／面積／位置／用途待確認」四個數字是跨類別計數，可能重複，也包含已判為不符合者。所有物件的狀態皆為「研究日查得刊登頁，實際可售狀態待確認」。本研究未聯絡任何房仲；「已確認符合」僅代表刊登頁揭露的數字符合條件，仍須以謄本與不動產說明書核實。</p>';

    h += '<div class="grid cols-3 section">';
    h += '<div class="card card-pad answer"><h3>① 目前最值得研究的方向</h3>' + listHtml(ins.direction) + '</div>';
    h += '<div class="card card-pad answer"><h3>② 哪些物件值得優先看</h3>' + (picks.length ? '<ol class="tight">' + picks.slice(0, 8).map(function (p) { return '<li><a href="#property/' + esc(p.id) + '">' + esc(p.name) + '</a>｜' + priceText(p) + '｜主建物 ' + ping(p.area.main_ping) + '</li>'; }).join('') + '</ol><p class="small">理由見下方「第一輪優先看屋」。</p>' : '<p class="muted">目前沒有足以列為優先看屋的物件。</p>') + '</div>';
    h += '<div class="card card-pad answer"><h3>③ 哪些資訊尚不足</h3>' + listHtml(ins.gaps) + '</div>';
    h += '</div>';

    h += '<div class="section"><h2>第一輪優先看屋（' + picks.length + ' 間）與排序理由</h2><div class="card card-pad">' +
      '<p class="small muted">這 ' + picks.length + ' 間都經過逐間深度查核（核對原始刊登頁、當日重抓確認、逐筆比對同棟成交）。排序是研究員綜合判斷：硬條件是否乾淨 → 開價有沒有可驗證的成交依據 → 產品與屋況的不確定性 → 步行距離，理由逐間寫在下方；不是以「最接近 8,000 萬」或「資料最完整」排序。入圍查核時三類產品（較新電梯大樓、老電梯華廈、無電梯公寓）各留了名額，但查核後較新大樓與無電梯公寓都有未解決的問題，已改列「先補資料」或第二輪，所以第一輪目前都是 40 年以上的電梯華廈／大樓。</p>' +
      (picks.length ? picks.map(function (p, i) {
        return '<div class="pick"><div class="rank">' + (i + 1) + '</div><div><h4><a href="#property/' + esc(p.id) + '">' + esc(p.name) + '</a> <span class="muted small">' + esc(p.id) + '</span></h4>' +
          '<div class="facts num">' + priceText(p) + '｜主建物 ' + ping(p.area.main_ping) + '｜主＋附 ' + ping(L.areaStatus(p).mainAux) + '｜' + (isNum(p.age_years) ? p.age_years + ' 年' : '屋齡未揭露') + '｜' + esc(layoutText(p)) + '｜' + walkText(p) + '</div>' +
          '<div class="small" style="margin-top:4px">' + esc((p.analysis.rank_reason || p.analysis.headline_pro || '')) + '</div></div>' +
          '<div class="actions" style="display:flex;gap:6px;flex-wrap:wrap">' + favBtn(p, true) + cmpBtn(p, true) + '</div></div>';
      }).join('') : '<p class="muted">—</p>') +
      '<p class="small" style="margin-top:10px">另有 <b>' + second.length + '</b> 間「條件符合、列為第二輪候補」的物件（規則式初判、尚未逐間深度查核）：<a href="#list" data-preset="visit">在列表中檢視 →</a></p></div></div>';

    h += '<div class="section"><h2>三種行動名單</h2><div class="grid cols-3">' + ['visit', 'need_info', 'not_fit'].map(function (t) {
      var arr = PROPS.filter(function (p) { return (p.analysis || {}).tier === t; }).sort(function (a, b) { return (a.analysis.rank || 99) - (b.analysis.rank || 99); });
      return '<div class="card card-pad"><h3><span class="badge ' + TIER[t].cls + '">' + TIER[t].icon + ' ' + TIER[t].label + '</span> <span class="muted small">' + arr.length + ' 間</span></h3>' +
        '<ul class="tight small">' + arr.slice(0, 10).map(function (p) { return '<li><a href="#property/' + esc(p.id) + '">' + esc(p.name) + '</a>（' + priceText(p) + '）' + (p.analysis.verified ? ' <span class="badge neutral">已深度查核</span>' : '') + '<br><span class="muted">' + esc(p.analysis.tier_reason || '') + '</span></li>'; }).join('') + '</ul>' +
        (arr.length > 10 ? '<p class="small"><a href="#list" data-preset="' + t + '">查看全部 ' + arr.length + ' 間 →</a></p>' : '') + '</div>';
    }).join('') + '</div><p class="small muted" style="margin-top:8px">行動名單是研究團隊以預設條件（8,000 萬／26 坪）所做的判斷；上方數字卡則會隨你調整的預算與坪數即時重算，兩者口徑不同時以你自己的設定為準。</p></div>';

    h += '<div class="section"><h2>不同預算帶可以換到什麼</h2>' + bandTable() + '<div class="card card-pad" style="margin-top:12px">' + listHtml(ins.budget_bands) + '</div></div>';
    h += '<div class="section"><h2>步行 5 分、10 分與 10–15 分的差異</h2>' + walkBandTable() + '<div class="card card-pad" style="margin-top:12px">' + listHtml(ins.walk_bands) + '</div></div>';
    $('#view-overview').innerHTML = h;
  }
  function stat(label, value, sub, kind) { return '<div class="card stat ' + kind + '"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div><div class="sub">' + esc(sub) + '</div></div>'; }
  function listHtml(arr) { if (!arr || !arr.length) return '<p class="muted">—</p>'; return '<ul class="tight">' + arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; }
  function groupStats(items) {
    var mains = items.map(function (p) { return p.area.main_ping; }).filter(isNum), ages = items.map(function (p) { return p.age_years; }).filter(isNum);
    var elev = items.filter(function (p) { return p.elevator === true; }).length, park = items.filter(function (p) { return (p.price || {}).has_parking === true; }).length;
    var aOk = items.filter(function (p) { return L.areaStatus(p, S.minPing).A === 'ok'; }).length;
    return { n: items.length, main: L.median(mains), mainMin: mains.length ? Math.min.apply(null, mains) : null, mainMax: mains.length ? Math.max.apply(null, mains) : null, age: L.median(ages), elev: elev, park: park, aOk: aOk };
  }
  function bandTable() {
    var bands = [[0, 4000], [4000, 5500], [5500, 7000], [7000, 8000], [8000, 1e9]];
    var rows = bands.map(function (b) {
      var items = PROPS.filter(function (p) { var pr = L.priceRange(p); return pr && pr.max > b[0] && pr.max <= b[1] && p.product_stage !== '預售屋'; });
      var g = groupStats(items);
      return '<tr><td>' + (b[1] > 1e8 ? '超過 ' + fmt(b[0]) + ' 萬（超出預算）' : fmt(b[0]) + '–' + fmt(b[1]) + ' 萬') + '</td><td class="r">' + g.n + '</td><td class="r">' + g.aOk + '</td><td class="r">' + (g.n ? fmtPing(g.main) + '（' + fmtPing(g.mainMin) + '–' + fmtPing(g.mainMax) + '）' : '—') + '</td><td class="r">' + (isNum(g.age) ? fmt(g.age, 1) : '—') + '</td><td class="r">' + g.elev + ' / ' + g.n + '</td><td class="r">' + g.park + ' / ' + g.n + '</td></tr>';
    }).join('');
    return '<div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>開價帶（最高刊登價）</th><th class="r">候選數</th><th class="r">主建物≥' + S.minPing + '坪</th><th class="r">主建物中位數（範圍）坪</th><th class="r">屋齡中位數</th><th class="r">有電梯</th><th class="r">有車位</th></tr></thead><tbody>' + rows + '</tbody></table></div><p class="small muted">樣本為本研究查得的在售候選（已初篩：主建物約 24 坪以上或主＋附 26 坪以上），不是整體市場；各帶樣本很少，僅供描述，不做因果推論。</p>';
  }
  function walkBandTable() {
    var bands = [[0, 5, '≤5 分'], [5, 10, '5–10 分'], [10, 15, '10–15 分']];
    var rows = bands.map(function (b) {
      var items = PROPS.filter(function (p) { var w = (p.location || {}).walk_min; return isNum(w) && w > b[0] && w <= b[1] || (b[0] === 0 && w === 0); });
      var g = groupStats(items); var prices = items.map(function (p) { var pr = L.priceRange(p); return pr ? pr.max : null; }).filter(isNum);
      var units = items.map(function (p) { var u = L.askingUnitPrices(p); return u ? u.main : null; }).filter(isNum);
      return '<tr><td>' + b[2] + '</td><td class="r">' + g.n + '</td><td class="r">' + (prices.length ? fmt(L.median(prices), 0) : '—') + '</td><td class="r">' + (g.n ? fmtPing(g.main) : '—') + '</td><td class="r">' + (units.length ? fmt(L.median(units), 1) + '（n=' + units.length + '）' : '—') + '</td><td class="r">' + (isNum(g.age) ? fmt(g.age, 1) : '—') + '</td><td class="r">' + g.elev + ' / ' + g.n + '</td></tr>';
    }).join('');
    return '<div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>步行時間帶（地圖估算）</th><th class="r">候選數</th><th class="r">開價中位數（萬）</th><th class="r">主建物中位數（坪）</th><th class="r">開價÷主建物 中位數（萬/坪）</th><th class="r">屋齡中位數</th><th class="r">有電梯</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ---------- LIST ---------- */
  function filtered() {
    var f = S.f, q = (f.q || '').trim().toLowerCase();
    var arr = PROPS.filter(function (p) {
      var pr = L.priceRange(p), a = p.area || {}, w = (p.location || {}).walk_min, c = cls(p);
      if (isNum(f.priceMax) && (!pr || pr.max > f.priceMax)) return false;
      if (isNum(f.priceMin) && (!pr || pr.max < f.priceMin)) return false;
      if (isNum(f.mainMin) && !(isNum(a.main_ping) && a.main_ping >= f.mainMin)) return false;
      if (isNum(f.mainAuxMin)) { var ma = L.areaStatus(p).mainAux; if (!(isNum(ma) && ma >= f.mainAuxMin)) return false; }
      if (isNum(f.walkMax) && isNum(w) && w > f.walkMax) return false;
      if (isNum(f.ageMax) && !(isNum(p.age_years) && p.age_years <= f.ageMax)) return false;
      if (isNum(f.roomsMin) && !(isNum(p.rooms) && p.rooms >= f.roomsMin)) return false;
      if (f.elevator === 'yes' && p.elevator !== true) return false;
      if (f.elevator === 'no' && p.elevator !== false) return false;
      if (f.parking === 'yes' && (p.price || {}).has_parking !== true) return false;
      if (f.parking === 'no' && (p.price || {}).has_parking !== false) return false;
      if (f.stage !== 'all' && p.product_stage !== f.stage) return false;
      if (f.status !== 'all' && c.cls !== f.status) return false;
      if (f.tier !== 'all' && (p.analysis || {}).tier !== f.tier) return false;
      if (f.favOnly && !U.favorites[p.id]) return false;
      if (f.verifiedOnly && !(p.analysis || {}).verified) return false;
      if (q) { var hay = [p.name, p.community, p.address_public, p.id, p.district, p.property_type].concat((p.listings || []).map(function (l) { return l.object_no + ' ' + l.platform_name; })).join(' ').toLowerCase(); if (hay.indexOf(q) < 0) return false; }
      return true;
    });
    var key = S.sort, ord = { confirmed: 0, pending: 1, not_fit: 2 }, tord = { visit: 0, need_info: 1, not_fit: 2 };
    arr.sort(function (x, y) {
      function g(p) {
        switch (key) {
          case 'price': return (L.priceRange(p) || {}).max;
          case 'price_desc': return -((L.priceRange(p) || {}).max || 0);
          case 'main': return -(p.area.main_ping || 0);
          case 'walk': return isNum((p.location || {}).walk_min) ? p.location.walk_min : 999;
          case 'age': return isNum(p.age_years) ? p.age_years : 999;
          case 'unit': var u = L.askingUnitPrices(p); return u && isNum(u.main) ? u.main : 1e9;
          case 'status': return ord[cls(p).cls];
          default: var tt = tord[(p.analysis || {}).tier]; return (tt == null ? 9 : tt) * 10000 + ((p.analysis || {}).rank || 9999);
        }
      }
      var a = g(x), b = g(y); if (a == null) a = 1e12; if (b == null) b = 1e12; return a - b || x.id.localeCompare(y.id);
    });
    return arr;
  }
  function numField(id, label, value, step, ph) { return '<label class="field">' + label + '<input type="number" inputmode="decimal" id="' + id + '" value="' + (isNum(value) ? value : '') + '" step="' + (step || 1) + '" placeholder="' + (ph || '不限') + '"></label>'; }
  function selField(id, label, value, options) { return '<label class="field">' + label + '<select id="' + id + '">' + options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>'; }
  function renderList() {
    var f = S.f, h = '';
    h += '<div class="page-title"><div><h1 id="h-list">房源列表與篩選</h1><p>每張卡片同時顯示主建物與主＋附；權狀總坪不會被單獨放大。</p></div></div>';
    h += '<div class="card controls">' +
      '<div class="controls-row"><div><div class="small muted" style="margin-bottom:3px">面積口徑（決定「符合」的判斷方式）</div><div class="seg" role="group" aria-label="面積口徑">' +
      '<button type="button" data-mode="A" aria-pressed="' + (S.mode === 'A') + '">主建物 ≥' + S.minPing + ' 坪</button><button type="button" data-mode="B" aria-pressed="' + (S.mode === 'B') + '">主＋附 ≥' + S.minPing + ' 坪</button></div></div>' +
      numField('setBudget', '預算上限（萬，含）', S.budgetWan, 50, '8000') + numField('setMinPing', '坪數門檻', S.minPing, 0.5, '26') + '<span class="small muted" style="align-self:end;padding-bottom:6px">輸入後按 Enter 或點別處套用</span>' +
      '<div style="margin-left:auto"><div class="small muted" style="margin-bottom:3px">檢視</div><div class="seg" role="group" aria-label="檢視模式"><button type="button" data-viewmode="cards" aria-pressed="' + (S.viewMode === 'cards') + '">卡片</button><button type="button" data-viewmode="table" aria-pressed="' + (S.viewMode === 'table') + '">表格</button></div></div></div>' +
      '<div class="controls-row">' +
      numField('fPriceMin', '總價 ≥（萬）', f.priceMin, 100) + numField('fPriceMax', '總價 ≤（萬）', f.priceMax, 100) +
      numField('fMainMin', '主建物 ≥（坪）', f.mainMin, 0.5) + numField('fMainAuxMin', '主＋附 ≥（坪）', f.mainAuxMin, 0.5) +
      numField('fWalkMax', '步行 ≤（分）', f.walkMax, 1) + numField('fAgeMax', '屋齡 ≤（年）', f.ageMax, 1) + numField('fRoomsMin', '房數 ≥', f.roomsMin, 1) +
      selField('fElevator', '電梯', f.elevator, [['any', '不限'], ['yes', '有電梯'], ['no', '無電梯']]) +
      selField('fParking', '車位', f.parking, [['any', '不限'], ['yes', '有車位'], ['no', '無車位']]) +
      selField('fStage', '產品類型', f.stage, [['all', '全部'], ['中古屋', '中古屋'], ['新成屋', '新成屋'], ['預售屋', '預售屋']]) +
      selField('fStatus', '資料確認狀態', f.status, [['all', '全部'], ['confirmed', '已確認符合（依刊登頁數字）'], ['pending', '關鍵資料待確認'], ['not_fit', '不符合']]) +
      selField('fTier', '行動名單', f.tier, [['all', '全部'], ['visit', '優先看屋'], ['need_info', '先補資料再決定'], ['not_fit', '目前不符合條件']]) +
      '<label class="field wide">關鍵字<input type="search" id="fQ" value="' + esc(f.q) + '" placeholder="社區、路名、物件編號"></label>' +
      '<label class="field" style="grid-auto-flow:column;align-items:center;gap:6px"><input type="checkbox" id="fFav"' + (f.favOnly ? ' checked' : '') + '> 只看收藏</label>' +
      '<label class="field" style="grid-auto-flow:column;align-items:center;gap:6px"><input type="checkbox" id="fVerified"' + (f.verifiedOnly ? ' checked' : '') + '> 只看已深度查核</label>' +
      '<button type="button" class="btn small" id="fReset">清除篩選</button></div></div>';
    h += '<div id="listBody"></div>';
    $('#view-list').innerHTML = h;
    renderListBody();
  }
  function renderListBody() {
    var arr = filtered(), h = '';
    var nConf = arr.filter(function (p) { return cls(p).cls === 'confirmed'; }).length;
    var nOut = PROPS.filter(function (p) { return isNum((p.location || {}).walk_min) && p.location.walk_min > 15; }).length;
    h += '<div class="result-bar"><div><b>' + arr.length + '</b> / ' + PROPS.length + ' 間｜其中依目前口徑「已確認符合」<b>' + nConf + '</b> 間 <span class="mode-banner" style="margin-left:8px">目前口徑：' + (S.mode === 'A' ? 'A 主建物 ≥' + S.minPing + ' 坪' : 'B 主建物＋附屬建物 ≥' + S.minPing + ' 坪（不等於純室內 ' + S.minPing + ' 坪）') + '｜預算 ' + fmt(S.budgetWan) + ' 萬</span>' + (nOut && !isNum(S.f.walkMax) ? ' <span class="small muted">（含 ' + nOut + ' 間步行估算 15.5–16.5 分的邊界物件，已判為不符合）</span>' : '') + '</div>' +
      selField('sortSel', '排序', S.sort, [['rank', '研究推薦順序'], ['status', '符合狀態'], ['price', '總價低→高'], ['price_desc', '總價高→低'], ['main', '主建物大→小'], ['walk', '步行時間短→長'], ['age', '屋齡新→舊'], ['unit', '開價÷主建物 低→高']]) + '</div>';
    if (!arr.length) h += '<div class="card card-pad"><p>沒有符合目前篩選條件的物件。可以放寬條件或<button type="button" class="btn small" id="fReset2">清除篩選</button>。</p></div>';
    else if (S.viewMode === 'cards') h += '<div class="cards">' + arr.map(cardHtml).join('') + '</div>';
    else h += tableHtml(arr);
    $('#listBody').innerHTML = h;
  }
  function cardHtml(p) {
    var a = L.areaStatus(p, S.minPing), an = p.analysis || {}, shot = (p.screenshots || [])[0];
    var thumb = shot && relUrl(shot.thumb || shot.file) ? '<a class="thumb" href="#property/' + esc(p.id) + '"><img loading="lazy" src="' + esc(relUrl(shot.thumb || shot.file)) + '" alt="' + esc(p.name) + ' 刊登頁截圖（' + esc(shot.platform_name) + '）"><span class="thumb-note">刊登頁截圖 · ' + esc(shot.platform_name) + ' · ' + esc(dateOnly(shot.captured_at)) + '</span></a>' : '';
    if (!thumb) thumb = '<a class="thumb nothumb" href="#property/' + esc(p.id) + '">尚未擷取刊登頁截圖（可由下方原始連結開啟）</a>';
    return '<article class="card pcard">' + thumb + '<div class="body">' +
      '<div class="badges">' + tierBadge(p) + (an.first_round ? '<span class="badge ok">第一輪</span>' : '') + (an.verified ? '<span class="badge info">已深度查核</span>' : '') + stageBadge(p) + ((p.duplicates || {}).merged_count > 1 ? '<span class="badge neutral">' + p.duplicates.merged_count + ' 個平台刊登（已合併）</span>' : '') + ((p.duplicates || {}).suspected_with || []).map(function (x) { return '<span class="badge warn">疑似與 ' + esc(x) + ' 重複</span>'; }).join('') + '</div>' +
      '<h3><a href="#property/' + esc(p.id) + '">' + esc(p.name) + '</a></h3>' +
      '<div class="addr">' + esc(p.id) + '｜' + esc(p.community || '社區名未揭露') + '｜' + esc(p.address_public || '') + '</div>' +
      '<div class="price-line"><span class="price">' + priceText(p) + '</span><small class="muted">' + esc(parkingShort(p)) + '</small></div>' +
      '<div class="area-pair"><div class="area-box ' + (S.mode === 'A' ? 'active ' : '') + (a.A === 'ok' ? 'pass' : a.A === 'fail' ? 'fail' : '') + '"><div class="l">主建物（A 口徑）</div><div class="v">' + (isNum(p.area.main_ping) ? fmtPing(p.area.main_ping) + ' <small>坪</small>' : '<small>未揭露</small>') + '</div></div>' +
      '<div class="area-box ' + (S.mode === 'B' ? 'active ' : '') + (a.B === 'ok' ? 'pass' : a.B === 'fail' ? 'fail' : '') + '"><div class="l">主＋附（B 口徑）</div><div class="v">' + (isNum(a.mainAux) ? fmtPing(a.mainAux) + ' <small>坪</small>' : '<small>未揭露</small>') + '</div></div></div>' +
      '<div class="facts-line num"><span>權狀 ' + ping(p.area.total_ping) + '</span><span>' + (isNum(p.age_years) ? '屋齡 ' + p.age_years + ' 年' : '屋齡未揭露') + '</span><span>' + esc(layoutText(p)) + '</span><span>' + floorText(p) + '</span><span>' + esc(p.property_type || '') + (p.elevator === true ? '·有電梯' : p.elevator === false ? '·無電梯' : '') + '</span></div>' +
      '<div class="facts-line"><span>🚇 ' + walkText(p) + '</span><span class="muted">' + esc(precisionNote(p)) + '</span></div>' +
      statusBadges(p) +
      '<div class="procon">' + (an.headline_pro ? '<div class="pro"><span>' + esc(an.headline_pro) + '</span></div>' : '') + (an.headline_con ? '<div class="con"><span>' + esc(an.headline_con) + '</span></div>' : '') + '</div>' +
      '</div><div class="foot"><span class="src">' + sourceLinks(p, 4) + '</span>' + favBtn(p, true) + cmpBtn(p, true) + '<a class="btn small primary" href="#property/' + esc(p.id) + '">研究頁</a></div></article>';
  }
  function parkingShort(p) {
    var pr = p.price || {};
    if (pr.has_parking === false) return '無車位';
    if (pr.has_parking === true) return pr.includes_parking === true ? '總價含車位' + (isNum(pr.parking_price_wan) ? '（車位 ' + fmt(pr.parking_price_wan) + ' 萬）' : '') : pr.includes_parking === false ? '車位另計' + (isNum(pr.parking_price_wan) ? ' ' + fmt(pr.parking_price_wan) + ' 萬' : '') : '有車位，是否含在總價待確認';
    return '車位資訊未揭露';
  }
  function tableHtml(arr) {
    var rows = arr.map(function (p) {
      var a = L.areaStatus(p, S.minPing), c = cls(p), u = L.askingUnitPrices(p) || {};
      return '<tr><td><a href="#property/' + esc(p.id) + '"><b>' + esc(p.name) + '</b></a><br><span class="muted small">' + esc(p.id) + '｜' + esc(p.community || '') + '｜' + esc(p.address_public || '') + '</span></td>' +
        '<td>' + tierBadge(p) + '<br><span class="badge ' + (c.cls === 'confirmed' ? 'ok' : c.cls === 'pending' ? 'warn' : 'bad') + '" style="margin-top:3px">' + (c.cls === 'confirmed' ? '已確認符合' : c.cls === 'pending' ? esc(c.pendings.join('、')) : esc(c.fails.join('、'))) + '</span></td>' +
        '<td class="r"><b>' + priceText(p) + '</b><br><span class="muted small">' + esc(parkingShort(p)) + '</span></td>' +
        '<td class="r"><b>' + fmtPing(p.area.main_ping) + '</b></td><td class="r"><b>' + fmtPing(a.mainAux) + '</b></td><td class="r">' + fmtPing(p.area.total_ping) + '</td>' +
        '<td class="r">' + (isNum(u.main) ? fmt(u.main, 1) : '—') + '</td><td class="r">' + (isNum(p.age_years) ? p.age_years : '—') + '</td><td>' + esc(layoutText(p)) + '</td><td>' + floorText(p) + '</td><td>' + yn(p.elevator) + '</td>' +
        '<td class="r">' + (isNum((p.location || {}).walk_min) ? p.location.walk_min + ' 分<br><span class="muted small">出口' + esc(p.location.nearest_exit) + '</span>' : '待確認') + '</td><td>' + esc(p.product_stage || '') + '</td>' +
        '<td class="small">' + sourceLinks(p, 3) + '</td><td style="white-space:nowrap">' + favBtn(p, true) + ' ' + cmpBtn(p, true) + '</td></tr>';
    }).join('');
    return '<div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>物件</th><th>狀態</th><th class="r">總價</th><th class="r">主建物 坪</th><th class="r">主＋附 坪</th><th class="r">權狀 坪</th><th class="r">開價÷主建物<br>萬/坪</th><th class="r">屋齡</th><th>格局</th><th>樓層</th><th>電梯</th><th class="r">步行</th><th>類型</th><th>來源</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function readFilters() {
    function n(id) { var v = parseFloat(($('#' + id) || {}).value); return isFinite(v) ? v : null; }
    var f = S.f;
    f.priceMin = n('fPriceMin'); f.priceMax = n('fPriceMax'); f.mainMin = n('fMainMin'); f.mainAuxMin = n('fMainAuxMin'); f.walkMax = n('fWalkMax'); f.ageMax = n('fAgeMax'); f.roomsMin = n('fRoomsMin');
    f.elevator = $('#fElevator').value; f.parking = $('#fParking').value; f.stage = $('#fStage').value; f.status = $('#fStatus').value; f.tier = $('#fTier').value; f.q = $('#fQ').value; f.favOnly = $('#fFav').checked; f.verifiedOnly = $('#fVerified').checked;
    saveS();
  }
  function resetFilters() { S.f = { priceMax: null, priceMin: null, mainMin: null, mainAuxMin: null, walkMax: null, ageMax: null, roomsMin: null, elevator: 'any', parking: 'any', stage: 'all', status: 'all', tier: 'all', favOnly: false, verifiedOnly: false, q: '' }; saveS(); renderList(); }

  /* ---------- MAP ---------- */
  var map = null, mapLayers = {};
  function gmaps(p) { var l = p.location || {}; return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((p.address_public || '') + (p.community ? ' ' + p.community : '')); }
  function renderMap() {
    var v = $('#view-map');
    if (!v.dataset.built) {
      v.innerHTML = '<div class="page-title"><div><h1 id="h-map">地圖</h1><p>黑色方塊是官方出入口；圓點是候選物件。<b>虛線外框＝概略位置</b>（平台只公開路段，座標可能經過偏移），不是精確門牌。</p></div></div>' +
        '<div class="legend"><span><i style="background:var(--ok)"></i>A 口徑已確認符合</span><span><i style="background:var(--info)"></i>僅 B 口徑符合</span><span><i style="background:#c78a00"></i>關鍵資料待確認</span><span><i style="background:var(--bad)"></i>不符合</span><span><i class="sq" style="background:#111"></i>捷運出入口</span><span><i class="sq" style="background:#999;border:2px dotted #222"></i>方形點線框＝只知道路段，標在「路段代表點」，不是物件位置</span><span><i class="dash"></i>灰色虛線圓＝距車站中心 400／800 公尺「直線距離圈」（不是步行時間圈）</span></div>' +
        '<div id="mapFallback" class="callout warn" style="display:none"></div>' +
        '<div class="map-layout"><div id="map" role="application" aria-label="候選物件地圖"></div><div class="card map-side" id="mapSide"></div></div>' +
        '<div class="section"><h2>文字版位置清單（地圖無法載入時使用）</h2><div id="mapText"></div></div>';
      v.dataset.built = '1';
    }
    var rows = PROPS.map(function (p) {
      return '<tr><td><a href="#property/' + esc(p.id) + '">' + esc(p.name) + '</a><br><span class="muted small">' + esc(p.id) + '</span></td><td>' + esc(p.address_public || '未揭露') + '<br><span class="muted small">' + esc(precisionNote(p)) + '</span></td><td>' + walkText(p) + '</td><td class="r">' + priceText(p) + '</td><td><a href="' + esc(gmaps(p)) + '" target="_blank" rel="noopener noreferrer">在 Google 地圖查詢 ↗</a></td></tr>';
    }).join('');
    $('#mapText').innerHTML = '<div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>物件</th><th>公開地址</th><th>最近出入口（地圖估算）</th><th class="r">總價</th><th>地圖</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="small muted" style="margin-top:8px">出入口（台北捷運官方資料）：' + D.meta.exits.map(function (e) { return '出口' + esc(e.no) + '：' + esc(e.desc); }).join('；') + '</p>';
    $('#mapSide').innerHTML = PROPS.slice().sort(function (a, b) { return ((a.location || {}).walk_min || 99) - ((b.location || {}).walk_min || 99); }).map(function (p) {
      return '<button type="button" class="row" data-focus="' + esc(p.id) + '"><b>' + esc(p.name) + '</b><br><span class="num">' + priceText(p) + '｜主 ' + fmtPing(p.area.main_ping) + ' 坪｜' + (isNum((p.location || {}).walk_min) ? p.location.walk_min + ' 分' : '位置待確認') + '</span></button>';
    }).join('');

    if (!window.L || window.__leafletFailed) { mapFail('地圖元件沒有載入（可能是離線或檔案遺失）。下方的文字版位置清單與其他頁面仍可正常使用。'); return; }
    try {
      if (!map) {
        var LF = window.L;
        map = LF.map('map', { scrollWheelZoom: true }).setView([D.meta.station.lat, D.meta.station.lng], 16);
        var nlsc = LF.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', { maxZoom: 19, attribution: '底圖：<a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">內政部國土測繪中心 臺灣通用電子地圖</a>' });
        var osm = LF.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' });
        var errs = 0, loaded = 0;
        [nlsc, osm].forEach(function (tl) {
          tl.on('tileerror', function () { errs++; if (errs >= 4 && !loaded) mapFail('地圖底圖無法載入（可能沒有網路，或底圖服務暫停）。物件標記與下方文字清單仍可使用；也可以用右上角切換另一種底圖。', true); });
          tl.on('tileload', function () { loaded++; var fb = $('#mapFallback'); if (fb) fb.style.display = 'none'; });
        });
        nlsc.addTo(map);
        LF.control.layers({ '臺灣通用電子地圖（國土測繪中心）': nlsc, 'OpenStreetMap': osm }, null, { collapsed: true }).addTo(map);
        [400, 800].forEach(function (r) {
          LF.circle([D.meta.station.lat, D.meta.station.lng], { radius: r, color: '#666', weight: 1.2, dashArray: '5 6', fill: false, interactive: false }).addTo(map);
          LF.marker([D.meta.station.lat + r / 111320, D.meta.station.lng], { interactive: false, icon: LF.divIcon({ className: '', html: '<span style="font-size:11px;background:rgba(255,255,255,.85);color:#333;padding:1px 5px;border-radius:4px;white-space:nowrap">直線 ' + r + ' m</span>', iconSize: [70, 16], iconAnchor: [35, 8] }) }).addTo(map);
        });
        D.meta.exits.forEach(function (e) {
          LF.marker([e.lat, e.lng], { icon: LF.divIcon({ className: '', html: '<div class="pin exit" style="width:24px;height:22px">' + esc(e.no) + '</div>', iconSize: [24, 22], iconAnchor: [12, 11] }), zIndexOffset: 500 })
            .bindPopup('<h4>信義安和站 出口' + esc(e.no) + '</h4>' + esc(e.desc) + '<br><span class="muted">' + (e.elevator ? '有電梯' : '') + (e.escalator ? ' 有電扶梯' : '') + '</span><br><span class="muted">來源：台北捷運官方車站資訊</span>').addTo(map);
        });
        mapLayers.group = LF.layerGroup().addTo(map);
      }
      mapLayers.group.clearLayers(); mapLayers.byId = {};
      PROPS.forEach(function (p) {
        var l = p.location || {}; if (!isNum(l.lat) || !isNum(l.lng) || l.precision === 'district_only') return;
        var a = cls(p, 'A'), b = cls(p, 'B');
        var roadOnly = l.precision === 'road_only', jit = roadOnly ? (parseInt(p.id.replace(/\D/g, ''), 10) % 7 - 3) * 0.00012 : 0;
        var color = a.cls === 'confirmed' ? '#0a7a2f' : b.cls === 'confirmed' ? '#1c5cab' : (a.cls === 'pending' || b.cls === 'pending') ? '#c78a00' : '#b3261e';
        var approx = l.precision !== 'exact';
        var mk = window.L.marker([l.lat + jit, l.lng + jit * 1.3], { icon: window.L.divIcon({ className: '', html: '<div class="pin ' + (approx ? 'approx' : '') + (roadOnly ? ' roadonly' : '') + '" title="' + (roadOnly ? '路段代表點（不是物件位置）' : '概略位置') + '" style="width:26px;height:26px;background:' + color + '">' + esc(p.id.replace('XA-', '').replace(/^0+/, '')) + '</div>', iconSize: [26, 26], iconAnchor: [13, 13] }) });
        mk.bindPopup('<h4>' + esc(p.name) + '</h4><div class="num"><b>' + priceText(p) + '</b>｜主建物 ' + ping(p.area.main_ping) + '｜主＋附 ' + ping(L.areaStatus(p).mainAux) + '</div><div>' + walkText(p) + '</div><div class="muted">⚠ ' + esc(precisionNote(p)) + '</div><div style="margin-top:6px"><a href="#property/' + esc(p.id) + '">開啟研究頁 →</a></div>');
        mk.addTo(mapLayers.group); mapLayers.byId[p.id] = mk;
      });
      setTimeout(function () { map.invalidateSize(); }, 60);
    } catch (e) { mapFail('地圖初始化失敗：' + e.message + '。下方文字清單仍可使用。'); }
  }
  function mapFail(msg, keepMap) { var fb = $('#mapFallback'); if (fb) { fb.style.display = 'block'; fb.innerHTML = '<p>' + esc(msg) + '</p>'; } if (!keepMap) { var m = $('#map'); if (m && !map) m.style.display = 'none'; } }

  /* ---------- PROPERTY DETAIL ---------- */
  function compRow(c) {
    return '<tr><td class="num">' + esc(c.trade_date || '') + '</td><td>' + esc(c.address) + '<br><span class="muted small">' + esc(c.building_type) + '｜' + esc(c.main_use || '') + '</span></td><td class="r">' + esc(c.floor != null ? c.floor : (c.floor_raw || '')) + ' / ' + esc(c.total_floors || '—') + '</td><td class="r">' + (isNum(c.age_at_trade) ? c.age_at_trade : '—') + '</td>' +
      '<td class="r">' + fmt(c.price_wan) + '</td><td class="r">' + (c.has_parking ? (isNum(c.parking_price_wan) ? fmt(c.parking_price_wan) + '<br><span class="muted small">' + fmtPing(c.parking_ping) + ' 坪</span>' : '<span class="muted small">有車位<br>未拆分</span>') : '無') + '</td>' +
      '<td class="r">' + fmtPing(c.total_ping) + '</td><td class="r">' + fmtPing(c.main_ping) + '</td><td class="r">' + (isNum(c.main_ping) ? fmtPing(c.main_ping + (c.aux_ping || 0)) : '—') + '</td>' +
      '<td class="r">' + (isNum(c.unit_net_wan) ? fmt(c.unit_net_wan, 1) : '<span class="muted small">含車位 ' + fmt(c.unit_gross_incl_parking_wan, 1) + '</span>') + '</td><td class="r">' + (isNum(c.unit_main_wan) ? fmt(c.unit_main_wan, 1) : '—') + '</td><td class="r">' + (isNum(c.unit_main_aux_wan) ? fmt(c.unit_main_aux_wan, 1) : '—') + '</td>' +
      '<td class="small">' + ((c.flags || []).length ? c.flags.map(function (f) { return '<span class="badge warn">' + esc(f) + '</span>'; }).join(' ') : '') + (c.remark ? '<div class="muted">' + esc(c.remark) + '</div>' : '') + '</td></tr>';
  }
  var COMP_HEAD = '<thead><tr><th>交易日</th><th>門牌（實價登錄）</th><th class="r">樓層</th><th class="r">屋齡</th><th class="r">總價 萬</th><th class="r">車位價</th><th class="r">總坪</th><th class="r">主建物</th><th class="r">主＋附</th><th class="r">①扣車位<br>建坪單價</th><th class="r">②÷主建物</th><th class="r">③÷主＋附</th><th>備註</th></tr></thead>';
  function compsBlock(p) {
    var cp = p.comps || {}, h = '';
    var u = L.askingUnitPrices(p) || {};
    h += '<div class="table-wrap" style="margin-bottom:10px" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>本物件開價換算</th><th class="r">①扣車位後建坪單價</th><th class="r">②÷主建物</th><th class="r">③÷（主＋附）</th><th class="r">含車位指標</th><th>換算基礎</th></tr></thead><tbody><tr><td>開價 ' + priceText(p) + '</td><td class="r">' + (isNum(u.net) ? fmt(u.net, 1) : '—') + '</td><td class="r">' + (isNum(u.main) ? fmt(u.main, 1) : '—') + '</td><td class="r">' + (isNum(u.mainAux) ? fmt(u.mainAux, 1) : '—') + '</td><td class="r">' + (isNum(u.grossInclParking) ? fmt(u.grossInclParking, 1) : '—') + '</td><td class="small">' + esc(u.basis || '') + '</td></tr></tbody></table></div>';
    h += '<p class="small muted">單位：萬元／坪。②③只是以不同面積口徑換算的比較指標，不代表價格只買到這些面積。在售開價（上表）與歷史成交（下表）是不同性質的數字；成交資料不代表現在有同條件房屋出售。</p>';
    [['same_building', (p.analysis || {}).verified ? '同棟／同建案（查核員逐筆比對；比對方式見下方說明）' : '推定同一建物（規則式：路段＋總樓層＋完工年月；未經逐筆查核）'], ['verified_refs', '查核員在價格敘述中引用的其他成交'], ['nearby', '同路段相近產品（規則式篩選，僅供參考）']].forEach(function (g) {
      var ids = cp[g[0]] || []; var list = ids.map(function (i) { return COMPS_BY_ID[i]; }).filter(Boolean);
      h += '<h4 style="margin-top:14px">' + g[1] + '　<span class="muted small">n = ' + list.length + '</span></h4>';
      if (!list.length && g[0] === 'verified_refs') { h = h.slice(0, h.lastIndexOf('<h4 style="margin-top:14px">')); return; }
      if (!list.length) { h += '<p class="muted small">' + esc(cp[g[0] + '_note'] || '查詢期間內沒有可比對的成交紀錄。') + '</p>'; return; }
      if (cp[g[0] + '_note']) h += '<p class="small">' + esc(cp[g[0] + '_note']) + '</p>';
      h += '<div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table>' + COMP_HEAD + '<tbody>' + list.map(compRow).join('') + '</tbody></table></div>';
    });
    h += '<p class="small muted" style="margin-top:8px">成交來源：內政部不動產成交案件實際資訊資料供應系統開放資料（臺北市，' + esc(D.meta.lvr_period || '') + '）。比對方式與限制見「方法與來源」。</p>';
    return h;
  }
  function renderProperty(id) {
    var p = byId(id), v = $('#view-property');
    if (!p) { v.innerHTML = '<div class="card card-pad"><p>找不到物件 ' + esc(id) + '。它可能已從最新資料中移除；你的筆記仍保留在「收藏與筆記」。</p><p><a class="btn" href="#list">回到列表</a></p></div>'; return; }
    var c = cls(p), an = p.analysis || {}, a = c.area, ar = p.area || {}, loc = p.location || {}, pr = p.price || {};
    var h = '<div class="breadcrumb"><a href="#list">← 房源列表</a></div>';
    h += '<div class="card card-pad"><div class="detail-head"><div><div class="badges" style="margin-bottom:8px">' + tierBadge(p) + stageBadge(p) + '<span class="badge neutral">' + esc(p.id) + '</span></div><h1>' + esc(p.name) + '</h1>' +
      '<p class="muted" style="margin:0">' + esc(p.community || '社區名未揭露') + '｜' + esc(p.address_public || '地址未揭露') + '｜' + esc(p.district || '') + '</p><div style="margin-top:10px">' + statusBadges(p) + '</div>' +
      '<p class="small muted" style="margin-top:8px">狀態：' + esc(p.availability_status) + '</p></div>' +
      '<div class="detail-price"><div class="price">' + priceText(p) + '</div><div class="small muted">' + esc(parkingShort(p)) + '</div><div style="margin-top:10px;display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">' + favBtn(p) + cmpBtn(p) + '</div></div></div>' +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' + (p.listings || []).map(function (l) { return '<a class="btn primary" href="' + esc(safeUrl(l.url)) + '" target="_blank" rel="noopener noreferrer">開啟原始刊登頁：' + esc(l.platform_name) + ' ↗</a>'; }).join('') + '<a class="btn" href="' + esc(gmaps(p)) + '" target="_blank" rel="noopener noreferrer">Google 地圖查詢 ↗</a></div></div>';

    // 五個驗收問題
    h += '<div class="section"><h2>五個關鍵問題</h2><div class="qa">';
    h += '<div class="card card-pad"><h3>1. 為什麼它' + (c.budget.status === 'ok' ? '沒有超過' : c.budget.status === 'over' ? '超過了' : '是否超過') + ' ' + fmt(S.budgetWan) + ' 萬？ <span class="badge ' + (c.budget.status === 'ok' ? 'ok' : c.budget.status === 'over' ? 'bad' : 'warn') + '">' + (c.budget.status === 'ok' ? '✓ 在預算內' : c.budget.status === 'over' ? '✕ 超出預算' : '？ 總價待確認') + '</span></h3><p>' + esc(c.budget.reason) + '</p><ol class="steps">' + c.budget.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      (pr.parking_text ? '<p class="small" style="margin-top:8px">刊登頁車位原文：「' + esc(pr.parking_text) + '」</p>' : '') + (pr.note ? '<p class="small">' + esc(pr.note) + '</p>' : '') + '<p class="small muted">稅費、仲介費、代書費、裝修等不含在內，見「方法與來源」。</p></div>';
    var tot = isNum(ar.total_ping) ? ar.total_ping : null;
    function seg(clsn, vv) { return isNum(vv) && tot ? '<span class="' + clsn + '" style="width:' + (vv / tot * 100) + '%" title="' + fmtPing(vv) + ' 坪"></span>' : ''; }
    h += '<div class="card card-pad"><h3>2. ' + S.minPing + ' 坪到底是哪些面積組成？ <span class="badge ' + (a.A === 'ok' ? 'ok' : a.B === 'ok' ? 'info' : (a.A === 'fail' && a.B === 'fail') ? 'bad' : 'warn') + '">' + esc(a.label) + '</span></h3>' +
      '<div class="areabar" aria-hidden="true">' + seg('m', ar.main_ping) + seg('a', ar.aux_ping) + seg('c', ar.common_ping) + seg('p', ar.parking_ping) + '</div>' +
      '<div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table class="kv"><tbody>' +
      '<tr><th><span style="color:var(--series-1)">■</span> 主建物</th><td class="num"><b>' + ping(ar.main_ping) + '</b>' + (ar.main_note ? '<span class="src-tag">' + esc(ar.main_note) + '</span>' : '') + '</td></tr>' +
      '<tr><th><span style="color:var(--series-3)">■</span> 附屬建物</th><td class="num"><b>' + ping(ar.aux_ping) + '</b>' + (ar.aux_detail ? '<span class="src-tag">組成：' + esc(ar.aux_detail) + '</span>' : '<span class="src-tag">組成明細未揭露（陽台／雨遮／露台各多少待確認）</span>') + '</td></tr>' +
      '<tr><th>主＋附</th><td class="num"><b>' + ping(a.mainAux) + '</b><span class="src-tag">不可稱為「純室內」；陽台不是室內空間</span></td></tr>' +
      '<tr><th><span style="color:var(--border-strong)">■</span> 共有部分（公設）</th><td class="num">' + ping(ar.common_ping) + (ar.parking_in_common === true ? '<span class="src-tag">平台此數字已含車位面積</span>' : '') + '</td></tr>' +
      '<tr><th><span style="color:var(--text-3)">■</span> 車位面積</th><td class="num">' + (pr.has_parking === false ? '無車位' : ping(ar.parking_ping)) + '</td></tr>' +
      '<tr><th>權狀／建物總面積</th><td class="num">' + ping(ar.total_ping) + (isNum(ar.common_ratio) ? '<span class="src-tag">公設比（共有部分÷不含車位總面積）約 ' + fmt(ar.common_ratio * 100, 1) + '%（研究換算）</span>' : '') + '</td></tr>' +
      '<tr><th>土地持分</th><td class="num">' + ping(ar.land_ping) + '</td></tr></tbody></table></div>' +
      '<ol class="steps">' + a.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      (ar.verify_note ? '<p class="small"><b>查核員面積備註：</b>' + esc(ar.verify_note) + '</p>' : '') +
      (ar.raw_text ? '<details class="tableview"><summary>刊登頁面積原文</summary><p class="small">' + esc(ar.raw_text) + '</p></details>' : '') +
      (p.illegal_addition_mention ? '<div class="callout warn small"><p><b>增建／加蓋相關描述（不計入 ' + S.minPing + ' 坪）：</b>' + esc(p.illegal_addition_mention) + '</p></div>' : '') +
      '<p class="small muted">主建物為登記面積（含牆、柱），不等於現場淨使用面積；未登記增建、頂加、夾層、外推空間一律不計入。</p></div>';
    h += '<div class="card card-pad"><h3>3. 到信義安和站實際有多遠？ <span class="badge ' + (c.walk.zone === 'primary' ? 'ok' : c.walk.zone === 'extended' ? 'info' : c.walk.zone === 'out' ? 'bad' : 'warn') + '">' + esc(c.walk.label) + '</span></h3>' +
      (isNum(loc.walk_min) ? '<p>最近的可進站出入口：<b>出口' + esc(loc.nearest_exit) + '</b>（' + esc(loc.nearest_exit_desc || '') + '）<br>步行路徑約 <b class="num">' + fmt(loc.walk_m, 0) + ' 公尺</b>，以每分鐘 80 公尺換算約 <b class="num">' + loc.walk_min + ' 分鐘</b>（不含等紅燈）。</p>' : '<p>無法可靠估算步行距離：' + esc(loc.precision_note || '位置資訊不足') + (isNum(loc.rough_walk_min) ? '<br>路段代表點粗估：約 <b class="num">' + loc.rough_walk_min + ' 分鐘</b>（' + fmt(loc.rough_walk_m, 0) + ' 公尺，到出口' + esc(loc.rough_exit) + '）——<b>不列入符合判斷</b>。' : '') + '</p>') +
      '<table class="kv"><tbody><tr><th>測量方式</th><td>' + esc(loc.walk_method || '—') + '</td></tr><tr><th>起點精度</th><td>' + esc(precisionNote(p)) + (loc.precision_note ? '<span class="src-tag">' + esc(loc.precision_note) + '</span>' : '') + '</td></tr>' +
      (loc.all_exits_m ? '<tr><th>到各出入口路徑</th><td class="num small">' + Object.keys(loc.all_exits_m).map(function (k) { return '出口' + esc(k) + ' ' + (isNum(loc.all_exits_m[k]) ? fmt(loc.all_exits_m[k], 0) + ' m' : '—'); }).join('｜') + '</td></tr>' : '') +
      '<tr><th>直線距離（僅供參考）</th><td class="num">' + (isNum(loc.straight_m) ? fmt(loc.straight_m, 0) + ' 公尺（到最近出入口；不是步行距離）' : '—') + '</td></tr>' +
      '<tr><th>平台／房仲聲稱</th><td class="small">' + (loc.platform_walk_claim ? esc(loc.platform_walk_claim) : '<span class="muted">無</span>') + '</td></tr></tbody></table>' +
      (loc.borderline ? '<div class="callout warn small"><p>落在分界附近，且起點為概略位置：請以實際步行確認。</p></div>' : '') + '</div>';
    h += '<div class="card card-pad"><h3>4. 開價有沒有可比較的成交依據？</h3><p>' + esc((an.price_view || {}).text || '目前不足以判斷。') + '</p>' + (((an.price_view || {}).caveats || []).length ? '<ul class="tight small">' + an.price_view.caveats.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '<p class="small"><button type="button" class="btn small" data-scroll="compsAnchor">看逐筆成交比較 ↓</button></p></div>';
    h += '</div></div>';

    // 研究結論
    h += '<div class="section"><h2>研究結論</h2><div class="grid cols-2"><div class="card card-pad"><h3>是否值得安排看屋</h3><p>' + tierBadge(p) + '</p><p>' + esc(an.worth_visit_text || an.tier_reason || '') + '</p><h4>推薦理由</h4>' + listHtml(an.reasons) + '<h4>主要缺點與風險</h4>' + listHtml(an.drawbacks) + '</div>' +
      '<div class="card card-pad"><h3>5. 還有哪些事沒確認</h3><h4>尚缺的關鍵資料</h4>' + ((an.missing || []).length ? listHtml(an.missing) : '') + '<p class="small muted">每一間都還沒確認的事：是否仍可售、謄本上的主建物／附屬建物／共有部分面積與登記用途、實際門牌、有無未登記增建與漏水紀錄。</p>' + '<h4>下一步應問房仲的問題</h4>' + listHtml(an.questions) + '<h4>現場要確認的事</h4>' + listHtml(an.onsite_checks) + '</div></div></div>';

    // 事實 / 聲稱 / 推論
    h += '<div class="section"><h2>證據分層</h2><div class="evidence">' +
      '<div class="card card-pad col"><h4><span class="badge ok">刊登頁揭露</span></h4><p class="small muted">來自刊登頁的結構化欄位；仍須以謄本核實。</p>' + listHtml(p.facts) + '</div>' +
      '<div class="card card-pad col"><h4><span class="badge warn">房仲聲稱</span></h4><p class="small muted">刊登文案，未經第三方資料驗證。</p>' + listHtml(p.claims) + '</div>' +
      '<div class="card card-pad col"><h4><span class="badge info">研究推論與照片觀察</span></h4><p class="small muted">照片看不出的問題不代表不存在。</p>' + listHtml((p.inferences || []).concat(p.photo_observations ? ['照片觀察：' + p.photo_observations] : [])) + '</div></div></div>';

    if (an.verified) {
      h += '<div class="section"><h2>深度查核紀錄</h2><div class="card card-pad"><p class="small muted">查核時間：' + esc((an.verified_at || '').replace('T', ' ').slice(0, 16)) + '。查核員重新開啟每個平台的原始頁、逐欄核對合併紀錄，並於當日重抓一次確認頁面仍在。「頁面仍在」不等於已向房仲確認可售。</p>' +
        ((an.live_check || []).length ? '<div class="table-wrap" style="margin-bottom:10px" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>平台</th><th>HTTP</th><th>頁面仍顯示此物件</th><th class="r">當下價格（萬）</th><th>備註</th></tr></thead><tbody>' + an.live_check.map(function (x) { return '<tr><td><a href="' + esc(safeUrl(x.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(x.platform || '') + ' ↗</a></td><td>' + esc(x.http_status == null ? '—' : x.http_status) + '</td><td>' + (x.still_listed === true ? '是' : x.still_listed === false ? '<b>否</b>' : '無法判定') + '</td><td class="r">' + (isNum(x.price_wan_now) ? fmt(x.price_wan_now) : '—') + '</td><td class="small">' + esc(x.note || '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
        ((an.field_check || []).length ? '<details class="tableview"><summary>逐欄核對結果（' + an.field_check.filter(function (x) { return x.ok === false; }).length + ' 項不一致／' + an.field_check.length + ' 項）</summary><div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>欄位</th><th>合併紀錄</th><th>各平台原文</th><th>一致</th><th>說明</th></tr></thead><tbody>' + an.field_check.map(function (x) { return '<tr><td>' + esc(x.field) + '</td><td>' + esc(x.merged_value == null ? '—' : x.merged_value) + '</td><td class="small">' + esc(Object.keys(x.source_values || {}).map(function (k) { return k + '：' + x.source_values[k]; }).join('；')) + '</td><td>' + (x.ok === false ? '<span class="badge warn">不一致</span>' : '✓') + '</td><td class="small">' + esc(x.note || '') + '</td></tr>'; }).join('') + '</tbody></table></div></details>' : '') +
        ((an.risk_keywords || []).length ? '<h4 style="margin-top:12px">文案中的風險關鍵字</h4><ul class="tight small">' + an.risk_keywords.map(function (r) { return '<li><b>' + esc(r.keyword) + '</b>：「' + esc(r.quote_short || '') + '」→ ' + esc(r.implication || '') + '</li>'; }).join('') + '</ul>' : '') + '</div></div>';
    }

    // 基本資料
    h += '<div class="section"><h2>基本資料</h2><div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table class="kv"><tbody>' +
      kv('住宅類型', p.property_type) + kv('登記用途', p.registered_use, p.residential_note) + kv('產品階段', p.product_stage, p.stage_note) + kv('格局', layoutText(p), p.layout_note) + kv('樓層／總樓層', (p.floor != null || p.total_floors != null) ? ((p.floor != null ? p.floor : '？') + ' / ' + (p.total_floors != null ? p.total_floors : '？')) : null) +
      kv('屋齡／完工', isNum(p.age_years) ? p.age_years + ' 年' + (p.completion_date ? '（' + p.completion_date + '）' : '') : p.completion_date, p.age_note) + kv('電梯', p.elevator == null ? null : yn(p.elevator)) + kv('建物構造', p.structure) + kv('管理方式', p.management) + kv('管理費', p.mgmt_fee_text) + kv('朝向', p.facing) +
      kv('車位', pr.has_parking == null ? null : (pr.has_parking ? '有' + (pr.parking_type ? '（' + pr.parking_type + '）' : '') : '無')) + kv('臨路／巷內', p.street_position) + kv('主要生活機能', (p.amenities || []).join('、') || null) + kv('所屬微區域', p.micro_area_name) +
      '</tbody></table></div></div>';

    // 欄位層級來源
    if (p.field_sources) {
      h += '<div class="section"><h2>欄位層級來源對照</h2><p class="small muted">同一戶在不同平台的數字並列，差異不隱藏。</p><div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>欄位</th>' + (p.listings || []).map(function (l) { return '<th><a href="' + esc(safeUrl(l.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(l.platform_name) + '<br><span class="muted small">' + esc(l.object_no) + ' ↗</span></a></th>'; }).join('') + '</tr></thead><tbody>' +
        Object.keys(p.field_sources).map(function (k) { var row = p.field_sources[k]; return '<tr><td>' + esc(row.label) + '</td>' + row.values.map(function (x) { return '<td class="num">' + (x == null || x === '' ? '<span class="muted">未揭露</span>' : esc(x)) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '<tr><td>查閱時間</td>' + (p.listings || []).map(function (l) { return '<td class="small">' + esc((l.fetched_at || '').replace('T', ' ').slice(0, 16)) + '</td>'; }).join('') + '</tr></tbody></table></div>' +
        ((p.duplicates || {}).note ? '<p class="small" style="margin-top:6px">' + esc(p.duplicates.note) + '</p>' : '') + (((p.duplicates || {}).suspected_notes || []).length ? '<div class="callout warn small"><p><b>疑似重複（未合併）：</b></p>' + listHtml(p.duplicates.suspected_notes) + '</div>' : '') + '</div>';
    }

    // 截圖
    if ((p.screenshots || []).length) {
      h += '<div class="section"><h2>刊登頁截圖</h2><p class="small muted">研究當天自動擷取的原始刊登頁畫面（保留來源與浮水印；內容著作權屬各房仲平台，最新資訊請以原始頁面為準）。點圖可看完整大圖。</p><div class="shots">' + p.screenshots.map(function (s) {
        return '<figure class="shot" style="margin:0"><a class="img" href="' + esc(relUrl(s.file)) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + esc(relUrl(s.file)) + '" alt="' + esc(p.name) + ' ' + esc(s.platform_name) + ' 刊登頁截圖"></a><figcaption class="cap">' + esc(s.platform_name) + '｜擷取於 ' + esc((s.captured_at || '').replace('T', ' ').slice(0, 16)) + '｜<a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener noreferrer">原始頁面 ↗</a></figcaption></figure>';
      }).join('') + '</div></div>';
    }

    h += '<div class="section" id="compsAnchor"><h2>價格比較：在售開價 vs 歷史成交</h2><div class="card card-pad">' + compsBlock(p) + '</div></div>';

    var note = U.notes[p.id] || {};
    h += '<div class="section"><h2>我的看屋筆記</h2><div class="card card-pad notes-box"><textarea id="noteText" data-note="' + esc(p.id) + '" placeholder="看屋心得、房仲回覆、待辦事項…（自動儲存在這台電腦的瀏覽器）">' + esc(note.text || '') + '</textarea><div class="save-hint" id="noteHint">' + (note.updatedAt ? '上次儲存：' + esc(note.updatedAt.replace('T', ' ').slice(0, 16)) : '尚未寫筆記') + '｜筆記與房源資料分開儲存，更新房源不會覆蓋。請定期到「收藏與筆記」匯出備份。</div></div></div>';
    v.innerHTML = h;
    window.scrollTo(0, 0);
  }
  function kv(label, value, note) { return '<tr><th>' + esc(label) + '</th><td>' + val(value) + (note ? '<span class="src-tag">' + esc(note) + '</span>' : '') + '</td></tr>'; }

  /* ---------- COMPARE ---------- */
  function renderCompare() {
    var items = U.compare.map(byId).filter(Boolean), v = $('#view-compare');
    var h = '<div class="page-title"><div><h1>並排比較</h1><p>可同時比較 2–4 間。在列表或物件頁按「＋ 比較」加入。</p></div>' + (items.length ? '<button type="button" class="btn" id="cmpClear">清空比較清單</button>' : '') + '</div>';
    if (items.length < 2) {
      h += '<div class="card card-pad"><p>目前選了 ' + items.length + ' 間，至少需要 2 間。</p><p class="small muted">快速加入：</p><div style="display:flex;gap:6px;flex-wrap:wrap">' + PROPS.filter(function (p) { return (p.analysis || {}).tier === 'visit'; }).map(function (p) { return cmpBtn(p, true).replace('＋ 比較', '＋ ' + esc(p.name)).replace('✓ 已加入比較', '✓ ' + esc(p.name)); }).join('') + '</div></div>';
      v.innerHTML = h; return;
    }
    function row(label, fn) { return '<tr><td><b>' + label + '</b></td>' + items.map(function (p) { return '<td>' + fn(p) + '</td>'; }).join('') + '</tr>'; }
    h += '<div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table class="compare"><thead><tr><th>項目</th>' + items.map(function (p) { return '<th><a href="#property/' + esc(p.id) + '">' + esc(p.name) + '</a><br><span class="muted small">' + esc(p.id) + '</span> <button type="button" class="btn small ghost" data-cmp="' + esc(p.id) + '" aria-label="移除">✕</button></th>'; }).join('') + '</tr></thead><tbody>' +
      row('行動名單', function (p) { return tierBadge(p); }) +
      row('條件符合狀態', function (p) { return statusBadges(p); }) +
      row('總價', function (p) { return '<b class="num">' + priceText(p) + '</b><br><span class="small muted">' + esc(parkingShort(p)) + '</span><br><span class="small">' + esc(cls(p).budget.reason) + '</span>'; }) +
      row('主建物（A）', function (p) { return '<b class="num">' + ping(p.area.main_ping) + '</b>'; }) +
      row('主＋附（B）', function (p) { return '<b class="num">' + ping(L.areaStatus(p).mainAux) + '</b><br><span class="small muted">' + esc(p.area.aux_detail || '附屬組成未揭露') + '</span>'; }) +
      row('共有部分／權狀', function (p) { return '<span class="num">' + ping(p.area.common_ping) + '／' + ping(p.area.total_ping) + '</span>'; }) +
      row('開價換算單價', function (p) { var u = L.askingUnitPrices(p) || {}; return '<span class="num small">①建坪 ' + (isNum(u.net) ? fmt(u.net, 1) : '—') + '<br>②÷主建物 ' + (isNum(u.main) ? fmt(u.main, 1) : '—') + '<br>③÷主＋附 ' + (isNum(u.mainAux) ? fmt(u.mainAux, 1) : '—') + '</span><br><span class="small muted">萬/坪</span>'; }) +
      row('屋齡', function (p) { return isNum(p.age_years) ? p.age_years + ' 年' : val(null); }) +
      row('樓層', function (p) { return floorText(p); }) +
      row('格局', function (p) { return esc(layoutText(p)) + (p.layout_note ? '<br><span class="small muted">' + esc(p.layout_note) + '</span>' : ''); }) +
      row('類型／電梯', function (p) { return esc(p.property_type || '') + '｜電梯：' + yn(p.elevator); }) +
      row('捷運距離', function (p) { return walkText(p) + '<br><span class="small muted">' + esc(precisionNote(p)) + '</span>'; }) +
      row('車位', function (p) { var pr = p.price || {}; return pr.has_parking === true ? '有' + (pr.parking_type ? '（' + esc(pr.parking_type) + '）' : '') + '<br><span class="small muted">' + esc(parkingShort(p)) + '</span>' : pr.has_parking === false ? '無' : val(null); }) +
      row('管理費／管理', function (p) { return val(p.mgmt_fee_text) + '<br><span class="small muted">' + esc(p.management || '管理方式未揭露') + '</span>'; }) +
      row('價格判斷', function (p) { return '<span class="small">' + esc(((p.analysis || {}).price_view || {}).text || '目前不足以判斷') + '</span>'; }) +
      row('主要優點', function (p) { return '<span class="small">' + esc((p.analysis || {}).headline_pro || '') + '</span>'; }) +
      row('主要疑慮', function (p) { return '<span class="small">' + esc((p.analysis || {}).headline_con || '') + '</span>'; }) +
      row('待確認事項', function (p) { return '<ul class="tight small">' + ((p.analysis || {}).missing || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; }) +
      row('原始來源', function (p) { return '<span class="small">' + sourceLinks(p) + '</span>'; }) +
      '</tbody></table></div>';
    v.innerHTML = h;
  }

  /* ---------- MARKET ---------- */
  function renderMarket() {
    var v = $('#view-market'), ins = D.insights || {}, area = D.area || {};
    var h = '<div class="page-title"><div><h1>市場與社區分析</h1><p>圓形＝目前在售開價；菱形＝歷史成交（實價登錄）。兩者性質不同，不可直接視為同一種價格。</p></div></div>';
    h += '<div class="grid cols-2"><div class="card chart-card"><h3>在售：開價 × 主建物面積</h3><div class="chart-sub">研究日 ' + esc(D.meta.research_date) + '；n = <span id="c1n"></span>；單位：萬元、坪。參考線為 ' + fmt(S.budgetWan) + ' 萬與 ' + S.minPing + ' 坪。</div><div class="chart" id="chart1"></div></div>' +
      '<div class="card chart-card"><h3>在售：開價 × 捷運步行時間</h3><div class="chart-sub">研究日 ' + esc(D.meta.research_date) + '；n = <span id="c2n"></span>；步行時間為 OSM 路網估算（起點為概略位置）。</div><div class="chart" id="chart2"></div></div></div>';
    h += '<div class="card chart-card section"><h3>同社區：歷史成交 vs 目前在售（②扣車位後價格 ÷ 主建物，萬/坪）</h3><div class="chart-sub">成交期間 ' + esc(D.meta.lvr_period || '') + '；橫軸為日期（在售物件標在研究日）。只納入車位可拆分、無特殊交易備註的成交。選擇社區：<select id="commSel" style="max-width:100%"></select></div><div class="chart" id="chart3"></div><p class="small muted" id="c3note"></p></div>';
    h += '<div class="section"><h2>值得研究的社區</h2>' + communityTable() + '</div>';
    h += '<div class="section"><h2>區域成交概況（依路段）</h2><p class="small muted">' + esc(D.meta.lvr_period || '') + '；住宅（公寓／華廈／住宅大樓）、主建物 ≥ 20 坪、排除特殊關係與含增建等備註、車位可拆分者。樣本 < 5 筆不計中位數。</p>' + roadTable() + '</div>';
    h += '<div class="section"><h2>微區域觀察</h2><div class="grid cols-2">' + (area.micro_areas || []).map(function (mz) {
      var inArea = PROPS.filter(function (p) { return p.micro_area_id === mz.id; });
      return '<div class="card card-pad"><h3>' + esc(mz.name) + '</h3><p class="small muted">' + esc(mz.boundary_desc || '') + '</p><p class="small"><b>建物型態：</b>' + esc(mz.building_stock || '') + '</p><p class="small"><b>生活機能：</b>' + esc((mz.amenities || []).join('、')) + '</p><p class="small"><b>交通：</b>' + esc(mz.transit || '') + '</p><p class="small"><b>需現場確認：</b></p>' + listHtml(mz.onsite_checks) +
        '<p class="small"><b>本區候選：</b>' + (inArea.length ? inArea.map(function (p) { return '<a href="#property/' + esc(p.id) + '">' + esc(p.name) + '</a>'; }).join('、') : '無') + '</p>' +
        '<p class="small muted">來源：' + (mz.sources || []).map(function (s) { return '<a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title || s.url) + '</a>'; }).join('、') + '</p></div>';
    }).join('') + '</div></div>';
    h += '<div class="section"><h2>都更、危老與周邊開發</h2><p class="small muted">區分「正式核定」「審議中」「整合中」「行銷說法」。都更可能性不應被當作確定收益。</p><div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>案名／位置</th><th>階段</th><th>說明</th><th>來源</th></tr></thead><tbody>' +
      ((area.renewal_cases || []).concat(area.developments || [])).map(function (r) { return '<tr><td>' + esc(r.name || '') + '<br><span class="muted small">' + esc(r.location || '') + '</span></td><td><span class="badge ' + (r.stage_category === '正式核定' ? 'ok' : r.stage_category === '行銷說法' ? 'bad' : 'warn') + '">' + esc(r.stage_category || '—') + '</span></td><td class="small">' + esc(r.detail || '') + '</td><td class="small">' + (r.source_url ? '<a href="' + esc(safeUrl(r.source_url)) + '" target="_blank" rel="noopener noreferrer">來源 ↗</a>' : '') + '<br><span class="muted">' + esc(r.accessed || '') + '</span></td></tr>'; }).join('') + '</tbody></table></div></div>';
    h += '<div class="section"><h2>預售屋與新成屋（另列，不與中古屋混排）</h2>' + listHtml(ins.newbuild_summary) + newbuildTable() + '</div>';
    v.innerHTML = h;

    // chart 1 & 2
    function ptsFor(filterFn, xfn) {
      return PROPS.filter(filterFn).map(function (p) { var pr = L.priceRange(p); return { x: xfn(p), y: pr ? pr.max : NaN, label: p.name + '（' + p.id + '）', href: 'property/' + p.id, lines: [p.name, '開價 ' + priceText(p), '主建物 ' + ping(p.area.main_ping) + '｜' + walkText(p), '點擊開啟研究頁'] }; }).filter(function (q) { return isNum(q.x) && isNum(q.y); });
    }
    function series(xfn) {
      return [
        { key: 'A', name: '在售：主建物≥' + S.minPing + '坪（圓形）', color: 'var(--series-1)', shape: 'circle', points: ptsFor(function (p) { return L.areaStatus(p, S.minPing).A === 'ok'; }, xfn) },
        { key: 'B', name: '在售：僅主＋附≥' + S.minPing + '坪（方形）', color: 'var(--series-2)', shape: 'square', points: ptsFor(function (p) { var a = L.areaStatus(p, S.minPing); return a.A !== 'ok' && a.B === 'ok'; }, xfn) },
        { key: 'N', name: '在售：未達或面積待確認（三角形）', color: 'var(--text-3)', shape: 'triangle', points: ptsFor(function (p) { var a = L.areaStatus(p, S.minPing); return a.A !== 'ok' && a.B !== 'ok'; }, xfn) }
      ];
    }
    var s1 = series(function (p) { return p.area.main_ping; }), s2 = series(function (p) { return (p.location || {}).walk_min; });
    $('#c1n').textContent = s1.reduce(function (n, s) { return n + s.points.length; }, 0); $('#c2n').textContent = s2.reduce(function (n, s) { return n + s.points.length; }, 0);
    Charts.scatter($('#chart1'), { series: s1, xTitle: '主建物面積（坪）', yTitle: '開價（萬元）', refX: [{ v: S.minPing, label: S.minPing + ' 坪' }], refY: [{ v: S.budgetWan, label: '預算 ' + fmt(S.budgetWan) + ' 萬' }] });
    Charts.scatter($('#chart2'), { series: s2, xTitle: '到最近出入口步行時間（分，地圖估算）', yTitle: '開價（萬元）', refX: [{ v: 10, label: '10 分' }], refY: [{ v: S.budgetWan, label: '預算 ' + fmt(S.budgetWan) + ' 萬' }], xMin: 0 });
    // chart 3
    function cleanSold(c) { return (c.comp_ids || []).map(function (i) { return COMPS_BY_ID[i]; }).filter(function (x) { return x && isNum(x.unit_main_wan) && !(x.flags || []).some(function (f) { return /特殊關係|含增建|持分|瑕疵|急售|政府|合建|多層/.test(f); }); }); }
    var comms = (D.communities || []).map(function (c) { return { c: c, sold: cleanSold(c) }; }).filter(function (o) { return o.sold.length; }).sort(function (a, b) { return b.sold.length - a.sold.length || b.c.property_ids.length - a.c.property_ids.length; });
    var sel = $('#commSel'); sel.innerHTML = comms.map(function (o, i) { return '<option value="' + i + '">' + esc(o.c.name) + '（可比成交 ' + o.sold.length + '／在售 ' + o.c.property_ids.filter(function (i) { var pp = byId(i); var uu = pp ? (L.askingUnitPrices(pp) || {}) : {}; return isNum(uu.main); }).length + '）</option>'; }).join('');
    function yf(d) { var t = new Date(d); return t.getFullYear() + (t.getMonth() + t.getDate() / 31) / 12; }
    function yfFmt(v) { var y = Math.floor(v), m = Math.min(12, Math.max(1, Math.round((v - y) * 12) + 1)); return y + '-' + (m < 10 ? '0' : '') + m; }
    function drawC3() {
      var o = comms[+sel.value]; if (!o) { $('#chart3').innerHTML = '<p class="muted">沒有「同社區同時有可比成交與在售」的資料。</p>'; return; }
      var c = o.c;
      var sold = o.sold.map(function (x) { return { x: yf(x.trade_date), y: x.unit_main_wan, label: x.trade_date + ' ' + x.address, lines: ['成交 ' + x.trade_date, x.address, fmt(x.price_wan) + ' 萬｜主建物 ' + fmtPing(x.main_ping) + ' 坪｜' + (x.floor || x.floor_raw) + ' 樓', '②÷主建物 ' + fmt(x.unit_main_wan, 1) + ' 萬/坪'] }; });
      var ask = c.property_ids.map(byId).filter(Boolean).map(function (p) { var u = L.askingUnitPrices(p) || {}; return { x: yf(D.meta.research_date), y: u.main, label: p.name + '（在售 ' + p.id + '）', href: 'property/' + p.id, directLabel: p.id, lines: ['在售 ' + p.name, '開價 ' + priceText(p) + '｜主建物 ' + ping(p.area.main_ping), '②開價÷主建物 ' + (isNum(u.main) ? fmt(u.main, 1) : '—') + ' 萬/坪', '點擊開啟研究頁'] }; }).filter(function (q) { return isNum(q.y); });
      Charts.scatter($('#chart3'), { series: [{ key: 'ask', name: '目前在售（開價換算，標在研究日）', color: 'var(--series-1)', shape: 'circle', points: ask }, { key: 'sold', name: '歷史成交（實價登錄）', color: 'var(--series-2)', shape: 'diamond', points: sold }], xTitle: '交易年月（在售物件標在研究日 ' + D.meta.research_date + '）', yTitle: '扣車位後價格 ÷ 主建物（萬/坪）', height: 340, xTickFmt: yfFmt });
      $('#c3note').textContent = '本社區：可比成交 n = ' + sold.length + '、在售 n = ' + ask.length + '。社區以「路段＋總樓層＋完工年月」推定，可能混入鄰棟；已深度查核的物件請以其研究頁的逐筆比較為準。';
    }
    sel.addEventListener('change', drawC3); drawC3();
  }
  function communityTable() {
    var all = D.communities || []; if (!all.length) return '<p class="muted">—</p>';
    var cs = all.filter(function (c) { return c.property_ids.length >= 2 || c.property_ids.some(function (i) { var p = byId(i); return p && (p.analysis.first_round || p.analysis.verified); }); }).slice(0, 40);
    return '<p class="small muted">列出「同一推定社區有 2 間以上在售」或「含已深度查核物件」的社區，共 ' + cs.length + ' 個（全部 ' + all.length + ' 個推定社區的成交比較都在各物件研究頁）。社區以路段＋總樓層＋完工年月推定，名稱取自刊登頁；總戶數等規模資訊各平台多未揭露。</p><div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>社區／建物</th><th>屋齡・規模</th><th>管理・停車</th><th class="r">在售（本研究）</th><th>近期成交（實價登錄）</th><th>待確認事項</th></tr></thead><tbody>' + cs.map(function (c) {
      return '<tr><td><b>' + esc(c.name) + '</b><br><span class="muted small">' + esc(c.address_hint || '') + '</span></td><td class="small">' + esc(c.age_scale || '未揭露') + '</td><td class="small">' + esc(c.mgmt_parking || '未揭露') + '</td><td class="r small">' + c.property_ids.map(function (i) { var p = byId(i); return p ? '<a href="#property/' + esc(i) + '">' + esc(i) + '</a> ' + priceText(p) : ''; }).join('<br>') + '</td><td class="small">' + esc(c.comp_summary || '查詢期間無成交紀錄') + '</td><td class="small">' + esc(c.todo || '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function roadTable() {
    var rs = D.road_stats || []; if (!rs.length) return '<p class="muted">—</p>';
    return '<div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>路段</th><th>建物型態</th><th class="r">樣本數</th><th class="r">①扣車位建坪單價 中位數</th><th class="r">②÷主建物 中位數</th><th class="r">②範圍</th><th class="r">總價中位數（萬）</th><th class="r">主建物中位數（坪）</th></tr></thead><tbody>' + rs.map(function (r) {
      return '<tr><td>' + esc(r.road) + '</td><td>' + esc(r.building_type) + '</td><td class="r">' + esc(r.n) + '</td><td class="r">' + (isNum(r.unit_net_median) ? fmt(r.unit_net_median, 1) : '<span class="muted">樣本不足</span>') + '</td><td class="r">' + (isNum(r.unit_main_median) ? fmt(r.unit_main_median, 1) : '<span class="muted">樣本不足</span>') + '</td><td class="r small">' + (isNum(r.unit_main_min) ? fmt(r.unit_main_min, 0) + '–' + fmt(r.unit_main_max, 0) : '—') + '</td><td class="r">' + (isNum(r.price_median) ? fmt(r.price_median, 0) : '—') + '</td><td class="r">' + (isNum(r.main_median) ? fmtPing(r.main_median) : '—') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function newbuildTable() {
    var ps = D.newbuild_projects || []; if (!ps.length) return '<p class="muted">沒有查得符合條件的預售／新成屋建案資料。</p>';
    return '<div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>建案</th><th>階段</th><th>位置（公開資訊）</th><th>坪數規劃</th><th>價格資訊</th><th>預計完工／交屋</th><th>預算適配（研究推論）</th><th>來源</th></tr></thead><tbody>' + ps.map(function (n) {
      return '<tr><td><b>' + esc(n.name) + '</b><br><span class="muted small">' + esc(n.builder || '') + '</span></td><td>' + esc(n.stage || '') + '</td><td class="small">' + esc(n.location_public || '') + '</td><td class="small">' + esc(n.size_range_ping || '未揭露') + '</td><td class="small">' + esc(n.price_info || '未揭露') + '</td><td class="small">' + esc(n.expected_completion || '未揭露') + '<br><span class="muted">' + esc(n.expected_completion_source || '') + '</span></td><td class="small">' + esc(n.fits_budget_assessment || '') + '</td><td class="small">' + (n.source_urls || []).slice(0, 3).map(function (u, i) { return '<a href="' + esc(safeUrl(u)) + '" target="_blank" rel="noopener noreferrer">來源' + (i + 1) + ' ↗</a>'; }).join(' ') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  /* ---------- NOTES ---------- */
  function renderNotes() {
    var favIds = Object.keys(U.favorites), noteIds = Object.keys(U.notes).filter(function (k) { return U.notes[k] && typeof U.notes[k] === 'object' && String(U.notes[k].text || '').trim(); });
    var ids = favIds.concat(noteIds.filter(function (i) { return favIds.indexOf(i) < 0; }));
    var h = '<div class="page-title"><div><h1>收藏與看屋筆記</h1><p>資料只存在這台電腦的這個瀏覽器（localStorage），不需要帳號。換瀏覽器或清除快取前請先匯出。</p></div></div>';
    h += '<div class="card card-pad"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="btn primary" id="expJson">匯出收藏與筆記（JSON 備份）</button><button type="button" class="btn" id="expCsv">匯出筆記（CSV）</button><label class="btn" style="cursor:pointer">匯入備份（JSON）<input type="file" id="impFile" accept="application/json,.json" class="sr-only"></label><a class="btn" href="exports/properties.csv" download>下載房源資料 CSV</a></div>' +
      '<p class="small muted" style="margin-top:8px">匯入採「合併」：同一物件以較新的筆記為準，不會刪除現有資料。更新房源資料（data/ 資料夾）不會動到這裡的內容；物件 ID 在更新後保持不變。</p></div>';
    if (!ids.length) h += '<div class="card card-pad section"><p>還沒有收藏或筆記。到<a href="#list">房源列表</a>按「☆ 收藏」，或在物件研究頁下方寫筆記。</p></div>';
    else h += '<div class="section grid cols-2">' + ids.map(function (id) {
      var p = byId(id), n = U.notes[id] || {};
      return '<div class="card card-pad notes-box"><h3>' + (p ? '<a href="#property/' + esc(id) + '">' + esc(p.name) + '</a>' : '（已不在目前資料中）' + esc((n.nameSnapshot || id))) + ' <span class="muted small">' + esc(id) + '</span></h3>' +
        (p ? '<div class="small num" style="margin-bottom:6px">' + priceText(p) + '｜主建物 ' + ping(p.area.main_ping) + '｜' + walkText(p) + '</div>' : '<p class="small muted">這筆物件已從最新資料移除，筆記仍保留。</p>') +
        '<textarea data-note="' + esc(id) + '" placeholder="筆記…">' + esc(n.text || '') + '</textarea><div style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap">' + (p ? favBtn(p, true) : '<button type="button" class="btn small" data-unfav="' + esc(id) + '">移除收藏</button>') + '<span class="save-hint">' + (n.updatedAt ? '上次儲存 ' + esc(n.updatedAt.replace('T', ' ').slice(0, 16)) : '') + '</span></div></div>';
    }).join('') + '</div>';
    $('#view-notes').innerHTML = h;
  }
  function download(name, text, type) { var b = new Blob([text], { type: type }); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  /* ---------- CHECKLIST ---------- */
  function renderChecklist() {
    var g = D.generic_questions || [];
    var h = '<div class="page-title"><div><h1>看屋清單：下一步要問什麼</h1><p>本研究沒有聯絡任何房仲。以下問題請你自行決定是否詢問。</p></div><button type="button" class="btn" onclick="window.print()">列印</button></div>';
    h += '<div class="card card-pad"><h3>每一間都該問的問題</h3>' + listHtml(g) + '</div>';
    ['visit', 'need_info'].forEach(function (t) {
      var all = PROPS.filter(function (p) { return (p.analysis || {}).tier === t; }).sort(function (a, b) { return (a.analysis.rank || 999) - (b.analysis.rank || 999); });
      var arr = all.filter(function (p) { return p.analysis.first_round || p.analysis.verified || U.favorites[p.id]; });
      h += '<div class="section"><h2><span class="badge ' + TIER[t].cls + '">' + TIER[t].icon + ' ' + TIER[t].label + '</span></h2>' + arr.map(function (p) {
        return '<div class="card card-pad" style="margin-bottom:12px"><h3><a href="#property/' + esc(p.id) + '">' + esc(p.name) + '</a> <span class="muted small">' + esc(p.id) + '｜' + priceText(p) + '｜主建物 ' + ping(p.area.main_ping) + '</span></h3><div class="grid cols-3"><div><h4>尚缺資料</h4>' + listHtml(p.analysis.missing) + '</div><div><h4>要問房仲</h4>' + listHtml(p.analysis.questions) + '</div><div><h4>現場確認</h4>' + listHtml(p.analysis.onsite_checks) + '</div></div><p class="small">' + sourceLinks(p) + '</p></div>';
      }).join('') + (all.length > arr.length ? '<p class="small muted">此名單另有 ' + (all.length - arr.length) + ' 間未逐間展開（規則式初判）。每一間的提問清單都在它的物件研究頁；把物件加入收藏後，也會出現在這一頁。<a href="#list" data-preset="' + t + '">在列表中檢視 →</a></p>' : '') + '</div>';
    });
    $('#view-checklist').innerHTML = h;
  }

  /* ---------- METHOD ---------- */
  function renderMethod() {
    var m = D.meta, md = D.method || {};
    var h = '<div class="page-title"><div><h1>方法、假設、來源與限制</h1><p>完整文字版見專案資料夾的 ASSUMPTIONS.md、METHODOLOGY.md、RESEARCH_LOG.md、QA_REPORT.md。</p></div></div>';
    h += '<div class="grid cols-2"><div class="card card-pad"><h3>研究假設（可被你推翻）</h3>' + listHtml(md.assumptions) + '</div><div class="card card-pad"><h3>研究限制</h3>' + listHtml(md.limitations) + '</div></div>';
    h += '<div class="section"><h2>資料用途區分</h2><div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>資料類型</th><th>用途</th><th>不代表</th></tr></thead><tbody><tr><td>房仲刊登頁</td><td>確認研究日的刊登開價與物件描述</td><td>不代表仍可售、不代表面積已由謄本核實</td></tr><tr><td>實價登錄（內政部開放資料）</td><td>研究歷史成交價與面積拆分</td><td>不代表現在有同條件房屋出售</td></tr><tr><td>社區資訊頁</td><td>了解社區屋齡、規模、管理</td><td>不代表每一戶條件相同</td></tr></tbody></table></div></div>';
    h += '<div class="section"><h2>方法摘要</h2><div class="card card-pad">' + listHtml(md.methods) + '</div></div>';
    h += '<div class="section"><h2>各平台查閱紀錄</h2><div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>平台</th><th>存取方式</th><th class="r">掃描</th><th class="r">初篩保留</th><th>限制與說明</th></tr></thead><tbody>' + (D.platform_log || []).map(function (r) { return '<tr><td><b>' + esc(r.platform_name) + '</b></td><td class="small">' + esc(r.access_method || '') + '</td><td class="r">' + (isNum(r.scanned_count) ? fmt(r.scanned_count, 0) : '—') + '</td><td class="r">' + (isNum(r.kept_count) ? r.kept_count : '—') + '</td><td class="small">' + esc(r.limitations || '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    h += '<div class="section"><h2>購屋時 8,000 萬以外的費用（未含在預算內）</h2><div class="card card-pad">' + '<ul class="tight">' + ((D.area || {}).transaction_costs || []).map(function (t) { return '<li>' + esc(t.item || t.name || '') + '：' + esc(t.rule || t.detail || '') + (t.source_url ? '　<a href="' + esc(safeUrl(t.source_url)) + '" target="_blank" rel="noopener noreferrer">來源 ↗</a>' : '') + '</li>'; }).join('') + '</ul>' + '<p class="small muted">僅列規則與來源；本研究不假設你的貸款資格、成數或稅務身分。</p></div></div>';
    h += '<div class="section"><h2>來源清單</h2><div class="table-wrap" tabindex="0" role="region" aria-label="可橫向捲動的表格"><table><thead><tr><th>來源</th><th>類型</th><th>用途</th><th>查閱日</th></tr></thead><tbody>' + (D.sources || []).map(function (s) { return '<tr><td><a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title || s.url) + '</a></td><td>' + esc(s.type || '') + '</td><td class="small">' + esc(s.used_for || '') + '</td><td class="small">' + esc(s.accessed || '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    h += '<div class="section"><h2>如何更新房源而不破壞收藏與筆記</h2><div class="card card-pad">' + listHtml(md.update_steps) + '</div></div>';
    $('#view-method').innerHTML = h;
  }

  /* ---------- routing & events ---------- */
  var RENDER = { overview: renderOverview, list: renderList, map: renderMap, compare: renderCompare, market: renderMarket, notes: renderNotes, checklist: renderChecklist, method: renderMethod };
  function route() {
    var hash = (location.hash || '#overview').slice(1), parts = hash.split('/'), view = parts[0] || 'overview';
    var key = view + '/' + (parts[1] || '');
    if (view === 'property') { var pid = ''; try { pid = decodeURIComponent(parts[1] || ''); } catch (e) { pid = ''; } show('property', 'list'); renderProperty(pid); route._last = key; return; }
    if (!RENDER[view]) view = 'overview';
    show(view, view); RENDER[view]();
    if (route._last !== key) window.scrollTo(0, 0);
    route._last = key;
  }
  function show(view, navKey) {
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    $$('#nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.view === navKey); if (a.dataset.view === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    Charts.hideTip();
  }
  function updateCounts() {
    $('#navCount').textContent = PROPS.length; $('#navFav').textContent = Object.keys(U.favorites).length; $('#navCompare').textContent = U.compare.length;
    var tray = $('#tray'); var onCompare = (location.hash || '').indexOf('#compare') === 0;
    if (U.compare.length && !onCompare) { tray.classList.add('show'); $('#trayText').textContent = '已選 ' + U.compare.length + ' / 4 間比較'; } else tray.classList.remove('show');
  }
  function rerenderCurrent() { route(); }
  function syncButtons() {
    $$('[data-fav]').forEach(function (b) { var on = !!U.favorites[b.dataset.fav]; b.setAttribute('aria-pressed', on); b.textContent = on ? '★ 已收藏' : '☆ 收藏'; });
    $$('[data-cmp]').forEach(function (b) { if (b.classList.contains('ghost')) return; var on = U.compare.indexOf(b.dataset.cmp) >= 0; b.setAttribute('aria-pressed', on); b.textContent = on ? '✓ 已加入比較' : '＋ 比較'; });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-fav],[data-cmp],[data-mode],[data-viewmode],[data-focus],[data-unfav],[data-preset],[data-scroll],#fReset,#fReset2,#cmpClear,#trayClear,#expJson,#expCsv,#resetCriteria');
    if (!t) return;
    if (t.dataset.fav) { var id = t.dataset.fav; if (U.favorites[id]) delete U.favorites[id]; else U.favorites[id] = { addedAt: new Date().toISOString(), nameSnapshot: (byId(id) || {}).name }; saveU(); toast(U.favorites[id] ? '已收藏' : '已取消收藏'); if (/^#(notes|checklist)/.test(location.hash) || S.f.favOnly) rerenderCurrent(); else syncButtons(); }
    else if (t.dataset.unfav) { delete U.favorites[t.dataset.unfav]; saveU(); rerenderCurrent(); }
    else if (t.dataset.cmp) { var cid = t.dataset.cmp, i = U.compare.indexOf(cid); if (i >= 0) U.compare.splice(i, 1); else if (U.compare.length >= 4) { toast('最多同時比較 4 間，請先移除一間'); return; } else U.compare.push(cid); saveU(); if (/^#compare/.test(location.hash)) rerenderCurrent(); else syncButtons(); }
    else if (t.dataset.mode) { S.mode = t.dataset.mode; saveS(); renderList(); }
    else if (t.dataset.viewmode) { S.viewMode = t.dataset.viewmode; saveS(); renderList(); }
    else if (t.dataset.focus && map && mapLayers.byId && mapLayers.byId[t.dataset.focus]) { var mk = mapLayers.byId[t.dataset.focus]; map.setView(mk.getLatLng(), 17); mk.openPopup(); }
    else if (t.dataset.preset) { resetFilters(); S.f.tier = t.dataset.preset; saveS(); }
    else if (t.dataset.scroll) { e.preventDefault(); var el = document.getElementById(t.dataset.scroll); if (el) el.scrollIntoView({ behavior: 'smooth' }); }
    else if (t.id === 'fReset' || t.id === 'fReset2') resetFilters();
    else if (t.id === 'resetCriteria') { S.budgetWan = L.DEFAULTS.budgetWan; S.minPing = L.DEFAULTS.minPing; saveS(); rerenderCurrent(); }
    else if (t.id === 'cmpClear' || t.id === 'trayClear') { U.compare = []; saveU(); rerenderCurrent(); }
    else if (t.id === 'expJson') { download('xinyi-anhe-我的收藏與筆記-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ app: 'xinyi-anhe-housing-research', exported_at: new Date().toISOString(), data_research_date: D.meta.research_date, userdata: U, settings: S }, null, 2), 'application/json'); toast('已匯出備份'); }
    else if (t.id === 'expCsv') {
      var rows = [['物件ID', '名稱', '總價(萬)', '主建物(坪)', '收藏', '筆記', '筆記更新時間', '來源網址']];
      Object.keys(Object.assign({}, U.favorites, U.notes)).forEach(function (id) { var p = byId(id) || {}, n = U.notes[id] || {}; var pr = p.id ? L.priceRange(p) : null; rows.push([id, p.name || n.nameSnapshot || '', pr ? pr.max : '', (p.area || {}).main_ping || '', U.favorites[id] ? '是' : '', n.text || '', n.updatedAt || '', ((p.listings || [])[0] || {}).url || '']); });
      download('xinyi-anhe-我的筆記-' + new Date().toISOString().slice(0, 10) + '.csv', '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n'), 'text/csv;charset=utf-8'); toast('已匯出 CSV');
    }
  });
  var inputTimer = null;
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.note) {
      var id = t.dataset.note; clearTimeout(inputTimer);
      inputTimer = setTimeout(function () {
        U.notes[id] = { text: t.value, updatedAt: new Date().toISOString(), nameSnapshot: (byId(id) || {}).name || (U.notes[id] || {}).nameSnapshot };
        if (!t.value.trim()) delete U.notes[id];
        var ok = saveU(); var hint = $('#noteHint'); if (hint) hint.textContent = ok ? '已自動儲存 ' + new Date().toLocaleTimeString('zh-TW') : '⚠ 瀏覽器不允許本機儲存（可能是隱私模式）；請先匯出備份';
      }, 350);
      return;
    }
    if (t.closest && t.closest('#view-list .controls')) {
      if (t.id === 'setBudget' || t.id === 'setMinPing') return; // 門檻在 change（Enter／離開欄位）時才套用，避免打字中途重繪打亂數字
      clearTimeout(inputTimer);
      inputTimer = setTimeout(function () { readFilters(); renderListBody(); }, t.type === 'search' || t.type === 'number' ? 250 : 0);
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'sortSel') { S.sort = t.value; saveS(); renderListBody(); }
    else if (t.id === 'setBudget' || t.id === 'setMinPing') {
      var nv = parseFloat(t.value);
      if (isFinite(nv) && nv > 0) { if (t.id === 'setBudget') S.budgetWan = nv; else S.minPing = nv; saveS(); renderList(); toast(t.id === 'setBudget' ? '預算上限已改為 ' + fmt(nv) + ' 萬，全站重新判斷' : '坪數門檻已改為 ' + nv + ' 坪，全站重新判斷'); }
      else { t.value = t.id === 'setBudget' ? S.budgetWan : S.minPing; toast('請輸入大於 0 的數字'); }
    }
    else if (t.id === 'impFile' && t.files && t.files[0]) {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var j = JSON.parse(fr.result), ud = j.userdata || j; if (!ud || typeof ud !== 'object' || (!ud.favorites && !ud.notes)) throw new Error('格式不符');
          var favIn = {}, notesIn = {};
          Object.keys(ud.favorites || {}).forEach(function (k) { var fv = ud.favorites[k]; if (fv && typeof fv === 'object') favIn[String(k)] = { addedAt: String(fv.addedAt || ''), nameSnapshot: fv.nameSnapshot == null ? undefined : String(fv.nameSnapshot) }; });
          Object.keys(ud.notes || {}).forEach(function (k) { var n = ud.notes[k]; if (n && typeof n === 'object' && typeof n.text === 'string') notesIn[String(k)] = { text: n.text, updatedAt: String(n.updatedAt || ''), nameSnapshot: n.nameSnapshot == null ? undefined : String(n.nameSnapshot) }; });
          Object.keys(favIn).forEach(function (k) { if (!U.favorites[k]) U.favorites[k] = favIn[k]; });
          Object.keys(notesIn).forEach(function (k) { var n = notesIn[k], cur = U.notes[k]; if (!cur || (n.updatedAt || '') > (cur.updatedAt || '')) U.notes[k] = n; });
          saveU(); toast('匯入完成（已合併）'); renderNotes();
        } catch (err) { toast('匯入失敗：' + err.message); }
      };
      fr.readAsText(t.files[0]);
    }
  });
  window.addEventListener('hashchange', function () { route(); updateCounts(); });
  function flushNotes() { $$('textarea[data-note]').forEach(function (t) { var id = t.dataset.note, cur = (U.notes[id] || {}).text || ''; if (t.value !== cur) { if (t.value.trim()) U.notes[id] = { text: t.value, updatedAt: new Date().toISOString(), nameSnapshot: (byId(id) || {}).name || (U.notes[id] || {}).nameSnapshot }; else delete U.notes[id]; lsSet(UKEY, U); } }); }
  window.addEventListener('beforeunload', flushNotes);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushNotes(); });

  $('#footText').textContent = '研究基準日 ' + D.meta.research_date + '｜資料產生時間 ' + (D.meta.generated_at || '').replace('T', ' ').slice(0, 16) + '｜本網站是個人購屋研究筆記，不是購屋或投資建議；所有物件的可售狀態、面積與價格請以原始刊登頁與謄本為準；刊登資料著作權屬各平台；成交資料來源為內政部實價登錄開放資料；底圖為內政部國土測繪中心臺灣通用電子地圖與 © OpenStreetMap contributors。';
  updateCounts(); route();
  window.__APP = { counts: counts, filtered: filtered, S: S, U: U };
})();
