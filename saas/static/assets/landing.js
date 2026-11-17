/* 落地页交互 */
(function () {
  'use strict';
  var themeBtn = document.getElementById('themeBtn');
  if (themeBtn) themeBtn.addEventListener('click', function () { FDTheme.toggle(); });

  var copyBtn = document.getElementById('copyDemo');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    FD.copy('demo@flowdesk.dev / Demo@12345', '演示账号已复制');
  });

  // 滚动出现
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var revealEls = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  // 数字滚动
  document.querySelectorAll('[data-count]').forEach(function (el) {
    var target = parseFloat(el.dataset.count) || 0;
    if (reduce || document.hidden) { el.textContent = target; return; }
    var start = performance.now();
    var dur = 1100;
    (function step(now) {
      var p = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased);
      if (p < 1) requestAnimationFrame(step);
    })(start);
  });

  // FAQ
  document.querySelectorAll('.faq-q').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.parentElement;
      var isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(function (x) { x.classList.remove('open'); });
      if (!isOpen) item.classList.add('open');
    });
  });

  // 定价周期
  var cycleButtons = document.querySelectorAll('[data-cycle]');
  cycleButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      cycleButtons.forEach(function (b) { b.classList.toggle('on', b === btn); });
      var yearly = btn.dataset.cycle === 'yearly';
      document.querySelectorAll('[data-monthly]').forEach(function (el) {
        el.childNodes[0].nodeValue = yearly ? el.dataset.yearly : el.dataset.monthly;
        var unit = el.querySelector('[data-unit]');
        if (unit) unit.textContent = yearly ? ' / 年' : ' / 月';
      });
    });
  });

  // 轻微视差
  if (!reduce) {
    var visual = document.querySelector('.l-hero-visual');
    window.addEventListener('scroll', function () {
      if (!visual || window.scrollY > 700) return;
      visual.style.transform = 'translateY(' + window.scrollY * 0.04 + 'px)';
    }, { passive: true });
  }
})();
