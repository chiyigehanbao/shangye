/* =========================================================
   Ollama 本地模型客户端
   - 自动探测 http://localhost:11434
   - 支持 model 选择、连通性检测、聊天、JSON 输出
   - 离线时优雅降级（由调用方决定 fallback）
   用法:
     await Ollama.available()            -> bool
     await Ollama.models()               -> ["qwen2.5", ...]
     await Ollama.chat({system,prompt})  -> string
     await Ollama.json({prompt})         -> object|null
     Ollama.mountBadge(el)               -> 渲染可点击的状态徽章
   ========================================================= */
(function () {
  const LS_BASE = 'hf_ollama_base';
  const LS_MODEL = 'hf_ollama_model';

  const cfg = {
    get base() { return localStorage.getItem(LS_BASE) || 'http://localhost:11434'; },
    set base(v) { localStorage.setItem(LS_BASE, v.replace(/\/$/, '')); },
    get model() { return localStorage.getItem(LS_MODEL) || 'qwen2.5'; },
    set model(v) { localStorage.setItem(LS_MODEL, v); }
  };

  let _online = null;

  async function fetchTimeout(url, opts = {}, ms = 4000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
    finally { clearTimeout(t); }
  }

  async function available(force = false) {
    if (_online !== null && !force) return _online;
    try {
      const r = await fetchTimeout(cfg.base + '/api/tags', {}, 2500);
      _online = r.ok;
    } catch { _online = false; }
    return _online;
  }

  async function models() {
    try {
      const r = await fetchTimeout(cfg.base + '/api/tags');
      if (!r.ok) return [];
      const d = await r.json();
      return (d.models || []).map(m => m.name);
    } catch { return []; }
  }

  async function chat({ system = '', prompt = '', model, temperature = 0.4, json = false, timeout = 60000 } = {}) {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    const body = { model: model || cfg.model, messages, stream: false, options: { temperature } };
    if (json) body.format = 'json';
    const r = await fetchTimeout(cfg.base + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, timeout);
    if (!r.ok) throw new Error('Ollama HTTP ' + r.status);
    const d = await r.json();
    _online = true;
    return (d.message && d.message.content) || '';
  }

  async function json(opts) {
    const text = await chat({ ...opts, json: true });
    try { return JSON.parse(text); }
    catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
      return null;
    }
  }

  /* ---- 状态徽章 ---- */
  function mountBadge(el) {
    if (!el) return;
    el.innerHTML = `<span class="badge cyan" id="ol-badge"><span class="dot off"></span> AI: 检测中…</span>`;
    const badge = el.querySelector('#ol-badge');
    const paint = (online, model) => {
      badge.innerHTML = `<span class="dot ${online ? '' : 'off'}"></span> AI ${online ? '已连接 · ' + model : '离线'}`;
      badge.style.cursor = 'pointer';
      badge.title = '点击设置 Ollama 地址 / 模型';
    };
    available(true).then(async (ok) => {
      paint(ok, cfg.model);
      if (ok) {
        const ms = await models();
        if (ms.length && !ms.includes(cfg.model)) { cfg.model = ms[0]; }
        paint(true, cfg.model);
      }
    });
    badge.addEventListener('click', async () => {
      const b = prompt('Ollama 地址', cfg.base); if (b) cfg.base = b.trim();
      const m = prompt('模型名（如 qwen2.5 / llama3.1 / deepseek-r1）', cfg.model); if (m) cfg.model = m.trim();
      localStorage.removeItem('hf_ollama_base'); localStorage.setItem(LS_BASE, cfg.base);
      localStorage.removeItem('hf_ollama_model'); localStorage.setItem(LS_MODEL, cfg.model);
      const ok = await available(true); paint(ok, cfg.model);
      ui && ui.toast(ok ? 'Ollama 已连接' : '无法连接 Ollama，请确认已运行 ollama serve', ok ? 'ok' : 'err');
    });
  }

  window.Ollama = { available, models, chat, json, mountBadge, get config() { return cfg; } };
})();
