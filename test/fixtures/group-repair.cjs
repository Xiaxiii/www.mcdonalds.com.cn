// 合成的四段分区，覆盖交错分组、未分组条目、系统占位符和关闭状态。
module.exports = () => {
  const names = {
    init: '变量初始化', a1: '淡人特化', a2: 'char 主动', loose: '待归类条目',
    b1: '基础需求开始', a3: '禁止啰嗦', b2: '基础需求结束', a4: '旁白优化',
    chatHistory: '聊天记录', a5: '宠物参与生活', tail: '末尾规则'
  };
  const ids = Object.keys(names);
  return {
    prompts: ids.map(identifier => ({ identifier, name: names[identifier], role: 'system',
      marker: identifier === 'chatHistory', content: identifier === 'chatHistory' ? '' : `规则：${names[identifier]}` })),
    prompt_order: [
      { character_id: 100001, order: ids.map((identifier, index) => ({ identifier, enabled: !['a2', 'a4', 'b1'].includes(identifier), vendorHint: index })) },
      { character_id: 42, order: [...ids].reverse().map(identifier => ({ identifier, enabled: true })) }
    ],
    extensions: { baibaiToolkit: { presetPromptGroups: { version: 1,
      groups: [
        { id: 'a', name: '优化分区', order: 0, collapsed: false, enabled: true, foreign: 'keep-a' },
        { id: 'b', name: '基础需求 <分区>', order: 1, collapsed: false, enabled: false, restoreOn: ['b2'] },
        { id: 'empty', name: '空白分区', order: 2, anchor: 'loose', collapsed: true, enabled: true }
      ],
      prompts: Object.fromEntries(['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2'].map(id => [id, { groupId: id[0], foreign: id }]))
    } }, foreign: { keep: true } }
  };
};
