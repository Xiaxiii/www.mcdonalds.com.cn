// 兼容下限：酒馆本体能在 iOS 15.4 / Chrome 98 上运行（它特意避开后行断言），麦当劳不能比它高。
// 扫生成的 index.js，去掉注释后不允许出现这些写法：一个不认的正则字面量会让整个扩展加载失败，新 API 会在用到时报错
const fs = require("fs"), path = require("path");
const assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
// 只去掉整行注释和行尾的 // 注释（字符串里的 // 网址前面有引号或冒号，不受影响）
const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/\s[^"'`]*$/, "")).join("\n");
const banned = [
  [/\(\?<[=!]/, "后行断言 (?<= / (?<!（Safari 16.4）"],
  [/\.findLast(Index)?\(/, "findLast（Safari 15.4 以下）"],
  [/\.(toSorted|toReversed|toSpliced)\(/, "toSorted 等（Safari 16）"],
  [/\b(Object|Map)\.groupBy\b/, "groupBy（Safari 17.4）"],
  [/\.(union|intersection|difference|symmetricDifference|isSubsetOf)\(/, "Set 运算（Safari 17）"],
  [/Promise\.withResolvers|Array\.fromAsync|AbortSignal\.any/, "Safari 17 以上的 API"],
  [/\brequestIdleCallback\s*\(/, "requestIdleCallback（Safari 没有）"],
];
let n = 0;
for (const [re, label] of banned) {
  const hit = code.split("\n").findIndex((l) => re.test(l));
  assert.equal(hit, -1, `index.js 第 ${hit + 1} 行用了${label}：${hit >= 0 ? code.split("\n")[hit].trim().slice(0, 120) : ""}`);
  n++;
}
console.log(`✓ 兼容下限：${n} 类较新写法都没有出现在 index.js 里`);
