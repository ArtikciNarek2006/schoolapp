/**
 * app.js  —  Main entry point / orchestrator
 *
 * Defines window.App, boots the SPA after token validation,
 * manages routing, theme, nav, toasts, and the global modal.
 */
'use strict';

(function () {
  // ─── State ───────────────────────────────────────────────────────────────────
  let _user    = null;
  let _realmId = null;

  // ─── DOM refs (resolved on DOMContentLoaded) ──────────────────────────────────
  let _toast, _overlay, _modal,
      _appBar, _btnBack, _titleEl, _btnTheme, _btnBarAction,
      _viewRoot, _bottomNav, _chatBadge, _noticeBadge;

  // ─── Toast queue ──────────────────────────────────────────────────────────────
  let _toastTimer = null;

  // ─── Theme ────────────────────────────────────────────────────────────────────
  function _applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
    // update icon
    if (_btnTheme) {
      _btnTheme.innerHTML = t === 'dark'
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    }
  }

  // ─── Window.App API ───────────────────────────────────────────────────────────
  window.App = {

    afterLogin(user) {
      _boot(user);
    },

    signOut() {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      SocketManager.disconnect();
      _user    = null;
      _realmId = null;
      _appBar.classList.add('hidden');
      _bottomNav.classList.add('hidden');
      LoginView.render();
    },

    setTitle(text) { if (_titleEl) _titleEl.textContent = text; },

    setBack(fnOrFalse) {
      if (!_btnBack) return;
      if (!fnOrFalse) {
        _btnBack.classList.add('hidden');
        _btnBack.onclick = null;
      } else {
        _btnBack.classList.remove('hidden');
        _btnBack.onclick = fnOrFalse;
      }
    },

    setBarAction(svgHtml, fn) {
      if (!_btnBarAction) return;
      if (!svgHtml) {
        _btnBarAction.classList.add('hidden');
        _btnBarAction.onclick = null;
      } else {
        _btnBarAction.innerHTML = svgHtml;
        _btnBarAction.classList.remove('hidden');
        _btnBarAction.onclick = fn || null;
      }
    },

    toast(message, type = 'info') {
      if (!_toast) return;
      _toast.className  = `toast toast-${type} show`;
      _toast.textContent = message;
      if (_toastTimer) clearTimeout(_toastTimer);
      _toastTimer = setTimeout(() => _toast.classList.remove('show'), 3200);
    },

    showModal({ title, body, actions = [], onAction, onMount } = {}) {
      if (!_overlay || !_modal) return;

      // Build footer
      const footer = actions.length
        ? `<div class="modal-footer">${actions.map((a) =>
            `<button class="btn ${a.cls}" data-action="${a.action}">${esc(a.label)}</button>`
          ).join('')}</div>`
        : '';

      _modal.innerHTML = `
        <div class="modal-header">
          <span class="modal-title">${esc(title)}</span>
        </div>
        <div class="modal-body">${body}</div>
        ${footer}`;

      _overlay.classList.add('show');

      // Wire action buttons
      if (onAction) {
        _modal.querySelectorAll('button[data-action]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const a = btn.dataset.action;
            if (a === 'cancel') { App.closeModal(); return; }
            onAction(a, _modal);
          });
        });
      }

      if (onMount) onMount(_modal);

      // Close on overlay backdrop
      _overlay.onclick = (e) => { if (e.target === _overlay) App.closeModal(); };
    },

    closeModal() {
      if (_overlay) _overlay.classList.remove('show');
      if (_modal) _modal.innerHTML = '';
      _overlay.onclick = null;
    },

    updateChatBadge(n) {
      if (!_chatBadge) return;
      if (n > 0) { _chatBadge.textContent = n > 99 ? '99+' : String(n); _chatBadge.style.display = 'flex'; }
      else { _chatBadge.style.display = 'none'; }
    },

    updateNoticeBadge(delta) {
      if (!_noticeBadge) return;
      let cur = parseInt(_noticeBadge.textContent || '0', 10) || 0;
      cur += delta;
      if (cur > 0) { _noticeBadge.textContent = cur > 99 ? '99+' : String(cur); _noticeBadge.style.display = 'flex'; }
      else { _noticeBadge.style.display = 'none'; }
    },
  };

  // ─── Boot ─────────────────────────────────────────────────────────────────────
  function _boot(user) {
    _user    = user;
    _realmId = user.realmId || null;

    // Persist user
    localStorage.setItem('user', JSON.stringify(user));

    // Connect socket
    const token = localStorage.getItem('token');
    SocketManager.connect(token);

    // Lesson reminder toasts
    SocketManager.on('lesson_reminder', (data) => {
      App.toast(`⏰ Upcoming: ${data.subject} in ${data.minutesBefore} min`, 'info');
    });

    // Show chrome
    _appBar.classList.remove('hidden');
    _bottomNav.classList.remove('hidden');

    // Show / hide admin nav button based on role
    const adminBtn = _bottomNav.querySelector('[data-view="admin"]');
    if (adminBtn) {
      adminBtn.style.display = (user.role === 'senior_admin' || user.role === 'project_admin') ? '' : 'none';
    }

    // Wire bottom nav
    _bottomNav.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => Router.navigate(btn.dataset.view));
    });

    // Register routes
    Router.on('dashboard', () => DashboardView.render(_user, _realmId));
    Router.on('chat',      (p) => ChatView.render(_user, _realmId, p));
    Router.on('notices',   () => NoticesView.render(_user, _realmId));
    Router.on('timetable', () => TimetableView.render(_user, _realmId));
    Router.on('admin',     () => {
      if (_user.role === 'senior_admin' || _user.role === 'project_admin') {
        AdminView.render(_user, _realmId);
      } else {
        Router.navigate('dashboard');
      }
    });
    Router.on('profile',   () => ProfileView.render(_user, _realmId));

    // Active tab highlight on route change
    Router.onNavigate((name) => {
      _bottomNav.querySelectorAll('[data-view]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.view === name);
      });
      // Clear unread badge when entering chat/notices
      if (name === 'chat')    App.updateChatBadge(0);
      if (name === 'notices') {
        if (_noticeBadge) { _noticeBadge.style.display = 'none'; _noticeBadge.textContent = '0'; }
      }
      // Destroy previous view if applicable
      if (name !== 'chat' && typeof ChatView !== 'undefined' && ChatView.destroy) ChatView.destroy();
    });

    Router.start('dashboard');
  }

  // ─── DOMContentLoaded ─────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    // Resolve DOM refs
    _toast        = document.getElementById('toast-container');
    _overlay      = document.getElementById('overlay');
    _modal        = document.getElementById('modal');
    _appBar       = document.getElementById('app-bar');
    _btnBack      = document.getElementById('btn-back');
    _titleEl      = document.getElementById('app-bar-title');
    _btnTheme     = document.getElementById('btn-theme');
    _btnBarAction = document.getElementById('btn-bar-action');
    _viewRoot     = document.getElementById('view-root');
    _bottomNav    = document.getElementById('bottom-nav');
    _chatBadge    = document.getElementById('chat-badge');
    _noticeBadge  = document.getElementById('notice-badge');

    // Apply saved theme
    _applyTheme(localStorage.getItem('theme') || 'light');

    // Theme toggle
    _btnTheme.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      _applyTheme(cur === 'dark' ? 'light' : 'dark');
    });

    // Check existing session
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const res  = await API.auth.me();
        const user = res.data;
        _boot(user);
        return;
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }

    // Not logged in → show login
    _appBar.classList.add('hidden');
    _bottomNav.classList.add('hidden');
    LoginView.render();
  });

  // ─── Utility ──────────────────────────────────────────────────────────────────
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
})();
