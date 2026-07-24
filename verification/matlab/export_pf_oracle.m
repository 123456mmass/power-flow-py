function payload = export_pf_oracle(output_file, source_root)
%EXPORT_PF_ORACLE Export neutral PF verification data from the MATLAB baseline.
% Verification only: this file must never be placed on a Python runtime path.

if nargin < 1 || isempty(output_file)
    here=fileparts(mfilename('fullpath'));
    output_file=fullfile(fileparts(here),'fixtures','matlab_pf_baseline.json');
end
if ~is_absolute_path(output_file)
    output_file=fullfile(pwd,output_file);
end
if nargin < 2 || isempty(source_root)
    here=fileparts(mfilename('fullpath'));
    python_root=fileparts(fileparts(here));
    source_root=fullfile(fileparts(python_root),'Power-flow');
end

old_dir=pwd;
cleanup=onCleanup(@()cd(old_dir)); %#ok<NASGU>
cd(source_root);
pf_init_paths();

[~,commit]=system(sprintf('git -C "%s" rev-parse HEAD',source_root));
[~,git_status]=system(sprintf('git -C "%s" status --short',source_root));

opt=struct('verbose',false,'plot_results',false,'tolerance',1e-10, ...
    'max_iter',50,'enforce_q_limits',true);
cases_out=[one_case('ieee5',cases.case_ieee5bus(),opt); ...
           one_case('ieee14',cases.case_ieee14bus(),opt)];

payload=struct();
payload.schema='power-flow-py/matlab-pf-oracle/1.0';
payload.generated_at=char(datetime('now','TimeZone','UTC','Format','yyyy-MM-dd''T''HH:mm:ssXXX'));
payload.matlab_version=version;
payload.source_root=source_root;
payload.source_git_commit=strtrim(commit);
payload.source_git_status=git_status;
payload.options=opt;
payload.cases=cases_out;

parent=fileparts(output_file);
if ~exist(parent,'dir'), mkdir(parent); end
fid=fopen(output_file,'w');
if fid<0, error('export_pf_oracle:open','Cannot open %s.',output_file); end
file_cleanup=onCleanup(@()fclose(fid)); %#ok<NASGU>
fprintf(fid,'%s',jsonencode(payload,'PrettyPrint',true));
fprintf('Wrote MATLAB PF oracle: %s\n',output_file);
end

function out=one_case(case_id,case_data,opt)
r=pfsolver.powerflow_newton_raphson(case_data,opt);
m=pf_prepare_case(case_data);
x0=pf_initial_state(m);
[mismatch0,p0,q0,v0,a0]=pf_calculate_mismatch(x0,m);
j0=pf_build_jacobian(v0,a0,p0,q0,m);
out=struct('case_id',case_id,'converged',logical(r.converged), ...
    'reason',r.reason,'finite_status',r.finite_status, ...
    'iterations',r.iterations,'max_mismatch',r.max_mismatch, ...
    'bus_voltage',r.bus_voltage(:).','bus_angle_deg',r.bus_angle_deg(:).', ...
    'p_generation',r.P_generation(:).','q_generation',r.Q_generation(:).', ...
    'p_loss_total',r.P_loss_total,'q_loss_total',r.Q_loss_total, ...
    'mismatch_history',r.mismatch_history(:).', ...
    'ybus_real',real(r.Ybus),'ybus_imag',imag(r.Ybus), ...
    'initial_mismatch',mismatch0(:).','initial_jacobian',j0);
end

function tf=is_absolute_path(path_text)
if ispc
    tf=~isempty(regexp(path_text,'^[A-Za-z]:[\\/]','once')) || startsWith(path_text,'\\\\');
else
    tf=startsWith(path_text,'/');
end
end
