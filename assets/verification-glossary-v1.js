/* Additional diagnostics: published bins remain useful when paired inputs expire. */
(function(root){
  'use strict';
  const finite=x=>typeof x==='number'&&Number.isFinite(x),ratio=(a,b)=>b>0?a/b:null;
  function counts(h,f,m,c){
    const n=h+f+m+c,ch=n?(h+f)*(h+m)/n:0,random=n?((h+f)*(h+m)+(m+c)*(f+c))/n:0;
    return {hits:h,false_alarms:f,misses:m,correct_rejections:c,n,pc:ratio(100*(h+c),n),pod:ratio(h,h+m),far:ratio(f,h+f),sr:ratio(h,h+f),pofd:ratio(f,f+c),csi:ratio(h,h+f+m),frequency_bias:ratio(h+f,h+m),ets:ratio(h-ch,h+f+m-ch),hss:ratio(h+c-random,n-random),tss:ratio(h*c-f*m,(h+m)*(f+c)),chance_hits:n?ch:null,correct_random:n?random:null,base_rate:ratio(h+m,n),forecast_event_rate:ratio(h+f,n)};
  }
  function fromBins(t,id,cutoff){
    const m=t.models[id],bins=m.bins,n=t.n_samples;
    if(!Array.isArray(bins)||bins.length!==10||bins.reduce((s,b)=>s+b.n,0)!==n)throw Error('Probability-bin counts do not match.');
    if(bins.reduce((s,b)=>s+b.events,0)!==t.n_events)throw Error('Event counts do not match.');
    const rate=t.n_events/n,unc=rate*(1-rate);let hits=0,fa=0,rel=0,res=0,sanders=0,pm=0;
    for(const b of bins){
      if(!Number.isSafeInteger(b.n)||!Number.isSafeInteger(b.events)||b.events<0||b.events>b.n)throw Error('Invalid probability bin.');
      if(b.lower>=cutoff-1e-12){hits+=b.events;fa+=b.n-b.events;}
      if(b.n){const w=b.n/n,o=b.events/b.n;pm+=w*b.mean_probability;rel+=w*(b.mean_probability-o)**2;res+=w*(o-rate)**2;sanders+=w*o*(1-o);}
    }
    return {categorical:counts(hits,fa,t.n_events-hits,n-t.n_events-fa),base_rate:rate,uncertainty:unc,
      reliability_raw:rel,resolution_raw:res,sanders_resolution:sanders,mean_probability:pm,probability_bias:pm-rate,
      vector_brier:finite(m.brier)?2*m.brier:null,brier:m.brier,bss_sample:unc>0?1-m.brier/unc:null,
      brier_binned:rel-res+unc,brier_bin_residual:m.brier-(rel-res+unc),bins,roc:m.roc??null};
  }
  function rankedFallback(scores,ids){
    const ts=scores.thresholds;if(!ts.length||ts.some(t=>!t.n_samples||!t.mask_sha256||t.mask_sha256!==ts[0].mask_sha256||t.n_samples!==ts[0].n_samples))return null;
    const unc=ts.reduce((s,t)=>{const r=t.n_events/t.n_samples;return s+r*(1-r);},0),monthly=ts.every(t=>finite(t.climatology_brier))?ts.reduce((s,t)=>s+t.climatology_brier,0):null;
    const models={};for(const id of ids){if(ts.some(t=>!finite(t.models[id]?.brier)))return null;const rps=ts.reduce((s,t)=>s+t.models[id].brier,0);models[id]={rps,rps_normalized:rps/ts.length,rpss_sample:unc>0?1-rps/unc:null,rpss_monthly:monthly>0?1-rps/monthly:null};}return {n_samples:ts[0].n_samples,models};
  }
  const api={counts,fromBins,rankedFallback};if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof document==='undefined')return;
  const panel=document.getElementById('verification-glossary');if(!panel)return;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const $=id=>document.getElementById(id),fmt=(x,d=5)=>finite(x)?x.toLocaleString('en-US',{maximumFractionDigits:d}):'Undefined / unavailable';
  const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const COLORS=['#2f6db5','#c4433b','#208b5d','#8b5cc7'];
  const MODELS={raw_hrrr:'Raw HRRR',ann_csgd:'ANN-CSGD',gnn_csgd:'GNN-CSGD',ann_operational:'ANN-CSGD',gnn_operational:'GNN-CSGD',cnn_csgd_24h_corrected_v1:'CNN-CSGD'};
  const CAT=['contingency','pc','pod','far','sr','pofd','csi','frequency_bias','ets','hss','tss','chance_hits','correct_random','forecast_event_rate'];
  const AMOUNTS=['mse','rmse','mae','bias','correlation','covariance','prediction_efficiency','amount_summary','joint','histogram','box','conditional_observation','conditional_forecast','conditional_quantile'];
  const RANKED=['rps','rps_normalized','rpss_sample','rpss_monthly','multicategory_brier'];
  const METRICS=[['Categorical events',[
    ['contingency','Contingency table'],['csi','CSI / threat score'],['pod','Probability of detection'],['far','False alarm ratio'],['sr','Success ratio'],['pofd','False-positive rate'],['pc','Percent correct'],['frequency_bias','Frequency bias'],['ets','Gilbert / equitable threat score'],['hss','Heidke skill score'],['tss','True skill statistic'],['chance_hits','Expected chance hits'],['correct_random','Expected random correct forecasts'],['forecast_event_rate','Forecast event rate']]],
    ['Rainfall amounts',[
    ['mse','Mean squared error'],['rmse','Root mean squared error'],['mae','Mean absolute error'],['bias','Mean error / bias'],['correlation','Linear correlation'],['covariance','Covariance'],['prediction_efficiency','Prediction efficiency: sample mean reference'],['amount_summary','Means, medians, quantiles and spread'],['joint','Bivariate histogram / joint distribution'],['histogram','Marginal rainfall histograms'],['box','Box / quantile summary'],['conditional_observation','Observed rainfall conditional on forecast'],['conditional_forecast','Forecast rainfall conditional on observations'],['conditional_quantile','Conditional observed quantiles']]],
    ['Probability forecasts',[
    ['brier','Binary Brier score (0–1)'],['vector_brier','Two-category vector Brier score (0–2)'],['rps','Ranked probability score'],['rps_normalized','Normalized ranked probability score'],['rpss_sample','RPS skill: sample climatology'],['rpss_monthly','RPS skill: historical monthly climatology'],['multicategory_brier','Multicategory Brier score'],['base_rate','Observed event base rate'],['mean_probability','Mean forecast probability'],['probability_bias','Probability bias'],['uncertainty','Event uncertainty'],['reliability_raw','Reliability component (unnormalized)'],['resolution_raw','Murphy resolution (unnormalized)'],['sanders_resolution','Sanders resolution'],['bss_sample','Brier skill: sample climatology'],['brier_bin_residual','Unbinned minus binned Brier score'],['sharpness_variance','Probability variance / refinement'],['reliability','Reliability diagram'],['sharpness','Sharpness histogram'],['discrimination','Discrimination diagram'],['roc','ROC curves']]]];
  const LABEL=Object.fromEntries(METRICS.flatMap(x=>x[1]));
  const controls=$('vg-controls'),status=$('vg-status'),output=$('vg-output'),note=$('vg-note');
  function select(label,id,options){const w=el('label',label),s=el('select');s.id=id;options.forEach(([v,t])=>{const o=el('option',t);o.value=v;s.append(o);});w.append(s);controls.append(w);return s;}
  const scope=select('Comparison','vg-scope',[['three','Raw HRRR · ANN · GNN'],['four','Raw HRRR · ANN · GNN · CNN (24 h)']]);
  const init=select('Initialization (UTC)','vg-init',[]),winSel=select('Forecast window','vg-window',[]);
  const metric=select('Metric or diagnostic','vg-metric',[]);
  METRICS.forEach(([label,items])=>{const group=el('optgroup');group.label=label;items.forEach(([v,t])=>{const o=el('option',t);o.value=v;group.append(o);});metric.append(group);});metric.value='csi';
  const threshold=select('Rainfall threshold','vg-threshold',[]),rule=select('Categorical forecast rule','vg-rule',[['probability','Probability ≥ selected cutoff'],['amount','Expected rainfall ≥ threshold']]);
  const cutoff=select('Probability cutoff','vg-cutoff',Array.from({length:9},(_,i)=>[String((i+1)/10),((i+1)*10)+'%']));cutoff.value='0.5';
  const units=select('Rainfall units','vg-units',[['in','Inches'],['mm','Millimeters']]);
  const diagnosticModel=select('Model for conditional quantiles','vg-diagnostic-model',[]);
  const prefix={three:'data/verification/dated_v1/',four:'data/cnn24h_v1/'};let catalog,run,extra=null,request=0;const cache=new Map(),urls=[];
  const rootURL=new URL('../',location.href);
  async function fetchJSON(path,hash){
    if(!/^[\w./-]+$/.test(path)||path.split('/').includes('..'))throw Error('Invalid data path');
    const key=path+'|'+(hash||'');if(cache.has(key))return cache.get(key);
    const r=await fetch(new URL(path,rootURL),{cache:'no-cache'});if(!r.ok)throw Error('Data unavailable (HTTP '+r.status+').');
    const b=await r.arrayBuffer();if(hash){if(!crypto.subtle)throw Error('A secure connection is needed to verify the data.');
      const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');if(actual!==hash)throw Error('Data are updating; reload after deployment.');}
    const value=JSON.parse(new TextDecoder().decode(b));if(hash)cache.set(key,value);return value;
  }
  function options(s,items,preferred){s.replaceChildren();items.forEach(([v,t])=>{const o=el('option',t);o.value=v;s.append(o);});if(items.some(x=>x[0]===preferred))s.value=preferred;}
  function table(headers,rows){const wrap=el('div',undefined,'vg-table-wrap');wrap.tabIndex=0;const t=el('table'),h=el('thead'),tr=el('tr');headers.forEach(x=>tr.append(el('th',x)));h.append(tr);t.append(h);const body=el('tbody');rows.forEach(row=>{const r=el('tr');row.forEach(x=>r.append(el('td',typeof x==='number'?fmt(x):x??'Undefined / unavailable')));body.append(r);});t.append(body);wrap.append(t);return wrap;}
  function download(text,data,type,filename){const a=el('a',text,'button'),url=URL.createObjectURL(new Blob([data],{type}));urls.push(url);a.href=url;a.download=filename;return a;}
  function renderChart(series,kind,title,xLabel,yLabel,labels=[]){
    const W=1680,H=1152,L=190,R=1500,T=210,B=880,values=series.flatMap(s=>s.points.flatMap(p=>[p[1]])).filter(finite);if(!values.length)return null;
    const curve=['roc','reliability'].includes(kind),line=kind==='line'||curve;
    const xs=series.flatMap(s=>s.points.map(p=>p[0])).filter(finite);let xmin=0,xmax=curve?1:Math.max(1,...xs),min=Math.min(0,...values),max=curve?1:Math.max(...values);if(max===min)max=min+1;if(!curve)max+=(max-min)*.12;
    const X=x=>L+(x-xmin)/(xmax-xmin)*(R-L),Y=y=>B-(y-min)/(max-min)*(B-T);
    let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial,sans-serif" font-size="25" fill="#142b42"><text x="90" y="70" font-size="38" font-weight="700">${esc(title)}</text><text x="90" y="120" font-size="25">${esc(run.initialization+' · '+winSel.selectedOptions[0].textContent)}</text>`;
    const selection=CAT.includes(metric.value)?'Rainfall ≥ '+fmt(Number(threshold.value)/25.4,2)+' inches · '+(rule.value==='probability'?'forecast probability ≥ '+Number(cutoff.value)*100+'%':'expected rainfall ≥ threshold'):RANKED.includes(metric.value)?'Ordered rainfall categories · same intersected sample mask':AMOUNTS.includes(metric.value)?'Matched rainfall amounts · '+(units.value==='in'?'inches':'millimeters'):'Rainfall ≥ '+fmt(Number(threshold.value)/25.4,2)+' inches';
    s+=`<text x="90" y="165" font-size="23" fill="#536c81">${esc(selection)}</text>`;
    for(let i=0;i<=5;i++){const v=min+(max-min)*i/5,y=Y(v);s+=`<path d="M${L},${y} H${R}" stroke="#e5eaf0"/><text x="${L-25}" y="${y+8}" text-anchor="end">${esc(fmt(v,3))}</text>`;}
    s+=`<path d="M${L},${T} V${B} H${R}" fill="none" stroke="#40566a" stroke-width="2"/><text transform="translate(60 560) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
    if(line){
      for(let i=0;i<=5;i++)s+=`<text x="${X(xmax*i/5)}" y="${B+45}" text-anchor="middle">${esc(fmt(xmax*i/5,2))}</text>`;
      if(curve)s+=`<path d="M${X(0)},${Y(0)} L${X(1)},${Y(1)}" stroke="#88929a" stroke-dasharray="10 10" fill="none"/>`;
      for(const a of series){let d='',open=false;for(const [x,y] of a.points){if(!finite(x)||!finite(y)){open=false;continue;}d+=(open?' L':' M')+X(x)+','+Y(y);open=true;}s+=`<path d="${d}" stroke="${a.color}" stroke-width="4" stroke-dasharray="${a.dash||''}" fill="none"/>`;}
    }else{
      const groups=labels.length,step=(R-L)/groups,modelBar=series.length===labels.length&&series.every((a,i)=>a.points.every((p,j)=>i===j||!finite(p[1]))),width=modelBar?Math.min(210,step*.55):step*.75/series.length;
      labels.forEach((label,j)=>{s+=`<text x="${L+(j+.5)*step}" y="${B+45}" text-anchor="middle" font-size="${groups>8?18:24}">${esc(label)}</text>`;series.forEach((a,i)=>{const v=a.points[j]?.[1];if(!finite(v))return;const x=modelBar?L+(j+.5)*step-width/2:L+j*step+step*.125+i*width,y=Y(v);s+=`<rect x="${x}" y="${Math.min(y,Y(0))}" width="${width*.93}" height="${Math.max(.5,Math.abs(y-Y(0)))}" fill="${a.color}"><title>${esc(a.name+': '+fmt(v))}</title></rect>`;if(modelBar)s+=`<text x="${x+width*.465}" y="${v>=0?y-15:y+32}" text-anchor="middle">${esc(fmt(v,4))}</text>`;});});
    }
    s+=`<text x="845" y="${B+100}" text-anchor="middle">${esc(xLabel)}</text>`;
    series.forEach((a,i)=>{const x=180+(i%4)*330,y=1015+Math.floor(i/4)*45;s+=`<path d="M${x},${y} h34" stroke="${a.color}" stroke-width="5" stroke-dasharray="${a.dash||''}"/><text x="${x+45}" y="${y+8}" font-size="20">${esc(a.name)}</text>`;});
    s+=`<text x="90" y="1120" font-size="20" fill="#536c81">HRRR Neural Weather Hub · Matched MRMS verification · Point estimates</text></g></svg>`;return s;
  }
  function figure(svg,rows,headers,title){
    if(svg){const frame=el('div',undefined,'vg-chart');frame.innerHTML=svg;output.append(frame);}
    const links=el('div',undefined,'vg-downloads'),filename=run.initialization+'_'+winSel.value+'_'+metric.value+'_'+units.value;
    if(svg){links.append(download('Download SVG',svg,'image/svg+xml',filename+'.svg'));const button=el('button','Download PNG','button');button.type='button';button.onclick=()=>{const image=new Image(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));image.onload=()=>{URL.revokeObjectURL(url);const c=document.createElement('canvas');c.width=image.naturalWidth||1680;c.height=image.naturalHeight||1152;c.getContext('2d').drawImage(image,0,0);c.toBlob(blob=>{const a=el('a');a.href=URL.createObjectURL(blob);urls.push(a.href);a.download=filename+'.png';a.click();});};image.src=url;};links.append(button);}
    const cell=v=>'"'+(v===null||v===undefined?'':String(v)).replace(/"/g,'""')+'"';
    // CSV includes full selection metadata, so a downloaded value remains interpretable.
    const meta=[['Initialization',run.initialization],['Scope',scope.value],['Window',winSel.value],['Metric',metric.value],['Rainfall units',units.value],['Threshold (mm)',threshold.value],['Categorical rule',rule.value],['Probability cutoff',cutoff.value]];
    links.append(download('Download values (CSV)',[...meta,[],headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n'),'text/csv',filename+'.csv'));output.append(links);
    output.append(table(headers,rows));
  }
  function fallback(t,id){return fromBins(t,id,Number(cutoff.value));}
  function extraWindow(){return extra?.windows.find(w=>w.id===winSel.value&&w.status==='VERIFIED')?.scores;}
  function display(){
    urls.splice(0).forEach(URL.revokeObjectURL);output.replaceChildren();note.textContent='';if(!run)return;
    const win=run.windows.find(w=>w.id===winSel.value),m=metric.value,amount=AMOUNTS.includes(m),ranked=RANKED.includes(m),cat=CAT.includes(m),k=units.value==='in'?25.4:1,unit=units.value==='in'?'in':'mm';
    threshold.disabled=amount||ranked;rule.disabled=!cat;cutoff.disabled=!cat||rule.value==='amount';diagnosticModel.disabled=m!=='conditional_quantile';
    $('vg-title').textContent=LABEL[m];
    status.textContent=run.initialization+' UTC initialization · '+win.id+' · '+win.status;
    if(win.status!=='VERIFIED'){output.append(el('p',win.reason||'Matching observations or forecasts are pending.','pending-box'));return;}
    const scores=win.scores,t=scores.thresholds.find(t=>String(t.threshold_mm)===threshold.value),e=extraWindow();
    const et=e?.thresholds.find(x=>x.threshold_mm===t?.threshold_mm);
    if(!amount&&!ranked&&(!t||!t.n_samples)){output.append(el('p','No matched cases at this threshold.','pending-box'));return;}
    const ids=run.models,rank=e?.ranked??rankedFallback(scores,ids),n=amount?scores.n_samples:ranked?rank?.n_samples:t.n_samples;
    status.textContent+=' · '+(n??'Unavailable')+' matched grid cells'+(!amount&&!ranked?' · '+t.n_events+' observed events':'');
    note.textContent='Equal weight per matched land cell. Counts are grid-cell/window cases, not independent storms. Undefined ratios remain unavailable.';
    let rows=[],headers=['Model',LABEL[m]],series=[],kind='bar',labels=ids.map(id=>MODELS[id]||id),xLabel='Model',yLabel=LABEL[m];
    const unavailable=()=>{output.append(el('p','This diagnostic needs retained paired forecast and MRMS data. The scheduled extension refresh will add it when those inputs pass the matching checks. Published scores and probability-bin diagnostics remain available.','pending-box'));};
    if(amount&&!['mse','rmse','mae','bias'].includes(m)&&!e){unavailable();return;}
    if(ranked&&!rank){unavailable();return;}
    if(m==='amount_summary'||m==='box'){
      headers=['Model / field','Mean ('+unit+')','Median','Q10','Q25','Q75','Q90','Minimum','Maximum','SD','Variance ('+unit+'²)','IQR'];
      [...ids.map(id=>[MODELS[id],e.models[id].forecast]),['MRMS',e.models[ids[0]].observation]].forEach(([name,d])=>rows.push([name,d.mean/k,d.median/k,d.q10/k,d.q25/k,d.q75/k,d.q90/k,d.minimum/k,d.maximum/k,d.sd/k,d.variance/k**2,d.iqr/k]));
      if(m==='box'){
        const data=rows.map(r=>({name:r[0],low:r[3],q1:r[4],median:r[2],q3:r[5],high:r[6]})),max=Math.max(...data.map(d=>d.high),.01),X=v=>230+v/max*1220;
        let s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1680 800" width="1680" height="800" role="img" aria-label="Rainfall quantile boxes"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" fill="#142b42" font-size="26"><text x="80" y="65" font-size="38">Rainfall distribution across matched cells</text><text x="80" y="110">Box: Q25–Q75 · line: median · whiskers: Q10–Q90 · '+unit+'</text>';
        data.forEach((d,i)=>{const y=200+i*100,c=COLORS[i]||'#586574';s+=`<text x="40" y="${y+10}">${esc(d.name)}</text><path d="M${X(d.low)},${y} H${X(d.high)}" stroke="${c}" stroke-width="4"/><rect x="${X(d.q1)}" y="${y-24}" width="${Math.max(1,X(d.q3)-X(d.q1))}" height="48" fill="${c}" opacity=".35"/><path d="M${X(d.median)},${y-30} V${y+30}" stroke="${c}" stroke-width="5"/>`;});
        for(let i=0;i<=5;i++)s+=`<text x="${X(max*i/5)}" y="750" text-anchor="middle">${esc(fmt(max*i/5,2))}</text>`;
        figure(s+'</g></svg>',rows,headers,LABEL[m]);
      }else figure(null,rows,headers,LABEL[m]);
      note.textContent+=' Moments use denominator N. These boxes show the spatial distribution of forecast means and observations, not predictive-distribution uncertainty.';return;
    }
    if(m==='joint'){
      headers=['Model','Forecast bin lower ('+unit+')','Forecast bin upper','Observed bin lower','Observed bin upper','Cases'];
      const ed=e.edges_inch.map(v=>units.value==='in'?v:v*25.4);
      ids.forEach((id,i)=>{const matrix=e.models[id].joint_counts,max=Math.max(1,...matrix.flat()),cells=matrix.length,size=36;
        const frame=el('div',undefined,'vg-heatmap');frame.append(el('h4',MODELS[id]));
        let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="560" viewBox="0 0 640 560" role="img" aria-label="${esc(MODELS[id]+' joint histogram')}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="13">`;
        matrix.forEach((row,a)=>row.forEach((v,b)=>{rows.push([MODELS[id],ed[a],ed[a+1]??'∞',ed[b],ed[b+1]??'∞',v]);svg+=`<rect x="${90+b*size}" y="${450-(a+1)*size}" width="${size-1}" height="${size-1}" fill="${COLORS[i]}" opacity="${v?.15+.85*Math.log1p(v)/Math.log1p(max):.03}"><title>${v} cases; forecast ≥ ${ed[a]} ${unit}, observation ≥ ${ed[b]} ${unit}</title></rect>`;}));
        ed.forEach((v,j)=>{svg+=`<text x="${90+(j+.5)*size}" y="475" text-anchor="middle">${esc(fmt(v,2))}</text><text x="80" y="${450-(j+.5)*size+4}" text-anchor="end">${esc(fmt(v,2))}</text>`;});
        svg+='<text x="290" y="515" text-anchor="middle">Observed rainfall bin lower edge ('+unit+')</text><text transform="translate(24 260) rotate(-90)" text-anchor="middle">Forecast rainfall bin lower edge ('+unit+')</text></g></svg>';frame.insertAdjacentHTML('beforeend',svg);output.append(frame);
      });figure(null,rows,headers,LABEL[m]);note.textContent+=' Joint-histogram color uses log(1 + count); hover cells for exact counts. Last bin has no upper limit.';return;
    }
    if(m==='histogram'){
      const ed=e.edges_inch.map(v=>units.value==='in'?v:v*25.4);labels=ed.map(v=>fmt(v,2));headers=['Field','Lower ('+unit+')','Upper','Cases'];
      series=ids.map((id,i)=>({name:MODELS[id],color:COLORS[i],points:e.models[id].joint_counts.map((row,j)=>[j,row.reduce((a,b)=>a+b,0)])}));
      const matrix=e.models[ids[0]].joint_counts;series.push({name:'MRMS',color:'#596575',points:ed.map((_,j)=>[j,matrix.reduce((s,r)=>s+r[j],0)])});
      series.forEach(s=>s.points.forEach(([j,v])=>rows.push([s.name,ed[j],ed[j+1]??'∞',v])));xLabel='Rainfall bin lower edge ('+unit+')';yLabel='Matched grid cells';
     }else if(m==='conditional_quantile'){
      const id=diagnosticModel.value,bins=e.models[id].conditional_observation;kind='line';
      headers=['Model','Forecast bin lower ('+unit+')','Upper','Cases','Mean forecast','Observed Q10','Observed median','Observed Q90'];
      const keys=['y_q10','y_median','y_q90'];series=keys.map((key,i)=>({name:MODELS[id]+' '+['Q10','Median','Q90'][i],color:COLORS[i],dash:i===1?'':'12 8',points:bins.map(b=>[b.x_mean===null?null:b.x_mean/k,b[key]===null?null:b[key]/k])}));
      rows=bins.map(b=>[MODELS[id],b.lower/k,b.upper===null?'∞':b.upper/k,b.n,b.x_mean===null?null:b.x_mean/k,...keys.map(key=>b[key]===null?null:b[key]/k)]);
      xLabel='Forecast mean within rainfall bin ('+unit+')';yLabel='Observed conditional quantile ('+unit+')';
    }else if(m.startsWith('conditional_')){
      kind='line';headers=['Model','Condition bin lower ('+unit+')','Upper','Cases','Condition mean','Response mean','Response Q10','Response median','Response Q90'];
      series=ids.map((id,i)=>({name:MODELS[id],color:COLORS[i],points:e.models[id][m].map(b=>[b.x_mean===null?null:b.x_mean/k,b.y_mean===null?null:b.y_mean/k])}));
      ids.forEach(id=>e.models[id][m].forEach(b=>rows.push([MODELS[id],b.lower/k,b.upper===null?'∞':b.upper/k,b.n,...['x_mean','y_mean','y_q10','y_median','y_q90'].map(k2=>b[k2]===null?null:b[k2]/k)])));
      xLabel=(m==='conditional_observation'?'Forecast':'Observed')+' rainfall ('+unit+')';yLabel=(m==='conditional_observation'?'Observed':'Forecast')+' conditional mean ('+unit+')';
      note.textContent+=' Conditional quantiles (10%, median, 90%) are included in the table and CSV. Empty bins create gaps.';
    }else if(['reliability','sharpness','discrimination','roc'].includes(m)){
      headers=['Model','X','Y','Samples','Events'];labels=Array.from({length:10},(_,i)=>i*10+'–'+(i+1)*10);
      if(m==='roc'){
        kind='roc';xLabel='False-positive rate';yLabel='Probability of detection';headers=['Model','False-positive rate','Probability of detection','Hits','False alarms','Probability cutoff'];
        series=ids.map((id,i)=>{const roc=et?.models[id]?.roc??t.models[id].roc;if(!roc)throw Error('Exact ROC inputs for this model are not yet published.');roc.points.forEach(p=>rows.push([MODELS[id],...p]));return {name:MODELS[id],color:COLORS[i],points:roc.points.map(p=>[p[0],p[1]])};});
      }else if(m==='reliability'){
        kind='reliability';xLabel='Forecast probability';yLabel='Observed event frequency';series=ids.map((id,i)=>({name:MODELS[id],color:COLORS[i],points:t.models[id].bins.map(b=>[b.mean_probability,b.event_frequency])}));
        ids.forEach(id=>t.models[id].bins.forEach(b=>rows.push([MODELS[id],b.mean_probability,b.event_frequency,b.n,b.events])));
      }else if(m==='sharpness'){
        xLabel='Forecast-probability bin (%)';yLabel='Share of forecasts (%)';series=ids.map((id,i)=>({name:MODELS[id],color:COLORS[i],points:t.models[id].bins.map((b,j)=>[j,100*b.n/t.n_samples])}));
        ids.forEach(id=>t.models[id].bins.forEach(b=>rows.push([MODELS[id],b.lower,100*b.n/t.n_samples,b.n,b.events])));
      }else{
        kind='line';xLabel='Forecast probability (bin midpoint)';yLabel='Conditional share (%)';headers=['Model','Probability bin lower','Upper','P(bin | event)','P(bin | no event)','Events','Non-events'];
        series=ids.flatMap((id,i)=>{
          const bins=t.models[id].bins;bins.forEach(b=>rows.push([MODELS[id],b.lower,b.upper,ratio(b.events,t.n_events),ratio(b.n-b.events,t.n_samples-t.n_events),b.events,b.n-b.events]));
          return [{name:MODELS[id]+' event',color:COLORS[i],points:bins.map(b=>[(b.lower+b.upper)/2,t.n_events?100*b.events/t.n_events:null])},{name:MODELS[id]+' no event',color:COLORS[i],dash:'12 8',points:bins.map(b=>[(b.lower+b.upper)/2,t.n_samples>t.n_events?100*(b.n-b.events)/(t.n_samples-t.n_events):null])}];
        });
        note.textContent+=' Solid lines: probabilities conditional on observed events. Dashed lines: probabilities conditional on non-events. A missing event class is undefined.';
      }
    }else{
      const values=ids.map(id=>{
        if(cat){const c=rule.value==='amount'?et?.models[id]?.categorical_amount:fallback(t,id).categorical;return c?m==='contingency'?c:c[m]:null;}
        if(ranked)return rank.models[id]?.[m]??null;
        if(amount){const v=e?.models[id]?.[m]??(m==='mse'?scores.models[id].rmse**2:scores.models[id][m]);return finite(v)?v/(['mse','covariance'].includes(m)?k*k:['rmse','mae','bias'].includes(m)?k:1):null;}
        const p=et?.models[id]??fallback(t,id);return p[m]??null;
      });
      if(m==='contingency'){
        headers=['Model','Hits','False alarms','Misses','Correct rejections','Total'];rows=ids.map((id,i)=>[MODELS[id],...['hits','false_alarms','misses','correct_rejections','n'].map(k=>values[i]?.[k]??null)]);figure(null,rows,headers,LABEL[m]);
      }else{rows=ids.map((id,i)=>[MODELS[id],values[i]]);series=ids.map((id,i)=>({name:MODELS[id],color:COLORS[i],points:ids.map((_,j)=>[j,i===j?values[i]:null])}));}
      if(cat)note.textContent+=' Rule: '+(rule.value==='probability'?'forecast probability ≥ '+Number(cutoff.value)*100+'%; counts derived exactly at saved ten-bin boundaries.':'expected rainfall ≥ the stored rainfall threshold; paired data required.');
      if(['mse','covariance'].includes(m))yLabel+=' ('+unit+'²)';if(['rmse','mae','bias'].includes(m))yLabel+=' ('+unit+')';
      if(ranked)note.textContent+=' RPS uses all published ordered thresholds on their intersected common mask. Raw RPS sums boundary errors; normalized RPS divides by boundary count. Climatology references are explicitly separated.';
      if(['reliability_raw','resolution_raw','sanders_resolution','brier_bin_residual'].includes(m))note.textContent+=' Components use ten probability bins. Binning can leave a residual relative to the unbinned Brier score; this is shown explicitly.';
      if(m==='prediction_efficiency')note.textContent+=' Reference: constant mean observation for this matched sample, not an independent training climatology. Variance uses denominator N.';
      if(m==='pc')note.textContent+=' Percent correct can be high simply because non-events dominate; inspect CSI, POD, FAR and event counts together.';
      if(m==='vector_brier')note.textContent+=' This is twice the binary Brier score, matching the glossary’s two-category vector convention.';
      if(m==='contingency')return;
      if(!values.some(finite)){unavailable();return;}
    }
    figure(renderChart(series,kind,LABEL[m],xLabel,yLabel,labels),rows,headers,LABEL[m]);
  }
  function safeDisplay(){try{display();}catch(e){output.replaceChildren(el('p',e.message,'pending-box'));}}
  async function loadRun(){
    const ticket=++request;status.textContent='Loading matched verification data…';output.replaceChildren();extra=null;
    try{
      const record=catalog.runs.find(x=>x.initialization===init.value);
      const value=await fetchJSON(record.url,record.sha256);if(ticket!==request)return;
      if(value.initialization!==record.initialization||!Array.isArray(value.windows)||!Array.isArray(value.models))throw Error('Run identity differs');run=value;
      options(diagnosticModel,run.models.map(id=>[id,MODELS[id]||id]),diagnosticModel.value);
      const preferred=winSel.value;options(winSel,run.windows.map(w=>[w.id,(w.duration_hours??run.duration_hours)+' h · '+w.id+' · '+w.status]),preferred);
      const ts=run.windows.find(w=>w.status==='VERIFIED')?.scores.thresholds??[];options(threshold,ts.map(t=>[String(t.threshold_mm),fmt(t.threshold_mm/25.4,2)+' inches']),threshold.value);
      safeDisplay();
      try{
        const catalog2=await fetchJSON('data/verification/glossary_v1/catalog.json');
        if(catalog2.version!=='verification-glossary-v1')throw Error('Extension version differs');
        const r=catalog2.runs.find(x=>x.scope===scope.value&&x.initialization===record.initialization);
        if(r){const supplement=await fetchJSON(r.url,r.sha256);if(ticket!==request)return;if(supplement.source_run_sha256===record.sha256&&supplement.version==='verification-glossary-v1'&&supplement.scope===scope.value)extra=supplement;}
      }catch(e){/* Existing published statistics remain available while sidecars are queued. */}
      if(ticket===request)safeDisplay();
    }catch(e){if(ticket===request){run=null;status.textContent=e.message;}}
  }
  async function loadScope(){
    const ticket=++request;run=null;status.textContent='Loading comparison catalog…';output.replaceChildren();
    try{const value=await fetchJSON(prefix[scope.value]+'catalog.json');if(ticket!==request)return;catalog=value;
      if(value.schema_version!==1||!Array.isArray(value.runs))throw Error('Catalog identity differs');
      const expected=scope.value==='three'?'dated19-correct-censored-crps-1':'cnn24h_operational_comparison_v1';if(value.version!==expected)throw Error('Unsupported comparison version');
      value.runs.forEach(r=>{if(!/^20\d{6}12$/.test(r.initialization)||r.url!==prefix[scope.value]+'runs/'+r.initialization+'.json'||!/^[a-f0-9]{64}$/.test(r.sha256))throw Error('Catalog path differs');});
      options(init,value.runs.map(r=>[r.initialization,r.initialization.slice(0,4)+'-'+r.initialization.slice(4,6)+'-'+r.initialization.slice(6,8)+' 12 UTC']),init.value||new URLSearchParams(location.search).get('init'));
      if(!value.runs.length)throw Error('No published runs in this comparison.');await loadRun();
    }catch(e){if(ticket===request)status.textContent=e.message;}
  }
  scope.addEventListener('change',loadScope);init.addEventListener('change',loadRun);[winSel,metric,threshold,rule,cutoff,units,diagnosticModel].forEach(s=>s.addEventListener('change',safeDisplay));
  loadScope();
})(globalThis);
