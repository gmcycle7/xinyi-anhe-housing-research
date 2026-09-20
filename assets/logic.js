/* 判斷邏輯（瀏覽器與 Node 共用；tools/run_tests.js 會直接測這個檔案）
 *
 * 單位：金額 = 萬元；面積 = 坪。缺值一律為 null（不是 0）。
 * 面積比較一律以 1/10000 坪的整數運算，避免「25.99 顯示成 26.0 而通過」
 * 以及浮點數相加誤差（例如 23.4 + 2.6）造成的誤判。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = { budgetWan: 8000, minPing: 26, walkPrimaryMin: 10, walkExtendedMin: 15 };

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function toUnits(v) { return Math.round(v * 10000); } // 1/10000 坪 或 1/10000 萬元

  /** 各平台開價的最小與最大值（同一戶多平台刊登時可能不同）。 */
  function priceRange(p) {
    var prices = [];
    // 同一戶有「含車位／不含車位」兩種銷售組合、且車位可不買時，研究員會填入屋價範圍（不含車位），預算與單價一律以屋價計算
    var hr = p.price && p.price.house_price_range_wan;
    if (hr && isNum(hr[0]) && isNum(hr[1])) return { min: Math.min(hr[0], hr[1]), max: Math.max(hr[0], hr[1]), count: 2, houseOnly: true };
    (p.listings || []).forEach(function (l) { if (isNum(l.price_wan)) prices.push(l.price_wan); });
    if (!prices.length && p.price && isNum(p.price.listing_price_wan)) prices.push(p.price.listing_price_wan);
    if (!prices.length) return null;
    return { min: Math.min.apply(null, prices), max: Math.max.apply(null, prices), count: prices.length };
  }

  /**
   * 預算判斷。
   * 回傳 { status: 'ok'|'over'|'unknown', totalWan: number|null, reason: string, steps: string[] }
   * 規則：
   *  - 可確認購買總價 = 房屋開價 + 必須一併購買的車位（及其他不可分售項目）。
   *  - 超過預算一律不通過；不因「可議價」而放行。
   *  - 車位是否含在總價／是否必買不明，且最壞情況會超過預算 → 'unknown'（總價待確認）。
   */
  function budgetStatus(p, budgetWan) {
    var B = isNum(budgetWan) ? budgetWan : DEFAULTS.budgetWan;
    var steps = [];
    var pr = priceRange(p);
    if (!pr) return { status: 'unknown', totalWan: null, reason: '刊登頁未揭露開價', steps: ['缺少開價 → 總價待確認'] };
    var price = p.price || {};
    var extra = isNum(price.other_mandatory_wan) ? price.other_mandatory_wan : 0;
    var parkPrice = isNum(price.parking_price_wan) ? price.parking_price_wan : null;
    var hasParking = price.has_parking; // true / false / null
    var includes = price.includes_parking; // true / false / null
    var mustBuy = price.parking_must_buy; // true / false / null

    steps.push(pr.houseOnly ? '同一戶有含車位與不含車位兩種刊登；車位可不買 → 以屋價（不含車位）' + pr.min + '～' + pr.max + ' 萬判斷' : pr.count > 1 && pr.min !== pr.max
      ? '各平台開價不一致：' + pr.min + '～' + pr.max + ' 萬（以最高開價做保守判斷）'
      : '刊登開價 ' + pr.max + ' 萬');
    if (extra) steps.push('其他不可分售項目 ' + extra + ' 萬');

    function verdict(lowTotal, highTotal, label) {
      // lowTotal/highTotal：最佳與最壞情況的可確認總價
      if (toUnits(lowTotal) > toUnits(B)) {
        return { status: 'over', totalWan: lowTotal, reason: label + '：' + fmt(lowTotal) + ' 萬 > 預算 ' + fmt(B) + ' 萬', steps: steps };
      }
      if (toUnits(highTotal) <= toUnits(B)) {
        return { status: 'ok', totalWan: highTotal, reason: label + '：' + fmt(highTotal) + ' 萬 ≤ 預算 ' + fmt(B) + ' 萬', steps: steps };
      }
      return { status: 'unknown', totalWan: null, reason: label + '：介於 ' + fmt(lowTotal) + '～' + fmt(highTotal) + ' 萬，跨過預算 ' + fmt(B) + ' 萬 → 總價待確認', steps: steps };
    }

    var low = pr.min + extra, high = pr.max + extra;

    if (hasParking === false) {
      steps.push('刊登頁顯示無車位 → 總價 = 開價');
      return verdict(low, high, '無車位，總價');
    }
    if (includes === true) {
      steps.push('刊登總價已含車位 → 不另加車位價');
      return verdict(low, high, '含車位總價');
    }
    if (includes === false) {
      if (mustBuy === false) {
        steps.push('車位另計且可不買' + (parkPrice !== null ? '（選配車位 ' + parkPrice + ' 萬）' : '') + ' → 以房屋開價判斷');
        return verdict(low, high, '房屋總價（車位選配）');
      }
      if (parkPrice === null) {
        steps.push('車位另計但車位價格未揭露 → 無法確認總價');
        if (toUnits(low) > toUnits(B)) return verdict(low, high, '房屋開價（未含車位）');
        return { status: 'unknown', totalWan: null, reason: '車位另計、價格未揭露 → 總價待確認', steps: steps };
      }
      if (mustBuy === true) {
        steps.push('車位另計且必須購買：+' + parkPrice + ' 萬');
        return verdict(low + parkPrice, high + parkPrice, '房屋＋必買車位');
      }
      steps.push('車位另計 ' + parkPrice + ' 萬，是否必買不明 → 以「不買～必買」兩種情況檢查');
      return verdict(low, high + parkPrice, '房屋（＋車位？）');
    }
    // includes === null：有車位或不確定有無車位，且不確定總價是否含車位
    if (hasParking === true) {
      if (parkPrice !== null) {
        steps.push('有車位，但總價是否含車位不明；車位價 ' + parkPrice + ' 萬 → 檢查兩種情況');
        return verdict(low, high + parkPrice, '房屋（＋車位？）');
      }
      steps.push('有車位，但總價是否含車位不明、車位價也未揭露');
      if (toUnits(low) > toUnits(B)) return verdict(low, high, '刊登開價');
      return { status: 'unknown', totalWan: null, reason: '有車位但是否含在總價不明 → 總價待確認', steps: steps };
    }
    // hasParking === null
    steps.push('刊登頁未說明有無車位及計價方式');
    if (toUnits(low) > toUnits(B)) return verdict(low, high, '刊登開價');
    return { status: 'unknown', totalWan: null, reason: '車位資訊未揭露 → 總價待確認', steps: steps };
  }

  /**
   * 面積判斷。
   * A：主建物 ≥ minPing。B：主建物＋附屬建物 ≥ minPing。
   * 回傳 { A, B, label, steps, mainAux }；A/B ∈ 'ok'|'fail'|'unknown'
   * area.doubt（字串）存在時：數字即使達標，也降為 'unknown'（登記疑義待核對）。
   * 估算值（area.estimated_main_ping）永遠不參與判斷。
   */
  function areaStatus(p, minPing) {
    var M = isNum(minPing) ? minPing : DEFAULTS.minPing;
    var a = p.area || {};
    var steps = [];
    var main = isNum(a.main_ping) ? a.main_ping : null;
    var aux = isNum(a.aux_ping) ? a.aux_ping : null;
    var A, B, mainAux = null;

    var mpa = isNum(a.main_plus_aux_ping) ? a.main_plus_aux_ping : null; // 平台只揭露「主建物＋附屬建物」合計
    if (main === null && mpa !== null) {
      mainAux = mpa;
      B = toUnits(mpa) >= toUnits(M) ? 'ok' : 'fail';
      A = B === 'fail' ? 'fail' : 'unknown';
      steps.push('平台只揭露「主建物＋附屬建物」合計 ' + mpa + ' 坪' + (B === 'ok' ? ' ≥ ' + M + ' 坪 → B 口徑符合；主建物單獨數字未揭露 → A 口徑待確認' : ' < ' + M + ' 坪 → 主建物不可能達標，A、B 皆不符合'));
    } else if (main === null) {
      A = 'unknown';
      steps.push('主建物坪數未揭露 → A 口徑待確認');
    } else {
      A = toUnits(main) >= toUnits(M) ? 'ok' : 'fail';
      steps.push('主建物 ' + main + ' 坪 ' + (A === 'ok' ? '≥' : '<') + ' ' + M + ' 坪（以原始精度比較，不四捨五入）');
    }
    if (main === null && mpa !== null) {
      // 已於上方處理
    } else if (main !== null && aux !== null) {
      var sumUnits = toUnits(main) + toUnits(aux);
      mainAux = sumUnits / 10000;
      B = sumUnits >= toUnits(M) ? 'ok' : 'fail';
      steps.push('主建物 ' + main + ' ＋ 附屬建物 ' + aux + ' = ' + mainAux + ' 坪 ' + (B === 'ok' ? '≥' : '<') + ' ' + M + ' 坪');
    } else if (main !== null && A === 'ok') {
      B = 'ok';
      steps.push('附屬建物未揭露，但主建物已達標 → B 口徑亦成立（附屬建物 ≥ 0）');
    } else {
      B = 'unknown';
      steps.push('附屬建物坪數未揭露 → B 口徑待確認');
    }
    if (a.doubt) {
      if (A === 'ok') A = 'unknown';
      if (B === 'ok') B = 'unknown';
      steps.push('登記疑義：' + a.doubt + ' → 即使數字達標仍列為待核對');
    }
    if (isNum(a.estimated_main_ping)) {
      steps.push('（估算主建物約 ' + a.estimated_main_ping + ' 坪僅供參考，不參與判斷）');
    }
    var label;
    if (A === 'ok') label = '主建物符合 ' + M + ' 坪';
    else if (B === 'ok') label = '主＋附符合' + M + '坪；主建物未達' + M + '坪';
    else if (A === 'fail' && B === 'fail') label = '兩種口徑皆未達 ' + M + ' 坪';
    else label = '面積待確認';
    return { A: A, B: B, label: label, steps: steps, mainAux: mainAux };
  }

  /** 位置判斷：'primary' ≤10 分、'extended' 10–15 分、'out' >15 分、'unknown' 無法估算。 */
  function walkStatus(p, primaryMin, extendedMin) {
    var P1 = isNum(primaryMin) ? primaryMin : DEFAULTS.walkPrimaryMin;
    var P2 = isNum(extendedMin) ? extendedMin : DEFAULTS.walkExtendedMin;
    var loc = p.location || {};
    if (!isNum(loc.walk_min)) return { zone: 'unknown', label: '步行時間待確認' };
    if (loc.walk_min <= P1) return { zone: 'primary', label: '優先範圍（≤' + P1 + ' 分）' };
    if (loc.walk_min <= P2) return { zone: 'extended', label: '擴大範圍（' + P1 + '–' + P2 + ' 分）' };
    return { zone: 'out', label: '超出 ' + P2 + ' 分鐘' };
  }

  /**
   * 綜合分類（用於總覽計數與篩選）。mode = 'A' | 'B'
   *  'confirmed'  依刊登頁數字：預算 ok + 面積 ok + 步行 ≤15 分 + 一般住宅
   *  'pending'    沒有任何一項明確不符合，但至少一項待確認
   *  'not_fit'    任一項明確不符合
   */
  function classify(p, opts) {
    opts = opts || {};
    var mode = opts.mode === 'B' ? 'B' : 'A';
    var b = budgetStatus(p, opts.budgetWan);
    var ar = areaStatus(p, opts.minPing);
    var w = walkStatus(p, opts.walkPrimaryMin, opts.walkExtendedMin);
    var areaKey = ar[mode];
    var fails = [], pendings = [];
    if (b.status === 'over') fails.push('超出預算'); else if (b.status === 'unknown') pendings.push('總價待確認');
    if (areaKey === 'fail') fails.push(mode === 'A' ? '主建物未達標' : '主＋附未達標'); else if (areaKey === 'unknown') pendings.push('面積待確認');
    if (w.zone === 'out') fails.push('步行超過範圍'); else if (w.zone === 'unknown') pendings.push('位置待確認');
    if (p.residential_ok === false) fails.push('非一般完整住宅');
    else if (p.residential_ok == null) pendings.push('住宅用途待確認');
    var cls = fails.length ? 'not_fit' : (pendings.length ? 'pending' : 'confirmed');
    return { cls: cls, fails: fails, pendings: pendings, budget: b, area: ar, walk: w };
  }

  /** 在售物件的三種單價口徑（開價換算；車位價不明時只回傳含車位指標）。 */
  function askingUnitPrices(p) {
    var pr = priceRange(p); var a = p.area || {}; var price = p.price || {};
    if (!pr) return null;
    var ask = pr.max;
    var out = { ask: ask, net: null, main: null, mainAux: null, grossInclParking: null, basis: '' };
    if (isNum(a.total_ping) && a.total_ping > 0) out.grossInclParking = ask / a.total_ping;
    var netPrice = null, netArea = null;
    if (price.has_parking === false) {
      netPrice = ask; netArea = isNum(a.total_ping) ? a.total_ping : null; out.basis = '無車位';
    } else if (price.has_parking === true && price.includes_parking === true && isNum(price.parking_price_wan) && isNum(a.parking_ping)) {
      netPrice = ask - price.parking_price_wan;
      netArea = isNum(a.total_ping) ? a.total_ping - a.parking_ping : null; // 車位面積只扣一次
      out.basis = '扣除刊登頁揭露之車位價與車位坪數';
    } else if (price.has_parking === true && price.includes_parking === false) {
      netPrice = ask;
      netArea = isNum(a.total_ping) ? a.total_ping - (a.total_includes_parking && isNum(a.parking_ping) ? a.parking_ping : 0) : null;
      out.basis = '開價未含車位';
    } else {
      out.basis = '車位價格或面積無法拆分 → 僅提供含車位指標';
    }
    if (netPrice !== null) {
      if (isNum(netArea) && netArea > 0) out.net = netPrice / netArea;
      if (isNum(a.main_ping) && a.main_ping > 0) out.main = netPrice / a.main_ping;
      if (isNum(a.main_ping) && isNum(a.aux_ping) && a.main_ping + a.aux_ping > 0) out.mainAux = netPrice / (a.main_ping + a.aux_ping);
    }
    return out;
  }

  function median(arr) {
    var v = arr.filter(isNum).slice().sort(function (x, y) { return x - y; });
    if (!v.length) return null;
    var m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  function fmt(n, d) {
    if (!isNum(n)) return '—';
    var s = (d == null ? (Math.round(n * 100) / 100) : n.toFixed(d)).toString();
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  /** 顯示用：坪數固定顯示兩位小數且「無條件捨去」，避免 25.999 顯示成 26.00。 */
  function fmtPing(n) {
    if (!isNum(n)) return '未揭露';
    var t = Math.floor(n * 100 + 1e-7) / 100;
    return t.toFixed(2);
  }

  return {
    DEFAULTS: DEFAULTS, isNum: isNum, priceRange: priceRange, budgetStatus: budgetStatus, areaStatus: areaStatus,
    walkStatus: walkStatus, classify: classify, askingUnitPrices: askingUnitPrices, median: median, fmt: fmt, fmtPing: fmtPing
  };
});
