var booted = false;
function boot() {
  if (booted) return;
  booted = true;
  start().catch((e) => {
    console.error("[焦香鸡翅] 启动失败", e);
    globalThis.toastr?.error?.("焦香鸡翅启动失败：" + e.message);
  });
}
var c = globalThis.SillyTavern?.getContext?.();
var et = c?.eventTypes || c?.event_types;
// 酒馆还在加载（扩展版通常是这种情况）就等 APP_READY；已经加载完（脚本版）就直接启动
var stillLoading = !!(document.getElementById("preloader") || document.querySelector("#loader:not([hidden])"));
if (c && et?.APP_READY && stillLoading) {
  // 启动完成的时间由 maintenance/diagnostics.js 记录
  c.eventSource.on(et.APP_READY, () => boot());
  setTimeout(boot, 15e3);
} else if (c) {
  boot();
} else {
  setTimeout(boot, 3e3);
}
