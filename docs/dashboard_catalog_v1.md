# GNN weather-hub catalog contract, version 1

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
