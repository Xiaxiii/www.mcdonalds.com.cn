// 公开合成数据：规模与交互用例固定，不含社区预设或真实聊天内容。
module.exports = ({ size = 1200, groupSize = 100, prefix = 'perf', collapsed = true } = {}) => {
  const prompts = Array.from({ length: size }, (_, i) => ({
    identifier: `${prefix}-${i}`,
    name: i === size - 1 ? `性能条目 ${String(i).padStart(5, '0')} 自由思维链` : `性能条目 ${String(i).padStart(5, '0')}`,
    content: i === size - 1
      ? '<think>\n{{getvar::模块0}}\n</think>'
      : `{{addvar::模块${Math.floor(i / groupSize)}::规则 ${i}：这是用于验证大预设性能的公开合成内容。${'独立选项应当保留，正文不可因浏览和搜索改变。'.repeat(4)}${i === 37 ? ' body-only-needle ' : ''}}}`,
    role: 'system', injection_position: 0, injection_depth: 4
  }));
  const groups = Array.from({ length: Math.ceil(size / groupSize) }, (_, i) => ({
    id: `${prefix}-g${i}`, name: `性能分组 ${i}`, order: i, enabled: true, collapsed
  }));
  return {
    temperature: 0.73,
    prompts,
    prompt_order: [
      { character_id: 100001, order: prompts.map((p, i) => ({ identifier: p.identifier, enabled: i % 3 !== 1 })) },
      { character_id: 42, order: [{ identifier: prompts[0].identifier, enabled: false }] }
    ],
    extensions: {
      syntheticUnrelatedData: { preserve: ['公开测试数据', 42] },
      baibaiToolkit: { presetPromptGroups: { version: 1, groups, prompts: Object.fromEntries(prompts.map((p, i) => [p.identifier, { groupId: groups[Math.floor(i / groupSize)].id }])) } }
    }
  };
};
