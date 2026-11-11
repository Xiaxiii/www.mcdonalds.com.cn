// 测试用：模拟一个会卡住页面的第三方扩展（jank-check 用）
window.__fakeHeavy = (ms) => new Promise((resolve) => setTimeout(function fakeHeavyWork() {
  const t = performance.now();
  while (performance.now() - t < ms);
  resolve();
}, 0));
