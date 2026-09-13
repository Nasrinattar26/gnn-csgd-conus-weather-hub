/* One figure viewer for the matched 2025 comparison. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const base = new URL('../', location.href);
  const metrics = ['crps','crpss','brier','bss','roc_auc','roc_curve','reliability','ece','usage','reliability_penalty','resolution','crps_reduction','brier_reduction'];
  const durations = [6,12,24], thresholds = [12.7,25.4,50.8];
  const counts = {6:38888560,12:33987536,24:24238760};
  const models = ['raw_hrrr','ann_csgd','gnn_csgd'];
  const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const need = (ok,message) => {if(!ok) throw new Error(message);};
  const equal = (a,b) => JSON.stringify(a)===JSON.stringify(b);
  let catalog, imageVersion=0, csvURL=null;

  function siteURL(path) {
    need(typeof path==='string' && path.length>0,'Missing comparison path.');
    const u = new URL(path,base);
    need(u.origin===base.origin && u.pathname.startsWith(base.pathname) && !u.username && !u.password && !u.hash && !u.search,'Invalid comparison path.');
    return u.href;
  }
  function scope(metric) {
    return metric==='crps_reduction'?'global':['crps','crpss','brier_reduction'].includes(metric)?'duration':'threshold';
  }
  function entryKey(metric,duration,threshold) {return [metric,duration,threshold].join('|');}
  function validate(data) {
    need(data.schema_version===2 && data.evaluation_id==='matched_ann025_conus_2025_figures_v2','Unexpected comparison data version.');
    need(data.verification_year===2025 && data.validation_climatology_year===2024 && data.grid.id==='ann025_conus','Unexpected evaluation scope.');
    need(equal(data.models,models) && equal(data.durations_hours,durations) && equal(data.thresholds_mm,thresholds),'Comparison selections differ.');
    need(Array.isArray(data.metrics) && equal(data.metrics.map(m=>m.id),metrics),'Metric list differs.');
    for(const m of data.metrics)need(m.scope===scope(m.id) && typeof m.label==='string','Invalid metric description.');
    need(Array.isArray(data.entries) && data.entries.length===91,'The comparison catalog is incomplete.');
    const keys = new Set();
    for(const e of data.entries) {
      need(metrics.includes(e.metric) && e.scope===scope(e.metric),'Invalid figure metric.');
      const s=scope(e.metric);
      need(s==='global'?e.duration_hours===null:durations.includes(e.duration_hours),'Invalid figure duration.');
      need(s==='threshold'?thresholds.includes(e.threshold_mm):e.threshold_mm===null,'Invalid figure threshold.');
      need(s==='global'?e.n_samples===null:e.n_samples===counts[e.duration_hours],'Figure sample count differs.');
      if(s==='threshold')need(Number.isSafeInteger(e.n_events) && e.n_events>0 && e.n_events<e.n_samples,'Invalid event count.');
      const key=entryKey(e.metric,e.duration_hours,e.threshold_mm);need(!keys.has(key),'Duplicate comparison figure.');keys.add(key);
      need(e.image.startsWith('assets/comparison/2025/figures_v2/') && e.image.endsWith('.png'),'Unexpected figure location.');siteURL(e.image);
      need(typeof e.sha256==='string' && /^[a-f0-9]{64}$/.test(e.sha256) && e.width===1680 && e.height===1152,'Invalid figure record.');
      need(Array.isArray(e.table_columns) && e.table_columns.length>=2 && e.table_columns.length<=8 && e.table_columns.every(c=>typeof c==='string'),'Invalid value columns.');
      need(Array.isArray(e.table_digits) && e.table_digits.length===e.table_columns.length,'Value formatting differs.');
      need(Array.isArray(e.table_rows) && e.table_rows.length>0,'Missing comparison values.');
      for(const row of e.table_rows)need(Array.isArray(row) && row.length===e.table_columns.length && row.every(v=>v===null || typeof v==='string' || (typeof v==='number' && Number.isFinite(v))),'Invalid comparison value.');
      need(typeof e.caption==='string' && typeof e.note==='string' && typeof e.metric_label==='string','Missing comparison description.');
      if(e.metric==='roc_curve') {
        for(const m of models) {
          const series=e.roc_series[m], points=series.points, pos=e.n_events, neg=e.n_samples-pos;
          need(points.length===(m==='raw_hrrr'?3:11),'ROC point count differs.');
          for(let i=0;i<points.length;i++) {
            const p=points[i];
            need(['tp','fp','fn','tn'].every(k=>Number.isSafeInteger(p[k]) && p[k]>=0),'Invalid ROC contingency count.');
            need(p.tp+p.fn===pos && p.fp+p.tn===neg && Math.abs(p.tpr-p.tp/pos)<1e-12 && Math.abs(p.fpr-p.fp/neg)<1e-12,'ROC rates differ from counts.');
            if(i)need(p.fpr>=points[i-1].fpr && p.tpr>=points[i-1].tpr,'ROC points are not monotone.');
          }
          need(points[0].fpr===0 && points[0].tpr===0 && points.at(-1).fpr===1 && points.at(-1).tpr===1,'ROC endpoints are incomplete.');
        }
      }
    }
    for(const metric of metrics)for(const d of scope(metric)==='global'?[null]:durations)for(const t of scope(metric)==='threshold'?thresholds:[null])need(keys.has(entryKey(metric,d,t)),'A comparison selection is missing.');
    return data;
  }

  function clearFigure() {
    const image=$('comparison-figure');
    image.onload=null;image.onerror=null;image.hidden=true;image.removeAttribute('src');
    for(const id of ['figure-png','figure-csv']){$(id).hidden=true;$(id).removeAttribute('href');}
    if(csvURL){URL.revokeObjectURL(csvURL);csvURL=null;}
  }
  function format(v,digits) {
    if(v===null)return '—';
    return typeof v==='number'?v.toLocaleString('en-US',{minimumFractionDigits:digits??0,maximumFractionDigits:digits??6}):v;
  }
  function csvCell(v) {return '"'+(v===null?'':String(v)).replace(/"/g,'""')+'"';}
  function render() {
    const version=++imageVersion;
    clearFigure();
    const metric=$('figure-metric').value, s=scope(metric);
    const d=s==='global'?null:Number($('evaluation-duration').value);
    const t=s==='threshold'?Number($('evaluation-threshold').value):null;
    const e=catalog.entries.find(e=>entryKey(e.metric,e.duration_hours,e.threshold_mm)===entryKey(metric,d,t));
    need(e,'Selected comparison is unavailable.');
    $('evaluation-duration').disabled=s==='global';
    $('evaluation-threshold').disabled=s!=='threshold';
    $('figure-title').textContent=e.metric_label;
    const period=s==='global'?'All three durations · separate matched samples':`${d}-hour · ${t===null?(metric==='brier_reduction'?'all three precipitation thresholds':'all precipitation amounts'):`precipitation > ${t} mm`}`;
    const sample=s==='global'?'2025 test period':`${e.n_samples.toLocaleString('en-US')} matched cases${s==='threshold'?` · ${e.n_events.toLocaleString('en-US')} events`:''} · 2025`;
    const thresholdHelp=s==='duration'?(metric==='brier_reduction'?'All three thresholds are compared.':'This metric covers all precipitation amounts.'):'';
    $('selection-description').textContent=`${period} · ${sample}${thresholdHelp?' · '+thresholdHelp:''}`;
    $('figure-caption').textContent=e.caption;
    $('figure-note').textContent=e.note;
    $('values-caption').textContent=`${e.caption}${s==='global'?'':` · ${e.n_samples.toLocaleString('en-US')} matched cases`}`;
    $('values-head').innerHTML='<tr>'+e.table_columns.map(c=>`<th scope="col">${esc(c)}</th>`).join('')+'</tr>';
    $('values-body').innerHTML=e.table_rows.map(row=>'<tr>'+row.map((v,i)=>i===0?`<th scope="row">${esc(format(v,e.table_digits[i]))}</th>`:`<td>${esc(format(v,e.table_digits[i]))}</td>`).join('')+'</tr>').join('');
    const csv=[e.table_columns,...e.table_rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
    csvURL=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    $('figure-csv').href=csvURL;$('figure-csv').download=`2025_${d===null?'all-durations':d+'h'}_${metric}${t===null?'':'_gt_'+t+'mm'}.csv`;$('figure-csv').hidden=false;
    const image=$('comparison-figure'), message=$('figure-message'), url=siteURL(e.image);
    message.hidden=false;message.textContent='Loading the figure…';image.alt=e.caption+'. '+e.note;
    image.onload=()=>{if(version!==imageVersion)return;image.hidden=false;message.hidden=true;$('figure-png').href=url;$('figure-png').hidden=false;};
    image.onerror=()=>{if(version!==imageVersion)return;image.hidden=true;message.hidden=false;message.textContent='The selected figure could not be loaded. Its values are available below.';$('figure-png').hidden=true;$('figure-png').removeAttribute('href');};
    image.src=url;
  }
  function moveMetric(delta) {
    const i=metrics.indexOf($('figure-metric').value);
    $('figure-metric').value=metrics[(i+delta+metrics.length)%metrics.length];render();
  }
  async function main() {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch(siteURL('data/verification/2025/comparison_figures_v2.json')+'?v=figures15-1',{cache:'no-store',signal:controller.signal});
      need(response.ok,`Comparison data request failed (HTTP ${response.status}).`);
      catalog=validate(await response.json());render();
      $('figure-metric').disabled=false;
      for(const id of ['figure-metric','evaluation-duration','evaluation-threshold'])$(id).addEventListener('change',render);
      for(const [id,delta] of [['previous-metric',-1],['next-metric',1]]){$(id).disabled=false;$(id).addEventListener('click',()=>moveMetric(delta));}
      $('comparison-data-status').textContent='2025 comparisons available';
    }catch(error){
      ++imageVersion;clearFigure();
      for(const id of ['figure-metric','evaluation-duration','evaluation-threshold','previous-metric','next-metric'])$(id).disabled=true;
      for(const id of ['values-head','values-body'])$(id).replaceChildren();
      $('comparison-data-status').textContent='Comparison data unavailable';
      $('comparison-data-error').hidden=false;$('comparison-data-error').textContent=error.message+' Use the downloads below or try again later.';
      $('figure-message').hidden=false;$('figure-message').textContent='The comparison data could not be loaded.';
      console.error(error);
    }finally{clearTimeout(timer);}
  }
  main();
})();
