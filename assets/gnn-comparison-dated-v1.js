/* dated19-1: one viewer for dated forecasts and the 2025 comparison. */
'use strict';
(() => {
  const $=id=>document.getElementById(id), base=new URL('../',location.href);
  const metrics=['crps','crpss','brier','bss','roc_auc','roc_curve','reliability','ece','usage','reliability_penalty','resolution','crps_reduction','brier_reduction'];
  const models=['raw_hrrr','ann_csgd','gnn_csgd'], labels=['Raw HRRR','ANN-CSGD','GNN-CSGD'];
  const colors=['#2f6db5','#c4433b','#208b5d'], durations=[6,12,24], thresholds=[12.7,25.4,50.8];
  const counts={6:38888560,12:33987536,24:24238760};
  const need=(ok,message)=>{if(!ok)throw new Error(message);};
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(x,d=4)=>x===null?'—':typeof x==='number'?x.toLocaleString('en-US',{maximumFractionDigits:d}):String(x);
  const scope=m=>m==='crps_reduction'?'global':['crps','crpss','brier_reduction'].includes(m)?'duration':'threshold';
  const entryKey=(m,d,t)=>[m,d,t].join('|');
  const isDaily=()=>$('evaluation-scope').value==='daily';
  let benchmark=null,catalog=null,run=null,version=0,plotSVG=null,urls=[],runCache=new Map();
  function siteURL(path){
    need(typeof path==='string' && path.length>0,'Missing comparison path.');
    const u=new URL(path,base);
    need(u.origin===base.origin&&u.pathname.startsWith(base.pathname)&&!u.username&&!u.password&&!u.search&&!u.hash,'Invalid comparison path.');
    return u.href;
  }
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


  function validateCatalog(c){
    need(c.schema_version===1&&c.grid==='ann025_conus'&&c.initialization_hour_utc===12,'Invalid dated catalog.');
    need(c.version==='dated19-correct-censored-crps-1'&&Array.isArray(c.runs),'Unexpected dated score version.');
    const seen=new Set();
    for(const r of c.runs){
      need(/^20\d{6}12$/.test(r.initialization)&&!seen.has(r.initialization),'Invalid or duplicate initialization.');seen.add(r.initialization);
      need(r.url===`data/verification/dated_v1/runs/${r.initialization}.json`&&/^[a-f0-9]{64}$/.test(r.sha256),'Invalid dated file record.');
      siteURL(r.url);need(Number.isInteger(r.verified_windows)&&r.verified_windows>=0&&r.verified_windows<=20&&r.total_windows===20,'Invalid dated window count.');
    }
    return c;
  }
  function validateRun(r,record){
    need(r.schema_version===1&&r.version===catalog.version&&r.initialization===record.initialization,'Requested initialization differs from data.');
    need(equal(r.models,models)&&equal(r.thresholds_mm,thresholds)&&r.windows.length===20,'Dated model/window contract differs.');
    const seen=new Set();let verified=0;
    for(const w of r.windows){
      need(durations.includes(w.duration_hours)&&w.end_hour-w.start_hour===w.duration_hours&&w.start_hour%6===0&&w.start_hour>=0&&w.end_hour<=48,'Invalid forecast window.');
      const key=`${w.duration_hours}h_f${String(w.start_hour).padStart(2,'0')}_f${String(w.end_hour).padStart(2,'0')}`;
      need(w.id===key&&!seen.has(key),'Duplicate forecast window.');seen.add(key);
      const init=Date.parse(r.init_utc);
      need(Number.isFinite(init)&&Date.parse(w.valid_start_utc)===init+w.start_hour*3600000&&Date.parse(w.valid_end_utc)===init+w.end_hour*3600000,'Forecast validity differs.');
      if(w.status!=='VERIFIED'){need(w.scores===null,'Unverified window contains scores.');continue;}
      verified++;const s=w.scores;
      need(Number.isInteger(s.n_samples)&&s.n_samples>0&&s.n_samples<=13318,'Invalid common sample count.');
      for(const model of models)need(Number.isFinite(s.models[model].crps)&&s.models[model].crps>=0,'Invalid CRPS.');
      need(s.thresholds.length===3,'Missing thresholds.');
      for(let j=0;j<3;j++){
        const t=s.thresholds[j];need(t.threshold_mm===thresholds[j]&&Number.isInteger(t.n_samples)&&t.n_samples>0&&t.n_samples<=s.n_samples,'Threshold samples differ.');
        need(Number.isInteger(t.n_events)&&t.n_events>=0&&t.n_events<=t.n_samples,'Invalid event count.');
        for(const model of models){
          const m=t.models[model],pos=t.n_events,neg=t.n_samples-pos;
          need(Number.isFinite(m.brier)&&m.brier>=0&&m.brier<=1,'Invalid Brier score.');
          need(m.roc_auc===null||(Number.isFinite(m.roc_auc)&&m.roc_auc>=0&&m.roc_auc<=1),'Invalid ROC AUC.');
          need(m.bins.length===10&&m.bins.reduce((n,b)=>n+b.n,0)===t.n_samples&&m.bins.reduce((n,b)=>n+b.events,0)===pos,'Reliability counts differ.');
          if(!pos||!neg){need(m.roc_auc===null&&m.roc.points.length===0,'ROC is undefined without both event classes.');continue;}
          const points=m.roc.points;need(points.length>=2&&points[0][0]===0&&points[0][1]===0&&points.at(-1)[0]===1&&points.at(-1)[1]===1,'Missing ROC endpoints.');
          let area=0;
          points.forEach((p,i)=>{
            need(Number.isInteger(p[2])&&Number.isInteger(p[3])&&p[2]>=0&&p[2]<=pos&&p[3]>=0&&p[3]<=neg,'Invalid ROC counts.');
            need(Math.abs(p[0]-p[3]/neg)<1e-12&&Math.abs(p[1]-p[2]/pos)<1e-12,'ROC rates differ from counts.');
            if(i){const prev=points[i-1];need(p[0]>=prev[0]&&p[1]>=prev[1],'Nonmonotone ROC.');area+=(p[0]-prev[0])*(p[1]+prev[1])/2;}
          });
          need(Math.abs(area-m.roc_auc)<1e-10,'ROC curve and AUC disagree.');
        }
      }
    }
    need(verified===r.verified_windows&&verified===record.verified_windows,'Verified-window count differs.');
    return r;
  }
  async function request(path,hash){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(siteURL(path),{cache:'no-store',signal:controller.signal});
      need(response.ok,`Comparison request failed (HTTP ${response.status}).`);
      const content=await response.text();
      if(hash){
        const bytes=new TextEncoder().encode(content),digest=await crypto.subtle.digest('SHA-256',bytes);
        need(Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')===hash,'The dated catalog and results have not deployed together yet. Try again shortly.');
      }
      return JSON.parse(content);
    }finally{clearTimeout(timer);}
  }
  function setOptions(id,items,wanted){
    const el=$(id);el.replaceChildren();
    for(const [value,label] of items){const o=document.createElement('option');o.value=value;o.textContent=label;el.append(o);}
    el.value=items.some(x=>x[0]===wanted)?wanted:(items[0]?.[0]||'');
  }
  function dateLabel(t){return t.replace('T',' ').replace(':00:00Z',':00 UTC');}
  function message(text){$('figure-message').textContent=text;$('figure-message').hidden=false;}
  function clear(){
    ++version;plotSVG=null;
    const img=$('comparison-figure');img.onload=null;img.onerror=null;img.hidden=true;img.removeAttribute('src');
    $('dated-plot').replaceChildren();$('dated-plot').hidden=true;
    for(const id of ['figure-png','figure-csv','daily-png']){$(id).hidden=true;$(id).removeAttribute('href');}
    for(const u of urls)URL.revokeObjectURL(u);urls=[];
    $('values-head').replaceChildren();$('values-body').replaceChildren();
    $('figure-caption').textContent='';$('figure-note').textContent='';$('figure-message').hidden=true;
  }
  function values(columns,rows,filename){
    $('values-head').innerHTML='<tr>'+columns.map(c=>`<th scope="col">${esc(c)}</th>`).join('')+'</tr>';
    $('values-body').innerHTML=rows.map(r=>'<tr>'+r.map((v,i)=>`<${i?'td':'th'}>${esc(fmt(v,6))}</${i?'td':'th'}>`).join('')+'</tr>').join('');
    const cell=v=>'"'+(v===null?'':String(v)).replace(/"/g,'""')+'"';
    const csv=[columns,...rows].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));urls.push(url);
    $('figure-csv').href=url;$('figure-csv').download=filename;$('figure-csv').hidden=false;
  }
  function updateDownloads(){
    $('benchmark-downloads').hidden=isDaily();$('daily-downloads').hidden=!isDaily();
    $('daily-methods').hidden=!isDaily();$('benchmark-methods').hidden=isDaily();
    if(isDaily()&&run){$('download-run-json').href=siteURL(`data/verification/dated_v1/runs/${run.initialization}.json`);$('download-run-json').hidden=false;}
    else $('download-run-json').hidden=true;
  }
  function renderBenchmark(){
    clear();need(benchmark,'The 2025 comparison is unavailable.');
    const metric=$('figure-metric').value,s=scope(metric),d=s==='global'?null:Number($('evaluation-duration').value),t=s==='threshold'?Number($('evaluation-threshold').value):null;
    $('evaluation-duration').disabled=s==='global';$('evaluation-threshold').disabled=s!=='threshold';
    const e=benchmark.entries.find(e=>entryKey(e.metric,e.duration_hours,e.threshold_mm)===entryKey(metric,d,t));need(e,'Selected 2025 comparison is unavailable.');
    $('figure-title').textContent=e.metric_label;
    $('selection-description').textContent=`2025 test period · ${d===null?'All durations':d+'-hour'}${t===null?'':` · precipitation > ${t} mm`}${e.n_samples?' · '+fmt(e.n_samples,0)+' matched cases':''}`;
    if(['crps','crpss','crps_reduction'].includes(metric)){
      message('The 2025 CRPS results require revalidation.');
      $('figure-note').textContent='The archived scoring routine omits the zero-censoring correction. CRPS, CRPSS, and CRPS reductions from that evaluation are withheld here until recomputed. Dated comparisons use the corrected score.';return;
    }
    $('figure-caption').textContent=e.caption;$('figure-note').textContent=e.note;$('values-caption').textContent=e.caption;
    values(e.table_columns,e.table_rows,`2025_${metric}_${d??'all'}h_${t??'all'}.csv`);
    const image=$('comparison-figure'),v=version,url=siteURL(e.image);message('Loading the figure…');
    image.alt=e.caption;image.onload=()=>{if(v!==version)return;image.hidden=false;$('figure-message').hidden=true;$('figure-png').href=url;$('figure-png').hidden=false;};
    image.onerror=()=>{if(v===version)message('The figure could not be loaded. Its values are available below.');};image.src=url;
  }
  function svgText(x,y,text,opts=''){return `<text x="${x}" y="${y}" ${opts}>${esc(text)}</text>`;}
  function plot(title,subtitle,yLabel,series,kind,xLabels){
    const W=1680,H=1152,L=190,R=1520,T=205,B=900;
    const all=series.flatMap(s=>s.points.map(p=>p[1])).filter(Number.isFinite);
    if(!all.length)return null;
    let min=kind==='curve'?0:Math.min(0,...all),max=kind==='curve'?1:Math.max(0,...all);
    if(max===min)max=min+1;
    if(kind!=='curve'){const pad=(max-min)*.16;max+=pad;if(min<0)min-=pad;}
    const X=x=>L+x*(R-L),Y=y=>B-(y-min)/(max-min)*(B-T);
    let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title+'. '+subtitle)}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial,DejaVu Sans,sans-serif" fill="#142b42" font-size="28">`;
    s+=svgText(90,70,title,'font-size="44" font-weight="700"')+svgText(90,124,subtitle,'font-size="27" fill="#536c81"');
    for(let i=0;i<=5;i++){const value=min+(max-min)*i/5,y=Y(value);s+=`<path d="M${L},${y} H${R}" stroke="#e5eaf0"/>`+svgText(L-25,y+9,fmt(value,kind==='curve'?1:3),'text-anchor="end"');}
    s+=`<path d="M${L},${T} V${B} H${R}" fill="none" stroke="#40566a" stroke-width="2"/>`;
    s+=`<text x="65" y="560" transform="rotate(-90 65 560)" text-anchor="middle">${esc(yLabel)}</text>`;
    if(kind==='curve'){
      for(let i=0;i<=5;i++)s+=svgText(X(i/5),B+47,fmt(i/5,1),'text-anchor="middle"');
      s+=`<path d="M${X(0)},${Y(0)} L${X(1)},${Y(1)}" stroke="#7c858e" stroke-width="2" stroke-dasharray="10 10" fill="none"/>`;
      for(const a of series){
        // Missing reliability bins split the line instead of connecting empty bins.
        let open=false,path='';for(const p of a.points){if(!Number.isFinite(p[1])||!Number.isFinite(p[0])){open=false;continue;}path+=(open?' L':' M')+X(p[0])+','+Y(p[1]);open=true;}
        s+=`<path d="${path}" fill="none" stroke="${a.color}" stroke-width="4"/>`;
        if(a.points.length<=10)for(const p of a.points)if(Number.isFinite(p[1]))s+=`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="7" fill="${a.color}"><title>${esc(a.name+': '+fmt(p[0])+', '+fmt(p[1]))}</title></circle>`;
      }
      s+=svgText((L+R)/2,B+100,xLabels[0],'text-anchor="middle"');
    }else{
      const groups=xLabels.length,n=kind==='modelbar'?1:series.length,step=(R-L)/groups,width=Math.min(210,step*.7/n),baseY=Y(0);
      xLabels.forEach((label,i)=>{
        const center=L+(i+.5)*step;s+=svgText(center,B+50,label,'text-anchor="middle" font-size="28"');
        series.forEach((a,j)=>{if(kind==='modelbar'&&j!==i)return;const value=a.points[i]?.[1],x=kind==='modelbar'?center-width/2:center+(j-n/2)*width;if(!Number.isFinite(value)){s+=svgText(x+width/2,baseY-16,'—','text-anchor="middle"');return;}
          const y=Y(value),h=Math.abs(baseY-y);s+=`<rect x="${x}" y="${Math.min(y,baseY)}" width="${width*.91}" height="${Math.max(.5,h)}" fill="${a.color}"><title>${esc(a.name+': '+fmt(value,6))}</title></rect>`;
          if(groups<=3)s+=svgText(x+width*.455,value>=0?y-18:y+34,fmt(value,4),'text-anchor="middle" font-size="28"');
        });
      });
      if(min<0)s+=`<path d="M${L},${Y(0)} H${R}" stroke="#687786" stroke-width="2"/>`;
    }
    if(series.length>1)series.forEach((a,i)=>{const x=190+i*440;s+=`<rect x="${x}" y="1050" width="38" height="12" fill="${a.color}"/>`+svgText(x+53,1066,a.name,'font-size="26"');});
    s+=svgText(90,1120,'HRRR GNN-CSGD · Matched MRMS verification · '+dateLabel(run.init_utc),'font-size="21" fill="#536c81"');
    return s+'</g></svg>';
  }
  function dailyFigure(w,metric,t){
    const s=w.scores,th=s.thresholds.find(v=>v.threshold_mm===t),column=$('figure-metric').selectedOptions[0].textContent;
    let columns=['Model',column],rows=[],series=[],kind='bar',xLabels=labels,yl=column,note='All models use the same observed grid cells and forecast window.';
    if(['crps','crpss'].includes(metric)){
      kind='modelbar';
      rows=models.map((m,i)=>[labels[i],s.models[m][metric]]);series=[{name:column,color:colors[0],points:rows.map((r,i)=>[i,r[1]])}];
      // Separate colored series with one value each retain the model palette.
      series=models.map((m,i)=>({name:labels[i],color:colors[i],points:models.map((_,j)=>[j,j===i?s.models[m][metric]:null])}));
      yl=metric==='crps'?'CRPS (mm; lower is better)':'CRPSS vs raw HRRR (higher is better)';
    }else if(metric==='roc_curve'){
      kind='curve';xLabels=['False-positive rate'];yl='True-positive rate';columns=['Model','Probability cutoff','False-positive rate','True-positive rate','Hits','False alarms'];
      series=models.map((m,i)=>({name:labels[i]+` (AUC ${fmt(th.models[m].roc_auc,3)})`,color:colors[i],points:th.models[m].roc.points.map(p=>[p[0],p[1]])}));
      for(const [i,m] of models.entries())for(const p of th.models[m].roc.points)rows.push([labels[i],p[4],p[0],p[1],p[2],p[3]]);
      note='ROC and AUC use all saved probabilities, with ties grouped together. Collinear vertices are removed without changing the curve or its area.';
    }else if(metric==='reliability'){
      kind='curve';xLabels=['Forecast probability'];yl='Observed event frequency';columns=['Model','Bin lower','Bin upper','Samples','Events','Mean probability','Observed frequency'];
      series=models.map((m,i)=>({name:labels[i],color:colors[i],points:th.models[m].bins.map(b=>[b.mean_probability,b.event_frequency])}));
      for(const [i,m] of models.entries())for(const b of th.models[m].bins)rows.push([labels[i],b.lower,b.upper,b.n,b.events,b.mean_probability,b.event_frequency]);
      note='Ten equal-width probability bins; empty bins have no plotted point. The diagonal indicates perfect reliability.';
    }else if(metric==='usage'){
      xLabels=Array.from({length:10},(_,i)=>`${i*10}–${(i+1)*10}`);yl='Forecasts in probability bin (%)';columns=['Model','Bin lower','Bin upper','Samples','Share (%)'];
      series=models.map((m,i)=>({name:labels[i],color:colors[i],points:th.models[m].bins.map((b,j)=>[j,100*b.n/th.n_samples])}));
      for(const [i,m] of models.entries())for(const b of th.models[m].bins)rows.push([labels[i],b.lower,b.upper,b.n,100*b.n/th.n_samples]);
      note='The horizontal axis gives forecast-probability ranges in percent. Every matched case contributes to one bin.';
    }else if(metric==='crps_reduction'||metric==='brier_reduction'){
      const values=metric==='crps_reduction'?[s.models.ann_csgd.crps>0?100*(1-s.models.gnn_csgd.crps/s.models.ann_csgd.crps):null]:s.thresholds.map(a=>a.models.ann_csgd.brier>0?100*(1-a.models.gnn_csgd.brier/a.models.ann_csgd.brier):null);
      xLabels=metric==='crps_reduction'?[`${w.duration_hours}-hour`]:thresholds.map(t=>`${t} mm`);columns=['Selection','GNN reduction vs ANN (%)'];rows=xLabels.map((l,i)=>[l,values[i]]);
      series=[{name:'GNN vs ANN',color:colors[2],points:values.map((v,i)=>[i,v])}];yl='Score reduction vs ANN-CSGD (%)';note='Positive values favor GNN-CSGD. These are matched-sample point estimates without confidence intervals.';
    }else{
      kind='modelbar';
      rows=models.map((m,i)=>[labels[i],th.models[m][metric]]);
      series=models.map((m,i)=>({name:labels[i],color:colors[i],points:models.map((_,j)=>[j,j===i?th.models[m][metric]:null])}));
      if(['bss','roc_auc','resolution'].includes(metric))yl+=' (higher is better)';else yl+=' (lower is better)';
      if(metric==='bss')note=catalog.bss_reference;
      if(['reliability_penalty','resolution'].includes(metric))note='Binned component divided by observed event uncertainty. Undefined when all observations belong to one event class.';
    }
    const subtitle=`${w.duration_hours}-hour · f${String(w.start_hour).padStart(2,'0')}–f${String(w.end_hour).padStart(2,'0')} · ${scope(metric)==='threshold'?'precipitation ≥ '+t+' mm · ':''}${fmt(scope(metric)==='threshold'?th.n_samples:s.n_samples,0)} matched cells`;
    return {svg:plot(column,subtitle,yl,series,kind,xLabels),columns,rows,note,subtitle};
  }
  function renderDaily(){
    clear();if(!run){message('Loading the selected initialization…');return;}
    const metric=$('figure-metric').value,d=Number($('evaluation-duration').value),t=Number($('evaluation-threshold').value);
    $('evaluation-duration').disabled=false;$('evaluation-threshold').disabled=scope(metric)!=='threshold';
    const w=run.windows.find(w=>w.duration_hours===d&&w.id===$('comparison-window').value);need(w,'Selected forecast window is unavailable.');
    $('figure-title').textContent=$('figure-metric').selectedOptions[0].textContent;
    $('selection-description').textContent=`Initialized ${dateLabel(run.init_utc)} · Valid ${dateLabel(w.valid_start_utc)} → ${dateLabel(w.valid_end_utc)}`;
    $('figure-caption').textContent=`${d}-hour · forecast hours ${w.start_hour}–${w.end_hour}`;
    if(w.status!=='VERIFIED'){message(w.reason||'Verification is awaiting matching observations.');$('figure-note').textContent='Scores appear after the full accumulation period has ended and matching MRMS observations are available.';return;}
    const f=dailyFigure(w,metric,t);$('figure-caption').textContent=f.subtitle;$('values-caption').textContent=f.subtitle;
    $('figure-note').textContent=f.note+(w.forecast_origin==='historical_replay'?' GNN predictions were replayed from archived inputs with the frozen model.':'');
    values(f.columns,f.rows,`${run.initialization}_${w.id}_${metric}_${t}mm.csv`);
    if(!f.svg){message('This metric is undefined for this selection. ROC needs both observed events and non-events.');return;}
    plotSVG=f.svg;$('dated-plot').innerHTML=f.svg;$('dated-plot').hidden=false;$('daily-png').hidden=false;
  }
  function render(){try{isDaily()?renderDaily():renderBenchmark();updateDownloads();}catch(e){clear();message(e.message);}}
  function windows(){
    if(!run)return;
    const d=Number($('evaluation-duration').value),old=$('comparison-window').value;
    setOptions('comparison-window',run.windows.filter(w=>w.duration_hours===d).map(w=>[w.id,`f${String(w.start_hour).padStart(2,'0')}–f${String(w.end_hour).padStart(2,'0')} · ${w.status==='VERIFIED'?'Verified':w.status==='WAITING'?'Pending':'Unavailable'}`]),old);
  }
  async function selectInit(){
    run=null;clear();const v=version;message('Loading the selected initialization…');
    for(const id of ['comparison-window','figure-metric','evaluation-duration','evaluation-threshold','previous-metric','next-metric'])$(id).disabled=true;
    $('download-run-json').hidden=true;$('comparison-data-status').textContent='Loading initialization…';
    try{
      const record=catalog.runs.find(r=>r.initialization===$('comparison-initialization').value);need(record,'Initialization is unavailable.');
      $('scope-period').textContent=dateLabel(record.init_utc);
      const key=record.initialization+'|'+record.sha256;
      const data=runCache.get(key)||validateRun(await request(record.url,record.sha256),record);
      if(v!==version||!isDaily())return;runCache.set(key,data);run=data;
      windows();for(const id of ['comparison-window','figure-metric','evaluation-duration','evaluation-threshold','previous-metric','next-metric'])$(id).disabled=false;render();
      $('comparison-data-status').textContent=`${run.verified_windows}/20 windows verified`;
      $('scope-period').textContent=dateLabel(run.init_utc);$('scope-note').textContent='Raw HRRR, ANN-CSGD, and GNN-CSGD share each window’s MRMS observations. '+catalog.bss_reference;
      const url=new URL(location.href);url.searchParams.set('init',run.initialization);history.replaceState(null,'',url);
    }catch(e){if(v===version){message(e.message);$('comparison-data-status').textContent='Selected initialization unavailable';}}
  }
  function changeScope(){
    const daily=isDaily();$('dated-controls').hidden=!daily;$('scope-label').textContent=daily?'Forecast initialization':'Independent test period';
    if(daily){selectInit();}else{
      run=null;$('scope-period').textContent='2025';$('scope-note').textContent='Matched test cases within each duration; BSS uses 2024 validation climatology. CRPS results require revalidation.';
      for(const id of ['figure-metric','previous-metric','next-metric'])$(id).disabled=false;
      $('comparison-data-status').textContent='2025 comparison';render();
    }
  }
  function exportPNG(){
    if(!plotSVG)return;
    const svg=plotSVG,v=version,url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),image=new Image();
    image.onload=()=>{URL.revokeObjectURL(url);if(v!==version)return;const canvas=document.createElement('canvas');canvas.width=1680;canvas.height=1152;canvas.getContext('2d').drawImage(image,0,0);canvas.toBlob(b=>{if(!b||v!==version)return;const u=URL.createObjectURL(b);urls.push(u);const a=document.createElement('a');a.href=u;a.download=`${run.initialization}_${$('comparison-window').value}_${$('figure-metric').value}.png`;a.click();},'image/png');};
    image.onerror=()=>{URL.revokeObjectURL(url);$('figure-note').textContent+=' PNG export failed; the plotted values remain available as CSV.';};image.src=url;
  }
  async function main(){
    const [b,c]=await Promise.allSettled([request('data/verification/2025/comparison_figures_v2.json'),request('data/verification/dated_v1/catalog.json')]);
    if(b.status==='fulfilled')try{benchmark=validate(b.value);}catch(e){console.error(e);}
    if(c.status==='fulfilled')try{catalog=validateCatalog(c.value);}catch(e){console.error(e);}
    const choices=[];if(catalog?.runs.length)choices.push(['daily','Forecast initializations']);if(benchmark)choices.push(['2025','2025 test period']);
    if(!choices.length){clear();message('Comparison data are unavailable. Please try again after deployment.');return;}
    setOptions('evaluation-scope',choices,choices[0][0]);
    if(catalog?.runs.length){
      const wanted=new URL(location.href).searchParams.get('init');
      setOptions('comparison-initialization',catalog.runs.map(r=>[r.initialization,`${dateLabel(r.init_utc)} · ${r.verified_windows}/20 verified`]),wanted);
      // Prefer a duration with verified data only on the initial page load.
      $('evaluation-duration').value='6';
    }
    for(const id of ['evaluation-scope','comparison-initialization','figure-metric','evaluation-duration','evaluation-threshold','previous-metric','next-metric'])$(id).disabled=false;
    $('evaluation-scope').addEventListener('change',changeScope);$('comparison-initialization').addEventListener('change',selectInit);
    $('evaluation-duration').addEventListener('change',()=>{windows();render();});
    for(const id of ['comparison-window','figure-metric','evaluation-threshold'])$(id).addEventListener('change',render);
    for(const [id,step] of [['previous-metric',-1],['next-metric',1]])$(id).addEventListener('click',()=>{$('figure-metric').value=metrics[(metrics.indexOf($('figure-metric').value)+step+metrics.length)%metrics.length];render();});
    $('daily-png').addEventListener('click',exportPNG);changeScope();
  }
  main().catch(e=>{clear();message(e.message);});
})();
