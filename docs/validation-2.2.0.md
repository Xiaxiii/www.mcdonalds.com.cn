# 2.2.0 验证

核心和模拟页面回归由 `node test/run-core.cjs` 与 `PW_CHROME=/usr/bin/chromium bash test/run-browser.sh` 执行。新增测试覆盖变量顺序与状态摘要、审查响应校验、默认关闭、取消与过期结果、按预设设置、手机端和宿主接口降级。

本次结果：111 项核心/运行时检查通过，6 项依赖私有 Ako 预设的可选测试跳过；21 个浏览器检查脚本通过。真实宿主集成脚本也已通过。

真实宿主验证使用 SillyTavern 1.19.0，release 提交 `06bde939fb1e9c4c8d8641d810f0a916b5bce127`。服务仅监听回环地址，使用独立测试数据目录，不连接用户的生产酒馆。模型端由本地协议桩提供固定结果：它验证请求/响应和生命周期，不验证真实模型的语义判断准确率。

## 复现真实宿主验证

以下命令需要 Node 20+、npm、Git、Chromium，以及主仓库 `test/` 下的 Playwright。示例使用全新的 `/tmp/bcw-st-validation`，不要指向日常使用的酒馆或数据目录。模型协议桩只监听 127.0.0.1，无需 API 密钥。

创建独立宿主并安装锁定依赖：

```bash
git clone --branch release https://github.com/SillyTavern/SillyTavern.git /tmp/bcw-st-validation
cd /tmp/bcw-st-validation
git checkout 06bde939fb1e9c4c8d8641d810f0a916b5bce127
npm ci --no-audit --no-fund --cache /workspace/.npm-cache
node --input-type=module - <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
const cfg = yaml.parse(fs.readFileSync('default/config.yaml', 'utf8'));
cfg.port = 8877;
cfg.listen = false;
cfg.browserLaunch.enabled = false;
cfg.dataRoot = path.resolve('data-bcw-validation');
cfg.extensions.autoUpdate = false;
cfg.extensions.models.autoDownload = false;
cfg.enableDownloadableTokenizers = false;
fs.writeFileSync('config-bcw.yaml', yaml.stringify(cfg));
JS
```

构建鸡翅，将扩展的生成文件装入这个独立宿主：

```bash
cd /workspace/Burnt-chicken-wings
node build.mjs
mkdir -p /tmp/bcw-st-validation/public/scripts/extensions/third-party/Burnt-chicken-wings
cp index.js manifest.json /tmp/bcw-st-validation/public/scripts/extensions/third-party/Burnt-chicken-wings/
```

分别在两个终端/后台会话启动服务，等宿主编译完成并报告监听成功：

```bash
cd /tmp/bcw-st-validation
node server.js --configPath ./config-bcw.yaml --browserLaunchEnabled false
```

```bash
cd /workspace/Burnt-chicken-wings
node test/fixtures/review-api.cjs
```

再执行：

```bash
cd /workspace/Burnt-chicken-wings
PW_CHROME=/usr/bin/chromium node test/real-st.mjs
```

测试会在独立实例里创建合成角色与预设，切到本地 Custom API，并验证：

- 扩展由真实宿主加载；酒馆的原生变量宏确实执行先读取旧值、再赋值/清空的行为。
- 顺序检查与聊天/全局变量状态读取；生成前后摘要能辨认变化且不展示变量正文。
- 原生生成、滑动和续写经过真实后端，请求到达本地协议桩。
- 语义审查使用当前连接和显式模型名，经过真实酒馆后端显示引用与依据；不改聊天、不执行被审查回复里的宏，不附带变量值。

测试完成后仅停止这两个自行启动的服务。若后续修改源码，需要重新构建并将两个生成文件复制到测试宿主后再运行。测试端口分别为 8877（宿主）和 8888（协议桩）；模拟页面检查另用 8765。

## 能力边界

顺序分析是对可见列表的保守推演，不能证明酒馆重排、世界书、脚本、MVU 或其他扩展的所有变量执行路径正确。生成前后记录是状态比较，不是每次读取/写入的调用日志。两者都不自动重排或修正变量值。

AI 审查返回疑似片段，需人工确认。真实模型的准确率、具体服务商和用户原有扩展组合尚需在对应环境实测；本地协议桩的通过不能代替这类评估。审查结果不会自动用于下一轮提示，也不会删除正文。

## 已确认、尚未修复的问题

- 新增的顺序分析能识别部分空格写法，但原有变量检查与通用修复尚未统一解析。例如已有 `{{getvar mode}}` 时，原检查仍可能误报缺少读取，并建议再添加 `{{getvar::mode}}`。
- 通用修复尚未区分用于正文输出的内容变量和只用于存在检查的状态变量。例如仅通过 `{{hasvar::mode}}` 使用的变量，仍可能被建议添加正文读取；此类建议应人工跳过。

上述问题不属于本次 111 项通过检查所覆盖的已解决问题。顺序分析和状态摘要可以辅助核对，不能据此把所有修复建议视为安全、必要的修改。
