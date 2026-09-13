/* HRRR GNN-CSGD forecast dashboard. */
'use strict';
(() => {
  const base = new URL(document.body.dataset.siteRoot || './', location.href);
  const $ = id => document.getElementById(id);
  const durations = [6, 12, 24];
  const products = [
    {id:'expected_precip_mm', label:()=>'Expected precipitation', units:'mm', durations:[6,12,24]},
    {id:'prob_gt_6p35_mm', label:()=>'P(precipitation > 6.35 mm / 0.25 inch)', units:'percent', durations:[6]},
    {id:'prob_gt_12p7_mm', label:()=>'P(precipitation > 12.7 mm / 0.5 inch)', units:'percent', durations:[6,12,24]},
    {id:'prob_gt_25p4_mm', label:()=>'P(precipitation > 25.4 mm / 1 inch)', units:'percent', durations:[6,12,24]},
    {id:'prob_gt_50p8_mm', label:()=>'P(precipitation > 50.8 mm / 2 inches)', units:'percent', durations:[6,12,24]},
    {id:'prob_gt_76p2_mm', label:()=>'P(precipitation > 76.2 mm / 3 inches)', units:'percent', durations:[12,24]},
    {id:'prob_gt_127_mm', label:()=>'P(precipitation > 127 mm / 5 inches)', units:'percent', durations:[24]},
    {id:'prob_gt_2yr_ari', label:d=>`P(precipitation > local 2-year ${d}-h ARI)`, units:'percent', durations:[6,12,24]},
    {id:'prob_gt_5yr_ari', label:d=>`P(precipitation > local 5-year ${d}-h ARI)`, units:'percent', durations:[6,12,24]}
  ];
  let runs = [], comparisons = [], forecastError = null, comparisonError = null;
  let mapVersion = 0, comparisonVersion = 0, animationVersion = 0;
  const text = (id, value) => { if ($(id)) $(id).textContent = value; };
  const need = (condition, message) => { if (!condition) throw new Error(message); };
  function siteURL(path) {
    need(typeof path === 'string' && path.length > 0, 'A product path is missing.');
    const url = new URL(path, base);
    need(url.origin === base.origin && url.pathname.startsWith(base.pathname) &&
      !url.username && !url.password && !url.hash, 'Product paths must stay inside the GNN website.');
    return url.href;
  }
  function utc(value) { return new Date(value).toISOString().slice(0,16).replace('T',' ') + ' UTC'; }
  function dateMS(value) {
    need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value), 'Initialization must be an ISO UTC time.');
    const ms = Date.parse(value);
    need(Number.isFinite(ms) && new Date(ms).toISOString() === value.replace('Z','.000Z'), 'Invalid initialization date.');
    return ms;
  }
  async function readCatalog(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(new URL(path, base), {cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error(`Catalog request failed (HTTP ${response.status}).`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  function validateRuns(catalog) {
    need(catalog.schema_version === 1 && catalog.model_id === 'hrrr_gnn_csgd', 'Wrong forecast catalog version or model.');
    need(catalog.domain === 'CONUS' && catalog.grid_id === 'ann025_conus' && catalog.grid_resolution_degrees === 0.25, 'Unexpected forecast grid or domain.');
    need(Array.isArray(catalog.runs), 'The run list must be an array.');
    const initSeen = new Set();
    for (const run of catalog.runs) {
      dateMS(run.init_utc);
      need(!initSeen.has(run.init_utc), 'Duplicate initialization in catalog.'); initSeen.add(run.init_utc);
      need(Array.isArray(run.entries), 'Run entries must be an array.');
      const seen = new Set();
      for (const e of run.entries) {
        const d = e.duration_hours, a = e.lead_start_hours, b = e.lead_end_hours;
        need(durations.includes(d) && Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b <= 48 && b-a === d && a%6 === 0, 'Invalid forecast accumulation window.');
        need(e.domain === 'CONUS' && e.grid_id === 'ann025_conus', 'An entry has the wrong grid/domain.');
        const product = products.find(p => p.id === e.product);
        need(product && product.durations.includes(d) && product.units === e.units, 'Unexpected product, duration or units.');
        const key = [d,a,b,e.product].join('|');
        need(!seen.has(key), 'Duplicate forecast entry.'); seen.add(key);
        siteURL(e.image);
        if (e.animation != null) siteURL(e.animation);
        need(e.downloads == null || Array.isArray(e.downloads), 'Downloads must be an array.');
        for (const link of e.downloads || []) {
          need(typeof link.label === 'string' && link.label.trim(), 'A download needs a label.'); siteURL(link.href);
        }
      }
    }
    return catalog.runs.filter(r => r.entries.length).sort((a,b) => b.init_utc.localeCompare(a.init_utc));
  }
  function replaceOptions(id, values, wanted) {
    const select = $(id); select.replaceChildren();
    for (const [value,label] of values) select.add(new Option(label,String(value)));
    const found = values.some(([value]) => String(value) === String(wanted));
    if (found) select.value = String(wanted);
  }
  function selectedRun() { return runs.find(r => r.init_utc === $('map-init').value); }
  function windowOptions() {
    const d = Number($('map-duration').value), run = selectedRun();
    const pairs = new Map();
    for (const e of run?.entries || []) if (e.duration_hours === d) pairs.set(`${e.lead_start_hours}:${e.lead_end_hours}`,[e.lead_start_hours,e.lead_end_hours]);
    const planned = pairs.size === 0;
    if (planned) for (let a=0; a+d<=48; a+=6) pairs.set(`${a}:${a+d}`,[a,a+d]);
    const options = [...pairs].sort((a,b) => a[1][0]-b[1][0]).map(([key,[a,b]]) => [key,`${planned ? 'Unavailable · ' : ''}f${String(a).padStart(2,'0')}–f${String(b).padStart(2,'0')}`]);
    const old = $('map-window').value; replaceOptions('map-window',options,old);
    const product = $('map-product').value;
    replaceOptions('map-product',products.filter(p=>p.durations.includes(d)).map(p=>[p.id,p.label(d)]),product);
    text('schedule-note',planned ? `${d}-hour schedule: ${options.length} windows through forecast hour 48. Select an available initialization to view forecasts.` : `${d}-hour accumulations across ${options.length} published windows. All valid times are UTC.`);
    renderForecast();
  }
  function clearMedia(imgId, linkId) {
    const img = $(imgId); if (img) { img.hidden = true; img.onload = null; img.onerror = null; img.removeAttribute('src'); }
    const link = $(linkId); if (link) { link.hidden = true; link.removeAttribute('href'); }
  }
  function showMapMessage(title, detail) {
    $('map-empty').hidden = false; text('map-empty-title',title); text('map-empty-text',detail);
  }
  // downloads35-1: presentation only; all catalog URLs are retained.
  function renderDownloads(files) {
    const primary = $('download-links');
    if (!primary) return;
    let details = $('download-details');
    // Remain compatible with an older cached homepage.
    if (!details) {
      details = document.createElement('details');
      details.id = 'download-details';
      details.className = 'download-details';
      const summary = document.createElement('summary');
      summary.textContent = 'Technical details';
      const extra = document.createElement('div');
      extra.id = 'technical-download-links';
      extra.className = 'download-technical-links';
      details.append(summary, extra);
      ( $('grib2-core-scope') || primary ).after(details);
    }
    const technical = $('technical-download-links');
    primary.replaceChildren();
    technical.replaceChildren();
    details.open = false;
    details.hidden = true;
    const items = files.map(file => {
      const href = siteURL(file.href);
      const path = new URL(href).pathname.toLowerCase();
      const kind = path.endsWith('.png') ? 0 : path.endsWith('.gif') ? 1 :
        path.endsWith('.grib2') ? 2 : path.endsWith('.tar.gz') ? 3 : 4;
      return {file, href, kind};
    }).sort((a,b) => a.kind - b.kind);
    const labels = ['Map (PNG)', 'Animation (GIF)', 'Window data (GRIB2)', 'All windows (.tar.gz)'];
    for (const {file, href, kind} of items) {
      const link = document.createElement('a');
      link.textContent = kind < 4 ? labels[kind] : file.label;
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener';
      if (kind < 4) {
        link.className = 'button';
        if (kind >= 2) link.title = 'Expected precipitation and fixed-threshold probabilities only; ARI excluded.';
        primary.append(link);
      } else {
        technical.append(link);
      }
    }
    details.hidden = technical.children.length === 0;
    $('downloads-empty').hidden = items.length > 0;
  }
  function renderForecast() {
    const version = ++mapVersion; const av = ++animationVersion;
    clearMedia('forecast-map','open-map'); clearMedia('forecast-animation');
    renderDownloads([]);
    $('animation-empty').hidden = false;
    text('animation-empty','No matching animation has been published.');
    const d = Number($('map-duration').value);
    const [a,b] = $('map-window').value.split(':').map(Number);
    const product = products.find(p => p.id === $('map-product').value);
    const run = selectedRun();
    text('map-summary',`${d}-hour accumulation · forecast hours ${a}–${b}`);
    text('map-caption',`${product.label(d)} · ${product.units === 'mm' ? 'millimeters' : 'probability (%)'}`);
    text('map-validity',run ? `${utc(dateMS(run.init_utc)+a*3600000)} to ${utc(dateMS(run.init_utc)+b*3600000)}` : 'Select an available initialization to view its valid period.');
    $('previous-window').disabled = $('map-window').selectedIndex <= 0;
    $('next-window').disabled = $('map-window').selectedIndex >= $('map-window').options.length-1;
    if (forecastError) {
      text('map-status','Forecasts unavailable'); showMapMessage('Forecast information could not be loaded','Refresh the page or try again later.'); return;
    }
    const e = run?.entries.find(e=>e.duration_hours===d && e.lead_start_hours===a && e.lead_end_hours===b && e.product===product.id);
    if (!e) {
      text('map-status',run ? 'Product unavailable' : 'No forecasts available');
      showMapMessage(run ? 'This product is unavailable for the selected window' : 'No GNN forecast cycle is available', 'Choose another published initialization, window, or product, or check again later.'); return;
    }
    const image = $('forecast-map'); const src = siteURL(e.image);
    text('map-status','Loading map'); showMapMessage('Loading published forecast…','Checking the selected map file.');
    image.alt = `${product.label(d)}; HRRR GNN-CSGD; ${d}-hour accumulation; initialized ${utc(run.init_utc)}; forecast hours ${a}–${b}; CONUS 0.25-degree grid.`;
    image.onload = () => { if (version !== mapVersion) return; $('map-empty').hidden=true; image.hidden=false; $('open-map').href=src; $('open-map').hidden=false; text('map-status','Published map'); };
    image.onerror = () => { if (version !== mapVersion) return; clearMedia('forecast-map','open-map'); text('map-status','Map file unavailable'); showMapMessage('The selected map could not be loaded','Try another window or refresh the page.'); };
    image.src = src;
    renderDownloads(e.downloads || []);
    if (e.animation) {
      text('animation-empty','Loading published animation…');
      const image=$('forecast-animation'); image.alt=`${product.label(d)}; ${d}-hour HRRR GNN-CSGD animation; initialized ${utc(run.init_utc)}.`;
      image.onload=()=>{if(av===animationVersion){image.hidden=false;$('animation-empty').hidden=true;}};
      image.onerror=()=>{if(av===animationVersion){clearMedia('forecast-animation');text('animation-empty','The animation file could not be loaded.');}};
      image.src=siteURL(e.animation);
    }
  }
  function validateComparisons(catalog) {
    need(catalog.schema_version===1 && Array.isArray(catalog.entries) && Array.isArray(catalog.grids), 'Invalid comparison catalog.');
    const ids=catalog.grids.map(g=>g.id);
    need(ids.length>0 && new Set(ids).size===ids.length && catalog.grids.every(g=>typeof g.id==='string' && typeof g.label==='string'), 'Invalid comparison grids.');
    const seen=new Set();
    for(const e of catalog.entries){
      need(durations.includes(e.duration_hours) && ids.includes(e.grid_id) && e.domain==='CONUS', 'Invalid comparison duration/grid/domain.');
      need(['bss','crps','roc_auc','reliability'].includes(e.metric), 'Unknown comparison metric.');
      need(e.metric==='crps' ? e.threshold_mm===null : [12.7,25.4,50.8].includes(e.threshold_mm),'Invalid comparison threshold.');
      need(['sample_id','period_label','caption'].every(k=>typeof e[k]==='string' && e[k].trim()),'Comparison sample, period, or caption is missing.');
      need(Array.isArray(e.models) && e.models.length===3 && ['raw_hrrr','ann_csgd','gnn_csgd'].every(m=>e.models.includes(m)), 'A comparison must include all three systems.');
      if(e.metric==='bss') need(typeof e.reference==='string' && e.reference.trim(),'BSS reference is missing.');
      siteURL(e.image);
      const key=[e.duration_hours,e.grid_id,e.metric,e.threshold_mm].join('|');
      need(!seen.has(key),'Multiple comparison figures for the same selection.');seen.add(key);
    }
    return catalog;
  }
  function renderComparison(){
    const v=++comparisonVersion; clearMedia('comparison-image','open-comparison');
    const d=Number($('cmp-duration').value),metric=$('cmp-metric').value;
    $('cmp-threshold').disabled=metric==='crps';
    const threshold=metric==='crps'?null:Number($('cmp-threshold').value);
    const e=comparisons.find(e=>e.duration_hours===d && e.grid_id===$('cmp-grid').value && e.metric===metric && e.threshold_mm===threshold);
    $('comparison-empty').hidden=false;
    text('comparison-empty-title',comparisonError?'Comparison catalog could not be loaded':'Matched verification results are not published for this selection');
    text('comparison-empty-text',comparisonError || 'Choose another duration, metric, or precipitation threshold.');
    text('comparison-status',comparisonError?'Catalog error':e?'Loading figure':'Results pending');
    text('comparison-caption',`${d}-hour accumulation · CONUS · ${$('cmp-grid').selectedOptions[0].textContent} · ${$('cmp-metric').selectedOptions[0].textContent}${threshold===null?'':` · > ${threshold} mm`}`);
    if(!e||comparisonError)return;
    text('comparison-empty-title','Loading comparison figure…');text('comparison-empty-text','Checking the published figure.');
    const image=$('comparison-image'),src=siteURL(e.image); image.alt=e.caption;
    image.onload=()=>{if(v!==comparisonVersion)return;$('comparison-empty').hidden=true;image.hidden=false;$('open-comparison').href=src;$('open-comparison').hidden=false;text('comparison-status','Published comparison');text('comparison-caption',`${e.caption} | ${e.period_label} | Sample: ${e.sample_id}${e.reference?` | Reference: ${e.reference}`:''}`);};
    image.onerror=()=>{if(v!==comparisonVersion)return;clearMedia('comparison-image','open-comparison');text('comparison-status','Figure unavailable');text('comparison-empty-title','The comparison image could not be loaded');text('comparison-empty-text','Try another selection or refresh the page.');};
    image.src=src;
  }
  async function main(){
    if($('map-duration')){
      windowOptions();
      $('map-duration').addEventListener('change',windowOptions);
      $('map-init').addEventListener('change',windowOptions);
      ['map-window','map-product'].forEach(id=>$(id).addEventListener('change',renderForecast));
      [['previous-window',-1],['next-window',1]].forEach(([id,delta])=>$(id).addEventListener('click',()=>{
        const select=$('map-window');select.selectedIndex=Math.max(0,Math.min(select.options.length-1,select.selectedIndex+delta));renderForecast();
      }));
    }
    try{
      runs=validateRuns(await readCatalog('data/run_catalog.json'));
      text('status-badge',runs.length?'Published GNN forecasts':'No forecasts available');
      text('latest-init',runs.length?utc(runs[0].init_utc):'No published initialization');
      text('run-note',runs.length?`${runs.length} published ${runs.length===1?'cycle':'cycles'} available. Select an initialization to explore maps, animations, and downloads.`:'Forecast cycles will appear here when their products are published.');
      text('publication-summary',runs.length?`Latest available cycle: ${utc(runs[0].init_utc)}.`:'No complete GNN forecast cycle is currently available.');
    }catch(error){forecastError=error.message;text('status-badge','Forecasts unavailable');$('status-badge').classList.add('error');text('run-note','Forecast information could not be loaded. Please refresh the page.');text('publication-summary','Forecast availability could not be checked. Please try again later.');console.error(error);}
    if($('map-init')){
      replaceOptions('map-init',runs.length?runs.map(r=>[r.init_utc,utc(r.init_utc)]):[['','No published initializations']]);
      $('map-init').disabled=!runs.length;windowOptions();
    }
    if($('cmp-duration')){
      ['cmp-duration','cmp-grid','cmp-metric','cmp-threshold'].forEach(id=>$(id).addEventListener('change',renderComparison));
      try{const c=validateComparisons(await readCatalog('data/comparison_catalog.json'));comparisons=c.entries;replaceOptions('cmp-grid',c.grids.map(g=>[g.id,g.label]),'ann025_conus');}
      catch(error){comparisonError=error.message;}
      renderComparison();
    }
  }
  main().catch(error=>{text('status-badge','Dashboard initialization failed');console.error(error);});
})();
