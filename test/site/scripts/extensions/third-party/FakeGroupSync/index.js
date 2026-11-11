// 测试用：模拟一个拿着旧预设、把旧的重复分组写回去的扩展
window.fakeGroupSyncWriteBack = (name, preset) => fetch("/api/presets/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiId: "openai", name, preset }) }).catch(() => {});
