/*
 * QR Links manager.
 *
 * Creates and edits the entries in links.json, previews the QR code for each
 * one, and (optionally) commits the file back to GitHub so the change goes live
 * without touching a terminal.
 *
 * The QR code always encodes the short link (…/qr/r/?c=CODE), never the
 * destination, which is what lets a printed code outlive the URL behind it.
 */
(function () {
  'use strict';

  var LINKS_FILE = 'links.json';
  var DRAFT_KEY = 'qr.manager.draft';
  var CONFIG_KEY = 'qr.manager.config';
  var CODE_PATTERN = /^[A-Za-z0-9_-]{2,48}$/;

  var state = {
    doc: { version: 1, links: [] },
    published: null,   // last known contents of the file on GitHub / disk
    editingCode: null, // code of the link being edited, null when creating
    dirty: false
  };

  // ---------------------------------------------------------------- helpers

  function $(id) { return document.getElementById(id); }

  function toast(message, kind) {
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = message;
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
    window.setTimeout(function () {
      if (el.parentNode) el.remove();
    }, kind === 'bad' ? 6000 : 3200);
  }

  function safeUrl(raw) {
    if (!raw) return null;
    var u;
    try { u = new URL(String(raw).trim()); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
  }

  function randomCode() {
    var alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // no look-alikes
    var out = '';
    var bytes = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    for (var i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  function codeTaken(code, ignore) {
    var needle = String(code).toLowerCase();
    return state.doc.links.some(function (link) {
      return String(link.code).toLowerCase() === needle &&
             String(link.code).toLowerCase() !== String(ignore || '').toLowerCase();
    });
  }

  function uniqueCode(base) {
    var code = base;
    while (!code || codeTaken(code)) code = randomCode();
    return code;
  }

  function findLink(code) {
    var needle = String(code || '').toLowerCase();
    for (var i = 0; i < state.doc.links.length; i++) {
      if (String(state.doc.links[i].code).toLowerCase() === needle) return state.doc.links[i];
    }
    return null;
  }

  function docToJson(doc) {
    return JSON.stringify(doc, null, 2) + '\n';
  }

  function download(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      ok ? resolve() : reject(new Error('Copy not supported'));
    });
  }

  // -------------------------------------------------------------- short URL

  function redirectBase() {
    return new URL('r/', window.location.href).href;
  }

  function shortUrlFor(code) {
    if (!code) return '';
    return redirectBase() + '?c=' + encodeURIComponent(code);
  }

  // ------------------------------------------------------------- QR codes

  function buildQr(text) {
    var qr = qrcode(0, 'M'); // type 0 = pick the smallest version that fits
    qr.addData(text);
    qr.make();
    return qr;
  }

  function qrToSvg(qr, margin) {
    var count = qr.getModuleCount();
    var total = count + margin * 2;
    var path = '';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          path += 'M' + (c + margin) + ' ' + (r + margin) + 'h1v1h-1z';
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + total * 8 + '" height="' + total * 8 +
           '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">' +
           '<rect width="' + total + '" height="' + total + '" fill="#ffffff"/>' +
           '<path d="' + path + '" fill="#000000"/></svg>';
  }

  function qrToCanvas(qr, targetPx, margin) {
    var count = qr.getModuleCount();
    var total = count + margin * 2;
    var scale = Math.max(1, Math.floor(targetPx / total));
    var px = total * scale;
    var canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
        }
      }
    }
    return canvas;
  }

  var preview = { qr: null, code: '', url: '' };

  function renderPreview(code) {
    var box = $('qrCanvas');
    var url = shortUrlFor(code);
    var buttons = ['copyUrlBtn', 'downloadPngBtn', 'downloadSvgBtn', 'openLandingBtn'];

    if (!code) {
      preview = { qr: null, code: '', url: '' };
      box.innerHTML = '<span class="placeholder">Enter a destination to preview the QR code</span>';
      $('shortUrl').textContent = '—';
      buttons.forEach(function (id) { $(id).disabled = true; });
      return;
    }

    if (typeof window.qrcode !== 'function') {
      box.innerHTML = '<span class="placeholder">QR library failed to load</span>';
      $('shortUrl').textContent = url;
      buttons.forEach(function (id) { $(id).disabled = id !== 'copyUrlBtn' && id !== 'openLandingBtn'; });
      return;
    }

    try {
      preview.qr = buildQr(url);
      preview.code = code;
      preview.url = url;
      box.innerHTML = qrToSvg(preview.qr, 2);
      $('shortUrl').textContent = url;
      buttons.forEach(function (id) { $(id).disabled = false; });
    } catch (err) {
      box.innerHTML = '<span class="placeholder">Could not draw this QR code</span>';
      buttons.forEach(function (id) { $(id).disabled = true; });
    }
  }

  // ------------------------------------------------------------ form <-> data

  function currentCodeForPreview() {
    var typed = $('code').value.trim();
    if (typed) return typed;
    if (state.editingCode) return state.editingCode;
    var fromTitle = slugify($('title').value);
    return fromTitle || '';
  }

  function readForm() {
    var destination = safeUrl($('destination').value);
    if (!destination) {
      return { error: 'Enter a destination starting with http:// or https://' };
    }

    var code = $('code').value.trim();
    if (code && !CODE_PATTERN.test(code)) {
      return { error: 'Short codes may use letters, numbers, hyphens and underscores (2–48 characters).' };
    }
    if (!code) code = uniqueCode(slugify($('title').value));
    if (codeTaken(code, state.editingCode)) {
      return { error: 'The short code “' + code + '” is already in use.' };
    }

    var endpointType = $('gateEndpointType').value;
    var endpoint = $('gateEndpoint').value.trim();
    if ($('gateEnabled').checked && endpointType !== 'none') {
      if (!safeUrl(endpoint)) {
        return { error: 'Enter the endpoint URL that should receive the email addresses.' };
      }
      if (endpointType === 'googleform' && !$('gateFieldName').value.trim()) {
        return { error: 'Google Forms needs the field name, for example entry.123456789.' };
      }
    }

    var logo = $('landingLogo').value.trim();
    if (logo && !safeUrl(logo)) {
      return { error: 'The logo image URL must start with http:// or https://' };
    }

    var now = new Date().toISOString();
    var existing = state.editingCode ? findLink(state.editingCode) : null;

    return {
      link: {
        code: code,
        title: $('title').value.trim(),
        destination: destination,
        active: $('active').checked,
        landing: {
          enabled: $('landingEnabled').checked,
          headline: $('landingHeadline').value.trim(),
          message: $('landingMessage').value.trim(),
          buttonText: $('landingButton').value.trim(),
          autoRedirectSeconds: Math.max(0, parseInt($('landingAuto').value, 10) || 0),
          accent: $('landingAccent').value,
          logo: logo,
          showDestination: $('landingShowDest').checked
        },
        emailGate: {
          enabled: $('gateEnabled').checked,
          required: $('gateRequired').checked,
          askOnce: $('gateAskOnce').checked,
          prompt: $('gatePrompt').value.trim(),
          consent: $('gateConsent').value.trim(),
          endpointType: endpointType,
          endpoint: endpointType === 'none' ? '' : endpoint,
          fieldName: $('gateFieldName').value.trim() || 'email'
        },
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now
      }
    };
  }

  function fillForm(link) {
    link = link || {};
    var landing = link.landing || {};
    var gate = link.emailGate || {};

    $('destination').value = link.destination || '';
    $('title').value = link.title || '';
    $('code').value = link.code || '';
    $('active').checked = link.active !== false;

    $('landingEnabled').checked = landing.enabled !== false;
    $('landingHeadline').value = landing.headline || '';
    $('landingMessage').value = landing.message || '';
    $('landingButton').value = landing.buttonText || '';
    $('landingAuto').value = landing.autoRedirectSeconds || 0;
    $('landingAccent').value = /^#[0-9a-f]{6}$/i.test(landing.accent || '') ? landing.accent : '#5b8dff';
    $('landingLogo').value = landing.logo || '';
    $('landingShowDest').checked = landing.showDestination !== false;

    $('gateEnabled').checked = !!gate.enabled;
    $('gateRequired').checked = gate.required !== false;
    $('gateAskOnce').checked = gate.askOnce !== false;
    $('gatePrompt').value = gate.prompt || '';
    $('gateConsent').value = gate.consent || '';
    $('gateEndpointType').value = gate.endpointType || 'none';
    $('gateEndpoint').value = gate.endpoint || '';
    $('gateFieldName').value = gate.fieldName || '';

    syncConditionalFields();
    $('formError').hidden = true;
  }

  function resetForm() {
    state.editingCode = null;
    fillForm({});
    $('editorTitle').textContent = 'New QR link';
    $('editorHint').textContent =
      'The QR code encodes the short link, never the destination — so you can change where it points at any time.';
    $('submitBtn').textContent = 'Add link';
    $('cancelBtn').hidden = true;
    $('newLinkBtn').hidden = true;
    renderPreview('');
    renderList();
  }

  function startEditing(code) {
    var link = findLink(code);
    if (!link) return;
    state.editingCode = link.code;
    fillForm(link);
    $('editorTitle').textContent = 'Editing “' + (link.title || link.code) + '”';
    $('editorHint').textContent =
      'Change the destination and republish — the printed QR code keeps working.';
    $('submitBtn').textContent = 'Save changes';
    $('cancelBtn').hidden = false;
    $('newLinkBtn').hidden = false;
    renderPreview(link.code);
    renderList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function syncConditionalFields() {
    var gateOn = $('gateEnabled').checked;
    $('gateFields').hidden = !gateOn;
    $('landingFields').hidden = !$('landingEnabled').checked;

    var type = $('gateEndpointType').value;
    $('gateEndpointField').hidden = type === 'none';
    $('gateFieldNameField').hidden = type === 'none';

    var notes = {
      none: 'Static hosting can’t store data — pick a service to receive the addresses.',
      formspree: 'Paste the form endpoint from your Formspree dashboard.',
      webhook: 'Any endpoint that accepts a JSON POST. The address arrives with the link code and destination.',
      googleform: 'Use the form’s /formResponse URL and the entry.xxxxx name of the email question.'
    };
    $('gateEndpointNote').textContent = notes[type] || notes.none;

    var placeholders = {
      formspree: 'https://formspree.io/f/abcdwxyz',
      webhook: 'https://hooks.zapier.com/hooks/catch/123456/abcdef/',
      googleform: 'https://docs.google.com/forms/d/e/FORM_ID/formResponse'
    };
    $('gateEndpoint').placeholder = placeholders[type] || '';
    $('gateFieldName').placeholder = type === 'googleform' ? 'entry.123456789' : 'email';
  }

  // ------------------------------------------------------------------- list

  function tag(text, cls) {
    var el = document.createElement('span');
    el.className = 'tag' + (cls ? ' ' + cls : '');
    el.textContent = text;
    return el;
  }

  function renderList() {
    var list = $('linkList');
    list.textContent = '';

    var links = state.doc.links;
    $('emptyState').hidden = links.length > 0;
    $('listHint').textContent = links.length === 0
      ? 'Nothing published yet.'
      : links.length + (links.length === 1 ? ' link' : ' links') + ' — the QR for each one never changes.';

    links.forEach(function (link) {
      var landing = link.landing || {};
      var gate = link.emailGate || {};

      var item = document.createElement('li');
      item.className = 'link-item' +
        (state.editingCode && state.editingCode.toLowerCase() === String(link.code).toLowerCase()
          ? ' is-editing' : '');

      var top = document.createElement('div');
      top.className = 'link-top';

      var left = document.createElement('div');
      var title = document.createElement('p');
      title.className = 'link-title';
      title.textContent = link.title || link.code;
      var code = document.createElement('span');
      code.className = 'link-code';
      code.textContent = '/r/?c=' + link.code;
      left.appendChild(title);
      left.appendChild(code);
      top.appendChild(left);
      item.appendChild(top);

      var dest = document.createElement('p');
      dest.className = 'link-dest';
      dest.textContent = '→ ' + link.destination;
      item.appendChild(dest);

      var tags = document.createElement('div');
      tags.className = 'tags';
      if (link.active === false) tags.appendChild(tag('Paused', 'paused'));
      tags.appendChild(landing.enabled !== false
        ? tag('Landing page', 'on')
        : tag('Straight through', 'off'));
      if (gate.enabled) {
        tags.appendChild(tag('Email required' + (gate.required === false ? ' (optional)' : ''), 'on'));
        tags.appendChild(tag(gate.endpointType === 'none' || !gate.endpointType
          ? 'No collection endpoint'
          : 'Sends to ' + gate.endpointType, gate.endpointType === 'none' ? 'paused' : 'off'));
      }
      item.appendChild(tags);

      var actions = document.createElement('div');
      actions.className = 'link-actions';
      actions.appendChild(button('Edit', function () { startEditing(link.code); }));
      actions.appendChild(button('Copy link', function () {
        copyText(shortUrlFor(link.code))
          .then(function () { toast('Link copied', 'good'); })
          .catch(function () { toast('Could not copy', 'bad'); });
      }));
      actions.appendChild(button('PNG', function () { downloadPng(link.code); }));
      actions.appendChild(button('Open', function () {
        window.open(shortUrlFor(link.code), '_blank', 'noopener');
      }));
      var remove = button('Delete', function () {
        if (!window.confirm('Delete “' + (link.title || link.code) + '”? Printed QR codes for it will stop working.')) return;
        state.doc.links = state.doc.links.filter(function (l) { return l !== link; });
        if (state.editingCode === link.code) resetForm();
        markDirty();
        renderList();
        toast('Link deleted — publish to make it final');
      });
      remove.classList.add('danger');
      actions.appendChild(remove);
      item.appendChild(actions);

      list.appendChild(item);
    });
  }

  function button(label, onClick) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'btn small';
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  // --------------------------------------------------------------- downloads

  function downloadPng(code) {
    if (typeof window.qrcode !== 'function') {
      toast('QR library is not loaded', 'bad');
      return;
    }
    var qr = buildQr(shortUrlFor(code));
    var canvas = qrToCanvas(qr, 1024, 4);
    canvas.toBlob(function (blob) {
      if (!blob) { toast('Could not create the PNG', 'bad'); return; }
      download('qr-' + code + '.png', blob);
    }, 'image/png');
  }

  function downloadSvg(code) {
    if (typeof window.qrcode !== 'function') {
      toast('QR library is not loaded', 'bad');
      return;
    }
    var svg = qrToSvg(buildQr(shortUrlFor(code)), 4);
    download('qr-' + code + '.svg', new Blob([svg], { type: 'image/svg+xml' }));
  }

  // ------------------------------------------------------------ persistence

  function markDirty() {
    state.dirty = true;
    $('dirtyFlag').hidden = false;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(state.doc));
    } catch (e) { /* storage unavailable */ }
  }

  function markClean() {
    state.dirty = false;
    $('dirtyFlag').hidden = true;
    state.published = docToJson(state.doc);
    try { window.localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
  }

  function loadConfig() {
    var stored = {};
    try { stored = JSON.parse(window.localStorage.getItem(CONFIG_KEY) || '{}'); }
    catch (e) { stored = {}; }
    var guessed = guessRepo();
    return {
      owner: stored.owner || guessed.owner,
      repo: stored.repo || guessed.repo,
      branch: stored.branch || 'main',
      path: stored.path || guessed.path,
      token: stored.token || ''
    };
  }

  function saveConfig(config) {
    try { window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }
    catch (e) { toast('This browser refused to save the settings', 'bad'); }
  }

  /** Work out owner/repo/path from the GitHub Pages URL we are being served from. */
  function guessRepo() {
    var host = window.location.hostname;
    var segments = window.location.pathname.split('/').filter(Boolean);
    if (segments.length && segments[segments.length - 1].indexOf('.') !== -1) segments.pop();

    var match = /^([A-Za-z0-9-]+)\.github\.io$/i.exec(host);
    if (!match) return { owner: '', repo: '', path: 'qr/' + LINKS_FILE };

    var owner = match[1];
    var repo, dirs;
    if (segments.length > 1) {
      repo = segments[0];         // project site: /<repo>/<dir>/
      dirs = segments.slice(1);
    } else {
      repo = host;                // user site: /<dir>/
      dirs = segments;
    }
    return { owner: owner, repo: repo, path: dirs.concat(LINKS_FILE).join('/') };
  }

  // ------------------------------------------------------------- GitHub API

  function base64Encode(text) {
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function contentsUrl(config) {
    var path = config.path.split('/').map(encodeURIComponent).join('/');
    return 'https://api.github.com/repos/' +
           encodeURIComponent(config.owner) + '/' +
           encodeURIComponent(config.repo) + '/contents/' + path;
  }

  function ghHeaders(config) {
    return {
      Authorization: 'Bearer ' + config.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  function describeError(status) {
    if (status === 401) return 'GitHub rejected the token. Check it in Settings.';
    if (status === 403) return 'The token is missing “Contents: read and write” for this repository.';
    if (status === 404) return 'Repository, branch or file path not found. Check Settings.';
    if (status === 409 || status === 422) return 'The file changed on GitHub since it was loaded. Reload published, then republish.';
    return 'GitHub returned an error (' + status + ').';
  }

  function isConnected(config) {
    config = config || loadConfig();
    return !!(config.token && config.owner && config.repo);
  }

  /** Reflect "can we publish?" everywhere it matters, so it is never a surprise. */
  function renderConnectionState() {
    var config = loadConfig();
    var connected = isConnected(config);

    var pill = $('ghStatus');
    pill.classList.toggle('good', connected);
    pill.classList.toggle('warn', !connected);
    pill.textContent = connected
      ? 'Publishing to ' + config.owner + '/' + config.repo + ' @ ' + config.branch
      : 'GitHub not connected';

    $('setupBanner').hidden = connected;
    $('saveBtn').textContent = connected ? 'Publish to GitHub' : 'Connect GitHub to publish';

    $('setupRepoName').textContent = (config.owner && config.repo)
      ? config.owner + '/' + config.repo
      : 'your repository';
    $('setupTarget').textContent = (config.owner && config.repo)
      ? 'Saves to ' + config.owner + '/' + config.repo + ' → ' + config.path +
        ' on the ' + config.branch + ' branch. Change that under Settings.'
      : 'Set the owner and repository under Settings first — this page could not work them out from its own address.';
  }

  /** Collapse the setup panel once it has nothing left to say. */
  function scheduleBannerCollapse() {
    window.setTimeout(function () {
      if (isConnected() && $('setupError').hidden) $('setupBanner').hidden = true;
    }, 6000);
  }

  function setMessage(errorId, okId, text, isError) {
    var err = $(errorId);
    var ok = $(okId);
    err.hidden = true;
    ok.hidden = true;
    if (!text) return;
    var target = isError ? err : ok;
    target.textContent = text;
    target.hidden = false;
  }

  /**
   * Check the whole chain — token, repository, branch, write permission, file —
   * and say exactly which link is broken rather than a bare HTTP status.
   */
  async function testConnection(config) {
    if (!config.owner || !config.repo) {
      return { ok: false, message: 'Fill in the owner and repository first.' };
    }
    if (!config.token) {
      return { ok: false, message: 'Paste an access token first.' };
    }

    var base = 'https://api.github.com/repos/' +
               encodeURIComponent(config.owner) + '/' + encodeURIComponent(config.repo);
    var repoRes;
    try {
      repoRes = await fetch(base, { headers: ghHeaders(config), cache: 'no-store' });
    } catch (err) {
      return { ok: false, message: 'Could not reach api.github.com. Check your connection and try again.' };
    }

    if (repoRes.status === 401) {
      return { ok: false, message: 'GitHub rejected that token.\nIt may be mistyped, expired, or revoked — create a fresh one and paste it again.' };
    }
    if (repoRes.status === 404) {
      return { ok: false, message: 'Cannot see ' + config.owner + '/' + config.repo + '.\nEither the name is wrong, or the token was not granted access to this repository (Repository access → Only select repositories).' };
    }
    if (!repoRes.ok) {
      return { ok: false, message: 'GitHub returned ' + repoRes.status + ' when reading the repository.' };
    }

    var repo = await repoRes.json();
    if (repo.permissions && repo.permissions.push === false) {
      return { ok: false, message: 'The token can read ' + config.owner + '/' + config.repo + ' but not write to it.\nGive it Permissions → Contents: Read and write.' };
    }

    var branchRes = await fetch(base + '/branches/' + encodeURIComponent(config.branch), {
      headers: ghHeaders(config), cache: 'no-store'
    });
    if (branchRes.status === 404) {
      return { ok: false, message: 'Branch "' + config.branch + '" does not exist in ' + config.owner + '/' + config.repo + '.\nThe published branch is usually "main".' };
    }
    if (!branchRes.ok) {
      return { ok: false, message: 'GitHub returned ' + branchRes.status + ' when checking the branch.' };
    }

    var fileRes = await fetch(contentsUrl(config) + '?ref=' + encodeURIComponent(config.branch), {
      headers: ghHeaders(config), cache: 'no-store'
    });
    var fileNote = fileRes.ok
      ? config.path + ' found — publishing will update it.'
      : config.path + ' does not exist yet — publishing will create it.';

    var who = '';
    try {
      var userRes = await fetch('https://api.github.com/user', { headers: ghHeaders(config), cache: 'no-store' });
      if (userRes.ok) who = ' as ' + (await userRes.json()).login;
    } catch (err) { /* identity is a nicety, not a requirement */ }

    return {
      ok: true,
      message: 'Connected' + who + '.\n' + config.owner + '/' + config.repo +
               ' on branch ' + config.branch + '.\n' + fileNote
    };
  }

  async function publish() {
    var config = loadConfig();
    if (!isConnected(config)) {
      // Not an error the user caused — walk them into the one-time setup.
      $('setupBanner').hidden = false;
      setMessage('setupError', 'setupOk',
        'Connect GitHub first — your links are saved in this browser but are not live yet.', true);
      $('setupBanner').scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(function () { $('setupToken').focus(); }, 300);
      return;
    }

    var saveBtn = $('saveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Publishing…';

    try {
      // Fetch the current file purely to pick up its blob SHA.
      var sha;
      var head = await fetch(contentsUrl(config) + '?ref=' + encodeURIComponent(config.branch), {
        headers: ghHeaders(config),
        cache: 'no-store'
      });
      if (head.ok) {
        sha = (await head.json()).sha;
      } else if (head.status !== 404) {
        throw new Error(describeError(head.status));
      }

      var body = {
        message: 'Update QR links',
        content: base64Encode(docToJson(state.doc)),
        branch: config.branch
      };
      if (sha) body.sha = sha;

      var res = await fetch(contentsUrl(config), {
        method: 'PUT',
        headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(config)),
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(describeError(res.status));

      markClean();
      renderList();
      setMessage('setupError', 'setupOk',
        'Published to ' + config.owner + '/' + config.repo + '. Your links go live once ' +
        'GitHub Pages rebuilds, usually within a minute.', false);
      scheduleBannerCollapse();
      toast('Published. GitHub Pages takes a minute or so to rebuild.', 'good');
    } catch (err) {
      // Toasts vanish; a failed publish needs to stay on screen.
      $('setupBanner').hidden = false;
      setMessage('setupError', 'setupOk',
        'Publishing failed. ' + (err.message || 'Unknown error'), true);
      toast('Publishing failed — see the message at the top of the page', 'bad');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Publish to GitHub';
    }
  }

  // ------------------------------------------------------------------ boot

  function normaliseDoc(raw) {
    var doc = (raw && typeof raw === 'object') ? raw : {};
    var links = Array.isArray(doc.links) ? doc.links : [];
    return {
      version: doc.version || 1,
      links: links.filter(function (link) {
        return link && typeof link === 'object' && link.code && link.destination;
      })
    };
  }

  async function loadPublished(options) {
    options = options || {};
    try {
      var res = await fetch(LINKS_FILE + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var doc = normaliseDoc(await res.json());
      state.doc = doc;
      state.published = docToJson(doc);
      markClean();
      resetForm();
      if (options.announce) toast('Reloaded the published list', 'good');
    } catch (err) {
      state.doc = { version: 1, links: [] };
      renderList();
      if (options.announce) toast('Could not load links.json', 'bad');
    }
  }

  function restoreDraft() {
    var raw;
    try { raw = window.localStorage.getItem(DRAFT_KEY); } catch (e) { return false; }
    if (!raw) return false;
    try {
      var doc = normaliseDoc(JSON.parse(raw));
      if (docToJson(doc) === state.published) return false;
      state.doc = doc;
      state.dirty = true;
      $('dirtyFlag').hidden = false;
      renderList();
      toast('Restored edits you hadn’t published yet');
      return true;
    } catch (e) {
      return false;
    }
  }

  function openSettings() {
    var config = loadConfig();
    $('ghOwner').value = config.owner;
    $('ghRepo').value = config.repo;
    $('ghBranch').value = config.branch;
    $('ghPath').value = config.path;
    $('ghToken').value = config.token;
    setMessage('settingsError', 'settingsOk', '', false);
    $('settingsDialog').showModal();
  }

  function wire() {
    // Live QR preview as the code or title changes.
    ['code', 'title'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        renderPreview(currentCodeForPreview());
      });
    });
    $('destination').addEventListener('input', function () {
      renderPreview(currentCodeForPreview());
    });

    $('gateEnabled').addEventListener('change', syncConditionalFields);
    $('landingEnabled').addEventListener('change', syncConditionalFields);
    $('gateEndpointType').addEventListener('change', syncConditionalFields);

    $('linkForm').addEventListener('submit', function (event) {
      event.preventDefault();
      var result = readForm();
      if (result.error) {
        $('formError').textContent = result.error;
        $('formError').hidden = false;
        return;
      }
      $('formError').hidden = true;

      if (state.editingCode) {
        var index = state.doc.links.findIndex(function (l) {
          return String(l.code).toLowerCase() === state.editingCode.toLowerCase();
        });
        if (index !== -1) state.doc.links[index] = result.link;
      } else {
        state.doc.links.unshift(result.link);
      }

      markDirty();
      var savedCode = result.link.code;
      resetForm();
      renderPreview(savedCode);
      toast('Saved locally — press “Publish to GitHub” to go live');
    });

    $('cancelBtn').addEventListener('click', resetForm);
    $('newLinkBtn').addEventListener('click', resetForm);

    $('copyUrlBtn').addEventListener('click', function () {
      copyText(preview.url)
        .then(function () { toast('Link copied', 'good'); })
        .catch(function () { toast('Could not copy', 'bad'); });
    });
    $('downloadPngBtn').addEventListener('click', function () { downloadPng(preview.code); });
    $('downloadSvgBtn').addEventListener('click', function () { downloadSvg(preview.code); });
    $('openLandingBtn').addEventListener('click', function () {
      window.open(preview.url, '_blank', 'noopener');
    });

    $('saveBtn').addEventListener('click', publish);
    $('settingsBtn').addEventListener('click', openSettings);
    $('reloadBtn').addEventListener('click', function () {
      if (state.dirty && !window.confirm('Discard your unpublished edits and reload?')) return;
      try { window.localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
      loadPublished({ announce: true });
    });

    $('exportBtn').addEventListener('click', function () {
      download(LINKS_FILE, new Blob([docToJson(state.doc)], { type: 'application/json' }));
    });

    $('importInput').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          state.doc = normaliseDoc(JSON.parse(String(reader.result)));
          markDirty();
          resetForm();
          toast('Imported ' + state.doc.links.length + ' links — publish to go live', 'good');
        } catch (err) {
          toast('That file isn’t valid links.json', 'bad');
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    });

    $('settingsForm').addEventListener('submit', function () {
      saveConfig({
        owner: $('ghOwner').value.trim(),
        repo: $('ghRepo').value.trim(),
        branch: $('ghBranch').value.trim() || 'main',
        path: $('ghPath').value.trim() || 'qr/' + LINKS_FILE,
        token: $('ghToken').value.trim()
      });
      renderConnectionState();
      toast('Settings saved', 'good');
    });
    $('settingsCancel').addEventListener('click', function () { $('settingsDialog').close(); });
    $('forgetToken').addEventListener('click', function () {
      var config = loadConfig();
      config.token = '';
      saveConfig(config);
      $('ghToken').value = '';
      renderConnectionState();
      toast('Token removed from this browser', 'good');
    });

    // ---- one-time setup banner -------------------------------------------
    $('setupSave').addEventListener('click', async function () {
      var token = $('setupToken').value.trim();
      if (!token) {
        setMessage('setupError', 'setupOk', 'Paste the token you created on GitHub.', true);
        $('setupToken').focus();
        return;
      }

      var button = $('setupSave');
      button.disabled = true;
      button.textContent = 'Checking…';
      setMessage('setupError', 'setupOk', '', false);

      var config = loadConfig();
      config.token = token;

      var result = await testConnection(config);
      if (!result.ok) {
        button.disabled = false;
        button.textContent = 'Connect';
        setMessage('setupError', 'setupOk', result.message, true);
        return;
      }

      saveConfig(config);
      $('setupToken').value = '';
      button.disabled = false;
      button.textContent = 'Connect';
      renderConnectionState();
      // Keep the panel up long enough to read the confirmation, then collapse it.
      $('setupBanner').hidden = false;
      setMessage('setupError', 'setupOk', result.message, false);
      toast('GitHub connected — you can publish now', 'good');

      if (state.dirty) {
        await publish();
      } else {
        scheduleBannerCollapse();
      }
    });

    $('setupToken').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        $('setupSave').click();
      }
    });

    $('testConnBtn').addEventListener('click', async function () {
      var button = $('testConnBtn');
      button.disabled = true;
      button.textContent = 'Checking…';
      setMessage('settingsError', 'settingsOk', '', false);

      var result = await testConnection({
        owner: $('ghOwner').value.trim(),
        repo: $('ghRepo').value.trim(),
        branch: $('ghBranch').value.trim() || 'main',
        path: $('ghPath').value.trim() || 'qr/' + LINKS_FILE,
        token: $('ghToken').value.trim()
      });

      button.disabled = false;
      button.textContent = 'Test connection';
      setMessage('settingsError', 'settingsOk', result.message, !result.ok);
    });

    window.addEventListener('beforeunload', function (event) {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  wire();
  syncConditionalFields();
  renderConnectionState();
  loadPublished().then(restoreDraft);
}());
