/* Node 单元测试：node tests/core.test.js */
const assert = require('assert');
const path = require('path');
const HF = require(path.join(__dirname, '..', 'assets', 'core.js'));

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '  -> ' + e.message); }
}
function group(title) { console.log('\n' + title); }

group('数值与格式化');
ok('toNum 处理货币符号与千分位', () => assert.strictEqual(HF.toNum('¥1,234.5'), 1234.5));
ok('toNum 非数字返回 0', () => assert.strictEqual(HF.toNum('abc'), 0));
ok('toNum 已是数字原样返回', () => assert.strictEqual(HF.toNum(42), 42));
ok('norm 去空格并处理 null', () => { assert.strictEqual(HF.norm('  x  '), 'x'); assert.strictEqual(HF.norm(null), ''); });

group('日期识别');
ok('识别 ISO 日期', () => assert.ok(HF.isDate('2026-01-05')));
ok('识别斜杠日期', () => assert.ok(HF.isDate('1/5/2026')));
ok('门店名不是日期', () => assert.ok(!HF.isDate('北京店')));

group('清洗 cleanRows');
const dirty = [
  ['2026-01-05', '北京店', '拿铁', '3', '90'],
  ['', '', '', '', ''],
  ['2026-01-05', '北京店', '拿铁', '3', '90'],
  ['2026-01-06', '广州店', '蛋糕', '1', '40'],
];
ok('删除空行 + 去重', () => {
  const r = HF.cleanRows(dirty, { removeEmpty: true, removeDup: true });
  assert.strictEqual(r.stats.original, 4);
  assert.strictEqual(r.stats.removedEmpty, 1);
  assert.strictEqual(r.stats.removedDup, 1);
  assert.strictEqual(r.stats.cleaned, 2);
});
ok('可选择不处理', () => {
  const r = HF.cleanRows(dirty, { removeEmpty: false, removeDup: false });
  assert.strictEqual(r.rows.length, 4);
});

group('汇总 aggregate');
const rows = [
  ['2026-01-05', '北京店', '拿铁', '3', '90'],
  ['2026-01-06', '广州店', '蛋糕', '1', '40'],
  ['2026-01-07', '北京店', '蛋糕', '4', '160'],
  ['2026-01-05', '上海店', '美式', '2', '50'],
];
ok('按门店求和，降序', () => {
  const a = HF.aggregate(rows, 1, 4, 'sum');
  assert.strictEqual(a.header, '求和');
  assert.deepStrictEqual(a.rows[0], ['北京店', 250]);
  assert.deepStrictEqual(a.rows[1], ['上海店', 50]);
  assert.deepStrictEqual(a.rows[2], ['广州店', 40]);
});
ok('计数无需数值列', () => {
  const a = HF.aggregate(rows, 2, '', 'count');
  const get = (k) => a.rows.find(r => r[0] === k)[1];
  assert.strictEqual(get('拿铁'), 1);
  assert.strictEqual(get('蛋糕'), 2);
});
ok('平均值', () => {
  const a = HF.aggregate(rows, 1, 4, 'avg');
  assert.strictEqual(a.rows.find(r => r[0] === '北京店')[1], 125);
});
ok('最大值 / 最小值', () => {
  assert.strictEqual(HF.aggregate(rows, 1, 4, 'max').rows[0][1], 160);
  assert.strictEqual(HF.aggregate(rows, 1, 4, 'min').rows[0][1], 40);
});
ok('无分组列返回 null', () => assert.strictEqual(HF.aggregate(rows, '', 4, 'sum'), null));

group('列分析与自动识别');
ok('columnStats 判定类型', () => {
  const headers = ['日期', '门店', '商品', '数量', '金额'];
  const s = HF.columnStats(headers, rows);
  assert.strictEqual(s[0].type, '日期');
  assert.strictEqual(s[1].type, '文本');
  assert.strictEqual(s[4].type, '数值');
});
ok('detectColumns 命中 日期/分类/金额', () => {
  const headers = ['日期', '门店', '商品', '数量', '金额'];
  const d = HF.detectColumns(headers, rows);
  assert.strictEqual(d.dateCol, 0);
  assert.strictEqual(d.catCol, 1);
  assert.strictEqual(d.amtCol, 4);
});

group('自然语言规则解析');
ok('“按门店汇总金额”', () => {
  const p = HF.ruleParseCommand(['日期', '门店', '商品', '数量', '金额'], '按门店汇总金额');
  assert.strictEqual(p.groupBy, '门店');
  assert.strictEqual(p.valueColumn, '金额');
  assert.strictEqual(p.agg, 'sum');
});
ok('“统计每个商品的订单数” → count', () => {
  const p = HF.ruleParseCommand(['日期', '门店', '商品', '数量', '金额'], '统计每个商品的订单数');
  assert.strictEqual(p.groupBy, '商品');
  assert.strictEqual(p.agg, 'count');
});
ok('“求各门店的平均金额” → avg', () => {
  const p = HF.ruleParseCommand(['日期', '门店', '金额'], '求各门店的平均金额');
  assert.strictEqual(p.agg, 'avg');
});

console.log('\n============================================');
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
