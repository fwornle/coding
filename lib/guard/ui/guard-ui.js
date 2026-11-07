/*
 * coding guard — approval and enrolment pages (served by
 * scripts/coding-guard-daemon.mjs under a CSP that forbids inline script).
 *
 * Everything an agent wrote (rule, reason, excerpt, file) is rendered with
 * textContent, never as HTML. WebAuthn goes through SimpleWebAuthnBrowser
 * (/assets/webauthn.js); the browser offers Touch ID / Windows Hello, a phone
 * via QR code, or a security key, whichever the user has enrolled.
 */
/* global window, document, location, history */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const WA = () => window.SimpleWebAuthnBrowser;

  function status(text, kind = '') {
    const el = $('status');
    el.textContent = text;
    el.className = kind;
  }

  async function api(method, path, body, headers = {}) {
    const res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function webauthnError(err) {
    if (err && err.name === 'NotAllowedError') return 'cancelled or timed out';
    if (err && err.name === 'InvalidStateError') return 'this authenticator is already enrolled';
    return err && err.message ? err.message : String(err);
  }

  // ── approve page ──────────────────────────────────────────────────────
  async function approvePage() {
    const id = location.pathname.split('/').pop();
    let request;
    let factors;
    try {
      [{ request }, { factors }] = await Promise.all([api('GET', `/requests/${id}`), api('GET', '/factors')]);
    } catch (err) {
      status(`Cannot load this request: ${err.message}`, 'error');
      $('decide').hidden = true;
      return;
    }
    $('r-rule').textContent = request.rule;
    $('r-agent').textContent = request.agent || 'unknown';
    $('r-session').textContent = request.session;
    $('r-file').textContent = request.file || '— (any file)';
    $('r-reason').textContent = request.reason || '—';
    $('r-created').textContent = new Date(request.created).toLocaleString();
    if (request.excerpt) {
      $('r-excerpt').textContent = request.excerpt;
      $('r-excerpt').hidden = false;
    }
    if (request.status !== 'pending') {
      $('decide').hidden = true;
      status(`This request is already ${request.status}.`, request.status === 'approved' ? 'ok' : '');
      return;
    }

    $('btn-passkey').hidden = factors.credentials.length === 0;
    $('form-password').hidden = !factors.password;
    $('no-factors').hidden = factors.credentials.length > 0 || factors.password;

    const scope = () => {
      const value = document.querySelector('input[name=scope]:checked').value;
      return value === 'minutes' ? { scope: value, minutes: Number($('minutes').value) } : { scope: value };
    };
    const done = ({ grant }) => {
      $('decide').hidden = true;
      const until = new Date(grant.payload.exp).toLocaleString();
      status(`Approved (${grant.payload.scope}) until ${until}. You can close this tab.`, 'ok');
    };

    $('btn-passkey').addEventListener('click', async () => {
      status('Waiting for your authenticator…');
      try {
        const { ceremony, options } = await api('POST', `/approve/${id}/options`, scope());
        const response = await WA().startAuthentication({ optionsJSON: options });
        done(await api('POST', `/approve/${id}/verify`, { ceremony, response }));
      } catch (err) {
        status(`Not approved: ${webauthnError(err)}`, 'error');
      }
    });
    $('form-password').addEventListener('submit', async (e) => {
      e.preventDefault();
      status('Checking…');
      try {
        done(await api('POST', `/approve/${id}/password`, { ...scope(), password: $('password').value }));
      } catch (err) {
        status(`Not approved: ${err.message}`, 'error');
      } finally {
        $('password').value = '';
      }
    });
    $('form-recovery').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        done(await api('POST', `/approve/${id}/recovery`, { ...scope(), code: $('recovery-code').value }));
      } catch (err) {
        status(`Not approved: ${err.message}`, 'error');
      }
    });
    $('btn-deny').addEventListener('click', async () => {
      try {
        await api('POST', `/requests/${id}/deny`);
        $('decide').hidden = true;
        status('Denied. The agent has been told no.', '');
      } catch (err) {
        status(err.message, 'error');
      }
    });
  }

  // ── enrol page ────────────────────────────────────────────────────────
  async function enrollPage() {
    // The setup token arrives in the fragment (never sent to a server log);
    // keep it in memory and take it out of the address bar.
    const token = new URLSearchParams(location.hash.slice(1)).get('t');
    if (!token) {
      $('no-token').hidden = false;
      return;
    }
    history.replaceState(null, '', location.pathname);
    const auth = { authorization: `Bearer ${token}` };
    let ticket = null;

    const render = async () => {
      const { factors } = await api('GET', '/factors');
      const has = factors.credentials.length > 0 || factors.password;
      $('unlock').hidden = !has || Boolean(ticket);
      $('btn-unlock-passkey').hidden = factors.credentials.length === 0;
      $('form-unlock-password').hidden = !factors.password;
      $('manage').hidden = has && !ticket;

      const list = $('factor-list');
      list.replaceChildren();
      for (const c of factors.credentials) {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = `${c.label} — ${c.kind}, added ${new Date(c.created).toLocaleDateString()}`;
        const rm = document.createElement('button');
        rm.textContent = 'Remove';
        rm.className = 'small';
        rm.addEventListener('click', async () => {
          try {
            await api('POST', `/factors/${encodeURIComponent(c.id)}/remove`, { ticket }, auth);
            status('Removed.', 'ok');
            render();
          } catch (err) {
            status(err.message, 'error');
          }
        });
        li.append(name, rm);
        list.append(li);
      }
      if (factors.password) {
        const li = document.createElement('li');
        li.textContent = 'Password';
        list.append(li);
      }
      if (!list.children.length) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = 'Nothing enrolled yet.';
        list.append(li);
      }
      $('btn-set-password').textContent = factors.password ? 'Change password' : 'Set password';
      $('recovery-left').textContent = `${factors.recoveryLeft} unused recovery code(s).`;
    };

    const showCodes = (codes) => {
      if (!codes) return;
      const ol = $('code-list');
      ol.replaceChildren(...codes.map((c) => Object.assign(document.createElement('li'), { textContent: c })));
      $('codes').hidden = false;
      $('codes').scrollIntoView({ behavior: 'smooth' });
    };
    const unlocked = (data) => {
      ticket = data.ticket;
      status('Unlocked for 5 minutes.', 'ok');
      render();
    };

    $('btn-unlock-passkey').addEventListener('click', async () => {
      try {
        const { ceremony, options } = await api('POST', '/manage/options');
        const response = await WA().startAuthentication({ optionsJSON: options });
        unlocked(await api('POST', '/manage/verify', { ceremony, response }));
      } catch (err) {
        status(`Not unlocked: ${webauthnError(err)}`, 'error');
      }
    });
    $('form-unlock-password').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        unlocked(await api('POST', '/manage/password', { password: $('unlock-password').value }));
      } catch (err) {
        status(`Not unlocked: ${err.message}`, 'error');
      } finally {
        $('unlock-password').value = '';
      }
    });
    $('form-unlock-recovery').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        unlocked(await api('POST', '/manage/recovery', { code: $('unlock-recovery').value }));
      } catch (err) {
        status(`Not unlocked: ${err.message}`, 'error');
      }
    });

    for (const tile of document.querySelectorAll('.tile')) {
      tile.addEventListener('click', async () => {
        const kind = tile.dataset.kind;
        const label = { platform: 'This computer', hybrid: 'Phone', 'security-key': 'Security key' }[kind];
        status(kind === 'hybrid' ? 'Scan the QR code with your phone camera…' : 'Follow your browser’s prompt…');
        try {
          const { ceremony, options } = await api('POST', '/enroll/options', { kind, label, ticket }, auth);
          const response = await WA().startRegistration({ optionsJSON: options });
          const data = await api('POST', '/enroll/verify', { ceremony, response, ticket }, auth);
          status(`Enrolled: ${data.credential.label} (${data.credential.kind}).`, 'ok');
          showCodes(data.recoveryCodes);
          render();
        } catch (err) {
          status(`Not enrolled: ${webauthnError(err)}`, 'error');
        }
      });
    }
    $('form-set-password').addEventListener('submit', async (e) => {
      e.preventDefault();
      if ($('new-password').value !== $('new-password-2').value) {
        status('The two passwords differ.', 'error');
        return;
      }
      try {
        const data = await api('POST', '/factors/password', { password: $('new-password').value, ticket }, auth);
        status('Password set.', 'ok');
        showCodes(data.recoveryCodes);
        render();
      } catch (err) {
        status(err.message, 'error');
      } finally {
        $('new-password').value = '';
        $('new-password-2').value = '';
      }
    });
    $('btn-regenerate').addEventListener('click', async () => {
      try {
        showCodes((await api('POST', '/factors/recovery', { ticket }, auth)).recoveryCodes);
        render();
      } catch (err) {
        status(err.message, 'error');
      }
    });

    try {
      await render();
    } catch (err) {
      status(`Cannot reach the guard: ${err.message}`, 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page === 'approve') approvePage();
    else enrollPage();
  });
})();
