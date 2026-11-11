module.exports = () => ({
  prompts: ['night', 'day', 'random', 'extra1', 'extra2'].map((id, i) => ({ identifier: id, name: ['夜间模式', '日间模式', '随机小剧场', '额外一', '额外二'][i], content: `规则 ${id}`, role: 'system' })),
  prompt_order: [{ character_id: 100001, order: ['night', 'day', 'random', 'extra1', 'extra2'].map(id => ({ identifier: id, enabled: id === 'night' })) }],
  extensions: { baibaiToolkit: { presetPromptGroups: { version: 1, groups: [
    { id: 'theater', name: '小剧场', enabled: true, collapsed: false },
    { id: 'extras', name: '额外模块', enabled: true, collapsed: false }
  ], prompts: Object.fromEntries(['night', 'day', 'random', 'extra1', 'extra2'].map(id => [id, { groupId: id.startsWith('extra') ? 'extras' : 'theater' }])) } } }
});
