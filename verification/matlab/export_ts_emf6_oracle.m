function payload=export_ts_emf6_oracle(output_file,source_root)
%EXPORT_TS_EMF6_ORACLE Export a short Kundur EMF6 fault trajectory.
if nargin<1 || isempty(output_file)
    error('export_ts_emf6_oracle:output','An explicit output path is required.');
end
if ~is_absolute_path(output_file),output_file=fullfile(pwd,output_file);end
if nargin<2 || isempty(source_root)
    here=fileparts(mfilename('fullpath'));
    source_root=fullfile(fileparts(fileparts(fileparts(here))),'Power-flow');
end
old_dir=pwd;cleanup=onCleanup(@()cd(old_dir)); %#ok<NASGU>
cd(source_root);pf_init_paths();
[~,commit]=system(sprintf('git -C "%s" rev-parse HEAD',source_root));
[~,git_status]=system(sprintf('git -C "%s" status --short',source_root));
c=cases.kundur_ex126_book_case();
opt=struct('model','emf6','stepper','fixed','integrator','trapezoidal', ...
    't_end',0.02,'dt',0.005,'fault_bus',7,'t_fault',0.005,'t_clear',0.01, ...
    'Zf',0.1i,'corrector_mode','fixed','corrector_iter',3, ...
    'load_model','cc_p_cz_q','verbose',false);
r=stability.ts_simulate(c,opt);
payload=struct('schema','power-flow-py/matlab-emf6-ts-oracle/1.0', ...
    'source_git_commit',strtrim(commit),'source_git_status',git_status, ...
    'case_id','kundur','dt',opt.dt,'t_end',opt.t_end,'fault_bus',opt.fault_bus, ...
    't_fault',opt.t_fault,'t_clear',opt.t_clear,'fault_impedance_imag',imag(opt.Zf), ...
    't',r.t(:).','delta',r.delta, ...
    'omega',r.omega,'Pe_pu',r.Pe_pu,'Vbus',r.Vbus, ...
    'corrector_iterations',r.corrector_iterations(:).', ...
    'corrector_residual',r.corrector_residual(:).', ...
    'corrector_converged',r.corrector_converged(:).', ...
    'integrator_algebraic_residual',r.integrator_algebraic_residual(:).', ...
    'event_idx',r.event_idx(:).','event_side',r.event_side(:).', ...
    'initial_dae_residual',r.initial_dae_residual);
parent=fileparts(output_file);if ~exist(parent,'dir'),mkdir(parent);end
fid=fopen(output_file,'w');
if fid<0,error('export_ts_emf6_oracle:open','Cannot open %s.',output_file);end
file_cleanup=onCleanup(@()fclose(fid)); %#ok<NASGU>
fprintf(fid,'%s',jsonencode(payload,'PrettyPrint',true));
fprintf('Wrote EMF6 TS oracle: %s\n',output_file);
end

function tf=is_absolute_path(path_text)
if ispc
    tf=~isempty(regexp(path_text,'^[A-Za-z]:[\\/]','once')) || startsWith(path_text,'\\\\');
else
    tf=startsWith(path_text,'/');
end
end
