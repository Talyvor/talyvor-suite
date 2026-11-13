// Render SVG files to PNG with Chromium. Usage: node render.js jobs.json
// jobs: [{svg, png, width, height?, bg?, pad?}]  (height defaults from the viewBox aspect)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const j of jobs) {
    const svg = fs.readFileSync(j.svg, 'utf8');
    const vb = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
    const pad = j.pad || 0;
    const W = j.width, H = j.height || Math.round((W - 2 * pad) * vb[3] / vb[2] + 2 * pad);
    await page.setViewportSize({ width: W, height: H });
    const bg = j.bg || 'transparent';
    await page.setContent(`<!doctype html><html><body style="margin:0;background:${bg}">
      <div style="width:${W}px;height:${H}px;display:flex;align-items:center;justify-content:center">
      <div style="width:${W - 2 * pad}px;height:${H - 2 * pad}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body></html>`);
    await page.screenshot({ path: j.png, omitBackground: bg === 'transparent', clip: { x: 0, y: 0, width: W, height: H } });
  }
  await browser.close();
})();
