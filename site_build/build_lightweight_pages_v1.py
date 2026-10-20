#!/usr/bin/env python3
"""Prepare a compact weather-hub Pages build without editing or publishing it.

  python 17_prepare_lightweight_pages_v1.py --prepare

Reads the existing Git-tracked website on alph. Copies its pages, assets and
verification data into a private preview, excluding products/. A narrowly scoped
browser router loads product images, animations and downloads from the same
public GitHub repository at the source commit. Catalogs and scientific scripts
remain unchanged. Existing product references must name tracked archive files.

Also prepares a sparse-checkout GitHub Actions workflow and its builder source
under repo_files/. Nothing is copied into the source checkout, committed, pushed,
deleted, or installed by this command. Private CNN backfill files are not uploaded
or added to the public catalogs. The source commit must be pushed before its
archive URLs can work on the public website.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from urllib.parse import urlsplit
from urllib.parse import quote
import urllib.request


ROOT = Path('/data/Nasrin/GNN_csgd_project')
REPOSITORY = 'Nasrinattar26/gnn-csgd-conus-weather-hub'
LIMIT = 900*1024*1024
BUILDER = 'site_build/build_lightweight_pages_v1.py'
ROUTER = 'assets/forecast-archive-router-v1.js'
WORKFLOW = '.github/workflows/pages-lite.yml'
MARKER = 'data/lightweight_pages_v1/deployment.json'
SITE = 'https://nasrinattar26.github.io/gnn-csgd-conus-weather-hub/'
EXTENSIONS = {'.html', '.css', '.js', '.json', '.geojson', '.csv', '.tsv',
              '.txt', '.md', '.png', '.gif', '.jpeg', '.jpg', '.webp', '.svg',
              '.ico', '.woff', '.woff2', '.ttf', '.xml', '.webmanifest'}

ROUTER_JS = r'''/* Weather-hub archive transport v1. Scientific catalogs are not rewritten. */
(() => {
  'use strict';
  if (window.weatherArchiveTransportV1) return;
  const script = document.currentScript;
  const site = new URL('../', script.src);
  const archive = new URL(script.dataset.archiveBase);
  if (archive.protocol !== 'https:' || archive.username || archive.password ||
      archive.search || archive.hash || !archive.pathname.endsWith('/')) {
    throw new Error('Invalid forecast archive configuration.');
  }
  const productPrefix = site.pathname + 'products/';
  const resolve = value => {
    let source;
    try { source = new URL(String(value), document.baseURI); }
    catch { return value; }
    if (source.origin !== site.origin || !source.pathname.startsWith(productPrefix)) return value;
    const relative = source.pathname.slice(site.pathname.length);
    const result = new URL(relative, archive);
    result.search = source.search;
    result.hash = source.hash;
    return result.href;
  };
  for (const [type, property] of [[HTMLImageElement, 'src'], [HTMLAnchorElement, 'href']]) {
    const descriptor = Object.getOwnPropertyDescriptor(type.prototype, property);
    if (!descriptor || !descriptor.set) throw new Error('Forecast archive transport is unsupported.');
    Object.defineProperty(type.prototype, property, {
      ...descriptor, set(value) { descriptor.set.call(this, resolve(value)); }
    });
  }
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    const key = String(name).toLowerCase();
    if ((this instanceof HTMLImageElement && key === 'src') ||
        (this instanceof HTMLAnchorElement && key === 'href')) value = resolve(value);
    return setAttribute.call(this, name, value);
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const original = input instanceof Request ? input.url : String(input);
    const destination = resolve(original);
    if (destination === original) return nativeFetch(input, options);
    const request = input instanceof Request ? new Request(destination, input) : destination;
    return nativeFetch(request, {...options, mode:'cors', credentials:'omit'});
  };
  // Static HTML attributes bypass JavaScript property setters during parsing.
  const fix = root => {
    const nodes = [];
    if (root instanceof Element && root.matches('img[src],a[href]')) nodes.push(root);
    if (root.querySelectorAll) nodes.push(...root.querySelectorAll('img[src],a[href]'));
    for (const node of nodes) {
      const key = node instanceof HTMLImageElement ? 'src' : 'href';
      const previous = node.getAttribute(key), next = resolve(previous);
      if (String(next) !== previous) setAttribute.call(node, key, next);
    }
  };
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) fix(node);
  }).observe(document.documentElement, {childList:true, subtree:true});
  fix(document);
  window.weatherArchiveTransportV1 = Object.freeze({resolve, archive:archive.href});
})();
'''

WORKFLOW_YAML = '''name: pages build and deployment
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
          sparse-checkout: |
            /*
            !/products/
          sparse-checkout-cone-mode: false
      - uses: actions/configure-pages@v5
      - name: Prepare and validate compact site
        run: python3 site_build/build_lightweight_pages_v1.py --ci-build --web . --output "$RUNNER_TEMP/weather-site" --ref "$GITHUB_SHA"
      - uses: actions/upload-pages-artifact@v4
        with:
          path: ${{ runner.temp }}/weather-site
  deploy:
    needs: build
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
'''


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def encode(value):
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False)+'\n').encode()


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def git(web, *args):
    result = subprocess.run(['git', '-C', str(web), *args], capture_output=True, timeout=60)
    need(result.returncode == 0, 'Git inspection failed: '+result.stderr.decode(errors='replace')[-1000:])
    return result.stdout


def archive_base(repository, revision, supplied=None):
    need(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository), 'Invalid archive repository')
    need(re.fullmatch(r'[a-f0-9]{40,64}', revision), 'Use the exact source Git commit')
    base = supplied or f'https://raw.githubusercontent.com/{repository}/{revision}/'
    parsed = urlsplit(base)
    need(parsed.scheme == 'https' and parsed.netloc and not parsed.username and not parsed.password
         and not parsed.query and not parsed.fragment and parsed.path.endswith('/')
         and '..' not in PurePosixPath(parsed.path).parts, 'Use an HTTPS archive URL ending in /')
    return base


def tracked_files(web):
    records = {}
    for record in git(web, 'ls-files', '--stage', '-z').split(b'\0'):
        if not record:
            continue
        meta, raw_name = record.split(b'\t', 1)
        mode, object_id, stage = meta.decode().split()
        name = raw_name.decode('utf-8')
        need(stage == '0', 'Resolve the Git merge conflict before preparing: '+name)
        path = PurePosixPath(name)
        need(not path.is_absolute() and '..' not in path.parts, 'Unsafe tracked path')
        records[name] = {'mode': mode, 'git_object_id': object_id}
    return records


def product_references(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from product_references(item)
    elif isinstance(value, list):
        for item in value:
            yield from product_references(item)
    elif isinstance(value, str) and value.startswith('products/'):
        yield value


def patch_html(text, relative_name, base):
    need('forecast-archive-router-v1' not in text, 'An archive transport is already present; review before replacing')
    head = re.search(r'<head(?:\s[^>]*)?>', text, re.I)
    need(head is not None, 'No HTML head in '+relative_name)
    depth = len(PurePosixPath(relative_name).parts)-1
    source = '../'*depth+ROUTER
    tag = '\n  <script src="'+source+'" data-archive-base="'+html.escape(base, quote=True)+'"></script>'
    return text[:head.end()]+tag+text[head.end():]


def prepare(web, destination, repository=REPOSITORY, revision=None, supplied_base=None,
            budget=LIMIT, export_sources=True):
    web, destination = web.resolve(), destination.resolve()
    need(web.is_dir(), 'Website checkout is missing')
    need(not destination.is_relative_to(web), 'Keep the prepared output outside the source checkout')
    need(not destination.exists(), 'Output already exists; preserved it: '+str(destination))
    need(not git(web, 'status', '--porcelain', '--untracked-files=no').strip(),
         'Website has tracked edits; finish the existing publication before preparing a snapshot')
    source_head = git(web, 'rev-parse', 'HEAD').decode().strip()
    need(revision is None or revision == source_head, 'Requested archive revision differs from the source checkout')
    base = archive_base(repository, source_head, supplied_base)
    tracked = tracked_files(web)
    site = destination/'site' if export_sources else destination
    site.mkdir(parents=True)
    references, copied, excluded = set(), {}, []
    archive_bytes_present = 0
    for name, record in sorted(tracked.items()):
        source = web/name
        if name.startswith('products/'):
            if source.is_file() and not source.is_symlink():
                archive_bytes_present += source.stat().st_size
            continue
        path = PurePosixPath(name)
        if path.parts[0].startswith('.') and name != '.nojekyll':
            excluded.append(name)
            continue
        if name not in ('.nojekyll', 'CNAME') and path.suffix.lower() not in EXTENSIONS:
            excluded.append(name)
            continue
        need(record['mode'] in ('100644', '100755') and not source.is_symlink(),
             'Pages source contains a link or unsupported mode: '+name)
        need(source.is_file() and source.resolve().is_relative_to(web), 'Missing included source file: '+name)
        raw = source.read_bytes()
        if name.endswith('.json'):
            references.update(product_references(json.loads(raw)))
        if name.endswith('.html'):
            raw = patch_html(raw.decode('utf-8'), name, base).encode()
        target = site/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        copied[name] = len(raw)
    need('index.html' in copied and 'model-comparison/index.html' in copied,
         'Expected weather-hub pages are missing')
    (site/ROUTER).parent.mkdir(parents=True, exist_ok=True)
    (site/ROUTER).write_text(ROUTER_JS)
    copied[ROUTER] = len(ROUTER_JS.encode())
    (site/'.nojekyll').touch()
    copied['.nojekyll'] = 0
    missing = sorted(path for path in references if path not in tracked or
                     tracked[path]['mode'] not in ('100644', '100755'))
    metadata = {'version': 'lightweight_pages_v1', 'source_commit': source_head,
                'repository': repository, 'archive_base': base,
                'product_references': len(references), 'missing_archive_references': len(missing),
                'archive_directory_in_pages': False}
    core_names = ('index.html', 'model-comparison/index.html', ROUTER,
                  'assets/gnn-app.js', 'assets/cnn-full-app-v1.js',
                  'assets/gnn-comparison-dated-v1.js', 'assets/cnn-four-system-comparison-v2.js',
                  'data/run_catalog.json', 'data/ero_catalog.json',
                  'data/cnn_full_v1/run_catalog.json', 'data/cnn_full_v1/ero_catalog.json',
                  'data/verification/dated_v1/catalog.json')
    metadata['verification_file_sha256'] = {name: sha(site/name) for name in core_names if name in copied}
    samples = []
    for extension in ('.png', '.gif', '.npz', '.nc', '.grib2', '.tar.gz'):
        candidates = sorted(name for name in references if name.endswith(extension) and name in tracked)
        if candidates:
            name = candidates[0]
            samples.append({'path': name, 'git_object_id': tracked[name]['git_object_id']})
    metadata['archive_samples'] = samples
    target = site/MARKER
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(encode(metadata))
    copied[MARKER] = target.stat().st_size
    site_bytes = sum(copied.values())
    report = dict(metadata, prepared_utc=datetime.now(timezone.utc).isoformat(),
                  source=str(web), site_directory=str(site), site_bytes=site_bytes,
                  deployment_budget_bytes=budget, within_budget=site_bytes <= budget,
                  tracked_product_bytes_present_locally=archive_bytes_present,
                  included_files=len(copied), excluded_nonproduct_files=excluded,
                  missing_archive_paths=missing,
                  status='READY_FOR_REVIEW' if site_bytes <= budget and not missing else 'NEEDS_REVIEW',
                  source_checkout_changed=False, private_backfill_uploaded=False,
                  site_published=False,
                  follow_up=['Push the exact archive commit before its URLs are used publicly.',
                             'Install the reviewed workflow and builder, then select GitHub Actions as the Pages source.',
                             'Publish validated new archive files separately, respecting GitHub push limits.',
                             'Use this script --verify-live for the split Pages/archive deployment.'])
    need(not git(web, 'status', '--porcelain', '--untracked-files=no').strip()
         and git(web, 'rev-parse', 'HEAD').decode().strip() == source_head,
         'Source changed while the preview was being prepared; do not publish this snapshot')
    if export_sources:
        exports = destination/'repo_files'
        for name, content in ((BUILDER, Path(__file__).read_bytes()),
                              (WORKFLOW, WORKFLOW_YAML.encode())):
            target = exports/name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        (destination/'report.json').write_bytes(encode(report))
    return report


def fetch_bytes(url):
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache',
                                                  'User-Agent': 'weather-hub-compact-pages-check/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read(101*1024*1024)
    need(len(content) <= 100*1024*1024, 'Verification file exceeded the Git file-size budget')
    return content


def verify_live(site=SITE):
    parsed = urlsplit(site)
    need(parsed.scheme == 'https' and parsed.netloc and not parsed.username and not parsed.password
         and not parsed.query and not parsed.fragment and site.endswith('/'), 'Invalid live site URL')
    marker = json.loads(fetch_bytes(site+MARKER))
    need(marker.get('version') == 'lightweight_pages_v1', 'Compact Pages deployment is not live yet')
    base = archive_base(marker['repository'], marker['source_commit'], marker['archive_base'])
    for name, expected in marker['verification_file_sha256'].items():
        need(not PurePosixPath(name).is_absolute() and '..' not in PurePosixPath(name).parts,
             'Invalid deployment verification path')
        need(hashlib.sha256(fetch_bytes(site+quote(name, safe='/'))).hexdigest() == expected,
             'Live Pages file differs: '+name)
    for sample in marker['archive_samples']:
        name = sample['path']
        need(name.startswith('products/') and '..' not in PurePosixPath(name).parts,
             'Invalid archive verification path')
        content = fetch_bytes(base+quote(name, safe='/'))
        identity = hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()
        need(identity == sample['git_object_id'], 'Live archive sample differs: '+name)
    print('LIVE VERIFIED: compact Pages files and '+str(len(marker['archive_samples']))+
          ' archive samples | '+site, flush=True)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--ci-build', action='store_true')
    parser.add_argument('--verify-live', action='store_true')
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--web', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--repository', default=REPOSITORY)
    parser.add_argument('--ref')
    parser.add_argument('--archive-base')
    args = parser.parse_args()
    if args.verify_live:
        return 0 if verify_live() else 2
    web = args.web or args.root/'hrrr_gnn_csgd_v1/github/gnn-csgd-conus-weather-hub'
    if args.ci_build:
        need(args.output is not None, '--ci-build requires --output')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    destination = args.output or args.root/'architecture_benchmark_v1/lightweight_pages_v1'/stamp
    report = prepare(web, destination, args.repository, args.ref, args.archive_base,
                     export_sources=not args.ci_build)
    compact = {key: report[key] for key in ('status', 'site_bytes', 'deployment_budget_bytes',
               'within_budget', 'included_files', 'product_references', 'missing_archive_references',
               'site_directory', 'source_checkout_changed', 'private_backfill_uploaded', 'site_published')}
    print('LIGHTWEIGHT PAGES CHECK: '+json.dumps(compact, sort_keys=True), flush=True)
    if not args.ci_build:
        print('REPORT: '+str(destination/'report.json'), flush=True)
        print('REVIEWED REPO FILES: '+str(destination/'repo_files'), flush=True)
    return 0 if report['status'] == 'READY_FOR_REVIEW' else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print('LIGHTWEIGHT PAGES STOP: '+str(error), file=sys.stderr, flush=True)
        raise SystemExit(1)
