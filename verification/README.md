# MATLAB verification

MATLAB is used only to generate or refresh neutral test fixtures.

Generate the first PF fixture from the sibling source repository:

```powershell
matlab -batch "cd('D:/Project/power-flow-py'); addpath('verification/matlab'); export_pf_oracle('verification/fixtures/matlab_pf_baseline.json','D:/Project/Power-flow')"
pytest tests/test_matlab_fixture.py
```

Every fixture records source commit, dirty working-tree status, MATLAB version, options, and equation-level arrays. Fixtures are test inputs only and are never imported by `src/power_flow`.

`export_network_catalog.m` snapshots only active `power_case/1.0` input data into
the packaged static catalog; it does not export a solved state. `export_pf_catalog_oracle.m`
separately creates the verification-only differential fixture for all 14 cases.
`export_sssa_classical_oracle.m` freezes matrices, machine parameters, spectra,
and classifications for the classical SSSA route.
`export_ts_classical_oracle.m` freezes short fault trajectories for all three
fixed-step classical integrators. The clear-time recorder discrepancy is documented
in the numerical contract and asserted explicitly by the Python differential test.
