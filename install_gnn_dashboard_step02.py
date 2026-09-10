#!/usr/bin/env python3
"""Install GNN dashboard step 02 into the existing starter repository.
Uses only the Python standard library and git. Never trains, deletes a model,
changes credentials, starts a job, commits, or pushes.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

DEFAULT_REPO = Path('/data/Nasrin/GNN_csgd_project/hrrr_gnn_csgd_v1/github/gnn-csgd-conus-weather-hub')
EXPECTED_REMOTE = 'git@github-alph:Nasrinattar26/gnn-csgd-conus-weather-hub.git'
STARTER_BLOB_SHA = '0ec03b72e66b6b37951624e73399e0d44505f241'

FILES = {
    'assets/gnn-app.js': r'''/* GNN dashboard step 02. Reads published catalogs; never fabricates forecasts. */
'use strict';
(() => {
  const base = new URL(document.body.dataset.siteRoot || './', location.href);
  const $ = id => document.getElementById(id);
  const durations = [6, 12, 24];
  const products = [
    {id:'expected_precip_mm', label:()=>'Expected precipitation', units:'mm'},
    {id:'prob_gt_12p7_mm', label:()=>'P(precipitation > 12.7 mm / 0.5 inch)', units:'percent'},
    {id:'prob_gt_25p4_mm', label:()=>'P(precipitation > 25.4 mm / 1 inch)', units:'percent'},
    {id:'prob_gt_50p8_mm', label:()=>'P(precipitation > 50.8 mm / 2 inches)', units:'percent'},
    {id:'prob_gt_2yr_ari', label:d=>`P(precipitation > local 2-year ${d}-h ARI)`, units:'percent'},
    {id:'prob_gt_5yr_ari', label:d=>`P(precipitation > local 5-year ${d}-h ARI)`, units:'percent'}
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
        need(product && product.units === e.units, 'Unexpected product or units.');
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
    const options = [...pairs].sort((a,b) => a[1][0]-b[1][0]).map(([key,[a,b]]) => [key,`${planned ? 'Planned · ' : ''}f${String(a).padStart(2,'0')}–f${String(b).padStart(2,'0')}`]);
    const old = $('map-window').value; replaceOptions('map-window',options,old);
    const product = $('map-product').value;
    replaceOptions('map-product',products.map(p=>[p.id,p.label(d)]),product);
    text('schedule-note',planned ? `Planned ${d}-hour schedule: ${options.length} windows through f48. These options are not evidence of published forecasts.` : 'Forecast windows listed here have at least one published product; missing product combinations are shown as unavailable.');
    renderForecast();
  }
  function clearMedia(imgId, linkId) {
    const img = $(imgId); if (img) { img.hidden = true; img.onload = null; img.onerror = null; img.removeAttribute('src'); }
    const link = $(linkId); if (link) { link.hidden = true; link.removeAttribute('href'); }
  }
  function showMapMessage(title, detail) {
    $('map-empty').hidden = false; text('map-empty-title',title); text('map-empty-text',detail);
  }
  function renderForecast() {
    const version = ++mapVersion; const av = ++animationVersion;
    clearMedia('forecast-map','open-map'); clearMedia('forecast-animation');
    $('download-links').replaceChildren(); $('downloads-empty').hidden = false;
    $('animation-empty').hidden = false;
    text('animation-empty','No matching animation has been published.');
    const d = Number($('map-duration').value);
    const [a,b] = $('map-window').value.split(':').map(Number);
    const product = products.find(p => p.id === $('map-product').value);
    const run = selectedRun();
    text('map-summary',`${d}-hour accumulation · forecast hours ${a}–${b}`);
    text('map-caption',`${product.label(d)} · ${product.units === 'mm' ? 'millimeters' : 'probability (%)'}`);
    text('map-validity',run ? `${utc(dateMS(run.init_utc)+a*3600000)} to ${utc(dateMS(run.init_utc)+b*3600000)}` : 'No valid period available until an initialization is published.');
    $('previous-window').disabled = $('map-window').selectedIndex <= 0;
    $('next-window').disabled = $('map-window').selectedIndex >= $('map-window').options.length-1;
    if (forecastError) {
      text('map-status','Catalog error'); showMapMessage('Forecast catalog could not be loaded',forecastError); return;
    }
    const e = run?.entries.find(e=>e.duration_hours===d && e.lead_start_hours===a && e.lead_end_hours===b && e.product===product.id);
    if (!e) {
      text('map-status',run ? 'Product unavailable' : 'No forecasts published');
      showMapMessage(run ? 'This product is not published for the selected window' : 'GNN forecast data are not published yet', 'The selectors are ready. No ANN forecasts or simulated maps are shown as GNN results.'); return;
    }
    const image = $('forecast-map'); const src = siteURL(e.image);
    text('map-status','Loading map'); showMapMessage('Loading published forecast…','Checking the selected map file.');
    image.alt = `${product.label(d)}; HRRR GNN-CSGD; ${d}-hour accumulation; initialized ${utc(run.init_utc)}; forecast hours ${a}–${b}; CONUS 0.25-degree grid.`;
    image.onload = () => { if (version !== mapVersion) return; $('map-empty').hidden=true; image.hidden=false; $('open-map').href=src; $('open-map').hidden=false; text('map-status','Published map'); };
    image.onerror = () => { if (version !== mapVersion) return; clearMedia('forecast-map','open-map'); text('map-status','Map file unavailable'); showMapMessage('The catalog entry exists, but its map could not be loaded','The previous map is not displayed as a substitute.'); };
    image.src = src;
    for (const file of e.downloads || []) {
      const link=document.createElement('a'); link.textContent=file.label; link.href=siteURL(file.href); link.className='button'; link.target='_blank'; link.rel='noopener'; $('download-links').append(link);
    }
    $('downloads-empty').hidden = (e.downloads || []).length>0;
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
    text('comparison-empty-text',comparisonError || 'Raw HRRR, ANN-CSGD, and GNN-CSGD scores must use common verification cases before a comparison is published.');
    text('comparison-status',comparisonError?'Catalog error':e?'Loading figure':'Results pending');
    text('comparison-caption',`${d}-hour accumulation · CONUS · ${$('cmp-grid').selectedOptions[0].textContent} · ${$('cmp-metric').selectedOptions[0].textContent}${threshold===null?'':` · > ${threshold} mm`}`);
    if(!e||comparisonError)return;
    text('comparison-empty-title','Loading comparison figure…');text('comparison-empty-text','Checking the published figure.');
    const image=$('comparison-image'),src=siteURL(e.image); image.alt=e.caption;
    image.onload=()=>{if(v!==comparisonVersion)return;$('comparison-empty').hidden=true;image.hidden=false;$('open-comparison').href=src;$('open-comparison').hidden=false;text('comparison-status','Published comparison');text('comparison-caption',`${e.caption} | ${e.period_label} | Sample: ${e.sample_id}${e.reference?` | Reference: ${e.reference}`:''}`);};
    image.onerror=()=>{if(v!==comparisonVersion)return;clearMedia('comparison-image','open-comparison');text('comparison-status','Figure unavailable');text('comparison-empty-title','The comparison image could not be loaded');text('comparison-empty-text','No other figure is substituted.');};
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
      text('status-badge',runs.length?'Published forecast catalog available':'Under development — no forecasts published');
      text('latest-init',runs.length?utc(runs[0].init_utc):'No published initialization');
      text('run-note',runs.length?`${runs.length} initialization(s) with published entries. Availability varies by duration and product.`:'Training checkpoints are not forecasts. Real-time inference and publication are the next data steps.');
    }catch(error){forecastError=error.message;text('status-badge','Forecast catalog error');$('status-badge').classList.add('error');text('run-note',forecastError);}
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
''',
    'assets/gnn-style.css': r''':root{--navy:#0b2044;--blue:#174a97;--teal:#117b7a;--accent:#a7edc8;--ink:#172b43;--muted:#5a6d82;--line:#dce5ef;--bg:#f2f6fa;--panel:#fff;--raw:#1d4ed8;--ann:#c62828;--gnn:#17813b;--shadow:0 8px 25px rgba(10,35,70,.055)}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:90px}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-width:320px}a{color:var(--blue)}button,select{font:inherit}button,select,.button{min-height:42px}button,.button{border:1px solid var(--line);border-radius:9px;background:white;color:var(--ink);padding:8px 14px;font-weight:650;cursor:pointer;text-decoration:none}button:hover:not(:disabled),.button:hover{border-color:var(--teal)}:disabled{cursor:not-allowed;opacity:.65}a:focus-visible,button:focus-visible,select:focus-visible{outline:3px solid #dd9b00;outline-offset:3px}[hidden]{display:none!important}h1,h2,h3,p{overflow-wrap:anywhere}h1,h2,h3{line-height:1.2}h2{font-size:1.5rem;margin:0 0 12px}h3{font-size:1.06rem;margin:0 0 8px}p{margin:0 0 16px}img{max-width:100%;height:auto}.skip{position:absolute;left:15px;top:-60px;z-index:50;padding:8px;background:white}.skip:focus{top:8px}
.topbar{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}.nav-inner{max-width:1392px;margin:auto;display:flex;justify-content:space-between;align-items:center;padding:14px 24px;gap:18px;flex-wrap:wrap}.brand{font-weight:800;text-decoration:none;color:var(--navy);font-size:1.08rem}.brand span{color:var(--gnn)}.nav-links{display:flex;gap:22px;flex-wrap:wrap}.nav-links a{text-decoration:none;font-size:.9rem;font-weight:650;color:var(--muted)}.nav-links a[aria-current=page]{color:var(--gnn)}
.hero{color:white;background:radial-gradient(ellipse at 85% 10%,rgba(16,180,168,.24),transparent 52%),linear-gradient(118deg,var(--navy),#173d7b 62%,#11636d);padding:44px 24px 62px}.hero-inner{max-width:1312px;margin:auto;display:grid;grid-template-columns:minmax(0,1.65fr) minmax(250px,.85fr);align-items:center;gap:38px}.eyebrow{font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:var(--accent);margin:0 0 14px}.hero h1{font-size:clamp(2.2rem,4.1vw,3.5rem);letter-spacing:-.035em;margin:0 0 18px}.hero h1 span{display:block;font-weight:500;font-size:.7em;margin-top:8px}.hero-description{color:#dfebfb;font-size:1.03rem;max-width:780px}.hero-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.hero-actions .button{background:var(--accent);color:var(--navy);border:none;font-size:.87rem}.badge{display:inline-block;max-width:100%;border:1px solid currentColor;border-radius:30px;padding:5px 11px;font-weight:650;font-size:.76rem}.hero .badge{color:#e0f7eb}.run-card{padding:24px;border:1px solid #ffffff30;border-radius:17px;background:#ffffff0b}.small-label{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:var(--muted)}.run-card .small-label{color:#c7ddf3}.run-card>strong{display:block;font-size:1.28rem;margin:6px 0 10px}.run-card p{font-size:.85rem;color:#dceafa}.stats{display:grid;grid-template-columns:1fr 1fr;gap:14px;border-top:1px solid #ffffff28;padding-top:16px}.stats strong{display:block;font-size:.98rem}
.layout{max-width:1392px;margin:-24px auto 45px;padding:0 24px;display:grid;grid-template-columns:234px minmax(0,1fr);gap:22px;position:relative}.panel{background:var(--panel);border:1px solid var(--line);border-radius:17px;padding:25px;box-shadow:var(--shadow);min-width:0}.sidebar{position:sticky;top:88px;align-self:start;padding:22px 16px}.sidebar h2{font-size:1.08rem;padding:0 8px}.side-links{display:grid;gap:4px;margin:17px 0}.side-links a{padding:9px 10px;border-radius:9px;text-decoration:none;font-size:.88rem;font-weight:650;color:var(--muted)}.side-links a:hover,.side-links a.active{color:var(--teal);background:#edf8f5}.side-note{border-top:1px solid var(--line);padding:16px 8px 0;font-size:.79rem;color:var(--muted)}.side-note p{margin:7px 0}.content{display:grid;gap:22px;min-width:0}.section-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.section-head .badge{color:var(--teal);white-space:nowrap}.section-intro{color:var(--muted);font-size:.9rem}.controls{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0}.controls label{display:grid;gap:5px;font-size:.8rem;font-weight:650;min-width:0}.controls select{width:100%;min-width:0;border:1px solid #bfcddd;border-radius:9px;background:white;color:var(--ink);padding:9px 12px}.map-navigation{display:flex;justify-content:space-between;gap:10px;align-items:center;margin:14px 0}.selection-summary{text-align:center;color:var(--muted);font-size:.8rem}.map-shell{margin:0;overflow:hidden;border:1px solid var(--line);border-radius:12px;background:#fff}.map-shell img{width:100%;display:block}.empty-state{display:grid;place-content:center;text-align:center;min-height:300px;padding:28px;background:linear-gradient(145deg,#f8fbfe,#edf5f8);border:none}.empty-mark{display:grid;place-items:center;width:54px;height:54px;margin:0 auto 14px;border:1px solid #a4c9d2;border-radius:15px;color:var(--teal);font-weight:800;font-size:1.4rem}.empty-state strong{font-size:1.12rem}.empty-state p{max-width:540px;margin:9px auto 0;color:var(--muted);font-size:.88rem}.figure-meta{padding:14px 16px;border-top:1px solid var(--line);font-size:.8rem;display:flex;gap:14px;justify-content:space-between;flex-wrap:wrap}.figure-meta p{margin:0}.figure-meta a{font-weight:700}.note{font-size:.8rem;color:var(--muted);margin:14px 0 0}.pending-box{padding:20px;border-radius:12px;background:#f7fafc;border:1px dashed #ccd9e7;color:var(--muted);font-size:.9rem}.metric-grid,.model-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin:18px 0}.model-card{border:1px solid var(--line);border-top:3px solid var(--model-color);padding:16px;border-radius:11px;background:#fbfcfe}.model-card h3{color:var(--model-color)}.model-card p{font-size:.78rem;color:var(--muted);margin:0}.raw{--model-color:var(--raw)}.ann{--model-color:var(--ann)}.gnn{--model-color:var(--gnn)}.metric-card{padding:17px;border:1px solid var(--line);border-radius:10px}.metric-card strong{font-size:.86rem;display:block}.metric-card span{font-size:.78rem;color:var(--muted)}.method-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}.method-grid div{padding:15px;background:#eff8f5;border-radius:10px;font-size:.79rem}.method-grid strong{display:block;color:var(--teal);margin-bottom:7px}.method-grid span{color:var(--muted)}.download-links{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}.download-links a{font-size:.85rem}.compare-layout{grid-template-columns:minmax(0,1fr)}.compare-layout .content{max-width:1140px;width:100%;margin:auto}.compare-controls{grid-template-columns:repeat(4,minmax(0,1fr))}.compare-empty{min-height:230px}.footer{max-width:1344px;margin:auto;padding:0 24px 28px;color:var(--muted);font-size:.77rem}.footer div{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap}.error{color:#a51e2e!important}.noscript{padding:18px;background:#fff1ce;color:#422a00}
@media(max-width:1020px){.layout{grid-template-columns:195px minmax(0,1fr)}.compare-layout{grid-template-columns:1fr}.sidebar{padding:18px 10px}.hero-inner{gap:22px}.panel{padding:20px}.method-grid,.metric-grid{grid-template-columns:1fr 1fr}.compare-controls{grid-template-columns:1fr 1fr}.nav-links{gap:14px}}
@media(max-width:760px){.topbar{position:static}.nav-inner{padding:13px 16px;gap:8px}.nav-links{gap:15px}.nav-links a{font-size:.78rem}.hero{padding:30px 18px 43px}.hero-inner{grid-template-columns:1fr}.run-card{padding:18px}.layout{grid-template-columns:1fr;padding:0 14px;gap:16px}.sidebar{position:static;padding:16px}.sidebar h2,.side-note{display:none}.side-links{display:flex;flex-wrap:wrap;margin:0;gap:5px}.side-links a{font-size:.79rem;padding:6px 9px}.panel{padding:19px}.section-head{flex-wrap:wrap;gap:5px}.section-head h2{font-size:1.35rem}.model-grid{grid-template-columns:1fr}.map-navigation{flex-wrap:wrap}.selection-summary{order:3;width:100%}.map-navigation button{font-size:.77rem}.empty-state{min-height:250px}.hero h1{font-size:2.35rem}.method-grid{grid-template-columns:1fr 1fr}}
@media(max-width:400px){.controls,.compare-controls{grid-template-columns:1fr}.method-grid,.metric-grid{grid-template-columns:1fr}.hero h1{font-size:2.1rem}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
''',
    'data/comparison_catalog.json': r'''{
  "schema_version": 1,
  "models": ["raw_hrrr", "ann_csgd", "gnn_csgd"],
  "grids": [{"id": "ann025_conus", "label": "Common 0.25° grid"}],
  "entries": []
}
''',
    'data/run_catalog.json': r'''{
  "schema_version": 1,
  "model_id": "hrrr_gnn_csgd",
  "domain": "CONUS",
  "grid_id": "ann025_conus",
  "grid_resolution_degrees": 0.25,
  "updated_utc": null,
  "runs": []
}
''',
    'docs/dashboard_catalog_v1.md': r'''# GNN weather-hub catalog contract, version 1

This is a new website-facing interface, not an existing HRRR/ANN exporter.
The HPC publication adapter must translate real GNN outputs into this contract.
Installing the interface does not run inference, verify forecasts, or publish model results.
Both delivered catalogs are intentionally empty.

## Forecast catalog

File: `data/run_catalog.json`.
Top-level fields: `schema_version: 1`, `model_id: "hrrr_gnn_csgd"`,
`domain: "CONUS"`, `grid_id: "ann025_conus"`,
`grid_resolution_degrees: 0.25`, `updated_utc` (ISO UTC or null), `runs` (array).

Each run contains:

- `init_utc`: an ISO UTC timestamp, such as `YYYY-MM-DDTHH:MM:SSZ`.
- `entries`: zero or more published map entries. Initializations without entries are not offered as forecasts.

Each map entry contains:

- `duration_hours`: 6, 12, or 24.
- `lead_start_hours` and `lead_end_hours`: integer hours; their difference equals the duration.
  Windows start every 6 hours, are nonnegative, and end no later than f48.
- `domain`: `CONUS`; `grid_id`: `ann025_conus`.
- `product`: one of the product IDs below.
- `units`: `mm` for expected precipitation or `percent` for probability-map legends.
- `image`: path to the real, published PNG, relative to the website root.
- Optional `animation`: path to a real GIF for this initialization, duration, and product.
- Optional `downloads`: array of objects with `label` and `href`.

Supported product IDs:

- `expected_precip_mm`
- `prob_gt_12p7_mm`
- `prob_gt_25p4_mm`
- `prob_gt_50p8_mm`
- `prob_gt_2yr_ari`
- `prob_gt_5yr_ari`

Fixed thresholds mean precipitation strictly greater than the stated amount during the selected accumulation period.
ARI products must use the corresponding accumulation duration; a 24-h threshold is not a 6-h or 12-h threshold.
This catalog serves rendered maps, not probability arrays. Convert probability fractions to percent in the plotting/export adapter where needed.
All image/download paths resolve inside this GNN website. Cross-site URLs, external model archives, and credentials are not accepted.

The website derives valid start/end timestamps by adding lead hours to the initialization.
The publisher must verify these against the actual source metadata before adding an entry.
An entry must represent the GNN model named by the catalog, not a relabeled ANN forecast.
The web interface checks schema and file loading, not scientific correctness of upstream processing.

With no data, the interface shows the planned 8/7/5 windows for 6/12/24 h and labels them as planned.
A missing map never falls back to a different window, initialization, or model.

## Comparison catalog

File: `data/comparison_catalog.json`.
Top-level fields: `schema_version: 1`, `models`, `grids`, `entries`.
Model IDs are `raw_hrrr`, `ann_csgd`, and `gnn_csgd`.
Each grid object has an `id` and a human-readable `label`.

Each comparison entry contains:

- `duration_hours`: 6, 12, or 24.
- `domain`: `CONUS`.
- `grid_id`: one of the declared grids.
- `metric`: `bss`, `crps`, `roc_auc`, or `reliability`.
- `threshold_mm`: 12.7, 25.4, or 50.8; use null for CRPS.
- `models`: all three model IDs exactly once.
- `sample_id`: identifier of the audited common verification sample.
- `period_label`: human-readable evaluation period.
- `caption`: interpretation-neutral figure description.
- `reference`: mandatory nonempty description for BSS, optional for other metrics.
- `image`: path to the real comparison figure, relative to website root.

Version 1 allows one figure per duration/grid/metric/threshold combination.
Figures can show scores by forecast window. There is not yet a UI for selecting multiple test periods or individual comparison lead windows.
The publisher is responsible for matching observations, units, initialization/valid periods, masks,
model versions, and scoring references. Equal sample counts alone do not prove equal samples.
No scores or skill rankings are fabricated when entries are absent.

To add a resolution later, publish genuinely matched comparison outputs, add a grid object,
and reference that grid in the comparison entries. The selector only chooses published products;
it does not regrid data, retrain a model, or increase the model's effective resolution.

## Boundaries of this installation

Only the GNN dashboard HTML, CSS, JavaScript, and empty catalogs are installed.
ANN sites, training scripts, checkpoints, source arrays, and HPC running processes are unchanged.
No background jobs are added. NetCDF/GRIB2 production and verification remain separate pipeline tasks.

Implementation references:
- https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
''',
    'index.html': r'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="HRRR-based GNN-CSGD precipitation research dashboard. Forecast products and matched verification are being connected.">
  <title>CONUS Weather Hub | HRRR GNN-CSGD</title>
  <link rel="stylesheet" href="assets/gnn-style.css?v=step02-1">
  <script src="assets/gnn-app.js?v=step02-1" defer></script>
</head>
<body data-page="forecasts" data-site-root="./">
  <a class="skip" href="#main">Skip to main content</a>
  <nav class="topbar" aria-label="Primary navigation">
    <div class="nav-inner">
      <a class="brand" href="index.html"><span>GNN-CSGD</span> Weather Hub</a>
      <div class="nav-links">
        <a href="index.html#forecast-workspace" aria-current="page">Forecasts</a>
        <a href="index.html#verification">Verification</a>
        <a href="model-comparison/" >Model Comparison</a>
        <a href="index.html#downloads">Downloads</a>
        <a href="index.html#method">Method</a>
      </div>
    </div>
  </nav>
  <header class="hero">
    <div class="hero-inner">
      <div>
        <p class="eyebrow">HRRR-based probabilistic precipitation research</p>
        <h1>HRRR GNN-CSGD<span>CONUS Weather Hub</span></h1>
        <p class="hero-description">Separate 6-, 12-, and 24-hour precipitation models combine HRRR predictors,
        GraphSAGE spatial learning, and censored shifted Gamma distributions.</p>
        <div class="hero-actions">
          <span class="badge" id="status-badge" role="status">Checking published forecast catalog…</span>
          <a class="button" href="model-comparison/">Compare forecast systems</a>
        </div>
      </div>
      <aside class="run-card">
        <span class="small-label">Latest published GNN initialization</span>
        <strong id="latest-init">Not available yet</strong>
        <p id="run-note">Training checkpoints are not forecast products. Only published forecast entries appear here.</p>
        <div class="stats">
          <div><span class="small-label">Accumulations</span><strong>6 / 12 / 24 h</strong></div>
          <div><span class="small-label">Output grid</span><strong>0.25° · CONUS</strong></div>
        </div>
      </aside>
    </div>
  </header>
  <noscript><p class="noscript">Enable JavaScript to use the catalog and forecast selectors. No forecast is displayed without a matching published entry.</p></noscript>
  <main id="main" class="layout">
    <aside class="sidebar panel">
      <h2>Forecast workspace</h2>
      <nav class="side-links" aria-label="Dashboard sections">
        <a class="active" href="#forecast-workspace">01 &nbsp; Forecast maps</a>
        <a href="#animations">02 &nbsp; Animations</a>
        <a href="#downloads">03 &nbsp; Downloads</a>
        <a href="#verification">04 &nbsp; Verification</a>
        <a href="model-comparison/">05 &nbsp; Model comparison</a>
        <a href="#method">06 &nbsp; Method</a>
      </nav>
      <div class="side-note"><span class="small-label">Publication status</span>
      <p>The interface is ready to receive products. Available initializations, maps, and files are read from the GNN catalog.</p>
      <p>No ANN maps or demonstration forecasts are substituted.</p></div>
    </aside>
    <div class="content">
      <section class="panel" id="forecast-workspace">
        <div class="section-head"><h2>GNN-CSGD forecast maps</h2><span class="badge" id="map-status">Catalog pending</span></div>
        <p class="section-intro">Choose an initialization, accumulation duration, forecast window, and product. All valid times are UTC.</p>
        <div class="controls">
          <label>Initialization (UTC)<select id="map-init" disabled><option>No published initializations</option></select></label>
          <label>Accumulation duration<select id="map-duration"><option value="6">6-hour</option><option value="12" selected>12-hour</option><option value="24">24-hour</option></select></label>
          <label>Forecast window<select id="map-window" aria-describedby="schedule-note"></select></label>
          <label>Forecast product<select id="map-product"></select></label>
        </div>
        <div class="map-navigation">
          <button type="button" id="previous-window">← Previous window</button>
          <span id="map-summary" class="selection-summary" aria-live="polite">Select a window</span>
          <button type="button" id="next-window">Next window →</button>
        </div>
        <figure class="map-shell">
          <div id="map-empty" class="empty-state" role="status"><span class="empty-mark" aria-hidden="true">G</span><strong id="map-empty-title">GNN forecast data are not published yet</strong><p id="map-empty-text">The controls show the planned forecast schedule. No map is being simulated.</p></div>
          <img id="forecast-map" alt="" hidden>
          <figcaption class="figure-meta"><div><p id="map-caption">Expected precipitation is in millimeters; exceedance probabilities are in percent.</p><p id="map-validity">No valid period available until an initialization is published.</p></div><a id="open-map" target="_blank" rel="noopener" hidden>Open full-resolution image ↗</a></figcaption>
        </figure>
        <p class="note" id="schedule-note">Preview of planned windows only; forecasts are not available yet.</p>
      </section>
      <section class="panel" id="animations">
        <h2>Forecast animations</h2>
        <p class="section-intro">Animations use the selected initialization, duration, and product above.</p>
        <p id="animation-empty" class="pending-box">No matching animation has been published.</p>
        <img id="forecast-animation" alt="" hidden>
      </section>
      <section class="panel" id="downloads">
        <h2>Forecast downloads</h2>
        <p class="section-intro">Files for the selected forecast window will appear when they are published. Training weights and source arrays are not exposed.</p>
        <p class="pending-box" id="downloads-empty">No NetCDF or GRIB2 download is available for this selection.</p>
        <div id="download-links" class="download-links"></div>
      </section>
      <section class="panel" id="verification">
        <div class="section-head"><h2>Held-out verification</h2><span class="badge">Results pending</span></div>
        <p class="section-intro">GNN test results have not been connected to this dashboard. Training and validation losses are not displayed as test skill.</p>
        <div class="metric-grid">
          <div class="metric-card"><strong>CRPS / CRPSS</strong><span>Full predictive distribution</span></div>
          <div class="metric-card"><strong>Brier Score / BSS</strong><span>Threshold probabilities</span></div>
          <div class="metric-card"><strong>ROC / reliability</strong><span>Discrimination and calibration</span></div>
        </div>
        <a class="button" href="model-comparison/">Open Raw HRRR · ANN-CSGD · GNN-CSGD comparison</a>
      </section>
      <section class="panel" id="method">
        <h2>How GNN-CSGD works</h2>
        <p class="section-intro">A shared spatial graph supports three separately trained duration models.</p>
        <div class="method-grid">
          <div><strong>1. HRRR predictors</strong><span>12 duration-specific features per land node.</span></div>
          <div><strong>2. GraphSAGE</strong><span>Learned aggregation across the 8-neighbor land graph.</span></div>
          <div><strong>3. CSGD parameters</strong><span>Shape, scale, and nonpositive shift define a marginal distribution at each node.</span></div>
          <div><strong>4. Forecast products</strong><span>Expected precipitation and exceedance probabilities from each distribution.</span></div>
        </div>
        <p class="note">Current graph: 13,318 land nodes. A finer display image is not a higher-resolution model. Spatial message passing does not by itself produce a joint space-time ensemble.</p>
      </section>
    </div>
  </main>
  <footer class="footer"><div><span>Nasrin Attar · HRRR GNN-CSGD research dashboard</span><span>Not official forecast guidance · Interface step 02</span></div></footer>
</body>
</html>
''',
    'model-comparison/index.html': r'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="HRRR-based GNN-CSGD precipitation research dashboard. Forecast products and matched verification are being connected.">
  <title>Model Comparison | HRRR GNN-CSGD</title>
  <link rel="stylesheet" href="../assets/gnn-style.css?v=step02-1">
  <script src="../assets/gnn-app.js?v=step02-1" defer></script>
</head>
<body data-page="comparison" data-site-root="../">
  <a class="skip" href="#main">Skip to main content</a>
  <nav class="topbar" aria-label="Primary navigation">
    <div class="nav-inner">
      <a class="brand" href="../index.html"><span>GNN-CSGD</span> Weather Hub</a>
      <div class="nav-links">
        <a href="../index.html#forecast-workspace" >Forecasts</a>
        <a href="../index.html#verification">Verification</a>
        <a href="../model-comparison/" aria-current="page">Model Comparison</a>
        <a href="../index.html#downloads">Downloads</a>
        <a href="../index.html#method">Method</a>
      </div>
    </div>
  </nav>
  <header class="hero">
    <div class="hero-inner">
      <div>
        <p class="eyebrow">HRRR-based probabilistic precipitation research</p>
        <h1>HRRR GNN-CSGD<span>Model Comparison</span></h1>
        <p class="hero-description">Separate 6-, 12-, and 24-hour precipitation models combine HRRR predictors,
        GraphSAGE spatial learning, and censored shifted Gamma distributions.</p>
        <div class="hero-actions">
          <span class="badge" id="status-badge" role="status">Checking published forecast catalog…</span>
          <a class="button" href="../index.html#forecast-workspace">Open forecast workspace</a>
        </div>
      </div>
      <aside class="run-card">
        <span class="small-label">Latest published GNN initialization</span>
        <strong id="latest-init">Not available yet</strong>
        <p id="run-note">Training checkpoints are not forecast products. Only published forecast entries appear here.</p>
        <div class="stats">
          <div><span class="small-label">Accumulations</span><strong>6 / 12 / 24 h</strong></div>
          <div><span class="small-label">Output grid</span><strong>0.25° · CONUS</strong></div>
        </div>
      </aside>
    </div>
  </header>
  <noscript><p class="noscript">Enable JavaScript to use the catalog and forecast selectors. No forecast is displayed without a matching published entry.</p></noscript>
  <main id="main" class="layout compare-layout">
    <div class="content">
      <section class="panel">
        <div class="section-head"><h2>Raw HRRR · ANN-CSGD · GNN-CSGD</h2><span class="badge" id="comparison-status">Checking catalog</span></div>
        <p class="section-intro">Results will be shown only for a declared common sample and verification grid. No model rankings are inferred from the interface.</p>
        <div class="model-grid">
          <article class="model-card raw"><h3>Raw HRRR</h3><p>Deterministic baseline. Thresholding one HRRR field produces 0/1 event forecasts, not ensemble probabilities.</p></article>
          <article class="model-card ann"><h3>ANN-CSGD</h3><p>Pointwise neural postprocessing using the corresponding HRRR accumulation and predictors.</p></article>
          <article class="model-card gnn"><h3>GNN-CSGD</h3><p>Graph-based postprocessing with learned neighboring-node information.</p></article>
        </div>
        <div class="controls compare-controls">
          <label>Accumulation duration<select id="cmp-duration"><option value="6">6-hour</option><option value="12" selected>12-hour</option><option value="24">24-hour</option></select></label>
          <label>Verification resolution<select id="cmp-grid"><option value="ann025_conus">Common 0.25° grid</option></select></label>
          <label>Metric<select id="cmp-metric"><option value="bss">Brier Skill Score</option><option value="crps">CRPS</option><option value="roc_auc">ROC AUC</option><option value="reliability">Reliability</option></select></label>
          <label>Precipitation threshold<select id="cmp-threshold"><option value="12.7">12.7 mm / 0.5 inch</option><option value="25.4">25.4 mm / 1 inch</option><option value="50.8">50.8 mm / 2 inches</option></select></label>
        </div>
        <figure class="map-shell">
          <div class="empty-state compare-empty" id="comparison-empty" role="status"><span class="empty-mark" aria-hidden="true">≈</span><strong id="comparison-empty-title">Matched verification results are not published yet</strong><p id="comparison-empty-text">The three-system comparison will be connected after GNN test inference and common-sample checks.</p></div>
          <img id="comparison-image" alt="" hidden>
          <figcaption class="figure-meta"><p id="comparison-caption">Select a duration, metric, and threshold. No scores are currently available.</p><a id="open-comparison" target="_blank" rel="noopener" hidden>Open comparison image ↗</a></figcaption>
        </figure>
        <p class="note">Resolution options can be extended after matched outputs and observations exist at those resolutions. This selector does not regrid forecasts or create higher-resolution predictions.</p>
      </section>
      <section class="panel"><h2>Comparison requirements</h2><p class="section-intro">Each published comparison must identify its accumulation duration, valid periods, spatial mask, grid, model versions, and scoring reference. The catalog records the shared sample identifier and evaluation period alongside the figure.</p><a href="../index.html#forecast-workspace">← Return to GNN forecasts</a></section>
    </div>
  </main>
  <footer class="footer"><div><span>Nasrin Attar · HRRR GNN-CSGD research dashboard</span><span>Not official forecast guidance · Interface step 02</span></div></footer>
</body>
</html>
''',
}


def git(repo, *args):
    result = subprocess.run(
        ['git', '-C', str(repo), *args], text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60,
    )
    if result.returncode:
        raise RuntimeError('Git check failed: ' + ' '.join(args) + '\n' + result.stderr.strip())
    return result.stdout.strip()


def install(repo):
    repo = repo.expanduser().resolve()
    if not (repo / '.git').is_dir():
        raise RuntimeError('Expected a local Git repository at ' + str(repo))
    if Path(git(repo, 'rev-parse', '--show-toplevel')).resolve() != repo:
        raise RuntimeError('Refusing to install inside a different repository.')
    remote = git(repo, 'remote', 'get-url', '--push', 'origin')
    if remote != EXPECTED_REMOTE:
        raise RuntimeError('Unexpected repository push destination. No files changed.')
    if git(repo, 'branch', '--show-current') != 'main':
        raise RuntimeError('Switch to main before installing. No files changed.')
    if git(repo, 'status', '--porcelain'):
        raise RuntimeError('Working tree is not clean. Preserve your changes; do not delete them. No files changed.')
    if git(repo, 'rev-parse', 'HEAD') != git(repo, 'rev-parse', 'origin/main'):
        raise RuntimeError('Local main and origin/main differ. Synchronize without force-pushing before installing.')
    # Only the exact starter page inspected in GitHub is replaceable.
    if git(repo, 'hash-object', 'index.html') != STARTER_BLOB_SHA:
        if all((repo / name).is_file() and (repo / name).read_text(encoding='utf-8') == content
               for name, content in FILES.items()):
            print('ALREADY INSTALLED: dashboard step 02. No changes made.')
            return
        raise RuntimeError('The homepage changed since the starter commit. Stopping to avoid overwriting new work.')
    for name in FILES:
        target = repo / name
        if target.is_symlink() or any(p.is_symlink() for p in target.parents if p != repo.parent):
            raise RuntimeError('Refusing to write through a symbolic link: ' + str(target))
        if name != 'index.html' and target.exists():
            raise RuntimeError('A new dashboard path already exists: ' + name + '. No files changed.')
    for name, content in FILES.items():
        if name.endswith('.json'):
            json.loads(content)
    # Backup lives outside the published Git repository and contains no credentials.
    backup_root = repo.parent.parent / 'backups'
    backup_root.mkdir(parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix='web_step02_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '_', dir=backup_root))
    shutil.copy2(repo / 'index.html', backup / 'index.html')
    (backup / 'manifest.json').write_text(json.dumps({
        'original_commit': git(repo, 'rev-parse', 'HEAD'),
        'files_to_install': sorted(FILES),
        'created_utc': datetime.now(timezone.utc).isoformat(),
    }, indent=2) + '\n', encoding='utf-8')
    changed = []
    try:
        # Supporting assets first; homepage last.
        ordered = [x for x in FILES if x != 'index.html'] + ['index.html']
        for name in ordered:
            target = repo / name
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = None
            try:
                with tempfile.NamedTemporaryFile('w', encoding='utf-8', newline='\n', dir=target.parent, delete=False) as handle:
                    tmp = Path(handle.name)
                    handle.write(FILES[name])
                os.chmod(tmp, 0o644)
                os.replace(tmp, target)
                changed.append(name)
            finally:
                if tmp is not None and tmp.exists():
                    tmp.unlink()
        for name, content in FILES.items():
            if (repo / name).read_text(encoding='utf-8') != content:
                raise RuntimeError('Post-install content check failed: ' + name)
        git(repo, 'diff', '--check')
    except Exception:
        for name in reversed(changed):
            target = repo / name
            if name == 'index.html':
                shutil.copy2(backup / 'index.html', target)
            else:
                target.unlink(missing_ok=True)
        raise
    print('==================== SEND THIS PART ====================')
    print('DASHBOARD INSTALL: PASS')
    print('Repository:', repo)
    print('Homepage backup:', backup / 'index.html')
    print('Files installed:', len(FILES))
    for name in FILES:
        print('  ' + name)
    print('Published forecast entries: 0 (intentional)')
    print('Published comparison entries: 0 (intentional)')
    print('Training / model files changed: NONE')
    print('Existing ANN websites changed: NONE')
    print('Commit / push: not performed by installer')
    print('================== END SEND THIS PART ==================')


def main():
    parser = argparse.ArgumentParser(description='Install the first catalog-driven GNN dashboard; no training or credential changes.')
    parser.add_argument('--repo', type=Path, default=DEFAULT_REPO)
    args = parser.parse_args()
    try:
        install(args.repo)
    except Exception as exc:
        print('STOP:', str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
