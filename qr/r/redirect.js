/*
 * QR redirector.
 *
 * Resolves ?c=<code> against links.json, then either redirects straight to the
 * destination, shows a landing page, or asks for an email address first.
 *
 * Everything here runs on static hosting (GitHub Pages) — there is no server.
 * Email addresses are POSTed directly from the visitor's browser to whatever
 * collection endpoint the link is configured with.
 */
(function () {
  'use strict';

  var LINKS_URL = '../links.json';
  var SEND_TIMEOUT_MS = 8000;
  var STORAGE_PREFIX = 'qr.gate.';

  // ---------------------------------------------------------------- helpers

  function $(id) { return document.getElementById(id); }

  var PANELS = ['loading', 'landing', 'gate', 'error'];

  function show(name) {
    PANELS.forEach(function (p) {
      var el = $('panel-' + p);
      if (el) el.hidden = (p !== name);
    });
  }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value == null ? '' : String(value);
  }

  /** Only ever hand http(s) URLs to the browser — never javascript:, data:, etc. */
  function safeUrl(raw) {
    if (!raw) return null;
    var u;
    try {
      u = new URL(String(raw), window.location.href);
    } catch (e) {
      return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  }

  function hostOf(url) {
    try { return new URL(url).host; } catch (e) { return ''; }
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
  }

  function getCode() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get('c') || params.get('code');
    if (!code && window.location.hash.length > 1) {
      try { code = decodeURIComponent(window.location.hash.slice(1)); }
      catch (e) { code = window.location.hash.slice(1); }
    }
    return String(code || '').trim();
  }

  function store(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  function read(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function fail(title, message) {
    setText('error-title', title);
    setText('error-message', message);
    document.title = title;
    show('error');
  }

  function go(url) {
    window.location.replace(url);
  }

  /** Accept only simple colour literals so nothing can escape into the stylesheet. */
  function applyAccent(color) {
    if (typeof color === 'string' && /^#[0-9a-f]{3,8}$/i.test(color.trim())) {
      document.documentElement.style.setProperty('--accent', color.trim());
    }
  }

  function applyLogo(id, url) {
    var src = safeUrl(url);
    if (!src) return;
    var img = $(id);
    if (!img) return;
    img.src = src;
    img.hidden = false;
  }

  function showDestination(wrapId, hostId, url) {
    var host = hostOf(url);
    if (!host) return;
    setText(hostId, host);
    var el = $(wrapId);
    if (el) el.hidden = false;
  }

  // ------------------------------------------------------------ email relay

  function postWithTimeout(url, options) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) options.signal = controller.signal;
    var timer = window.setTimeout(function () {
      if (controller) controller.abort();
    }, SEND_TIMEOUT_MS);
    return fetch(url, options).then(
      function (res) { window.clearTimeout(timer); return res; },
      function (err) { window.clearTimeout(timer); throw err; }
    );
  }

  /**
   * Deliver the captured address to the configured endpoint.
   * Resolves when delivered (or when no endpoint is configured); rejects if the
   * endpoint is unreachable, so the caller can tell the visitor.
   */
  function deliverEmail(gate, email, link) {
    var type = gate.endpointType || 'none';
    var endpoint = safeUrl(gate.endpoint);
    var field = gate.fieldName || 'email';

    if (type === 'none' || !endpoint) {
      return Promise.resolve({ delivered: false, reason: 'no-endpoint' });
    }

    // Google Forms never sends CORS headers; fire-and-forget is the only option.
    if (type === 'googleform') {
      var form = new URLSearchParams();
      form.set(field, email);
      return postWithTimeout(endpoint, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString()
      }).then(function () { return { delivered: true, opaque: true }; });
    }

    var payload = {};
    payload[field] = email;
    payload.code = link.code;
    payload.title = link.title || '';
    payload.destination = link.destination;
    payload.pageUrl = window.location.href;
    payload.submittedAt = new Date().toISOString();

    var headers = { 'Content-Type': 'application/json' };
    if (type === 'formspree') headers.Accept = 'application/json';

    return postWithTimeout(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('Endpoint responded ' + res.status);
      return { delivered: true };
    }).catch(function (err) {
      // Generic webhooks (Zapier, Make, n8n…) often reject the CORS preflight
      // even though they accept the payload. Retry opaquely with a simple
      // content type, which needs no preflight.
      if (type === 'webhook') {
        return postWithTimeout(endpoint, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        }).then(function () { return { delivered: true, opaque: true }; });
      }
      throw err;
    });
  }

  // --------------------------------------------------------------- screens

  function renderLanding(link, dest) {
    var landing = link.landing || {};
    applyAccent(landing.accent);
    applyLogo('landing-logo', landing.logo);

    var headline = landing.headline || link.title || 'You’re almost there';
    setText('landing-headline', headline);
    document.title = headline;

    var message = $('landing-message');
    if (landing.message) {
      message.textContent = landing.message;
      message.hidden = false;
    } else {
      message.hidden = true;
    }

    var button = $('landing-continue');
    var buttonText = landing.buttonText || 'Continue';
    button.textContent = buttonText;
    button.addEventListener('click', function () { go(dest); });

    if (landing.showDestination !== false) {
      showDestination('landing-dest', 'landing-host', dest);
    }

    show('landing');

    var seconds = parseInt(landing.autoRedirectSeconds, 10);
    if (seconds > 0) {
      var remaining = seconds;
      button.textContent = buttonText + ' (' + remaining + ')';
      var tick = window.setInterval(function () {
        remaining -= 1;
        if (remaining <= 0) {
          window.clearInterval(tick);
          go(dest);
          return;
        }
        button.textContent = buttonText + ' (' + remaining + ')';
      }, 1000);
      // A deliberate click shouldn't wait out the countdown.
      button.addEventListener('click', function () { window.clearInterval(tick); });
    }
  }

  function renderGate(link, dest) {
    var gate = link.emailGate || {};
    var landing = link.landing || {};
    applyAccent(landing.accent);
    applyLogo('gate-logo', landing.logo);

    var headline = gate.prompt || landing.headline || link.title || 'Enter your email to continue';
    setText('gate-headline', headline);
    document.title = headline;

    var message = $('gate-message');
    if (landing.message) {
      message.textContent = landing.message;
      message.hidden = false;
    } else {
      message.hidden = true;
    }

    var submit = $('gate-submit');
    submit.textContent = gate.buttonText || landing.buttonText || 'Continue';

    if (gate.consent) {
      setText('gate-consent', gate.consent);
      $('gate-consent').hidden = false;
    }

    if (gate.required === false) {
      var skip = $('gate-skip');
      skip.hidden = false;
      skip.addEventListener('click', function () { go(dest); });
    }

    if (landing.showDestination !== false) {
      showDestination('gate-dest', 'gate-host', dest);
    }

    var input = $('gate-email');
    var error = $('gate-error');

    function showError(text) {
      error.textContent = text;
      error.hidden = false;
    }

    $('gate-form').addEventListener('submit', function (event) {
      event.preventDefault();
      error.hidden = true;

      var email = input.value.trim();
      if (!isEmail(email)) {
        showError('Please enter a valid email address.');
        input.focus();
        return;
      }

      submit.disabled = true;
      var original = submit.textContent;
      submit.textContent = 'Just a second…';

      // Kept locally too, so a delivery failure never silently loses the address.
      store(STORAGE_PREFIX + link.code, email);

      deliverEmail(gate, email, link)
        .then(function () { go(dest); })
        .catch(function () {
          submit.disabled = false;
          submit.textContent = original;
          showError('We couldn’t save that just now — you can continue anyway.');
          var skip = $('gate-skip');
          skip.hidden = false;
          skip.textContent = 'Continue without signing up';
          skip.onclick = function () { go(dest); };
        });
    });

    show('gate');
    window.setTimeout(function () { input.focus(); }, 50);
  }

  // ------------------------------------------------------------------ boot

  function resolve(doc, code) {
    var links = (doc && Array.isArray(doc.links)) ? doc.links : [];
    var needle = code.toLowerCase();
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (link && String(link.code || '').toLowerCase() === needle) return link;
    }
    return null;
  }

  function start() {
    var code = getCode();
    if (!code) {
      fail('No QR code given', 'This page needs a link code, for example ?c=example.');
      return;
    }

    // Cache-bust so an updated destination takes effect as soon as it is published.
    fetch(LINKS_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('Could not load links (' + res.status + ')');
        return res.json();
      })
      .then(function (doc) {
        var link = resolve(doc, code);
        if (!link) {
          fail('Link not found',
               'This QR code isn’t pointing anywhere yet. Please check with whoever shared it.');
          return;
        }
        if (link.active === false) {
          fail('This link is paused',
               link.pausedMessage || 'This QR code has been turned off for now. Please check back later.');
          return;
        }

        var dest = safeUrl(link.destination);
        if (!dest) {
          fail('Destination unavailable',
               'This QR code is set up but its destination is not a valid web address.');
          return;
        }

        var gate = link.emailGate || {};
        var landing = link.landing || {};
        var alreadyGiven = gate.askOnce !== false && !!read(STORAGE_PREFIX + link.code);

        if (gate.enabled && !alreadyGiven) {
          renderGate(link, dest);
        } else if (landing.enabled !== false) {
          renderLanding(link, dest);
        } else {
          go(dest);
        }
      })
      .catch(function (err) {
        fail('Something went wrong',
             'We couldn’t look this QR code up. Please try again in a moment.');
        if (window.console) window.console.error(err);
      });
  }

  show('loading');
  start();
}());
