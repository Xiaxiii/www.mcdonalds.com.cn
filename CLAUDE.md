# 焦香鸡翅

改 `src/` 里的源码，改完运行 `node build.mjs`，把生成的 `index.js` 一起提交（CI 会比对）。核心测试：`node test/run-core.cjs`；浏览器检查：`bash test/run-browser.sh`。

每次推送都升版本号：改 `package.json` 的 `version`（一般升第三位），`CHANGELOG.txt` 第一行跟着改，并在顶部加这一版的一节。不要把新改动追加进已经推送过的版本里。

## 写作规则

适用于所有文字：界面文案、提示、更新说明（CHANGELOG.txt）、提交说明。

- 如果某句话的作用只是防止被质疑，而不是推进论证，请删除。

## 设计

做界面时先读 `.claude/skills/design-taste-frontend/SKILL.md`（面板属于 app screen，规则见其中的 `references/app-screens.md`）和 `.claude/skills/frontend-design/SKILL.md`。

改完界面，用 `web-design-guidelines` 逐条核对代码，用 `impeccable` 的 audit、polish 收尾（本仓库副本不含引擎，按其 `reference/` 人工检查）；细节打磨看 `make-interfaces-feel-better`，交互、配色、字体规范查 `ui-ux-pro-max/references/`。
