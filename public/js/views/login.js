/**
 * views/login.js  —  Login screen
 */
'use strict';

const LoginView = (() => {
  function render() {
    document.getElementById('app-bar').classList.add('hidden');
    document.getElementById('bottom-nav').classList.add('hidden');
    document.getElementById('view-root').innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <div class="login-logo">
            <div class="logo-mark">S</div>
            <h1>SchoolApp</h1>
            <p>Sign in to your account</p>
          </div>
          <form id="login-form" novalidate>
            <div style="display:flex;flex-direction:column;gap:16px;">
              <div class="form-group">
                <label class="form-label" for="inp-username">Username</label>
                <input class="form-input" id="inp-username" type="text"
                  placeholder="Enter your username" autocomplete="username"
                  autocapitalize="none" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="inp-password">Password</label>
                <input class="form-input" id="inp-password" type="password"
                  placeholder="Enter your password" autocomplete="current-password" required />
              </div>
              <div id="login-error" class="hidden at-risk-banner" style="margin-top:4px;"></div>
              <button class="btn btn-primary btn-full" type="submit" id="btn-login">
                Sign In
              </button>
            </div>
          </form>
        </div>
        <p style="margin-top:20px;font-size:0.78rem;color:var(--text-3);">
          Contact your administrator if you cannot sign in.
        </p>
      </div>`;

    const form  = document.getElementById('login-form');
    const errEl = document.getElementById('login-error');
    const btnEl = document.getElementById('btn-login');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.classList.add('hidden');
      const username = document.getElementById('inp-username').value.trim();
      const password = document.getElementById('inp-password').value;
      if (!username || !password) { showErr('Please enter your username and password.'); return; }

      btnEl.textContent = 'Signing in…';
      btnEl.disabled = true;
      try {
        const data = await API.auth.login(username, password);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        window.App.afterLogin(data.user);
      } catch (err) {
        showErr(err.message || 'Login failed. Please try again.');
        btnEl.textContent = 'Sign In';
        btnEl.disabled = false;
      }
    });

    function showErr(msg) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }

    // Focus first field
    setTimeout(() => document.getElementById('inp-username')?.focus(), 80);
  }

  return { render };
})();

window.LoginView = LoginView;
