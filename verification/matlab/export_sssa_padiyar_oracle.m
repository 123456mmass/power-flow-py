function payload=export_sssa_padiyar_oracle(output_file,source_root)
%EXPORT_SSSA_PADIYAR_ORACLE Export AVR and manual model-1.1 SSSA evidence.
if nargin<1 || isempty(output_file),error('export_sssa_padiyar_oracle:output','Output required.');end
if ~is_absolute_path(output_file),output_file=fullfile(pwd,output_file);end
if nargin<2 || isempty(source_root)
    here=fileparts(mfilename('fullpath'));
    source_root=fullfile(fileparts(fileparts(fileparts(here))),'Power-flow');
end
old_dir=pwd;cleanup=onCleanup(@()cd(old_dir)); %#ok<NASGU>
cd(source_root);pf_init_paths();
[~,commit]=system(sprintf('git -C "%s" rev-parse HEAD',source_root));
[~,git_status]=system(sprintf('git -C "%s" status --short',source_root));
c=cases.case_padiyar_two_area_4m_avr(); names={'avr','manual'};
items=repmat(struct('excitation','','state_names',{{}},'gen_buses',[], ...
    'x0',[],'y0',[],'Jxx',[],'Jxy',[],'Jyx',[],'Jyy',[],'Afull',[], ...
    'eigen_real',[],'eigen_imag',[],'newton_iterations',0, ...
    'initial_residual',0,'H',[],'D',[],'angle_shift_residual',0),2,1);
for k=1:2
    r=stability.padiyar_model11_ssa(c,struct('excitation',names{k},'fd_eps',1e-6));
    items(k)=struct('excitation',names{k},'state_names',{r.state_names}, ...
        'gen_buses',r.dae.gen_buses(:).','x0',r.dae.x0(:).','y0',r.dae.y0(:).', ...
        'Jxx',r.Jxx,'Jxy',r.Jxy,'Jyx',r.Jyx,'Jyy',r.Jyy,'Afull',r.Afull, ...
        'eigen_real',real(r.eigenvalues(:)).','eigen_imag',imag(r.eigenvalues(:)).', ...
        'newton_iterations',r.dae.init.newton_iterations, ...
        'initial_residual',r.initial_residual,'H',r.dae.units.H(:).', ...
        'D',r.dae.units.D(:).','angle_shift_residual',r.angle_shift_residual);
end
payload=struct('schema','power-flow-py/matlab-padiyar-sssa-oracle/1.0', ...
    'source_git_commit',strtrim(commit),'source_git_status',git_status, ...
    'case_id','padiyar_two_area','fd_eps',1e-6,'cases',items);
parent=fileparts(output_file);if ~exist(parent,'dir'),mkdir(parent);end
fid=fopen(output_file,'w');if fid<0,error('export_sssa_padiyar_oracle:open','Open failed.');end
file_cleanup=onCleanup(@()fclose(fid)); %#ok<NASGU>
fprintf(fid,'%s',jsonencode(payload,'PrettyPrint',true));
fprintf('Wrote Padiyar SSSA oracle: %s\n',output_file);
end

function tf=is_absolute_path(path_text)
if ispc
    tf=~isempty(regexp(path_text,'^[A-Za-z]:[\\/]','once')) || startsWith(path_text,'\\\\');
else
    tf=startsWith(path_text,'/');
end
end
