// 合成缝合预览：主题对比度、宿主 input 美化冲突，以及打开期间换主题。
// BCW_TEST_URL 可使用独立静态服务；默认与现有浏览器检查一致。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { choose } from './choose.mjs';

// 从源码拼接与 build.mjs 相同的扩展，独立检查不改写共享的构建文件。
const dir = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, dir), 'utf8');
const pkg = JSON.parse(read('package.json'));
const source = `var BUILD_KIND="extension"; var VERSION=${JSON.stringify(pkg.version)}; var CHANGELOG=${JSON.stringify(read('CHANGELOG.txt'))};\n` +
  JSON.parse(read('order.json')).map(path => path.endsWith('.css') ? `var style_default=${JSON.stringify(read('src/' + path))};` : read('src/' + path)).join('\n');
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const themes = [
  { name: '浅色', bg: [249, 241, 228], text: '#3d4540', accent: '#5f7f68', em: '#59625b' },
  { name: '深色', bg: [32, 33, 38], text: '#e4e1dc', accent: '#d0debd', em: '#a9bfae' },
  { name: '浅底浅字', bg: [249, 241, 228], text: '#f8efe0', accent: '#faf8eb', em: '#e8e2d7' },
  { name: '深底深字', bg: [32, 33, 38], text: '#292b30', accent: '#25272a', em: '#2a2c2f' }
];
const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const rgb = value => { value = value.trim(); return value[0] === '#' ? [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) : value.match(/[\d.]+/g).slice(0, 3).map(Number); };
function actualSurfaces() {
  const parse = value => {
    const nums = value.match(/[\d.]+/g).map(Number);
    return value.startsWith('color(srgb') ? [nums[0] * 255, nums[1] * 255, nums[2] * 255, nums[3] ?? 1] : [...nums.slice(0, 3), nums[3] ?? 1];
  };
  const mix = (fg, bg, alpha = fg[3]) => [0, 1, 2].map(i => fg[i] * alpha + bg[i] * (1 - alpha));
  const root = document.getElementById('mcd-root');
  return [...root.querySelectorAll('.pa-sheet .pa-item-on,.pa-sheet .pa-item-name,.pa-sheet .pa-hint,.pa-sheet .pa-mode.on b,.pa-sheet .pa-mode.on small,.pa-sheet .pa-snip,.pa-sheet .pa-input,.pa-sheet .pa-select')].map(node => {
    const chain = [];
    for (let current = node; current; current = current.parentElement) chain.unshift(current);
    let bg = [255, 255, 255];
    const groups = [];
    for (const current of chain) {
      const cs = getComputedStyle(current);
      groups.push({ behind: bg, opacity: Number(cs.opacity) });
      bg = mix(parse(cs.backgroundColor), bg);
    }
    const cs = getComputedStyle(node);
    let painted = mix(parse(cs.webkitTextFillColor || cs.color), bg);
    for (const group of groups.reverse()) if (group.opacity !== 1) {
      painted = mix(painted, group.behind, group.opacity);
      bg = mix(bg, group.behind, group.opacity);
    }
    return { name: node.className + '/' + node.tagName + '/' + (node.dataset.c || ''), painted, bg };
  });
}

