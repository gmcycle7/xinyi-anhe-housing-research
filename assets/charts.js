/* 輕量 SVG 散佈圖（無外部相依）。
 * 在售 = 圓形、成交 = 菱形（形狀＋顏色雙重編碼，不只靠顏色）。
 * 每個點有直徑 26（viewBox 單位）的透明感應區與 hover/focus tooltip；窄螢幕上感應區會隨圖縮小，
 * 因此每張圖都附「表格檢視」作為不依賴指到點的替代方式。點數 >60 時資料點不進入 Tab 順序。 */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = (count * step) / span;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    var t0 = Math.floor(min / step) * step, t1 = Math.ceil(max / step) * step, ticks = [];
    for (var v = t0; v <= t1 + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return ticks;
  }
  function fmtNum(n) { return (Math.round(n * 100) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  var tip = null;
  function showTip(evt, lines) {
    tip = tip || document.getElementById('tooltip');
    if (!tip) return;
    tip.textContent = '';
    lines.forEach(function (ln, i) {
      var n = document.createElement(i === 0 ? 'b' : 'div');
      n.textContent = ln; tip.appendChild(n);
    });
    tip.style.display = 'block';
    var x = (evt.clientX || 0) + 14, y = (evt.clientY || 0) + 14;
    if (evt.type === 'focus' && evt.target.getBoundingClientRect) {
      var r = evt.target.getBoundingClientRect(); x = r.right + 8; y = r.top;
    }
    var w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > window.innerWidth - 8) x = Math.max(8, x - w - 28);
    if (y + h > window.innerHeight - 8) y = Math.max(8, y - h - 28);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }

  /**
   * scatter(container, cfg)
   * cfg: { series:[{key,name,color(var),shape:'circle'|'diamond',points:[{x,y,label,lines:[..],href}]}],
   *        xTitle,yTitle, refX:[{v,label}], refY:[{v,label}], xMin,xMax,yMin,yMax, labelPoints:int, height }
   */
  function scatter(container, cfg) {
    container.textContent = '';
    var all = [];
    cfg.series.forEach(function (s) { s.points.forEach(function (p) { if (Number.isFinite(p.x) && Number.isFinite(p.y)) all.push(p); }); });
    if (!all.length) {
      var empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = '目前沒有足夠的資料可繪製這張圖。';
      container.appendChild(empty); return;
    }
    var W = 760, H = cfg.height || 380, m = { t: 16, r: 22, b: 46, l: 62 };
    var xs = all.map(function (p) { return p.x; }), ys = all.map(function (p) { return p.y; });
    (cfg.refX || []).forEach(function (r) { xs.push(r.v); }); (cfg.refY || []).forEach(function (r) { ys.push(r.v); });
    var xMin = cfg.xMin != null ? cfg.xMin : Math.min.apply(null, xs), xMax = cfg.xMax != null ? cfg.xMax : Math.max.apply(null, xs);
    var yMin = cfg.yMin != null ? cfg.yMin : Math.min.apply(null, ys), yMax = cfg.yMax != null ? cfg.yMax : Math.max.apply(null, ys);
    var xt = niceTicks(xMin, xMax, 7), yt = niceTicks(yMin, yMax, 6);
    xMin = xt[0]; xMax = xt[xt.length - 1]; yMin = yt[0]; yMax = yt[yt.length - 1];
    function X(v) { return m.l + (v - xMin) / (xMax - xMin) * (W - m.l - m.r); }
    function Y(v) { return H - m.b - (v - yMin) / (yMax - yMin) * (H - m.t - m.b); }

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': cfg.ariaLabel || (cfg.yTitle + ' 對 ' + cfg.xTitle + ' 散佈圖') }, container);
    yt.forEach(function (v) {
      el('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, svg);
      var t = el('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, el('g', { class: 'tick' }, svg)); t.textContent = fmtNum(v);
    });
    xt.forEach(function (v) {
      var t = el('text', { x: X(v), y: H - m.b + 18, 'text-anchor': 'middle' }, el('g', { class: 'tick' }, svg)); t.textContent = cfg.xTickFmt ? cfg.xTickFmt(v) : fmtNum(v);
    });
    el('line', { class: 'ref', x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }, svg);
    var xtitle = el('text', { class: 'axis-title', x: (m.l + W - m.r) / 2, y: H - 8, 'text-anchor': 'middle' }, svg); xtitle.textContent = cfg.xTitle;
    var ytitle = el('text', { class: 'axis-title', x: 14, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (m.t + H - m.b) / 2 + ')' }, svg); ytitle.textContent = cfg.yTitle;

    (cfg.refX || []).forEach(function (r) {
      el('line', { class: 'ref', x1: X(r.v), x2: X(r.v), y1: m.t, y2: H - m.b }, svg);
      var t = el('text', { class: 'ref-label', x: X(r.v) + 5, y: m.t + 11 }, svg); t.textContent = r.label;
    });
    (cfg.refY || []).forEach(function (r) {
      el('line', { class: 'ref', x1: m.l, x2: W - m.r, y1: Y(r.v), y2: Y(r.v) }, svg);
      var t = el('text', { class: 'ref-label', x: W - m.r - 4, y: Y(r.v) - 5, 'text-anchor': 'end' }, svg); t.textContent = r.label;
    });

    var manyPoints = all.length > 60; // 點很多時不把每個點都放進 Tab 順序（鍵盤使用者改用下方的表格檢視）
    cfg.series.forEach(function (s) {
      s.points.forEach(function (p) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
        var g = el('g', { class: 'pt' }, svg), cx = X(p.x), cy = Y(p.y);
        var hit = el('circle', { class: 'hit', cx: cx, cy: cy, r: 13, tabindex: manyPoints ? -1 : 0, role: p.href ? 'link' : 'img', 'aria-label': (p.lines || [p.label]).join('；') }, g);
        if (s.shape === 'diamond') el('path', { class: 'mark', d: 'M' + cx + ' ' + (cy - 6.5) + 'L' + (cx + 6.5) + ' ' + cy + 'L' + cx + ' ' + (cy + 6.5) + 'L' + (cx - 6.5) + ' ' + cy + 'Z', fill: s.color }, g);
        else if (s.shape === 'square') el('rect', { class: 'mark', x: cx - 5, y: cy - 5, width: 10, height: 10, fill: s.color }, g);
        else if (s.shape === 'triangle') el('path', { class: 'mark', d: 'M' + cx + ' ' + (cy - 6.5) + 'L' + (cx + 6) + ' ' + (cy + 5) + 'L' + (cx - 6) + ' ' + (cy + 5) + 'Z', fill: s.color }, g);
        else el('circle', { class: 'mark', cx: cx, cy: cy, r: 5.5, fill: s.color }, g);
        var lines = p.lines || [p.label];
        hit.addEventListener('pointermove', function (e) { showTip(e, lines); });
        hit.addEventListener('pointerleave', hideTip);
        hit.addEventListener('focus', function (e) { showTip(e, lines); });
        hit.addEventListener('blur', hideTip);
        if (p.href) { hit.addEventListener('click', function () { location.hash = p.href; }); hit.addEventListener('keydown', function (e) { if (e.key === 'Enter') location.hash = p.href; }); }
        if (p.directLabel) { var t = el('text', { class: 'dlabel', x: cx + 9, y: cy - 8 }, svg); t.textContent = p.directLabel; }
      });
    });

    if (cfg.series.length > 1) {
      var lg = document.createElement('div'); lg.className = 'chart-legend';
      cfg.series.forEach(function (s) {
        var item = document.createElement('span');
        var sv = document.createElementNS(NS, 'svg'); sv.setAttribute('viewBox', '0 0 14 14'); sv.setAttribute('aria-hidden', 'true');
        if (s.shape === 'diamond') el('path', { d: 'M7 1L13 7L7 13L1 7Z', fill: s.color }, sv); else if (s.shape === 'square') el('rect', { x: 2, y: 2, width: 10, height: 10, fill: s.color }, sv); else if (s.shape === 'triangle') el('path', { d: 'M7 1L13 12L1 12Z', fill: s.color }, sv); else el('circle', { cx: 7, cy: 7, r: 5.5, fill: s.color }, sv);
        item.appendChild(sv); item.appendChild(document.createTextNode(s.name + '（' + s.points.filter(function (q) { return Number.isFinite(q.x) && Number.isFinite(q.y); }).length + '）'));
        lg.appendChild(item);
      });
      container.appendChild(lg);
    }

    // 表格檢視
    var det = document.createElement('details'); det.className = 'tableview';
    var sum = document.createElement('summary'); sum.textContent = '以表格檢視這張圖的資料'; det.appendChild(sum);
    var wrap = document.createElement('div'); wrap.className = 'table-wrap'; var tb = document.createElement('table');
    var hr = document.createElement('tr'); ['類別', '項目', cfg.xTitle, cfg.yTitle].forEach(function (h) { var th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    var thead = document.createElement('thead'); thead.appendChild(hr); tb.appendChild(thead); var body = document.createElement('tbody');
    cfg.series.forEach(function (s) {
      s.points.forEach(function (p) {
        var tr = document.createElement('tr');
        [s.name, p.label, cfg.xTickFmt ? cfg.xTickFmt(p.x) : fmtNum(p.x), fmtNum(p.y)].forEach(function (v, i) { var td = document.createElement('td'); td.textContent = v; if (i > 1) td.className = 'r'; tr.appendChild(td); });
        body.appendChild(tr);
      });
    });
    tb.appendChild(body); wrap.appendChild(tb); det.appendChild(wrap); container.appendChild(det);
  }

  root.Charts = { scatter: scatter, showTip: showTip, hideTip: hideTip };
})(window);
