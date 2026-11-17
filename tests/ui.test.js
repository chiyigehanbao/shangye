/* 真实浏览器功能测试（Puppeteer + 本机 Edge）
   运行: node tests/ui.test.js   （需先安装 puppeteer-core）
   若 puppeteer-core 未装在项目内, 会回退到 PUPPETEER_DIR 环境变量指定的 node_modules。 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const assert = require('assert');

function loadPuppeteer() {
  try { return require('puppeteer-core'); }
  catch (e) {
    const dir = process.env.PUPPETEER_DIR;
    if (dir) return require(path.join(dir, 'puppeteer-core'));
    throw new Error('未找到 puppeteer-core，请 npm i puppeteer-core 或设置 PUPPETEER_DIR');
  }
}
const puppeteer = loadPuppeteer();

function findBrowser() {
  const fs = require('fs');
  const cands = [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  const found = cands.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!found) throw new Error('未找到 Edge/Chrome，请设置 EDGE_PATH 环境变量');
  return found;
}
const EDGE = findBrowser();
const ROOT = path.resolve(__dirname, '..');
const DL = path.join(require('os').tmpdir(), 'hf-downloads');
fs.mkdirSync(DL, { recursive: true });
const url = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([true, name]); console.log('  PASS  ' + name); }
  catch (e) { results.push([false, name, e.message]); console.log('  FAIL  ' + name + '  -> ' + e.message); }
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }).catch(() => {});
  return page;
}
const tableRows = (page, sel) => page.$$eval(sel + ' tbody tr', trs =>
  trs.map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.trim())));
function waitPort(port, tries = 40) {
  const net = require('net');
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      const s = net.connect({ host: '127.0.0.1', port });
      s.setTimeout(800);
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => { s.destroy(); if (++n >= tries) reject(new Error('端口未就绪')); else setTimeout(tick, 300); });
      s.on('timeout', () => { s.destroy(); if (++n >= tries) reject(new Error('端口超时')); else setTimeout(tick, 300); });
    };
    tick();
  });
}

function waitReady(port, tries = 240) {
  const net = require('net');
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      const s = net.connect({ host: '127.0.0.1', port });
      s.setTimeout(1000);
      s.on('connect', () => {
        s.destroy();
        let m = 0;
        const ping = () => {
          const req = http.get({ host: '127.0.0.1', port, path: '/api/health', agent: false }, res => { res.resume(); resolve(true); });
          req.on('error', () => { if (++m >= 20) reject(new Error('端口已开但应用无响应')); else setTimeout(ping, 400); });
        };
        ping();
      });
      s.on('error', () => { s.destroy(); if (++n >= tries) reject(new Error('服务未启动')); else setTimeout(tick, 500); });
      s.on('timeout', () => { s.destroy(); if (++n >= tries) reject(new Error('连接超时')); else setTimeout(tick, 500); });
    };
    tick();
  });
}

(async () => {
  // 预热 Python 依赖，避免 uvicorn 冷启动超过轮询窗口
  try { spawnSync(process.env.PYTHON || 'python', ['-c', 'import pandas, fastapi, uvicorn, openpyxl, httpx'], { stdio: 'ignore', timeout: 90000 }); } catch (e) {}

  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
  });

  console.log('\n== 首页 ==');
  await test('首页: 5 个项目卡片 + 计数器动画', async () => {
    const page = await newPage(browser);
    await page.goto(url('index.html'), { waitUntil: 'networkidle2' });
    const links = await page.$$eval('a.proj', els => els.length);
    assert.strictEqual(links, 5, '项目卡片数应为 5');
    await page.waitForFunction(() => {
      const b = document.querySelector('.mini b'); return b && b.innerText && b.innerText !== '0';
    }, { timeout: 6000 });
    await page.close();
  });

  console.log('\n== Excel 工具 ==');
  await test('Excel: 载入示例 + 列分析 + 处理 + 汇总正确', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/excel-tool/index.html'), { waitUntil: 'networkidle2' });
    await page.waitForSelector('#panel:not(.hidden)', { timeout: 8000 });
    const colRows = await page.$$eval('#colStatsWrap tbody tr', trs => trs.length);
    assert.ok(colRows >= 5, '列分析应至少 5 行');
    await page.click('#runBtn');
    await page.waitForSelector('#results:not(.hidden)', { timeout: 6000 });
    const summary = await tableRows(page, '#summaryWrap');
    const beijing = summary.find(r => r[0] === '北京店');
    assert.ok(beijing, '汇总应含北京店');
    assert.strictEqual(beijing[1], '340.00', '北京店求和应为 340.00');
    const exportDisabled = await page.$eval('#exportBtn', el => el.disabled);
    assert.strictEqual(exportDisabled, false, '导出按钮应可用');
    await page.close();
  });

  await test('Excel: 按金额降序排序，首行为 160', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/excel-tool/index.html'), { waitUntil: 'networkidle2' });
    await page.waitForSelector('#panel:not(.hidden)', { timeout: 8000 });
    await page.select('#sortCol', '4');
    await page.select('#sortDir', 'desc');
    await page.click('#runBtn');
    await page.waitForSelector('#results:not(.hidden)', { timeout: 6000 });
    const rows = await tableRows(page, '#cleanWrap');
    assert.strictEqual(rows[0][4], '160', '降序首行金额应为 160');
    await page.close();
  });

  await test('Excel: 关键字过滤"北京"', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/excel-tool/index.html'), { waitUntil: 'networkidle2' });
    await page.waitForSelector('#panel:not(.hidden)', { timeout: 8000 });
    await page.type('#filterKw', '北京');
    await page.click('#runBtn');
    await page.waitForSelector('#results:not(.hidden)', { timeout: 6000 });
    const rows = await tableRows(page, '#cleanWrap');
    assert.ok(rows.length > 0 && rows.every(r => r.includes('北京店')), '过滤后应只含北京店');
    await page.close();
  });

  await test('Excel: AI 指令(Ollama 离线→规则兜底)自动汇总', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/excel-tool/index.html'), { waitUntil: 'networkidle2' });
    await page.waitForSelector('#panel:not(.hidden)', { timeout: 8000 });
    await page.evaluate(() => { window.Ollama.available = async () => false; });
    await page.type('#aiInput', '按门店汇总金额');
    await page.click('#aiRun');
    await page.waitForSelector('#results:not(.hidden)', { timeout: 6000 });
    const out = await page.$eval('#aiOut', el => el.innerText);
    assert.ok(out.includes('门店'), 'AI 输出应含分组列“门店”');
    const summary = await tableRows(page, '#summaryWrap');
    assert.ok(summary.find(r => r[0] === '北京店' && r[1] === '340.00'), 'AI 触发的汇总应正确');
    await page.close();
  });

  console.log('\n== 销售看板 ==');
  await test('看板: 载入示例 + KPI + 图表渲染', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/sales-dashboard/index.html'), { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.getElementById('k1') && document.getElementById('k1').innerText !== '¥0', { timeout: 8000 });
    const charted = await page.evaluate(() => !!window.Chart && !!Chart.getChart(document.getElementById('trend')) && !!Chart.getChart(document.getElementById('pie')));
    assert.ok(charted, '趋势图与占比图应已渲染');
    await page.close();
  });

  await test('看板: Top-N 限制分类数', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/sales-dashboard/index.html'), { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.getElementById('k1') && document.getElementById('k1').innerText !== '¥0', { timeout: 8000 });
    await page.select('#f-topn', '5');
    await page.waitForFunction(() => Chart.getChart(document.getElementById('pie')).data.labels.length <= 6, { timeout: 4000 });
    const n = await page.evaluate(() => Chart.getChart(document.getElementById('pie')).data.labels.length);
    assert.ok(n <= 6, 'Top-5 后分类数应 ≤ 6');
    await page.close();
  });

  await test('看板: 日期筛选锁定单日', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/sales-dashboard/index.html'), { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.getElementById('k1') && document.getElementById('k1').innerText !== '¥0', { timeout: 8000 });
    await page.evaluate(() => {
      const s = document.getElementById('f-start'); s.value = '2026-01-05'; s.dispatchEvent(new Event('change'));
      const e = document.getElementById('f-end'); e.value = '2026-01-05'; e.dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(() => document.getElementById('rangeTag').innerText.includes('2026-01-05 → 2026-01-05'), { timeout: 4000 });
    await page.close();
  });

  await test('看板: AI 洞察(Ollama 离线→规则兜底)', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/sales-dashboard/index.html'), { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.getElementById('k1') && document.getElementById('k1').innerText !== '¥0', { timeout: 8000 });
    await page.evaluate(() => { window.Ollama.available = async () => false; });
    await page.click('#aiBtn');
    await page.waitForFunction(() => document.getElementById('aiOut').innerText.includes('总销售额'), { timeout: 6000 });
    await page.close();
  });

  console.log('\n== 报价单 ==');
  await test('报价: 默认总价 + 修改数量联动', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/quote-generator/index.html'), { waitUntil: 'networkidle2' });
    const t1 = await page.$eval('#p-total', el => el.innerText);
    assert.ok(t1.includes('5,088'), '默认总价应为 5,088.00，实际 ' + t1);
    await page.evaluate(() => {
      const q = document.querySelector('#items .item-row input[data-k="qty"]');
      q.value = '2'; q.dispatchEvent(new Event('input'));
    });
    const t2 = await page.$eval('#p-total', el => el.innerText);
    assert.ok(t2.includes('8,268'), '数量改 2 后总价应为 8,268.00，实际 ' + t2);
    await page.close();
  });

  await test('报价: 增加一行 + AI 生成条目(Ollama 离线→规则兜底)', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/quote-generator/index.html'), { waitUntil: 'networkidle2' });
    const before = await page.$$eval('#items .item-row', els => els.length);
    await page.click('#addItem');
    const after = await page.$$eval('#items .item-row', els => els.length);
    assert.strictEqual(after, before + 1, '增加一行后条目数 +1');
    await page.evaluate(() => { window.Ollama.available = async () => false; });
    await page.type('#aiBrief', '给一家咖啡店做官网 + Excel 汇总工具');
    await page.click('#aiBtn');
    await page.waitForFunction(b => document.querySelectorAll('#items .item-row').length !== b, { timeout: 6000 }, after);
    await page.close();
  });

  await test('报价: 保存与载入报价单(localStorage)', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/quote-generator/index.html'), { waitUntil: 'networkidle2' });
    await page.evaluate(() => localStorage.removeItem('hf_quotes'));
    await page.reload({ waitUntil: 'networkidle2' });
    await page.evaluate(() => { const q = document.querySelector('#items .item-row input[data-k="qty"]'); q.value = '2'; q.dispatchEvent(new Event('input')); });
    await page.type('#saveName', '测试报价A');
    await page.click('#saveBtn');
    await page.click('#resetBtn');
    const before = await page.$eval('#items .item-row input[data-k="qty"]', el => el.value);
    assert.strictEqual(before, '1', '重置后数量应为 1');
    await page.click('#savedList .lnk[data-load="0"]');
    const after = await page.$eval('#items .item-row input[data-k="qty"]', el => el.value);
    assert.strictEqual(after, '2', '载入保存后数量应恢复为 2');
    await page.close();
  });

  console.log('\n== 文档提取 ==');
  await test('文档提取: 规则提取命中多类字段', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/doc-extractor/index.html'), { waitUntil: 'networkidle2' });
    await page.click('#demoBtn');
    await page.click('#ruleBtn');
    await page.waitForFunction(() => !document.getElementById('copyBtn').disabled, { timeout: 5000 });
    const txt = await page.$eval('#results', el => el.innerText);
    assert.ok(txt.includes('13800138000'), '应提取手机号');
    assert.ok(txt.includes('service@example.com'), '应提取邮箱');
    assert.ok(txt.includes('北京星辰科技有限公司'), '应提取甲方');
    await page.close();
  });

  await test('文档提取: 上传 txt 文件并提取', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/doc-extractor/index.html'), { waitUntil: 'networkidle2' });
    const tmp = path.join(require('os').tmpdir(), 'hf_doc.txt');
    fs.writeFileSync(tmp, '联系方式：邮箱 aa@bb.com，电话 13900139000，金额 1200 元。', 'utf-8');
    const input = await page.$('#file');
    await input.uploadFile(tmp);
    await page.waitForFunction(() => document.getElementById('text').value.includes('aa@bb.com'), { timeout: 5000 });
    await page.click('#ruleBtn');
    await page.waitForFunction(() => document.getElementById('results').innerText.includes('aa@bb.com'), { timeout: 5000 });
    await page.close();
  });

  await test('文档提取: AI 字段提取(Ollama 离线→规则兜底)', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/doc-extractor/index.html'), { waitUntil: 'networkidle2' });
    await page.click('#demoBtn');
    await page.evaluate(() => { window.Ollama.available = async () => false; });
    await page.click('#modeAI');
    await page.click('#aiBtn');
    await page.waitForFunction(() => document.getElementById('aiOut').innerText.includes('规则兜底'), { timeout: 6000 });
    const txt = await page.$eval('#results', el => el.innerText);
    assert.ok(txt.includes('北京星辰科技有限公司'), '兜底应提取甲方');
    await page.close();
  });

  await test('文档提取: 字段模板一键填充', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/doc-extractor/index.html'), { waitUntil: 'networkidle2' });
    await page.click('#modeAI');
    await page.click('.tpl[data-fields*="发票号码"]');
    const v = await page.$eval('#fields', el => el.value);
    assert.ok(v.includes('发票号码') && v.includes('购方名称'), '模板应填充发票字段，实际: ' + v);
    await page.close();
  });

  await test('文档提取: 批量多文件提取', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/doc-extractor/index.html'), { waitUntil: 'networkidle2' });
    const t1 = path.join(require('os').tmpdir(), 'hf_b1.txt');
    const t2 = path.join(require('os').tmpdir(), 'hf_b2.txt');
    fs.writeFileSync(t1, '甲方：甲公司  邮箱 a@a.com  金额 100 元', 'utf-8');
    fs.writeFileSync(t2, '乙方：乙公司  邮箱 b@b.com  金额 200 元', 'utf-8');
    const input = await page.$('#file');
    await input.uploadFile(t1, t2);
    await page.waitForFunction(() => document.getElementById('docCount').innerText.includes('2'), { timeout: 6000 });
    await page.click('#allBtn');
    await page.waitForFunction(() => document.getElementById('resultTitle').innerText.includes('批量结果'), { timeout: 6000 });
    const txt = await page.$eval('#results', el => el.innerText);
    assert.ok(txt.includes('a@a.com') && txt.includes('b@b.com'), '批量结果应包含两个文档的邮箱');
    await page.close();
  });

  await test('文档提取: 结构化表格对齐 + 导出 Excel', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/doc-extractor/index.html'), { waitUntil: 'networkidle2' });
    const t1 = path.join(require('os').tmpdir(), 'hf_m1.txt');
    const t2 = path.join(require('os').tmpdir(), 'hf_m2.txt');
    fs.writeFileSync(t1, '甲方：甲公司  邮箱 a@a.com  金额 100 元', 'utf-8');
    fs.writeFileSync(t2, '乙方：乙公司  邮箱 b@b.com  金额 200 元', 'utf-8');
    const input = await page.$('#file');
    await input.uploadFile(t1, t2);
    await page.waitForFunction(() => document.getElementById('docCount').innerText.includes('2'), { timeout: 6000 });
    await page.click('#matrixBtn');
    await page.waitForSelector('#tableCard:not(.hidden)', { timeout: 6000 });
    const matrix = await page.$eval('#matrixWrap', el => el.innerText);
    assert.ok(matrix.includes('邮箱') && matrix.includes('a@a.com') && matrix.includes('b@b.com'), '结构化表应含字段列与两文档值');
    const xlsxAvailable = await page.evaluate(() => !!window.XLSX);
    assert.ok(xlsxAvailable, 'XLSX 应可用');
    await page.click('#expXlsx');
    let file = null; const t0 = Date.now();
    while (Date.now() - t0 < 6000) { file = fs.readdirSync(DL).find(x => x === '结构化表格.xlsx'); if (file) break; await new Promise(r => setTimeout(r, 200)); }
    assert.ok(file, '应导出 结构化表格.xlsx');
    await page.close();
  });

  await test('文档提取: 图片 OCR（本地 tesseract）', async () => {
    const PORT = 8141;
    const proc = spawn(process.env.PYTHON || 'python', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
    try {
      await waitPort(PORT);
      const page = await newPage(browser);
      await page.goto(`http://127.0.0.1:${PORT}/projects/doc-extractor/index.html`, { waitUntil: 'networkidle2' });
      await page.select('#ocrLang', 'eng');
      await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 440; c.height = 140;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 440, 140);
        x.fillStyle = '#000'; x.font = '48px Arial'; x.fillText('HELLO 12345', 20, 90);
        c.toBlob(blob => {
          const dt = new DataTransfer(); dt.items.add(new File([blob], 'ocr.png', { type: 'image/png' }));
          const input = document.getElementById('file'); input.files = dt.files;
          input.dispatchEvent(new Event('change'));
        }, 'image/png');
      });
      await page.waitForFunction(() => document.getElementById('text').value.toUpperCase().includes('HELLO'), { timeout: 90000 });
      const txt = await page.$eval('#text', el => el.value);
      assert.ok(/12345/.test(txt), 'OCR 应识别出 12345，实际: ' + txt.slice(0, 80));
      await page.close();
    } finally {
      try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
    }
  });

  console.log('\n== 落地页 ==');
  await test('落地页: 品牌与首屏渲染 + 滚动揭示', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/landing-page/index.html'), { waitUntil: 'networkidle2' });
    const brand = await page.$eval('.brand', el => el.innerText);
    assert.ok(brand.includes('云账本'), '品牌名应为云账本');
    await page.evaluate(() => document.getElementById('pricing').scrollIntoView());
    await page.waitForFunction(() => document.querySelectorAll('[data-reveal].in').length > 0, { timeout: 5000 });
    await page.close();
  });

  await test('落地页: FAQ 手风琴可展开', async () => {
    const page = await newPage(browser);
    await page.goto(url('projects/landing-page/index.html'), { waitUntil: 'networkidle2' });
    await page.evaluate(() => document.getElementById('faq').scrollIntoView());
    await page.click('#faq .faq summary');
    const open = await page.$eval('#faq .faq', el => el.open);
    assert.ok(open, 'FAQ 点击后应展开');
    const len = await page.$eval('#faq .faq p', el => el.innerText.length);
    assert.ok(len > 0, 'FAQ 答案应有内容');
    await page.close();
  });

  console.log('\n== 英文作品集 ==');
  await test('英文作品集: 5 demo + iframe 试用切换 + 无 JS 错误', async () => {
    const page = await newPage(browser);
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(url('en/index.html'), { waitUntil: 'networkidle2' });
    const links = await page.$$eval('a.proj', els => els.length);
    assert.strictEqual(links, 5, '英文页应有 5 个 demo 链接');
    const h1 = await page.$eval('h1', el => el.innerText);
    assert.ok(/tested/i.test(h1), '标题应体现 tested 的诚实定位');
    const src0 = await page.$eval('#demoFrame', el => el.getAttribute('src'));
    assert.ok(/excel-tool/.test(src0), '默认 iframe 应为 excel-tool');
    await page.click('[data-demo*="sales-dashboard"]');
    await page.waitForFunction(() => /sales-dashboard/.test(document.getElementById('demoFrame').getAttribute('src')), { timeout: 4000 });
    const openHref = await page.$eval('#demoOpen', el => el.getAttribute('href'));
    assert.ok(/sales-dashboard/.test(openHref), '“新标签打开”链接应同步切换');
    assert.strictEqual(errs.length, 0, '不应有 JS 错误: ' + errs.join('; '));
    await page.close();
  });

  console.log('\n== 后端版(真实 uvicorn + 登录 + 历史) ==');
  await test('后端: 登录 → 上传/处理 → 历史记录真实走 API', async () => {
    const PORT = 8137;
    const PY = process.env.PYTHON || 'python';
    const testDb = path.join(require('os').tmpdir(), 'hf_uitest.db');
    try { fs.unlinkSync(testDb); } catch (e) {}
    let srvLog = '';
    const proc = spawn(PY, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(PORT)],
      { cwd: path.join(ROOT, 'excel-backend'), stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { DB_PATH: testDb }) });
    proc.stdout.on('data', d => { srvLog += d.toString(); });
    proc.stderr.on('data', d => { srvLog += d.toString(); });
    proc.on('error', e => { srvLog += '\nSPAWN ERROR: ' + e.message; });
    try {
      try { await waitReady(PORT); }
      catch (e) { throw new Error(e.message + ' | 服务日志: ' + srvLog.slice(-300)); }
      const page = await newPage(browser);
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#login', { visible: true, timeout: 10000 });
      await page.click('#lg-btn');
      await page.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
      await page.waitForSelector('#panel:not(.hidden)', { timeout: 15000 });
      await page.click('#runBtn');
      await page.waitForSelector('#results:not(.hidden)', { timeout: 8000 });
      const summary = await tableRows(page, '#summaryWrap');
      assert.ok(summary.find(r => r[0] === '北京店' && r[1] === '340.00'), '后端汇总北京店应为 340.00，实际 ' + JSON.stringify(summary));
      await page.waitForFunction(() => /#\d+/.test(document.getElementById('jobsList').innerText), { timeout: 6000 });
      // 文档提取标签页
      await page.click('[data-tab="doc"]');
      await page.waitForSelector('#docFlow:not(.hidden)', { timeout: 4000 });
      await page.evaluate(() => {
        document.getElementById('docText').value = '甲方：甲公司 电话 13800138000 邮箱 a@a.com 金额 100 元';
        document.getElementById('docFields').value = '';
      });
      await page.click('#docRun');
      await page.waitForFunction(() => /手机号|邮箱/.test(document.getElementById('docResultsWrap').innerText), { timeout: 10000 });
      const docTxt = await page.$eval('#docResultsWrap', el => el.innerText);
      assert.ok(docTxt.includes('13800138000'), '文档提取应命中手机号');
      await page.waitForFunction(() => /#\d+/.test(document.getElementById('docJobsList').innerText), { timeout: 6000 });
      // 异步队列：批量加入 2 个文件并在后台处理完成
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File(['甲方：A公司 电话 13800138000'], 'q1.txt', { type: 'text/plain' }));
        dt.items.add(new File(['邮箱 b@b.com 金额 200 元'], 'q2.txt', { type: 'text/plain' }));
        document.getElementById('qFile').files = dt.files;
      });
      await page.click('#qRun');
      await page.waitForFunction(() => /完成/.test(document.getElementById('qTasks').innerText), { timeout: 20000 });
      const qTxt = await page.$eval('#qTasks', el => el.innerText);
      assert.ok(qTxt.includes('q1.txt') && qTxt.includes('q2.txt'), '队列应处理两个文件: ' + qTxt);
      await page.close();
    } finally {
      try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
    }
  });

  await browser.close();

  const failed = results.filter(r => !r[0]);
  console.log('\n============================================');
  console.log(`结果: ${results.length - failed.length} 通过, ${failed.length} 失败`);
  if (failed.length) failed.forEach(f => console.log('  - ' + f[1] + ': ' + f[2]));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('测试运行器异常:', e); process.exit(1); });
