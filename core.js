/* =========================================================================
   Marketplenum — core.js (20 Nov 2026, C5 Oversight)

   The site's own behaviour: sign-in state in the header, the login dialog
   (Google or e-mail + password; same accounts as solvephantasma.com, one
   Supabase project), the account page and the service tiles.

   The same login logic also lives in solvephantasma.com's script.js and in
   tenders/app.js: a change to how login works must be repeated there.
   The apps in /campaigns/ and /ecommerce/ are released copies from the test
   site (solvephantasma.com) and create their own Supabase client; they send a
   signed-out visitor to ../account.html or ../services.html, which bring them
   back here and, after the login, back into the app (PENDING_KEY).

   1. Settings + client   2. Header + after sign-in   3. Login dialog
   4. Service tiles       5. Account page             6. Start
   ========================================================================= */
(function () {
  'use strict';

  /* -----------------------------------------------------------------------
     1. Settings + client
     ----------------------------------------------------------------------- */
  const SUPABASE_URL = 'https://muumpjtpjnoxxdkhqtik.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_R6Ruxp1ehYAGVcFRqrM_Lg_n1ahoV8e';
  // Google Cloud project phantasma-508619, client "Phantasma website": its
  // Authorized JavaScript origins list https://marketplenum.com (20 Nov 2026).
  const GOOGLE_CLIENT_ID = '396544181713-ecijt1nf7u1qs4tej5n51vh7p4uu7m66.apps.googleusercontent.com';

  const PENDING_KEY = 'mp_pending';               // app path to open after the login
  const APP_PATH = /^\/(campaigns|ecommerce)\//;  // the only places we send people back to
  const KA = document.documentElement.lang === 'ka';

  const sb = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;
  let session = null;
  let lastEvent = null;

  // For the shared Messages / Feedback / admin code (career.js), same hook as
  // on solvephantasma.com: it calls PhantasmaAuth.db() and listens to
  // the phantasma:auth event.
  window.PhantasmaAuth = { db: () => sb, session: () => session };

  function setPending(path) {
    try { if (path && APP_PATH.test(path)) sessionStorage.setItem(PENDING_KEY, path); } catch (e) { /* storage off */ }
  }
  function hasPending() {
    try { return APP_PATH.test(sessionStorage.getItem(PENDING_KEY) || ''); } catch (e) { return false; }
  }
  function takePending() {
    try {
      const p = sessionStorage.getItem(PENDING_KEY);
      sessionStorage.removeItem(PENDING_KEY);
      return p && APP_PATH.test(p) ? p : null;
    } catch (e) { return null; }
  }
  function clearPending() {
    try { sessionStorage.removeItem(PENDING_KEY); } catch (e) { /* storage off */ }
  }

  // The page the visitor came from, if it is on this site: path + hash.
  function sameSiteReferrer() {
    try {
      if (!document.referrer) return null;
      const u = new URL(document.referrer);
      return u.origin === location.origin ? u.pathname + u.hash : null;
    } catch (e) { return null; }
  }

  /* -----------------------------------------------------------------------
     2. Header + after sign-in
     ----------------------------------------------------------------------- */
  // Every .js-auth link: "Log in" (opens the dialog) or "My account".
  // Labels live on the element, so the Georgian page supplies its own.
  function paint() {
    const signedIn = !!session;
    document.querySelectorAll('.js-auth').forEach((el) => {
      el.textContent = signedIn ? el.dataset.labelAccount : el.dataset.labelLogin;
      el.dataset.state = signedIn ? 'in' : 'out';
    });
    document.dispatchEvent(new CustomEvent('phantasma:auth', { detail: { session, event: lastEvent } }));
  }

  // supabase-js also fires SIGNED_IN when a tab regains focus, so only a
  // login started on this page (the dialog was open) moves the visitor on.
  let loginStarted = false;
  function afterSignIn() {
    if (!loginStarted) return;
    loginStarted = false;
    Dialog.close();
    const next = takePending();
    if (next) location.assign(next);
  }

  /* -----------------------------------------------------------------------
     3. Login dialog (#auth-modal) — markup and styles are solvephantasma's
        (styles.css section 26); three modes on one form.
     ----------------------------------------------------------------------- */
  function trapTab(box, e) {
    if (e.key !== 'Tab' || !box) return;
    const items = Array.from(box.querySelectorAll(
      'a[href], button, input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.disabled && el.getClientRects().length > 0);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const here = document.activeElement;
    const inside = box.contains(here);
    if (e.shiftKey && (here === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (here === last || !inside)) { e.preventDefault(); first.focus(); }
  }

  // Google Identity Services: loaded only when the dialog first opens.
  let gisLoading = null;
  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
    if (!gisLoading) {
      gisLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = resolve;
        s.onerror = () => { s.remove(); gisLoading = null; reject(new Error('gis')); };
        document.head.appendChild(s);
      });
    }
    return gisLoading;
  }
  // Raw nonce for Supabase, its SHA-256 (hex) for Google.
  async function googleNonce() {
    const raw = btoa(String.fromCharCode.apply(null, crypto.getRandomValues(new Uint8Array(32))));
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hashed = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    return { raw, hashed };
  }

  const Dialog = (() => {
    const modal = document.getElementById('auth-modal');
    if (!modal || !sb) return { open() {}, close() {} };

    const form = modal.querySelector('#auth-form');
    const title = modal.querySelector('#auth-title');
    const email = modal.querySelector('#auth-email');
    const password = modal.querySelector('#auth-password');
    const pwRow = modal.querySelector('#auth-pw-row');
    const pwHint = modal.querySelector('#auth-pw-hint');
    const submit = modal.querySelector('#auth-submit');
    const switcher = modal.querySelector('#auth-switch');
    const forgot = modal.querySelector('#auth-forgot');
    const google = modal.querySelector('#auth-google');
    const status = modal.querySelector('#auth-status');
    let lastFocus = null;

    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    function say(kind, text) {
      status.textContent = text;
      status.dataset.kind = kind;
      status.hidden = !text;
    }
    function setMode(mode) {
      form.dataset.mode = mode;
      title.textContent = title.dataset['title' + cap(mode)];
      submit.textContent = submit.dataset['label' + cap(mode)];
      switcher.textContent = switcher.dataset['label' + cap(mode)];
      pwRow.hidden = mode === 'forgot';
      password.required = mode !== 'forgot';
      password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
      pwHint.hidden = mode !== 'signup';
      forgot.hidden = mode !== 'login';
      say('', '');
    }
    function open(mode) {
      lastFocus = document.activeElement;
      loginStarted = true;
      setMode(mode || 'login');
      modal.hidden = false;
      requestAnimationFrame(() => modal.classList.add('is-open'));
      document.body.classList.add('is-locked');
      email.focus();
      showGoogle().catch(() => {});   // #auth-google stays as the fallback
    }
    function close() {
      if (modal.hidden) return;
      modal.classList.remove('is-open');
      modal.hidden = true;
      document.body.classList.remove('is-locked');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    // Closed by the visitor (✕, backdrop, Esc) = no sign-in: forget where
    // they wanted to go, so a later login does not jump there.
    function dismiss() {
      loginStarted = false;
      clearPending();
      close();
    }

    modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', dismiss));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) dismiss();
      else if (!modal.hidden) trapTab(modal, e);
    });
    switcher.addEventListener('click', () => setMode(form.dataset.mode === 'login' ? 'signup' : 'login'));
    forgot.addEventListener('click', () => setMode('forgot'));

    // Supabase's error messages → the page's own copy (data-msg-* on the form).
    function explain(error) {
      const m = (error && error.message || '').toLowerCase();
      if (m.includes('invalid login credentials')) return form.dataset.msgBadLogin;
      if (m.includes('already registered') || m.includes('already exists')) return form.dataset.msgExists;
      if (m.includes('password') && (m.includes('short') || m.includes('at least'))) return form.dataset.msgWeak;
      if (m.includes('not confirmed')) return form.dataset.msgUnconfirmed;
      if (m.includes('rate limit')) return form.dataset.msgRateLimit;
      return form.dataset.msgError;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const mode = form.dataset.mode;
      const mail = email.value.trim();
      const pw = password.value;
      if (!mail) { email.focus(); return; }
      if (mode !== 'forgot' && pw.length < 8) { say('error', form.dataset.msgWeak); password.focus(); return; }
      say('busy', form.dataset.msgSending);

      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email: mail, password: pw });
        if (error) say('error', explain(error));   // success: SIGNED_IN → afterSignIn
      } else if (mode === 'signup') {
        // The confirmation e-mail brings them back to this page.
        const { data, error } = await sb.auth.signUp({
          email: mail, password: pw, options: { emailRedirectTo: location.origin + location.pathname },
        });
        if (error) { say('error', explain(error)); return; }
        // Supabase returns a user without identities when the e-mail already exists.
        if (data.user && data.user.identities && data.user.identities.length === 0) { say('error', form.dataset.msgExists); return; }
        if (data.session) return;   // confirmations off → signed in already
        say('ok', form.dataset.msgSignupSent.replace('{email}', mail));
      } else {
        // The reset e-mail lands on account.html, which shows "Set a new password".
        const { error } = await sb.auth.resetPasswordForEmail(mail, { redirectTo: location.origin + '/account.html' });
        if (error) { say('error', explain(error)); return; }
        say('ok', form.dataset.msgForgotSent.replace('{email}', mail));
      }
    });

    // Google's own button replaces #auth-google once its script has loaded,
    // so Google's window names this site. Drawn once; kept for later opens.
    let gisShown = null;
    function showGoogle() {
      if (!gisShown) {
        gisShown = Promise.all([loadGis(), googleNonce()]).then(([, nonce]) => {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            nonce: nonce.hashed,
            callback: async (res) => {
              say('busy', form.dataset.msgSending);
              const { error } = await sb.auth.signInWithIdToken({ provider: 'google', token: res.credential, nonce: nonce.raw });
              if (error) say('error', form.dataset.msgError);   // success: SIGNED_IN → afterSignIn
            },
          });
          const slot = document.createElement('div');
          slot.className = 'auth-modal__gis';
          google.after(slot);
          window.google.accounts.id.renderButton(slot, {
            type: 'standard', theme: 'outline', size: 'large', shape: 'rectangular',
            text: 'continue_with', logo_alignment: 'center',
            width: Math.max(200, Math.min(400, slot.offsetWidth || 320)),   // Google allows 200–400 px
            locale: KA ? 'ka' : 'en',
          });
          google.hidden = true;
        }).catch((err) => { gisShown = null; throw err; });
      }
      return gisShown;
    }
    google.addEventListener('click', () => {
      say('busy', form.dataset.msgSending);
      showGoogle().then(() => say('', ''), () => say('error', form.dataset.msgError));
    });

    return { open, close };
  })();

  // Header "Log in": signed out it opens the dialog; signed in it is a plain
  // link to the account page.
  function bootHeader() {
    document.querySelectorAll('.js-auth').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (session || !sb) return;
        e.preventDefault();
        Dialog.open('login');
      });
    });
  }

  /* -----------------------------------------------------------------------
     4. Service tiles — a released service's tile links with data-needs-login:
        signed out, the login opens first and the service follows.
     ----------------------------------------------------------------------- */
  function bootServiceLinks() {
    document.querySelectorAll('a[data-needs-login]').forEach((a) => {
      a.addEventListener('click', async (e) => {
        if (session || !sb) return;
        e.preventDefault();
        const { data } = await sb.auth.getSession();
        if (data.session) { location.assign(a.href); return; }
        setPending(new URL(a.href, location.href).pathname);
        Dialog.open('login');
      });
    });
  }

  /* -----------------------------------------------------------------------
     5. Account page (#account) — views: loading / out / recovery / in
     ----------------------------------------------------------------------- */
  function bootAccount() {
    const root = document.getElementById('account');
    if (!root) return;
    const views = root.querySelectorAll('[data-view]');
    const show = (name) => views.forEach((v) => { v.hidden = v.dataset.view !== name; });
    const APP_NAMES = { campaigns: 'Advertising platform', ecommerce: 'Marketplace automation' };
    const say = (el, kind, text) => { el.textContent = text; el.dataset.kind = kind; };
    const ref = sameSiteReferrer();
    const fromApp = ref && APP_PATH.test(ref) ? ref : null;
    let recovering = false;

    if (!sb) {
      say(root.querySelector('[data-view="loading"]'), 'error', 'Sign-in could not load. Please reload the page.');
      return;
    }

    // A link from a Supabase e-mail that failed (expired, used twice …).
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.get('error_description')) {
      const p = document.createElement('p');
      p.className = 'mp-status';
      p.dataset.kind = 'error';
      p.textContent = hash.get('error_code') === 'otp_expired'
        ? 'That link has expired. Log in and choose "Forgot password?" to get a new one.'
        : 'That link did not work: ' + hash.get('error_description');
      root.querySelector('[data-view="out"]').prepend(p);
    }

    function render() {
      if (recovering) { show('recovery'); return; }
      if (!session) {
        if (fromApp) setPending(fromApp);   // came from an app's "Log in": go back after it
        show('out');
        return;
      }
      root.querySelector('[data-email]').textContent = session.user.email || '';
      const back = root.querySelector('[data-back]');
      if (fromApp) {
        back.href = fromApp;
        back.textContent = 'Back to ' + APP_NAMES[fromApp.split('/')[1]];
      }
      show('in');
    }
    document.addEventListener('phantasma:auth', (e) => {
      if (e.detail.event === 'PASSWORD_RECOVERY') recovering = true;
      render();
    });

    root.querySelector('[data-open-login]').addEventListener('click', () => Dialog.open('login'));

    function explainPw(error) {
      const m = (error && error.message || '').toLowerCase();
      if (m.includes('different from the old')) return 'The new password must be different from the old one.';
      if (m.includes('reauthentication') || m.includes('recent')) return 'For safety, log out, log in again and then change the password.';
      return 'That didn\'t work — please try again.';
    }
    function bindPasswordForm(formId, statusId, done) {
      const form = document.getElementById(formId);
      const status = document.getElementById(statusId);
      const [pw1, pw2] = form.querySelectorAll('input[type="password"]');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (pw1.value.length < 8) { say(status, 'error', 'Password must be at least 8 characters.'); pw1.focus(); return; }
        if (pw1.value !== pw2.value) { say(status, 'error', 'The two passwords are not the same.'); pw2.focus(); return; }
        say(status, 'busy', 'One moment…');
        const { error } = await sb.auth.updateUser({ password: pw1.value });
        if (error) { say(status, 'error', explainPw(error)); return; }
        form.reset();
        done(status);
      });
    }
    bindPasswordForm('password-form', 'password-status', (status) => say(status, 'ok', 'Your password is changed.'));
    bindPasswordForm('recovery-form', 'recovery-status', () => {
      recovering = false;
      render();
      say(document.getElementById('password-status'), 'ok', 'Your new password is saved. You are logged in.');
    });

    document.getElementById('signout').addEventListener('click', async () => {
      await sb.auth.signOut();
      location.assign('./');
    });

    // Delete: server-side request_account_deletion() records the request,
    // e-mails the owner and deletes the login (one login for both sites).
    const ok = document.getElementById('delete-ok');
    const del = document.getElementById('delete-btn');
    const delStatus = document.getElementById('delete-status');
    ok.addEventListener('change', () => { del.disabled = !ok.checked; });
    del.addEventListener('click', async () => {
      if (!ok.checked) return;
      del.disabled = true;
      say(delStatus, 'busy', 'One moment…');
      const { error } = await sb.rpc('request_account_deletion');
      if (error) {
        del.disabled = false;
        say(delStatus, 'error', 'That didn\'t work — please try again, or write to consult@solvephantasma.com.');
        return;
      }
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      say(delStatus, 'ok', 'Your account is deleted.');
      setTimeout(() => location.assign('./'), 2500);
    });
  }

  /* -----------------------------------------------------------------------
     6. Start
     ----------------------------------------------------------------------- */
  function boot() {
    bootHeader();
    bootServiceLinks();
    bootAccount();

    if (!sb) {
      // supabase-js did not load (CDN blocked): the header link still goes
      // to the account page, which explains.
      document.querySelectorAll('.js-auth').forEach((el) => { el.dataset.state = 'out'; });
      return;
    }
    let firstPaint = true;
    function painted() {
      // Came from an app's login link (services.html / account.html set the
      // way back): open the login at once.
      if (firstPaint && !session && hasPending() && !document.getElementById('account')) Dialog.open('login');
      firstPaint = false;
    }
    sb.auth.onAuthStateChange((event, s) => {
      session = s;
      lastEvent = event;
      paint();
      if (event === 'SIGNED_IN') afterSignIn();
    });
    sb.auth.getSession().then(({ data }) => {
      session = data.session;
      paint();
      painted();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
