/* FlowDesk 共享工具：主题、Toast、格式化、下载、复制 */
(function () {
  'use strict';
  var THEME_KEY = 'fd_theme';

  function currentTheme() {
    return document.documentElement.dataset.theme || 'dark';
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    document.querySelectorAll('[data-theme-icon]').forEach(function (el) {
      el.textContent = theme === 'dark' ? '☀' : '☾';
    });
  }
  function toggleTheme() {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(value, dec) {
    dec = dec == null ? 0 : dec;
    return Number(value || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: dec, maximumFractionDigits: dec
    });
  }

  function money(value, symbol) {
    symbol = symbol || '¥';
    return symbol + num(value, 2);
  }

  function timeAgo(value) {
    if (!value) return '';
    var text = String(value).replace(' ', 'T');
    var date = new Date(text.length <= 10 ? text + 'T00:00:00Z' : text + 'Z');
    if (isNaN(date.getTime())) return value;
    var diff = Math.max(0, (Date.now() - date.getTime()) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
    return date.toLocaleDateString('zh-CN');
  }

  function toast(message, type, ms) {
    var wrap = document.getElementById('toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    var icon = type === 'err' ? '✕' : type === 'warn' ? '!' : '✓';
    el.innerHTML = '<span class="ico">' + icon + '</span><span>' + esc(message) + '</span>';
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(24px)';
      setTimeout(function () { el.remove(); }, 320);
    }, ms || 2600);
  }

  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 900);
  }

  function copy(text, okMessage) {
    var done = function () { toast(okMessage || '已复制到剪贴板', 'ok', 1600); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败', 'err'); }
      ta.remove();
    }
  }

  function initials(name) {
    var text = String(name || '?').trim();
    return text ? text.slice(0, 1).toUpperCase() : '?';
  }

  function debounce(fn, wait) {
    var timer;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait || 300);
    };
  }

  window.FDTheme = { apply: applyTheme, toggle: toggleTheme, current: currentTheme };
  window.FD = {
    esc: esc, num: num, money: money, timeAgo: timeAgo, toast: toast,
    download: download, copy: copy, initials: initials, debounce: debounce
  };
  applyTheme(currentTheme());
})();
