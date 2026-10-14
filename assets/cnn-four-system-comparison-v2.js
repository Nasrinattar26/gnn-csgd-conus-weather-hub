/* Four-system metrics v2: same figure format as the dated three-system viewer. */
(() => {
  'use strict';
  const MODEL = 'cnn_csgd_24h_corrected_v1';
  const VERSION = 'cnn24h_operational_comparison_v1';
  const IDS = ['raw_hrrr', 'ann_operational', 'gnn_operational', MODEL];
  const SHORT = ['Raw HRRR', 'ANN-CSGD', 'GNN-CSGD', 'CNN-CSGD'];
  const COLORS = ['#2f6db5', '#c4433b', '#208b5d', '#8b5cc7'];
  const PRODUCTS = [['expected_precip_mm', 'Expected rainfall'], ['prob_gt_0p5inch_percent', 'Probability > 0.5 inch'],
    ['prob_gt_1inch_percent', 'Probability > 1 inch'], ['prob_gt_2inch_percent', 'Probability > 2 inches'],
    ['prob_gt_3inch_percent', 'Probability > 3 inches'], ['prob_gt_5inch_percent', 'Probability > 5 inches']];
  const METRICS = [['crps','CRPS'],['crpss','CRPSS'],['brier','Brier score'],['bss','Brier Skill Score'],
    ['roc_auc','ROC AUC'],['roc_curve','ROC curves'],['reliability','Reliability'],['ece','Expected calibration error'],
    ['usage','Probability-bin usage'],['reliability_penalty','Reliability penalty'],['resolution','Resolution'],
    ['crps_reduction','CRPS reduction: GNN vs ANN'],['brier_reduction','Brier-score reduction: GNN vs ANN'],
    ['mae','MAE'],['rmse','RMSE'],['bias','Mean bias'],['bss_raw','Brier Skill Score versus raw HRRR'],
    ['cnn_crps_reduction','CRPS reduction: CNN vs ANN'],['cnn_brier_reduction','Brier-score reduction: CNN vs ANN']];
  const LIMITS = [['0p5inch', '12.7 mm / 0.5 inch'], ['1inch', '25.4 mm / 1 inch'], ['2inch', '50.8 mm / 2 inches'], ['3inch', '76.2 mm / 3 inches'], ['5inch', '127 mm / 5 inches']];
  const cache = new Map();
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
  const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const digits = (value,d=4) => finite(value) ? value.toLocaleString('en-US',{maximumFractionDigits:d}) : '—';
  const thresholdMetric = metric => !['crps','crpss','mae','rmse','bias','crps_reduction','cnn_crps_reduction','brier_reduction','cnn_brier_reduction'].includes(metric);
  const reduction = (value,reference) => finite(value) && finite(reference) && reference>0 ? 100*(1-value/reference) : null;
  function svgText(x,y,text,opts=''){return `<text x="${x}" y="${y}" ${opts}>${esc(text)}</text>`;}
  function plot(title,subtitle,yLabel,series,kind,xLabels,run) {
    const W=1680,H=1152,L=190,R=1520,T=205,B=900;
    const all=series.flatMap(s=>s.points.map(p=>p[1])).filter(finite);
    if(!all.length)return null;
    let min=kind==='curve'?0:Math.min(0,...all),max=kind==='curve'?1:Math.max(0,...all);
    if(max===min)max=min+1;
    if(kind!=='curve'){const pad=(max-min)*.16;max+=pad;if(min<0)min-=pad;}
    const X=x=>L+x*(R-L),Y=y=>B-(y-min)/(max-min)*(B-T);
    let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title+'. '+subtitle)}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial,DejaVu Sans,sans-serif" fill="#142b42" font-size="28">`;
    s+=svgText(90,70,title,'font-size="44" font-weight="700"')+svgText(90,124,subtitle,'font-size="27" fill="#536c81"');
    for(let i=0;i<=5;i++){const value=min+(max-min)*i/5,y=Y(value);s+=`<path d="M${L},${y} H${R}" stroke="#e5eaf0"/>`+svgText(L-25,y+9,digits(value,kind==='curve'?1:3),'text-anchor="end"');}
    s+=`<path d="M${L},${T} V${B} H${R}" fill="none" stroke="#40566a" stroke-width="2"/>`;
    s+=`<text x="65" y="560" transform="rotate(-90 65 560)" text-anchor="middle">${esc(yLabel)}</text>`;
    if(kind==='curve'){
      for(let i=0;i<=5;i++)s+=svgText(X(i/5),B+47,digits(i/5,1),'text-anchor="middle"');
      s+=`<path d="M${X(0)},${Y(0)} L${X(1)},${Y(1)}" stroke="#7c858e" stroke-width="2" stroke-dasharray="10 10" fill="none"/>`;
      for(const a of series){
        let open=false,path='';for(const p of a.points){if(!finite(p[1])||!finite(p[0])){open=false;continue;}path+=(open?' L':' M')+X(p[0])+','+Y(p[1]);open=true;}
        s+=`<path d="${path}" fill="none" stroke="${a.color}" stroke-width="4"/>`;
        if(a.points.length<=10)for(const p of a.points)if(finite(p[0])&&finite(p[1]))s+=`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="7" fill="${a.color}"><title>${esc(a.name+': '+digits(p[0])+', '+digits(p[1]))}</title></circle>`;
      }
      s+=svgText((L+R)/2,B+100,xLabels[0],'text-anchor="middle"');
    }else{
      const groups=xLabels.length,n=kind==='modelbar'?1:series.length,step=(R-L)/groups,width=Math.min(210,step*.7/n),baseY=Y(0);
      xLabels.forEach((label,i)=>{
        const center=L+(i+.5)*step;s+=svgText(center,B+50,label,'text-anchor="middle" font-size="28"');
        series.forEach((a,j)=>{if(kind==='modelbar'&&j!==i)return;const value=a.points[i]?.[1],x=kind==='modelbar'?center-width/2:center+(j-n/2)*width;
          if(!finite(value)){s+=svgText(x+width/2,baseY-16,'—','text-anchor="middle"');return;}
          const y=Y(value),h=Math.abs(baseY-y);s+=`<rect x="${x}" y="${Math.min(y,baseY)}" width="${width*.91}" height="${Math.max(.5,h)}" fill="${a.color}"><title>${esc(a.name+': '+digits(value,6))}</title></rect>`;
          if(groups<=4)s+=svgText(x+width*.455,value>=0?y-18:y+34,digits(value,4),'text-anchor="middle" font-size="28"');
        });
      });
      if(min<0)s+=`<path d="M${L},${Y(0)} H${R}" stroke="#687786" stroke-width="2"/>`;
    }
    if(series.length>1)series.forEach((a,i)=>{const x=190+i*330;s+=`<rect x="${x}" y="1050" width="38" height="12" fill="${a.color}"/>`+svgText(x+53,1066,a.name,'font-size="22"');});
    s+=svgText(90,1120,'HRRR Neural Weather Hub · Matched MRMS verification · '+initializationLabel(run.initialization),'font-size="21" fill="#536c81"');
    return s+'</g></svg>';
  }
  function validateROC(roc,threshold,expected) {
    const pos=threshold.n_events,neg=threshold.n_samples-pos;
    require(roc && Array.isArray(roc.points), 'ROC coordinates are missing.');
    if(!pos||!neg){require(roc.auc===null&&roc.points.length===0,'Undefined ROC contains points.');return;}
    require(roc.points.length>=2 && roc.points[0][0]===0 && roc.points[0][1]===0 && roc.points.at(-1)[0]===1 && roc.points.at(-1)[1]===1,'ROC endpoints differ.');
    let area=0;
    roc.points.forEach((p,i)=>{
      require(p.length===5 && Number.isSafeInteger(p[2]) && Number.isSafeInteger(p[3]) && p[2]>=0 && p[2]<=pos && p[3]>=0 && p[3]<=neg,'ROC counts differ.');
      require(finite(p[0])&&finite(p[1])&&Math.abs(p[0]-p[3]/neg)<1e-12&&Math.abs(p[1]-p[2]/pos)<1e-12,'ROC rates differ from counts.');
      require(p[4]===null||(finite(p[4])&&p[4]>=0&&p[4]<=1),'Invalid ROC cutoff.');
      if(i){const previous=roc.points[i-1];require(p[0]>=previous[0]&&p[1]>=previous[1],'ROC points are not monotone.');area+=(p[0]-previous[0])*(p[1]+previous[1])/2;}
    });
    require(finite(roc.auc)&&finite(expected)&&Math.abs(area-roc.auc)<1e-10&&Math.abs(roc.auc-expected)<1e-10,'ROC curve and published AUC differ.');
  }
  function supplementalWindow(data,run,win) {
    require(data.schema_version===1 && data.version==='cnn24h_full_metrics_v2' && data.initialization===run.initialization && data.model_id===MODEL && JSON.stringify(data.models)===JSON.stringify(IDS),'ROC supplement identity differs.');
    const saved=data.windows.find(item=>item.id===win.id);
    require(saved && saved.status==='VERIFIED','Exact ROC data for this window are awaiting verification.');
    require(JSON.stringify(saved.source_forecasts)===JSON.stringify(win.source_forecasts),'ROC forecast provenance differs.');
    require(saved.mask_sha256===win.scores.mask_sha256,'ROC observation mask differs.');
    require(JSON.stringify(saved.observation_provenance)===JSON.stringify(win.observation_provenance),'ROC observation provenance differs.');
    for(const t of win.scores.thresholds){
      const extra=saved.thresholds.find(item=>item.label===t.label);
      require(extra && extra.status===t.status && extra.n_samples===t.n_samples && extra.n_events===t.n_events && extra.mask_sha256===t.mask_sha256,'ROC threshold population differs.');
      if(t.status==='VERIFIED')IDS.forEach(id=>validateROC(extra.models[id].roc,t,t.models[id].roc_auc));
    }
    return saved;
  }
  function dailyFigure(run,win,metric,threshold,extra) {
    const scores=win.scores,label=METRICS.find(item=>item[0]===metric)[1];
    let columns=['Model',label],rows=[],series=[],kind='modelbar',xLabels=SHORT,yLabel=label;
    let note='All four models use the same observed grid cells and forecast window.';
    if(metric==='roc_curve'){
      kind='curve';xLabels=['False-positive rate'];yLabel='True-positive rate';
      columns=['Model','Probability cutoff','False-positive rate','True-positive rate','Hits','False alarms'];
      const t=extra.thresholds.find(item=>item.label===threshold.label);
      series=IDS.map((id,i)=>({name:SHORT[i]+` (AUC ${digits(threshold.models[id].roc_auc,3)})`,color:COLORS[i],points:t.models[id].roc.points.map(p=>[p[0],p[1]])}));
      IDS.forEach((id,i)=>t.models[id].roc.points.forEach(p=>rows.push([SHORT[i],p[4],p[0],p[1],p[2],p[3]])));
      note='ROC and AUC use all probabilities from the saved forecasts, with ties grouped together. Only collinear vertices are removed, preserving the curve and its area. ROC requires both observed events and non-events.';
    }else if(metric==='reliability'){
      kind='curve';xLabels=['Forecast probability'];yLabel='Observed event frequency';
      columns=['Model','Bin lower','Bin upper','Samples','Events','Mean probability','Observed frequency'];
      series=IDS.map((id,i)=>({name:SHORT[i],color:COLORS[i],points:threshold.models[id].bins.map(b=>[b.mean_probability,b.event_frequency])}));
      IDS.forEach((id,i)=>threshold.models[id].bins.forEach(b=>rows.push([SHORT[i],b.lower,b.upper,b.n,b.events,b.mean_probability,b.event_frequency])));
      note='Ten equal-width probability bins; empty bins have no plotted point. The diagonal indicates perfect reliability. Lines break at empty bins.';
    }else if(metric==='usage'){
      kind='bar';xLabels=Array.from({length:10},(_,i)=>`${i*10}–${(i+1)*10}`);yLabel='Forecasts in probability bin (%)';
      columns=['Model','Bin lower','Bin upper','Samples','Share (%)'];
      series=IDS.map((id,i)=>({name:SHORT[i],color:COLORS[i],points:threshold.models[id].bins.map((b,j)=>[j,100*b.n/threshold.n_samples])}));
      IDS.forEach((id,i)=>threshold.models[id].bins.forEach(b=>rows.push([SHORT[i],b.lower,b.upper,b.n,100*b.n/threshold.n_samples])));
      note='The horizontal axis gives forecast-probability ranges in percent. Every matched case contributes to one bin.';
    }else if(['crps_reduction','brier_reduction','cnn_crps_reduction','cnn_brier_reduction'].includes(metric)){
      const isCNN=metric.startsWith('cnn_'),isCRPS=metric.includes('crps'),id=isCNN?MODEL:'gnn_operational',name=isCNN?'CNN':'GNN';
      const values=isCRPS?[reduction(scores.models[id].crps,scores.models.ann_operational.crps)]:scores.thresholds.map(t=>t.status==='VERIFIED'?reduction(t.models[id].brier,t.models.ann_operational.brier):null);
      kind='bar';xLabels=isCRPS?['24-hour']:LIMITS.map(item=>item[1].split(' / ')[0]);yLabel='Score reduction vs ANN-CSGD (%)';
      columns=['Selection',name+' reduction vs ANN (%)'];rows=xLabels.map((text,i)=>[text,values[i]]);
      series=[{name:name+' vs ANN',color:COLORS[isCNN?3:2],points:values.map((value,i)=>[i,value])}];
      note='Positive values favor '+name+'-CSGD relative to ANN-CSGD. Reduction = 100 × (1 − score / ANN score). These are matched-sample point estimates without confidence intervals. A zero ANN score makes the reduction undefined.';
    }else{
      const key=metric==='bss'?'bss_monthly':metric;
      const from=thresholdMetric(metric)?threshold.models:scores.models;
      const values=IDS.map(id=>from[id][key]);rows=IDS.map((id,i)=>[SHORT[i],values[i]]);
      series=IDS.map((id,i)=>({name:SHORT[i],color:COLORS[i],points:IDS.map((_,j)=>[j,j===i?values[i]:null])}));
      if(['crps','mae','rmse'].includes(metric))yLabel=label+' (mm; lower is better)';
      else if(metric==='bias')yLabel='Mean bias (mm)';
      else if(metric==='crpss')yLabel='CRPSS vs raw HRRR (higher is better)';
      else yLabel=label+(['bss','bss_raw','roc_auc','resolution'].includes(metric)?' (higher is better)':' (lower is better)');
      if(metric==='bss')note='Brier Skill Score uses monthly historical MRMS climatology (2020–2025). Zero equals that reference; positive values improve on it. '+(threshold.climatology_note||'');
      if(metric==='bss_raw'||metric==='crpss')note='Zero equals raw HRRR; positive skill improves on that reference. Skill is undefined when the reference score is zero.';
      if(metric==='ece')note='Expected calibration error = Σ (bin samples / total samples) × |mean forecast probability − observed event frequency|. Ten probability bins; lower values are better.';
      if(metric==='reliability_penalty'||metric==='resolution')note='Binned component divided by observed event uncertainty. Undefined when all observations belong to one event class. These binned diagnostics need not reproduce the unbinned Brier score.';
      if(metric==='roc_auc')note='ROC AUC uses exact forecast probabilities and grouped ties. AUC is undefined without both observed events and non-events.';
      if(metric==='bias')note='Mean bias is forecast distribution mean minus MRMS precipitation; values closer to zero indicate less mean bias.';
    }
    const subtitle=`24-hour · ${win.id.replace('_','–')} · ${thresholdMetric(metric)?'precipitation ≥ '+threshold.threshold_mm+' mm · ':''}${digits(thresholdMetric(metric)?threshold.n_samples:scores.n_samples,0)} matched cells`;
    return {svg:plot(label,subtitle,yLabel,series,kind,xLabels,run),columns,rows,note,subtitle};
  }
  function scoreCSV(run) {
    const rows = [['initialization', 'window', 'valid_end_utc', 'status', 'model', 'threshold_mm', 'metric', 'value', 'n_samples', 'n_events']];
    run.windows.forEach(win => {
      if (win.status !== 'VERIFIED') { rows.push([run.initialization, win.id, win.valid_end_utc, win.status, '', '', '', '', '', '']); return; }
      IDS.forEach(id => {
        ['crps', 'crpss', 'mae', 'rmse', 'bias'].forEach(metric => rows.push([run.initialization, win.id, win.valid_end_utc, win.status, id, '', metric, win.scores.models[id][metric], win.scores.n_samples, '']));
        win.scores.thresholds.forEach(t => {
          if (t.status !== 'VERIFIED') return;
          ['brier', 'bss_raw', 'bss_monthly', 'roc_auc', 'ece', 'reliability_penalty', 'resolution'].forEach(metric => rows.push([run.initialization, win.id, win.valid_end_utc, win.status, id, t.threshold_mm, metric, t.models[id][metric], t.n_samples, t.n_events]));
        });
      });
    });
    return rows.map(row => row.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  }
  function initializationLabel(value) {
    return value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8) + ' ' + value.slice(8, 10) + ':00 UTC';
  }
  const utcLabel = value => String(value).replace('T', ' ').replace(/:00(?:\.000)?Z$/, ' UTC');

  async function start(panel) {
    const root = panel.dataset.cnnRoot;
    require(['./', '../', 'web/'].includes(root), 'Invalid CNN site root.');
    const status = panel.querySelector('.cnn24-status'), controls = panel.querySelector('.cnn24-controls');
    const output = panel.querySelector('.cnn24-output'), downloads = panel.querySelector('.cnn24-downloads');
    const title = panel.querySelector('h2');
    title.id = 'cnn24-viewer-heading'; title.textContent = 'Four-system comparison';
    panel.setAttribute('aria-labelledby', title.id);
    const heading = node('div', undefined, 'section-head');
    const badge = node('span', 'Loading comparisons…', 'badge'); badge.setAttribute('role', 'status');
    heading.append(title, badge); panel.prepend(heading);
    const intro = panel.querySelector('.cnn24-intro');
    intro.className = 'section-intro';
    intro.textContent = 'Choose an evaluation, initialization, forecast window, and metric. All times are UTC.';
    status.className = 'cnn24-status selection-description';
    status.setAttribute('aria-live', 'polite');
    controls.className = 'cnn24-controls cnn24-comparison-controls';
    const evaluationRow = node('div', undefined, 'controls evaluation-controls');
    const datedRow = node('div', undefined, 'controls dated-controls');
    const metricRow = node('div', undefined, 'controls figure-controls');
    controls.replaceChildren(evaluationRow, datedRow, metricRow);
    const evaluation = selector(evaluationRow, 'Evaluation', [['daily', 'Forecast initializations']]);
    evaluation.id = 'cnn24-evaluation';
    const notice = node('p', undefined, 'cnn24-selection-notice note'); notice.hidden = true;
    panel.insertBefore(notice, status);
    const figureHeading = node('div', undefined, 'figure-heading');
    const figureTitle = node('h3', 'Brier Skill Score');
    const navigation = node('div', undefined, 'figure-navigation');
    navigation.setAttribute('aria-label', 'Choose another four-system metric');
    const previous = node('button', '← Previous'), next = node('button', 'Next →');
    [previous, next].forEach(button => { button.type = 'button'; button.disabled = true; });
    navigation.append(previous, next); figureHeading.append(figureTitle, navigation);
    panel.insertBefore(figureHeading, output);
    panel.querySelectorAll('details').forEach(details => details.classList.add('comparison-details'));

    const preview = window.CNN24H_PREVIEW;
    const catalog = preview ? preview.catalog : await readJSON(root + 'data/cnn24h_v1/catalog.json');
    validateCatalog(catalog);
    const init = selector(datedRow, 'Comparison initialization (UTC)', catalog.runs.map(run => [run.initialization,
      initializationLabel(run.initialization) + (Number.isInteger(run.verified_windows) ? ' · ' + run.verified_windows + '/5 verified' : '')]));
    init.id = 'cnn24-initialization';
    const requested = new URLSearchParams(location.search).get('init');
    if (catalog.runs.some(run => run.initialization === requested)) init.value = requested;
    else if (/^\d{8}12$/.test(requested || '')) {
      notice.textContent = 'Four-system results for ' + initializationLabel(requested) + ' are not available yet. Showing ' + initializationLabel(init.value) + '.';
      notice.hidden = false;
    }
    const winSelect = selector(datedRow, 'Forecast window', [0, 6, 12, 18, 24].map(start => [
      'f' + String(start).padStart(2, '0') + '_f' + String(start + 24).padStart(2, '0'),
      'f' + String(start).padStart(2, '0') + '–f' + String(start + 24).padStart(2, '0')]));
    winSelect.id = 'cnn24-window';
    const choice = selector(metricRow, 'Metric', METRICS); choice.id = 'cnn24-metric'; choice.value = 'bss';
    const duration = selector(metricRow, 'Accumulation duration', [['24', '24-hour']]); duration.id = 'cnn24-duration';
    const thresholdSelect = selector(metricRow, 'Precipitation threshold', LIMITS); thresholdSelect.id = 'cnn24-threshold';
    let ticket = 0, urls = [];
    const release = () => { urls.forEach(URL.revokeObjectURL); urls = []; };
    window.addEventListener('pagehide', release);
    function download(text, content, type, filename) {
      const link = node('a', text, 'button');
      link.href = URL.createObjectURL(new Blob([content], {type})); urls.push(link.href);
      link.download = filename; downloads.append(link);
    }
    function valuesTable(headers, rows) {
      const details = node('details', undefined, 'comparison-details');
      const summary = node('summary', 'View values and sample counts');
      const wrapper = table(headers, rows); wrapper.className = 'comparison-table-wrap';
      wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', 'Four-system comparison values');
      details.append(summary, wrapper); output.append(details);
    }
    function figure(result,run,win) {
      const frame = node('figure',undefined,'map-shell comparison-figure cnn24-figure');
      const area = node('div',undefined,'figure-image-area');
      if(result.svg){const plotBox=node('div',undefined,'cnn24-dated-plot');plotBox.innerHTML=result.svg;area.append(plotBox);}
      else area.append(node('p','This metric is undefined for the selected cases. ROC requires both observed events and non-events.','pending-box'));
      const caption=node('figcaption',undefined,'figure-meta');caption.append(node('p',result.subtitle));
      const links=node('div',undefined,'figure-downloads');caption.append(links);frame.append(area,caption);output.append(frame);
      const filename=run.initialization+'_'+win.id+'_'+choice.value+'_'+thresholdSelect.value;
      if(result.svg){
        const png=node('button','Download PNG');png.type='button';links.append(png);
        png.addEventListener('click',()=>{
          const active=ticket,url=URL.createObjectURL(new Blob([result.svg],{type:'image/svg+xml'})),image=new Image();
          image.onload=()=>{
            URL.revokeObjectURL(url);if(active!==ticket)return;
            const canvas=document.createElement('canvas');canvas.width=1680;canvas.height=1152;
            canvas.getContext('2d').drawImage(image,0,0);
            canvas.toBlob(blob=>{if(!blob||active!==ticket)return;const link=node('a');link.href=URL.createObjectURL(blob);urls.push(link.href);link.download=filename+'.png';link.click();},'image/png');
          };
          image.onerror=()=>{URL.revokeObjectURL(url);png.textContent='PNG export unavailable';};image.src=url;
        });
      }
      const cell=value=>'"'+(value==null?'':String(value)).replace(/"/g,'""')+'"';
      const csv=[result.columns,...result.rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
      const values=node('a','Download values (CSV)','button');values.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));urls.push(values.href);values.download=filename+'.csv';links.append(values);
      output.append(node('p',result.note,'note metric-note'));
      valuesTable(result.columns,result.rows.map(row=>row.map(value=>typeof value==='number'?digits(value,6):value==null?'—':value)));
    }
    async function display() {
      const thisTicket=++ticket,metric=choice.value,isThreshold=thresholdMetric(metric);
      status.textContent='Loading the selected comparison…';badge.textContent='Loading comparisons…';
      output.replaceChildren();downloads.replaceChildren();release();
      thresholdSelect.disabled=!isThreshold;
      thresholdSelect.title=isThreshold?'':'This selection does not use an individual precipitation threshold.';
      figureTitle.textContent=METRICS.find(item=>item[0]===metric)[1];
      try {
        const entry=catalog.runs.find(item=>item.initialization===init.value);
        const run=preview?preview.runs[entry.initialization]:await readJSON(root+entry.url,entry.sha256);
        if(thisTicket!==ticket)return;validateRun(run,entry.initialization);
        const verified=run.windows.filter(item=>item.status==='VERIFIED').length;
        badge.textContent=verified+'/'+run.windows.length+' windows verified';
        init.selectedOptions[0].textContent=initializationLabel(run.initialization)+' · '+verified+'/'+run.windows.length+' verified';
        Array.from(winSelect.options).forEach(option=>{const window=run.windows.find(item=>item.id===option.value);option.textContent=window.id.replace('_','–')+' · '+(window.status==='VERIFIED'?'Verified':'Pending');});
        const win=run.windows.find(item=>item.id===winSelect.value);
        status.textContent='Initialized '+initializationLabel(run.initialization)+' · Valid '+utcLabel(win.valid_start_utc)+' → '+utcLabel(win.valid_end_utc);
        download('Selected initialization (JSON)',JSON.stringify(run,null,2),'application/json','cnn24h_'+entry.initialization+'.json');
        download('Download scores (CSV)',scoreCSV(run),'text/csv','four_system_scores_'+entry.initialization+'.csv');
        if(win.status!=='VERIFIED'){output.append(node('p',win.reason||'Verification is awaiting matching MRMS observations.','pending-box'));return;}
        const threshold=win.scores.thresholds.find(item=>item.label===thresholdSelect.value);
        if(isThreshold&&threshold.status!=='VERIFIED'){output.append(node('p','No common observed samples at this threshold.','pending-box'));return;}
        let extra=null;
        if(metric==='roc_curve'){
          try {
            const supplied=preview?.metrics?.[entry.initialization];
            let data=supplied;
            if(!data){
              const index=await readJSON(root+'data/cnn24h_metrics_v2/catalog.json');
              require(index.schema_version===1&&index.version==='cnn24h_full_metrics_v2'&&index.model_id===MODEL&&Array.isArray(index.runs),'Exact ROC catalog identity differs.');
              const record=index.runs.find(item=>item.initialization===entry.initialization);
              require(record&&record.url==='data/cnn24h_metrics_v2/runs/'+entry.initialization+'.json'&&/^[a-f0-9]{64}$/.test(record.sha256),'Exact ROC results are awaiting publication.');
              data=await readJSON(root+record.url,record.sha256);
            }
            if(thisTicket!==ticket)return;extra=supplementalWindow(data,run,win);
          }catch(error){
            if(thisTicket!==ticket)return;
            output.append(node('p','Exact ROC curves are awaiting the matching verification data. '+error.message,'pending-box'));return;
          }
        }
        if(thisTicket!==ticket)return;
        const samples=isThreshold?threshold.n_samples:win.scores.n_samples;
        output.append(node('p','Shared observed land cells: '+samples.toLocaleString('en-US')+(isThreshold?' · Observed exceedances: '+threshold.n_events.toLocaleString('en-US'):''),'cnn24-counts'));
        figure(dailyFigure(run,win,metric,threshold,extra),run,win);
      }catch(error){if(thisTicket===ticket){badge.textContent='Comparison unavailable';status.textContent='Four-system viewer: '+error.message;}}
    }
    [previous,next].forEach((button,index)=>{
      button.disabled=false;
      button.addEventListener('click',()=>{choice.selectedIndex=(choice.selectedIndex+(index?1:-1)+choice.options.length)%choice.options.length;choice.dispatchEvent(new Event('change',{bubbles:true}));});
    });
    init.addEventListener('change',()=>{notice.hidden=true;});
    [init,winSelect,choice,thresholdSelect].forEach(select=>select.addEventListener('change',display));
    await display();
  }
  document.querySelectorAll('[data-cnn24="comparison"]').forEach(panel=>{
    panel.dataset.cnn24Theme='comparison';panel.removeAttribute('data-cnn24');
    start(panel).catch(error=>{panel.querySelector('.cnn24-status').textContent='Four-system viewer: '+error.message;const badge=panel.querySelector('.badge');if(badge)badge.textContent='Comparison unavailable';});
  });
})();
