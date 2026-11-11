const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..','src');
const code=['core/model.js','core/macros.js','core/cot.js','core/varrepair.js','core/smartgroup.js','core/suture.js','core/profile.js','core/presetscan.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
module.exports=new Function(code+'\nreturn {groupingSuggestions,planGroupingAssignments,groupTitleKey,separatorInfo,fragmentedGroups,planGroupGather,suggestGroups,variableRepairPlan,cotReadPlan,renameWritesPlan,applyWrapperNormalization,tagKey,sortTagIds,Draft,analyze,planHook,contentWithHook,applyHook,planItem,inferTarget,findInitEntry,profilePreset,describeEntry,entryHandles,listVarMacros,scanPresets,splitPresetName,hashStr};')();
