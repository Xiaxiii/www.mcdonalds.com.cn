// 构建：把 src 按顺序拼成一个模块，分别产出 扩展(index.js) 和 酒馆助手脚本(JSON)
import fs from "node:fs";
const order = JSON.parse(fs.readFileSync(new URL("./order.json", import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url)));
const VERSION = pkg.version;
const CHANGELOG = fs.readFileSync(new URL("./CHANGELOG.txt", import.meta.url), "utf8");
function bundle(kind) {
  let out = `// 焦香鸡翅 ${VERSION}（${kind === "extension" ? "扩展版" : "脚本版"}）— 由 build.mjs 生成，请改 src/ 里的源码\n`;
  out += `var BUILD_KIND = ${JSON.stringify(kind)};\nvar VERSION = ${JSON.stringify(VERSION)};\nvar CHANGELOG = ${JSON.stringify(CHANGELOG)};\n`;
  for (const f of order) {
    const p = new URL(`./src/${f}`, import.meta.url);
    let body = fs.readFileSync(p, "utf8");
    if (f.endsWith(".css")) body = `var style_default = ${JSON.stringify(body)};\n`;
    out += `\n// src/${f}\n` + body;
  }
  return out;
}
fs.mkdirSync(new URL("./dist", import.meta.url), { recursive: true });
const ext = bundle("extension");
fs.writeFileSync(new URL("./index.js", import.meta.url), ext);
const inner = bundle("script");
const wrapper = `// 焦香鸡翅 ${VERSION}（脚本版）：把主程序注入酒馆主页面运行（这样才能直接读写酒馆的预设）
(() => {
    let W = window;
    try { if (window.parent && window.parent !== window && window.parent.document) W = window.parent; } catch (e) { /* 跨域时留在当前页 */ }
    const cur = W.__presetAtelier;
    if (cur && cur.kind === "extension") { console.info("[焦香鸡翅] 已经装了扩展版，脚本版不再启动"); return; }
    if (cur && cur.version === ${JSON.stringify(VERSION)} && W.document.getElementById('pa-style')) return;
    const s = W.document.createElement('script');
    s.type = 'module';
    s.dataset.presetAtelier = ${JSON.stringify(VERSION)};
    s.textContent = ${JSON.stringify(inner)};
    W.document.head.appendChild(s);
})();
`;
const tpl = JSON.parse(fs.readFileSync(new URL("./script-template.json", import.meta.url)));
tpl.content = wrapper;
tpl.info = CHANGELOG;
fs.writeFileSync(new URL(`./dist/焦香鸡翅-脚本版-${VERSION}.json`, import.meta.url), JSON.stringify(tpl, null, 2));
const man = JSON.parse(fs.readFileSync(new URL("./manifest.json", import.meta.url)));
man.version = VERSION;
fs.writeFileSync(new URL("./manifest.json", import.meta.url), JSON.stringify(man, null, 2) + "\n");
console.log("built", VERSION, "index.js", ext.length, "script", wrapper.length);
