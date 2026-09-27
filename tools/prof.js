const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  await p.goto('file://' + process.cwd() + '/index.html');
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const S = MFApp.S; const R = new MF.Renderer(316, 281);
    const units = S.units.map(u => { u.rig.animate({phase:1, move:1, t:1}); const w = MF.matFromEuler(MF.mat(), u.x, 0, u.z, 0, 0.7, 0); return { prims: MF.updateRig(u.rig.root, w, []), pal: u.pal, x:u.x, z:u.z, radius:u.rig.radius, height:u.rig.height, selected:true}; });
    const sc = (sh) => ({ units, cam:{x:0,z:0,pitch:0.55,ox:158,oy:170}, floor:'tiles', bg:units[0].pal.bg, floorRamp:units[0].pal.floor, shadows:sh, time:0 });
    const res = {};
    for (const sh of [true,false]) { const t0=performance.now(); for (let i=0;i<30;i++) R.render(sc(sh)); res['shadows_'+sh]=(performance.now()-t0)/30; }
    res.prims = units.reduce((a,u)=>a+u.prims.length,0);
    return res;
  });
  console.log(r);
  await b.close();
})();
