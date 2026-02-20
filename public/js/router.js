/**
 * router.js  —  Simple hash-based SPA router
 *
 * Routes: #dashboard | #chat | #chat/:groupId | #notices | #timetable | #admin | #profile
 *
 * Usage:
 *   Router.navigate('chat')
 *   Router.navigate('chat', { groupId: 'abc' })
 *   Router.on('chat', handler)    // handler(params)
 */
'use strict';

const Router = (() => {
  const _routes = {};          // name → fn(params)
  const _onNavCbs = [];        // onNavigate listeners
  let   _current = null;

  function on(name, fn) { _routes[name] = fn; }

  /** Register a callback invoked on every route change */
  function onNavigate(fn) { _onNavCbs.push(fn); }

  function navigate(name, params = {}) {
    const hash = params.groupId ? `#${name}/${params.groupId}` : `#${name}`;
    history.pushState({ name, params }, '', hash);
    _resolve(name, params);
  }

  function _resolve(name, params = {}) {
    _current = name;
    _onNavCbs.forEach((cb) => { try { cb(name, params); } catch { /* ignore */ } });
    (_routes[name] || _routes['404'] || (() => {}))({ ...params });
  }

  function _parseHash() {
    const raw = location.hash.replace('#', '') || '';
    const parts = raw.split('/');
    const name  = parts[0] || 'dashboard';
    const params = parts[1] ? { groupId: parts[1] } : {};
    return { name, params };
  }

  function start(defaultRoute = 'dashboard') {
    window.addEventListener('popstate', () => {
      const { name, params } = _parseHash();
      _resolve(name, params);
    });
    const { name, params } = _parseHash();
    _resolve(name || defaultRoute, params);
  }

  function current() { return _current; }

  return { on, onNavigate, navigate, start, current };
})();

window.Router = Router;
