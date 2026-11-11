// 外观。默认跟随酒馆主题（自动改为不透明，避免背景透出影响阅读），也可选用内置配色。
// 1.3.9：「花田」「晴野」为油画感渐变背景，替换原来的豆沙粉、雾霾蓝（沿用原 id，已选的设置不受影响）。
// 2.3.8：「芽体」「菌落」为清透油画底 + 毛玻璃面板（glass）；去掉「春芽」。
// 自定义背景图存在本浏览器的 IndexedDB，不写进酒馆设置文件，不影响酒馆加载速度。
// 2.7.1 「素」「墨」为改版后的默认配色：暖灰白底、近黑强调色；墨为其深色版
var THEMES = [
  { id: "su", name: "素", sub: "暖灰白底，默认", dots: ["#FFFFFF", "#EEEDE8", "#1B1A18"] },
  { id: "mo", name: "墨", sub: "素的深色版", dots: ["#121211", "#272623", "#EDEBE6"] },
  { id: "follow", name: "跟随酒馆主题", sub: "使用酒馆的配色" },
  { id: "bean", fg: "#45343f", name: "花田", sub: "粉紫油画渐变", dots: ["#f6e6e6", "#b0607e", "#45343f"], paint: true },
  { id: "mist", fg: "#2f3a46", name: "晴野", sub: "蓝黄油画渐变", dots: ["#f6f2dc", "#4f74a3", "#2f3a46"], paint: true },
  { id: "oat", fg: "#4a3438", name: "秋樱", sub: "粉色花海", dots: ["#f4dcd9", "#b5566a", "#a9b48c"], paint: true },
  { id: "sage", fg: "#2c3a58", name: "海雾", sub: "雾蓝粉橙水彩", dots: ["#f6e6da", "#5a6e9e", "#f0b878"], paint: true },
  { id: "goose", fg: "#3d4540", name: "春和", sub: "粉绿水彩", dots: ["#fbded0", "#d1e5d9", "#bdcdb0"], paint: true },
  { id: "taro", fg: "#4a4160", name: "玫瑰芋泥", sub: "粉紫朦胧水彩", dots: ["#f5e8f3", "#cdbddb", "#9c91b8"], paint: true },
  { id: "dusk", fg: "#1f4a55", name: "日落海岸", sub: "海蓝到橘粉的晚霞", dots: ["#f3e8ab", "#f87078", "#026d81"], paint: true },
  { id: "bud", fg: "#2f423d", name: "芽体", sub: "青绿珊瑚毛玻璃", dots: ["#a9d5d1", "#f0c9b8", "#657f78"], paint: true, glass: true },
  { id: "colony", fg: "#303f47", name: "菌落", sub: "冷雾蓝紫毛玻璃", dots: ["#b8d4e7", "#d8d0e6", "#667d87"], paint: true, glass: true },
  { id: "night", name: "夜雾", sub: "深色", dots: ["#262a30", "#a9bfae", "#e4e1dc"] }
];
function readColor(value) {
  if (!value) return null;
  if (!CSS.supports("color", value)) return null;
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (hex) {
    const full = hex[1].length < 5 ? [...hex[1]].map(c => c + c).join("") : hex[1];
    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1 };
  }
  const plain = /^rgba?\(([\d\s.,/]+)\)$/.exec(value);
  if (plain) {
    const [r, g, b, a = 1] = plain[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    if ([r, g, b, a].every(Number.isFinite)) return { r: Math.min(255, r), g: Math.min(255, g), b: Math.min(255, b), a: Math.min(1, a) };
  }
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.setProperty("color", value, "important");
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const srgb = /^color\(srgb\s+([^)]*)\)/.exec(c);
  if (srgb) {
    const [r, g, b, a = 1] = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
    return { r: r * 255, g: g * 255, b: b * 255, a };
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
  return { r, g, b, a };
}
function themeRgb(c) {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}
function themeMix(fg, bg, a = fg.a ?? 1) {
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}
function themeLuminance(c) {
  const linear = (n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; };
  return .2126 * linear(c.r) + .7152 * linear(c.g) + .0722 * linear(c.b);
}
function themeContrast(a, b) {
  const x = themeLuminance(a), y = themeLuminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
// 保留原主题色相，仅在文字/控件与面板太接近时向深色或浅色调整。
function readableThemeColor(color, surfaces, minimum) {
  const original = themeMix(color, surfaces[0]);
  const score = (c) => Math.min(...surfaces.map((bg) => themeContrast(c, bg)));
  if (score(original) >= minimum) return original;
  const dark = { r: 0, g: 0, b: 0 }, light = { r: 255, g: 255, b: 255 };
  const end = score(dark) >= score(light) ? dark : light;
  if (score(end) < minimum) return end;
  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) {
    const k = (lo + hi) / 2;
    if (score(themeMix(end, original, k)) >= minimum + .03) hi = k;
    else lo = k;
  }
  return themeMix(end, original, hi);
}
var themeWatcher = null;
function watchTheme(root) {
  if (themeWatcher?.root === root) return;
  themeWatcher?.stop();
  let frame = 0, lastKey = "";
  // 2.7.8 宿主可能反复写入相同的 class、style（同值也会触发观察）；内容没变就不重算配色、不放探针
  const hostKey = () => [document.documentElement.className, document.documentElement.getAttribute("style"), document.body.className, document.body.getAttribute("style")].join("|");
  const refresh = (records) => {
    if (root.hidden || !root.isConnected || frame) return;
    const key = hostKey();
    if (Array.isArray(records) && key === lastKey) return;
    lastKey = key;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!root.hidden && root.isConnected) jankTime("跟随酒馆配色", () => applyTheme(root));
    });
  };
  // 不观察条目、聊天内容或整个 DOM 子树；宿主换主题时只合并处理一次。
  const observer = new MutationObserver(refresh);
  for (const node of [document.documentElement, document.body]) observer.observe(node, { attributes: true, attributeFilter: ["class", "style"] });
  // 2.5.8 Safari 13 及更早只有 addListener
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (media?.addEventListener) media.addEventListener("change", refresh);
  else media?.addListener?.(refresh);
  const stop = () => {
    observer.disconnect(); cancelAnimationFrame(frame);
    if (media?.removeEventListener) media.removeEventListener("change", refresh);
    else media?.removeListener?.(refresh);
  };
  themeWatcher = { root, stop };
  // 扩展/脚本重载走应用现有销毁流程，释放旧面板和媒体监听。
  if (typeof cleanups !== "undefined") cleanups.push(stop);
}
// 美化若用 !important 强改普通文字颜色（span、p、div 等），面板文字会跟着变、看不清。
// 打开或换主题时用探针比对：被改了就启用 pa-guard，把面板自己的字色规则加上 !important 再套一层。
function hostForcesText(root) {
  const want = "rgb(1, 2, 3)";
  const probe = document.createElement("pa-probe");
  probe.setAttribute("style", `position:absolute!important;visibility:hidden!important;pointer-events:none!important;color:${want}!important;-webkit-text-fill-color:${want}!important`);
  probe.innerHTML = "<span></span><p></p><b></b><strong></strong><small></small><em></em><label></label><div></div><li></li><summary></summary><h3></h3><h4></h4><code></code>";
  root.append(probe);
  const forced = [...probe.children].some((el) => {
    const cs = getComputedStyle(el);
    return cs.color !== want || (cs.webkitTextFillColor && cs.webkitTextFillColor !== want);
  });
  probe.remove();
  return forced;
}
function guardRules() {
  if (document.getElementById("mcd-guard-style")) return;
  const sheet = document.getElementById("mcd-style")?.sheet;
  if (!sheet) return;
  const out = ["#mcd-root.pa-guard :where(b, strong, p, span, label, small, em, i, details, summary, li, dt, dd, div, h1, h2, h3, h4, h5, a, code, pre, td, th, article, header, section) { color: inherit !important; -webkit-text-fill-color: currentColor !important; }"];
  const walk = (rules, wrap) => {
    for (const rule of rules) {
      const at = rule instanceof CSSMediaRule ? "@media" : typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule ? "@supports" : "";
      if (at) { walk(rule.cssRules, (t) => wrap(`${at} ${rule.conditionText} { ${t} }`)); continue; }
      const sel = rule.selectorText, color = rule.style?.getPropertyValue("color");
      if (!sel || !color || !sel.includes("#mcd-root")) continue;
      const fill = rule.style.getPropertyValue("-webkit-text-fill-color") || "currentColor";
      out.push(wrap(`${sel.replaceAll("#mcd-root", "#mcd-root.pa-guard")} { color: ${color} !important; -webkit-text-fill-color: ${fill} !important; }`));
    }
  };
  walk(sheet.cssRules, (t) => t);
  const style = document.createElement("style");
  style.id = "mcd-guard-style";
  style.textContent = out.join("\n");
  document.head.append(style);
  if (typeof cleanups !== "undefined") cleanups.push(() => style.remove());
}
var bgUrl = null;
// 2.5.8 「跟随系统」是配色标题右边的开关（followSystem），不再是一张配色卡：
// 开着时，系统为深色：「素」换成「墨」，其他配色换成夜雾。系统切换时由 watchTheme 里的 prefers-color-scheme 监听重新上色。
// 2.3.7～2.5.7 存的是 theme: "system"，浅色配色记在 themeLight，这里换成新写法。
function themePrefs() {
  const s = settings();
  const valid = (id) => THEMES.some((t) => t.id === id);
  if (s.theme === "system") {
    s.followSystem = true;
    s.theme = valid(s.themeLight) && s.themeLight !== "night" ? s.themeLight : "follow";
    delete s.themeLight;
  }
  // 2.7.1 改版：原默认的「跟随酒馆主题」换成「素」一次，之后可在「设置」里改回；选过其他配色的不变
  if (!s.ui271) {
    if (!s.theme || s.theme === "follow") s.theme = "su";
    s.ui271 = true;
    if (typeof saveSettings === "function") saveSettings();
  }
  // 1.4.0 去掉了薰衣草、海盐，2.3.8 去掉了春芽，选过的回到默认
  return { theme: valid(s.theme) ? s.theme : "su", followSystem: s.followSystem === true };
}
function systemDark() {
  return !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}
