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
`export_sssa_emf6_oracle.m` freezes the Kundur EMF6 equilibrium, DAE Jacobian
blocks, Schur-complement matrices, and reduced spectrum. `export_ts_emf6_oracle.m`
freezes a short fault/clear trajectory and event-boundary evidence for the same DAE.
`export_sssa_padiyar_oracle.m` freezes both AVR and manual model-1.1 equation
sets, matrices, and physical spectra (gauge roots are checked structurally).
`export_ts_padiyar_oracle.m` freezes the AVR fault/clear state, voltage, power,
corrector, and algebraic-residual trajectories.
`export_ibr_reduced6_oracle.m` freezes both source-frozen reduced-six SMIB
devices: equilibrium/KCL, DAE blocks, Schur matrices, spectra, and coupled
implicit-trapezoidal equilibrium/perturbation trajectories.
