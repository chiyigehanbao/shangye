/* 前端逻辑：FastAPI 后端（登录鉴权 + 历史记录 + AI） */
const $ = (id) => document.getElementById(id);
let session = null;
let token = localStorage.getItem('hf_token') || '';
let username = localStorage.getItem('hf_user') || '';

function log(msg, type = '') {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  $('log').insertAdjacentHTML('beforeend', `<div><span class="time">[${t}]</span> <span class="${type}">${msg}</span></div>`);
  $('log').scrollTop = $('log').scrollHeight;
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function api(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers, token ? { Authorization: 'Bearer ' + token } : {});
  const r = await fetch(path, opts);
  if (r.status === 401) { showLogin('登录已过期，请重新登录'); throw new Error('未授权'); }
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch (e) {}
    throw new Error(msg);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('application/json') ? r.json() : r;
}

/* ---------- 登录 ---------- */
function showLogin(msg = '') {
  token = ''; localStorage.removeItem('hf_token');
  $('login').style.display = '';
  $('app').classList.add('hidden');
  $('lg-err').textContent = msg;
}
function showApp() {
  $('login').style.display = 'none';
  $('app').classList.remove('hidden');
  $('whoami').textContent = username ? '👤 ' + username : '';
  window.UIInit();
  refreshDocJobs();
  refreshTasks();
}
$('lg-btn').addEventListener('click', doLogin);
$('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
async function doLogin() {
  $('lg-err').textContent = '';
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('lg-user').value.trim(), password: $('lg-pass').value }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || '登录失败'); }
    const d = await r.json();
    token = d.token; username = d.username;
    localStorage.setItem('hf_token', token);
    localStorage.setItem('hf_user', username);
    showApp(); health(); refreshJobs(); seedDemo();
    ui.toast('登录成功', 'ok');
  } catch (e) { $('lg-err').textContent = e.message; }
}
$('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  showLogin('已退出登录');
});

/* ---------- 健康检查 ---------- */
async function health() {
  const el = $('health');
  try {
    const d = await api('/api/health');
    if (d.online) { el.className = 'badge green'; el.innerHTML = `<span class="dot"></span> Ollama · ${esc(d.model)}`; }
    else { el.className = 'badge amber'; el.innerHTML = '<span class="dot off" style="background:#f59e0b;box-shadow:0 0 0 4px rgba(245,158,11,.18)"></span> Ollama 离线（AI 走规则兜底）'; }
  } catch (e) { el.className = 'badge red'; el.innerHTML = '<span class="dot off"></span> 后端未连接'; }
}

/* ---------- 表格 ---------- */
function renderTable(wrap, headers, rows, limit = 100) {
  if (!headers || !rows || !rows.length) { wrap.innerHTML = '<p class="dim" style="padding:16px">无数据</p>'; return; }
  let html = '<table class="data"><thead><tr>' + headers.map(h => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>';
  rows.slice(0, limit).forEach(r => { html += '<tr>' + headers.map((_, i) => `<td>${esc(r[i])}</td>`).join('') + '</tr>'; });
  wrap.innerHTML = html + '</tbody></table>';
}

/* ---------- 上传 ---------- */
$('drop').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); });
['dragover', 'dragenter'].forEach(ev => $('drop').addEventListener(ev, e => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => $('drop').addEventListener(ev, e => { e.preventDefault(); $('drop').classList.remove('over'); }));
$('drop').addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });

async function readFile(file) {
  log(`上传 <b>${esc(file.name)}</b>…`);
  const fd = new FormData(); fd.append('file', file);
  try {
    const d = await api('/api/upload', { method: 'POST', body: fd });
    session = d.session;
    $('fileTag').textContent = d.filename;
    const opts = d.columns.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $('groupCol').innerHTML = '<option value="">不使用汇总</option>' + opts;
    $('valueCol').innerHTML = opts;
    const auto = HF.detectColumns(d.headers, d.preview);
    $('groupCol').value = d.columns[auto.catCol] || '';
    $('valueCol').value = d.columns[auto.amtCol] || '';
    renderTable($('previewWrap'), d.headers, d.preview);
    $('panel').classList.remove('hidden');
    $('results').classList.add('hidden');
    $('exportBtn').disabled = true;
    log(`已载入：${d.columns.length} 列 / ${d.row_count} 行`, 'ok');
    ui.toast('文件已载入', 'ok');
    window.UIInit();
  } catch (e) { log('上传失败：' + esc(e.message), 'err'); ui.toast('上传失败', 'err'); }
}

