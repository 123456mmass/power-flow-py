function payload=export_network_catalog(output_file,source_root)
%EXPORT_NETWORK_CATALOG Snapshot active power_case/1.0 input data.
% This is a development-time porting adapter. It exports case inputs only;
% no solved state or numerical result is used by the Python runtime.

if nargin<1 || isempty(output_file)
    error('export_network_catalog:output','An explicit output path is required.');
end
if ~is_absolute_path(output_file), output_file=fullfile(pwd,output_file); end
if nargin<2 || isempty(source_root)
    here=fileparts(mfilename('fullpath'));
    source_root=fullfile(fileparts(fileparts(fileparts(here))),'Power-flow');
end
old_dir=pwd; cleanup=onCleanup(@()cd(old_dir)); %#ok<NASGU>
cd(source_root); pf_init_paths();
[~,commit]=system(sprintf('git -C "%s" rev-parse HEAD',source_root));
[~,git_status]=system(sprintf('git -C "%s" status --short',source_root));

catalog=cases.network_case_catalog();
items=repmat(struct('id','','system_name','','base_values',struct(), ...
    'bus_data',[],'line_data',[],'machines',struct(),'source_loader',''),numel(catalog),1);
for k=1:numel(catalog)
    c=catalog(k).loader();
    b=c.base_values;
    items(k).id=char(catalog(k).id);
    items(k).system_name=char(c.system_name);
    items(k).base_values=struct( ...
        'S_base_MVA',field_or(b,'S_base_MVA',100), ...
        'V_base_kV',field_or(b,'V_base_kV',0), ...
        'frequency_Hz',field_or(b,'frequency_Hz',60));
    items(k).bus_data=c.bus_data;
    items(k).line_data=c.line_data;
    if isfield(c,'machines'),items(k).machines=c.machines;end
    items(k).source_loader=func2str(catalog(k).loader);
end
payload=struct('schema','power-flow-py/network-catalog/1.0', ...
    'source_git_commit',strtrim(commit),'source_git_status',git_status,'cases',items);
parent=fileparts(output_file); if ~exist(parent,'dir'),mkdir(parent);end
fid=fopen(output_file,'w');
if fid<0,error('export_network_catalog:open','Cannot open %s.',output_file);end
file_cleanup=onCleanup(@()fclose(fid)); %#ok<NASGU>
fprintf(fid,'%s',jsonencode(payload,'PrettyPrint',true));
fprintf('Wrote network catalog: %s\n',output_file);
end

function value=field_or(s,name,fallback)
if isfield(s,name) && ~isempty(s.(name)),value=s.(name);else,value=fallback;end
end

function tf=is_absolute_path(path_text)
if ispc
    tf=~isempty(regexp(path_text,'^[A-Za-z]:[\\/]','once')) || startsWith(path_text,'\\\\');
else
    tf=startsWith(path_text,'/');
end
end
