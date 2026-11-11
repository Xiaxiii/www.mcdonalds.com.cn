export const oai_settings = window.__mock.live;
export function getChatCompletionPreset(s) { return { prompts: s.prompts, prompt_order: s.prompt_order, extensions: s.extensions }; }