$('tplBtn').addEventListener('click', () => {
  const csv = '\ufeff日期,门店,商品,数量,金额\n2026-01-05,北京店,拿铁,3,90\n2026-01-05,上海店,美式,2,50\n2026-01-06,北京店,拿铁,3,90\n,,,,\n2026-01-06,广州店,蛋糕,1,40\n2026-01-07,北京店,蛋糕,4,160\n2026-01-07,广州店,拿铁,1,30\n';
  ui.download('示例销售数据.csv', csv, 'text/csv;charset=utf-8');
  log('已生成示例表格，可直接拖入', 'ok');
});

/* ---------- 处理 ---------- */
function process(groupBy, valueCol, agg) {
  if (!session) return;
  const body = {
    session,
    remove_empty: $('optEmpty').checked,
    remove_dup: $('optDup').checked,
    group_by: groupBy !== undefined ? (groupBy || null) : ($('groupCol').value || null),
    value_col: valueCol !== undefined ? (valueCol || null) : ($('valueCol').value || null),
    agg: agg || $('agg').value,
  };
  return api('/api/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(d => {
      const s = d.stats;
      $('stats').innerHTML = `
        <div class="stat"><b>${s.original}</b><span>原始行数</span></div>
        <div class="stat"><b style="color:#6ee7b7">${s.cleaned}</b><span>清洗后行数</span></div>
        <div class="stat"><b style="color:#fcd34d">${s.removed_empty}</b><span>删除空行</span></div>
        <div class="stat"><b style="color:#fcd34d">${s.removed_dup}</b><span>删除重复</span></div>
        <div class="stat"><b style="color:#a5b4fc">${d.summary_rows.length}</b><span>汇总分组</span></div>`;
      const aggType = body.agg;
      const rows = (d.summary_rows || []).map(r => [r[0], aggType === 'count' ? String(r[1]) : HF.toNumberFmt(r[1], 2)]);
      renderTable($('summaryWrap'), d.summary_headers || ['（未启用汇总）'], d.summary_headers ? rows : []);
      renderTable($('cleanWrap'), d.cleaned_headers, d.cleaned_rows);
      $('results').classList.remove('hidden');
      $('exportBtn').disabled = false;
      window.UIInit();
      log(`处理完成，已保存为记录 #${d.job_id}`, 'ok');
      refreshJobs();
      return d;
    })
    .catch(e => { log('处理失败：' + esc(e.message), 'err'); ui.toast('处理失败', 'err'); });
}
$('runBtn').addEventListener('click', () => { log('开始处理…'); process(); });

async function authedDownload(path, filename) {
  const r = await fetch(path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  if (!r.ok) { ui.toast('导出失败', 'err'); return; }
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 800);
}
$('exportBtn').addEventListener('click', () => { if (session) { authedDownload(`/api/export?session=${session}`, 'result.xlsx'); log('已触发导出', 'ok'); } });

