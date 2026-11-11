// 维护模块里不碰界面的测量函数，给 run-core.cjs 用
const fs = require("fs"), path = require("path");
const code = fs.readFileSync(path.join(__dirname, "..", "src", "maintenance", "diagnostics.js"), "utf8");
module.exports = new Function(code + "\nreturn {classifyRequest,describeRequest,unionMs,summarizeRequests,receiveRate,redactUrl,diagGaps,buildDiagReport,CAT_LABEL};")();
