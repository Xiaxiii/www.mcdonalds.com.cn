export const world_names = ["示例世界书", "空白世界书"];
const store = globalThis.__wiStore ||= {
  "示例世界书": { entries: {
    1: { uid: 1, comment: "示例条目", content: "世界书内容", disable: false, key: ["示例", "例子"], constant: false, position: 1, order: 50, depth: 4, displayIndex: 0 },
    2: { uid: 2, comment: "常驻设定", content: "{{setvar::天气::晴}}这里一直是晴天。", disable: false, key: [], constant: true, position: 0, order: 100, depth: 4, displayIndex: 1 }
  } },
  "空白世界书": { entries: {} }
};
export async function loadWorldInfo(name) { return structuredClone(store[name]); }
export async function saveWorldInfo(name, data) { store[name] = structuredClone(data); globalThis.__wiSaved = (globalThis.__wiSaved || 0) + 1; }
export function createWorldInfoEntry(_name, data) {
  const used = Object.keys(data.entries).map(Number);
  const uid = used.length ? Math.max(...used) + 1 : 0;
  const e = { uid, key: [], keysecondary: [], comment: "", content: "", constant: false, selective: true, order: 100, position: 0, disable: false, depth: 4, probability: 100, useProbability: true };
  data.entries[uid] = e;
  return e;
}
export const selected_world_info = ["示例世界书"];
export async function deleteWorldInfo(name) { const i = world_names.indexOf(name); if (i < 0) return false; world_names.splice(i, 1); delete store[name]; return true; }
export const world_info = { charLore: [] };
