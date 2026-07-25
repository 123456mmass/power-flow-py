function payload=export_sssa_emf6_oracle(output_file,source_root)
%EXPORT_SSSA_EMF6_ORACLE Export operational EMF6 Kundur SSSA fixture.
if nargin<1 || isempty(output_file),error('export_sssa_emf6_oracle:output','Output required.');end
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
r=stability.synchronous_emf6_ssa(c,struct('load_model','cc_p_cz_q'));
payload=struct('schema','power-flow-py/matlab-emf6-sssa-oracle/1.0', ...
    'source_git_commit',strtrim(commit),'source_git_status',git_status, ...
    'case_id','kundur','load_model','cc_p_cz_q','state_names',{r.state_names}, ...
    'gen_buses',r.pf.external_bus_ids(r.units.bus_idx).', ...
    'x0',r.init.x0(:).','y0',r.init.y0(:).','Jxx',r.Jxx,'Jxy',r.Jxy, ...
    'Jyx',r.Jyx,'Jyy',r.Jyy,'Afull',r.Afull,'Ared',r.Ared, ...
    'eigen_real',real(r.eigenvalues(:)).','eigen_imag',imag(r.eigenvalues(:)).', ...
    'reduced_eigen_real',real(r.reduced_eigenvalues(:)).', ...
    'reduced_eigen_imag',imag(r.reduced_eigenvalues(:)).', ...
    'newton_iterations',r.newton_iterations,'newton_residual',r.newton_residual, ...
    'H_system',r.units.H_system(:).','D_system',r.units.D_system(:).', ...
    'coefficients',r.coefficients,'angle_shift_residual',r.angle_shift_residual);
parent=fileparts(output_file);if ~exist(parent,'dir'),mkdir(parent);end
fid=fopen(output_file,'w');if fid<0,error('export_sssa_emf6_oracle:open','Open failed.');end
file_cleanup=onCleanup(@()fclose(fid)); %#ok<NASGU>
fprintf(fid,'%s',jsonencode(payload,'PrettyPrint',true));
fprintf('Wrote EMF6 SSSA oracle: %s\n',output_file);
end

function tf=is_absolute_path(path_text)
if ispc
    tf=~isempty(regexp(path_text,'^[A-Za-z]:[\\/]','once')) || startsWith(path_text,'\\\\');
else
    tf=startsWith(path_text,'/');
end
end
