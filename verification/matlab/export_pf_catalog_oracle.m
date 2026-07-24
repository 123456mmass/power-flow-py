function payload=export_pf_catalog_oracle(output_file,source_root)
%EXPORT_PF_CATALOG_ORACLE Export NR results for every active network case.
if nargin<1 || isempty(output_file)
    error('export_pf_catalog_oracle:output','An explicit output path is required.');
end
if ~is_absolute_path(output_file),output_file=fullfile(pwd,output_file);end
if nargin<2 || isempty(source_root)
    here=fileparts(mfilename('fullpath'));
    source_root=fullfile(fileparts(fileparts(fileparts(here))),'Power-flow');
end
old_dir=pwd; cleanup=onCleanup(@()cd(old_dir)); %#ok<NASGU>
cd(source_root);pf_init_paths();
[~,commit]=system(sprintf('git -C "%s" rev-parse HEAD',source_root));
[~,git_status]=system(sprintf('git -C "%s" status --short',source_root));
opt=struct('verbose',false,'plot_results',false,'tolerance',1e-10, ...
    'max_iter',50,'enforce_q_limits',false);
catalog=cases.network_case_catalog();
items=repmat(struct('case_id','','converged',false,'iterations',0, ...
    'max_mismatch',0,'bus_voltage',[],'bus_angle_deg',[], ...
    'p_generation',[],'q_generation',[],'p_loss_total',0,'q_loss_total',0), ...
    numel(catalog),1);
for k=1:numel(catalog)
    r=pfsolver.powerflow_newton_raphson(catalog(k).loader(),opt);
    items(k)=struct('case_id',char(catalog(k).id),'converged',logical(r.converged), ...
        'iterations',r.iterations,'max_mismatch',r.max_mismatch, ...
        'bus_voltage',r.bus_voltage(:).','bus_angle_deg',r.bus_angle_deg(:).', ...
        'p_generation',r.P_generation(:).','q_generation',r.Q_generation(:).', ...
        'p_loss_total',r.P_loss_total,'q_loss_total',r.Q_loss_total);
end
payload=struct('schema','power-flow-py/matlab-pf-catalog-oracle/1.0', ...
    'source_git_commit',strtrim(commit),'source_git_status',git_status, ...
    'options',opt,'cases',items);
parent=fileparts(output_file);if ~exist(parent,'dir'),mkdir(parent);end
fid=fopen(output_file,'w');
if fid<0,error('export_pf_catalog_oracle:open','Cannot open %s.',output_file);end
file_cleanup=onCleanup(@()fclose(fid)); %#ok<NASGU>
fprintf(fid,'%s',jsonencode(payload,'PrettyPrint',true));
fprintf('Wrote PF catalog oracle: %s\n',output_file);
end

function tf=is_absolute_path(path_text)
if ispc
    tf=~isempty(regexp(path_text,'^[A-Za-z]:[\\/]','once')) || startsWith(path_text,'\\\\');
else
    tf=startsWith(path_text,'/');
end
end
