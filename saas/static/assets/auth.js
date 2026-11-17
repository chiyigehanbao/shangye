/* 登录 / 注册 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var mode = params.get('mode') === 'register' ? 'register' : 'login';
  var inviteToken = params.get('invite') || '';
  var submitting = false;

  var themeBtn = $('themeBtn');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    FDTheme.toggle();
    themeBtn.textContent = FDTheme.current() === 'dark' ? '☀' : '☾';
  });
  themeBtn.textContent = FDTheme.current() === 'dark' ? '☀' : '☾';

  function setMode(next) {
    mode = next;
    document.querySelectorAll('#authTabs button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.mode === mode);
    });
    $('registerFields').classList.toggle('hidden', mode !== 'register');
    $('authTitle').textContent = mode === 'register' ? '创建工作区' : '欢迎回来';
    $('authSub').textContent = mode === 'register'
      ? '30 秒创建独立空间，Free 套餐直接可用全部模块。'
      : '登录你的工作区，继续处理今天的任务。';
    $('submitBtn').textContent = mode === 'register' ? '创建并进入 →' : '登录';
    $('password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('authErr').textContent = '';
  }

  document.querySelectorAll('#authTabs button').forEach(function (btn) {
    btn.addEventListener('click', function () { setMode(btn.dataset.mode); });
  });

  $('pwToggle').addEventListener('click', function () {
    var input = $('password');
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('pwToggle').textContent = show ? '隐藏' : '显示';
  });

  function fillDemo() {
    $('email').value = 'demo@flowdesk.dev';
    $('password').value = 'Demo@12345';
    setMode('login');
    $('submitBtn').focus();
  }
  $('demoFill').addEventListener('click', fillDemo);

  async function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var res = await fetch(path, options);
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var detail = data && data.detail;
      var message = typeof detail === 'string' ? detail : (detail && detail.message) || ('请求失败（' + res.status + '）');
      throw new Error(message);
    }
    return data;
  }

  async function acceptInvite() {
    if (!inviteToken) return;
    try {
      await api('/api/workspace/invites/accept', {
        method: 'POST', body: JSON.stringify({ token: inviteToken })
      });
      FD.toast('已加入邀请的工作区', 'ok');
    } catch (e) {
      FD.toast('加入工作区失败：' + e.message, 'err', 4000);
    }
  }

  async function submit(event) {
    if (event) event.preventDefault();
    if (submitting) return;
    $('authErr').textContent = '';
    submitting = true;
    var btn = $('submitBtn');
    var original = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> 处理中…';

    var payload = {
      email: $('email').value.trim(),
      password: $('password').value
    };
    if (mode === 'register') {
      payload.name = $('name').value.trim();
      payload.workspace_name = $('workspace').value.trim();
    }

    try {
      if (mode === 'register') {
        await api('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        await api('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
      }
      await acceptInvite();
      location.href = '/app';
    } catch (e) {
      $('authErr').textContent = e.message;
      btn.disabled = false;
      btn.textContent = original;
      submitting = false;
    }
  }

  $('authForm').addEventListener('submit', submit);

  // 已登录直接进应用
  fetch('/api/auth/me', { credentials: 'same-origin' }).then(function (res) {
    if (res.ok) {
      if (inviteToken) {
        acceptInvite().then(function () { location.href = '/app'; });
      } else {
        location.href = '/app';
      }
    } else if (params.get('demo') === '1') {
      fillDemo();
      setTimeout(submit, 250);
    }
  }).catch(function () {});

  setMode(mode);
})();
