/* =========================================================
   FlowDesk App
   原生 SPA：路由、工作台、四个业务模块、计费、设置、后台
   ========================================================= */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var view = $('#view');

  var state = {
    me: null,
    route: 'dashboard',
    renderToken: 0,
    charts: [],
    timers: [],
    excel: { session: null, upload: null, result: null, report: null, jobs: null, page: 1, q: '' },
    docs: { job: null, tasks: null, jobs: null, page: 1, q: '', polling: null },
    quotes: { list: null, draft: null, editing: null, page: 1, q: '', status: '' },
    analytics: { dataset: null, result: null, jobId: null, insight: null, jobs: null },
    settings: { members: null, audit: null, auditPage: 1 },
    admin: { tab: 'overview', overview: null, users: null, workspaces: null, audit: null, health: null }
  };

  var ROUTE_META = {
    dashboard: { title: '总览', crumb: 'FlowDesk / 工作台', icon: 'dashboard' },
    excel: { title: 'Excel 清洗', crumb: '自动化 / 表格处理', icon: 'excel' },
    docs: { title: '文档抽取', crumb: '自动化 / 文档解析', icon: 'docs' },
    quotes: { title: '报价单', crumb: '自动化 / 商务报价', icon: 'quotes' },
    analytics: { title: '销售看板', crumb: '自动化 / 数据分析', icon: 'analytics' },
    billing: { title: '用量与计费', crumb: '账户 / 套餐', icon: 'billing' },
    settings: { title: '设置', crumb: '账户 / 工作区', icon: 'settings' },
    admin: { title: '平台管理', crumb: 'FlowDesk / Admin', icon: 'admin' }
  };

  var ROLE_LABEL = { owner: '所有者', admin: '管理员', member: '成员' };
  var STATUS_LABEL = { draft: '草稿', sent: '已发送', accepted: '已成交' };
  var TASK_LABEL = { pending: '排队中', processing: '处理中', done: '已完成', failed: '失败', canceled: '已取消' };
  var CURRENCY = { CNY: '¥', USD: '$', EUR: '€' };

  var ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    excel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11M15 9v11"/></svg>',
    docs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l4 4v14H6z"/><circle cx="11" cy="13" r="3"/><path d="M13.2 15.2 16 18"/></svg>',
    quotes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h6M9 16h4"/></svg>',
    analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V5M4 19h16"/><rect x="8" y="11" width="3" height="5" rx="1"/><rect x="13" y="7" width="3" height="9" rx="1"/><rect x="18" y="13" width="3" height="3" rx="1"/></svg>',
    billing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 15h4"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></svg>',
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7l8-4z"/><path d="M9 12l2 2 4-4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3v12M7 11l5 5 5-5M5 21h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 3h6M7 7l1 14h8l1-14M10 11v6M14 11v6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L20 8l-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 15.5a5.5 5.5 0 0 1 5.5 4.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 12l5 5L20 6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 20V8M7 12l5-5 5 5M5 3h14"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7l8-4z"/><path d="M9 12l2 2 4-4"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="15" r="4"/><path d="M11 12L20 3M17 6l3 3M15 8l2 2"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>'
  };

  function icon(name, size) {
    var svg = ICONS[name] || ICONS.file;
    return '<span class="ico-svg" style="display:inline-flex;width:' + (size || 18) + 'px;height:' + (size || 18) + 'px">' + svg + '</span>';
  }

  /* ---------------- 基础工具 ---------------- */
  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      btn.dataset.html = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span> ' + (label || '处理中…');
    } else {
      btn.disabled = false;
      if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
      delete btn.dataset.html;
    }
  }

  function clearTimers() {
    state.timers.forEach(function (t) { clearInterval(t); clearTimeout(t); });
    state.timers = [];
    if (state.docs && state.docs.polling) {
      clearTimeout(state.docs.polling);
      state.docs.polling = null;
    }
    state.charts.forEach(function (c) { try { c.destroy(); } catch (e) {} });
    state.charts = [];
  }

  function addTimer(id) { state.timers.push(id); return id; }

  function chartColors() {
    var light = FDTheme.current() === 'light';
    return {
      grid: light ? 'rgba(15,23,42,.08)' : 'rgba(255,255,255,.07)',
      ticks: light ? '#52607a' : '#9aa4c4',
      line: '#6366f1',
      cyan: '#22d3ee',
      palette: ['#6366f1', '#22d3ee', '#a855f7', '#f59e0b', '#22c55e', '#ec4899']
    };
  }

  function lineChart(canvasId, labels, values, label) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    var c = chartColors();
    var ctx = canvas.getContext('2d');
    var grad = ctx.createLinearGradient(0, 0, 0, 260);
    grad.addColorStop(0, 'rgba(99,102,241,.42)');
    grad.addColorStop(1, 'rgba(99,102,241,0)');
    var chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: label || '任务数', data: values,
          borderColor: c.line, backgroundColor: grad, fill: true,
          tension: 0.38, borderWidth: 2.4, pointRadius: 2.2,
          pointBackgroundColor: c.cyan, pointBorderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { intersect: false, mode: 'index' } },
        scales: {
          x: { grid: { color: c.grid, drawBorder: false }, ticks: { color: c.ticks, font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: c.grid, drawBorder: false }, ticks: { color: c.ticks, font: { size: 10 }, precision: 0 } }
        }
      }
    });
    state.charts.push(chart);
    return chart;
  }

  function doughnutChart(canvasId, labels, values) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    var c = chartColors();
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: c.palette,
          borderColor: 'transparent', borderWidth: 2, hoverOffset: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '64%',
        plugins: {
          legend: { position: 'bottom', labels: { color: c.ticks, boxWidth: 9, boxHeight: 9, font: { size: 11 }, padding: 12 } }
        }
      }
    });
    state.charts.push(chart);
    return chart;
  }

  function fillSeries(series, days) {
    days = days || 14;
    var map = {};
    (series || []).forEach(function (x) { map[x.day] = x.units; });
    var out = [];
    var today = new Date();
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today.getTime() - i * 86400000);
      var key = d.toISOString().slice(0, 10);
      out.push({ day: key, label: key.slice(5), units: map[key] || 0 });
    }
    return out;
  }

  function statusBadge(kind, status) {
    var label = (kind === 'task' ? TASK_LABEL : STATUS_LABEL)[status] || status || '—';
    var cls = { draft: 'gray', sent: 'cyan', accepted: 'green', pending: 'amber', processing: 'cyan', done: 'green', failed: 'red', canceled: 'gray' }[status] || 'gray';
    return '<span class="badge ' + cls + '">' + FD.esc(label) + '</span>';
  }

  function planBadge(plan) {
    var cls = plan === 'team' ? 'cyan' : plan === 'pro' ? '' : 'gray';
    return '<span class="badge ' + cls + '">' + FD.esc((plan || 'free').toUpperCase()) + '</span>';
  }

  function errorBox(message) {
    return '<div class="card pad" style="border-color:rgba(239,68,68,.3)"><b style="color:#fca5a5">加载失败</b><p class="muted" style="font-size:13px">' + FD.esc(message) + '</p><button class="btn btn-sm" onclick="location.reload()">重试</button></div>';
  }

  function emptyBox(title, desc) {
    return '<div class="empty"><b>' + FD.esc(title) + '</b><span>' + FD.esc(desc || '') + '</span></div>';
  }

  /* ---------------- API ---------------- */
  async function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    var res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts, { headers: headers }));
    var ct = res.headers.get('content-type') || '';
    var data = null;
    if (ct.indexOf('application/json') >= 0) {
      try { data = await res.json(); } catch (e) {}
    }
    if (res.status === 401) {
      location.href = '/login';
      throw new Error('登录已过期');
    }
    if (!res.ok) {
      var detail = data && data.detail;
      var message = typeof detail === 'string' ? detail : (detail && detail.message) || ('请求失败（' + res.status + '）');
      if (res.status === 402 && detail && detail.upgrade) {
        quotaModal(detail);
      }
      throw new Error(message);
    }
    return data;
  }

  async function downloadFile(path, fallbackName) {
    var res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) {
      if (res.status === 401) { location.href = '/login'; return; }
      var message = '下载失败';
      try { var data = await res.json(); message = data.detail || message; } catch (e) {}
      throw new Error(typeof message === 'string' ? message : (message.message || '下载失败'));
    }
    var blob = await res.blob();
    var name = fallbackName || 'download';
    var cd = res.headers.get('content-disposition') || '';
    var match = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
    if (match) {
      try { name = decodeURIComponent(match[1]); } catch (e) { name = match[1]; }
    }
    FD.download(name, blob);
  }

  function quotaModal(detail) {
    openModal({
      title: '用量已到上限',
      body: '<div class="stack">' +
        '<div class="badge amber">' + FD.esc(detail.message || '当前套餐用量已用完') + '</div>' +
        '<p class="muted" style="font-size:13px;margin:0">升级套餐后可立即继续，已有数据不会丢失。演示环境为沙箱计费，不会真实扣款。</p>' +
        '<div class="grid grid-3" style="gap:10px">' +
        '<div class="card pad-sm"><b>Free</b><div class="dim" style="font-size:11px">50 次 / 月</div></div>' +
        '<div class="card pad-sm"><b>Pro</b><div class="dim" style="font-size:11px">1,000 次 / 月</div></div>' +
        '<div class="card pad-sm"><b>Team</b><div class="dim" style="font-size:11px">5,000 次 / 月</div></div>' +
        '</div></div>',
      foot: '<button class="btn" data-close>稍后</button><a class="btn btn-primary" href="#/billing" id="quotaUpgrade">去升级</a>',
      onMount: function (el, close) {
        var link = $('#quotaUpgrade', el);
        if (link) link.addEventListener('click', close);
      }
    });
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(opts) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<div class="modal ' + (opts.wide ? 'wide' : '') + '">' +
      '<div class="modal-head"><h3>' + FD.esc(opts.title || '') + '</h3>' +
      '<button class="btn btn-icon btn-ghost" data-close aria-label="关闭">✕</button></div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      (opts.foot ? '<div class="modal-foot">' + opts.foot + '</div>' : '') +
      '</div>';
    document.body.appendChild(backdrop);
    var close = function () { backdrop.remove(); };
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop || e.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
    if (opts.onMount) opts.onMount(backdrop, close);
    return { el: backdrop, close: close };
  }

  function confirmBox(message, options) {
    options = options || {};
    return new Promise(function (resolve) {
      var modal = openModal({
        title: options.title || '请确认',
        body: '<p class="muted" style="font-size:13.5px;margin:0">' + FD.esc(message) + '</p>',
        foot: '<button class="btn" data-close>取消</button>' +
              '<button class="btn ' + (options.danger ? 'btn-danger' : 'btn-primary') + '" id="confirmOk">' + FD.esc(options.ok || '确定') + '</button>',
        onMount: function (el, close) {
          $('#confirmOk', el).addEventListener('click', function () { close(); resolve(true); });
          el.addEventListener('click', function (e) {
            if (e.target === el || e.target.closest('[data-close]')) resolve(false);
          });
        }
      });
      modal.el.addEventListener('remove', function () { resolve(false); });
    });
  }

  /* ---------------- 外壳 ---------------- */
  function syncShell() {
    var me = state.me;
    if (!me) return;
    var ws = me.workspace;
    var usage = me.usage || {};
    var runs = usage.runs || { used: 0, limit: 0, percent: 0 };

    $('#wsName').textContent = ws.name;
    $('#wsAvatar').textContent = FD.initials(ws.name);
    $('#wsRole').textContent = (ROLE_LABEL[ws.role] || ws.role) + ' · ' + (me.plan.name || ws.plan);

    $('#planCard').innerHTML =
      '<div class="t"><span>' + FD.esc(me.plan.name) + ' 套餐</span><span class="badge gray">' + FD.esc(ws.plan.toUpperCase()) + '</span></div>' +
      '<div class="u"><span>本月任务</span><span>' + runs.used + ' / ' + runs.limit + '</span></div>' +
      '<div class="progress"><i class="' + (runs.percent > 85 ? 'warn' : '') + '" style="width:' + runs.percent + '%"></i></div>' +
      '<a class="btn btn-sm ' + (ws.plan === 'free' ? 'btn-primary' : 'btn-ghost') + ' btn-block" href="#/billing">' +
      (ws.plan === 'free' ? '升级套餐' : '管理订阅') + '</a>';

    $('#usagePill').textContent = '本月 ' + runs.used + ' / ' + runs.limit + ' 次';

    var ai = me.ai || {};
    var aiActive = ai.active || 'rules';
    var dotClass = aiActive === 'api' ? '' : aiActive === 'ollama' ? 'amber' : 'off';
    $('#aiBadge').innerHTML = '<span class="dot ' + dotClass + '"></span>' + FD.esc(ai.active_label || '规则引擎');

    $('#avatarBtn').textContent = FD.initials(me.user.name);
    $('#avatarBtn').title = me.user.name;
    $('#menuAvatar').textContent = FD.initials(me.user.name);
    $('#menuName').textContent = me.user.name;
    $('#menuEmail').textContent = me.user.email;

    $('#adminNav').classList.toggle('hidden', !me.user.is_admin);

    var wsHtml = (me.workspaces || []).map(function (w) {
      return '<div class="menu-item" data-ws="' + w.id + '">' +
        '<span class="avatar" style="width:24px;height:24px;font-size:10px">' + FD.initials(w.name) + '</span>' +
        '<span style="flex:1">' + FD.esc(w.name) + '<br><span style="font-size:10px;color:var(--dim)">' + FD.esc((ROLE_LABEL[w.role] || w.role)) + ' · ' + w.plan.toUpperCase() + '</span></span>' +
        (w.id === ws.id ? '<span style="color:var(--i2)">✓</span>' : '') + '</div>';
    }).join('');
    $('#menuWorkspaces').innerHTML = wsHtml;
    $$('#menuWorkspaces [data-ws]').forEach(function (el) {
      el.addEventListener('click', function () { switchWorkspace(Number(el.dataset.ws)); });
    });
  }

  async function switchWorkspace(id) {
    if (!id || id === state.me.workspace.id) { $('#userMenu').classList.add('hidden'); return; }
    try {
      state.me = await api('/api/auth/switch', { method: 'POST', body: JSON.stringify({ workspace_id: id }) });
      syncShell();
      $('#userMenu').classList.add('hidden');
      state.excel = { session: null, upload: null, result: null, report: null, jobs: null, page: 1, q: '' };
      state.docs = { job: null, tasks: null, jobs: null, page: 1, q: '', polling: null };
      state.analytics = { dataset: null, result: null, jobId: null, insight: null, jobs: null };
      FD.toast('已切换到「' + state.me.workspace.name + '」', 'ok');
      renderRoute();
    } catch (e) { FD.toast(e.message, 'err'); }
  }

  function setTopbar(route) {
    var meta = ROUTE_META[route] || ROUTE_META.dashboard;
    $('#pageTitle').textContent = meta.title;
    $('#pageCrumb').textContent = meta.crumb;
    $$('.nav-item').forEach(function (el) {
      el.classList.toggle('on', el.dataset.route === route);
    });
    document.title = meta.title + ' · FlowDesk 流序';
  }

  /* ---------------- 路由 ---------------- */
  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean);
    return { route: parts[0] || 'dashboard', rest: parts.slice(1) };
  }

  async function renderRoute() {
    var parsed = parseHash();
    var route = parsed.route;
    clearTimers();
    if (!ROUTE_META[route]) route = 'dashboard';
    if (route === 'admin' && !state.me.user.is_admin) route = 'dashboard';
    state.route = route;
    setTopbar(route);
    $('#sidebar').classList.remove('open');
    $('#sidebarOverlay').classList.add('hidden');
    var token = ++state.renderToken;
    view.innerHTML = '<div class="spin-lg"></div>';
    try {
      if (route === 'dashboard') await renderDashboard(token);
      else if (route === 'excel') await renderExcel(token);
      else if (route === 'docs') await renderDocs(token);
      else if (route === 'quotes') await renderQuotes(token, parsed.rest);
      else if (route === 'analytics') await renderAnalytics(token);
      else if (route === 'billing') await renderBilling(token);
      else if (route === 'settings') await renderSettings(token);
      else if (route === 'admin') await renderAdmin(token);
    } catch (e) {
      if (token !== state.renderToken) return;
      view.innerHTML = errorBox(e.message || '未知错误');
    }
  }

  /* ---------------- 总览 ---------------- */
  async function renderDashboard(token) {
    var data = await api('/api/dashboard');
    if (token !== state.renderToken) return;
    state.dashboard = data;

    var hour = new Date().getHours();
    var greet = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
    var name = state.me.user.name;
    var runs = data.usage.runs;
    var counts = data.counts;
    var totalOutput = counts.excel + counts.docs + counts.quotes + counts.analytics;
    var storageMb = (data.usage.storage.used / 1024 / 1024).toFixed(1);
    var ai = data.ai || {};

    view.innerHTML =
      '<div class="page-head">' +
        '<div><h1>' + greet + '，' + FD.esc(name) + '</h1>' +
        '<p>今天是 ' + new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) +
        ' · 这是「' + FD.esc(data.workspace.name) + '」的实时概览。</p></div>' +
        '<div class="row"><a class="btn btn-sm" href="#/settings">工作区设置</a><a class="btn btn-primary btn-sm" href="#/quotes/new">' + icon('plus', 15) + ' 新建报价</a></div>' +
      '</div>' +

      '<div class="grid grid-4">' +
        '<div class="kpi p"><span class="label">本月任务</span><b>' + runs.used + '</b><div class="foot">套餐上限 ' + runs.limit + ' 次</div></div>' +
        '<div class="kpi g"><span class="label">累计产出</span><b>' + totalOutput + '</b><div class="foot">清洗 / 抽取 / 报价 / 看板</div></div>' +
        '<div class="kpi c"><span class="label">文件存储</span><b>' + storageMb + ' MB</b><div class="foot">上限 ' + data.usage.plan.storage_mb + ' MB</div></div>' +
        '<div class="kpi a"><span class="label">本月 AI 调用</span><b>' + data.month.ai_calls + '</b><div class="foot">' + FD.esc(ai.active_label || '规则引擎') + ' · 三层降级</div></div>' +
      '</div>' +

      '<div class="grid mt-24" style="grid-template-columns:minmax(0,1.65fr) minmax(300px,1fr)">' +
        '<div class="card pad">' +
          '<div class="section-head"><div><h3>任务趋势</h3><span class="dim" style="font-size:11.5px">最近 14 天的任务次数</span></div><span class="badge cyan">近两周</span></div>' +
          '<div class="chart-box"><canvas id="usageChart"></canvas></div>' +
        '</div>' +
        '<div class="card pad">' +
          '<div class="section-head"><h3>用量与套餐</h3>' + planBadge(data.plan.key) + '</div>' +
          '<div class="stack">' +
            usageBar('任务次数', runs.used, runs.limit, '') +
            usageBar('文件存储', data.usage.storage.used, data.usage.storage.limit, 'MB') +
            usageBar('成员席位', data.usage.members.used, data.usage.members.limit, '') +
          '</div>' +
          '<div class="divider"></div>' +
          '<div class="row between"><span class="dim" style="font-size:12px">当前套餐</span><b>' + FD.esc(data.plan.name) + ' · ¥' + data.plan.price + '/月</b></div>' +
          '<a class="btn btn-sm btn-primary btn-block mt-16" href="#/billing">' + (data.plan.key === 'free' ? '升级套餐' : '管理订阅') + '</a>' +
        '</div>' +
      '</div>' +

      '<div class="grid grid-4 mt-24">' +
        quickSpot('excel', 'Excel 清洗', '去重 · 汇总 · 导出') +
        quickSpot('docs', '文档抽取', '合同 · PDF · 批量') +
        quickSpot('quotes', '报价单', 'AI 拆解 · 打印') +
        quickSpot('analytics', '销售看板', 'KPI · 趋势 · 洞察') +
      '</div>' +

      '<div class="grid mt-24" style="grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr)">' +
        '<div class="card pad">' +
          '<div class="section-head"><h3>最近活动</h3><span class="dim" style="font-size:11.5px">来自真实任务记录</span></div>' +
          (data.recent.length ? '<div class="activity">' + data.recent.map(activityItem).join('') + '</div>' :
            emptyBox('还没有任务记录', '从上方任意模块开始，结果会自动出现在这里。')) +
        '</div>' +
        '<div class="card pad">' +
          '<div class="section-head"><h3>AI 通道</h3><span class="badge ' + (ai.active === 'rules' ? 'amber' : 'green') + '">' + FD.esc(ai.active_label || '规则引擎') + '</span></div>' +
          '<div class="stack-sm" style="font-size:12.5px">' +
            aiRow('云端 API', ai.api_configured ? (ai.api_model || '已配置') : '未配置', !!ai.api_configured) +
            aiRow('本地 Ollama', ai.ollama_online ? (ai.ollama_model || '在线') : '未检测到', !!ai.ollama_online) +
            aiRow('规则引擎', '始终可用', true) +
          '</div>' +
          '<div class="divider"></div>' +
          '<p class="dim" style="font-size:11.5px;margin:0;line-height:1.7">请求按「云端 → 本地 → 规则」顺序降级。任何一层失败都不会中断业务，结果会标注来源。</p>' +
          '<a class="link-btn" href="#/settings" style="margin-top:10px;display:inline-block">查看配置说明 →</a>' +
        '</div>' +
      '</div>';

    var series = fillSeries(data.usage_series, 14);
    lineChart('usageChart', series.map(function (x) { return x.label; }), series.map(function (x) { return x.units; }), '任务数');
  }

  function usageBar(label, used, limit, unit) {
    var pct = limit ? Math.min(100, Math.round(used / limit * 100)) : 0;
    var display = unit === 'MB'
      ? (used / 1024 / 1024).toFixed(1) + ' / ' + (limit / 1024 / 1024).toFixed(0) + ' MB'
      : used + ' / ' + limit;
    return '<div><div class="row between" style="font-size:12px;margin-bottom:6px"><span class="muted">' + label + '</span><span class="dim">' + display + '</span></div>' +
      '<div class="progress"><i class="' + (pct > 85 ? 'warn' : '') + '" style="width:' + pct + '%"></i></div></div>';
  }

  function quickSpot(route, title, sub) {
    return '<a class="spot" href="#/' + route + '"><span class="ico">' + icon(route, 18) + '</span><span><b>' + title + '</b><span>' + sub + '</span></span></a>';
  }

  function activityItem(item) {
    var map = { excel: 'Excel 清洗', doc: '文档抽取', quote: '报价单', analytics: '销售看板' };
    var href = item.type === 'quote' ? '#/quotes/' + item.id : '#/' + (item.type === 'doc' ? 'docs' : item.type);
    return '<a class="activity-item" href="' + href + '">' +
      '<span class="ico">' + icon(item.type === 'doc' ? 'docs' : item.type, 15) + '</span>' +
      '<span class="txt"><b>' + FD.esc(item.title) + '</b><span>' + FD.esc(map[item.type] || '') + ' · ' + FD.esc(item.meta) + '</span></span>' +
      '<span class="time">' + FD.timeAgo(item.created_at) + '</span></a>';
  }

  function aiRow(label, value, ok) {
    return '<div class="row between"><span class="row" style="gap:8px"><span class="dot ' + (ok ? '' : 'off') + '"></span>' + label + '</span><span class="dim">' + FD.esc(value) + '</span></div>';
  }

  /* ---------------- 通用表格 / 分页 ---------------- */
  function dataTable(headers, rows, maxRows) {
    if (!headers || !headers.length) return emptyBox('暂无数据', '处理完成后会在这里预览。');
    var shown = (rows || []).slice(0, maxRows || 100);
    var head = headers.map(function (h) { return '<th>' + FD.esc(h) + '</th>'; }).join('');
    var body = shown.map(function (row) {
      return '<tr>' + headers.map(function (h, i) {
        var value = row[i];
        var isNum = typeof value === 'number';
        return '<td class="' + (isNum ? 'num' : '') + '">' + FD.esc(value) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="table-wrap"><table class="data"><thead><tr>' + head + '</tr></thead><tbody>' +
      (body || '<tr><td colspan="' + headers.length + '" class="dim" style="text-align:center;padding:20px">无数据行</td></tr>') +
      '</tbody></table></div>' +
      ((rows || []).length > shown.length ? '<div class="table-hint">仅展示前 ' + shown.length + ' 行，导出可获取完整数据。</div>' : '');
  }

  function pagerHtml(page, pageSize, total) {
    var pages = Math.max(1, Math.ceil((total || 0) / pageSize));
    return '<div class="row between mt-16">' +
      '<span class="dim" style="font-size:12px">共 ' + (total || 0) + ' 条</span>' +
      '<div class="row" style="gap:6px">' +
      '<button class="btn btn-sm" data-page="' + (page - 1) + '" ' + (page <= 1 ? 'disabled' : '') + '>上一页</button>' +
      '<span class="chip">' + page + ' / ' + pages + '</span>' +
      '<button class="btn btn-sm" data-page="' + (page + 1) + '" ' + (page >= pages ? 'disabled' : '') + '>下一页</button>' +
      '</div></div>';
  }

  function bindPager(root, callback) {
    $$('[data-page]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        callback(Number(btn.dataset.page));
      });
    });
  }

  function fileDropHtml(id, title, hint, accept, multiple) {
    return '<label class="drop" id="' + id + '" for="' + id + 'Input">' +
      '<div class="ico">⇪</div><b>' + FD.esc(title) + '</b><span>' + FD.esc(hint) + '</span>' +
      '<input type="file" id="' + id + 'Input" accept="' + (accept || '') + '" ' + (multiple ? 'multiple' : '') + ' /></label>';
  }

  function bindDrop(zone, onFiles) {
    if (!zone) return;
    var input = $('input[type=file]', zone);
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('over'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('over');
      if (e.dataTransfer.files && e.dataTransfer.files.length) onFiles(Array.prototype.slice.call(e.dataTransfer.files));
    });
    if (input) input.addEventListener('change', function () {
      if (input.files && input.files.length) onFiles(Array.prototype.slice.call(input.files));
      input.value = '';
    });
  }

  function xlog(message, type) {
    state.excel.logs = state.excel.logs || [];
    state.excel.logs.push({ t: new Date().toLocaleTimeString('zh-CN', { hour12: false }), msg: message, type: type || '' });
    if (state.excel.logs.length > 40) state.excel.logs.shift();
  }

  /* ---------------- Excel 清洗 ---------------- */
  async function renderExcel(token) {
    if (!state.excel.jobs) {
      state.excel.jobs = await api('/api/excel/jobs?page=' + state.excel.page + '&page_size=8&q=' + encodeURIComponent(state.excel.q));
    }
    if (token !== state.renderToken) return;

    var up = state.excel.upload;
    var result = state.excel.result;
    var report = state.excel.report;
    var logs = state.excel.logs || [];
    var cols = up ? up.columns : [];
    var suggested = up ? up.suggested : { columns: [] };
    var numericCols = (suggested.columns || []).filter(function (c) { return c.type === 'number'; });

    view.innerHTML =
      '<div class="page-head">' +
        '<div><h1>Excel 清洗与汇总</h1><p>上传表格，自动清洗空行与重复项；用自然语言生成分组汇总，再导出为 Excel。</p></div>' +
        '<div class="row"><button class="btn btn-sm" id="sampleExcel">下载示例 CSV</button><button class="btn btn-sm btn-ghost" id="resetExcel">清空会话</button></div>' +
      '</div>' +

      '<div class="card pad" id="excelUploadCard">' +
        (up
          ? '<div class="row between" style="gap:12px"><div class="row" style="gap:10px"><span class="avatar">' + icon('excel', 16) + '</span>' +
            '<div><b>' + FD.esc(up.filename) + '</b><div class="dim" style="font-size:11.5px">' + FD.num(up.row_count) + ' 行 · ' + cols.length + ' 列 · 会话保留 2 小时</div></div></div>' +
            '<span class="badge green">已上传</span></div>'
          : fileDropHtml('excelDrop', '拖入 Excel / CSV，或点击选择', '支持 .xlsx / .xls / .csv，单文件不超过 15 MB', '.xlsx,.xls,.csv') ) +
      '</div>' +

      (up ?
        '<div class="grid mt-24" style="grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr)">' +
          '<div class="card pad">' +
            '<div class="section-head"><h3>清洗与分组</h3><span class="badge gray">确定性处理</span></div>' +
            '<div class="form-grid">' +
              '<div class="row" style="gap:20px">' +
                '<label class="switch"><input type="checkbox" id="removeEmpty" checked><span class="track"></span>删除空行</label>' +
                '<label class="switch"><input type="checkbox" id="removeDup" checked><span class="track"></span>删除重复行</label>' +
              '</div>' +
              '<div class="form-grid cols-2">' +
                '<div><label>分组列</label><select id="groupBy"><option value="">不分组，仅清洗</option>' +
                  cols.map(function (c) { return '<option value="' + FD.esc(c) + '" ' + (c === suggested.category ? 'selected' : '') + '>' + FD.esc(c) + '</option>'; }).join('') +
                '</select></div>' +
                '<div><label>数值列</label><select id="valueCol"><option value="">—</option>' +
                  numericCols.map(function (c) { return '<option value="' + FD.esc(c.name) + '" ' + (c.name === suggested.amount ? 'selected' : '') + '>' + FD.esc(c.name) + '</option>'; }).join('') +
                '</select></div>' +
              '</div>' +
              '<div class="form-grid cols-2">' +
                '<div><label>汇总方式</label><select id="agg">' +
                  '<option value="sum">求和</option><option value="count">计数</option><option value="avg">平均</option><option value="max">最大</option><option value="min">最小</option>' +
                '</select></div>' +
                '<div style="display:flex;align-items:flex-end;gap:8px"><button class="btn btn-primary" id="processBtn" style="flex:1">' + icon('play', 14) + ' 开始处理</button></div>' +
              '</div>' +
            '</div>' +
            '<div class="divider"></div>' +
            '<div class="row" style="gap:8px"><span class="dim" style="font-size:11.5px">原始数据预览</span><span class="chip">' + FD.num(up.row_count) + ' 行</span></div>' +
            '<div class="mt-8">' + dataTable(up.headers, up.preview, 6) + '</div>' +
          '</div>' +

          '<div class="card pad">' +
            '<div class="section-head"><h3>AI 指令</h3><span class="badge cyan">自然语言</span></div>' +
            '<p class="dim" style="font-size:12px;margin:0 0 10px">描述你想怎么汇总，系统会解析成列与聚合方式。</p>' +
            '<textarea id="aiCommand" placeholder="例如：按门店汇总金额，看看每个门店的销售额"></textarea>' +
            '<div class="row mt-8" style="gap:6px">' +
              '<button class="chip" data-cmd="按门店汇总金额">按门店汇总金额</button>' +
              '<button class="chip" data-cmd="统计每个商品的订单数">统计每个商品订单数</button>' +
              '<button class="chip" data-cmd="按日期求平均金额">按日期求平均</button>' +
            '</div>' +
            '<div class="row mt-16"><button class="btn btn-primary" id="aiCmdBtn">' + icon('spark', 14) + ' 生成汇总方案</button>' +
            '<button class="btn btn-ghost" id="aiReportBtn">生成分析报告</button></div>' +
            '<div class="divider"></div>' +
            '<div class="log" id="excelLog">' +
              (logs.length ? logs.map(function (l) { return '<div><span class="time">[' + l.t + ']</span> <span class="' + l.type + '">' + FD.esc(l.msg) + '</span></div>'; }).join('') : '<span class="dim">等待操作…</span>') +
            '</div>' +
          '</div>' +
        '</div>' +

        (result ?
          '<div class="card pad mt-24">' +
            '<div class="section-head"><div><h3>处理结果</h3><span class="dim" style="font-size:11.5px">已写入历史记录，可随时重新导出</span></div>' +
              '<div class="row"><button class="btn btn-sm" id="exportExcel">' + icon('download', 14) + ' 导出 Excel</button></div></div>' +
            '<div class="grid grid-4">' +
              '<div class="kpi p" style="padding:14px"><span class="label">原始行数</span><b style="font-size:22px">' + FD.num(result.stats.original) + '</b></div>' +
              '<div class="kpi g" style="padding:14px"><span class="label">清洗后</span><b style="font-size:22px">' + FD.num(result.stats.cleaned) + '</b></div>' +
              '<div class="kpi a" style="padding:14px"><span class="label">删除空行</span><b style="font-size:22px">' + FD.num(result.stats.removed_empty) + '</b></div>' +
              '<div class="kpi c" style="padding:14px"><span class="label">删除重复</span><b style="font-size:22px">' + FD.num(result.stats.removed_dup) + '</b></div>' +
            '</div>' +
            (result.summary_headers ?
              '<div class="mt-24"><div class="section-head"><h3 style="font-size:14px">汇总结果</h3><span class="chip">' + (result.summary_rows.length) + ' 组</span></div>' +
              dataTable(result.summary_headers, result.summary_rows, 100) + '</div>' : '') +
            '<div class="mt-24"><div class="section-head"><h3 style="font-size:14px">清洗后数据</h3><span class="chip">前 100 行</span></div>' +
            dataTable(result.cleaned_headers, result.cleaned_rows, 100) + '</div>' +
            (report ? '<div class="divider"></div><div class="section-head"><h3 style="font-size:14px">AI 分析报告</h3><span class="badge cyan">' + FD.esc(report.via_label) + '</span></div>' +
              '<div class="insight">' + FD.esc(report.report) + '</div>' : '') +
          '</div>' : '') +
        '' : '') +

      '<div class="card pad mt-24">' +
        '<div class="section-head"><h3>处理历史</h3>' +
          '<div class="row" style="gap:8px"><input id="excelSearch" placeholder="搜索文件名" value="' + FD.esc(state.excel.q) + '" style="width:180px;padding:7px 10px;font-size:12.5px" />' +
          '<button class="btn btn-sm" id="excelSearchBtn">' + icon('search', 14) + '</button></div></div>' +
        (state.excel.jobs && state.excel.jobs.jobs.length ?
          '<div class="table-wrap"><table class="data"><thead><tr><th>文件</th><th>清洗结果</th><th>删除</th><th>时间</th><th></th></tr></thead><tbody>' +
          state.excel.jobs.jobs.map(function (j) {
            return '<tr><td><b>' + FD.esc(j.filename) + '</b></td>' +
              '<td>' + FD.num(j.original) + ' → ' + FD.num(j.cleaned) + ' 行</td>' +
              '<td class="dim">空 ' + j.removed_empty + ' / 重 ' + j.removed_dup + '</td>' +
              '<td class="dim">' + FD.timeAgo(j.created_at) + '</td>' +
              '<td class="num"><div class="row end" style="gap:5px">' +
                '<button class="btn btn-sm" data-view="' + j.id + '">查看</button>' +
                '<button class="btn btn-sm" data-export="' + j.id + '">导出</button>' +
                '<button class="btn btn-sm btn-danger" data-del="' + j.id + '">删除</button>' +
              '</div></td></tr>';
          }).join('') + '</tbody></table></div>' +
          pagerHtml(state.excel.jobs.page, state.excel.jobs.page_size, state.excel.jobs.total)
          : emptyBox('还没有处理记录', '上传第一个表格，结果会自动保存。')) +
      '</div>';

    // 上传
    var drop = $('#excelDrop');
    if (drop) bindDrop(drop, function (files) { uploadExcel(files[0]); });

    $('#sampleExcel').addEventListener('click', function () {
      var csv = '\uFEFF日期,门店,商品,数量,金额\n2026-10-01,北京店,拿铁,3,90\n2026-10-01,上海店,美式,2,52\n2026-10-02,北京店,拿铁,2,60\n2026-10-02,广州店,蛋糕,1,38\n2026-10-03,北京店,蛋糕,4,152\n2026-10-03,成都店,轻食,2,90\n';
      FD.download('flowdesk-sample.csv', csv, 'text/csv;charset=utf-8');
    });
    $('#resetExcel').addEventListener('click', function () {
      state.excel = { session: null, upload: null, result: null, report: null, jobs: state.excel.jobs, page: 1, q: '', logs: [] };
      renderRoute();
    });

    if (up) {
      $('#processBtn').addEventListener('click', function () { processExcel(this); });
      var exportBtn = $('#exportExcel');
      if (exportBtn) exportBtn.addEventListener('click', function () {
        downloadFile('/api/excel/export?session=' + encodeURIComponent(state.excel.session), 'flowdesk-result.xlsx')
          .catch(function (e) { FD.toast(e.message, 'err'); });
      });
      $$('#excelUploadCard [data-cmd], .row [data-cmd]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          $('#aiCommand').value = btn.dataset.cmd;
          $('#aiCommand').focus();
        });
      });
      $('#aiCmdBtn').addEventListener('click', function () { excelAiCommand(this); });
      $('#aiReportBtn').addEventListener('click', function () { excelAiReport(this); });
      var logEl = $('#excelLog');
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    }

    // 历史
    var doSearch = function () {
      state.excel.q = $('#excelSearch').value.trim();
      state.excel.page = 1;
      state.excel.jobs = null;
      renderRoute();
    };
    $('#excelSearchBtn').addEventListener('click', doSearch);
    $('#excelSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    bindPager(view, function (page) {
      state.excel.page = page;
      state.excel.jobs = null;
      renderRoute();
    });
    $$('[data-view]', view).forEach(function (btn) {
      btn.addEventListener('click', function () { viewExcelJob(Number(btn.dataset.view)); });
    });
    $$('[data-export]', view).forEach(function (btn) {
      btn.addEventListener('click', function () {
        downloadFile('/api/excel/jobs/' + btn.dataset.export + '/export', 'flowdesk-job.xlsx')
          .catch(function (e) { FD.toast(e.message, 'err'); });
      });
    });
    $$('[data-del]', view).forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!(await confirmBox('删除后不可恢复，确定删除这条处理记录？', { danger: true, ok: '删除' }))) return;
        try {
          await api('/api/excel/jobs/' + btn.dataset.del, { method: 'DELETE' });
          state.excel.jobs = null;
          FD.toast('已删除', 'ok');
          renderRoute();
        } catch (e) { FD.toast(e.message, 'err'); }
      });
    });
  }

  async function uploadExcel(file) {
    if (!file) return;
    var drop = $('#excelDrop');
    if (drop) drop.innerHTML = '<div class="spin-lg"></div><b>正在上传并解析…</b>';
    var fd = new FormData();
    fd.append('file', file);
    try {
      var data = await api('/api/excel/upload', { method: 'POST', body: fd });
      state.excel.upload = data;
      state.excel.session = data.session;
      state.excel.result = null;
      state.excel.report = null;
      xlog('已上传 ' + data.filename + '，' + data.row_count + ' 行 / ' + data.columns.length + ' 列', 'ok');
      FD.toast('文件已解析', 'ok');
      renderRoute();
    } catch (e) {
      FD.toast(e.message, 'err', 4000);
      renderRoute();
    }
  }

  async function processExcel(btn) {
    setBusy(btn, true, '处理中…');
    try {
      var payload = {
        session: state.excel.session,
        remove_empty: $('#removeEmpty').checked,
        remove_dup: $('#removeDup').checked,
        group_by: $('#groupBy').value || null,
        value_col: $('#valueCol').value || null,
        agg: $('#agg').value
      };
      var data = await api('/api/excel/process', { method: 'POST', body: JSON.stringify(payload) });
      state.excel.result = data;
      xlog('清洗完成：' + data.stats.original + ' → ' + data.stats.cleaned + ' 行，删除空行 ' + data.stats.removed_empty + '、重复 ' + data.stats.removed_dup, 'ok');
      FD.toast('处理完成', 'ok');
      renderRoute();
    } catch (e) {
      FD.toast(e.message, 'err', 4200);
      setBusy(btn, false);
    }
  }

  async function excelAiCommand(btn) {
    var text = $('#aiCommand').value.trim();
    if (!text) { FD.toast('先写一句指令', 'warn'); return; }
    setBusy(btn, true, '解析中…');
    try {
      var data = await api('/api/excel/ai/command', {
        method: 'POST', body: JSON.stringify({ session: state.excel.session, text: text })
      });
      if (!data.plan.groupBy) {
        FD.toast('没能识别出分组列，请手动选择', 'warn');
        setBusy(btn, false);
        return;
      }
      $('#groupBy').value = data.plan.groupBy;
      if (data.plan.valueColumn) $('#valueCol').value = data.plan.valueColumn;
      $('#agg').value = data.plan.agg;
      xlog('AI 方案：按「' + data.plan.groupBy + '」' + data.plan.agg + '（' + data.via_label + '）', 'ok');
      FD.toast('已应用方案，正在处理…', 'ok');
      setBusy(btn, false);
      await processExcel($('#processBtn'));
    } catch (e) {
      FD.toast(e.message, 'err');
      setBusy(btn, false);
    }
  }

  async function excelAiReport(btn) {
    setBusy(btn, true, '生成中…');
    try {
      var data = await api('/api/excel/ai/report', {
        method: 'POST', body: JSON.stringify({ session: state.excel.session, text: '' })
      });
      state.excel.report = data;
      xlog('已生成分析报告（' + data.via_label + '）', 'ok');
      renderRoute();
    } catch (e) {
      FD.toast(e.message, 'err');
      setBusy(btn, false);
    }
  }

  async function viewExcelJob(id) {
    try {
      var job = await api('/api/excel/jobs/' + id);
      openModal({
        title: job.filename,
        wide: true,
        body: '<div class="grid grid-4" style="margin-bottom:16px">' +
          '<div class="kpi p" style="padding:12px"><span class="label">原始</span><b style="font-size:20px">' + job.stats.original + '</b></div>' +
          '<div class="kpi g" style="padding:12px"><span class="label">清洗后</span><b style="font-size:20px">' + job.stats.cleaned + '</b></div>' +
          '<div class="kpi a" style="padding:12px"><span class="label">空行</span><b style="font-size:20px">' + job.stats.removed_empty + '</b></div>' +
          '<div class="kpi c" style="padding:12px"><span class="label">重复</span><b style="font-size:20px">' + job.stats.removed_dup + '</b></div>' +
          '</div>' +
          (job.summary_headers ? '<div class="section-head"><h3 style="font-size:14px">汇总</h3></div>' + dataTable(job.summary_headers, job.summary_rows, 100) : '') +
          '<div class="section-head mt-16"><h3 style="font-size:14px">清洗后数据</h3></div>' + dataTable(job.cleaned_headers, job.cleaned_rows, 100),
        foot: '<button class="btn" data-close>关闭</button><button class="btn btn-primary" id="jobExport">导出 Excel</button>',
        onMount: function (el) {
          $('#jobExport', el).addEventListener('click', function () {
            downloadFile('/api/excel/jobs/' + id + '/export', 'flowdesk-job-' + id + '.xlsx')
              .catch(function (e) { FD.toast(e.message, 'err'); });
          });
        }
      });
    } catch (e) { FD.toast(e.message, 'err'); }
  }

  /* ---------------- 文档抽取 ---------------- */
  function taskListHtml(data) {
    if (!data || !data.tasks || !data.tasks.length) {
      return emptyBox('队列为空', '选择多个文件加入队列后，可在这里看到进度。');
    }
    return data.tasks.map(function (t) {
      var active = t.status === 'processing' || t.status === 'pending';
      var actions = '';
      if (t.status === 'done') actions += '<button class="btn btn-sm" data-task-view="' + t.id + '">查看结果</button>';
      if (t.status === 'failed' || t.status === 'canceled') actions += '<button class="btn btn-sm" data-task-retry="' + t.id + '">重试</button>';
      if (active) actions += '<button class="btn btn-sm btn-ghost" data-task-cancel="' + t.id + '">取消</button>';
      if (!active) actions += '<button class="btn btn-sm btn-danger" data-task-del="' + t.id + '">删除</button>';
      return '<div style="padding:11px 0;border-bottom:1px solid var(--line)">' +
        '<div class="row between" style="gap:10px"><div class="row" style="gap:8px;min-width:0">' +
          '<span class="avatar" style="width:26px;height:26px;font-size:9px">' + icon('file', 13) + '</span>' +
          '<div style="min-width:0"><b style="font-size:12.5px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px">' + FD.esc(t.filename) + '</b>' +
          '<span class="dim" style="font-size:10.5px">#' + t.id + ' · 尝试 ' + t.attempts + '/' + t.max_attempts + '</span></div>' +
        '</div>' + statusBadge('task', t.status) + '</div>' +
        (active ? '<div class="progress thin" style="margin:8px 0 4px"><i style="width:' + (t.progress || 0) + '%"></i></div>' : '') +
        (t.error ? '<div class="dim" style="font-size:10.5px;color:#fca5a5;margin-top:4px">' + FD.esc(t.error) + '</div>' : '') +
        '<div class="row end" style="gap:5px;margin-top:7px">' + actions + '</div>' +
      '</div>';
    }).join('');
  }

  function docsHistoryHtml(data) {
    if (!data || !data.jobs || !data.jobs.length) {
      return emptyBox('还没有抽取记录', '上传合同或粘贴文本，结果会保存在这里。');
    }
    return '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th style="width:34px"><input type="checkbox" id="docsCheckAll" /></th><th>文档</th><th>字段</th><th>大小</th><th>时间</th><th></th></tr></thead><tbody>' +
      data.jobs.map(function (j) {
        return '<tr><td><input type="checkbox" data-doc-check="' + j.id + '" ' + (state.docs.selected && state.docs.selected.has(j.id) ? 'checked' : '') + ' /></td>' +
          '<td><b>' + FD.esc(j.filename) + '</b></td>' +
          '<td><span class="chip">' + (j.fields.length || '自动') + ' 个</span></td>' +
          '<td class="dim">' + ((j.size || 0) / 1024).toFixed(1) + ' KB</td>' +
          '<td class="dim">' + FD.timeAgo(j.created_at) + '</td>' +
          '<td class="num"><div class="row end" style="gap:5px">' +
            '<button class="btn btn-sm" data-doc-view="' + j.id + '">查看</button>' +
            (j.file_id ? '<button class="btn btn-sm" data-doc-download="' + j.file_id + '">原文</button>' : '') +
            '<button class="btn btn-sm btn-danger" data-doc-del="' + j.id + '">删除</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div>' +
      pagerHtml(data.page, data.page_size, data.total);
  }

  function updateTasksUI(data) {
    var box = $('#taskList');
    if (box) box.innerHTML = taskListHtml(data);
    var counts = $('#taskCounts');
    if (counts && data) {
      var c = data.counts || {};
      counts.innerHTML =
        '<span class="badge amber">排队 ' + (c.pending || 0) + '</span>' +
        '<span class="badge cyan">处理 ' + (c.processing || 0) + '</span>' +
        '<span class="badge green">完成 ' + (c.done || 0) + '</span>' +
        (c.failed ? '<span class="badge red">失败 ' + c.failed + '</span>' : '');
    }
  }

  function bindDocsEvents(token) {
    var taskBox = $('#taskList');
    if (taskBox) {
      taskBox.addEventListener('click', function (e) {
        var viewBtn = e.target.closest('[data-task-view]');
        var retryBtn = e.target.closest('[data-task-retry]');
        var cancelBtn = e.target.closest('[data-task-cancel]');
        var delBtn = e.target.closest('[data-task-del]');
        if (viewBtn) viewTask(Number(viewBtn.dataset.taskView));
        if (retryBtn) taskAction(Number(retryBtn.dataset.taskRetry), 'retry');
        if (cancelBtn) taskAction(Number(cancelBtn.dataset.taskCancel), 'cancel');
        if (delBtn) deleteTask(Number(delBtn.dataset.taskDel));
      });
    }

    var history = $('#docsHistory');
    if (history) {
      history.addEventListener('click', function (e) {
        var viewBtn = e.target.closest('[data-doc-view]');
        var dlBtn = e.target.closest('[data-doc-download]');
        var delBtn = e.target.closest('[data-doc-del]');
        var pageBtn = e.target.closest('[data-page]');
        if (viewBtn) viewDocJob(Number(viewBtn.dataset.docView));
        if (dlBtn) downloadFile('/api/docs/files/' + dlBtn.dataset.docDownload + '/download', 'document').catch(function (err) { FD.toast(err.message, 'err'); });
        if (delBtn) deleteDocJob(Number(delBtn.dataset.docDel));
        if (pageBtn && !pageBtn.disabled) {
          state.docs.page = Number(pageBtn.dataset.page);
          refreshDocsHistory();
        }
      });
      history.addEventListener('change', function (e) {
        if (e.target.id === 'docsCheckAll') {
          state.docs.selected = new Set();
          $$('[data-doc-check]', history).forEach(function (cb) {
            cb.checked = e.target.checked;
            if (cb.checked) state.docs.selected.add(Number(cb.dataset.docCheck));
          });
        }
        if (e.target.matches('[data-doc-check]')) {
          var id = Number(e.target.dataset.docCheck);
          if (e.target.checked) state.docs.selected.add(id);
          else state.docs.selected.delete(id);
        }
      });
    }
  }

  async function refreshDocsHistory() {
    state.docs.jobs = await api('/api/docs/jobs?page=' + state.docs.page + '&page_size=8&q=' + encodeURIComponent(state.docs.q));
    var box = $('#docsHistory');
    if (box) box.innerHTML = docsHistoryHtml(state.docs.jobs);
  }

  async function refreshTasks(silent) {
    try {
      var data = await api('/api/docs/tasks');
      state.docs.tasks = data;
      updateTasksUI(data);
      return data;
    } catch (e) {
      if (!silent) FD.toast(e.message, 'err');
      return null;
    }
  }

  function startDocsPolling() {
    if (state.docs.polling) clearTimeout(state.docs.polling);
    var tick = async function () {
      if (state.route !== 'docs') return;
      var data = await refreshTasks(true);
      var active = data && data.tasks.some(function (t) { return t.status === 'pending' || t.status === 'processing'; });
      if (active) {
        state.docs.polling = setTimeout(tick, 1800);
      } else {
        state.docs.polling = null;
        // 队列完成后再刷新一次历史
        await refreshDocsHistory().catch(function () {});
      }
    };
    state.docs.polling = setTimeout(tick, 600);
  }

  async function renderDocs(token) {
    var results = await Promise.all([
      state.docs.jobs ? Promise.resolve(state.docs.jobs) : api('/api/docs/jobs?page=' + state.docs.page + '&page_size=8&q=' + encodeURIComponent(state.docs.q)),
      state.docs.tasks ? Promise.resolve(state.docs.tasks) : api('/api/docs/tasks'),
      api('/api/docs/files/stats').catch(function () { return { files: 0, bytes: 0 }; })
    ]);
    if (token !== state.renderToken) return;
    state.docs.jobs = results[0];
    state.docs.tasks = results[1];
    var fileStats = results[2];
    var tasks = results[1];
    var job = state.docs.job;
    var queuedFiles = state.docs.queueFiles || [];
    state.docs.selected = state.docs.selected || new Set();

    view.innerHTML =
      '<div class="page-head">' +
        '<div><h1>文档字段抽取</h1><p>合同、邮件、PDF、Word 一次抽取关键字段；支持批量队列、失败重试与多文档对齐导出。</p></div>' +
        '<div class="row"><span class="chip">' + fileStats.files + ' 个原始文件 · ' + (fileStats.bytes / 1024 / 1024).toFixed(1) + ' MB</span>' +
        '<button class="btn btn-sm" id="docsRefresh">' + icon('refresh', 14) + ' 刷新</button></div>' +
      '</div>' +

      '<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">' +
        '<div class="card pad">' +
          '<div class="section-head"><h3>单文件 / 粘贴文本</h3><span class="badge cyan">同步提取</span></div>' +
          fileDropHtml('docDrop', '拖入合同 / PDF / Word', '支持 txt / md / csv / pdf / docx / xlsx', '.txt,.md,.csv,.pdf,.docx,.xlsx,.xls') +
          '<div class="row center" style="margin:10px 0"><span class="dim" style="font-size:11px">或者直接粘贴文本</span></div>' +
          '<textarea id="docText" placeholder="粘贴合同、邮件或任意文本…" style="min-height:96px"></textarea>' +
          '<div class="mt-8"><label>提取字段（逗号分隔，留空则自动识别）</label>' +
          '<input id="docFields" value="甲方,乙方,合同金额,签订日期,联系电话" /></div>' +
          '<button class="btn btn-primary btn-block mt-16" id="docExtractBtn">开始提取</button>' +
        '</div>' +

        '<div class="card pad">' +
          '<div class="section-head"><h3>批量队列</h3><span id="taskCounts" class="row" style="gap:5px">' +
            '<span class="badge amber">排队 ' + (tasks.counts.pending || 0) + '</span>' +
            '<span class="badge cyan">处理 ' + (tasks.counts.processing || 0) + '</span>' +
            '<span class="badge green">完成 ' + (tasks.counts.done || 0) + '</span>' +
            (tasks.counts.failed ? '<span class="badge red">失败 ' + tasks.counts.failed + '</span>' : '') +
          '</span></div>' +
          fileDropHtml('queueDrop', '拖入多个文件，或点击选择', '一次最多 20 个文件；后台线程处理，可离开页面', '.txt,.md,.csv,.pdf,.docx,.xlsx,.xls', true) +
          '<div class="mt-8"><label>提取字段</label><input id="queueFields" value="甲方,乙方,合同金额,签订日期,联系电话" /></div>' +
          '<div class="row between mt-8"><label class="switch"><input type="checkbox" id="queuePriority"><span class="track"></span>高优先级</label>' +
          '<span class="dim" style="font-size:11.5px">' + (queuedFiles.length ? queuedFiles.length + ' 个待加入' : '未选择文件') + '</span></div>' +
          '<button class="btn btn-primary btn-block mt-8" id="queueBtn" ' + (queuedFiles.length ? '' : 'disabled') + '>加入队列</button>' +
          '<div class="divider"></div>' +
          '<div id="taskList" style="max-height:330px;overflow:auto">' + taskListHtml(tasks) + '</div>' +
        '</div>' +
      '</div>' +

      (job ?
        '<div class="card pad mt-24">' +
          '<div class="section-head"><div><h3>本次提取结果</h3><span class="dim" style="font-size:11.5px">' + FD.esc(job.filename) + ' · ' + FD.num(job.char_count) + ' 字符</span></div>' +
          '<div class="row"><span class="badge cyan">' + FD.esc(job.via_label) + '</span>' +
          '<button class="btn btn-sm" id="docExportOne">' + icon('download', 14) + ' 导出 Excel</button></div></div>' +
          '<div class="table-wrap"><table class="data"><thead><tr><th>字段</th><th>值</th><th>来源</th></tr></thead><tbody>' +
          job.results.map(function (r) {
            return '<tr><td><b>' + FD.esc(r.field) + '</b></td><td>' + FD.esc(r.value) + '</td><td><span class="chip">' + FD.esc(r.source) + '</span></td></tr>';
          }).join('') + '</tbody></table></div>' +
        '</div>' : '') +

      '<div class="card pad mt-24">' +
        '<div class="section-head"><h3>抽取历史</h3>' +
          '<div class="row" style="gap:8px">' +
          '<input id="docsSearch" placeholder="搜索文件名" value="' + FD.esc(state.docs.q) + '" style="width:180px;padding:7px 10px;font-size:12.5px" />' +
          '<button class="btn btn-sm" id="docsSearchBtn">' + icon('search', 14) + '</button>' +
          '<button class="btn btn-sm" id="docsExportSelected">导出所选</button></div></div>' +
        '<div id="docsHistory">' + docsHistoryHtml(state.docs.jobs) + '</div>' +
      '</div>';

    // 单文件
    bindDrop($('#docDrop'), function (files) {
      var fields = $('#docFields').value.trim();
      extractDoc(files[0], fields);
    });
    $('#docExtractBtn').addEventListener('click', function () {
      var text = $('#docText').value.trim();
      if (!text) { FD.toast('请粘贴文本或选择文件', 'warn'); return; }
      extractDoc(null, $('#docFields').value.trim(), text);
    });
    if (job) {
      $('#docExportOne').addEventListener('click', function () {
        downloadFile('/api/docs/export?ids=' + job.job_id, 'flowdesk-docs.xlsx').catch(function (e) { FD.toast(e.message, 'err'); });
      });
    }

    // 批量
    bindDrop($('#queueDrop'), function (files) {
      state.docs.queueFiles = files;
      renderRoute();
    });
    $('#queueBtn').addEventListener('click', function () { enqueueDocs(this); });

    // 历史
    $('#docsRefresh').addEventListener('click', function () { state.docs.jobs = null; state.docs.tasks = null; renderRoute(); });
    var search = function () {
      state.docs.q = $('#docsSearch').value.trim();
      state.docs.page = 1;
      refreshDocsHistory().catch(function (e) { FD.toast(e.message, 'err'); });
    };
    $('#docsSearchBtn').addEventListener('click', search);
    $('#docsSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
    $('#docsExportSelected').addEventListener('click', function () {
      if (!state.docs.selected || !state.docs.selected.size) { FD.toast('先勾选要导出的文档', 'warn'); return; }
      downloadFile('/api/docs/export?ids=' + Array.from(state.docs.selected).join(','), 'flowdesk-docs.xlsx')
        .catch(function (e) { FD.toast(e.message, 'err'); });
    });

    bindDocsEvents(token);
    if (tasks.tasks.some(function (t) { return t.status === 'pending' || t.status === 'processing'; })) startDocsPolling();
  }

  async function extractDoc(file, fields, text) {
    var btn = $('#docExtractBtn');
    setBusy(btn, true, '提取中…');
    try {
      var fd = new FormData();
      if (file) fd.append('file', file);
      if (text) fd.append('text', text);
      fd.append('fields', fields || '');
      var data = await api('/api/docs/extract', { method: 'POST', body: fd });
      state.docs.job = data;
      state.docs.jobs = null;
      FD.toast('提取完成（' + data.via_label + '）', 'ok');
      renderRoute();
    } catch (e) {
      FD.toast(e.message, 'err', 4200);
      setBusy(btn, false);
    }
  }

  async function enqueueDocs(btn) {
    var files = state.docs.queueFiles || [];
    if (!files.length) return;
    setBusy(btn, true, '加入中…');
    try {
      var fd = new FormData();
      files.forEach(function (f) { fd.append('files', f); });
      fd.append('fields', $('#queueFields').value.trim());
      fd.append('priority', $('#queuePriority').checked ? '10' : '0');
      var data = await api('/api/docs/enqueue', { method: 'POST', body: fd });
      state.docs.queueFiles = [];
      state.docs.jobs = null;
      FD.toast('已加入队列：' + data.accepted + ' 个文件', 'ok');
      await renderRoute();
      startDocsPolling();
    } catch (e) {
      FD.toast(e.message, 'err', 4200);
      setBusy(btn, false);
    }
  }

  async function taskAction(id, action) {
    try {
      await api('/api/docs/tasks/' + id + '/' + action, { method: 'POST' });
      FD.toast(action === 'retry' ? '已重新排队' : '已请求取消', 'ok');
      await refreshTasks();
      startDocsPolling();
    } catch (e) { FD.toast(e.message, 'err'); }
  }

  async function deleteTask(id) {
    if (!(await confirmBox('删除该队列任务？已生成的结果不会自动删除。', { danger: true, ok: '删除' }))) return;
    try {
      await api('/api/docs/tasks/' + id, { method: 'DELETE' });
      await refreshTasks();
      FD.toast('已删除', 'ok');
    } catch (e) { FD.toast(e.message, 'err'); }
  }

  async function viewTask(id) {
    try {
      var task = await api('/api/docs/tasks/' + id);
      if (!task.result) { FD.toast('任务还没有结果', 'warn'); return; }
      openModal({
        title: task.filename,
        wide: true,
        body: '<div class="row between mb-16"><span class="badge green">已完成</span><span class="dim">' + FD.num(task.result.char_count) + ' 字符 · ' + FD.esc(task.result.via) + '</span></div>' +
          '<div class="table-wrap"><table class="data"><thead><tr><th>字段</th><th>值</th><th>来源</th></tr></thead><tbody>' +
          task.result.results.map(function (r) {
            return '<tr><td><b>' + FD.esc(r.field) + '</b></td><td>' + FD.esc(r.value) + '</td><td><span class="chip">' + FD.esc(r.source) + '</span></td></tr>';
          }).join('') + '</tbody></table></div>',
        foot: '<button class="btn" data-close>关闭</button><button class="btn btn-primary" id="taskExport">导出</button>',
        onMount: function (el) {
          $('#taskExport', el).addEventListener('click', function () {
            downloadFile('/api/docs/export?ids=' + task.result.job_id, 'flowdesk-doc.xlsx').catch(function (e) { FD.toast(e.message, 'err'); });
          });
        }
      });
    } catch (e) { FD.toast(e.message, 'err'); }
  }

  async function viewDocJob(id) {
    try {
      var job = await api('/api/docs/jobs/' + id);
      openModal({
        title: job.filename,
        wide: true,
        body: '<div class="table-wrap"><table class="data"><thead><tr><th>字段</th><th>值</th><th>来源</th></tr></thead><tbody>' +
          job.results.map(function (r) {
            return '<tr><td><b>' + FD.esc(r.field) + '</b></td><td>' + FD.esc(r.value) + '</td><td><span class="chip">' + FD.esc(r.source) + '</span></td></tr>';
          }).join('') + '</tbody></table></div>' +
          (job.file_id ? '<div class="row mt-16"><button class="btn btn-sm" id="docOriginal">下载原始文件</button></div>' : ''),
        foot: '<button class="btn" data-close>关闭</button><button class="btn btn-primary" id="docExportJob">导出这份</button>',
        onMount: function (el) {
          $('#docExportJob', el).addEventListener('click', function () {
            downloadFile('/api/docs/export?ids=' + id, 'flowdesk-doc.xlsx').catch(function (e) { FD.toast(e.message, 'err'); });
          });
          var original = $('#docOriginal', el);
          if (original) original.addEventListener('click', function () {
            downloadFile('/api/docs/files/' + job.file_id + '/download', job.filename).catch(function (e) { FD.toast(e.message, 'err'); });
          });
        }
      });
    } catch (e) { FD.toast(e.message, 'err'); }
  }

  async function deleteDocJob(id) {
    if (!(await confirmBox('删除该抽取记录？原始文件仍会保留在文件库。', { danger: true, ok: '删除' }))) return;
    try {
      await api('/api/docs/jobs/' + id, { method: 'DELETE' });
      state.docs.jobs = null;
      FD.toast('已删除', 'ok');
      renderRoute();
    } catch (e) { FD.toast(e.message, 'err'); }
  }

  /* ---------------- 报价单 ---------------- */
  function quoteStatusTabs(status) {
    return '<div class="pill-tabs">' +
      ['', 'draft', 'sent', 'accepted'].map(function (s) {
        var label = s ? STATUS_LABEL[s] : '全部';
        return '<button class="' + (status === s ? 'on' : '') + '" data-status="' + s + '">' + label + '</button>';
      }).join('') + '</div>';
  }

  async function renderQuotes(token, rest) {
    if (rest && rest[0]) {
      if (rest[0] === 'new') return renderQuoteEditor(token, null);
      var maybeId = Number(rest[0]);
      if (maybeId) return renderQuoteEditor(token, maybeId);
    }
    return renderQuoteList(token);
  }

  async function renderQuoteList(token) {
    if (!state.quotes.list) {
      state.quotes.list = await api('/api/quotes?page=' + state.quotes.page + '&page_size=12&q=' +
        encodeURIComponent(state.quotes.q) + '&status=' + state.quotes.status);
    }
    if (token !== state.renderToken) return;
    var data = state.quotes.list;
    var pageTotal = data.quotes.reduce(function (sum, q) { return sum + q.total; }, 0);

    view.innerHTML =
      '<div class="page-head">' +
        '<div><h1>报价单</h1><p>条目化编辑、自动折扣与税额；一句话让 AI 拆解项目，支持打印和导出 PDF。</p></div>' +
        '<div class="row"><button class="btn btn-sm" id="quoteExportList">导出列表</button>' +
        '<a class="btn btn-primary btn-sm" href="#/quotes/new">' + icon('plus', 15) + ' 新建报价</a></div>' +
      '</div>' +

      '<div class="grid grid-4">' +
        '<div class="kpi p"><span class="label">报价单总数</span><b>' + data.total + '</b><div class="foot">当前工作区</div></div>' +
        '<div class="kpi g"><span class="label">当前页金额</span><b>¥' + FD.num(pageTotal, 2) + '</b><div class="foot">含税合计</div></div>' +
        '<div class="kpi a"><span class="label">已成交</span><b>' + data.quotes.filter(function (q) { return q.status === 'accepted'; }).length + '</b><div class="foot">当前页</div></div>' +
        '<div class="kpi c"><span class="label">已发送</span><b>' + data.quotes.filter(function (q) { return q.status === 'sent'; }).length + '</b><div class="foot">等待客户确认</div></div>' +
      '</div>' +

      '<div class="card pad mt-24">' +
        '<div class="section-head">' +
          quoteStatusTabs(state.quotes.status) +
          '<div class="row" style="gap:8px"><input id="quoteSearch" placeholder="搜索标题或客户" value="' + FD.esc(state.quotes.q) + '" style="width:200px;padding:7px 10px;font-size:12.5px" />' +
          '<button class="btn btn-sm" id="quoteSearchBtn">' + icon('search', 14) + '</button></div>' +
        '</div>' +
        (data.quotes.length ?
          '<div class="table-wrap"><table class="data"><thead><tr><th>报价单</th><th>客户</th><th class="num">合计</th><th>状态</th><th>更新时间</th><th></th></tr></thead><tbody>' +
          data.quotes.map(function (q) {
            return '<tr><td><a href="#/quotes/' + q.id + '"><b>' + FD.esc(q.title) + '</b></a><div class="dim" style="font-size:10.5px">#' + String(q.id).padStart(4, '0') + '</div></td>' +
              '<td>' + FD.esc(q.customer || '—') + '</td>' +
              '<td class="num"><b>' + CURRENCY[q.currency] + FD.num(q.total, 2) + '</b></td>' +
              '<td>' + statusBadge('quote', q.status) + '</td>' +
              '<td class="dim">' + FD.timeAgo(q.updated_at) + '</td>' +
              '<td class="num"><div class="row end" style="gap:5px">' +
                '<a class="btn btn-sm" href="#/quotes/' + q.id + '">编辑</a>' +
                '<button class="btn btn-sm" data-dup="' + q.id + '">复制</button>' +
                '<button class="btn btn-sm btn-danger" data-del-quote="' + q.id + '">删除</button>' +
              '</div></td></tr>';
          }).join('') + '</tbody></table></div>' + pagerHtml(data.page, data.page_size, data.total)
          : emptyBox('还没有报价单', '新建一份报价单，或让 AI 用一句话生成条目。')) +
      '</div>';

    var search = function () {
      state.quotes.q = $('#quoteSearch').value.trim();
      state.quotes.page = 1;
      state.quotes.list = null;
      renderRoute();
    };
    $('#quoteSearchBtn').addEventListener('click', search);
    $('#quoteSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
    $$('[data-status]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.quotes.status = btn.dataset.status;
        state.quotes.page = 1;
        state.quotes.list = null;
        renderRoute();
      });
    });
    bindPager(view, function (page) {
      state.quotes.page = page;
      state.quotes.list = null;
      renderRoute();
    });
    $$('[data-dup]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        try {
          var res = await api('/api/quotes/' + btn.dataset.dup + '/duplicate', { method: 'POST' });
          state.quotes.list = null;
          FD.toast('已创建副本', 'ok');
          if (res.id) location.hash = '#/quotes/' + res.id;
          else renderRoute();
        } catch (e) { FD.toast(e.message, 'err'); }
      });
    });
    $$('[data-del-quote]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!(await confirmBox('删除这份报价单？该操作不可恢复。', { danger: true, ok: '删除' }))) return;
        try {
          await api('/api/quotes/' + btn.dataset.delQuote, { method: 'DELETE' });
          state.quotes.list = null;
          FD.toast('已删除', 'ok');
          renderRoute();
        } catch (e) { FD.toast(e.message, 'err'); }
      });
    });
    $('#quoteExportList').addEventListener('click', function () {
      var rows = [['编号', '标题', '客户', '币种', '小计', '折扣', '税', '合计', '状态', '更新时间']];
      data.quotes.forEach(function (q) {
        rows.push([q.id, q.title, q.customer || '', q.currency, q.subtotal, q.discount, q.tax, q.total, STATUS_LABEL[q.status] || q.status, q.updated_at]);
      });
      var csv = '\uFEFF' + rows.map(function (r) {
        return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\n');
      FD.download('flowdesk-quotes.csv', csv, 'text/csv;charset=utf-8');
    });
  }

  function defaultQuote() {
    return {
      id: null, title: '未命名报价单', customer: '', currency: 'CNY',
      tax_rate: 6, discount_rate: 0, note: '报价有效期 30 天；签约后 3 个工作日内启动。',
      status: 'draft',
      items: [{ name: '项目服务', unit: '项', qty: 1, price: 0 }]
    };
  }

  function computeQuote(draft) {
    var subtotal = 0;
    (draft.items || []).forEach(function (it) {
      subtotal += (Number(it.qty) || 0) * (Number(it.price) || 0);
    });
    var discountRate = Math.min(100, Math.max(0, Number(draft.discount_rate) || 0));
    var taxRate = Math.min(100, Math.max(0, Number(draft.tax_rate) || 0));
    var discount = subtotal * discountRate / 100;
    var after = subtotal - discount;
    var tax = after * taxRate / 100;
    return { subtotal: subtotal, discount: discount, tax: tax, total: after + tax };
  }

  function itemRowHtml(it, index) {
    return '<div class="item-editor" data-item="' + index + '">' +
      '<input data-f="name" value="' + FD.esc(it.name || '') + '" placeholder="项目名称" />' +
      '<input class="unit" data-f="unit" value="' + FD.esc(it.unit || '项') + '" placeholder="单位" />' +
      '<input data-f="qty" type="number" min="0" step="1" value="' + FD.esc(it.qty == null ? 1 : it.qty) + '" placeholder="数量" />' +
      '<input data-f="price" type="number" min="0" step="0.01" value="' + FD.esc(it.price == null ? 0 : it.price) + '" placeholder="单价" />' +
      '<div class="amt" data-amt>¥0.00</div>' +
      '<button class="rm" data-rm title="删除条目">✕</button>' +
    '</div>';
  }

  async function renderQuoteEditor(token, id) {
    var draft;
    if (id) {
      try {
        var quote = await api('/api/quotes/' + id);
        draft = {
          id: quote.id, title: quote.title, customer: quote.customer || '', currency: quote.currency,
          tax_rate: quote.tax_rate, discount_rate: quote.discount_rate, note: quote.note || '',
          status: quote.status,
          items: (quote.items && quote.items.length) ? quote.items : [{ name: '项目服务', unit: '项', qty: 1, price: 0 }]
        };
      } catch (e) {
        view.innerHTML = errorBox(e.message);
        return;
      }
    } else {
      draft = defaultQuote();
    }
    if (token !== state.renderToken) return;
    state.quotes.draft = draft;
    state.quotes.editing = id;
    var number = 'FD-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(id || 1).padStart(3, '0');
    var today = new Date();
    var valid = new Date(today.getTime() + 30 * 86400000);
    var dateText = today.toLocaleDateString('zh-CN');
    var validText = valid.toLocaleDateString('zh-CN');
    var sym = CURRENCY[draft.currency] || '¥';

    view.innerHTML =
      '<div class="page-head no-print">' +
        '<div><h1>' + (id ? '编辑报价单' : '新建报价单') + '</h1><p>左侧编辑条目，右侧实时预览；保存后会写入工作区历史。</p></div>' +
        '<div class="row"><a class="btn btn-sm" href="#/quotes">← 返回列表</a>' +
        '<button class="btn btn-sm" id="printQuote">打印 / PDF</button>' +
        '<button class="btn btn-primary btn-sm" id="saveQuote">保存报价单</button></div>' +
      '</div>' +

      '<div class="quote-layout">' +
        '<div class="card pad no-print">' +
          '<div class="form-grid">' +
            '<div><label>报价单标题</label><input id="qTitle" value="' + FD.esc(draft.title) + '" maxlength="80" /></div>' +
            '<div><label>客户名称</label><input id="qCustomer" value="' + FD.esc(draft.customer) + '" placeholder="例如：星野咖啡（北京）有限公司" /></div>' +
            '<div class="form-grid cols-3">' +
              '<div><label>币种</label><select id="qCurrency">' +
                Object.keys(CURRENCY).map(function (c) { return '<option value="' + c + '" ' + (c === draft.currency ? 'selected' : '') + '>' + c + ' ' + CURRENCY[c] + '</option>'; }).join('') +
              '</select></div>' +
              '<div><label>税率 %</label><input id="qTax" type="number" min="0" max="100" step="0.1" value="' + draft.tax_rate + '" /></div>' +
              '<div><label>折扣 %</label><input id="qDiscount" type="number" min="0" max="100" step="0.1" value="' + draft.discount_rate + '" /></div>' +
            '</div>' +
            '<div><label>状态</label><select id="qStatus">' +
              Object.keys(STATUS_LABEL).map(function (s) { return '<option value="' + s + '" ' + (s === draft.status ? 'selected' : '') + '>' + STATUS_LABEL[s] + '</option>'; }).join('') +
            '</select></div>' +
          '</div>' +

          '<div class="divider"></div>' +
          '<div class="section-head"><h3 style="font-size:14px">报价条目</h3><button class="btn btn-sm" id="addItem">' + icon('plus', 13) + ' 添加</button></div>' +
          '<div id="itemsBox">' + draft.items.map(itemRowHtml).join('') + '</div>' +
          '<div class="row between mt-8"><span class="dim" style="font-size:11.5px">数量 × 单价 = 金额</span><b id="editorSubtotal" class="mono">' + sym + '0.00</b></div>' +

          '<div class="divider"></div>' +
          '<div class="section-head"><h3 style="font-size:14px">AI 拆解</h3><span class="badge cyan">一句话生成</span></div>' +
          '<textarea id="aiBrief" placeholder="例如：客户要一个品牌官网 + Excel 销售汇总工具 + 服务器部署，预算 1 万左右"></textarea>' +
          '<button class="btn btn-primary btn-block mt-8" id="aiQuoteBtn">' + icon('spark', 14) + ' 生成报价条目</button>' +

          '<div class="divider"></div>' +
          '<div><label>备注</label><textarea id="qNote" style="min-height:70px">' + FD.esc(draft.note) + '</textarea></div>' +
        '</div>' +

        '<div class="paper" id="quotePaper">' +
          '<div class="q-head">' +
            '<div><div class="brandline"><span class="avatar" style="width:26px;height:26px;font-size:11px">F</span> FlowDesk 流序</div>' +
            '<h1>报价单</h1><div style="font-size:10px;letter-spacing:.2em;color:#8a93ad">QUOTATION</div></div>' +
            '<div class="meta"><div>编号：' + number + '</div><div>日期：' + dateText + '</div><div>有效期至：' + validText + '</div></div>' +
          '</div>' +
          '<div class="parties">' +
            '<div><h4>报价方</h4><b>' + FD.esc(state.me.workspace.name) + '</b><div style="color:#5b6377">通过 FlowDesk 生成</div></div>' +
            '<div><h4>客户</h4><b id="paperCustomer">' + FD.esc(draft.customer || '（待填写）') + '</b><div style="color:#5b6377">客户方</div></div>' +
          '</div>' +
          '<table><thead><tr><th>项目</th><th>单位</th><th style="text-align:right">数量</th><th style="text-align:right">单价</th><th style="text-align:right">金额</th></tr></thead>' +
          '<tbody id="paperItems"></tbody></table>' +
          '<div class="totals" id="paperTotals"></div>' +
          '<div class="note" id="paperNote"></div>' +
          '<div class="sign"><div>报价方签章</div><div>客户确认</div></div>' +
        '</div>' +
      '</div>';

    function readDom() {
      var items = $$('#itemsBox .item-editor').map(function (row) {
        return {
          name: $('[data-f=name]', row).value.trim(),
          unit: $('[data-f=unit]', row).value.trim() || '项',
          qty: Number($('[data-f=qty]', row).value) || 0,
          price: Number($('[data-f=price]', row).value) || 0
        };
      }).filter(function (it) { return it.name; });
      return {
        title: $('#qTitle').value.trim() || '未命名报价单',
        customer: $('#qCustomer').value.trim(),
        currency: $('#qCurrency').value,
        tax_rate: Number($('#qTax').value) || 0,
        discount_rate: Number($('#qDiscount').value) || 0,
        note: $('#qNote').value,
        status: $('#qStatus').value,
        items: items
      };
    }

    function recalc() {
      var current = readDom();
      var calc = computeQuote(current);
      var symbol = CURRENCY[current.currency] || '¥';
      $('#editorSubtotal').textContent = symbol + FD.num(calc.subtotal, 2);
      $$('#itemsBox .item-editor').forEach(function (row) {
        var qty = Number($('[data-f=qty]', row).value) || 0;
        var price = Number($('[data-f=price]', row).value) || 0;
        $('[data-amt]', row).textContent = symbol + FD.num(qty * price, 2);
      });
      $('#paperItems').innerHTML = current.items.map(function (it) {
        return '<tr><td>' + FD.esc(it.name) + '</td><td>' + FD.esc(it.unit) + '</td>' +
          '<td style="text-align:right">' + it.qty + '</td>' +
          '<td style="text-align:right">' + symbol + FD.num(it.price, 2) + '</td>' +
          '<td style="text-align:right">' + symbol + FD.num(it.qty * it.price, 2) + '</td></tr>';
      }).join('') || '<tr><td colspan="5" style="color:#8a93ad">暂无条目</td></tr>';
      $('#paperTotals').innerHTML =
        '<div class="r"><span>小计</span><span>' + symbol + FD.num(calc.subtotal, 2) + '</span></div>' +
        (calc.discount ? '<div class="r"><span>折扣（' + current.discount_rate + '%）</span><span>-' + symbol + FD.num(calc.discount, 2) + '</span></div>' : '') +
        '<div class="r"><span>税额（' + current.tax_rate + '%）</span><span>' + symbol + FD.num(calc.tax, 2) + '</span></div>' +
        '<div class="r grand"><span>合计</span><span>' + symbol + FD.num(calc.total, 2) + '</span></div>';
      $('#paperCustomer').textContent = current.customer || '（待填写）';
      $('#paperNote').textContent = current.note || '';
      state.quotes.draft = Object.assign({ id: id }, current);
    }

    function bindItems() {
      $$('#itemsBox [data-rm]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var row = btn.closest('.item-editor');
          var items = readDom().items;
          var index = Number(row.dataset.item);
          items.splice(index, 1);
          if (!items.length) items = [{ name: '', unit: '项', qty: 1, price: 0 }];
          $('#itemsBox').innerHTML = items.map(itemRowHtml).join('');
          bindItems();
          recalc();
        });
      });
      $$('#itemsBox input').forEach(function (input) {
        input.addEventListener('input', recalc);
      });
    }

    $('#addItem').addEventListener('click', function () {
      var current = readDom();
      current.items.push({ name: '', unit: '项', qty: 1, price: 0 });
      $('#itemsBox').innerHTML = current.items.map(itemRowHtml).join('');
      bindItems();
      recalc();
      var rows = $$('#itemsBox .item-editor');
      var last = rows[rows.length - 1];
      if (last) $('[data-f=name]', last).focus();
    });

    ['qTitle', 'qCustomer', 'qCurrency', 'qTax', 'qDiscount', 'qNote', 'qStatus'].forEach(function (field) {
      var el = $('#' + field);
      if (el) {
        el.addEventListener('input', recalc);
        el.addEventListener('change', recalc);
      }
    });
    bindItems();
    recalc();

    $('#aiQuoteBtn').addEventListener('click', async function () {
      var brief = $('#aiBrief').value.trim();
      if (brief.length < 4) { FD.toast('先用一句话描述客户需求', 'warn'); return; }
      setBusy(this, true, '生成中…');
      try {
        var data = await api('/api/quotes/ai/generate', { method: 'POST', body: JSON.stringify({ brief: brief }) });
        var current = readDom();
        current.items = data.items;
        $('#itemsBox').innerHTML = current.items.map(itemRowHtml).join('');
        bindItems();
        recalc();
        FD.toast('已生成 ' + data.items.length + ' 条（' + data.via_label + '）', 'ok');
        setBusy(this, false);
      } catch (e) {
        FD.toast(e.message, 'err');
        setBusy(this, false);
      }
    });

    $('#saveQuote').addEventListener('click', async function () {
      var current = readDom();
      if (!current.items.length) { FD.toast('至少需要一个报价条目', 'warn'); return; }
      setBusy(this, true, '保存中…');
      try {
        if (id) {
          await api('/api/quotes/' + id, { method: 'PATCH', body: JSON.stringify(current) });
        } else {
          await api('/api/quotes', { method: 'POST', body: JSON.stringify(current) });
        }
        state.quotes.list = null;
        FD.toast('报价单已保存', 'ok');
        location.hash = '#/quotes';
      } catch (e) {
        FD.toast(e.message, 'err');
        setBusy(this, false);
      }
    });

    $('#printQuote').addEventListener('click', function () {
      document.title = draft.title + ' · 报价单';
      window.print();
      setTimeout(function () { document.title = '报价单 · FlowDesk 流序'; }, 800);
    });
  }

  /* ---------------- 销售看板 ---------------- */
  async function renderAnalytics(token) {
    if (!state.analytics.jobs) {
      state.analytics.jobs = await api('/api/analytics/jobs?page=1&page_size=10');
    }
    if (token !== state.renderToken) return;
    var ds = state.analytics.dataset;
    var result = state.analytics.result;
    var insight = state.analytics.insight;
    var jobId = state.analytics.jobId;
    var headers = ds ? ds.headers : [];
    var suggested = ds ? (ds.suggested || { columns: [] }) : { columns: [] };
    var columns = suggested.columns || [];
    var numeric = columns.filter(function (c) { return c.type === 'number'; });

    view.innerHTML =
      '<div class="page-head">' +
        '<div><h1>销售数据看板</h1><p>上传销售明细，自动识别日期、分类与金额；生成 KPI、趋势、占比和 AI 经营洞察。</p></div>' +
        '<div class="row"><button class="btn btn-sm" id="sampleSales">下载示例数据</button></div>' +
      '</div>' +

      '<div class="card pad">' +
        (ds ?
          '<div class="row between"><div class="row" style="gap:10px"><span class="avatar">' + icon('analytics', 16) + '</span>' +
            '<div><b>' + FD.esc(ds.filename) + '</b><div class="dim" style="font-size:11.5px">' + FD.num(ds.row_count) + ' 行 · ' + headers.length + ' 列' + (ds.truncated ? ' · 已截断至 2 万行' : '') + '</div></div></div>' +
            '<div class="row"><span class="badge green">已就绪</span><button class="btn btn-sm" id="resetAnalytics">重新上传</button></div></div>'
          : fileDropHtml('analyticsDrop', '拖入销售明细 Excel / CSV', '支持 .xlsx / .xls / .csv，单文件不超过 15 MB', '.xlsx,.xls,.csv')) +
      '</div>' +

      (ds ?
        '<div class="card pad mt-24">' +
          '<div class="section-head"><h3>分析配置</h3><span class="badge gray">列已自动识别</span></div>' +
          '<div class="form-grid cols-4">' +
            '<div><label>日期列</label><select id="anDate"><option value="">不使用日期</option>' +
              headers.map(function (h) { return '<option value="' + FD.esc(h) + '" ' + (h === suggested.date ? 'selected' : '') + '>' + FD.esc(h) + '</option>'; }).join('') + '</select></div>' +
            '<div><label>分类列</label><select id="anCategory"><option value="">不分类</option>' +
              headers.map(function (h) { return '<option value="' + FD.esc(h) + '" ' + (h === suggested.category ? 'selected' : '') + '>' + FD.esc(h) + '</option>'; }).join('') + '</select></div>' +
            '<div><label>金额列</label><select id="anAmount"><option value="">按记录数统计</option>' +
              numeric.map(function (c) { return '<option value="' + FD.esc(c.name) + '" ' + (c.name === suggested.amount ? 'selected' : '') + '>' + FD.esc(c.name) + '</option>'; }).join('') + '</select></div>' +
            '<div><label>Top N 分类</label><select id="anTop"><option value="0">全部</option><option value="5">Top 5</option><option value="8">Top 8</option><option value="10">Top 10</option><option value="15">Top 15</option></select></div>' +
          '</div>' +
          '<div class="form-grid cols-4 mt-8">' +
            '<div><label>开始日期</label><input id="anStart" type="date" /></div>' +
            '<div><label>结束日期</label><input id="anEnd" type="date" /></div>' +
            '<div style="display:flex;align-items:flex-end"><button class="btn btn-primary btn-block" id="analyzeBtn">' + icon('play', 14) + ' 生成看板</button></div>' +
            '<div style="display:flex;align-items:flex-end"><button class="btn btn-ghost btn-block" id="analyticsHistoryBtn">查看历史</button></div>' +
          '</div>' +
        '</div>' : '') +

      (result ?
        '<div class="mt-24" id="analyticsResult">' +
          '<div class="grid grid-4">' +
            '<div class="kpi p"><span class="label">总销售额</span><b>¥' + FD.num(result.kpis.total, 2) + '</b><div class="foot">' + (result.kpis.days ? result.kpis.days + ' 天数据' : '全部记录') + '</div></div>' +
            '<div class="kpi g"><span class="label">订单 / 记录数</span><b>' + FD.num(result.kpis.orders) + '</b><div class="foot">参与分析的行</div></div>' +
            '<div class="kpi c"><span class="label">平均客单价</span><b>¥' + FD.num(result.kpis.avg, 2) + '</b><div class="foot">销售额 ÷ 记录数</div></div>' +
            '<div class="kpi a"><span class="label">最高单日</span><b style="font-size:19px">' + FD.esc(result.kpis.best_day.date) + '</b><div class="foot">¥' + FD.num(result.kpis.best_day.value, 0) + '</div></div>' +
          '</div>' +
          '<div class="grid mt-24" style="grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr)">' +
            '<div class="card pad"><div class="section-head"><h3>销售趋势</h3><span class="chip">按日汇总</span></div>' +
              '<div class="chart-box"><canvas id="anLine"></canvas></div></div>' +
            '<div class="card pad"><div class="section-head"><h3>分类占比</h3><span class="chip">' + FD.esc(result.columns.category || '全部') + '</span></div>' +
              '<div class="chart-box"><canvas id="anDonut"></canvas></div></div>' +
          '</div>' +
          '<div class="grid mt-24" style="grid-template-columns:minmax(0,1.4fr) minmax(320px,1fr)">' +
            '<div class="card pad"><div class="section-head"><h3>AI 经营洞察</h3><span class="badge cyan">' + (insight ? '已生成' : '待生成') + '</span></div>' +
              (insight ? '<div class="insight">' + FD.esc(insight) + '</div>' :
                '<div class="empty" style="padding:24px"><b>还没有洞察</b><span>点击右侧按钮，让 AI 基于真实汇总数据给结论。</span></div>') +
              '<button class="btn btn-primary mt-16" id="insightBtn">' + icon('spark', 14) + ' ' + (insight ? '重新生成洞察' : '生成经营洞察') + '</button></div>' +
            '<div class="card pad"><div class="section-head"><h3>导出</h3></div>' +
              '<p class="dim" style="font-size:12px">导出包含分类汇总、趋势和明细三个工作表。</p>' +
              '<button class="btn btn-block" id="anExportXlsx">' + icon('download', 14) + ' 导出 Excel</button>' +
              '<button class="btn btn-block mt-8" id="anExportCsv">导出分类 CSV</button>' +
              '<div class="divider"></div>' +
              '<div class="kv" style="grid-template-columns:80px 1fr;font-size:12px">' +
                '<dt>日期列</dt><dd>' + FD.esc(result.columns.date || '—') + '</dd>' +
                '<dt>分类列</dt><dd>' + FD.esc(result.columns.category || '—') + '</dd>' +
                '<dt>金额列</dt><dd>' + FD.esc(result.columns.amount || '记录数') + '</dd>' +
                '<dt>明细行</dt><dd>' + FD.num(result.row_count) + '</dd>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="card pad mt-24"><div class="section-head"><h3>分类明细</h3><span class="chip">' + result.categories.length + ' 组</span></div>' +
            '<div class="table-wrap"><table class="data"><thead><tr><th>分类</th><th class="num">金额</th><th class="num">占比</th></tr></thead><tbody>' +
            result.categories.map(function (c) {
              return '<tr><td><b>' + FD.esc(c.name) + '</b></td><td class="num">¥' + FD.num(c.value, 2) + '</td><td class="num">' + c.percent + '%</td></tr>';
            }).join('') + '</tbody></table></div></div>' +
          '<div class="card pad mt-24"><div class="section-head"><h3>数据预览</h3><span class="chip">前 100 行</span></div>' +
            dataTable(result.preview.headers, result.preview.rows, 100) + '</div>' +
        '</div>' : '') +

      '<div class="card pad mt-24">' +
        '<div class="section-head"><h3>分析历史</h3><span class="dim" style="font-size:11.5px">共 ' + state.analytics.jobs.total + ' 条</span></div>' +
        (state.analytics.jobs.jobs.length ?
          '<div class="table-wrap"><table class="data"><thead><tr><th>数据文件</th><th class="num">销售额</th><th class="num">记录</th><th>时间</th><th></th></tr></thead><tbody>' +
          state.analytics.jobs.jobs.map(function (j) {
            return '<tr><td><b>' + FD.esc(j.filename) + '</b></td>' +
              '<td class="num">¥' + FD.num((j.kpis || {}).total || 0, 2) + '</td>' +
              '<td class="num">' + FD.num((j.kpis || {}).orders || 0) + '</td>' +
              '<td class="dim">' + FD.timeAgo(j.created_at) + '</td>' +
              '<td class="num"><div class="row end" style="gap:5px">' +
                '<button class="btn btn-sm" data-an-open="' + j.id + '">打开</button>' +
                '<button class="btn btn-sm" data-an-export="' + j.id + '">导出</button>' +
                '<button class="btn btn-sm btn-danger" data-an-del="' + j.id + '">删除</button>' +
              '</div></td></tr>';
          }).join('') + '</tbody></table></div>'
          : emptyBox('还没有分析记录', '上传销售明细，生成第一张看板。')) +
      '</div>';

    // 上传
    bindDrop($('#analyticsDrop'), function (files) { uploadAnalytics(files[0]); });
    $('#sampleSales').addEventListener('click', function () {
      var lines = ['日期,门店,商品,数量,金额'];
      var stores = ['北京店', '上海店', '广州店', '成都店'];
      var goods = [['拿铁', 30], ['美式', 26], ['蛋糕', 38], ['轻食', 45]];
      var seed = 7;
      function rnd() { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed / 0x7FFFFFFF; }
      for (var d = 0; d < 14; d++) {
        var day = new Date(Date.now() - (13 - d) * 86400000).toISOString().slice(0, 10);
        stores.forEach(function (s) {
          for (var k = 0; k < 2; k++) {
            var g = goods[Math.floor(rnd() * goods.length)];
            var qty = 1 + Math.floor(rnd() * 4);
            lines.push(day + ',' + s + ',' + g[0] + ',' + qty + ',' + (qty * (g[1] + Math.floor(rnd() * 12))));
          }
        });
      }
      FD.download('flowdesk-sales-sample.csv', '\uFEFF' + lines.join('\n'), 'text/csv;charset=utf-8');
    });

    if ($('#analyticsHistoryBtn')) {
      $('#analyticsHistoryBtn').addEventListener('click', function () {
        document.querySelector('.card:last-child') && $('.card:last-child').scrollIntoView({ behavior: 'smooth' });
      });
    }

    if (ds) {
      $('#resetAnalytics').addEventListener('click', function () {
        state.analytics = { dataset: null, result: null, jobId: null, insight: null, jobs: state.analytics.jobs };
        renderRoute();
      });
      $('#analyzeBtn').addEventListener('click', function () { analyzeSales(this); });
      if (result) {
        $('#insightBtn').addEventListener('click', function () { generateInsight(this); });
        $('#anExportXlsx').addEventListener('click', function () {
          if (!jobId) { FD.toast('请先生成看板', 'warn'); return; }
          downloadFile('/api/analytics/jobs/' + jobId + '/export?format=xlsx', 'flowdesk-analytics.xlsx').catch(function (e) { FD.toast(e.message, 'err'); });
        });
        $('#anExportCsv').addEventListener('click', function () {
          if (!jobId) { FD.toast('请先生成看板', 'warn'); return; }
          downloadFile('/api/analytics/jobs/' + jobId + '/export?format=csv', 'flowdesk-analytics.csv').catch(function (e) { FD.toast(e.message, 'err'); });
        });

        var series = result.series || [];
        lineChart('anLine', series.map(function (x) { return x.date.slice(5); }), series.map(function (x) { return x.value; }), '销售额');
        doughnutChart('anDonut', result.categories.map(function (c) { return c.name; }), result.categories.map(function (c) { return c.value; }));
      }
    }

    $$('[data-an-open]').forEach(function (btn) {
      btn.addEventListener('click', function () { openAnalyticsJob(Number(btn.dataset.anOpen)); });
    });
    $$('[data-an-export]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        downloadFile('/api/analytics/jobs/' + btn.dataset.anExport + '/export?format=xlsx', 'flowdesk-analytics.xlsx').catch(function (e) { FD.toast(e.message, 'err'); });
      });
    });
    $$('[data-an-del]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!(await confirmBox('删除这条分析记录？', { danger: true, ok: '删除' }))) return;
        try {
          await api('/api/analytics/jobs/' + btn.dataset.anDel, { method: 'DELETE' });
          state.analytics.jobs = null;
          FD.toast('已删除', 'ok');
          renderRoute();
        } catch (e) { FD.toast(e.message, 'err'); }
      });
    });
  }

  async function uploadAnalytics(file) {
    if (!file) return;
    var drop = $('#analyticsDrop');
    if (drop) drop.innerHTML = '<div class="spin-lg"></div><b>正在解析数据…</b>';
    var fd = new FormData();
    fd.append('file', file);
    try {
      var data = await api('/api/analytics/upload', { method: 'POST', body: fd });
      state.analytics.dataset = data;
      state.analytics.result = null;
      state.analytics.jobId = null;
      state.analytics.insight = null;
      FD.toast('已识别列：' + (data.suggested.date || '无日期') + ' / ' + (data.suggested.category || '无分类') + ' / ' + (data.suggested.amount || '无金额'), 'ok', 4000);
      renderRoute();
    } catch (e) {
      FD.toast(e.message, 'err', 4200);
      renderRoute();
    }
  }

  async function analyzeSales(btn) {
    if (!state.analytics.dataset) return;
    setBusy(btn, true, '计算中…');
    try {
      var config = {
        date: $('#anDate').value,
        category: $('#anCategory').value,
        amount: $('#anAmount').value,
        top_n: Number($('#anTop').value) || 0,
        start: $('#anStart').value,
        end: $('#anEnd').value
      };
      var data = await api('/api/analytics/analyze', {
        method: 'POST',
        body: JSON.stringify({ dataset_id: state.analytics.dataset.dataset_id, config: config })
      });
      state.analytics.result = data.result;
      state.analytics.jobId = data.job_id;
      state.analytics.insight = null;
      state.analytics.jobs = null;
      FD.toast('看板已生成', 'ok');
      renderRoute();
    } catch (e) {
      FD.toast(e.message, 'err', 4200);
      setBusy(btn, false);
    }
  }

  async function generateInsight(btn) {
    if (!state.analytics.jobId) return;
    setBusy(btn, true, '分析中…');
    try {
      var data = await api('/api/analytics/insight', {
        method: 'POST', body: JSON.stringify({ job_id: state.analytics.jobId })
      });
      state.analytics.insight = data.insight;
      state.analytics.jobs = null;
      FD.toast('洞察已生成（' + data.via_label + '）', 'ok');
      renderRoute();
    } catch (e) {
      FD.toast(e.message, 'err');
      setBusy(btn, false);
    }
  }

  async function openAnalyticsJob(id) {
    try {
      var job = await api('/api/analytics/jobs/' + id);
      var result = job.result || {};
      var headers = (result.preview && result.preview.headers) || [];
      state.analytics.dataset = {
        dataset_id: job.dataset_id, filename: job.filename, row_count: result.row_count || 0,
        headers: headers, suggested: {
          date: (result.columns || {}).date || '', category: (result.columns || {}).category || '',
          amount: (result.columns || {}).amount || '',
          columns: headers.map(function (h, i) { return { index: i, name: h, type: 'text' }; })
        }
      };
      // 金额列需要保留数值候选
      var amountName = (result.columns || {}).amount;
      state.analytics.dataset.suggested.columns.forEach(function (c) {
        if (c.name === amountName) c.type = 'number';
      });
      state.analytics.result = result;
      state.analytics.jobId = id;
      state.analytics.insight = job.insight || null;
      renderRoute();
    } catch (e) { FD.toast(e.message, 'err'); }
  }

  /* ---------------- 计费 ---------------- */
  async function refreshMe() {
    state.me = await api('/api/auth/me');
    syncShell();
  }

  async function renderBilling(token) {
    var data = await api('/api/billing/summary');
    if (token !== state.renderToken) return;
    var cycle = state.billingCycle || 'monthly';
    var current = data.plan.key;
    var usage = data.usage;
    var isOwner = state.me.workspace.role === 'owner' || state.me.user.is_admin;
    var runs = usage.runs;

    view.innerHTML =
      '<div class="page-head">' +
        '<div><h1>用量与计费</h1><p>任务次数、存储与成员席位实时计量。演示环境为沙箱计费，不会产生真实扣款。</p></div>' +
        '<div class="tabs"><button class="' + (cycle === 'monthly' ? 'on' : '') + '" data-cycle="monthly">按月</button><button class="' + (cycle === 'yearly' ? 'on' : '') + '" data-cycle="yearly">按年</button></div>' +
      '</div>' +

      '<div class="card pad" style="border-color:rgba(245,158,11,.28);background:rgba(245,158,11,.06)">' +
        '<div class="row between"><div class="row" style="gap:9px"><span class="badge amber">沙箱计费</span>' +
        '<span class="muted" style="font-size:12.5px">点击升级会生成一张模拟发票并切换套餐，不会调用真实支付。</span></div>' +
        '<span class="dim" style="font-size:11.5px">当前：' + FD.esc(data.plan.name) + '</span></div>' +
      '</div>' +

      '<div class="grid mt-24" style="grid-template-columns:minmax(0,1.4fr) minmax(300px,1fr)">' +
        '<div class="card pad">' +
          '<div class="section-head"><h3>当前套餐</h3>' + planBadge(current) + '</div>' +
          '<div class="row between"><div><div style="font-size:30px;font-weight:850;letter-spacing:-.03em">¥' + data.plan.price + '<span class="dim" style="font-size:12px;font-weight:500"> / 月</span></div>' +
          '<div class="dim" style="font-size:12px">' + FD.esc(data.plan.tagline) + '</div></div>' +
          '<div style="text-align:right"><div class="dim" style="font-size:11px">本月任务</div><b style="font-size:22px">' + runs.used + ' / ' + runs.limit + '</b></div></div>' +
          '<div class="progress mt-16"><i class="' + (runs.percent > 85 ? 'warn' : '') + '" style="width:' + runs.percent + '%"></i></div>' +
          '<div class="divider"></div>' +
          '<div class="grid grid-3" style="gap:12px">' +
            usageMini('任务次数', runs.used + ' / ' + runs.limit, runs.percent) +
            usageMini('文件存储', (usage.storage.used / 1024 / 1024).toFixed(1) + ' MB / ' + (usage.storage.limit / 1024 / 1024).toFixed(0) + ' MB', usage.storage.percent) +
            usageMini('成员席位', usage.members.used + ' / ' + usage.members.limit, Math.round(usage.members.used / usage.members.limit * 100)) +
          '</div>' +
          (current !== 'free' && isOwner ? '<button class="link-btn danger mt-16" id="cancelPlan">取消订阅，回到 Free</button>' : '') +
        '</div>' +
        '<div class="card pad">' +
          '<div class="section-head"><h3>发票</h3><span class="chip">' + data.invoices.length + ' 张</span></div>' +
          (data.invoices.length ? data.invoices.slice(0, 5).map(function (inv) {
            return '<div class="invoice-row"><div><b>¥' + FD.num(inv.amount_cents / 100, 2) + '</b>' +
              '<div class="dim" style="font-size:10.5px">' + FD.esc(inv.plan.toUpperCase()) + ' · ' + FD.esc(inv.period_start) + ' → ' + FD.esc(inv.period_end) + '</div></div>' +
              '<span class="badge green">已支付</span></div>';
          }).join('') : '<div class="empty">暂无发票</div>') +
          '<p class="dim" style="font-size:11px;margin:12px 0 0">发票为演示数据，可在订阅后自动生成。</p>' +
        '</div>' +
      '</div>' +

      '<div class="grid grid-3 mt-24">' +
      data.plans.map(function (p) {
        var isCurrent = p.key === current;
        var price = cycle === 'yearly' ? p.price_year : p.price;
        var unit = cycle === 'yearly' ? ' / 年' : ' / 月';
        return '<div class="card pad" style="' + (isCurrent ? 'border-color:rgba(99,102,241,.55);box-shadow:0 24px 60px rgba(99,102,241,.15);' : '') + 'display:flex;flex-direction:column">' +
          '<div class="row between"><h3 style="margin:0">' + FD.esc(p.name) + '</h3>' + (isCurrent ? '<span class="badge">当前</span>' : p.key === 'pro' ? '<span class="badge amber">推荐</span>' : '') + '</div>' +
          '<div class="dim" style="font-size:12px;margin:4px 0 12px">' + FD.esc(p.tagline) + '</div>' +
          '<div style="font-size:32px;font-weight:850;letter-spacing:-.03em">¥' + price + '<span class="dim" style="font-size:12px;font-weight:500">' + unit + '</span></div>' +
          '<ul class="plan-feature-list mt-16" style="flex:1">' + p.features.map(function (f) { return '<li>' + FD.esc(f) + '</li>'; }).join('') + '</ul>' +
          (isCurrent
            ? '<button class="btn btn-block mt-16" disabled>当前套餐</button>'
            : p.key === 'free'
              ? '<button class="btn btn-ghost btn-block mt-16" id="cancelPlan2">降级到 Free</button>'
              : '<button class="btn btn-primary btn-block mt-16" data-subscribe="' + p.key + '" ' + (isOwner ? '' : 'disabled') + '>' + (isOwner ? '选择 ' + FD.esc(p.name) : '仅所有者可操作') + '</button>') +
        '</div>';
      }).join('') +
      '</div>' +

      '<div class="card pad mt-24">' +
        '<div class="section-head"><h3>全部发票</h3><span class="dim" style="font-size:11.5px">沙箱环境</span></div>' +
        (data.invoices.length ?
          '<div class="table-wrap"><table class="data"><thead><tr><th>编号</th><th>套餐</th><th class="num">金额</th><th>周期</th><th>状态</th><th>创建时间</th></tr></thead><tbody>' +
          data.invoices.map(function (inv) {
            return '<tr><td>INV-' + String(inv.id).padStart(5, '0') + '</td><td>' + FD.esc(inv.plan.toUpperCase()) + '</td>' +
              '<td class="num">¥' + FD.num(inv.amount_cents / 100, 2) + '</td>' +
              '<td class="dim">' + FD.esc(inv.period_start) + ' → ' + FD.esc(inv.period_end) + '</td>' +
              '<td><span class="badge green">已支付</span></td><td class="dim">' + FD.timeAgo(inv.created_at) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : emptyBox('暂无发票', '订阅套餐后会自动生成。')) +
      '</div>';

    $$('[data-cycle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.billingCycle = btn.dataset.cycle;
        renderRoute();
      });
    });
    $$('[data-subscribe]').forEach(function (btn) {
      btn.addEventListener('click', function () { subscribePlan(btn.dataset.subscribe, cycle, btn); });
    });
    var cancel = $('#cancelPlan') || $('#cancelPlan2');
    if (cancel) cancel.addEventListener('click', function () { cancelPlan(cancel); });
  }

  function usageMini(label, text, pct) {
    return '<div class="card flat pad-sm" style="background:rgba(0,0,0,.12)">' +
      '<div class="dim" style="font-size:10.5px">' + label + '</div>' +
      '<b style="font-size:13px;display:block;margin:3px 0 6px">' + FD.esc(text) + '</b>' +
      '<div class="progress thin"><i class="' + (pct > 85 ? 'warn' : '') + '" style="width:' + Math.min(100, pct) + '%"></i></div></div>';
  }

  function subscribePlan(plan, cycle, btn) {
    var name = plan === 'team' ? 'Team' : 'Pro';
    var price = plan === 'team' ? (cycle === 'yearly' ? 2990 : 299) : (cycle === 'yearly' ? 990 : 99);
    openModal({
      title: '确认订阅 ' + name,
      body: '<div class="stack" style="font-size:13px">' +
        '<div class="row between"><span class="muted">套餐</span><b>' + name + ' · ' + (cycle === 'yearly' ? '按年' : '按月') + '</b></div>' +
        '<div class="row between"><span class="muted">金额</span><b>¥' + FD.num(price, 2) + '</b></div>' +
        '<div class="row between"><span class="muted">支付方式</span><span class="badge amber">沙箱模拟</span></div>' +
        '<div class="divider"></div><p class="dim" style="font-size:11.5px;margin:0">确认后会立即切换套餐并生成一张已支付发票。演示环境不会产生真实扣款。</p></div>',
      foot: '<button class="btn" data-close>取消</button><button class="btn btn-primary" id="confirmSub">确认订阅</button>',
      onMount: function (el, close) {
        $('#confirmSub', el).addEventListener('click', async function () {
          setBusy(this, true, '切换中…');
          try {
            await api('/api/billing/subscribe', { method: 'POST', body: JSON.stringify({ plan: plan, cycle: cycle }) });
            await refreshMe();
            close();
            FD.toast('已切换到 ' + name + ' 套餐', 'ok');
            renderRoute();
          } catch (e) {
            FD.toast(e.message, 'err');
            setBusy(this, false);
          }
        });
      }
    });
  }

  async function cancelPlan(btn) {
    if (!(await confirmBox('取消订阅后将回到 Free 套餐，超出配额的用量不会被删除，但无法继续新建任务。', { danger: true, ok: '确认取消' }))) return;
    setBusy(btn, true, '处理中…');
    try {
      await api('/api/billing/cancel', { method: 'POST' });
      await refreshMe();
      FD.toast('已回到 Free 套餐', 'ok');
      renderRoute();
    } catch (e) {
      FD.toast(e.message, 'err');
      setBusy(btn, false);
    }
  }

  /* ---------------- 设置 ---------------- */
  var AUDIT_LABELS = {
    'user.register': '注册账号', 'user.login': '登录', 'user.profile': '更新资料', 'user.password': '修改密码',
    'workspace.rename': '重命名工作区', 'member.invite': '邀请成员', 'member.join': '加入工作区', 'member.remove': '移除成员',
    'excel.process': '处理表格', 'excel.delete': '删除表格记录',
    'docs.extract': '提取文档', 'docs.enqueue': '加入文档队列', 'docs.delete': '删除抽取记录',
    'quote.create': '创建报价单', 'quote.update': '更新报价单', 'quote.delete': '删除报价单', 'quote.duplicate': '复制报价单',
    'analytics.upload': '上传销售数据', 'analytics.analyze': '生成销售看板', 'analytics.insight': '生成经营洞察', 'analytics.delete': '删除看板',
    'billing.subscribe': '订阅套餐', 'billing.cancel': '取消订阅',
    'admin.user_status': '修改用户状态', 'admin.plan': '调整工作区套餐'
  };

  function auditLabel(action) { return AUDIT_LABELS[action] || action; }

  async function renderSettings(token) {
    var canManage = state.me.workspace.role === 'owner' || state.me.workspace.role === 'admin' || state.me.user.is_admin;
    var jobs = [api('/api/workspace/members')];
    if (canManage) jobs.push(api('/api/workspace/audit?page=' + state.settings.auditPage + '&page_size=15'));
    var results = await Promise.all(jobs);
    if (token !== state.renderToken) return;
    state.settings.members = results[0];
    state.settings.audit = results[1] || null;
    state.settings.canManage = canManage;
    if (!state.settings.tab) state.settings.tab = 'workspace';

    var tabs = [
      { key: 'workspace', label: '工作区' },
      { key: 'members', label: '成员' },
      { key: 'profile', label: '我的账户' }
    ];
    if (canManage) tabs.push({ key: 'audit', label: '审计日志' });

    view.innerHTML =
      '<div class="page-head"><div><h1>设置</h1><p>管理当前工作区、成员、个人账户与操作审计。</p></div>' +
      '<div class="row"><span class="badge gray">' + FD.esc(state.me.workspace.name) + '</span>' + planBadge(state.me.workspace.plan) + '</div></div>' +
      '<div class="tabs mb-16" id="settingsTabs">' + tabs.map(function (t) {
        return '<button data-tab="' + t.key + '" class="' + (state.settings.tab === t.key ? 'on' : '') + '">' + t.label + '</button>';
      }).join('') + '</div>' +
      '<div id="settingsContent"></div>';

    $('#settingsTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tab]');
      if (!btn) return;
      state.settings.tab = btn.dataset.tab;
      $$('#settingsTabs button').forEach(function (b) { b.classList.toggle('on', b === btn); });
      drawSettingsTab();
    });
    drawSettingsTab();
  }

  function drawSettingsTab() {
    var tab = state.settings.tab;
    var box = $('#settingsContent');
    if (!box) return;
    var me = state.me;
    var canManage = state.settings.canManage;

    if (tab === 'workspace') {
      box.innerHTML = '<div class="grid" style="grid-template-columns:minmax(0,1.2fr) minmax(300px,1fr)">' +
        '<div class="card pad">' +
          '<div class="section-head"><h3>工作区信息</h3>' + planBadge(me.workspace.plan) + '</div>' +
          '<div><label>工作区名称</label><input id="wsRename" value="' + FD.esc(me.workspace.name) + '" ' + (canManage ? '' : 'disabled') + ' maxlength="40" /></div>' +
          (canManage ? '<button class="btn btn-primary mt-16" id="wsRenameBtn">保存名称</button>' : '<p class="dim" style="font-size:12px;margin-top:8px">只有工作区管理员可以修改名称。</p>') +
          '<div class="divider"></div>' +
          '<dl class="kv">' +
            '<dt>工作区 ID</dt><dd>#' + me.workspace.id + '</dd>' +
            '<dt>标识</dt><dd class="mono">' + FD.esc(me.workspace.slug) + '</dd>' +
            '<dt>我的角色</dt><dd>' + FD.esc(ROLE_LABEL[me.workspace.role] || me.workspace.role) + '</dd>' +
            '<dt>创建时间</dt><dd>' + FD.esc((me.workspace.created_at || '').slice(0, 10)) + '</dd>' +
            '<dt>成员数</dt><dd>' + state.settings.members.members.length + ' / ' + state.settings.members.limit + '</dd>' +
          '</dl>' +
        '</div>' +
        '<div class="card pad">' +
          '<div class="section-head"><h3>本月用量</h3><span class="chip">' + FD.esc(me.plan.name) + '</span></div>' +
          '<div class="stack">' +
            usageBar('任务次数', me.usage.runs.used, me.usage.runs.limit, '') +
            usageBar('文件存储', me.usage.storage.used, me.usage.storage.limit, 'MB') +
            usageBar('成员席位', me.usage.members.used, me.usage.members.limit, '') +
          '</div>' +
          '<div class="divider"></div>' +
          '<p class="dim" style="font-size:11.5px;margin:0">需要更高额度？在「用量与计费」中升级套餐，立即生效。</p>' +
          '<a class="btn btn-sm btn-primary btn-block mt-16" href="#/billing">查看套餐</a>' +
        '</div>' +
      '</div>';

      if (canManage) {
        $('#wsRenameBtn').addEventListener('click', async function () {
          var name = $('#wsRename').value.trim();
          if (name.length < 2) { FD.toast('名称至少 2 个字符', 'warn'); return; }
          setBusy(this, true, '保存中…');
          try {
            await api('/api/workspace', { method: 'PATCH', body: JSON.stringify({ name: name }) });
            state.me.workspace.name = name;
            syncShell();
            FD.toast('已更新工作区名称', 'ok');
            renderRoute();
          } catch (e) { FD.toast(e.message, 'err'); setBusy(this, false); }
        });
      }
      return;
    }

    if (tab === 'members') {
      var members = state.settings.members.members;
      box.innerHTML = '<div class="card pad">' +
        '<div class="section-head"><h3>成员与角色</h3><span class="chip">' + members.length + ' / ' + state.settings.members.limit + '</span></div>' +
        (canManage ?
          '<div class="card flat pad-sm mb-16" style="background:rgba(99,102,241,.07);border-color:rgba(99,102,241,.22)">' +
            '<div class="form-grid" style="grid-template-columns:1fr 140px 120px;gap:10px;align-items:end">' +
              '<div><label>邀请邮箱</label><input id="inviteEmail" type="email" placeholder="teammate@company.com" /></div>' +
              '<div><label>角色</label><select id="inviteRole"><option value="member">成员</option><option value="admin">管理员</option></select></div>' +
              '<button class="btn btn-primary" id="inviteBtn">生成邀请链接</button>' +
            '</div>' +
            '<div id="inviteResult" class="hidden mt-8"></div>' +
          '</div>' : '') +
        '<div class="table-wrap"><table class="data"><thead><tr><th>成员</th><th>角色</th><th>加入时间</th><th>最近登录</th><th></th></tr></thead><tbody>' +
        members.map(function (m) {
          return '<tr><td><div class="row" style="gap:9px;flex-wrap:nowrap"><span class="avatar">' + FD.initials(m.name) + '</span>' +
            '<div><b>' + FD.esc(m.name) + '</b><div class="dim" style="font-size:10.5px">' + FD.esc(m.email) + '</div></div></div></td>' +
            '<td><span class="badge ' + (m.role === 'owner' ? 'cyan' : m.role === 'admin' ? '' : 'gray') + '">' + FD.esc(ROLE_LABEL[m.role] || m.role) + '</span></td>' +
            '<td class="dim">' + FD.esc((m.created_at || '').slice(0, 10)) + '</td>' +
            '<td class="dim">' + (m.last_login_at ? FD.timeAgo(m.last_login_at) : '从未登录') + '</td>' +
            '<td class="num">' + (canManage && m.role !== 'owner' && m.id !== me.user.id
              ? '<button class="btn btn-sm btn-danger" data-remove-member="' + m.id + '">移除</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="dim" style="font-size:11.5px;margin-top:10px">邀请链接 7 天内有效；对方需使用被邀请邮箱登录后接受。</p>' +
      '</div>';

      if (canManage) {
        $('#inviteBtn').addEventListener('click', async function () {
          var email = $('#inviteEmail').value.trim();
          if (!email) { FD.toast('请输入邮箱', 'warn'); return; }
          setBusy(this, true, '生成中…');
          try {
            var data = await api('/api/workspace/invites', {
              method: 'POST', body: JSON.stringify({ email: email, role: $('#inviteRole').value })
            });
            var result = $('#inviteResult');
            result.classList.remove('hidden');
            result.innerHTML = '<div class="row between" style="gap:10px;background:rgba(0,0,0,.18);border:1px solid var(--line);border-radius:9px;padding:9px 11px">' +
              '<span class="mono" style="font-size:11px;word-break:break-all">' + FD.esc(data.link) + '</span>' +
              '<button class="btn btn-sm" id="copyInvite">复制</button></div>';
            $('#copyInvite').addEventListener('click', function () { FD.copy(data.link, '邀请链接已复制'); });
            setBusy(this, false);
            FD.toast('邀请已创建', 'ok');
          } catch (e) { FD.toast(e.message, 'err'); setBusy(this, false); }
        });
        $$('[data-remove-member]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            if (!(await confirmBox('移除该成员？对方将无法再访问这个工作区。', { danger: true, ok: '移除' }))) return;
            try {
              await api('/api/workspace/members/' + btn.dataset.removeMember, { method: 'DELETE' });
              FD.toast('已移除', 'ok');
              state.settings.members = await api('/api/workspace/members');
              drawSettingsTab();
            } catch (e) { FD.toast(e.message, 'err'); }
          });
        });
      }
      return;
    }

    if (tab === 'profile') {
      box.innerHTML = '<div class="grid grid-2">' +
        '<div class="card pad">' +
          '<div class="section-head"><h3>个人资料</h3></div>' +
          '<div class="row mb-16" style="gap:12px"><span class="avatar" style="width:46px;height:46px;font-size:18px">' + FD.initials(me.user.name) + '</span>' +
            '<div><b>' + FD.esc(me.user.name) + '</b><div class="dim" style="font-size:11.5px">' + FD.esc(me.user.email) + '</div></div></div>' +
          '<div><label>昵称</label><input id="profileName" value="' + FD.esc(me.user.name) + '" maxlength="40" /></div>' +
          '<div class="mt-8"><label>邮箱</label><input value="' + FD.esc(me.user.email) + '" disabled /></div>' +
          '<button class="btn btn-primary mt-16" id="profileSave">保存资料</button>' +
        '</div>' +
        '<div class="card pad">' +
          '<div class="section-head"><h3>修改密码</h3><span class="badge gray">安全</span></div>' +
          '<div><label>当前密码</label><input id="pwCurrent" type="password" autocomplete="current-password" /></div>' +
          '<div class="mt-8"><label>新密码</label><input id="pwNew" type="password" autocomplete="new-password" placeholder="至少 8 位，含字母和数字" /></div>' +
          '<div class="mt-8"><label>确认新密码</label><input id="pwConfirm" type="password" autocomplete="new-password" /></div>' +
          '<button class="btn btn-primary mt-16" id="pwSave">更新密码</button>' +
          '<p class="dim" style="font-size:11.5px;margin-top:10px">修改密码后，其他设备的会话会被退出。</p>' +
        '</div>' +
      '</div>';

      $('#profileSave').addEventListener('click', async function () {
        var name = $('#profileName').value.trim();
        if (!name) { FD.toast('昵称不能为空', 'warn'); return; }
        setBusy(this, true, '保存中…');
        try {
          await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ name: name }) });
          state.me.user.name = name;
          syncShell();
          FD.toast('资料已更新', 'ok');
          drawSettingsTab();
        } catch (e) { FD.toast(e.message, 'err'); setBusy(this, false); }
      });
      $('#pwSave').addEventListener('click', async function () {
        var current = $('#pwCurrent').value;
        var next = $('#pwNew').value;
        if (next !== $('#pwConfirm').value) { FD.toast('两次输入的新密码不一致', 'warn'); return; }
        setBusy(this, true, '更新中…');
        try {
          await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ current: current, new: next }) });
          FD.toast('密码已更新，其他会话已退出', 'ok');
          $('#pwCurrent').value = '';
          $('#pwNew').value = '';
          $('#pwConfirm').value = '';
          setBusy(this, false);
        } catch (e) { FD.toast(e.message, 'err'); setBusy(this, false); }
      });
      return;
    }

    if (tab === 'audit') {
      var audit = state.settings.audit;
      if (!audit) {
        box.innerHTML = emptyBox('没有审计数据', '当前角色无权查看。');
        return;
      }
      box.innerHTML = '<div class="card pad">' +
        '<div class="section-head"><h3>操作审计</h3><span class="chip">共 ' + audit.total + ' 条</span></div>' +
        (audit.logs.length ? audit.logs.map(function (log) {
          return '<div class="audit-row"><div class="when">' + FD.timeAgo(log.created_at) + '</div>' +
            '<div class="what" style="flex:1"><b>' + FD.esc(auditLabel(log.action)) + '</b> ' +
            (log.target ? '<span>' + FD.esc(log.target) + '</span>' : '') +
            '<div class="dim" style="font-size:10.5px">' + FD.esc(log.user_name || '系统') + (log.email ? ' · ' + FD.esc(log.email) : '') + (log.ip ? ' · ' + FD.esc(log.ip) : '') + '</div></div></div>';
        }).join('') : emptyBox('暂无日志', '')) +
        pagerHtml(audit.page, audit.page_size, audit.total) +
      '</div>';

      bindPager(box, async function (page) {
        state.settings.auditPage = page;
        try {
          state.settings.audit = await api('/api/workspace/audit?page=' + page + '&page_size=15');
          drawSettingsTab();
        } catch (e) { FD.toast(e.message, 'err'); }
      });
    }
  }

  /* ---------------- 平台管理 ---------------- */
  function bytesText(bytes) {
    bytes = Number(bytes || 0);
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  async function renderAdmin(token) {
    if (!state.admin.overview) {
      state.admin.overview = await api('/api/admin/overview');
    }
    if (token !== state.renderToken) return;
    if (!state.admin.tab) state.admin.tab = 'overview';
    var tabs = [
      { key: 'overview', label: '概览' }, { key: 'users', label: '用户' },
      { key: 'workspaces', label: '工作区' }, { key: 'audit', label: '审计' },
      { key: 'health', label: '系统健康' }
    ];

    view.innerHTML =
      '<div class="page-head"><div><h1>平台管理</h1><p>跨工作区的用户、订阅、用量与系统状态。仅平台管理员可见。</p></div>' +
      '<div class="row"><span class="badge amber">Admin</span><span class="chip">v' + FD.esc(state.admin.overview.version) + '</span></div></div>' +
      '<div class="tabs mb-16" id="adminTabs">' + tabs.map(function (t) {
        return '<button data-tab="' + t.key + '" class="' + (state.admin.tab === t.key ? 'on' : '') + '">' + t.label + '</button>';
      }).join('') + '</div>' +
      '<div id="adminContent"><div class="spin-lg"></div></div>';

    $('#adminTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tab]');
      if (!btn) return;
      state.admin.tab = btn.dataset.tab;
      $$('#adminTabs button').forEach(function (b) { b.classList.toggle('on', b === btn); });
      drawAdminTab();
    });
    drawAdminTab();
  }

  async function drawAdminTab() {
    var tab = state.admin.tab;
    var box = $('#adminContent');
    if (!box) return;
    var o = state.admin.overview;

    if (tab === 'overview') {
      var planRows = Object.keys(o.workspaces.plans).map(function (key) {
        var n = o.workspaces.plans[key];
        var pct = o.workspaces.total ? Math.round(n / o.workspaces.total * 100) : 0;
        return '<div><div class="row between" style="font-size:12px;margin-bottom:5px"><span class="muted">' + key.toUpperCase() + '</span><span class="dim">' + n + ' 个 · ' + pct + '%</span></div>' +
          '<div class="progress thin"><i style="width:' + pct + '%"></i></div></div>';
      }).join('');
      box.innerHTML =
        '<div class="grid grid-4">' +
          '<div class="kpi p"><span class="label">用户总数</span><b>' + o.users.total + '</b><div class="foot">' + o.users.active + ' 个活跃</div></div>' +
          '<div class="kpi g"><span class="label">工作区</span><b>' + o.workspaces.total + '</b><div class="foot">跨租户隔离</div></div>' +
          '<div class="kpi a"><span class="label">月度 MRR</span><b>¥' + FD.num(o.mrr) + '</b><div class="foot">按套餐价格估算</div></div>' +
          '<div class="kpi c"><span class="label">本月任务</span><b>' + FD.num(o.month.runs) + '</b><div class="foot">AI 调用 ' + FD.num(o.month.ai_calls) + ' 次</div></div>' +
        '</div>' +
        '<div class="grid mt-24" style="grid-template-columns:minmax(0,1.3fr) minmax(300px,1fr)">' +
          '<div class="card pad"><div class="section-head"><h3>业务产出</h3><span class="chip">全平台</span></div>' +
            '<div class="grid grid-4" style="gap:10px">' +
              adminJobCard('Excel 清洗', o.jobs.excel, 'excel') +
              adminJobCard('文档抽取', o.jobs.docs, 'docs') +
              adminJobCard('报价单', o.jobs.quotes, 'quotes') +
              adminJobCard('销售看板', o.jobs.analytics, 'analytics') +
            '</div>' +
            '<div class="divider"></div>' +
            '<div class="grid grid-2" style="gap:16px">' +
              '<div><div class="dim" style="font-size:11px">文件存储总量</div><b>' + bytesText(o.storage_bytes) + '</b></div>' +
              '<div><div class="dim" style="font-size:11px">数据库大小</div><b>' + bytesText(o.db_bytes) + '</b></div>' +
              '<div><div class="dim" style="font-size:11px">运行时长</div><b>' + Math.floor(o.uptime_seconds / 3600) + ' 小时</b></div>' +
              '<div><div class="dim" style="font-size:11px">文档队列</div><b>' + o.workers.pending + ' 排队 / ' + o.workers.processing + ' 处理中</b></div>' +
            '</div>' +
          '</div>' +
          '<div class="card pad"><div class="section-head"><h3>套餐分布</h3><span class="chip">' + o.workspaces.total + ' 个</span></div>' +
            '<div class="stack">' + (planRows || '<div class="dim">暂无数据</div>') + '</div>' +
            '<div class="divider"></div>' +
            '<div class="section-head"><h3 style="font-size:13.5px">AI 通道</h3><span class="badge ' + (o.ai.active === 'rules' ? 'amber' : 'green') + '">' + FD.esc(o.ai.active_label) + '</span></div>' +
            '<div class="stack-sm" style="font-size:12px">' +
              aiRow('云端 API', o.ai.api_configured ? (o.ai.api_model || '已配置') : '未配置', !!o.ai.api_configured) +
              aiRow('本地 Ollama', o.ai.ollama_online ? '在线' : '离线', !!o.ai.ollama_online) +
              aiRow('规则引擎', '始终可用', true) +
            '</div>' +
          '</div>' +
        '</div>';
      return;
    }

    if (tab === 'users') {
      if (!state.admin.users) state.admin.users = await api('/api/admin/users?page=1&page_size=20');
      if (state.admin.tab !== tab) return;
      var u = state.admin.users;
      box.innerHTML = '<div class="card pad">' +
        '<div class="section-head"><h3>用户</h3><div class="row" style="gap:8px">' +
          '<input id="adminUserSearch" placeholder="搜索邮箱 / 昵称" value="' + FD.esc(state.admin.userQ || '') + '" style="width:200px;padding:7px 10px;font-size:12.5px" />' +
          '<button class="btn btn-sm" id="adminUserSearchBtn">' + icon('search', 14) + '</button></div></div>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>ID</th><th>用户</th><th>角色</th><th class="num">工作区</th><th class="num">本月任务</th><th>最近登录</th><th>状态</th><th></th></tr></thead><tbody>' +
        u.users.map(function (user) {
          return '<tr><td class="dim">#' + user.id + '</td>' +
            '<td><b>' + FD.esc(user.name) + '</b><div class="dim" style="font-size:10.5px">' + FD.esc(user.email) + '</div></td>' +
            '<td>' + (user.is_admin ? '<span class="badge cyan">Admin</span>' : '<span class="badge gray">User</span>') + '</td>' +
            '<td class="num">' + user.workspaces + '</td><td class="num">' + user.month_units + '</td>' +
            '<td class="dim">' + (user.last_login_at ? FD.timeAgo(user.last_login_at) : '从未') + '</td>' +
            '<td>' + (user.is_active ? '<span class="badge green">正常</span>' : '<span class="badge red">停用</span>') + '</td>' +
            '<td class="num"><button class="btn btn-sm ' + (user.is_active ? 'btn-danger' : '') + '" data-toggle-user="' + user.id + '" data-active="' + (user.is_active ? '1' : '0') + '">' +
            (user.is_active ? '停用' : '启用') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>' + pagerHtml(u.page, u.page_size, u.total) + '</div>';

      var searchUsers = function () {
        state.admin.userQ = $('#adminUserSearch').value.trim();
        state.admin.users = null;
        drawAdminTab();
      };
      $('#adminUserSearchBtn').addEventListener('click', searchUsers);
      $('#adminUserSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') searchUsers(); });
      bindPager(box, async function (page) {
        state.admin.users = await api('/api/admin/users?page=' + page + '&page_size=20&q=' + encodeURIComponent(state.admin.userQ || ''));
        drawAdminTab();
      });
      $$('[data-toggle-user]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var active = btn.dataset.active === '1';
          if (!(await confirmBox(active ? '停用该用户？其所有会话会被立即退出。' : '重新启用该用户？', { danger: active, ok: active ? '停用' : '启用' }))) return;
          try {
            await api('/api/admin/users/' + btn.dataset.toggleUser, { method: 'PATCH', body: JSON.stringify({ is_active: !active }) });
            state.admin.users = null;
            state.admin.overview = null;
            FD.toast('状态已更新', 'ok');
            drawAdminTab();
          } catch (e) { FD.toast(e.message, 'err'); }
        });
      });
      return;
    }

    if (tab === 'workspaces') {
      if (!state.admin.workspaces) state.admin.workspaces = await api('/api/admin/workspaces?page=1&page_size=20');
      if (state.admin.tab !== tab) return;
      var w = state.admin.workspaces;
      box.innerHTML = '<div class="card pad">' +
        '<div class="section-head"><h3>工作区</h3><div class="row" style="gap:8px">' +
          '<input id="adminWsSearch" placeholder="搜索名称 / slug" value="' + FD.esc(state.admin.wsQ || '') + '" style="width:200px;padding:7px 10px;font-size:12.5px" />' +
          '<button class="btn btn-sm" id="adminWsSearchBtn">' + icon('search', 14) + '</button></div></div>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>工作区</th><th>所有者</th><th>套餐</th><th class="num">成员</th><th class="num">本月任务</th><th class="num">存储</th><th>创建时间</th></tr></thead><tbody>' +
        w.workspaces.map(function (ws) {
          return '<tr><td><b>' + FD.esc(ws.name) + '</b><div class="dim mono" style="font-size:10px">' + FD.esc(ws.slug) + '</div></td>' +
            '<td class="dim">' + FD.esc(ws.owner_email || '—') + '</td>' +
            '<td><select data-plan="' + ws.id + '" style="padding:4px 7px;font-size:11.5px;width:auto">' +
              ['free', 'pro', 'team'].map(function (p) { return '<option value="' + p + '" ' + (p === ws.plan ? 'selected' : '') + '>' + p.toUpperCase() + '</option>'; }).join('') +
            '</select></td>' +
            '<td class="num">' + ws.members + '</td><td class="num">' + ws.month_units + '</td>' +
            '<td class="num">' + bytesText(ws.storage_bytes) + '</td>' +
            '<td class="dim">' + FD.esc((ws.created_at || '').slice(0, 10)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' + pagerHtml(w.page, w.page_size, w.total) + '</div>';

      var searchWs = function () {
        state.admin.wsQ = $('#adminWsSearch').value.trim();
        state.admin.workspaces = null;
        drawAdminTab();
      };
      $('#adminWsSearchBtn').addEventListener('click', searchWs);
      $('#adminWsSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') searchWs(); });
      bindPager(box, async function (page) {
        state.admin.workspaces = await api('/api/admin/workspaces?page=' + page + '&page_size=20&q=' + encodeURIComponent(state.admin.wsQ || ''));
        drawAdminTab();
      });
      $$('[data-plan]').forEach(function (sel) {
        sel.addEventListener('change', async function () {
          try {
            await api('/api/admin/workspaces/' + sel.dataset.plan + '/plan', { method: 'PATCH', body: JSON.stringify({ plan: sel.value }) });
            state.admin.overview = null;
            FD.toast('套餐已调整为 ' + sel.value.toUpperCase(), 'ok');
          } catch (e) {
            FD.toast(e.message, 'err');
            sel.value = sel.dataset.prev || sel.value;
          }
        });
      });
      return;
    }

    if (tab === 'audit') {
      if (!state.admin.audit) state.admin.audit = await api('/api/admin/audit?page=1&page_size=30');
      if (state.admin.tab !== tab) return;
      var a = state.admin.audit;
      box.innerHTML = '<div class="card pad">' +
        '<div class="section-head"><h3>全平台审计</h3><span class="chip">共 ' + a.total + ' 条</span></div>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>时间</th><th>动作</th><th>对象</th><th>工作区</th><th>用户</th><th>IP</th></tr></thead><tbody>' +
        a.logs.map(function (log) {
          return '<tr><td class="dim">' + FD.timeAgo(log.created_at) + '</td>' +
            '<td><b>' + FD.esc(auditLabel(log.action)) + '</b></td>' +
            '<td class="dim">' + FD.esc(log.target || '—') + '</td>' +
            '<td>' + FD.esc(log.workspace_name || '—') + '</td>' +
            '<td class="dim">' + FD.esc(log.user_email || '系统') + '</td>' +
            '<td class="dim mono">' + FD.esc(log.ip || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' + pagerHtml(a.page, a.page_size, a.total) + '</div>';
      bindPager(box, async function (page) {
        state.admin.audit = await api('/api/admin/audit?page=' + page + '&page_size=30');
        drawAdminTab();
      });
      return;
    }

    if (tab === 'health') {
      if (!state.admin.health) state.admin.health = await api('/api/admin/health');
      if (state.admin.tab !== tab) return;
      var h = state.admin.health;
      box.innerHTML = '<div class="grid grid-2">' +
        '<div class="card pad"><div class="section-head"><h3>运行状态</h3><span class="badge green">正常</span></div>' +
          '<dl class="kv">' +
            '<dt>版本</dt><dd>v' + FD.esc(h.version) + '</dd>' +
            '<dt>环境</dt><dd>' + FD.esc(h.env) + '</dd>' +
            '<dt>运行时长</dt><dd>' + Math.floor(h.uptime_seconds / 3600) + ' 小时 ' + Math.floor(h.uptime_seconds % 3600 / 60) + ' 分钟</dd>' +
            '<dt>数据库</dt><dd>' + bytesText(h.db_bytes) + '</dd>' +
            '<dt>文档队列</dt><dd>排队 ' + h.workers.pending + ' / 处理 ' + h.workers.processing + ' / 完成 ' + h.workers.done + ' / 失败 ' + h.workers.failed + '</dd>' +
          '</dl>' +
          '<div class="divider"></div>' +
          '<div class="row"><span class="badge ' + (h.ai.active === 'rules' ? 'amber' : 'green') + '">AI：' + FD.esc(h.ai.active_label) + '</span>' +
          '<span class="badge gray">' + (h.ai.api_configured ? '云端已配置' : '云端未配置') + '</span>' +
          '<span class="badge gray">' + (h.ai.ollama_online ? 'Ollama 在线' : 'Ollama 离线') + '</span></div>' +
        '</div>' +
        '<div class="card pad"><div class="section-head"><h3>部署提示</h3><span class="chip">2C2G 可用</span></div>' +
          '<div class="stack" style="font-size:12.5px">' +
            '<div class="row between"><span class="muted">推荐进程</span><b>uvicorn × 1</b></div>' +
            '<div class="row between"><span class="muted">文档线程</span><b>' + h.workers.total + ' 个任务 / 1 个工作线程</b></div>' +
            '<div class="row between"><span class="muted">数据库</span><b>SQLite + WAL</b></div>' +
            '<div class="row between"><span class="muted">反向代理</span><b>Nginx</b></div>' +
            '<div class="divider"></div>' +
            '<p class="dim" style="font-size:11.5px;margin:0">建议 2C2G 起步并配置 2–4 GB swap；如需更高并发，可切换到 PostgreSQL 并将队列替换为 Redis / Celery。</p>' +
          '</div>' +
        '</div>' +
      '</div>';
      return;
    }
  }

  function adminJobCard(label, count, iconName) {
    return '<div class="card flat pad-sm" style="background:rgba(0,0,0,.12)"><div class="row" style="gap:6px;color:#a5b4fc">' + icon(iconName, 14) + '<span class="dim" style="font-size:10.5px">' + label + '</span></div>' +
      '<b style="font-size:20px;display:block;margin-top:4px">' + FD.num(count) + '</b></div>';
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    try {
      state.me = await api('/api/auth/me');
    } catch (e) {
      return;
    }
    syncShell();

    $('#themeBtn').addEventListener('click', function () {
      FDTheme.toggle();
      $('#themeBtn').textContent = FDTheme.current() === 'dark' ? '☀' : '☾';
      clearTimers();
      renderRoute();
    });
    $('#themeBtn').textContent = FDTheme.current() === 'dark' ? '☀' : '☾';

    $('#avatarBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      $('#userMenu').classList.toggle('hidden');
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#userMenu') && !e.target.closest('#avatarBtn')) {
        $('#userMenu').classList.add('hidden');
      }
    });
    $$('#userMenu [data-go]').forEach(function (el) {
      el.addEventListener('click', function () {
        $('#userMenu').classList.add('hidden');
        location.hash = '#/' + el.dataset.go;
      });
    });
    $('#logoutBtn').addEventListener('click', async function () {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
      location.href = '/login';
    });

    $('#wsSwitch').addEventListener('click', function (e) {
      e.stopPropagation();
      $('#userMenu').classList.remove('hidden');
    });

    $('#sidebarToggle').addEventListener('click', function () {
      $('#sidebar').classList.add('open');
      $('#sidebarOverlay').classList.remove('hidden');
    });
    $('#sidebarOverlay').addEventListener('click', function () {
      $('#sidebar').classList.remove('open');
      $('#sidebarOverlay').classList.add('hidden');
    });
    $('#aiBadge').addEventListener('click', function () {
      var ai = state.me.ai || {};
      openModal({
        title: 'AI 通道状态',
        body: '<div class="stack" style="font-size:13px">' +
          '<div class="row between"><span>当前通道</span><b>' + FD.esc(ai.active_label || '规则引擎') + '</b></div>' +
          '<div class="row between"><span>云端 API</span><span>' + (ai.api_configured ? '已配置 · ' + FD.esc(ai.api_model || '') : '未配置') + '</span></div>' +
          '<div class="row between"><span>本地 Ollama</span><span>' + (ai.ollama_online ? '在线 · ' + FD.esc(ai.ollama_model || '') : '离线') + '</span></div>' +
          '<div class="row between"><span>规则引擎</span><span class="badge green">始终可用</span></div>' +
          '<div class="divider"></div>' +
          '<p class="dim" style="font-size:12px;margin:0">配置环境变量 <code>AI_API_KEY</code>、<code>AI_BASE_URL</code>、<code>AI_MODEL</code> 即可启用云端 AI；完全离线时自动使用规则引擎。</p>' +
        '</div>',
        foot: '<button class="btn btn-primary" data-close>知道了</button>'
      });
    });

    window.addEventListener('hashchange', renderRoute);
    await renderRoute();
  }

  boot();
})();