/* ---------- 历史记录 ---------- */
let jobPage = 1, jobQ = '', jobPages = 1;
async function refreshJobs() {
  try {
    const d = await api(`/api/jobs?q=${encodeURIComponent(jobQ)}&page=${jobPage}&page_size=10`);
    jobPages = Math.max(1, Math.ceil(d.total / d.page_size));
    $('jobPage').textContent = `${d.page} / ${jobPages}`;
    const wrap = $('jobsList');
    if (!d.jobs.length) { wrap.innerHTML = '<p class="dim" style="font-size:13px">暂无记录。</p>'; return; }
    wrap.innerHTML = d.jobs.map(j => `
      <div class="job">
        <span>#${j.id} · <b>${esc(j.filename)}</b> <span class="dim">${j.original}→${j.cleaned} 行 · ${esc(j.created_at)}</span></span>
        <span class="acts">
          <span class="lnk" data-load="${j.id}">载入</span>
          <span class="lnk" data-dl="${j.id}">导出</span>
          <span class="lnk del" data-del="${j.id}">删除</span>
        </span>
      </div>`).join('');
    wrap.querySelectorAll('[data-load]').forEach(el => el.addEventListener('click', () => loadJob(+el.dataset.load)));
    wrap.querySelectorAll('[data-dl]').forEach(el => el.addEventListener('click', () => authedDownload(`/api/jobs/${el.dataset.dl}/export`, `job-${el.dataset.dl}.xlsx`)));
    wrap.querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', async () => { await api(`/api/jobs/${el.dataset.del}`, { method: 'DELETE' }); refreshJobs(); ui.toast('已删除', 'ok'); }));
  } catch (e) { /* ignore */ }
}
$('refreshJobs').addEventListener('click', () => { jobPage = 1; refreshJobs(); });
$('jobSearchBtn').addEventListener('click', () => { jobQ = $('jobSearch').value.trim(); jobPage = 1; refreshJobs(); });
$('jobSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { jobQ = $('jobSearch').value.trim(); jobPage = 1; refreshJobs(); } });
$('jobPrev').addEventListener('click', () => { if (jobPage > 1) { jobPage--; refreshJobs(); } });
$('jobNext').addEventListener('click', () => { if (jobPage < jobPages) { jobPage++; refreshJobs(); } });

async function loadJob(id) {
  const d = await api(`/api/jobs/${id}`);
  $('stats').innerHTML = `
    <div class="stat"><b>${d.stats.original}</b><span>原始行数</span></div>
    <div class="stat"><b style="color:#6ee7b7">${d.stats.cleaned}</b><span>清洗后行数</span></div>
    <div class="stat"><b style="color:#fcd34d">${d.stats.removed_empty}</b><span>删除空行</span></div>
    <div class="stat"><b style="color:#fcd34d">${d.stats.removed_dup}</b><span>删除重复</span></div>
    <div class="stat"><b style="color:#a5b4fc">${(d.summary_rows || []).length}</b><span>汇总分组</span></div>`;
  renderTable($('summaryWrap'), d.summary_headers || ['（未保存汇总）'], d.summary_headers ? d.summary_rows : []);
  renderTable($('cleanWrap'), d.cleaned_headers, d.cleaned_rows);
  $('results').classList.remove('hidden');
  ui.toast('已载入历史记录 #' + id, 'ok');
}

/* ---------- AI ---------- */
document.querySelectorAll('.example').forEach(el => el.addEventListener('click', () => { $('aiInput').value = el.textContent; }));
$('aiInput').addEventListener('keydown', e => { if (e.key === 'Enter') aiRun(); });
$('aiRun').addEventListener('click', aiRun);
async function aiRun() {
  const text = $('aiInput').value.trim();
  if (!text) { ui.toast('请输入指令', 'err'); return; }
  const btn = $('aiRun'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 解析中…';
  try {
    const d = await api('/api/ai/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, text }) });
    const p = d.plan;
    $('groupCol').value = p.groupBy || '';
    $('valueCol').value = p.valueColumn || '';
    $('agg').value = p.agg || 'sum';
    const label = { sum: '求和', count: '计数', avg: '平均', max: '最大', min: '最小' }[p.agg] || '求和';
    $('aiOut').innerHTML = `<div class="chip">解析来源：<b>${d.via === 'ollama' ? 'Ollama' : '规则兜底'}</b> · 按 <b>${esc(p.groupBy || '-')}</b> 对 <b>${esc(p.valueColumn || '行数')}</b> ${label}</div>`;
    log(`AI 指令解析完成（${d.via}）`, 'ok');
    await process(p.groupBy || '', p.valueColumn || '', p.agg || 'sum');
  } catch (e) { log('AI 失败：' + esc(e.message), 'err'); ui.toast('AI 失败', 'err'); }
  btn.disabled = false; btn.innerHTML = '✨ 解析并执行';
}
$('aiReport').addEventListener('click', async () => {
  if (!session) { ui.toast('请先上传并处理数据', 'err'); return; }
  const btn = $('aiReport'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 生成中…';
  $('aiOut').innerHTML = '<div class="dim" style="font-size:13px">AI 正在分析…</div>';
  try {
    const d = await api('/api/ai/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session }) });
    $('aiOut').innerHTML = `<div class="chip" style="margin-bottom:8px">来源：${d.via === 'ollama' ? 'Ollama' : '规则兜底'}</div>
      <div class="card pad-sm report" style="background:rgba(0,0,0,.22);border-color:var(--line-strong)">${esc(d.report).replace(/\n/g, '<br>')}</div>`;
    log('分析报告已生成', 'ok');
  } catch (e) { $('aiOut').innerHTML = ''; log('报告失败：' + esc(e.message), 'err'); }
  btn.disabled = false; btn.innerHTML = 'AI 生成分析报告';
});

/* ---------- 文档提取（后端） ---------- */
let docFile = null;
function dlog(msg, type = '') {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  $('docLog').insertAdjacentHTML('beforeend', `<div><span class="time">[${t}]</span> <span class="${type}">${msg}</span></div>`);
  $('docLog').scrollTop = $('docLog').scrollHeight;
}
$('docDrop').addEventListener('click', () => $('docFile').click());
['dragover', 'dragenter'].forEach(ev => $('docDrop').addEventListener(ev, e => { e.preventDefault(); $('docDrop').classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => $('docDrop').addEventListener(ev, e => { e.preventDefault(); $('docDrop').classList.remove('over'); }));
$('docDrop').addEventListener('drop', e => { if (e.dataTransfer.files[0]) { docFile = e.dataTransfer.files[0]; $('docFileTag').textContent = docFile.name; } });
$('docFile').addEventListener('change', e => { if (e.target.files[0]) { docFile = e.target.files[0]; $('docFileTag').textContent = docFile.name; } });

$('docRun').addEventListener('click', async () => {
  const text = $('docText').value.trim();
  if (!docFile && !text) { ui.toast('请上传文件或粘贴文本', 'err'); return; }
  const fd = new FormData();
  if (docFile) fd.append('file', docFile);
  fd.append('text', text);
  fd.append('fields', $('docFields').value);
  const btn = $('docRun'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 提取中…';
  dlog('提交文档提取…');
  try {
    const d = await api('/api/doc/extract', { method: 'POST', body: fd });
    dlog(`提取完成 #${d.job_id} · ${d.char_count} 字符 · 来源 ${d.via}`, 'ok');
    $('docVia').textContent = '来源：' + (d.via === 'ollama' ? 'Ollama' : '规则');
    renderDocResults(d.results);
    refreshDocJobs();
    ui.toast('提取完成', 'ok');
  } catch (e) { dlog('失败：' + esc(e.message), 'err'); ui.toast('提取失败', 'err'); }
  btn.disabled = false; btn.innerHTML = '✨ 提取并保存';
});

function renderDocResults(rows) {
  const wrap = $('docResultsWrap');
  if (!rows || !rows.length) { wrap.innerHTML = '<p class="dim" style="padding:16px">无结果</p>'; return; }
  wrap.innerHTML = '<table class="data"><thead><tr><th>字段</th><th>值</th><th>来源</th></tr></thead><tbody>' +
    rows.map(r => `<tr><td>${esc(r.field)}</td><td>${esc(r.value)}</td><td>${esc(r.source)}</td></tr>`).join('') + '</tbody></table>';
}

let docPage = 1, docQ = '', docPages = 1;
async function refreshDocJobs() {
  try {
    const d = await api(`/api/doc/jobs?q=${encodeURIComponent(docQ)}&page=${docPage}&page_size=10`);
    docPages = Math.max(1, Math.ceil(d.total / d.page_size));
    $('docPage').textContent = `${d.page} / ${docPages}`;
    const wrap = $('docJobsList');
    if (!d.jobs.length) { wrap.innerHTML = '<p class="dim" style="font-size:13px">暂无记录。</p>'; return; }
    wrap.innerHTML = d.jobs.map(j => {
      const file = j.file_id ? `<span class="lnk" data-file="${j.file_id}" data-name="${esc(j.filename)}">原文件</span>` : '';
      const kb = j.size ? ` <span class="dim">${(j.size / 1024).toFixed(1)} KB</span>` : '';
      return `
      <div class="job">
        <label style="display:flex;align-items:center;gap:10px;font-weight:400;margin:0">
          <input type="checkbox" class="docpick" value="${j.id}" style="width:auto" />
          <span>#${j.id} · <b>${esc(j.filename)}</b>${kb} <span class="dim">${esc(j.created_at)}</span></span>
        </label>
        <span class="acts">
          ${file}
          <span class="lnk" data-view="${j.id}">查看</span>
          <span class="lnk del" data-del="${j.id}">删除</span>
        </span>
      </div>`;
    }).join('');
    wrap.querySelectorAll('[data-file]').forEach(el => el.addEventListener('click', () => authedDownload('/api/doc/files/' + el.dataset.file + '/download', el.dataset.name || 'file')));
    wrap.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', async () => {
      const j = await api('/api/doc/jobs/' + el.dataset.view);
      renderDocResults(j.results); $('docVia').textContent = '来源：历史';
    }));
    wrap.querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', async () => {
      await api('/api/doc/jobs/' + el.dataset.del, { method: 'DELETE' }); refreshDocJobs(); ui.toast('已删除', 'ok');
    }));
    loadFileStats();
  } catch (e) { /* ignore */ }
}
async function loadFileStats() {
  try {
    const s = await api('/api/doc/files/stats');
    $('fileStats').textContent = `原始文件 ${s.files} · ${(s.bytes / 1024).toFixed(1)} KB（去重后）`;
  } catch (e) { /* ignore */ }
}
$('docRefresh').addEventListener('click', () => { docPage = 1; refreshDocJobs(); });
$('docSearchBtn').addEventListener('click', () => { docQ = $('docSearch').value.trim(); docPage = 1; refreshDocJobs(); });
$('docSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { docQ = $('docSearch').value.trim(); docPage = 1; refreshDocJobs(); } });
$('docPrev').addEventListener('click', () => { if (docPage > 1) { docPage--; refreshDocJobs(); } });
$('docNext').addEventListener('click', () => { if (docPage < docPages) { docPage++; refreshDocJobs(); } });
$('docExport').addEventListener('click', () => {
  const ids = [...document.querySelectorAll('.docpick:checked')].map(x => x.value);
  if (!ids.length) { ui.toast('请先勾选文档', 'err'); return; }
  authedDownload('/api/doc/export?ids=' + ids.join(','), 'doc_matrix.xlsx');
  dlog('导出结构化 Excel：' + ids.join(','), 'ok');
});

/* ---------- 异步任务队列 ---------- */
let qTimer = null;
$('qRun').addEventListener('click', async () => {
  const files = $('qFile').files;
  if (!files.length) { ui.toast('请选择文件', 'err'); return; }
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  fd.append('fields', $('docFields').value);
  fd.append('priority', $('qPriority').value);
  try {
    const d = await api('/api/doc/enqueue', { method: 'POST', body: fd });
    dlog(`已加入队列：${d.task_ids.length} 个任务`, 'ok');
    $('qFile').value = '';
    refreshTasks();
  } catch (e) { dlog('入队失败：' + esc(e.message), 'err'); }
});

function refreshTasks() {
  api('/api/doc/tasks').then(d => {
    const list = d.tasks;
    const active = list.filter(t => t.status === 'pending' || t.status === 'processing').length;
    $('queueStat').textContent = active ? ('处理中 ' + active) : '空闲';
    $('qCount').textContent = list.length + ' 个任务';
    $('qTasks').innerHTML = list.length ? list.map(t => {
      const color = t.status === 'done' ? 'green' : (t.status === 'failed' || t.status === 'canceled') ? 'red' : t.status === 'processing' ? 'amber' : '';
      const label = { pending: '排队', processing: '处理中', done: '完成', failed: '失败', canceled: '已取消' }[t.status] || t.status;
      const retry = t.status === 'failed' ? `<span class="lnk" data-qretry="${t.id}">重试</span>` : '';
      const cancel = (t.status === 'pending' || t.status === 'processing') ? `<span class="lnk" data-qcancel="${t.id}">取消</span>` : '';
      const tries = t.attempts ? `<span class="dim">尝试 ${t.attempts}/${t.max_attempts}</span>` : '';
      const pri = t.priority > 0 ? '<span class="badge amber">高</span>' : '';
      return `<div class="job" style="display:block">
        <div class="row between">
          <span>#${t.id} ${pri} · <b>${esc(t.filename)}</b> <span class="badge ${color}">${label}</span> ${tries} ${t.error ? '<span class="dim">' + esc(t.error) + '</span>' : ''}</span>
          <span class="acts">${t.status === 'done' ? '<span class="lnk" data-qtask="' + t.id + '">查看</span>' : ''}${retry}${cancel}<span class="lnk del" data-qdel="${t.id}">删除</span></span>
        </div>
        <div class="progress" style="margin-top:8px"><i style="width:${t.progress || 0}%"></i></div>
      </div>`;
    }).join('') : '<p class="dim" style="font-size:13px">暂无任务。</p>';
    $('qTasks').querySelectorAll('[data-qtask]').forEach(el => el.addEventListener('click', async () => {
      const t = await api('/api/doc/tasks/' + el.dataset.qtask);
      if (t.result) { renderDocResults(t.result.results); $('docVia').textContent = '来源：' + (t.result.via === 'ollama' ? 'Ollama' : '规则'); }
    }));
    $('qTasks').querySelectorAll('[data-qretry]').forEach(el => el.addEventListener('click', async () => {
      try { await api('/api/doc/tasks/' + el.dataset.qretry + '/retry', { method: 'POST' }); ui.toast('已重新入队', 'ok'); refreshTasks(); }
      catch (e) { ui.toast('重试失败', 'err'); }
    }));
    $('qTasks').querySelectorAll('[data-qcancel]').forEach(el => el.addEventListener('click', async () => {
      try { const r = await api('/api/doc/tasks/' + el.dataset.qcancel + '/cancel', { method: 'POST' }); ui.toast(r.status === 'canceled' ? '已取消' : '取消请求已发送', 'ok'); refreshTasks(); }
      catch (e) { ui.toast('取消失败', 'err'); }
    }));
    $('qTasks').querySelectorAll('[data-qdel]').forEach(el => el.addEventListener('click', async () => { await api('/api/doc/tasks/' + el.dataset.qdel, { method: 'DELETE' }); refreshTasks(); }));
    if (active && !qTimer) qTimer = setInterval(refreshTasks, 1500);
    if (!active && qTimer) { clearInterval(qTimer); qTimer = null; refreshDocJobs(); }
  }).catch(() => {});
}

/* ---------- 标签切换 ---------- */
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  const tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('excelFlow').classList.toggle('hidden', tab !== 'excel');
  $('docFlow').classList.toggle('hidden', tab !== 'doc');
  window.UIInit();
}));

/* ---------- 启动 ---------- */
let seeded = false;
function seedDemo() {
  if (seeded) return; seeded = true;
  const csv = '\ufeff日期,门店,商品,数量,金额\n2026-01-05,北京店,拿铁,3,90\n2026-01-05,上海店,美式,2,50\n2026-01-06,北京店,拿铁,3,90\n,,,,\n2026-01-06,广州店,蛋糕,1,40\n2026-01-07,北京店,蛋糕,4,160\n2026-01-07,广州店,拿铁,1,30\n';
  readFile(new File([new Blob([csv], { type: 'text/csv' })], '内置示例数据.csv'));
}
async function boot() {
  if (!token) { showLogin(); return; }
  try {
    const me = await api('/api/me');
    username = me.username; showApp(); health(); refreshJobs(); seedDemo();
  } catch (e) { showLogin(); }
}
setInterval(() => { if (token) health(); }, 15000);
boot();
