/* Matched 2025 GNN comparison. Independent of the live-forecast dashboard. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const base = new URL('../', location.href);
  const ids = ['raw_hrrr', 'ann_csgd', 'gnn_csgd'];
  const labels = {raw_hrrr:'Raw HRRR', ann_csgd:'ANN-CSGD', gnn_csgd:'GNN-CSGD'};
  const classes = {raw_hrrr:'raw', ann_csgd:'ann', gnn_csgd:'gnn'};
  const colors = {raw_hrrr:'#1d4ed8', ann_csgd:'#c62828', gnn_csgd:'#17813b'};
  const thresholds = [12.7, 25.4, 50.8];
  const inches = {12.7:'0.5 inch',25.4:'1 inch',50.8:'2 inches'};
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (v, digits=4) => Number.isFinite(v) ? v.toLocaleString('en-US',{minimumFractionDigits:digits, maximumFractionDigits:digits}) : '—';
  const count = n => n.toLocaleString('en-US');
  const need = (ok, message) => {if (!ok) throw new Error(message);};
  const close = (a,b) => Math.abs(a-b) < 1e-8*Math.max(1,Math.abs(a),Math.abs(b));
  const modelLabel = model => `<span class="model-label"><i class="model-dot ${classes[model]}" aria-hidden="true"></i>${labels[model]}</span>`;
  let data;
  let imageVersion = 0;

  function siteURL(path) {
    need(typeof path === 'string' && path.length > 0, 'Missing comparison path.');
    const url = new URL(path, base);
    need(url.origin === base.origin && url.pathname.startsWith(base.pathname) && !url.hash && !url.username && !url.password,
      'Comparison paths must stay inside this website.');
    return url.href;
  }

  function validate(d) {
    need(d.schema_version===1 && d.evaluation_id==='matched_ann025_conus_2025_extended_v1', 'Unexpected evaluation version.');
    need(d.verification_year===2025 && d.validation_climatology_year===2024 && d.grid.id==='ann025_conus' && d.grid.domain==='CONUS' && d.grid.resolution_degrees===0.25, 'Evaluation period or grid differs.');
    need(JSON.stringify(d.models)===JSON.stringify(ids) && JSON.stringify(d.thresholds_mm)===JSON.stringify(thresholds), 'Model or threshold list differs.');
    need(Array.isArray(d.durations) && d.durations.length===3 && new Set(d.durations.map(x=>x.duration_hours)).size===3, 'Missing or duplicate duration.');
    for (const duration of d.durations) {
      need([6,12,24].includes(duration.duration_hours) && Number.isSafeInteger(duration.n_samples) && duration.n_samples>0, 'Invalid duration sample.');
      need(duration.sample_id===`matched_ann025_conus_2025_${duration.duration_hours}h_v1`, 'Unexpected sample identifier.');
      for (const m of ids) {
        const v=duration.models[m];
        need(v && Number.isFinite(v.crps_mm) && v.crps_mm>=0 && Number.isFinite(v.crpss_vs_raw), 'Invalid continuous score.');
        need(close(v.crpss_vs_raw, 1-v.crps_mm/duration.models.raw_hrrr.crps_mm), 'CRPSS reference differs.');
      }
      need(Number.isFinite(duration.gnn_crps_reduction_vs_ann_fraction), 'Invalid CRPS reduction.');
      need(close(duration.gnn_crps_reduction_vs_ann_fraction,1-duration.models.gnn_csgd.crps_mm/duration.models.ann_csgd.crps_mm), 'CRPS reduction differs.');
      need(Array.isArray(duration.thresholds) && duration.thresholds.length===3 && new Set(duration.thresholds.map(x=>x.threshold_mm)).size===3, 'Missing or duplicate threshold.');
      for (const t of duration.thresholds) {
        need(thresholds.includes(t.threshold_mm) && t.n_samples===duration.n_samples && Number.isSafeInteger(t.n_events) && t.n_events>0 && t.n_events<t.n_samples, 'Invalid threshold sample.');
        need(close(t.event_rate,t.n_events/t.n_samples) && t.climatology_brier>0 && close(t.event_uncertainty,t.event_rate*(1-t.event_rate)), 'Invalid event reference.');
        for (const m of ids) {
          const v=t.models[m];
          need(v && ['brier','bss','roc_auc','ece','reliability_normalized','resolution_normalized'].every(k=>Number.isFinite(v[k])), 'Invalid probability score.');
          need(v.brier>=0 && v.brier<=1 && v.roc_auc>=0 && v.roc_auc<=1 && v.ece>=0 && v.ece<=1 && v.reliability_normalized>=0 && v.resolution_normalized>=0, 'Probability score outside bounds.');
          need(close(v.bss,1-v.brier/t.climatology_brier), 'BSS reference differs.');
          need(Array.isArray(v.bins) && v.bins.length===(m==='raw_hrrr'?2:10), 'Invalid probability bins.');
          let n=0, events=0, ece=0, rel=0, res=0;
          for (const b of v.bins) {
            need(Number.isSafeInteger(b.n) && b.n>=0 && Number.isInteger(b.index) && b.index>=0 && b.index<10, 'Invalid bin count or index.');
            need(Number.isFinite(b.lower) && Number.isFinite(b.upper) && b.lower>=0 && b.upper<=1 && b.lower<b.upper, 'Invalid bin interval.');
            n+=b.n;
            if (b.n) {
              need(Number.isFinite(b.p) && Number.isFinite(b.observed) && b.p>=0 && b.p<=1 && b.observed>=0 && b.observed<=1, 'Invalid populated bin.');
              events+=b.n*b.observed; ece+=b.n/t.n_samples*Math.abs(b.p-b.observed);
              rel+=b.n/t.n_samples*(b.p-b.observed)**2; res+=b.n/t.n_samples*(b.observed-t.event_rate)**2;
            } else need(b.p===null && b.observed===null,'Empty bins must not contain estimates.');
          }
          need(new Set(v.bins.map(b=>b.index)).size===v.bins.length && n===t.n_samples && close(events,t.n_events), 'Bin sample differs.');
          need(close(ece,v.ece) && close(rel/t.event_uncertainty,v.reliability_normalized) && close(res/t.event_uncertainty,v.resolution_normalized), 'Calibration diagnostics differ from their bins.');
        }
        need(close(t.gnn_brier_reduction_vs_ann_fraction,1-t.models.gnn_csgd.brier/t.models.ann_csgd.brier), 'Brier reduction differs.');
      }
    }
    need(Array.isArray(d.figure_entries) && d.figure_entries.length===30,'Original figure catalog incomplete.');
    const figures=new Set();
    for (const e of d.figure_entries) {
      need([6,12,24].includes(e.duration_hours) && ['crps','bss','roc_auc','reliability'].includes(e.metric) && e.grid_id==='ann025_conus' && e.domain==='CONUS', 'Invalid figure selection.');
      need(e.sample_id===`matched_ann025_conus_2025_${e.duration_hours}h_v1` && (e.metric==='crps'?e.threshold_mm===null:thresholds.includes(e.threshold_mm)), 'Figure sample differs.');
      const key=[e.duration_hours,e.metric,e.threshold_mm].join('|');
      need(!figures.has(key),'Duplicate figure selection.'); figures.add(key); siteURL(e.image);
    }
    return d;
  }

  function bars(target, rows, title, options={}) {
    const left=134, right=420, height=230;
    let min=options.min??Math.min(0,...rows.map(r=>r.value));
    let max=options.max??Math.max(0,...rows.map(r=>r.value));
    if (min===max) max=min+1;
    if (options.max==null) max+=Math.max(max-min,1e-9)*0.09;
    if (min<0) min-=(max-min)*0.04;
    const tickDigits=Math.max(options.tickDigits??2,Math.max(0,Math.ceil(-Math.log10((max-min)/4))));
    const x=v=>left+(v-min)/(max-min)*(right-left);
    let svg=`<svg viewBox="0 0 520 ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><desc>${esc(rows.map(r=>`${r.label}: ${fmt(r.value,options.digits??4)}${options.suffix||''}`).join('; '))}</desc>`;
    for (let i=0;i<=4;i++) {
      const v=min+(max-min)*i/4;
      svg+=`<line class="grid-line" x1="${x(v)}" x2="${x(v)}" y1="20" y2="185"/><text class="axis-label" x="${x(v)}" y="208" text-anchor="middle">${esc(fmt(v,tickDigits))}</text>`;
    }
    svg+=`<line class="zero-line" x1="${x(0)}" x2="${x(0)}" y1="20" y2="185"/>`;
    if (options.reference!=null) svg+=`<line x1="${x(options.reference)}" x2="${x(options.reference)}" y1="20" y2="185" stroke="#77899b" stroke-dasharray="4 4"/>`;
    rows.forEach((r,i)=>{
      const y=35+i*54, a=x(Math.min(0,r.value)), b=x(Math.max(0,r.value));
      svg+=`<text x="120" y="${y+20}" text-anchor="end">${esc(r.label)}</text><rect x="${a}" y="${y}" width="${Math.max(b-a,0)}" height="30" rx="3" fill="${r.color}"/><text class="value-label" x="512" y="${y+20}" text-anchor="end">${esc(fmt(r.value,options.digits??4)+(options.suffix||''))}</text>`;
    });
    $(target).innerHTML=svg+'</svg>';
  }

  function probabilityPlot(t) {
    const left=57,right=493,top=20,bottom=291;
    const x=v=>left+v*(right-left), y=v=>bottom-v*(bottom-top);
    let svg='<svg viewBox="0 0 520 352" role="img" aria-label="Reliability diagram"><title>Reliability for the selected duration and threshold</title><desc>Populated probability bins, with raw HRRR at zero and one. Exact values and counts appear in the bin table below.</desc>';
    for(let i=0;i<=5;i++) {
      const v=i/5;
      svg+=`<line class="grid-line" x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${bottom}"/><line class="grid-line" x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}"/><text x="${x(v)}" y="313" text-anchor="middle">${i*20}%</text><text x="48" y="${y(v)+4}" text-anchor="end">${i*20}%</text>`;
    }
    svg+=`<line x1="${left}" x2="${right}" y1="${bottom}" y2="${top}" stroke="#667789" stroke-dasharray="6 5"/><text x="275" y="344" text-anchor="middle">Mean forecast probability</text><text transform="translate(13 157) rotate(-90)" text-anchor="middle">Observed frequency</text>`;
    for(const m of ids) {
      const populated=t.models[m].bins.filter(b=>b.n>0);
      if(m!=='raw_hrrr') svg+=`<polyline points="${populated.map(b=>`${x(b.p)},${y(b.observed)}`).join(' ')}" fill="none" stroke="${colors[m]}" stroke-width="2.25"/>`;
      for(const b of populated) {
        const label=`${labels[m]}: forecast ${fmt(100*b.p,2)}%, observed ${fmt(100*b.observed,2)}%; ${count(b.n)} cases`;
        svg+=`<circle class="chart-dot" cx="${x(b.p)}" cy="${y(b.observed)}" r="4" fill="white" stroke="${colors[m]}" stroke-width="2" tabindex="0" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title></circle>`;
      }
    }
    $('reliability-chart').innerHTML=svg+'</svg>';
  }

  function usagePlot(t) {
    const left=72,right=500,top=20,bottom=291;
    const fractions=['ann_csgd','gnn_csgd'].flatMap(m=>t.models[m].bins.filter(b=>b.n).map(b=>b.n/t.n_samples));
    const lo=Math.min(-1,Math.floor(Math.log10(Math.min(...fractions))));
    const y=v=>bottom-(Math.log10(v)-lo)/(0-lo)*(bottom-top);
    const step=(right-left)/10;
    let svg='<svg viewBox="0 0 520 352" role="img" aria-label="Forecast share by probability bin, logarithmic scale"><title>Probability-bin usage</title><desc>ANN is red; GNN is green. Empty bins have no bar. Exact counts appear in the bin table.</desc>';
    for(let p=lo;p<=0;p++) {
      const v=10**p;
      const tick=p < -3 ? `1e${p+2}%` : `${fmt(v*100,Math.max(0,-p-2))}%`;
      svg+=`<line class="grid-line" x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="62" y="${y(v)+4}" text-anchor="end">${esc(tick)}</text>`;
    }
    ['ann_csgd','gnn_csgd'].forEach((m,j)=>{
      for(const b of t.models[m].bins) {
        if(!b.n) continue;
        const topY=y(b.n/t.n_samples), x=left+b.index*step+step*(j?0.52:0.15);
        svg+=`<rect x="${x}" y="${topY}" width="${step*0.31}" height="${bottom-topY}" fill="${colors[m]}"><title>${labels[m]}, ${b.index*10}–${(b.index+1)*10}%: ${count(b.n)} cases (${fmt(100*b.n/t.n_samples,5)}%)</title></rect>`;
      }
    });
    for(let i=0;i<10;i++) svg+=`<text class="axis-label" x="${left+(i+0.5)*step}" y="313" text-anchor="middle">${i*10}–${(i+1)*10}</text>`;
    svg+='<text x="275" y="344" text-anchor="middle">Forecast probability bin (%)</text><text transform="translate(13 157) rotate(-90)" text-anchor="middle">Share of forecasts · log scale</text>';
    $('usage-chart').innerHTML=svg+'</svg>';
  }

  function renderFigure() {
    const version=++imageVersion, img=$('saved-figure'), link=$('saved-figure-link'), message=$('saved-figure-message');
    img.onload=null;img.onerror=null;img.hidden=true;img.removeAttribute('src');link.hidden=true;link.removeAttribute('href');
    const duration=Number($('evaluation-duration').value), metric=$('figure-metric').value;
    const threshold=metric==='crps'?null:Number($('evaluation-threshold').value);
    const entry=data.figure_entries.find(e=>e.duration_hours===duration && e.metric===metric && e.threshold_mm===threshold);
    message.hidden=false; message.textContent=entry?'Loading original figure…':'No original figure is available for this selection.';
    $('saved-figure-caption').textContent='';
    if(!entry)return;
    const source=siteURL(entry.image);
    img.alt=entry.caption;
    img.onload=()=>{if(version!==imageVersion)return; img.hidden=false;message.hidden=true;link.href=source;link.hidden=false;};
    img.onerror=()=>{if(version!==imageVersion)return;img.hidden=true;message.hidden=false;message.textContent='The selected figure could not be loaded. The score tables above remain available.';};
    $('saved-figure-caption').textContent=`${entry.caption} ${entry.period_label}.`;
    img.src=source;
  }

  function render() {
    const duration=data.durations.find(d=>d.duration_hours===Number($('evaluation-duration').value));
    const t=duration.thresholds.find(r=>r.threshold_mm===Number($('evaluation-threshold').value));
    need(duration && t,'Selected evaluation unavailable.');
    $('sample-count').textContent=count(duration.n_samples);
    $('event-count').textContent=`${count(t.n_events)} events · ${fmt(100*t.event_rate,3)}% event rate`;
    $('selection-description').textContent=`${duration.duration_hours}-hour precipitation > ${t.threshold_mm} mm (${inches[t.threshold_mm]}) · matched 2025 test sample · ${duration.sample_id}`;
    const rows=(key,source,multiplier=1)=>ids.map(m=>({label:labels[m],value:source[m][key]*multiplier,color:colors[m]}));
    bars('crps-chart',rows('crps_mm',duration.models),'Mean CRPS (mm)',{digits:4,tickDigits:2});
    bars('crpss-chart',rows('crpss_vs_raw',duration.models,100),'CRPSS relative to raw HRRR (%)',{digits:2,suffix:'%',tickDigits:0});
    bars('brier-chart',rows('brier',t.models),'Brier score',{digits:6,tickDigits:3});
    bars('bss-chart',rows('bss',t.models),'Brier Skill Score',{digits:4,tickDigits:2});
    bars('auc-chart',rows('roc_auc',t.models),'ROC AUC',{min:0,max:1,reference:0.5,digits:4});
    bars('ece-chart',rows('ece',t.models,100),'Expected calibration error (percentage points)',{digits:4,tickDigits:2});
    bars('reliability-penalty-chart',rows('reliability_normalized',t.models),'Normalized binned reliability penalty',{digits:4,tickDigits:3});
    bars('resolution-chart',rows('resolution_normalized',t.models),'Normalized binned resolution',{digits:4,tickDigits:2});
    $('continuous-table').innerHTML=ids.map(m=>`<tr><th scope="row">${modelLabel(m)}</th><td>${fmt(duration.models[m].crps_mm,6)}</td><td>${fmt(duration.models[m].crpss_vs_raw,6)}</td><td>${count(duration.n_samples)}</td></tr>`).join('');
    $('threshold-context').textContent=`2024 climatology: ${fmt(100*t.climatology_2024,3)}%; its Brier score on this 2025 sample: ${fmt(t.climatology_brier,6)}. Positive BSS improves on that reference. AUC uses the published histogram estimate.`;
    probabilityPlot(t); usagePlot(t);
    $('reliability-table').innerHTML=ids.flatMap(m=>t.models[m].bins.map(b=>`<tr><th scope="row">${modelLabel(m)}</th><td>${m==='raw_hrrr'?(b.p===0?'0%':'100%'):`${Math.round(b.lower*100)}–${Math.round(b.upper*100)}%`}</td><td>${count(b.n)}</td><td>${b.n?fmt(100*b.p,4)+'%':'—'}</td><td>${b.n?fmt(100*b.observed,4)+'%':'—'}</td></tr>`)).join('');
    const differenceRows=data.durations.map(d=>({label:`${d.duration_hours}-hour`,value:100*d.gnn_crps_reduction_vs_ann_fraction,color:d.gnn_crps_reduction_vs_ann_fraction>=0?colors.gnn_csgd:colors.ann_csgd}));
    bars('crps-difference-chart',differenceRows,'CRPS reduction relative to ANN (%)',{digits:3,suffix:'%',tickDigits:2});
    bars('brier-difference-chart',duration.thresholds.map(r=>({label:`> ${r.threshold_mm} mm`,value:100*r.gnn_brier_reduction_vs_ann_fraction,color:r.gnn_brier_reduction_vs_ann_fraction>=0?colors.gnn_csgd:colors.ann_csgd})),'Brier score reduction relative to ANN (%)',{digits:3,suffix:'%',tickDigits:2});
    $('difference-description').textContent=`For ${duration.duration_hours}-hour accumulations, the GNN CRPS reduction relative to ANN is ${fmt(100*duration.gnn_crps_reduction_vs_ann_fraction,3)}%. At > ${t.threshold_mm} mm, the Brier-score reduction is ${fmt(100*t.gnn_brier_reduction_vs_ann_fraction,3)}%, and the ROC AUC difference (GNN − ANN) is ${fmt(t.models.gnn_csgd.roc_auc-t.models.ann_csgd.roc_auc,6)}.`;
    $('threshold-table').innerHTML=duration.thresholds.flatMap(r=>ids.map(m=>`<tr${r.threshold_mm===t.threshold_mm?' class="selected-threshold"':''}><th scope="row">> ${r.threshold_mm} mm</th><td>${modelLabel(m)}</td><td>${fmt(r.models[m].brier,6)}</td><td>${fmt(r.models[m].bss,6)}</td><td>${fmt(r.models[m].roc_auc,6)}</td><td>${fmt(100*r.models[m].ece,6)}</td><td>${count(r.n_events)}</td></tr>`)).join('');
    renderFigure();
  }

  async function main() {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch(siteURL('data/verification/2025/comparison_extended_v1.json'),{cache:'no-store',signal:controller.signal});
      need(response.ok,`Comparison data request failed (HTTP ${response.status}).`);
      data=validate(await response.json());
      render();
      for(const id of ['evaluation-duration','evaluation-threshold']) {$(id).disabled=false;$(id).addEventListener('change',render);}
      $('figure-metric').disabled=false;$('figure-metric').addEventListener('change',renderFigure);
      $('comparison-data-status').textContent='2025 scores available';
    } catch(error) {
      $('comparison-data-status').textContent='Comparison data unavailable';
      $('comparison-data-status').classList.add('error');
      $('comparison-data-error').hidden=false;$('comparison-data-error').textContent=`${error.message} Use the source-table downloads or try again later.`;
      $('saved-figure-message').textContent='Comparison data unavailable; no figure is selected.';
      document.querySelectorAll('.chart-host').forEach(el=>el.replaceChildren());
      ['continuous-table','threshold-table','reliability-table'].forEach(id=>$(id).replaceChildren());
      console.error(error);
    } finally {clearTimeout(timer);}
  }
  main();
})();
