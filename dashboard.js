/* JB Marketing Dashboard */
(async () => {
  const STORAGE_KEY = 'jb-marketing-dashboard-v1';
  const REPS_KEY    = 'jb-marketing-dashboard-reps-v1';
  const WINDSOR_URL = 'data/windsor.json';
  const DIRECT_URL  = 'data/direct.json';

  const REP_PALETTE = ['#5b8dff','#2dd4bf','#f59e0b','#f472b6','#a78bfa','#facc15','#34d399','#60a5fa','#fb7185','#22d3ee'];

  function loadReps() {
    try {
      const raw = localStorage.getItem(REPS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  function saveReps(reps) { localStorage.setItem(REPS_KEY, JSON.stringify(reps)); }
  function newRepId() { return 'r_' + Math.random().toString(36).slice(2, 9); }

  let reps = loadReps();
  if (!reps) {
    reps = [
      { id: newRepId(), name: 'Alex Chen',   color: REP_PALETTE[0] },
      { id: newRepId(), name: 'Sam Patel',   color: REP_PALETTE[1] },
      { id: newRepId(), name: 'Jordan Liu',  color: REP_PALETTE[2] },
    ];
    saveReps(reps);
  }
  function repColor(rep, idx) { return rep.color || REP_PALETTE[idx % REP_PALETTE.length]; }

  const METRICS = [
    { key: 'organic',     label: 'Organic Traffic',        type: 'int' },
    { key: 'paid',        label: 'Paid Traffic',           type: 'int' },
    { key: 'costs',       label: 'Costs',                  type: 'money' },
    { key: 'salesCalls',  label: 'Sales Calls',            type: 'int' },
    { key: 'newClients',  label: 'New Clients (1st spend)',type: 'int' },
    { key: 'mktgSent',    label: 'Marketing Emails Sent',  type: 'int' },
    { key: 'mktgViewed',  label: 'Marketing Emails Viewed',type: 'int' },
    { key: 'mktgClicked', label: 'Marketing Emails Clicked',type: 'int' },
    { key: 'newLeads',    label: 'New Leads (Contacts)',   type: 'int' },
    { key: 'newCompanies',label: 'New Companies',          type: 'int' },
    { key: 'lpViews',     label: 'Landing Page Views',     type: 'int' },
    { key: 'lpSubs',      label: 'Landing Page Submissions',type: 'int' },
    { key: 'coldSent',    label: 'Cold Emails Sent',       type: 'int' },
    { key: 'coldResp',    label: 'Cold Email Responses',   type: 'int' },
    { key: 'deposits',    label: 'Deposits',               type: 'money' },
    { key: 'revenue',     label: 'Revenue',                type: 'money' },
    { key: 'creators',    label: 'Creators Signed Up',     type: 'int' },
    { key: 'brands',      label: 'Brands Signed Up',       type: 'int' },
    { key: 'campaigns',   label: 'New Campaigns >$1k',     type: 'int' },
    { key: 'mrrBrands',       label: 'MRR Brands',                type: 'money' },
    { key: 'mrrBrandStartup', label: 'MRR Brand Startup',         type: 'money' },
    { key: 'mrrBrandPro',     label: 'MRR Brand Pro',             type: 'money' },
    { key: 'mrrBrandMax',     label: 'MRR Brand Max',             type: 'money' },
    { key: 'mrrCreators',     label: 'MRR Creators',              type: 'money' },
    { key: 'gmv',         label: 'Creator GMV',            type: 'money' },
    { key: 'videos',      label: 'Shop Videos Produced',   type: 'int' },
  ];

  const KPI_LIST = [
    { key: 'revenue',    label: 'Revenue',        type: 'money' },
    { key: 'deposits',   label: 'Deposits',       type: 'money' },
    { key: 'costs',      label: 'Costs',          type: 'money', invert: true },
    { key: 'mrrBrands',       label: 'MRR Brands',         type: 'money', latest: true },
    { key: 'mrrBrandStartup', label: 'MRR · Startup',      type: 'money', latest: true, group: 'mrrTier' },
    { key: 'mrrBrandPro',     label: 'MRR · Pro',          type: 'money', latest: true, group: 'mrrTier' },
    { key: 'mrrBrandMax',     label: 'MRR · Max',          type: 'money', latest: true, group: 'mrrTier' },
    { key: 'gmv',        label: 'Creator GMV',    type: 'money' },
    { key: 'newLeads',   label: 'New Leads',      type: 'int' },
    { key: 'newCompanies', label: 'New Companies', type: 'int' },
    { key: 'newClients', label: 'New Clients',    type: 'int' },
    { key: 'salesCalls', label: 'Sales Calls',    type: 'int' },
    { key: 'creators',   label: 'Creators Signed', type: 'int' },
    { key: 'brands',     label: 'Brands Signed',  type: 'int' },
    { key: 'campaigns',  label: 'Campaigns >$1k', type: 'int' },
    { key: 'videos',     label: 'Shop Videos',    type: 'int' },
  ];

  /* ---------- Week helpers (ISO week, Monday start) ---------- */
  function toMonday(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0 Sun .. 6 Sat
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    d.setHours(0,0,0,0);
    return d;
  }
  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week };
  }
  function weekLabel(iso) {
    const d = new Date(iso);
    const { year, week } = isoWeek(d);
    const end = new Date(d); end.setDate(end.getDate() + 6);
    const sm = String(d.getMonth()+1).padStart(2,'0');
    const sd = String(d.getDate()).padStart(2,'0');
    const em = String(end.getMonth()+1).padStart(2,'0');
    const ed = String(end.getDate()).padStart(2,'0');
    return `W${String(week).padStart(2,'0')} '${String(year).slice(-2)} (${sm}/${sd}–${em}/${ed})`;
  }
  function shortWeekLabel(iso) {
    const d = new Date(iso);
    const { week } = isoWeek(d);
    const sm = String(d.getMonth()+1).padStart(2,'0');
    const sd = String(d.getDate()).padStart(2,'0');
    return `W${week} ${sm}/${sd}`;
  }

  /* ---------- Formatting ---------- */
  const numFmt = new Intl.NumberFormat('en-US');
  const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmt(value, type) {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    if (Number.isNaN(n)) return '—';
    if (type === 'money') return moneyFmt.format(n);
    return numFmt.format(n);
  }

  /* ---------- Storage ---------- */
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function saveData(rows) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }

  // Manual entries (user-edited overrides). Saved to localStorage.
  let manualData = loadData();

  // Windsor.ai feed (read-only baseline). Loaded from data/windsor.json.
  let windsorData = [];
  let windsorBySource = {}; // weekStart -> source -> metrics (for audit drawer)
  let windsorUpdatedAt = null;
  // Direct-API feed (Stripe, HubSpot, etc.). Loaded from data/direct.json.
  let directData = [];
  let directBySource = {};  // weekStart -> source -> metrics (for audit drawer)
  let directUpdatedAt = null;

  async function loadJsonFeed(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  const windsorJson = await loadJsonFeed(WINDSOR_URL);
  if (windsorJson) {
    windsorData = Array.isArray(windsorJson.weeks) ? windsorJson.weeks : [];
    windsorBySource = windsorJson.weeksBySource || {};
    windsorUpdatedAt = windsorJson.updatedAt || null;
  }
  const directJson = await loadJsonFeed(DIRECT_URL);
  if (directJson) {
    directData = Array.isArray(directJson.weeks) ? directJson.weeks : [];
    directBySource = directJson.weeksBySource || {};
    directUpdatedAt = directJson.updatedAt || null;
  }

  /* Effective dataset, with priority: manual > direct API > Windsor baseline,
   * applied per metric (so any layer can fill in metrics the lower layer
   * lacks, but a higher layer's value wins for the same metric). */
  function buildEffectiveData() {
    const byWeek = new Map();
    function overlay(rows) {
      for (const w of rows) {
        const base = byWeek.get(w.weekStart) || { weekStart: w.weekStart };
        for (const [k, v] of Object.entries(w)) {
          if (k === 'weekStart') continue;
          if (v !== null && v !== undefined && v !== '') base[k] = v;
        }
        byWeek.set(w.weekStart, base);
      }
    }
    overlay(windsorData);
    overlay(directData);
    overlay(manualData);
    return [...byWeek.values()];
  }

  let data = buildEffectiveData();

  // Show real data only. Empty dashboard = no synced sources yet AND no
  // manual entries. If the user still has stale demo data from a
  // previous version that auto-seeded, offer a one-time wipe.
  function looksLikeDemo(rows) {
    if (rows.length < 12) return false;
    // Demo seed always wrote `creators`, `brands`, `gmv`, `videos`, etc.
    // and salesCallsByRep with the auto-generated rep IDs. Real data
    // from Stripe/HubSpot/Windsor never includes `gmv` or `videos`.
    return rows.some(r => r.gmv !== undefined && r.videos !== undefined && r.creators !== undefined);
  }
  if (manualData.length > 0 && looksLikeDemo(manualData) && !localStorage.getItem('jb-marketing-demo-clear-decided')) {
    if (confirm('Clear demo/sample data so the dashboard shows only real synced data? Your manually-entered weeks (if any) will also be cleared.')) {
      manualData = [];
      saveData(manualData);
      data = buildEffectiveData();
    }
    localStorage.setItem('jb-marketing-demo-clear-decided', '1');
  }


  /* ---------- Rendering ---------- */
  const charts = {};

  const presetSelect    = document.getElementById('presetSelect');
  const compareSelect   = document.getElementById('compareSelect');
  const rangeStartInput = document.getElementById('rangeStart');
  const rangeEndInput   = document.getElementById('rangeEnd');
  const compareStartInput = document.getElementById('compareStart');
  const compareEndInput   = document.getElementById('compareEnd');
  const customRangeGroup  = document.getElementById('customRangeGroup');
  const customCompareGroup= document.getElementById('customCompareGroup');
  const rangeLabelEl      = document.getElementById('rangeLabel');

  const ONE_WEEK_MS = 7 * 86400000;

  function snapMonday(input) {
    if (!input) return null;
    const d = new Date(input + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return null;
    return fmtDate(toMonday(d));
  }

  function weeksBetween(startISO, endISO) {
    return Math.round((new Date(endISO) - new Date(startISO)) / ONE_WEEK_MS) + 1;
  }

  function shiftWeekISO(iso, weeks) {
    const d = new Date(iso);
    d.setDate(d.getDate() + weeks * 7);
    return fmtDate(d);
  }

  function dataBoundsISO() {
    const sorted = [...data].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    if (sorted.length === 0) {
      const today = fmtDate(toMonday(new Date()));
      return { first: today, last: today };
    }
    return { first: sorted[0].weekStart, last: sorted[sorted.length - 1].weekStart };
  }

  function resolveMainRange() {
    const { first, last } = dataBoundsISO();
    const preset = presetSelect.value;

    if (preset === 'custom') {
      const s = snapMonday(rangeStartInput.value);
      const e = snapMonday(rangeEndInput.value);
      if (s && e && s <= e) return { start: s, end: e, mode: 'custom' };
      return { start: first, end: last, mode: 'all' };
    }
    if (preset === 'all') return { start: first, end: last, mode: 'all' };
    if (preset === 'ytd') {
      const y = new Date().getFullYear();
      return { start: fmtDate(toMonday(new Date(y, 0, 4))), end: last, mode: 'ytd' };
    }
    if (preset === 'qtd') {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3) * 3;
      return { start: fmtDate(toMonday(new Date(now.getFullYear(), q, 1))), end: last, mode: 'qtd' };
    }
    if (preset === 'mtd') {
      const now = new Date();
      return { start: fmtDate(toMonday(new Date(now.getFullYear(), now.getMonth(), 1))), end: last, mode: 'mtd' };
    }
    const n = parseInt(preset, 10);
    const start = shiftWeekISO(last, -(n - 1));
    return { start, end: last, mode: `last-${n}` };
  }

  function resolveCompareRange(main) {
    const mode = compareSelect.value;
    if (mode === 'none' || !main.start) return { start: null, end: null, mode };

    if (mode === 'custom') {
      const s = snapMonday(compareStartInput.value);
      const e = snapMonday(compareEndInput.value);
      if (s && e && s <= e) return { start: s, end: e, mode };
      return { start: null, end: null, mode };
    }
    if (mode === 'year') {
      return { start: shiftWeekISO(main.start, -52), end: shiftWeekISO(main.end, -52), mode };
    }
    // 'prev' (immediately preceding period of equal length)
    const len = weeksBetween(main.start, main.end);
    const end = shiftWeekISO(main.start, -1);
    const start = shiftWeekISO(end, -(len - 1));
    return { start, end, mode };
  }

  function rowsInRange(range) {
    if (!range.start || !range.end) return [];
    return [...data]
      .filter(r => r.weekStart >= range.start && r.weekStart <= range.end)
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  }

  function rangeReadable(range) {
    if (!range.start) return '—';
    const fmtD = (iso) => {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    };
    const w = weeksBetween(range.start, range.end);
    return `${fmtD(range.start)} – ${fmtD(range.end)} (${w} wk${w === 1 ? '' : 's'})`;
  }

  function syncRangeInputsFromState() {
    const main = resolveMainRange();
    if (presetSelect.value !== 'custom') {
      rangeStartInput.value = main.start;
      rangeEndInput.value = main.end;
    }
    const cmp = resolveCompareRange(main);
    if (compareSelect.value !== 'custom' && cmp.start) {
      compareStartInput.value = cmp.start;
      compareEndInput.value = cmp.end;
    }
    customRangeGroup.hidden = presetSelect.value !== 'custom';
    customCompareGroup.hidden = compareSelect.value !== 'custom';
  }

  function sumKey(rows, key) {
    return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
  }
  function latestKey(rows, key) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][key] !== undefined && rows[i][key] !== null && rows[i][key] !== '') return Number(rows[i][key]) || 0;
    }
    return 0;
  }

  function renderKpis(mainRows, compareRows, compareMode) {
    const wrap = document.getElementById('kpis');
    wrap.innerHTML = '';

    // Pre-compute MRR Brands total so the per-tier cards can show share-of-total.
    const mrrBrandsTotal = latestKey(mainRows, 'mrrBrands');

    KPI_LIST.forEach(kpi => {
      const current  = kpi.latest ? latestKey(mainRows, kpi.key)    : sumKey(mainRows, kpi.key);
      const previous = kpi.latest ? latestKey(compareRows, kpi.key) : sumKey(compareRows, kpi.key);

      let deltaPct = null;
      if (compareMode !== 'none' && previous > 0) deltaPct = ((current - previous) / previous) * 100;

      const div = document.createElement('div');
      div.className = 'kpi' + (kpi.group === 'mrrTier' ? ' tier' : '');
      const isGood = kpi.invert ? (deltaPct !== null && deltaPct < 0) : (deltaPct !== null && deltaPct > 0);
      const isBad  = kpi.invert ? (deltaPct !== null && deltaPct > 0) : (deltaPct !== null && deltaPct < 0);
      const deltaClass = deltaPct === null ? 'flat' : (isGood ? 'up' : (isBad ? 'down' : 'flat'));
      const compareLabelMap = { prev: 'previous period', year: 'previous year', custom: 'custom range' };
      const compareLabel = compareLabelMap[compareMode] || 'comparison';
      const deltaText = compareMode === 'none'
        ? 'no comparison'
        : deltaPct === null
          ? `vs ${compareLabel} —`
          : `${deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(deltaPct).toFixed(1)}% vs ${compareLabel}`;

      let share = '';
      if (kpi.group === 'mrrTier' && mrrBrandsTotal > 0) {
        const pct = (current / mrrBrandsTotal) * 100;
        share = `<div class="kpi-share">${pct.toFixed(0)}% of brand MRR</div>`;
      }

      div.innerHTML = `
        <div class="label">${kpi.label}${kpi.latest ? ' (latest)' : ''}</div>
        <div class="value">${fmt(current, kpi.type)}</div>
        <div class="delta ${deltaClass}">${deltaText}</div>
        ${share}
      `;
      wrap.appendChild(div);
    });
  }

  const chartColors = ['#5b8dff','#2dd4bf','#f59e0b','#f472b6','#a78bfa','#facc15','#34d399','#60a5fa'];

  function baseOptions(extra = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#cfd6ec', boxWidth: 10, boxHeight: 10 } },
        tooltip: {
          backgroundColor: '#111732',
          borderColor: '#2a355b',
          borderWidth: 1,
          titleColor: '#e7ecf7',
          bodyColor: '#cfd6ec',
        },
      },
      scales: {
        x: { ticks: { color: '#9aa3bf' }, grid: { color: 'rgba(255,255,255,.05)' } },
        y: { ticks: { color: '#9aa3bf' }, grid: { color: 'rgba(255,255,255,.05)' }, beginAtZero: true },
      },
      ...extra,
    };
  }

  function makeChart(id, config) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, config);
  }

  function renderCharts(mainRows, compareRows, compareMode) {
    const labels = mainRows.map(r => shortWeekLabel(r.weekStart));
    const col = (i) => chartColors[i % chartColors.length];

    // Align compare values to main labels by index (compare period plotted onto current x-axis)
    const compareDates = compareRows.map(r => r.weekStart);
    const compareValAt = (i, key) => {
      const r = compareRows[i];
      return r ? (Number(r[key]) || 0) : null;
    };
    const compareLabelTag = compareMode === 'year' ? 'prior yr'
                          : compareMode === 'custom' ? 'compare'
                          : 'prior';

    const line = (label, key, color) => ({
      label, data: mainRows.map(r => Number(r[key]) || 0),
      borderColor: color, backgroundColor: color + '33',
      tension: .3, fill: false, pointRadius: 2, borderWidth: 2,
    });
    const compareLine = (label, key, color) => ({
      label: `${label} (${compareLabelTag})`,
      data: labels.map((_, i) => compareValAt(i, key)),
      borderColor: color,
      backgroundColor: 'transparent',
      borderDash: [6, 4],
      borderWidth: 1.5,
      tension: .3,
      fill: false,
      pointRadius: 1,
      pointHoverRadius: 3,
      spanGaps: true,
    });
    const bar = (label, key, color) => ({
      label, data: mainRows.map(r => Number(r[key]) || 0),
      backgroundColor: color, borderColor: color, borderWidth: 1,
    });

    const compareTooltipFooter = (items) => {
      if (compareMode === 'none' || !items.length) return '';
      const i = items[0].dataIndex;
      const cd = compareDates[i];
      return cd ? `Compared to week of ${cd}` : '';
    };
    const optsLine = baseOptions({
      plugins: {
        legend: { labels: { color: '#cfd6ec', boxWidth: 10, boxHeight: 10 } },
        tooltip: {
          backgroundColor: '#111732', borderColor: '#2a355b', borderWidth: 1,
          titleColor: '#e7ecf7', bodyColor: '#cfd6ec',
          callbacks: { footer: compareTooltipFooter },
        },
      },
    });

    const lineChart = (id, datasets) => makeChart(id, {
      type: 'line',
      data: { labels, datasets },
      options: optsLine,
    });

    const trafficSets = [
      line('Organic', 'organic', col(0)),
      line('Paid', 'paid', col(1)),
    ];
    if (compareMode !== 'none' && compareRows.length) {
      trafficSets.push(compareLine('Organic', 'organic', col(0)));
      trafficSets.push(compareLine('Paid', 'paid', col(1)));
    }
    lineChart('trafficChart', trafficSets);

    const revenueSets = [
      line('Revenue', 'revenue', col(0)),
      line('Deposits', 'deposits', col(2)),
    ];
    if (compareMode !== 'none' && compareRows.length) {
      revenueSets.push(compareLine('Revenue', 'revenue', col(0)));
      revenueSets.push(compareLine('Deposits', 'deposits', col(2)));
    }
    lineChart('revenueChart', revenueSets);

    makeChart('costRevenueChart', {
      type: 'bar',
      data: { labels, datasets: [ bar('Costs', 'costs', col(3)), bar('Revenue', 'revenue', col(1)) ] },
      options: baseOptions(),
    });

    const mrrSets = [
      line('MRR Brands', 'mrrBrands', col(0)),
      line('MRR Creators', 'mrrCreators', col(4)),
    ];
    if (compareMode !== 'none' && compareRows.length) {
      mrrSets.push(compareLine('MRR Brands', 'mrrBrands', col(0)));
      mrrSets.push(compareLine('MRR Creators', 'mrrCreators', col(4)));
    }
    lineChart('mrrChart', mrrSets);

    makeChart('emailChart', {
      type: 'bar',
      data: { labels, datasets: [
        bar('Sent', 'mktgSent', col(0)),
        bar('Viewed', 'mktgViewed', col(1)),
        bar('Clicked', 'mktgClicked', col(2)),
      ]},
      options: baseOptions(),
    });

    const coldResponseRate = mainRows.map(r => {
      const sent = Number(r.coldSent) || 0;
      const resp = Number(r.coldResp) || 0;
      return sent > 0 ? +(100 * resp / sent).toFixed(2) : null;
    });
    makeChart('coldEmailChart', {
      type: 'bar',
      data: { labels, datasets: [
        { ...bar('Sent', 'coldSent', col(4)), yAxisID: 'y' },
        { ...bar('Responses', 'coldResp', col(1)), yAxisID: 'y' },
        {
          type: 'line',
          label: 'Response Rate %',
          data: coldResponseRate,
          borderColor: col(2),
          backgroundColor: col(2) + '33',
          tension: .3,
          pointRadius: 3,
          borderWidth: 2,
          yAxisID: 'y1',
          spanGaps: true,
        },
      ]},
      options: baseOptions({
        scales: {
          x: { ticks: { color: '#9aa3bf' }, grid: { color: 'rgba(255,255,255,.05)' } },
          y: {
            type: 'linear', position: 'left', beginAtZero: true,
            ticks: { color: '#9aa3bf' }, grid: { color: 'rgba(255,255,255,.05)' },
            title: { display: true, text: 'Volume', color: '#9aa3bf' },
          },
          y1: {
            type: 'linear', position: 'right', beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: { color: '#9aa3bf', callback: (v) => v + '%' },
            title: { display: true, text: 'Response %', color: '#9aa3bf' },
          },
        },
      }),
    });

    makeChart('landingChart', {
      type: 'bar',
      data: { labels, datasets: [
        bar('Views', 'lpViews', col(0)),
        bar('Submissions', 'lpSubs', col(1)),
      ]},
      options: baseOptions(),
    });

    const stackedRepDatasets = (breakdownKey, totalKey) => {
      const anyRepData = mainRows.some(r => {
        const m = r[breakdownKey];
        return m && Object.values(m).some(v => Number(v) > 0);
      });
      if (!anyRepData || reps.length === 0) {
        return [{
          label: 'Total (no rep breakdown)',
          data: mainRows.map(r => Number(r[totalKey]) || 0),
          backgroundColor: '#5b8dff',
          borderColor: '#5b8dff',
          stack: 'rep',
        }];
      }
      return reps.map((rep, idx) => ({
        label: rep.name,
        data: mainRows.map(r => {
          const m = r[breakdownKey] || {};
          return Number(m[rep.id]) || 0;
        }),
        backgroundColor: repColor(rep, idx),
        borderColor: repColor(rep, idx),
        stack: 'rep',
      }));
    };
    const stackedOpts = baseOptions({
      scales: {
        x: { stacked: true, ticks: { color: '#9aa3bf' }, grid: { color: 'rgba(255,255,255,.05)' } },
        y: { stacked: true, beginAtZero: true, ticks: { color: '#9aa3bf' }, grid: { color: 'rgba(255,255,255,.05)' } },
      },
    });
    makeChart('salesCallsChart', {
      type: 'bar',
      data: { labels, datasets: stackedRepDatasets('salesCallsByRep', 'salesCalls') },
      options: stackedOpts,
    });
    makeChart('newClientsChart', {
      type: 'bar',
      data: { labels, datasets: stackedRepDatasets('newClientsByRep', 'newClients') },
      options: stackedOpts,
    });

    makeChart('signupsChart', {
      type: 'bar',
      data: { labels, datasets: [
        bar('Creators', 'creators', col(4)),
        bar('Brands', 'brands', col(3)),
      ]},
      options: baseOptions(),
    });

    const gmvSets = [ line('Creator GMV', 'gmv', col(1)) ];
    if (compareMode !== 'none' && compareRows.length) {
      gmvSets.push(compareLine('Creator GMV', 'gmv', col(1)));
    }
    lineChart('gmvChart', gmvSets);

    makeChart('campaignsChart', {
      type: 'bar',
      data: { labels, datasets: [ bar('Campaigns > $1k', 'campaigns', col(2)) ] },
      options: baseOptions(),
    });

    makeChart('videosChart', {
      type: 'bar',
      data: { labels, datasets: [ bar('Videos', 'videos', col(5)) ] },
      options: baseOptions(),
    });
  }

  function renderTable(mainRows) {
    const tbody = document.getElementById('weeksBody');
    const rows = [...mainRows].sort((a,b) => b.weekStart.localeCompare(a.weekStart));
    tbody.innerHTML = '';
    if (rows.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="23">No weeks in this range. Pick a wider range or click <b>Add / Edit Week</b>.</td></tr>`;
      return;
    }
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.dataset.week = r.weekStart;
      tr.innerHTML = `
        <td>${weekLabel(r.weekStart)}</td>
        <td>${fmt(r.organic,'int')}</td>
        <td>${fmt(r.paid,'int')}</td>
        <td>${fmt(r.costs,'money')}</td>
        <td>${fmt(r.salesCalls,'int')}</td>
        <td>${fmt(r.newClients,'int')}</td>
        <td>${fmt(r.mktgSent,'int')}</td>
        <td>${fmt(r.mktgViewed,'int')}</td>
        <td>${fmt(r.mktgClicked,'int')}</td>
        <td>${fmt(r.lpViews,'int')}</td>
        <td>${fmt(r.lpSubs,'int')}</td>
        <td>${fmt(r.coldSent,'int')}</td>
        <td>${fmt(r.coldResp,'int')}</td>
        <td>${fmt(r.deposits,'money')}</td>
        <td>${fmt(r.revenue,'money')}</td>
        <td>${fmt(r.creators,'int')}</td>
        <td>${fmt(r.brands,'int')}</td>
        <td>${fmt(r.campaigns,'int')}</td>
        <td>${fmt(r.mrrBrands,'money')}</td>
        <td>${fmt(r.mrrCreators,'money')}</td>
        <td>${fmt(r.gmv,'money')}</td>
        <td>${fmt(r.videos,'int')}</td>
        <td>
          <span class="row-actions">
            <button class="row-audit" title="Audit data sources">⌕</button>
            <button class="row-delete" title="Delete">&times;</button>
          </span>
        </td>
      `;
      tr.addEventListener('click', (e) => {
        if (e.target.classList.contains('row-audit')) {
          e.stopPropagation();
          openAuditDrawer(r.weekStart);
          return;
        }
        if (e.target.classList.contains('row-delete')) {
          e.stopPropagation();
          if (confirm('Remove your manual entry for this week? (Windsor data, if any, will remain.)')) {
            manualData = manualData.filter(x => x.weekStart !== r.weekStart);
            saveData(manualData);
            data = buildEffectiveData();
            renderAll();
          }
          return;
        }
        openModal(r.weekStart);
      });
      tbody.appendChild(tr);
    }
  }

  let repSortKey = 'newClients';
  let repSortDir = 'desc';

  function computeRepLeaderboard(mainRows) {
    if (reps.length === 0) return [];
    const weekCount = mainRows.length || 1;
    const totals = reps.map((rep, idx) => {
      let calls = 0;
      let newClients = 0;
      for (const r of mainRows) {
        calls      += Number(r.salesCallsByRep?.[rep.id]) || 0;
        newClients += Number(r.newClientsByRep?.[rep.id]) || 0;
      }
      return {
        rep, idx,
        calls, newClients,
        winRate: calls > 0 ? (newClients / calls) * 100 : 0,
        callsPerWeek: calls / weekCount,
        newPerWeek: newClients / weekCount,
        callShare: 0, // filled below
      };
    });
    const totalCalls = totals.reduce((a, t) => a + t.calls, 0);
    for (const t of totals) {
      t.callShare = totalCalls > 0 ? (t.calls / totalCalls) * 100 : 0;
    }
    const direction = repSortDir === 'asc' ? 1 : -1;
    totals.sort((a, b) => {
      const av = repSortKey === 'name' ? a.rep.name.toLowerCase() : a[repSortKey];
      const bv = repSortKey === 'name' ? b.rep.name.toLowerCase() : b[repSortKey];
      if (av < bv) return -1 * direction;
      if (av > bv) return  1 * direction;
      return 0;
    });
    return totals;
  }

  function renderRepLeaderboard(mainRows) {
    const tbody = document.getElementById('repLeaderboardBody');
    const ths = document.querySelectorAll('#repLeaderboard thead th');
    if (!tbody) return;
    ths.forEach(th => {
      th.removeAttribute('data-sorted');
      if (th.dataset.sort === repSortKey) th.setAttribute('data-sorted', repSortDir);
    });
    const rows = computeRepLeaderboard(mainRows);
    tbody.innerHTML = '';
    if (rows.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No sales reps configured. Click <b>Sales Reps</b> in the topbar to add some.</td></tr>`;
      return;
    }
    rows.forEach((t, displayIdx) => {
      const tr = document.createElement('tr');
      if (displayIdx === 0 && repSortDir === 'desc' && t[repSortKey] > 0) tr.classList.add('top-row');
      const color = repColor(t.rep, t.idx);
      tr.innerHTML = `
        <td>
          <span class="rep-cell">
            <span class="swatch" style="background:${color}"></span>${t.rep.name}
          </span>
        </td>
        <td class="num">${numFmt.format(t.calls)}</td>
        <td class="num">${numFmt.format(t.newClients)}</td>
        <td class="num">${t.winRate.toFixed(1)}%</td>
        <td class="num">${t.callsPerWeek.toFixed(1)}</td>
        <td class="num">${t.newPerWeek.toFixed(1)}</td>
        <td class="num">${t.callShare.toFixed(0)}%</td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.querySelectorAll('#repLeaderboard thead th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (!key) return;
      if (repSortKey === key) {
        repSortDir = repSortDir === 'desc' ? 'asc' : 'desc';
      } else {
        repSortKey = key;
        repSortDir = key === 'name' ? 'asc' : 'desc';
      }
      renderAll();
    });
  });

  function renderAll() {
    syncRangeInputsFromState();
    const main = resolveMainRange();
    const compare = resolveCompareRange(main);
    const mainRows = rowsInRange(main);
    const compareRows = rowsInRange(compare);

    renderKpis(mainRows, compareRows, compare.mode);
    renderCharts(mainRows, compareRows, compare.mode);
    renderRepLeaderboard(mainRows);
    renderTable(mainRows);

    if (rangeLabelEl) {
      const cmpText = compare.mode === 'none' ? '' :
        ` <span class="vs">vs</span> <span class="compare">${rangeReadable(compare)}</span>`;
      rangeLabelEl.innerHTML = `${rangeReadable(main)}${cmpText}`;
    }
  }

  /* ---------- Modal ---------- */
  const modal = document.getElementById('modal');
  const form = document.getElementById('weekForm');
  const modalTitle = document.getElementById('modalTitle');
  const deleteBtn = document.getElementById('deleteWeekBtn');
  const repInputsContainer = document.getElementById('repInputsContainer');
  const repTotalsEl = document.getElementById('repTotals');

  function renderRepInputs(existing) {
    repInputsContainer.innerHTML = '';
    if (reps.length === 0) {
      repInputsContainer.innerHTML = '<div class="rep-empty">No sales reps configured. Click <b>Sales Reps</b> in the top bar to add some.</div>';
      updateRepTotals();
      return;
    }
    const headers = document.createElement('div');
    headers.className = 'rep-row-header';
    headers.style.gridColumn = '1 / 2';
    headers.textContent = 'Rep';
    const h2 = document.createElement('div');
    h2.className = 'rep-row-header';
    h2.textContent = 'Calls';
    const h3 = document.createElement('div');
    h3.className = 'rep-row-header';
    h3.textContent = 'New Clients';
    repInputsContainer.append(headers, h2, h3);

    reps.forEach((rep, idx) => {
      const callsVal = (existing?.salesCallsByRep && existing.salesCallsByRep[rep.id]) ?? '';
      const newVal   = (existing?.newClientsByRep && existing.newClientsByRep[rep.id]) ?? '';
      const nameDiv = document.createElement('div');
      nameDiv.className = 'rep-name';
      nameDiv.innerHTML = `<span class="swatch" style="background:${repColor(rep, idx)}"></span>${rep.name}`;
      const callsInput = document.createElement('input');
      callsInput.type = 'number'; callsInput.min = '0'; callsInput.step = '1';
      callsInput.dataset.rep = rep.id; callsInput.dataset.kind = 'calls';
      callsInput.value = callsVal;
      callsInput.addEventListener('input', updateRepTotals);
      const newInput = document.createElement('input');
      newInput.type = 'number'; newInput.min = '0'; newInput.step = '1';
      newInput.dataset.rep = rep.id; newInput.dataset.kind = 'new';
      newInput.value = newVal;
      newInput.addEventListener('input', updateRepTotals);
      repInputsContainer.append(nameDiv, callsInput, newInput);
    });
    updateRepTotals();
  }

  function readRepInputs() {
    const calls = {}, news = {};
    let callsSum = 0, newsSum = 0;
    repInputsContainer.querySelectorAll('input[data-rep]').forEach(input => {
      const v = parseInt(input.value, 10);
      if (Number.isNaN(v) || v <= 0) return;
      if (input.dataset.kind === 'calls') { calls[input.dataset.rep] = v; callsSum += v; }
      else { news[input.dataset.rep] = v; newsSum += v; }
    });
    return { calls, news, callsSum, newsSum };
  }

  function updateRepTotals() {
    if (!repTotalsEl) return;
    if (reps.length === 0) { repTotalsEl.innerHTML = ''; return; }
    const { callsSum, newsSum } = readRepInputs();
    const totalCalls = parseInt(form.elements.salesCalls?.value, 10) || 0;
    const totalNew   = parseInt(form.elements.newClients?.value, 10) || 0;
    const callMatch  = totalCalls === 0 || callsSum === totalCalls;
    const newMatch   = totalNew === 0 || newsSum === totalNew;
    repTotalsEl.innerHTML = `
      <span>Rep calls sum: <b>${callsSum}</b> ${totalCalls > 0 ? `<span class="${callMatch ? 'ok' : 'mismatch'}">(total: ${totalCalls})</span>` : ''}</span>
      <span>Rep new clients sum: <b>${newsSum}</b> ${totalNew > 0 ? `<span class="${newMatch ? 'ok' : 'mismatch'}">(total: ${totalNew})</span>` : ''}</span>
    `;
  }
  // Recalc totals row when the global totals fields change too.
  ['salesCalls','newClients'].forEach(name => {
    form.elements[name]?.addEventListener('input', updateRepTotals);
  });

  function openModal(weekStart) {
    form.reset();
    const today = toMonday(new Date());
    let existing = null;
    if (weekStart) {
      existing = data.find(r => r.weekStart === weekStart) || null;
    }
    if (existing) {
      modalTitle.textContent = 'Edit Week';
      deleteBtn.classList.remove('hidden');
      Object.entries(existing).forEach(([k,v]) => {
        if (form.elements[k] && typeof v !== 'object') form.elements[k].value = v;
      });
    } else {
      modalTitle.textContent = 'Add Week';
      deleteBtn.classList.add('hidden');
      form.elements.weekStart.value = fmtDate(today);
    }
    renderRepInputs(existing);
    modal.classList.remove('hidden');
  }
  function closeModal() { modal.classList.add('hidden'); }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const raw = Object.fromEntries(fd.entries());
    const monday = toMonday(new Date(raw.weekStart));
    const weekStart = fmtDate(monday);
    const row = { weekStart };
    for (const m of METRICS) {
      const v = raw[m.key];
      row[m.key] = v === '' || v === undefined ? 0 : (m.type === 'money' ? Number(v) : parseInt(v, 10) || 0);
    }
    const { calls, news, callsSum, newsSum } = readRepInputs();
    if (Object.keys(calls).length) {
      row.salesCallsByRep = calls;
      if (!row.salesCalls) row.salesCalls = callsSum;
    }
    if (Object.keys(news).length) {
      row.newClientsByRep = news;
      if (!row.newClients) row.newClients = newsSum;
    }
    const idx = manualData.findIndex(r => r.weekStart === weekStart);
    if (idx >= 0) manualData[idx] = row; else manualData.push(row);
    saveData(manualData);
    data = buildEffectiveData();
    closeModal();
    renderAll();
  });

  deleteBtn.addEventListener('click', () => {
    const ws = form.elements.weekStart.value;
    if (!ws) return;
    if (!confirm('Remove your manual entry for this week? (Windsor data, if any, will remain.)')) return;
    manualData = manualData.filter(r => r.weekStart !== ws);
    saveData(manualData);
    data = buildEffectiveData();
    closeModal(); renderAll();
  });

  document.getElementById('addWeekBtn').addEventListener('click', () => openModal(null));
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  /* ---------- Reps modal ---------- */
  const repsModal       = document.getElementById('repsModal');
  const repsListEl      = document.getElementById('repsList');
  const newRepNameInput = document.getElementById('newRepName');

  function renderRepsList() {
    repsListEl.innerHTML = '';
    if (reps.length === 0) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="hint">No reps yet — add one below.</span>';
      repsListEl.appendChild(li);
      return;
    }
    reps.forEach((rep, idx) => {
      const li = document.createElement('li');
      const swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.value = repColor(rep, idx);
      swatch.title = 'Color';
      swatch.style.width = '32px';
      swatch.style.padding = '0';
      swatch.style.border = '0';
      swatch.style.background = 'transparent';
      swatch.addEventListener('input', () => {
        rep.color = swatch.value;
        saveReps(reps);
        renderAll();
      });
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = rep.name;
      nameInput.addEventListener('change', () => {
        const v = nameInput.value.trim();
        if (!v) return;
        rep.name = v;
        saveReps(reps);
        renderAll();
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn';
      del.innerHTML = '&times;';
      del.title = 'Remove rep';
      del.addEventListener('click', () => {
        if (!confirm(`Remove ${rep.name}? Their historical per-rep data will remain in saved weeks but won't show in the chart.`)) return;
        reps = reps.filter(r => r.id !== rep.id);
        saveReps(reps);
        renderRepsList();
        renderAll();
      });
      li.append(swatch, nameInput, del);
      repsListEl.appendChild(li);
    });
  }

  function openRepsModal() {
    renderRepsList();
    repsModal.classList.remove('hidden');
  }
  function closeRepsModal() { repsModal.classList.add('hidden'); }

  document.getElementById('manageRepsBtn').addEventListener('click', openRepsModal);
  document.getElementById('closeRepsModal').addEventListener('click', closeRepsModal);
  document.getElementById('closeRepsModalBtn').addEventListener('click', closeRepsModal);
  repsModal.addEventListener('click', (e) => { if (e.target === repsModal) closeRepsModal(); });

  document.getElementById('addRepBtn').addEventListener('click', () => {
    const name = newRepNameInput.value.trim();
    if (!name) return;
    const color = REP_PALETTE[reps.length % REP_PALETTE.length];
    reps.push({ id: newRepId(), name, color });
    saveReps(reps);
    newRepNameInput.value = '';
    renderRepsList();
    renderAll();
  });
  newRepNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('addRepBtn').click(); }
  });

  /* ---------- Export / Import ---------- */
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    download('jb-marketing-dashboard.json', JSON.stringify(data, null, 2), 'application/json');
  });

  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const baseCols = ['weekStart', ...METRICS.map(m => m.key)];
    const repCallCols = reps.map(r => `calls__${r.name}`);
    const repNewCols  = reps.map(r => `newClients__${r.name}`);
    const cols = [...baseCols, ...repCallCols, ...repNewCols];
    const head = cols.join(',');
    const rows = [...data].sort((a,b) => a.weekStart.localeCompare(b.weekStart))
      .map(r => {
        const baseVals = baseCols.map(c => JSON.stringify(r[c] ?? ''));
        const callsVals = reps.map(rep => JSON.stringify((r.salesCallsByRep && r.salesCallsByRep[rep.id]) ?? ''));
        const newsVals  = reps.map(rep => JSON.stringify((r.newClientsByRep  && r.newClientsByRep[rep.id])  ?? ''));
        return [...baseVals, ...callsVals, ...newsVals].join(',');
      });
    download('jb-marketing-dashboard.csv', [head, ...rows].join('\n'), 'text/csv');
  });

  document.getElementById('importJsonInput').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) throw new Error('Invalid file');
        manualData = parsed;
        saveData(manualData);
        data = buildEffectiveData();
        renderAll();
      } catch (err) {
        alert('Could not import: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    if (!confirm('Reset your manual entries? (Windsor-synced data, if any, will remain.)')) return;
    manualData = [];
    saveData(manualData);
    data = buildEffectiveData();
    renderAll();
  });

  /* ---------- Audit drawer ---------- */
  const auditDrawer = document.getElementById('auditDrawer');
  const auditTitle = document.getElementById('auditTitle');
  const auditSubtitle = document.getElementById('auditSubtitle');
  const auditBody = document.getElementById('auditBody');

  function metricLabel(key) {
    const m = METRICS.find(x => x.key === key);
    return m ? m.label : key;
  }
  function metricType(key) {
    const m = METRICS.find(x => x.key === key);
    return m ? m.type : 'int';
  }

  function openAuditDrawer(weekStart) {
    auditTitle.textContent = `Week Audit · ${weekLabel(weekStart)}`;
    const eff = data.find(r => r.weekStart === weekStart) || { weekStart };
    const manual = manualData.find(r => r.weekStart === weekStart) || null;
    const direct = directData.find(r => r.weekStart === weekStart) || null;
    const windsor = windsorData.find(r => r.weekStart === weekStart) || null;
    const directSrcMap = directBySource[weekStart] || {};
    const windsorSrcMap = windsorBySource[weekStart] || {};

    // Collect every metric key seen across all layers for this week.
    const metricKeys = new Set();
    function harvest(obj) {
      if (!obj) return;
      for (const k of Object.keys(obj)) {
        if (k === 'weekStart' || k === 'salesCallsByRep' || k === 'newClientsByRep') continue;
        metricKeys.add(k);
      }
    }
    harvest(manual); harvest(direct); harvest(windsor);
    for (const m of Object.values(directSrcMap)) harvest(m);
    for (const m of Object.values(windsorSrcMap)) harvest(m);

    auditSubtitle.innerHTML = `<b>${metricKeys.size}</b> metrics &middot; sources: ` +
      [
        manual ? '<span class="src manual">manual</span>' : null,
        Object.keys(directSrcMap).length ? `<span class="src direct">direct (${Object.keys(directSrcMap).join(', ')})</span>` : null,
        Object.keys(windsorSrcMap).length ? `<span class="src windsor">windsor (${Object.keys(windsorSrcMap).join(', ')})</span>` : null,
      ].filter(Boolean).join(' &middot; ');

    if (metricKeys.size === 0) {
      auditBody.innerHTML = `<div class="audit-empty">No data for this week.</div>`;
    } else {
      // Order metrics by METRICS list, then any extras alphabetically.
      const orderedKeys = [
        ...METRICS.map(m => m.key).filter(k => metricKeys.has(k)),
        ...[...metricKeys].filter(k => !METRICS.some(m => m.key === k)).sort(),
      ];
      const html = orderedKeys.map(key => {
        const t = metricType(key);
        const effVal = eff[key];
        const manualVal = manual?.[key];
        const directVal = direct?.[key];
        const windsorVal = windsor?.[key];
        const directParts = Object.entries(directSrcMap)
          .filter(([_, m]) => m && m[key] !== undefined && m[key] !== null && m[key] !== '')
          .map(([src, m]) => ({ src, val: m[key] }));
        const windsorParts = Object.entries(windsorSrcMap)
          .filter(([_, m]) => m && m[key] !== undefined && m[key] !== null && m[key] !== '')
          .map(([src, m]) => ({ src, val: m[key] }));

        const winning = manualVal !== undefined && manualVal !== null && manualVal !== '' ? 'manual'
                      : directVal !== undefined && directVal !== null && directVal !== '' ? 'direct'
                      : windsorVal !== undefined && windsorVal !== null && windsorVal !== '' ? 'windsor'
                      : null;

        const rowsHtml = [];
        if (manualVal !== undefined && manualVal !== null && manualVal !== '') {
          rowsHtml.push(`
            <div class="audit-row">
              <span class="src manual">manual</span>
              <span class="label">user override</span>
              <span class="val">${fmt(manualVal, t)}${winning === 'manual' ? '<span class="badge">used</span>' : ''}</span>
            </div>`);
        }
        for (const p of directParts) {
          rowsHtml.push(`
            <div class="audit-row${winning !== 'direct' && winning !== null ? ' dim' : ''}">
              <span class="src direct">direct</span>
              <span class="label">${p.src}</span>
              <span class="val">${fmt(p.val, t)}${winning === 'direct' && directParts.length === 1 ? '<span class="badge">used</span>' : ''}</span>
            </div>`);
        }
        if (winning === 'direct' && directParts.length > 1) {
          rowsHtml.push(`
            <div class="audit-row">
              <span class="src direct">direct</span>
              <span class="label">sum across sources</span>
              <span class="val">${fmt(directVal, t)}<span class="badge">used</span></span>
            </div>`);
        }
        for (const p of windsorParts) {
          rowsHtml.push(`
            <div class="audit-row${winning && winning !== 'windsor' ? ' dim' : ''}">
              <span class="src windsor">windsor</span>
              <span class="label">${p.src}</span>
              <span class="val">${fmt(p.val, t)}${winning === 'windsor' && windsorParts.length === 1 ? '<span class="badge">used</span>' : ''}</span>
            </div>`);
        }
        if (winning === 'windsor' && windsorParts.length > 1) {
          rowsHtml.push(`
            <div class="audit-row">
              <span class="src windsor">windsor</span>
              <span class="label">sum across sources</span>
              <span class="val">${fmt(windsorVal, t)}<span class="badge">used</span></span>
            </div>`);
        }

        return `
          <section class="audit-metric">
            <header>
              <span class="name">${metricLabel(key)}</span>
              <span class="effective">${fmt(effVal, t)}</span>
            </header>
            <div class="audit-rows">${rowsHtml.join('') || '<div class="audit-empty">No source contributed.</div>'}</div>
          </section>`;
      }).join('');
      auditBody.innerHTML = html;
    }

    auditDrawer.classList.remove('hidden');
    auditDrawer.setAttribute('aria-hidden', 'false');
  }
  function closeAuditDrawer() {
    auditDrawer.classList.add('hidden');
    auditDrawer.setAttribute('aria-hidden', 'true');
  }
  document.getElementById('closeAuditDrawer').addEventListener('click', closeAuditDrawer);
  document.getElementById('closeAuditDrawerBtn').addEventListener('click', closeAuditDrawer);
  auditDrawer.addEventListener('click', (e) => { if (e.target === auditDrawer) closeAuditDrawer(); });

  presetSelect.addEventListener('change', () => {
    customRangeGroup.hidden = presetSelect.value !== 'custom';
    renderAll();
  });
  compareSelect.addEventListener('change', () => {
    customCompareGroup.hidden = compareSelect.value !== 'custom';
    renderAll();
  });
  [rangeStartInput, rangeEndInput].forEach(el => el.addEventListener('change', () => {
    if (presetSelect.value !== 'custom') presetSelect.value = 'custom';
    customRangeGroup.hidden = false;
    renderAll();
  }));
  [compareStartInput, compareEndInput].forEach(el => el.addEventListener('change', () => {
    if (compareSelect.value !== 'custom') compareSelect.value = 'custom';
    customCompareGroup.hidden = false;
    renderAll();
  }));

  /* ---------- Freshness footer ---------- */
  function renderFreshness() {
    const foot = document.querySelector('.pagefoot');
    if (!foot) return;
    const parts = [];
    if (windsorUpdatedAt) {
      parts.push(`Windsor: ${windsorData.length} wk · ${new Date(windsorUpdatedAt).toLocaleString()}`);
    }
    if (directUpdatedAt) {
      parts.push(`Direct API: ${directData.length} wk · ${new Date(directUpdatedAt).toLocaleString()}`);
    }
    if (parts.length === 0) {
      foot.textContent = 'No synced data yet. Configure secrets in Settings → Secrets and variables → Actions, then trigger the sync workflows. Manual entries are stored locally.';
    } else {
      foot.textContent = `${parts.join(' · ')}. Priority: manual entries > direct API > Windsor.`;
    }
  }
  renderFreshness();

  /* ---------- Initial render ---------- */
  renderAll();
})();
