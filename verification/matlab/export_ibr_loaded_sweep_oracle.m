function payload=export_ibr_loaded_sweep_oracle(output_file,source_root)
%EXPORT_IBR_LOADED_SWEEP_ORACLE Export loaded-SMIB equilibrium/SSSA sweeps.
if nargin<1 || isempty(output_file),error('export_ibr_loaded_sweep_oracle:output','Output required.');end
if ~is_absolute_path(output_file),output_file=fullfile(pwd,output_file);end
if nargin<2 || isempty(source_root)
    here=fileparts(mfilename('fullpath'));
    source_root=fullfile(fileparts(fileparts(fileparts(here))),'Power-flow');
end
old_dir=pwd;cleanup=onCleanup(@()cd(old_dir)); %#ok<NASGU>
cd(source_root);pf_init_paths();
[~,commit]=system(sprintf('git -C "%s" rev-parse HEAD',source_root));
[~,git_status]=system(sprintf('git -C "%s" status --short',source_root));
loaders={@cases.case_ibr_smib_loaded_gfl_rms10,@cases.case_ibr_smib_loaded_gfm_no_pll};
ids={'gfl_rms10_loaded_smib','gfm_no_pll_loaded_smib'};
case_items=cell(2,1); percentages=[0 20 40 60 80];
for cidx=1:2
    c=loaders{cidx}();
    r=stability.sssa_load_sweep(c,struct('sssa_load_percentages',percentages, ...
        'sssa_save_plots',false,'case_id',ids{cidx}));
    point_items=cell(numel(percentages),1);
    for k=1:numel(percentages)
        p=r.sssa_load_sweep.points{k}; e=p.equilibrium; s=p.sssa;
        point_items{k}=struct('load_percentage',p.load_percentage,'alpha',p.alpha, ...
            'P_load',s.P_load,'Q_load',s.Q_load,'iterations',e.iterations, ...
            'residual_norm',e.residual_norm,'state_names',{s.state_names}, ...
            'x0',e.x0(:).','y0',e.y0(:).','u0',e.u_eq(:).', ...
            'f0',s.f0(:).','g0',s.g0(:).','fx',s.fx,'fy',s.fy, ...
            'gx',s.gx,'gy',s.gy,'A',s.A, ...
            'eigen_real',real(s.eigenvalues(:)).','eigen_imag',imag(s.eigenvalues(:)).');
    end
    case_items{cidx}=struct('case_id',ids{cidx}, ...
        'kind',c.smib_loaded_ibr.kind,'system_name',c.system_name, ...
        'load_percentages',percentages,'points',[point_items{:}]);
end
payload=struct('schema','power-flow-py/matlab-ibr-loaded-sweep-oracle/1.0', ...
    'source_git_commit',strtrim(commit),'source_git_status',git_status, ...
    'classification','ASSUMED_DIAGNOSTIC_SOURCE_FROZEN_FIXTURE', ...
    'cases',[case_items{:}]);
parent=fileparts(output_file);if ~exist(parent,'dir'),mkdir(parent);end
fid=fopen(output_file,'w');if fid<0,error('export_ibr_loaded_sweep_oracle:open','Open failed.');end
file_cleanup=onCleanup(@()fclose(fid)); %#ok<NASGU>
fprintf(fid,'%s',jsonencode(payload,'PrettyPrint',true));
fprintf('Wrote loaded-SMIB sweep oracle: %s\n',output_file);
end

function tf=is_absolute_path(path_text)
if ispc
    tf=~isempty(regexp(path_text,'^[A-Za-z]:[\\/]','once')) || startsWith(path_text,'\\\\');
else
    tf=startsWith(path_text,'/');
end
end