function effectiveTheme() {
  const { theme, followSystem } = themePrefs();
  if (!(followSystem && systemDark())) return theme;
  return theme === "su" || theme === "mo" ? "mo" : "night";
}
function applyTheme(root) {
  if (!root) return;
  watchTheme(root);
  root.classList.remove("pa-guard");
  if (hostForcesText(root)) {
    guardRules();
    root.classList.add("pa-guard");
  }
  const id = effectiveTheme();
  root.dataset.theme = id;
  root.dataset.fs = fontSizePref();
  const theme = THEMES.find((t) => t.id === id);
  root.classList.toggle("pa-painted", !!theme?.paint);
  root.classList.toggle("pa-glass", !!theme?.glass);
  const host = getComputedStyle(document.body);
  const hostColors = ["--SmartThemeBlurTintColor", "--SmartThemeBodyColor", "--SmartThemeQuoteColor", "--SmartThemeEmColor", "--SmartThemeBorderColor"].map((key) => host.getPropertyValue(key).trim());
  const signature = JSON.stringify([id, ...(id === "follow" ? hostColors : [])]);
  if (root._paThemeSignature === signature) return applyBackground(root);
  root._paThemeSignature = signature;
  for (const key of ["text", "dim", "em", "thread", "on-accent", "control-border", "checkmark", "warn", "warn-hue", "ok"]) root.style.removeProperty(`--pa-${key}`);
  if (id !== "follow") {
    root.style.removeProperty("--pa-tint");
    root.style.removeProperty("--pa-input-bg");
  } else {
    const tint = readColor(hostColors[0]) || { r: 28, g: 26, b: 30 };
    root.style.setProperty("--pa-tint", themeRgb(tint));
    const light = themeLuminance(tint) > .179;
    root.style.setProperty("--pa-input-bg", light ? "rgba(255, 255, 255, .72)" : "rgba(0, 0, 0, .2)");
  }
  const cs = getComputedStyle(root);
  const color = (key, fallback) => readColor(cs.getPropertyValue(`--pa-${key}`).trim()) || fallback;
  const base = color("tint", { r: 28, g: 26, b: 30 });
  // 2.5.7 深色底：样式表据此把「跟随酒馆主题」的卡片、选中底色换成固定的淡层（见 style.css 的 .pa-dark），要在下面算表面颜色之前设好
  root.classList.toggle("pa-dark", themeLuminance(base) <= .179);
  const requestedText = color("text", { r: 230, g: 225, b: 216 }), requestedAccent = color("thread", { r: 224, g: 162, b: 74 });
  const requestedWarn = color("warn", { r: 224, g: 120, b: 74 });
  const surfaceColors = () => {
    const layer = Object.fromEntries(["card", "card-2", "input-bg", "sel"].map(key => [key, color(key, { ...base, a: 0 })]));
    const panels = [base, themeMix(layer.card, base), themeMix(layer["card-2"], base), themeMix(layer["card-2"], themeMix(layer.card, base))];
    const selected = panels.map(bg => themeMix(layer.sel, bg));
    // 真实预览里选中方式位于卡片内，输入框/正文片段又位于其中。
    return [...panels, ...selected, ...[...panels, ...selected].map(bg => themeMix(layer["input-bg"], bg))];
  };
  let surfaces, text, accent, previous = "";
  // 卡片/选中底色本身依赖 text/thread；纠正后重读实际表面，避免沿用旧浅字的表面。
  // 仅主题签名改变时运行，按 RGB 取整后的结果收敛，最多八轮。
  for (let i = 0; i < 8; i++) {
    surfaces = surfaceColors();
    text = readableThemeColor(requestedText, surfaces, 4.5);
    accent = readableThemeColor(requestedAccent, surfaces, 4.5);
    const signature = themeRgb(text) + themeRgb(accent);
    if (signature === previous) break;
    previous = signature;
    root.style.setProperty("--pa-text", themeRgb(text));
    root.style.setProperty("--pa-thread", themeRgb(accent));
  }
  surfaces = surfaceColors();
  const ink = themeContrast(accent, { r: 255, g: 255, b: 255 }) >= themeContrast(accent, { r: 0, g: 0, b: 0 }) ? "#ffffff" : "#000000";
  for (const [key, value] of Object.entries({
    text, thread: accent,
    dim: readableThemeColor(themeMix(text, base, .68), surfaces, 4.5),
    em: readableThemeColor(color("em", text), surfaces, 4.5),
    "control-border": readableThemeColor(themeMix(text, base, .6), surfaces, 3),
    warn: readableThemeColor(requestedWarn, surfaces, 4.5),
    ok: readableThemeColor(color("ok", { r: 111, g: 179, b: 138 }), surfaces, 4.5)
  })) root.style.setProperty(`--pa-${key}`, themeRgb(value));
  // 2.5.0 警告色为了字够清楚会被调亮、调暗（深色主题里接近白色），浅色底用主题原本的色相
  root.style.setProperty("--pa-warn-hue", themeRgb(requestedWarn));
  root.style.setProperty("--pa-on-accent", ink);
  root.style.setProperty("--pa-checkmark", `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2l2.3 2.3 4.7-5' fill='none' stroke='${ink.replace("#", "%23")}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`);
  root.style.colorScheme = themeLuminance(base) > .179 ? "light" : "dark";
  applyBackground(root);
}
// 自定义背景图：图片上盖一层主题底色，浓度可调，保证文字清楚
async function applyBackground(root) {
  const bg = settings().bg || {};
  if (!bg.on) {
    root.classList.remove("pa-has-bg");
    return;
  }
  try {
    if (!bgUrl) {
      const blob = await assetGet("bg");
      if (!blob) {
        root.classList.remove("pa-has-bg");
        return;
      }
      bgUrl = URL.createObjectURL(blob);
    }
    const tint = readColor(getComputedStyle(root).getPropertyValue("--pa-tint").trim()) || { r: 240, g: 240, b: 240 };
    const veil = Math.min(0.9, Math.max(0, bg.veil ?? 0.55));
    root.style.setProperty("--pa-bg-img", `url("${bgUrl}")`);
    root.style.setProperty("--pa-bg-veil", `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${veil})`);
    root.classList.add("pa-has-bg");
  } catch (e) {
    console.warn("[麦当劳] 背景图读取失败", e);
    root.classList.remove("pa-has-bg");
  }
}
// 选图后先缩小再存（最长边 1600 像素，JPEG），避免占用过多空间、拖慢打开
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  // 手机截图常带纯黑或纯白的边，先裁掉
  const box = trimBorders(bmp);
  const k = Math.min(1, 1600 / Math.max(box.w, box.h));
  const cv = document.createElement("canvas");
  cv.width = Math.round(box.w * k);
  cv.height = Math.round(box.h * k);
  cv.getContext("2d").drawImage(bmp, box.x, box.y, box.w, box.h, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return new Promise((resolve, reject) => cv.toBlob((b) => b ? resolve(b) : reject(new Error("图片处理失败")), "image/jpeg", 0.85));
}
// 找出四周整行/整列几乎同色（接近纯黑或纯白）的边，返回去掉这些边之后的区域
function trimBorders(bmp) {
  const W = 200;
  const k = W / bmp.width;
  const H = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  const flat = (cells) => {
    let dark = 0, light = 0;
    for (const i of cells) {
      const l = lum(i);
      if (l < 28) dark++;
      else if (l > 238) light++;
    }
    return dark / cells.length > 0.94 || light / cells.length > 0.94;
  };
  const row = (y) => Array.from({ length: W }, (_, x) => (y * W + x) * 4);
  const col = (x) => Array.from({ length: H }, (_, y) => (y * W + x) * 4);
  let top = 0, bottom = H - 1, left = 0, right = W - 1;
  while (top < bottom && flat(row(top))) top++;
  while (bottom > top && flat(row(bottom))) bottom--;
  while (left < right && flat(col(left))) left++;
  while (right > left && flat(col(right))) right--;
  // 缩小时边界会有一行过渡色，多裁一行
  if (top > 0) top++;
  if (bottom < H - 1) bottom--;
  if (left > 0) left++;
  if (right < W - 1) right--;
  // 裁掉太多（整张图本来就很暗或很亮）就不裁
  if ((bottom - top + 1) < H * 0.3 || (right - left + 1) < W * 0.3) return { x: 0, y: 0, w: bmp.width, h: bmp.height };
  const s = bmp.width / W;
  const x = Math.floor(left * s), y = Math.floor(top * s);
  return { x, y, w: Math.min(bmp.width - x, Math.ceil((right - left + 1) * s)), h: Math.min(bmp.height - y, Math.ceil((bottom - top + 1) * s)) };
}
function themeCards() {
  const { theme: cur, followSystem } = themePrefs();
  const head = `<div class="pa-hrow"><h3 class="pa-h">配色</h3>
      <label class="pa-hswitch"><span>跟随系统</span><span class="pa-switch"><input type="checkbox" data-follow-system ${followSystem ? "checked" : ""}><i></i></span></label></div>
    ${followSystem ? '<small class="pa-dim pa-look-note">深色时「素」换成「墨」，其他配色换成夜雾</small>' : ""}`;
  return `${head}<div class="pa-themes">${THEMES.map((t) => {
    const dots = t.dots || ["var(--SmartThemeBlurTintColor, #333)", "var(--SmartThemeQuoteColor, #e0a24a)", "var(--SmartThemeBodyColor, #ddd)"];
    const style = t.dots && !t.paint ? `background:${t.dots[0]};color:${t.dots[2]};border-color:${t.dots[1]}55` : t.paint ? `color:${t.fg || t.dots[2]};border-color:${t.dots[1]}55` : "";
    return `<button class="pa-theme${t.paint ? ` pa-paint-${t.id}` : ""}" data-theme-id="${t.id}" aria-pressed="${t.id === cur}" title="${esc(t.sub)}" style="${style}">
        <span class="pa-theme-dots">${dots.map((c2) => `<i style="background:${c2}"></i>`).join("")}</span>
        <b>${esc(t.name)}</b></button>`;
  }).join("")}</div>`;
}
function bindThemeCards(box, after) {
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme-id]");
    if (!b) return;
    themePrefs();
    settings().theme = b.dataset.themeId;
    saveSettings();
    applyTheme(document.getElementById("mcd-root"));
    box.querySelectorAll("[data-theme-id]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    after?.();
  });
  box.addEventListener("change", (e) => {
    const t = e.target.closest("[data-follow-system]");
    if (!t) return;
    themePrefs();
    settings().followSystem = t.checked;
    saveSettings();
    applyTheme(document.getElementById("mcd-root"));
    box.innerHTML = themeCards();
    box.querySelector("[data-follow-system]")?.focus({ preventScroll: true });
    after?.();
  });
}
function bgPanel() {
  const bg = settings().bg || {};
  return `<div class="pa-bgpanel">
      <div class="pa-card-act">
        <label class="pa-btn pa-btn-soft pa-file">${bg.on ? "更换图片" : "选择图片"}<input type="file" accept="image/*" data-bg="file" hidden></label>
        ${bg.on ? '<button class="pa-btn" data-bg="off">移除</button>' : ""}
      </div>
      ${bg.on ? `<label class="pa-field pa-field-row"><span>遮罩</span><input type="range" min="0" max="90" step="5" value="${Math.round((bg.veil ?? 0.55) * 100)}" data-bg="veil"><em class="pa-bg-veil-n">${Math.round((bg.veil ?? 0.55) * 100)}%</em></label>` : ""}
    </div>`;
}
function bindBgPanel(box, rerender) {
  const root = () => document.getElementById("mcd-root");
  box.addEventListener("change", async (e) => {
    const t = e.target.closest("[data-bg]");
    if (!t) return;
    if (t.dataset.bg === "file") {
      const f = t.files?.[0];
      if (!f) return;
      try {
        const blob = await shrinkImage(f);
        await assetPut("bg", blob);
        if (bgUrl) URL.revokeObjectURL(bgUrl);
        bgUrl = null;
        settings().bg = { ...settings().bg || {}, on: true, veil: settings().bg?.veil ?? 0.55 };
        saveSettings();
        await applyBackground(root());
        toast("背景图已设置", "success");
      } catch (err) {
        toast("背景图设置失败：" + err.message, "error");
      }
      return rerender();
    }
  });
  box.addEventListener("input", (e) => {
    const t = e.target.closest("[data-bg=veil]");
    if (!t) return;
    settings().bg = { ...settings().bg, veil: Number(t.value) / 100 };
    box.querySelector(".pa-bg-veil-n").textContent = `${t.value}%`;
    applyBackground(root());
  });
  box.addEventListener("change", (e) => {
    if (e.target.closest("[data-bg=veil]")) saveSettings();
  });
  box.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-bg=off]")) return;
    settings().bg = { ...settings().bg, on: false };
    saveSettings();
    await assetDel("bg").catch(() => {
    });
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = null;
    applyBackground(root());
    rerender();
  });
}
// 1.5.0 文字大小：小 / 标准 / 大。每台设备单独记（手机和平板常常想要不同的大小），存在本浏览器
var FS_KEY = "mcdonalds:fontSize";
function fontSizePref() {
  try {
    return localStorage.getItem(FS_KEY) || "m";
  } catch {
    return "m";
  }
}
function fontSizeSeg() {
  const cur = fontSizePref();
  return `<div class="pa-seg pa-seg-s pa-fs" role="tablist">${[["s", "小"], ["m", "标准"], ["l", "大"]].map(([k, l]) => `<button data-fs="${k}" class="${k === cur ? "on" : ""}">${l}</button>`).join("")}</div>
    <small class="pa-dim pa-fs-note">只对这台设备生效</small>`;
}
function bindFontSize(box) {
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fs]");
    if (!b) return;
    try {
      localStorage.setItem(FS_KEY, b.dataset.fs);
    } catch {
    }
    const root = document.getElementById("mcd-root");
    if (root) root.dataset.fs = b.dataset.fs;
    box.querySelectorAll("[data-fs]").forEach((x) => x.classList.toggle("on", x === b));
  });
}
