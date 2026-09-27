const { chromium } = require('playwright');
(async () => {
  const [,, url, out, w, h] = process.argv;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(async()=>chromium.launch());
  const p = await b.newPage({ viewport: { width: +w || 1600, height: +h || 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await p.goto(url);
  await p.waitForTimeout(+process.env.WAIT || 800);
  await p.screenshot({ path: out, fullPage: true });
  if (errs.length) console.log('ERRORS:', errs.join('\n'));
  await b.close();
})();
