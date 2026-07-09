// Geometry/parity audit: asserts mock-derived layout values against the live
// app over CDP. usage: node audit.mjs <url> [--settle=ms] [--seed] [--w=390]
const [url, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split('=')));
const settle = Number(opt.settle || 8000);
const W = Number(opt.w || 390);
const H = W >= 1100 ? 900 : 844;

const tab = await (await fetch('http://localhost:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pend = new Map();
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
  else if (m.method) events.push(m.method);
};
const send = (method, params = {}) => new Promise((res) => { pend.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
// The SW is cache-first for the shell: purge it or we audit stale CSS.
await send('Storage.clearDataForOrigin', { origin: 'http://localhost:8000', storageTypes: 'service_workers,cache_storage' });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: W < 800 });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await send('Page.navigate', { url: 'http://localhost:8000/favicon.ico' });
await sleep(300);
if (opt.seed !== undefined) {
  await send('Runtime.evaluate', { expression: `localStorage.setItem('skyhue.lang','en');localStorage.setItem('skyhue.favorites', JSON.stringify([{id:'40.850,14.270',latitude:40.85,longitude:14.27,label:'Napoli'},{id:'38.720,-9.140',latitude:38.72,longitude:-9.14,label:'Lisbona'}]));` });
}
events.length = 0;
await send('Page.navigate', { url });
const t0 = Date.now();
while (!events.includes('Page.loadEventFired') && Date.now() - t0 < 30000) await sleep(50);
await sleep(settle);

const CHECKS = `(() => {
  const out = [];
  const $ = (s, root=document) => root.querySelector(s);
  const w = (el) => el ? Math.round(el.getBoundingClientRect().width) : null;
  const h = (el) => el ? Math.round(el.getBoundingClientRect().height) : null;
  const cs = (el, p) => el ? getComputedStyle(el)[p] : null;
  const near = (a, b, tol=2) => a != null && Math.abs(a - b) <= tol;
  const add = (name, ok, got, want) => out.push({ name, ok: !!ok, got: String(got), want: String(want) });

  const home = $('#home') && !$('#home').hidden && !$('#results')?.offsetHeight;
  if ($('#home') && $('#home').offsetParent !== null) {
    // 2a — home. Mock: segmented full-width, equal halves (line 350-353).
    const modes = $('#home .modes'); const search = $('#home .search');
    if (modes && search) {
      add('2a modes full width == search width', near(w(modes), w(search)), w(modes), w(search));
      const ms = modes.querySelectorAll('.mode');
      if (ms.length === 2) add('2a mode segments equal width', near(w(ms[0]), w(ms[1]), 3), w(ms[0]) + '/' + w(ms[1]), 'equal');
    }
    const sun = $('.home__sun');
    if (sun) { const wantSun = innerWidth >= 1100 ? 170 : 110; add('2a sun glow ' + wantSun + 'px', near(w(sun), wantSun), w(sun), wantSun); }
    const sw = $('#home .place .swatch');
    if (sw) add('2a favourite swatch 56px', near(w(sw), 56), w(sw), 56);
    const pc = $('.place-compare'); const fav = $('#favorites');
    if (pc && fav) add('2a compare full width', near(w(pc), w(fav), 4), w(pc), w(fav));
    const geo = $('.search__geo');
    if (geo) add('2a geo pin square 36px', near(w(geo), 36) && near(h(geo), 36), w(geo) + 'x' + h(geo), '36x36');
    const cta = $('.mapcta');
    if (cta) add('2a map CTA full width', near(w(cta), w(search), 4), w(cta), w(search));
  }
  if ($('#results') && $('#results').offsetParent !== null) {
    // 1b hero. Mock: meter 170x6 (line 861), toggle inline (868).
    const meter = $('.rhero__meter');
    if (meter) {
      const want = innerWidth >= 1100 ? 220 : 170; // v3 desktop meter is 220px
      add('1b meter ' + want + 'x6', near(w(meter), want) && near(h(meter), 6), w(meter) + 'x' + h(meter), want + 'x6');
    }
    const fill = $('.rhero__meterfill');
    if (fill) add('1b meter fill is gradient', cs(fill, 'backgroundImage').includes('linear-gradient'), cs(fill, 'backgroundImage').slice(0, 40), 'linear-gradient');
    const tog = $('.rcontent .modes--compact');
    if (tog) add('1b toggle inline (not full width)', w(tog) < 300, w(tog), '< 300');
    // week
    const dots = [...document.querySelectorAll('.wk__dot')].map((d) => Math.round(d.getBoundingClientRect().width * 10) / 10);
    if (dots.length) add('1b week dots scale with score', new Set(dots).size > 1 && Math.min(...dots) >= 6.5 && Math.max(...dots) <= 11.5, dots.join(','), '7-11px, varied');
    const wkScore = $('.wk__score');
    if (wkScore) add('1b week numeral 0.82rem', near(parseFloat(cs(wkScore, 'fontSize')), 13.1, 0.5), cs(wkScore, 'fontSize'), '13.12px');
    // stats — v3: data values are JetBrains Mono 600 ~1.15rem (scores stay Bricolage)
    const statV = $('.stat__v');
    if (statV) add('1b stat value mono 1.15rem (v3)', near(parseFloat(cs(statV, 'fontSize')), 18.4, 0.5) && cs(statV, 'fontFamily').includes('JetBrains'), cs(statV, 'fontSize') + ' ' + cs(statV, 'fontFamily').slice(0, 16), '18.4px JetBrains');
    const grid = $('.statgrid');
    if (grid) add('1b statgrid 2 cols', cs(grid, 'gridTemplateColumns').split(' ').length === 2, cs(grid, 'gridTemplateColumns'), '2 cols');
    // intro strong gold
    const istr = $('.rintro strong');
    if (istr) add('1b intro dir highlighted', cs(istr, 'color') !== cs($('.rintro'), 'color'), cs(istr, 'color'), 'gold, not body color');
    // 3b chart + swatches
    const tsw = $('.trendsw');
    if (tsw) add('3b swatch tile 44px tall', near(h(tsw), 44), h(tsw), 44);
    const center = $('.trendsw--center');
    if (center) add('3b centre tile outlined', cs(center, 'outlineWidth') === '2px', cs(center, 'outlineWidth'), '2px');
    const val = $('.arc__val');
    if (val) add('3b peak value 17px', cs(val, 'fontSize') === '17px', cs(val, 'fontSize'), '17px');
    const dot = $('.arc__dot');
    if (dot) add('3b hour dots hollow (stroked)', parseFloat(cs(dot, 'strokeWidth')) >= 2, cs(dot, 'strokeWidth'), '>=2');
    // 3a
    const link = $('#why-more');
    if (link) {
      const parentW = w(link.parentElement);
      const centered = Math.abs((link.getBoundingClientRect().left - link.parentElement.getBoundingClientRect().left) - (link.parentElement.getBoundingClientRect().right - link.getBoundingClientRect().right)) < 6;
      add('3a show-all centered accent text', centered && cs(link, 'borderTopWidth') === '0px', 'centered=' + centered + ' border=' + cs(link, 'borderTopWidth'), 'centered, no border');
    }
    const up = $('.driver--upside');
    if (up) add('3a upside full dashed border', cs(up, 'borderTopStyle') === 'dashed' && cs(up, 'borderRightStyle') === 'dashed', cs(up, 'borderTopStyle') + '/' + cs(up, 'borderRightStyle'), 'dashed/dashed');
    // 3c
    const spotSw = $('.spot .swatch--lg');
    if (spotSw) add('3c spot thumb 64px + custom grad', near(w(spotSw), 64) && spotSw.style.background.includes('linear-gradient'), w(spotSw) + ', inline-grad=' + !!spotSw.style.background, '64, true');
    const meta = $('.spot__meta');
    if (meta) add('3c meta uppercase mono', cs(meta, 'textTransform') === 'uppercase', cs(meta, 'textTransform'), 'uppercase');
    const scan = $('.scan-btn');
    if (scan) add('3c scan button dashed', cs(scan, 'borderTopStyle') === 'dashed', cs(scan, 'borderTopStyle'), 'dashed');
    // v3 premium pass
    add('v3 grain on results hero', !!$('.rhero .grain'), !!$('.rhero .grain'), true);
    const sunDisc = $('.rhero__sun');
    if (sunDisc) add('v3 hero sun disc blurred', cs(sunDisc, 'filter').includes('blur'), cs(sunDisc, 'filter'), 'blur(1px)');
    const chipV = $('.chip strong');
    if (chipV) add('v3 chip times mono', cs(chipV, 'fontFamily').includes('JetBrains'), cs(chipV, 'fontFamily').slice(0, 20), 'JetBrains Mono');
    const prim = $('.btn--primary');
    if (prim) add('v3 CTA gradient + inset', cs(prim, 'backgroundImage').includes('linear-gradient') && cs(prim, 'boxShadow').includes('inset'), 'grad=' + cs(prim, 'backgroundImage').includes('linear-gradient') + ' inset=' + cs(prim, 'boxShadow').includes('inset'), 'true true');
    const bar = $('.addsup__bar');
    if (bar) add('3a segment bar 14px/7px', near(h(bar), 14) && cs(bar, 'borderTopLeftRadius') === '7px', h(bar) + '/' + cs(bar, 'borderTopLeftRadius'), '14/7px');
    // v3 desktop (≥1100px)
    if (innerWidth >= 1100) {
      const rh = $('.rhero');
      if (rh) add('desk hero band 330px', near(h(rh), 330), h(rh), 330);
      const rc = $('.rcontent');
      if (rc) add('desk 2-col grid + 40px gap', cs(rc, 'display') === 'grid' && cs(rc, 'gridTemplateColumns').split(' ').length === 2 && cs(rc, 'columnGap') === '40px', cs(rc, 'display') + ' ' + cs(rc, 'columnGap'), 'grid 40px');
      const hl = $('.verdict__headline');
      if (hl) add('desk headline single-line 3.8rem', cs(hl, 'whiteSpace') === 'normal' && near(parseFloat(cs(hl, 'fontSize')), 60.8, 1), cs(hl, 'whiteSpace') + ' ' + cs(hl, 'fontSize'), 'normal 60.8px');
      const mt = $('.rhero__meter');
      if (mt) add('desk meter 220px', near(w(mt), 220), w(mt), 220);
      const wkSect = $('.sect--week');
      if (wkSect && rc) add('desk week ribbon full-width', near(w(wkSect), w(rc) - parseFloat(cs(rc, 'paddingLeft')) - parseFloat(cs(rc, 'paddingRight')), 6), w(wkSect), 'content width');
    }
  }
  if ($('#home') && $('#home').offsetParent !== null) {
    add('v3 grain on home hero', !!$('.home__hero .grain'), !!$('.home__hero .grain'), true);
    if (innerWidth >= 1100) {
      const fv = $('#favorites');
      if (fv && fv.children.length >= 3) add('desk favourites 3-up grid', cs(fv, 'display') === 'grid' && cs(fv, 'gridTemplateColumns').split(' ').length === 3, cs(fv, 'display') + ' ' + cs(fv, 'gridTemplateColumns').split(' ').length, 'grid 3');
      const hh = $('.home__headline');
      if (hh) add('desk home headline 6.4rem', near(parseFloat(cs(hh, 'fontSize')), 102.4, 1), cs(hh, 'fontSize'), '102.4px');
    }
  }
  return out;
})()`;

const r = await send('Runtime.evaluate', { expression: CHECKS, returnByValue: true });
const rows = r.result?.value || [];
let fail = 0;
for (const c of rows) {
  if (!c.ok) fail++;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  (got ${c.got}, want ${c.want})`);
}
console.log(`\n${rows.length - fail}/${rows.length} checks passed`);
ws.close();
process.exit(fail ? 1 : 0);
