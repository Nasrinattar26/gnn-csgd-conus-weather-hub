HRRR GNN-CSGD CORE GRIB2 PACKAGE
Initialization: 2026091812. Research guidance, not official NCEP guidance.

20 windows: eight 6-hour, seven 12-hour, five 24-hour windows.
105 fields: 20 expected-precipitation fields + 85 fixed-threshold probability fields.
ARI EXCEEDANCE FIELDS AND ARI THRESHOLD GRIDS ARE NOT INCLUDED.
This core package is not the full 145-field map product set.

Expected precipitation: PDT 4.8, parameter 0/1/8 (APCP), kg m-2
(numerically equal to mm water equivalent). Sidecars identify it as a predictive mean.
Fixed thresholds: PDT 4.9, probabilityType=1, above upper threshold.
Probability DATA are percent; APCP thresholds use kg m-2.
Interpret the product template, not only a generic parameter units label.
Bitmap marks unavailable cells. Do not replace missing values with zero.
Missing centre/subcentre codes are intentional; producer provenance is in JSON.

Each file has a metadata JSON sidecar and a wgrib2 text inventory.
All fields were read back with ecCodes and compared with the audited NPZ.
Maximum permitted error: 0.0001 mm or percentage points.
The independent wgrib2 check inventories messages/thresholds; it does not
replace the ecCodes full-grid numerical comparison.
No forecast inference, website publication, or daily scheduling was performed.
