// 测试用：点名称按钮，在弹出的列表里选一项（1.9 起预设、世界书、来源类型都用这种列表，不再是系统下拉框）
export async function choose(page, btnSel, value) {
  await page.click(btnSel);
  await page.waitForSelector(".pa-npick-item", { timeout: 5000 });
  const ok = await page.evaluate((v) => {
    const b = [...document.querySelectorAll(".pa-npick-item")].find((x) => x.dataset.v === v);
    if (b) b.click();
    return !!b;
  }, value);
  if (!ok) throw new Error(`列表里没有「${value}」`);
  await page.waitForTimeout(300);
}
// 缝合页的来源类型（preset / world / file / paste）、目标类型（preset / world）
export const chooseSrcType = (page, type) => choose(page, '[data-st="srctype"]', type);
export const chooseDstType = (page, type) => choose(page, '[data-st="dsttype"]', type);
// 整理页工具栏：宽屏直接点按钮；窄屏（< 1100px，iPad 也算）按钮收在 ⋯ 和 ＋ 菜单里
const MENU_OF = { newentry: ["add", "＋ 新建条目"], newgroup: ["add", "＋ 新建分组"], smart: ["menu", "智能分组"], fold: ["menu", /全部展开|全部折叠/], clickorder: ["menu", "多选排列"] };
export async function organizeTool(page, tool) {
  const btn = page.locator(`[data-page=organize] [data-tool="${tool}"]`);
  if (await btn.isVisible()) return btn.click();
  const [menu, text] = MENU_OF[tool];
  await page.click(`[data-page=organize] [data-tool="${menu}"]`);
  await page.locator(".pa-sheet-mask:not(.pa-out) .pa-pick-item").filter({ hasText: text }).click();
}
// 全部展开（已经全展开时不动）
export async function expandAll(page) {
  const btn = page.locator("[data-page=organize] [data-tool=fold]");
  if (await btn.isVisible()) {
    if ((await btn.textContent()).includes("全部展开")) await btn.click();
  } else {
    await page.click("[data-page=organize] [data-tool=menu]");
    const item = page.locator(".pa-sheet-mask:not(.pa-out) .pa-pick-item").filter({ hasText: "全部展开" });
    if (await item.count()) await item.click();
    else await page.click(".pa-sheet-mask:not(.pa-out) .pa-sheet-x");
  }
  await page.waitForTimeout(250);
}
