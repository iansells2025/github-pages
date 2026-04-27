/* JB Marketing Dashboard */
(async () => {
  const STORAGE_KEY = 'jb-marketing-dashboard-v1';
  const WINDSOR_URL = 'data/windsor.json';

  const METRICS = [
    { key: 'organic',     label: 'Organic Traffic',        type: 'int' },
    { key: 'paid',        label: 'Paid Traffic',           type: 'int' },
    { key: 'costs',       label: 'Costs',                  type: 'money' },
    { key: 'salesCalls',  label: 'Sales Calls',            type: 'int' },
    { key: 'newClients',  label: 'New Clients (1st spend)',type: 'int' },
    { key: 'mktgSent',    label: 'Marketing Emails Sent',  type: 'int' },
    { key: 'mktgViewed',  label: 'Marketing Emails Viewed',type: 'int' },
    { key: 'mktgClicked', label: 'Marketing Emails Clicked',type: 'int' },
    { key: 'lpViews',     label: 'Landing Page Views',     type: 'int' },
    { key: 'lpSubs',      label: 'Landing Page Submissions',type: 'int' },
    { key: 'coldSent',    label: 'Cold Emails Sent',       type: 'int' },
    { key: 'coldResp',    label: 'Cold Email Responses',   type: 'int' },
    { key: 'deposits',    label: 'Deposits',               type: 'money' },
    { key: 'revenue',     label: 'Revenue',                type: 'money' },
    { key: 'creators',    label: 'Creators Signed Up',     type: 'int' },
    { key: 'brands',      label: 'Brands Signed Up',       type: 'int' },
    { key: 'campaigns',   label: 'New Campaigns >$1k',     type: 'int' },
    { key: 'mrrBrands',   label: 'MRR Brands',             type: 'money' },
    { key: 'mrrCreators', label: 'MRR Creators',           type: 'money' },
    { key: 'gmv',         label: 'Creator GMV',            type: 'money' },
    { key: 'videos',      label: 'Shop Videos Produced',   type: 'int' },
  ];

  const KPI_LIST = [
    { key: 'revenue',    label: 'Revenue',        type: 'money' },
    { key: 'deposits',   label: 'Deposits',       type: 'money' },
    { key: 'costs',      label: 'Costs',          type: 'money', invert: true },
    { key: 'mrrBrands',  label: 'MRR Brands',     type: 'money', latest: true },
    { key: 'mrrCreators',label: 'MRR Creators',   type: 'money', latest: true },
    { key: 'gmv',        label: 'Creator GMV',    type: 'money' },
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
  let windsorUpdatedAt = null;

  async function loadWindsor() {
    try {
      const res = await fetch(WINDSOR_URL, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      windsorData = Array.isArray(json.weeks) ? json.weeks : [];
      windsorUpdatedAt = json.updatedAt || null;
    } catch { /* offline / file missing — fine */ }
  }
  await loadWindsor();

  /* Effective dataset = Windsor baseline overlaid by manual values per metric. */
  function buildEffectiveData() {
    const byWeek = new Map();
    for (const w of windsorData) byWeek.set(w.weekStart, { ...w });
    for (const w of manualData) {
      const base = byWeek.get(w.weekStart) || { weekStart: w.weekStart };
      for (const [k, v] of Object.entries(w)) {
        if (k === 'weekStart') continue;
        if (v !== null && v !== undefined && v !== '') base[k] = v;
      }
      byWeek.set(w.weekStart, base);
    }
    return [...byWeek.values()];
  }

  let data = buildEffectiveData();

  /* ---------- Seed sample data on first load (only if no data anywhere) ---------- */
  if (data.length === 0) {
    manualData = buildSampleData();
    saveData(manualData);
    data = buildEffectiveData();
  }

  function buildSampleData() {
    const rows = [];
    const today = toMonday(new Date());
    for (let i = 12; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 7);
      const base = 13 - i;
      rows.push({
        weekStart: fmtDate(d),
        organic: 1200 + base * 140 + rand(-80, 80),
        paid: 800 + base * 90 + rand(-60, 60),
        costs: 3500 + base * 220 + rand(-200, 200),
        salesCalls: 18 + base * 2 + rand(-3, 3),
        newClients: 3 + Math.floor(base / 2) + rand(0, 2),
        mktgSent: 4000 + base * 220,
        mktgViewed: 1600 + base * 100,
        mktgClicked: 280 + base * 24,
        lpViews: 900 + base * 80 + rand(-50, 50),
        lpSubs: 60 + base * 6 + rand(-5, 5),
        coldSent: 2200 + base * 150,
        coldResp: 90 + base * 8 + rand(-5, 5),
        deposits: 9000 + base * 900 + rand(-400, 400),
        revenue: 12000 + base * 1100 + rand(-500, 500),
        creators: 24 + base * 4 + rand(-2, 4),
        brands: 6 + Math.floor(base / 2) + rand(0, 2),
        campaigns: 2 + Math.floor(base / 3) + rand(0, 1),
        mrrBrands: 8000 + base * 650,
        mrrCreators: 4000 + base * 300,
        gmv: 15000 + base * 1800 + rand(-600, 600),
        videos: 22 + base * 3 + rand(-3, 3),
      });
    }
    return rows;
  }
  function rand(lo, hi) { return Math.floor(Math.random() * (hi - lo + 1)) + lo; }

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

    KPI_LIST.forEach(kpi => {
      const current  = kpi.latest ? latestKey(mainRows, kpi.key)    : sumKey(mainRows, kpi.key);
      const previous = kpi.latest ? latestKey(compareRows, kpi.key) : sumKey(compareRows, kpi.key);

      let deltaPct = null;
      if (compareMode !== 'none' && previous > 0) deltaPct = ((current - previous) / previous) * 100;

      const div = document.createElement('div');
      div.className = 'kpi';
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

      div.innerHTML = `
        <div class="label">${kpi.label}${kpi.latest ? ' (latest)' : ''}</div>
        <div class="value">${fmt(current, kpi.type)}</div>
        <div class="delta ${deltaClass}">${deltaText}</div>
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

    makeChart('coldEmailChart', {
      type: 'bar',
      data: { labels, datasets: [
        bar('Sent', 'coldSent', col(4)),
        bar('Responses', 'coldResp', col(1)),
      ]},
      options: baseOptions(),
    });

    makeChart('landingChart', {
      type: 'bar',
      data: { labels, datasets: [
        bar('Views', 'lpViews', col(0)),
        bar('Submissions', 'lpSubs', col(1)),
      ]},
      options: baseOptions(),
    });

    makeChart('salesChart', {
      type: 'bar',
      data: { labels, datasets: [
        bar('Sales Calls', 'salesCalls', col(0)),
        bar('New Clients', 'newClients', col(1)),
      ]},
      options: baseOptions(),
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
        <td><button class="row-delete" title="Delete">&times;</button></td>
      `;
      tr.addEventListener('click', (e) => {
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

  function renderAll() {
    syncRangeInputsFromState();
    const main = resolveMainRange();
    const compare = resolveCompareRange(main);
    const mainRows = rowsInRange(main);
    const compareRows = rowsInRange(compare);

    renderKpis(mainRows, compareRows, compare.mode);
    renderCharts(mainRows, compareRows, compare.mode);
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
        if (form.elements[k]) form.elements[k].value = v;
      });
    } else {
      modalTitle.textContent = 'Add Week';
      deleteBtn.classList.add('hidden');
      form.elements.weekStart.value = fmtDate(today);
    }
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
    const cols = ['weekStart', ...METRICS.map(m => m.key)];
    const head = cols.join(',');
    const rows = [...data].sort((a,b) => a.weekStart.localeCompare(b.weekStart))
      .map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','));
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
    const wCount = windsorData.length;
    if (windsorUpdatedAt) {
      const when = new Date(windsorUpdatedAt).toLocaleString();
      foot.textContent = `Windsor.ai sync: ${wCount} weeks · last updated ${when}. Manual entries override synced values per metric.`;
    } else {
      foot.textContent = 'Windsor.ai sync not yet running. Add connector secrets in repo Settings → Secrets and variables → Actions, then run the “Sync Windsor.ai Marketing Data” workflow. Manual entries are stored locally.';
    }
  }
  renderFreshness();

  /* ---------- Initial render ---------- */
  renderAll();
})();
