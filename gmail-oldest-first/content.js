(() => {
  const STORAGE_KEY = 'oldestFirst';
  const BUTTON_ID = 'gof-toggle';
  let enabled = false;

  // Priority Inbox lives at #inbox (or no hash), including later pages like #inbox/p2.
  // An open email (#inbox/<id>) or any other label is left alone.
  function onInboxList() {
    return /^#?(inbox(\/p\d+)?)?$/.test(location.hash);
  }

  function applyState() {
    document.documentElement.classList.toggle('gof-active', enabled && onInboxList());
    const btn = document.getElementById(BUTTON_ID);
    if (btn) {
      btn.setAttribute('aria-checked', String(enabled));
      btn.title = enabled
        ? 'Priority Inbox: oldest first (click for newest first)'
        : 'Priority Inbox: newest first (click for oldest first)';
    }
  }

  function buildButton() {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'gof-toggle';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', 'Show Priority Inbox oldest first');
    btn.innerHTML =
      '<span class="gof-track"><span class="gof-knob"></span></span>' +
      '<span class="gof-label">Oldest first</span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      enabled = !enabled;
      chrome.storage.sync.set({ [STORAGE_KEY]: enabled });
      applyState();
    });
    return btn;
  }

  // Gmail's gear icon in the top bar. If it can't be found (for example,
  // Gmail in another language), a floating switch is shown instead.
  function findSettingsButton() {
    const header = document.querySelector('header') || document;
    return (
      header.querySelector('[aria-label="Settings"][role="button"]') ||
      header.querySelector('[data-tooltip="Settings"]')
    );
  }

  function placeButton() {
    let btn = document.getElementById(BUTTON_ID);
    const settings = findSettingsButton();

    if (settings) {
      // Put the switch just left of the gear's wrapper in the top bar.
      const anchor = settings.parentElement && settings.parentElement !== document.body
        ? settings.parentElement
        : settings;
      if (btn && btn.nextElementSibling === anchor && !btn.classList.contains('gof-floating')) return;
      btn = btn || buildButton();
      btn.classList.remove('gof-floating');
      anchor.parentElement.insertBefore(btn, anchor);
    } else if (!btn && document.querySelector('div[role="main"]')) {
      // Gmail loaded but the gear wasn't found: show a floating switch instead.
      btn = buildButton();
      btn.classList.add('gof-floating');
      document.body.appendChild(btn);
    }
    applyState();
  }

  // Gmail rebuilds its header now and then; keep the switch in place.
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      placeButton();
    });
  });

  chrome.storage.sync.get({ [STORAGE_KEY]: false }, (data) => {
    enabled = Boolean(data[STORAGE_KEY]);
    placeButton();
    observer.observe(document.body, { childList: true, subtree: true });
  });

  // Keep multiple Gmail tabs in sync.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && STORAGE_KEY in changes) {
      enabled = Boolean(changes[STORAGE_KEY].newValue);
      applyState();
    }
  });

  window.addEventListener('hashchange', applyState);
})();