try {
  for (const mobile of [true, false]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 900 }, isMobile: mobile, hasTouch: mobile });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/index.js?*', route => route.fulfill({ contentType: 'text/javascript', body: source }));
    await page.goto(process.env.BCW_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html');
    await page.waitForFunction(() => window.__mcdonalds?.open);
    await page.evaluate(() => {
      const prompt = (identifier, name) => ({ identifier, name, content: '只写动作和对白。', role: 'system', marker: false, system_prompt: false });
      const make = (names, gid) => {
        const prompts = names.map((name, i) => prompt(gid + i, name));
        return { prompts, prompt_order: [{ character_id: 100001, order: prompts.map(p => ({ identifier: p.identifier, enabled: true })) }], extensions: { baibaiToolkit: { presetPromptGroups: { version: 1, groups: [{ id: gid, name: '写作指导和文风', enabled: true }], prompts: Object.fromEntries(prompts.map(p => [p.identifier, { groupId: gid }])) } } } };
      };
      const m = window.__mock;
      m.names.push('对比度来源', '对比度目标');
      m.presets.push(make(['古文文风', '古典白描'], 'src'), make(['目标正文规则'], 'dst'));
      m.live.preset_settings_openai = '对比度目标';
      Object.assign(m.live, structuredClone(m.presets.at(-1)));
      // 2.7.1 默认配色为「素」，这里检查跟随酒馆主题
      const st = window.SillyTavern.getContext().extensionSettings;
      Object.assign(st.mcdonalds || (st.mcdonalds = {}), { theme: 'follow', ui271: true });
      window.__mcdonalds.open('suture');
    });
    await choose(page, '.pa-src-name', '对比度来源');
    await choose(page, '.pa-dst-picker .pa-namebtn', '对比度目标');
    await page.locator('.pa-src-list [data-act=gselect]').click();
    await page.locator('.pa-dst-list .pa-gname').click();
    await page.click('[data-st=go]');
    await page.waitForSelector('.pa-item-on input');
    assert.equal(await page.locator('.pa-item-on input').count(), 2);
    await page.locator('.pa-item-head').first().click();
    await page.locator('.pa-item').first().locator('.pa-body summary').click();
    await page.locator('.pa-sheet').evaluate(async node => { await Promise.all(node.getAnimations().map(a => a.finished)); });

    // 模拟截图中的外部美化：原生复选框被强制画成白色长方块。
    await page.addStyleTag({ content: 'body input[type=checkbox]{appearance:auto!important;width:44px!important;height:22px!important;padding:5px!important;border:1px solid white!important;background:white!important;box-shadow:0 0 10px white!important;filter:opacity(.2)!important;mask:linear-gradient(white,white)!important}body :is(input,select,textarea){color:white!important;-webkit-text-fill-color:white!important;background:white!important}body :is(label,span,b,small){color:#eee}body input[type=checkbox]::before{content:"x"!important;display:block!important}' });
    // 有的美化用 !important 强改普通文字颜色；面板应检测到并改回自己的配色
    await page.addStyleTag({ content: 'body :is(span,b,strong,small,label,p,div,summary,li,em,h3,h4,code){color:#f4f1ea!important;-webkit-text-fill-color:#f4f1ea!important}' });
    for (const theme of themes) {
      await page.evaluate(theme => {
        for (const [key, value] of Object.entries({ SmartThemeBlurTintColor: `rgb(${theme.bg.join(',')})`, SmartThemeBodyColor: theme.text, SmartThemeQuoteColor: theme.accent, SmartThemeEmColor: theme.em })) document.body.style.setProperty('--' + key, value);
      }, theme);
      await page.waitForFunction(theme => {
        const root = document.getElementById('mcd-root');
        return root.style.getPropertyValue('--pa-tint') === `rgb(${theme.bg.join(', ')})` && root._paThemeSignature.includes(theme.text);
      }, theme);
      const colors = await page.evaluate(() => {
        const root = document.getElementById('mcd-root'), label = root.querySelector('.pa-item-on'), input = label.querySelector('input');
        const cs = getComputedStyle(root), ctl = getComputedStyle(input), button = getComputedStyle(root.querySelector('.pa-sheet-actions .pa-btn-primary'));
        return { text: getComputedStyle(label).color, title: getComputedStyle(root.querySelector('.pa-item-name')).color, badge: getComputedStyle(root.querySelector('.pa-item-meta .pa-chip')).color, dim: cs.getPropertyValue('--pa-dim'), accent: ctl.backgroundColor, ink: button.color, primary: button.backgroundColor, border: ctl.borderColor, width: ctl.width, height: ctl.height, appearance: ctl.appearance, image: ctl.backgroundImage, shadow: ctl.boxShadow, filter: ctl.filter, mask: ctl.maskImage, pseudo: getComputedStyle(input, '::before').content, shellBlur: getComputedStyle(root.querySelector('.pa-shell')).backdropFilter, sheetBlur: getComputedStyle(root.querySelector('.pa-sheet')).backdropFilter };
      });
      assert.ok(ratio(rgb(colors.text), theme.bg) >= 4.5, theme.name + ': 开启标签可读');
      assert.equal(await page.evaluate(() => document.getElementById('mcd-root').classList.contains('pa-guard')), true, theme.name + ': 检测到宿主强改字色');
      assert.ok(ratio(rgb(colors.title), theme.bg) >= 4.5, theme.name + ': 标题不受宿主 span 字色污染');
      assert.ok(ratio(rgb(colors.badge), theme.bg) >= 4.5, theme.name + ': 标签保持自己的主题色');
      assert.ok(ratio(rgb(colors.dim), theme.bg) >= 4.5, theme.name + ': 次级说明可读');
      assert.ok(ratio(rgb(colors.ink), rgb(colors.primary)) >= 4.5, theme.name + ': 主按钮字色可读');
      assert.ok(ratio(rgb(colors.primary), theme.bg) >= 3, theme.name + ': 已选控件与底色可分辨');
      assert.match(colors.image, /data:image\/svg\+xml/);
      assert.equal(colors.appearance, 'none');
      assert.equal(colors.width, '17px'); assert.equal(colors.height, '17px');
      assert.equal(colors.shadow, 'none'); assert.equal(colors.filter, 'none'); assert.equal(colors.mask, 'none');
      assert.equal(colors.pseudo, 'none');
      assert.equal(colors.shellBlur, 'none'); assert.equal(colors.sheetBlur, 'none');
      const actual = await page.evaluate(actualSurfaces);
      assert.ok(actual.some(x => x.name.includes('/SELECT/')), '真实预览包含分组下拉框');
      assert.ok(actual.some(x => x.name.includes('/INPUT/')), '展开条目包含标题输入框');
      assert.ok(actual.some(x => x.name.includes('/TEXTAREA/')), '展开完整正文包含文本框');
      for (const surface of actual) assert.ok(ratio(surface.painted, surface.bg) >= 4.5, `${theme.name}: ${surface.name} 在实际叠加表面上的对比度 ${ratio(surface.painted, surface.bg).toFixed(3)}`);
      const enabled = page.locator('.pa-item-on input').first();
      await enabled.uncheck();
      const off = await enabled.evaluate(e => ({ border: getComputedStyle(e).borderColor, image: getComputedStyle(e).backgroundImage }));
      assert.ok(ratio(rgb(off.border), theme.bg) >= 3, theme.name + ': 未选边框可分辨');
      assert.equal(off.image, 'none');
      const total = page.locator('.pa-sheet [data-enable-toggle]');
      assert.equal(await total.evaluate(e => e.indeterminate), true, '总开关表示部分开启');
      await page.waitForFunction(() => {
        const track = document.querySelector('.pa-sheet [data-enable-toggle]')?.nextElementSibling;
        return track && getComputedStyle(track, '::after').transform === 'matrix(1, 0, 0, 1, 8, 0)';
      });
      const mixed = await total.evaluate(e => {
        const track = e.nextElementSibling;
        return { border: getComputedStyle(track).borderColor, style: getComputedStyle(track).borderStyle, knob: getComputedStyle(track, '::after').backgroundColor };
      });
      assert.equal(mixed.style, 'dashed');
      assert.ok(ratio(rgb(mixed.border), theme.bg) >= 3, theme.name + ': 混合状态边框清晰');
      assert.ok(ratio(rgb(mixed.knob), theme.bg) >= 3, theme.name + ': 居中滑块清晰');
      await enabled.check();
      assert.equal(await enabled.isChecked(), true, '外观保护不影响开关操作');
      if (theme.name === '浅色' || theme.name === '深色') await page.screenshot({ path: new URL(`./shots/theme-contrast-${mobile ? 'phone' : 'desktop'}-${theme.name === '浅色' ? 'light' : 'dark'}.png`, import.meta.url).pathname });
      console.log(`✓ ${mobile ? '手机' : '桌面'} / ${theme.name}：真实缝合预览文字、勾选、未选状态及宿主覆盖均可辨认`);
    }
    // 内置浅色/深色主题也在同一个真实预览中测量实际叠加表面。
    for (const theme of ['night', 'goose']) {
      await page.evaluate(theme => {
        window.SillyTavern.getContext().extensionSettings.mcdonalds.theme = theme;
        window.__mcdonalds.open('suture');
      }, theme);
      for (const surface of await page.evaluate(actualSurfaces)) assert.ok(ratio(surface.painted, surface.bg) >= 4.5, `${theme}: ${surface.name} 在实际表面上的对比度 ${ratio(surface.painted, surface.bg).toFixed(3)}`);
      const palette = await page.evaluate(() => {
        const cs = getComputedStyle(document.getElementById('mcd-root'));
        return ['thread', 'on-accent'].map(k => cs.getPropertyValue('--pa-' + k));
      });
      assert.ok(ratio(rgb(palette[0]), rgb(palette[1])) >= 4.5);
    }
    await page.evaluate(() => {
      window.SillyTavern.getContext().extensionSettings.mcdonalds.theme = 'follow';
      window.__mcdonalds.open('suture');
    });
    // 仅关闭预览，不确认缝合；主题变换不能修改预设数据。
    await page.click('.pa-sheet-actions .pa-btn:not(.pa-btn-primary)');
    assert.equal(await page.evaluate(() => window.__saved || 0), 0);
    await page.click('[data-g=close]');
    await page.evaluate(() => {
      const root = document.getElementById('mcd-root');
      window.__themeHiddenBefore = root._paThemeSignature;
      document.body.style.setProperty('--SmartThemeBlurTintColor', 'rgb(249, 241, 228)');
    });
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => document.getElementById('mcd-root')._paThemeSignature === window.__themeHiddenBefore), true, '隐藏后不再测量和重算主题');
    await page.evaluate(() => window.__mcdonalds.open('organize'));
    await page.waitForFunction(() => document.getElementById('mcd-root').style.getPropertyValue('--pa-tint') === 'rgb(249, 241, 228)');
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
