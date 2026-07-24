function payload=export_sssa_classical_oracle(output_file,source_root)
%EXPORT_SSSA_CLASSICAL_ORACLE Export classical SSSA differential fixtures.
if nargin<1 || isempty(output_file)
    error('export_sssa_classical_oracle:output','An explicit output path is required.');
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
opt=struct('model','classical','fd_eps',1e-6,'stability_tolerance',1e-7);
catalog=cases.network_case_catalog();
items=repmat(struct('case_id','','state_names',{{}},'gen_buses',[], ...
    'Afull',[],'Ared',[],'K_Pe_delta',[],'eigen_real',[],'eigen_imag',[], ...
    'reduced_eigen_real',[],'reduced_eigen_imag',[],'H',[],'D',[],'Xdp',[], ...
    'stability_status','','root_counts',struct()),numel(catalog),1);
for k=1:numel(catalog)
    r=stability.classical_sssa(catalog(k).loader(),opt);
    items(k)=struct('case_id',char(catalog(k).id),'state_names',{r.state_names}, ...
        'gen_buses',r.linearization.gen_buses(:).','Afull',r.Afull,'Ared',r.Ared, ...
        'K_Pe_delta',r.linearization.K_Pe_delta, ...
        'eigen_real',real(r.eigenvalues(:)).','eigen_imag',imag(r.eigenvalues(:)).', ...
        'reduced_eigen_real',real(r.reduced_eigenvalues(:)).', ...
        'reduced_eigen_imag',imag(r.reduced_eigenvalues(:)).', ...
        'H',r.linearization.H(:).','D',r.linearization.D(:).', ...
        'Xdp',r.linearization.Xdp(:).','stability_status',r.stability_status, ...
        'root_counts',r.root_counts);
end
payload=struct('schema','power-flow-py/matlab-classical-sssa-oracle/1.0', ...
    'source_git_commit',strtrim(commit),'source_git_status',git_status, ...
    'options',opt,'cases',items);
parent=fileparts(output_file);if ~exist(parent,'dir'),mkdir(parent);end
fid=fopen(output_file,'w');
if fid<0,error('export_sssa_classical_oracle:open','Cannot open %s.',output_file);end
file_cleanup=onCleanup(@()fclose(fid)); %#ok<NASGU>
fprintf(fid,'%s',jsonencode(payload,'PrettyPrint',true));
fprintf('Wrote classical SSSA oracle: %s\n',output_file);
end

function tf=is_absolute_path(path_text)
if ispc
    tf=~isempty(regexp(path_text,'^[A-Za-z]:[\\/]','once')) || startsWith(path_text,'\\\\');
else
    tf=startsWith(path_text,'/');
end
end
