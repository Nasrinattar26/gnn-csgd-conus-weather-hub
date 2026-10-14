/* CNN 24h additions: independent of the existing GNN and dated-comparison viewers. */
(() => {
  'use strict';
  const MODEL = 'cnn_csgd_24h_corrected_v1';
  const VERSION = 'cnn24h_operational_comparison_v1';
  const IDS = ['raw_hrrr', 'ann_operational', 'gnn_operational', MODEL];
  const SHORT = ['Raw HRRR', 'ANN-CSGD', 'GNN-CSGD', 'CNN-CSGD'];
  const COLORS = ['#697789', '#18865b', '#2563eb', '#8b5cc7'];
  const PRODUCTS = [['expected_precip_mm', 'Expected rainfall'], ['prob_gt_0p5inch_percent', 'Probability > 0.5 inch'],
    ['prob_gt_1inch_percent', 'Probability > 1 inch'], ['prob_gt_2inch_percent', 'Probability > 2 inches'],
    ['prob_gt_3inch_percent', 'Probability > 3 inches'], ['prob_gt_5inch_percent', 'Probability > 5 inches']];
  const METRICS = [['crps', 'CRPS (mm)'], ['crpss', 'CRPSS versus raw HRRR'], ['mae', 'MAE (mm)'],
    ['rmse', 'RMSE (mm)'], ['bias', 'Mean bias (mm)'], ['brier', 'Brier score'],
    ['bss_raw', 'BSS versus raw HRRR'], ['bss_monthly', 'BSS versus monthly climatology'],
    ['roc_auc', 'ROC AUC'], ['reliability', 'Reliability diagram']];
  const LIMITS = [['0p5inch', '0.5 inch'], ['1inch', '1 inch'], ['2inch', '2 inches'], ['3inch', '3 inches'], ['5inch', '5 inches']];
  const cache = new Map();
  function setupModelPicker() {
    const picker = document.getElementById('model-selector');
    if (!picker) return;
    const buttons = Array.from(picker.querySelectorAll('[data-weather-model]'));
    const panels = Array.from(document.querySelectorAll('[data-weather-only]'));
    const message = document.getElementById('weather-model-status');
    const hashModel = () => location.hash === '#cnn24-forecast' ? 'cnn' : ['#forecast-workspace', '#animations', '#downloads', '#method'].includes(location.hash) ? 'gnn' : '';
    function choose(model, updateURL) {
      if (!['gnn', 'cnn'].includes(model)) model = '';
      panels.forEach(el => { el.hidden = el.dataset.weatherOnly !== model; });
      buttons.forEach(el => el.setAttribute('aria-pressed', String(el.dataset.weatherModel === model)));
      message.textContent = model === 'gnn' ? 'GNN-CSGD selected · Choose a 6-, 12- or 24-hour forecast below.' : model === 'cnn' ? 'CNN-CSGD selected · 24-hour research forecasts are available below.' : 'Choose GNN-CSGD or CNN-CSGD above to open its forecasts.';
      if (updateURL && location.protocol !== 'file:') {
        const url = new URL(location.href); url.searchParams.set('model', model);
        // Do not retain an anchor inside the other model's hidden panel.
        if (hashModel() && hashModel() !== model) url.hash = 'model-selector';
        history.replaceState(null, '', url);
      }
    }
    buttons.forEach(el => el.addEventListener('click', () => choose(el.dataset.weatherModel, true)));
    const initial = new URLSearchParams(location.search).get('model');
    choose(hashModel() || initial || '', false);
    window.addEventListener('hashchange', () => { if (hashModel()) choose(hashModel(), true); });
    window.addEventListener('popstate', () => choose(hashModel() || new URLSearchParams(location.search).get('model') || '', false));
    // Honor shared initialization links after the original GNN app loads its options.
    const requested = new URLSearchParams(location.search).get('init');
    const gnnInit = document.getElementById('map-init');
    if (gnnInit && /^\d{8}12$/.test(requested || '') && typeof MutationObserver !== 'undefined') {
      const iso = requested.slice(0, 4) + '-' + requested.slice(4, 6) + '-' + requested.slice(6, 8) + 'T12:00:00Z';
      const apply = () => {
        if (Array.from(gnnInit.options).some(option => option.value === iso)) {
          gnnInit.value = iso; gnnInit.dispatchEvent(new Event('change', {bubbles: true})); return true;
        }
        return false;
      };
      if (!apply()) {
        const observer = new MutationObserver(() => { if (apply() || !gnnInit.disabled) observer.disconnect(); });
        observer.observe(gnnInit, {childList: true, attributes: true, attributeFilter: ['disabled']});
      }
    }
  }
  const require = (ok, message) => { if (!ok) throw new Error(message); };
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const fmt = value => finite(value) ? value.toLocaleString('en-US', {maximumFractionDigits: 6}) : 'Unavailable';
  const instant = value => String(value).replace('T', ' ').replace(':00:00Z', ' UTC');
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const pathOK = (path, prefix) => typeof path === 'string' && path.startsWith(prefix) && !path.split('/').includes('..') && /^[A-Za-z0-9_./-]+$/.test(path);
  const svg = (tag, attributes, text) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes || {}).forEach(([key, val]) => el.setAttribute(key, String(val)));
    if (text !== undefined) el.textContent = text;
    return el;
  };
  function table(headers, rows) {
    const box = node('div', undefined, 'cnn24-table-wrap'); const t = node('table');
    const head = node('thead'); const tr = node('tr'); headers.forEach(v => tr.append(node('th', v))); head.append(tr); t.append(head);
    const body = node('tbody'); rows.forEach(row => { const r = node('tr'); row.forEach(v => r.append(node('td', String(v)))); body.append(r); });
    t.append(body); box.append(t); return box;
  }
  function selector(parent, label, options) {
    const wrap = node('label', label); const select = node('select');
    options.forEach(([value, text]) => { const item = node('option', text); item.value = value; select.append(item); });
    wrap.append(select); parent.append(wrap); return select;
  }
  async function readJSON(url, expected) {
    const key = url + ':' + (expected || '');
    if (!cache.has(key)) cache.set(key, (async () => {
      const response = await fetch(url, {cache: 'no-cache'});
      require(response.ok, 'CNN data unavailable (HTTP ' + response.status + ').');
      const bytes = await response.arrayBuffer();
      if (expected && globalThis.crypto && crypto.subtle) {
        const sum = await crypto.subtle.digest('SHA-256', bytes);
        const digest = Array.from(new Uint8Array(sum), b => b.toString(16).padStart(2, '0')).join('');
        require(digest === expected, 'CNN data is updating. Reload after deployment finishes.');
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    })());
    try { return await cache.get(key); } catch (err) { cache.delete(key); throw err; }
  }
  function validateCatalog(catalog) {
    require(catalog.schema_version === 1 && catalog.version === VERSION && catalog.model_id === MODEL && Array.isArray(catalog.runs), 'Unsupported CNN catalog.');
    const seen = new Set();
    catalog.runs.forEach(run => {
      require(/^\d{8}12$/.test(run.initialization) && !seen.has(run.initialization), 'Invalid CNN initialization.');
      require(run.url === 'data/cnn24h_v1/runs/' + run.initialization + '.json' && /^[a-f0-9]{64}$/.test(run.sha256), 'Invalid CNN result path.');
      seen.add(run.initialization);
    });
    require(catalog.runs.length > 0, 'No CNN cycles are available yet.');
  }
  function validateRun(run, init) {
    require(run.schema_version === 1 && run.version === VERSION && run.model_id === MODEL && run.initialization === init, 'CNN run identity differs.');
    require(JSON.stringify(run.models) === JSON.stringify(IDS) && run.duration_hours === 24, 'CNN comparison model list differs.');
    require(Array.isArray(run.windows) && run.windows.length === 5, 'Expected five CNN forecast windows.');
    run.windows.forEach((win, i) => {
      const start = i * 6, end = start + 24, tag = 'f' + String(start).padStart(2, '0') + '_f' + String(end).padStart(2, '0');
      require(win.id === tag && win.start_hour === start && win.end_hour === end, 'Unexpected CNN forecast window.');
      require(['WAITING', 'VERIFIED'].includes(win.status), 'Unknown verification status.');
      PRODUCTS.forEach(([key]) => require(pathOK(win.maps[key], 'products/cnn24h_corrected_v1/' + init + '/maps/24h/' + tag + '/'), 'Invalid CNN map path.'));
      if (win.status === 'VERIFIED') {
        require(win.scores && win.scores.n_samples > 0 && Array.isArray(win.scores.thresholds), 'Verified score data missing.');
        IDS.forEach(id => require(win.scores.models[id], 'Comparison model scores missing.'));
        require(JSON.stringify(win.scores.thresholds.map(t => t.label)) === JSON.stringify(LIMITS.map(t => t[0])), 'Comparison thresholds differ.');
      }
    });
  }
  function bars(values, label) {
    const chart = svg('svg', {viewBox: '0 0 850 285', role: 'img', 'aria-label': label + ' for four systems', class: 'cnn24-chart'});
    chart.append(svg('title', {}, label));
    const valid = values.filter(finite); let lo = Math.min(0, ...valid), hi = Math.max(0, ...valid);
    if (lo === hi) hi = lo + 1;
    const span = hi - lo; if (lo < 0) lo -= span * 0.08; if (hi > 0) hi += span * 0.08;
    const x = v => 155 + (v - lo) / (hi - lo) * 555;
    for (let i = 0; i <= 4; i++) {
      const value = lo + (hi - lo) * i / 4, pos = x(value);
      chart.append(svg('line', {x1: pos, x2: pos, y1: 18, y2: 230, stroke: '#e1e7ef'}));
      chart.append(svg('text', {x: pos, y: 252, 'text-anchor': 'middle'}, Number(value.toPrecision(3)).toString()));
    }
    chart.append(svg('line', {x1: x(0), x2: x(0), y1: 18, y2: 230, stroke: '#6f7f90'}));
    values.forEach((value, i) => {
      const y = 34 + i * 50;
      chart.append(svg('text', {x: 140, y: y + 20, 'text-anchor': 'end'}, SHORT[i]));
      if (finite(value)) chart.append(svg('rect', {x: Math.min(x(0), x(value)), y, width: Math.max(1, Math.abs(x(value) - x(0))), height: 28, fill: COLORS[i], rx: 3}));
      chart.append(svg('text', {x: 730, y: y + 20}, fmt(value)));
    });
    return chart;
  }
  function reliability(threshold) {
    const chart = svg('svg', {viewBox: '0 0 700 470', role: 'img', 'aria-label': 'Reliability: forecast probability versus observed event frequency', class: 'cnn24-chart'});
    chart.append(svg('title', {}, 'Reliability diagram: the diagonal denotes perfect calibration'));
    const x = v => 70 + v * 390, y = v => 400 - v * 350;
    for (let i = 0; i <= 5; i++) {
      const p = i / 5;
      chart.append(svg('line', {x1: x(p), x2: x(p), y1: y(0), y2: y(1), stroke: '#e1e7ef'}));
      chart.append(svg('line', {x1: x(0), x2: x(1), y1: y(p), y2: y(p), stroke: '#e1e7ef'}));
      chart.append(svg('text', {x: x(p), y: 425, 'text-anchor': 'middle'}, p.toFixed(1)));
      chart.append(svg('text', {x: 52, y: y(p) + 5, 'text-anchor': 'end'}, p.toFixed(1)));
    }
    chart.append(svg('line', {x1: x(0), x2: x(1), y1: y(0), y2: y(1), stroke: '#6f7f90', 'stroke-dasharray': '6 5'}));
    chart.append(svg('text', {x: 265, y: 455, 'text-anchor': 'middle'}, 'Forecast probability'));
    chart.append(svg('text', {x: 18, y: 230, transform: 'rotate(-90 18 230)', 'text-anchor': 'middle'}, 'Observed event frequency'));
    IDS.forEach((id, i) => {
      const bins = threshold.models[id].bins.filter(b => b.n > 0 && finite(b.mean_probability) && finite(b.event_frequency));
      chart.append(svg('polyline', {points: bins.map(b => x(b.mean_probability) + ',' + y(b.event_frequency)).join(' '), fill: 'none', stroke: COLORS[i], 'stroke-width': 2}));
      bins.forEach(b => {
        const dot = svg('circle', {cx: x(b.mean_probability), cy: y(b.event_frequency), r: 4, fill: COLORS[i]});
        dot.append(svg('title', {}, SHORT[i] + ': N=' + b.n + ', probability=' + fmt(b.mean_probability) + ', observed=' + fmt(b.event_frequency)));
        chart.append(dot);
      });
      chart.append(svg('rect', {x: 495, y: 80 + i * 36, width: 15, height: 15, fill: COLORS[i]}));
      chart.append(svg('text', {x: 520, y: 93 + i * 36}, SHORT[i]));
    });
    return chart;
  }
  function scoreCSV(run) {
    const rows = [['initialization', 'window', 'valid_end_utc', 'status', 'model', 'threshold_mm', 'metric', 'value', 'n_samples', 'n_events']];
    run.windows.forEach(win => {
      if (win.status !== 'VERIFIED') { rows.push([run.initialization, win.id, win.valid_end_utc, win.status, '', '', '', '', '', '']); return; }
      IDS.forEach(id => {
        ['crps', 'crpss', 'mae', 'rmse', 'bias'].forEach(metric => rows.push([run.initialization, win.id, win.valid_end_utc, win.status, id, '', metric, win.scores.models[id][metric], win.scores.n_samples, '']));
        win.scores.thresholds.forEach(t => {
          if (t.status !== 'VERIFIED') return;
          ['brier', 'bss_raw', 'bss_monthly', 'roc_auc', 'ece'].forEach(metric => rows.push([run.initialization, win.id, win.valid_end_utc, win.status, id, t.threshold_mm, metric, t.models[id][metric], t.n_samples, t.n_events]));
        });
      });
    });
    return rows.map(row => row.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  }
  async function start(panel) {
    const root = panel.dataset.cnnRoot;
    require(['./', '../', 'web/'].includes(root), 'Invalid CNN site root.');
    const preview = window.CNN24H_PREVIEW;
    const status = panel.querySelector('.cnn24-status'), controls = panel.querySelector('.cnn24-controls');
    const output = panel.querySelector('.cnn24-output'), downloads = panel.querySelector('.cnn24-downloads');
    const catalog = preview ? preview.catalog : await readJSON(root + 'data/cnn24h_v1/catalog.json');
    validateCatalog(catalog);
    const init = selector(controls, 'Initialization (UTC)', catalog.runs.map(r => [r.initialization, r.initialization.slice(0, 4) + '-' + r.initialization.slice(4, 6) + '-' + r.initialization.slice(6, 8) + ' 12 UTC']));
    const requested = new URLSearchParams(location.search).get('init');
    if (catalog.runs.some(r => r.initialization === requested)) init.value = requested;
    const winSelect = selector(controls, '24-hour window', [0, 6, 12, 18, 24].map(s => ['f' + String(s).padStart(2, '0') + '_f' + String(s + 24).padStart(2, '0'), 'f' + String(s).padStart(2, '0') + '–f' + String(s + 24).padStart(2, '0')]));
    const isForecast = panel.dataset.cnn24 === 'forecast';
    const choice = selector(controls, isForecast ? 'CNN product' : 'Metric', isForecast ? PRODUCTS : METRICS);
    const thresholdSelect = isForecast ? null : selector(controls, 'Rainfall threshold', LIMITS);
    let ticket = 0, urls = [];
    const release = () => { urls.forEach(URL.revokeObjectURL); urls = []; };
    window.addEventListener('pagehide', release);
    function download(text, content, type, filename) {
      const a = node('a', text); a.href = URL.createObjectURL(new Blob([content], {type})); urls.push(a.href); a.download = filename; downloads.append(a);
    }
    async function display() {
      const thisTicket = ++ticket; status.textContent = 'Loading CNN results…'; output.replaceChildren(); downloads.replaceChildren(); release();
      const thresholdMetric = !isForecast && METRICS.slice(5).some(([id]) => id === choice.value);
      if (thresholdSelect) thresholdSelect.parentElement.hidden = !thresholdMetric;
      try {
        const entry = catalog.runs.find(r => r.initialization === init.value);
        const run = preview ? preview.runs[entry.initialization] : await readJSON(root + entry.url, entry.sha256);
        if (thisTicket !== ticket) return;
        validateRun(run, entry.initialization);
        const win = run.windows.find(w => w.id === winSelect.value);
        status.textContent = 'Valid ' + instant(win.valid_start_utc) + ' → ' + instant(win.valid_end_utc) + ' | MRMS verification: ' + (win.status === 'VERIFIED' ? 'available' : 'pending');
        download('Download run JSON', JSON.stringify(run, null, 2), 'application/json', 'cnn24h_' + entry.initialization + '.json');
        if (isForecast) {
          const picture = node('img'); picture.src = root + win.maps[choice.value]; picture.alt = 'CNN-CSGD ' + PRODUCTS.find(p => p[0] === choice.value)[1] + ', initialization ' + run.initialization + ', ' + win.id;
          picture.addEventListener('error', () => { if (thisTicket === ticket) status.textContent = 'Map unavailable. Check that the complete staged web folder was copied or deployed.'; });
          const a = node('a'); a.href = picture.src; a.target = '_blank'; a.rel = 'noopener'; a.append(picture); output.append(a);
          const link = node('a', 'Open map PNG'); link.href = picture.src; link.target = '_blank'; link.rel = 'noopener'; downloads.append(link);
          return;
        }
        download('Download scores CSV', scoreCSV(run), 'text/csv', 'four_system_scores_' + entry.initialization + '.csv');
        if (win.status !== 'VERIFIED') { output.append(node('p', win.reason || 'MRMS observations are not yet available.', 'cnn24-wait')); return; }
        const threshold = win.scores.thresholds.find(t => t.label === thresholdSelect.value);
        if (thresholdMetric && threshold.status !== 'VERIFIED') { output.append(node('p', 'No common observed samples at this threshold.', 'cnn24-wait')); return; }
        const metric = choice.value;
        output.append(node('p', 'Shared observed land cells: ' + (thresholdMetric ? threshold.n_samples : win.scores.n_samples).toLocaleString('en-US') + (thresholdMetric ? ' | Observed exceedances: ' + threshold.n_events.toLocaleString('en-US') : ''), 'cnn24-counts'));
        if (metric === 'reliability') {
          output.append(reliability(threshold));
          const rows = [];
          IDS.forEach((id, i) => threshold.models[id].bins.forEach((b, j) => { if (b.n) rows.push([SHORT[i], '[' + b.lower + ', ' + b.upper + (j === 9 ? ']' : ')'), b.n, b.events, fmt(b.mean_probability), fmt(b.event_frequency)]); }));
          output.append(table(['System', 'Bin', 'Samples', 'Events', 'Mean probability', 'Observed frequency'], rows));
          output.append(node('p', 'Only nonempty bins are plotted. The diagonal denotes perfect calibration. Rare-event bins can contain very few events.', 'cnn24-note'));
          return;
        }
        const values = IDS.map(id => (thresholdMetric ? threshold.models : win.scores.models)[id][metric]);
        const label = METRICS.find(m => m[0] === metric)[1];
        if (values.some(finite)) output.append(bars(values, label));
        output.append(table(['System', label], IDS.map((id, i) => [run.labels[i], fmt(values[i])])));
        let note = ['crps', 'mae', 'rmse', 'brier'].includes(metric) ? 'Lower values indicate better scores.' : metric === 'bias' ? 'Bias is forecast mean minus MRMS; values closer to zero indicate less mean bias.' : 'Higher values indicate better scores.';
        if (metric === 'crpss' || metric === 'bss_raw') note += ' Zero equals raw HRRR; positive skill improves on that reference.';
        if (metric === 'bss_monthly') note += ' Zero equals monthly MRMS climatology; positive skill improves on that reference. ' + (threshold.climatology_note || '');
        if (metric === 'roc_auc') note += ' AUC is unavailable when observations contain only events or only non-events.';
        if (['crpss', 'bss_raw', 'bss_monthly'].includes(metric)) note += ' Skill is unavailable when the reference score is zero.';
        output.append(node('p', note, 'cnn24-note'));
      } catch (err) { if (thisTicket === ticket) status.textContent = 'CNN viewer: ' + err.message; }
    }
    [init, winSelect, choice, thresholdSelect].filter(Boolean).forEach(el => el.addEventListener('change', display));
    await display();
  }
  document.querySelectorAll('[data-cnn24]').forEach(panel => start(panel).catch(err => {
    panel.querySelector('.cnn24-status').textContent = 'CNN viewer: ' + err.message;
  }));
  setupModelPicker();
})();
