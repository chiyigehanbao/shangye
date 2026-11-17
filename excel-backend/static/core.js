/* =========================================================
   HF Core — 纯函数逻辑层（浏览器 window.HF / Node require）
   被 excel-tool、sales-dashboard 复用，并可在 Node 中单元测试。
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const norm = (v) => (v === null || v === undefined) ? '' : String(v).trim();

  const toNum = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isNaN(n) ? 0 : n;
  };

  const isDate = (s) => {
    const t = norm(s);
    return /^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?/.test(t) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(t);
  };

  const isNumericCell = (v) => {
    const t = norm(v);
    if (!t || isDate(t)) return false;
    return /\d/.test(t) && !Number.isNaN(parseFloat(t.replace(/[^0-9.\-]/g, '')));
  };

  /* ---------- 清洗 ---------- */
  function cleanRows(rows, opts) {
    opts = opts || {};
    const removeEmpty = opts.removeEmpty !== false;
    const removeDup = opts.removeDup !== false;
    let out = rows.slice();
    const original = out.length;
    let removedEmpty = 0, removedDup = 0;

    if (removeEmpty) {
      const before = out.length;
      out = out.filter(r => r.some(c => norm(c) !== ''));
      removedEmpty = before - out.length;
    }
    if (removeDup) {
      const seen = new Set();
      const before = out.length;
      out = out.filter(r => {
        const k = r.map(norm).join('\u0001');
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      removedDup = before - out.length;
    }
    return { rows: out, stats: { original, cleaned: out.length, removedEmpty, removedDup } };
  }

  /* ---------- 汇总 ---------- */
  const AGG_LABELS = { sum: '求和', count: '计数', avg: '平均', max: '最大', min: '最小' };
  const AGGS = ['sum', 'count', 'avg', 'max', 'min'];

  function aggregate(rows, groupIdx, valueIdx, agg) {
    agg = AGGS.includes(agg) ? agg : 'sum';
    if (groupIdx === '' || groupIdx === null || groupIdx === undefined) return null;
    const gi = +groupIdx;
    const needValue = agg !== 'count';
    const hasValue = !(valueIdx === '' || valueIdx === null || valueIdx === undefined);
    if (needValue && !hasValue) return null;
    const vi = hasValue ? +valueIdx : null;

    const map = new Map();
    rows.forEach(r => {
      const key = norm(r[gi]) || '(空)';
      const cur = map.get(key) || { sum: 0, count: 0, max: -Infinity, min: Infinity };
      if (vi !== null) {
        const num = toNum(r[vi]);
        cur.sum += num;
        cur.max = Math.max(cur.max, num);
        cur.min = Math.min(cur.min, num);
      }
      cur.count += 1;
      map.set(key, cur);
    });

    const entries = [...map.entries()].map(([k, v]) => {
      let val;
      if (agg === 'sum') val = v.sum;
      else if (agg === 'count') val = v.count;
      else if (agg === 'avg') val = v.count ? v.sum / v.count : 0;
      else if (agg === 'max') val = v.max;
      else val = v.min;
      return [k, val];
    });
    entries.sort((a, b) => agg === 'min' ? a[1] - b[1] : b[1] - a[1]);
    return { header: AGG_LABELS[agg], agg, rows: entries };
  }

  /* ---------- 列分析 ---------- */
  function columnStats(headers, rows) {
    return headers.map((h, i) => {
      let numeric = 0, dateLike = 0, nonEmpty = 0;
      const distinct = new Set();
      rows.forEach(r => {
        const v = norm(r[i]);
        if (!v) return;
        nonEmpty++;
        distinct.add(v);
        if (isDate(v)) dateLike++;
        if (isNumericCell(v)) numeric++;
      });
      let type = '文本';
      if (nonEmpty && dateLike / nonEmpty > 0.6) type = '日期';
      else if (nonEmpty && numeric / nonEmpty > 0.8) type = '数值';
      return { index: i, name: h, type, nonEmpty, distinct: distinct.size, numeric, dateLike };
    });
  }

  function detectColumns(headers, rows) {
    const stats = columnStats(headers, rows);
    const dateBest = stats.slice().sort((a, b) =>
      (b.dateLike / Math.max(1, b.nonEmpty)) - (a.dateLike / Math.max(1, a.nonEmpty)))[0];
    const dateCol = dateBest && dateBest.nonEmpty && dateBest.dateLike / dateBest.nonEmpty > 0.6 ? dateBest.index : 0;

    // 数值列：优先表名含“金额/销售/收入”等字样，否则取合计最大者
    const numericCols = stats.filter(s => s.nonEmpty && s.numeric / s.nonEmpty > 0.8 && s.index !== dateCol);
    let amtCol;
    if (numericCols.length) {
      const named = numericCols.find(s => /金额|销售额|销售|收入|营收|总额|合计|price|amount|total|revenue/i.test(s.name));
      if (named) {
        amtCol = named.index;
      } else {
        const totals = numericCols.map(s => ({
          index: s.index,
          total: rows.reduce((acc, r) => acc + Math.abs(toNum(r[s.index])), 0)
        })).sort((a, b) => b.total - a.total);
        amtCol = totals[0].index;
      }
    } else {
      amtCol = headers.length - 1;
    }

    let cat = stats.find(s => s.index !== dateCol && s.index !== amtCol && s.type === '文本');
    if (!cat) cat = stats.find(s => s.index !== dateCol && s.index !== amtCol);
    const catCol = cat ? cat.index : 0;
    return { dateCol, catCol, amtCol };
  }

  /* ---------- 自然语言规则解析（Ollama 离线兜底） ---------- */
  function ruleParseCommand(headers, text) {
    text = norm(text);
    const matched = headers
      .map((h, i) => ({ h, i }))
      .filter(x => x.h && text.includes(x.h));
    let agg = 'sum';
    if (/平均|均值|avg/i.test(text)) agg = 'avg';
    else if (/计数|数量|个数|单数|多少|count|订单数/i.test(text)) agg = 'count';
    else if (/最大|最高|max/i.test(text)) agg = 'max';
    else if (/最小|最低|min/i.test(text)) agg = 'min';

    const groupIdx = matched.length ? matched[0].i : '';
    const valueIdx = matched.length > 1 ? matched[1].i : '';
    return {
      groupBy: groupIdx === '' ? '' : headers[groupIdx],
      valueColumn: valueIdx === '' ? '' : headers[valueIdx],
      agg,
      source: 'rule'
    };
  }

  function toNumberFmt(n, dec) {
    dec = dec === undefined ? 2 : dec;
    return Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  return {
    norm, toNum, isDate, isNumericCell,
    cleanRows, aggregate, AGG_LABELS, AGGS,
    columnStats, detectColumns, ruleParseCommand, toNumberFmt
  };
});
