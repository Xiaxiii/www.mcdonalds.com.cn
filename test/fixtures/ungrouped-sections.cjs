// 按截图可见的名称和边界构造的合成输入；正文为测试文本，不是真实预设。
module.exports = () => {
  const items = [
    ['panel', '↓ 一键开关 ↓', '开关区说明'.repeat(25)],
    ['repeat', '☂ 抗重复优化', '{{setvar::重复检查::开}}'],
    ['base-switch', '基础需求-一键开关', '{{setvar::基础需求::开}}'],
    ['opt-switch', '优化分区-一键开关', '{{setvar::优化分区::开}}'],
    ['emotion-switch', '情感扫描-一键开关', '{{setvar::情感扫描::开}}'],
    ['nsfw-switch', 'NSFW-一键开关', '{{setvar::成人分区::开}}'],
    ['note-switch', '耶和华手记-一键开关', '{{setvar::手记::开}}'],
    ['function-switch', '功能分区-一键开关', '{{setvar::功能分区::开}}'],
    ['divider', '———·★+°☾+♥·+✶———', ''],
    ['cot', '思维链区', '只供测试的思考区内容'],
    ['base', '基本设定', '基础需求分区中的已有规则'],
    ['style', '优化规则', '{{setvar::写作风格::已有文字}}'],
    ['style2', '优化规则二', '{{setvar::写作风格::另一段文字}}'],
    ['loose-prefix', '【基础需求分区】新增规则', '待归组的规则正文'],
    ['loose-variable', '新文风', '{{setvar::写作风格::新的规则正文}}'],
    ['unknown', '没有分区标记的条目', '无法凭结构判断属于哪个分区'],
    ['chatHistory', '聊天记录', '']
  ];
  return {
    prompts: items.map(([identifier, name, content]) => ({ identifier, name, content, role: 'system', marker: identifier === 'chatHistory' })),
    prompt_order: [{ character_id: 100001, order: items.map(([identifier]) => ({ identifier, enabled: identifier !== 'emotion-switch' })) }],
    extensions: { baibaiToolkit: { presetPromptGroups: { version: 1,
      groups: [{ id: 'cot-group', name: '思维链区', order: 0 }, { id: 'base-group', name: '基础需求分区', order: 1 }, { id: 'opt-group', name: '优化分区', order: 2 }],
      prompts: { cot: { groupId: 'cot-group' }, base: { groupId: 'base-group' }, style: { groupId: 'opt-group' }, style2: { groupId: 'opt-group' } }
    } } }
  };
};
