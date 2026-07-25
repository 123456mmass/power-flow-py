function payload=export_ts_classical_oracle(output_file,source_root)
%EXPORT_TS_CLASSICAL_ORACLE Export short fault trajectories for fixed integrators.
if nargin<1 || isempty(output_file)
    error('export_ts_classical_oracle:output','An explicit output path is required.');
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
names={'trapezoidal','rk4','backward_euler'};
items=repmat(struct('integrator','','t',[],'delta',[],'omega',[], ...
    'Pe_pu',[],'Vbus',[],'corrector_iterations',[], ...
    'corrector_residual',[],'corrector_converged',[]),numel(names),1);
c=cases.case_matpower6_case14();
for k=1:numel(names)
    opt=struct('model','classical','stepper','fixed','integrator',names{k}, ...
        't_end',0.12,'dt',0.01,'fault_bus',4,'t_fault',0.05,'t_clear',0.10, ...
        'Zf',0.1i,'pm_mode','pgaz','corrector_mode','adaptive', ...
        'max_corrector_iter',10,'corrector_abs_tol',1e-10, ...
        'corrector_rel_tol',1e-8,'verbose',false);
    r=stability.ts_simulate(c,opt);
    items(k)=struct('integrator',names{k},'t',r.t(:).', ...
        'delta',r.delta,'omega',r.omega,'Pe_pu',r.Pe_pu,'Vbus',r.Vbus, ...
        'corrector_iterations',r.corrector_iterations(:).', ...
        'corrector_residual',r.corrector_residual(:).', ...
        'corrector_converged',r.corrector_converged(:).');
end
payload=struct('schema','power-flow-py/matlab-classical-ts-oracle/1.0', ...
    'source_git_commit',strtrim(commit),'source_git_status',git_status, ...
    'case_id','matpower14','cases',items);
parent=fileparts(output_file);if ~exist(parent,'dir'),mkdir(parent);end
fid=fopen(output_file,'w');
if fid<0,error('export_ts_classical_oracle:open','Cannot open %s.',output_file);end
file_cleanup=onCleanup(@()fclose(fid)); %#ok<NASGU>
fprintf(fid,'%s',jsonencode(payload,'PrettyPrint',true));
fprintf('Wrote classical TS oracle: %s\n',output_file);
end

function tf=is_absolute_path(path_text)
if ispc
    tf=~isempty(regexp(path_text,'^[A-Za-z]:[\\/]','once')) || startsWith(path_text,'\\\\');
else
    tf=startsWith(path_text,'/');
end
end
