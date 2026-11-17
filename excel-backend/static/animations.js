/* =========================================================
   动画与交互工具库
   windows.ui        提示 / 复制 / 格式化
   ========================================================= */
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Toast ---------- */
  function ensureWrap() {
    let w = document.getElementById('toast-wrap');
    if (!w) { w = document.createElement('div'); w.id = 'toast-wrap'; document.body.appendChild(w); }
    return w;
  }
  function toast(msg, type = '', ms = 2600) {
    const w = ensureWrap();
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = msg;
    w.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0'; el.style.transform = 'translateX(30px)';
      setTimeout(() => el.remove(), 320);
    }, ms);
  }

  /* ---------- Reveal on scroll ---------- */
  function initReveal(root = document) {
    const els = root.querySelectorAll('[data-reveal]:not(.in)');
    if (reduce) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          const d = parseFloat(en.target.dataset.delay || 0);
          setTimeout(() => en.target.classList.add('in'), d * 1000);
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });
    els.forEach(e => io.observe(e));
  }

  /* ---------- Counters ---------- */
  function initCounters(root = document) {
    const els = root.querySelectorAll('[data-count]:not(.done)');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target; el.classList.add('done');
        const target = parseFloat(el.dataset.count);
        const dur = parseInt(el.dataset.dur || '1200', 10);
        const suffix = el.dataset.suffix || '';
        const prefix = el.dataset.prefix || '';
        const dec = parseInt(el.dataset.dec || '0', 10);
        const start = performance.now();
        const from = 0;
        (function step(now) {
          const p = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          const val = from + (target - from) * eased;
          el.textContent = prefix + val.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suffix;
          if (p < 1) requestAnimationFrame(step);
        })(start);
        io.unobserve(el);
      });
    }, { threshold: 0.5 });
    els.forEach(e => io.observe(e));
  }

  /* ---------- SVG line draw ---------- */
  function initDraw(root = document) {
    const els = root.querySelectorAll('[data-draw]:not(.in)');
    requestAnimationFrame(() => {
      els.forEach(el => {
        try {
          const len = el.getTotalLength ? el.getTotalLength() : 300;
          el.style.setProperty('--len', len);
        } catch (e) { el.style.setProperty('--len', 300); }
      });
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { setTimeout(() => en.target.classList.add('in'), 200); io.unobserve(en.target); } });
    }, { threshold: 0.2 });
    els.forEach(e => io.observe(e));
  }

  /* ---------- Spotlight / tilt on cards ---------- */
  function initSpotlight(root = document) {
    root.querySelectorAll('[data-spotlight]').forEach(el => {
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }
  function initTilt(root = document) {
    if (reduce) return;
    root.querySelectorAll('[data-tilt]').forEach(el => {
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - .5;
        const py = (e.clientY - r.top) / r.height - .5;
        el.style.transform = `perspective(900px) rotateY(${px * 8}deg) rotateX(${-py * 8}deg) translateY(-4px)`;
      });
      el.addEventListener('mouseleave', () => { el.style.transform = ''; });
    });
  }

  /* ---------- Parallax ---------- */
  function initParallax() {
    const els = document.querySelectorAll('[data-parallax]');
    if (!els.length || reduce) return;
    const onScroll = () => {
      const y = window.scrollY;
      els.forEach(el => {
        const s = parseFloat(el.dataset.parallax) || 0.2;
        el.style.transform = `translateY(${y * s}px)`;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Typewriter ---------- */
  function initType(root = document) {
    root.querySelectorAll('[data-type]').forEach(el => {
      const words = el.dataset.type.split('|');
      let w = 0, i = 0, deleting = false;
      el.textContent = '';
      (function tick() {
        const word = words[w];
        i += deleting ? -1 : 1;
        el.textContent = word.slice(0, i);
        let delay = deleting ? 45 : 85;
        if (!deleting && i === word.length) { deleting = true; delay = 1400; }
        else if (deleting && i === 0) { deleting = false; w = (w + 1) % words.length; delay = 300; }
        setTimeout(tick, delay);
      })();
    });
  }

  /* ---------- Ripple on buttons ---------- */
  function initRipple(root = document) {
    root.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const r = btn.getBoundingClientRect();
        const s = document.createElement('span');
        s.style.cssText = `position:absolute;left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;width:12px;height:12px;border-radius:50%;background:rgba(255,255,255,.5);transform:translate(-50%,-50%);pointer-events:none;animation:ripple .6s ease-out;`;
        btn.appendChild(s);
        setTimeout(() => s.remove(), 620);
      });
    });
    if (!document.getElementById('ripple-kf')) {
      const st = document.createElement('style'); st.id = 'ripple-kf';
      st.textContent = '@keyframes ripple{to{opacity:0;transform:translate(-50%,-50%) scale(22)}}';
      document.head.appendChild(st);
    }
  }

  /* ---------- Helpers ---------- */
  const ui = {
    toast,
    count: (n, dec = 0) => Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec }),
    money: (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    async copy(text) {
      try { await navigator.clipboard.writeText(text); toast('已复制到剪贴板', 'ok', 1600); }
      catch { toast('复制失败', 'err'); }
    },
    download(filename, content, mime = 'text/plain') {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 800);
    }
  };

  function initAll() {
    initReveal(); initCounters(); initDraw(); initSpotlight(); initTilt();
    initParallax(); initType(); initRipple();
  }

  window.ui = ui;
  window.UIInit = initAll;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
