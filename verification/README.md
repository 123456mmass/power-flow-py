# MATLAB verification

MATLAB is used only to generate or refresh neutral test fixtures.

Generate the first PF fixture from the sibling source repository:

```powershell
matlab -batch "cd('D:/Project/power-flow-py'); addpath('verification/matlab'); export_pf_oracle('verification/fixtures/matlab_pf_baseline.json','D:/Project/Power-flow')"
pytest tests/test_matlab_fixture.py
```

Every fixture records source commit, dirty working-tree status, MATLAB version, options, and equation-level arrays. Fixtures are test inputs only and are never imported by `src/power_flow`.
