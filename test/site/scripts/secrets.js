// 模拟酒馆密钥库：写入新密钥时，同类型旧密钥停用、新密钥设为使用中（与酒馆一致）
export const secret_state = { api_key_custom: [] };
let n = 0;
export async function writeSecret(key, value, label) {
  if (globalThis.__secretWriteFails) return null;
  const id = "id" + (++n);
  const list = (secret_state[key] ||= []);
  list.forEach((s) => { s.active = false; });
  list.push({ id, value: String(value).slice(-3), label, active: true });
  return id;
}
export async function readSecretState() {}
export async function rotateSecret(key, id) { (secret_state[key] || []).forEach((s) => { s.active = s.id === id; }); }
export async function deleteSecret(key, id) { const l = secret_state[key] || []; const i = l.findIndex((s) => s.id === id); if (i >= 0) l.splice(i, 1); }
