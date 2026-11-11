// 维护模块 · 扩展页设置框里的「加载与兼容」小卡片。
// 平时只显示不用发请求就能知道的状态；详细检查点按钮才做。深度统计、清理等放在面板里，不塞进这里。
function mountCompatCard(box, { openHealth } = {}) {
  const yes = (v) => v === true ? "是" : v === false ? "否" : "未知";
  function quickHtml() {
    const q = compatQuick();
    const names = { baibaiTools: "柏宝箱", cocktail: "鸡尾酒", cocktailPlus: "鸡尾酒+", tavernHelper: "酒馆助手" };
    const running = Object.entries(q.running).filter(([, v]) => v).map(([k]) => names[k]);
    const bridges = [q.bridges.baibaoku && "柏宝库", q.bridges.cocktailPlus && "鸡尾酒+"].filter(Boolean);
    const t = q.takeover.settingsRead;
    const via = !t?.seen ? "没有记录到" : [...(t.providers || []).map((p) => `${p}接口`), ...(t.viaSw ? [`Service Worker（${q.sw?.owner || "提供者未知"}）`] : []), ...(t.plain ? ["酒馆原接口"] : [])].join("、");
    return `<div class="pa-set-kv">
        <span>已在运行的相关扩展</span><b>${running.length ? esc(running.join("、")) : "未发现"}</b>
        <span>启动桥接</span><b>${bridges.length ? `${esc(bridges.join("、"))}（已加载）` : "未发现"}</b>
        <span>Service Worker</span><b>${q.sw ? esc(q.sw.owner ? `由${q.sw.owner}控制` : "有，提供者未知") : q.secure ? "没有" : "当前是 HTTP 访问，浏览器不允许使用"}</b>
        <span>本次设置读取</span><b>${esc(via)}</b>
        <span>本扩展的读取加速</span><b>未提供</b>
      </div>
      <div class="pa-set-note">本扩展只做检测和体检，不接管任何请求，也不改其他扩展的开关。${q.secure ? "" : "HTTP 访问只影响 Service Worker 类的缓存，接口类加速不受这个限制。"}</div>`;
  }
  function fullHtml(c) {
    const rows = c.rows.map((r) => `<tr><th>${esc(r.name)}</th><td>${r.installed == null ? "未知" : r.installed ? "已安装" : "未安装"}</td><td>${r.enabled === undefined ? "—" : yes(r.enabled)}</td><td>${r.backend ? r.backend === "ok" ? "可用" : "不可用" : "—"}</td><td>${r.running == null ? "—" : yes(r.running)}</td><td>${esc(r.backendVersion || r.version || "—")}<small>${esc(r.level)}</small></td></tr>`).join("");
    const areas = areaStatus(c).map((a) => `<li><b>${esc(a.label)}</b>：${a.who.length ? esc(a.who.map((w) => `${w.name}（${w.state}）`).join("、")) : "没有发现提供者"}${a.seen.length ? `；本次实际走了 ${esc(a.seen.join("、"))}` : ""}${a.overlap === "yes" ? '<em class="pa-set-bad">重叠：同一请求可能被两个功能接管，建议只保留一个</em>' : a.overlap === "maybe" ? '<em class="pa-set-bad">可能重叠：开关状态读不到，请到对应扩展里确认只开了一个</em>' : ""}<small>本扩展：${esc(a.rule)}</small></li>`).join("");
    return `${c.extErr ? `<div class="pa-set-note pa-set-bad">读取扩展列表失败：${esc(c.extErr)}</div>` : ""}
      <div class="pa-set-tablewrap"><table class="pa-set-table"><thead><tr><th></th><th>安装</th><th>开启</th><th>后端</th><th>运行中</th><th>版本</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="pa-set-note">「已识别但未验证」：核对过这个版本的源码，但没有在真实酒馆里和本扩展一起测试过；「未知」：没核对过的版本，本扩展默认不接管任何相关请求。</div>
      <ul class="pa-set-areas">${areas}</ul>`;
  }
  // 一行概况：在运行的相关扩展
  function sumText() {
    const q = compatQuick();
    const names = { baibaiTools: "柏宝箱", cocktail: "鸡尾酒", cocktailPlus: "鸡尾酒+", tavernHelper: "酒馆助手" };
    const running = Object.entries(q.running).filter(([, v]) => v).map(([k]) => names[k]);
    return running.length ? `在运行：${running.join("、")}` : "没发现相关扩展";
  }
  box.innerHTML = `<details class="pa-set-fold"><summary><span class="pa-set-fold-t">加载与兼容</span><small class="pa-set-sum">${esc(sumText())}</small></summary>
    <div class="pa-set-fold-body">
    <div class="pa-set-quick">${quickHtml()}</div>
    <div class="pa-set-full"></div>
    <div class="pa-set-btns">
      <div class="menu_button menu_button_icon" data-c="check" tabindex="0" role="button"><i class="fa-solid fa-stethoscope"></i><span>检查兼容性</span></div>
    </div>
    </div></details>`;
  const full = box.querySelector(".pa-set-full");
  let busy = false;
  async function act(a, btn) {
    if (a === "health") return openHealth?.();
    if (a !== "check" || busy) return;
    busy = true;
    btn.querySelector("i")?.classList.add("fa-spin");
    full.innerHTML = '<div class="pa-set-note">正在检查…（会读取扩展列表、探测柏宝库和鸡尾酒+ 的后端）</div>';
    try {
      const c = await compatFull();
      box.querySelector(".pa-set-quick").innerHTML = quickHtml();
      box.querySelector(".pa-set-sum").textContent = sumText();
      full.innerHTML = fullHtml(c);
    } catch (e) {
      full.innerHTML = `<div class="pa-set-note pa-set-bad">检查出错：${esc(e.message)}</div>`;
    } finally {
      btn.querySelector("i")?.classList.remove("fa-spin");
      busy = false;
    }
  }
  const handler = (e) => {
    const b = e.target.closest("[data-c]");
    if (!b || !box.contains(b)) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    act(b.dataset.c, b);
  };
  box.addEventListener("click", handler);
  box.addEventListener("keydown", handler);
  return { refresh: () => { box.querySelector(".pa-set-quick").innerHTML = quickHtml(); box.querySelector(".pa-set-sum").textContent = sumText(); } };
}
