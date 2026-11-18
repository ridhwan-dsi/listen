/* End-to-end test with a simulated Google Drive (node tools/e2e.js; needs playwright).
   Serves the repo at http://localhost:8765/listen/, fakes the Drive API (the API key only works with a /listen/ Referer,
   like the real referrer-restricted key), and stands in for the phone folder with the browser's private file system. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 8765, ORIGIN = 'http://localhost:' + PORT, APP = ORIGIN + '/listen/';
const FOLDER = 'application/vnd.google-apps.folder';

/* ---------- static server ---------- */
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]).replace(/^\/listen/, ''); if (p === '/' || p === '') p = '/index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});

/* ---------- fake Drive ---------- */
const KB = 1024;
const bytes = (id, n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + id.charCodeAt(0) * 7 + id.length) & 255; return b; };
const drive = {
  SHARED0001: { name: 'Shared Series', mimeType: FOLDER, parents: [], pub: true },
  sh1: { name: '01 Intro.mp3', parents: ['SHARED0001'], size: 150 * KB, pub: true }, sh2: { name: '02 Next.mp3', parents: ['SHARED0001'], size: 90 * KB, pub: true },
  sh3: { name: '03 Third.mp3', parents: ['SHARED0001'], size: 70 * KB, pub: true },
  LIB: { name: 'My Lectures', mimeType: FOLDER, parents: [] },
  LS: { name: 'Fiqh: Part 1', mimeType: FOLDER, parents: ['LIB'] },
  ls1: { name: 'Lesson 1.mp3', parents: ['LS'], size: 130 * KB }, ls2: { name: 'Lesson 2.mp3', parents: ['LS'], size: 60 * KB }
};
let seq = 0, flaky = 0, hideRange = false, stats = { keyBlocked: 0, keyOk: 0, media: 0, uploads: 0 }, sessions = {};
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Location, Range, Content-Length', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS' };
const json = (route, code, obj, extra) => route.fulfill({ status: code, headers: Object.assign({ 'Content-Type': 'application/json' }, cors, extra || {}), body: JSON.stringify(obj) });
async function fakeDrive(route) {
  const req = route.request(), u = new URL(req.url()), h = req.headers(), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const tok = (h.authorization || '') === 'Bearer TOK', key = u.searchParams.get('key');
  if (!tok && key) {
    if (!(h.referer || '').startsWith(APP)) { stats.keyBlocked++; return json(route, 403, { error: { message: 'Requests from referer ' + (h.referer || '<empty>') + ' are blocked.' } }); }
    stats.keyOk++;
  }
  const can = id => drive[id] && (tok || drive[id].pub);
  // uploads
  if (u.pathname.startsWith('/upload/drive/v3/files') && u.searchParams.get('uploadType') !== 'resumable') return json(route, 200, { id: 'APPDATA1' });   // Sync's lectures.json
  if (u.pathname.startsWith('/upload/drive/v3/files') && m === 'POST') {
    if (!tok) return json(route, 401, { error: { message: 'auth' } });
    const meta = JSON.parse(req.postData()), sid = 'up' + (++seq); sessions[sid] = { meta, size: +h['x-upload-content-length'], got: Buffer.alloc(0) };
    return route.fulfill({ status: 200, headers: Object.assign({ Location: 'https://www.googleapis.com/upload/session/' + sid }, cors), body: '' });
  }
  if (u.pathname.startsWith('/upload/session/') && m === 'PUT') {
    const s = sessions[u.pathname.split('/').pop()], cr = h['content-range'], body = req.postDataBuffer() || Buffer.alloc(0);
    if (/\*\//.test(cr)) return route.fulfill({ status: 308, headers: Object.assign(s.got.length ? { Range: 'bytes=0-' + (s.got.length - 1) } : {}, cors) });
    s.got = Buffer.concat([s.got, body]);
    if (s.got.length < s.size) return route.fulfill({ status: 308, headers: Object.assign({ Range: 'bytes=0-' + (s.got.length - 1) }, cors) });
    const id = 'u' + (++seq); drive[id] = { name: s.meta.name, parents: s.meta.parents, size: s.size, data: s.got }; stats.uploads++;
    return json(route, 200, { id });
  }
  const mm = u.pathname.match(/^\/drive\/v3\/files\/([\w-]+)$/);
  if (mm && m === 'PATCH') { if (!tok) return json(route, 401, {}); drive[mm[1]].trashed = true; return json(route, 200, { id: mm[1] }); }
  if (u.pathname === '/drive/v3/files' && m === 'POST') {
    if (!tok) return json(route, 401, {}); const meta = JSON.parse(req.postData()), id = 'F' + (++seq);
    drive[id] = Object.assign({}, meta); return json(route, 200, { id });
  }
  if (mm && u.searchParams.get('alt') === 'media') {
    const f = drive[mm[1]]; if (!can(mm[1])) return json(route, 404, { error: { message: 'File not found' } });
    stats.media++;
    if (flaky > 0) { flaky--; return json(route, 500, { error: { message: 'backend error' } }); }
    const data = f.data || bytes(mm[1], f.size), rg = /bytes=(\d+)-(\d*)/.exec(h.range || '');
    if (!rg) return route.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': 'audio/mpeg' }, cors), body: data });
    const a = +rg[1], b = Math.min(rg[2] ? +rg[2] : data.length - 1, data.length - 1);
    if (a >= data.length) return route.fulfill({ status: 416, headers: cors });
    const hd = Object.assign({ 'Content-Type': 'audio/mpeg' }, cors);
    if (!hideRange) hd['Content-Range'] = 'bytes ' + a + '-' + b + '/' + data.length; else hd['Access-Control-Expose-Headers'] = 'Location';
    return route.fulfill({ status: 206, headers: hd, body: data.slice(a, b + 1) });
  }
  if (mm) { const f = drive[mm[1]]; if (!can(mm[1]) || f.trashed) return json(route, 404, { error: { message: 'File not found' } }); return json(route, 200, { id: mm[1], name: f.name, mimeType: f.mimeType || 'audio/mpeg' }); }
  if (u.pathname === '/drive/v3/files') {
    const q = u.searchParams.get('q') || '', parents = [...q.matchAll(/'([\w-]+)' in parents/g)].map(x => x[1]), onlyF = /mimeType='application\/vnd.google-apps.folder'/.test(q);
    const files = Object.keys(drive).filter(id => !drive[id].trashed && drive[id].parents && drive[id].parents.some(p => parents.includes(p)) && can(id) && (!onlyF || drive[id].mimeType === FOLDER))
      .map(id => ({ id, name: drive[id].name, mimeType: drive[id].mimeType || 'audio/mpeg', size: drive[id].size ? String(drive[id].size) : undefined, createdTime: new Date(drive[id].ct || 1700000000000).toISOString(), parents: drive[id].parents }));
    return json(route, 200, { files });
  }
  if (u.pathname.includes('oauth2/v3/userinfo')) return json(route, 200, { email: 'r@example.com', given_name: 'R' });
  return json(route, 404, { error: { message: 'unmocked ' + u.pathname } });
}

/* ---------- checks ---------- */
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(page, fn, arg, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await sleep(150); } return false; }

const INIT = `
  // the phone folder: a folder in the browser's private file system
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Phone', { create: true });
  // controllable network type
  const net = new EventTarget(); net.type = 'wifi'; Object.defineProperty(navigator, 'connection', { get: () => net });
  window.__setNet = t => { net.type = t; net.dispatchEvent(new Event('change')); };
  window.__fixtures = true;
`;
const seedSignedIn = `localStorage.setItem('alp.tok', JSON.stringify({ tok: 'TOK', exp: Date.now() + 3600e3, acct: 'r@example.com', scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.appdata' }));
  Store.d.acct = 'r@example.com'; Store.d.lib = { id: 'LIB', name: 'My Lectures', u: 1 }; Store.persist();`;
async function home(page) { await page.evaluate(() => { Store.d.ui = { tab: 'listen' }; Store.persist(); Store.persist = function () {}; }); await page.goto(APP); await page.evaluate(() => { Player.CH = 64 * 1024; }); await sleep(300); }
async function phoneFiles(page, dir) {
  return page.evaluate(async d => { try { const r = await (await navigator.storage.getDirectory()).getDirectoryHandle('Phone'); const h = await r.getDirectoryHandle(d); const out = {}; for await (const [n, f] of h.entries()) if (f.kind === 'file') out[n] = (await f.getFile()).size; return out; } catch (e) { return null; } }, dir);
}

(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 400, height: 860 } });
  await ctx.route(/googleapis\.com|accounts\.google\.com\/gsi/, r => r.request().url().includes('gsi/client') ? r.fulfill({ status: 200, body: '' }) : fakeDrive(r));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const fast = () => page.evaluate(() => { Player.CH = 64 * 1024; Up && 0; });

  console.log('1. Shared link (API key, no sign-in) — the referrer fix');
  await page.goto(APP + '#s=SHARED0001'); await fast();
  ok(await until(page, () => /Add it to Shared/.test(document.body.innerText)), 'shared folder opens with the API key'); if (!pass) { console.log(await page.innerText('body'), errs, stats); }
  ok(stats.keyBlocked === 0 && stats.keyOk > 0, 'key requests carry the /listen/ address (blocked ' + stats.keyBlocked + ', ok ' + stats.keyOk + ')');
  await page.click('[data-act="addPlay"]'); await sleep(300);
  await page.evaluate(() => Player.pause());

  console.log('2. Series screen: one Downloads button, old download controls gone');
  await home(page);
  await page.evaluate(() => { history.pushState({}, ''); });
  await page.click('[data-act="tab"][data-t="shared"]'); await page.click('[data-act="ser"][data-id="SHARED0001"]'); await sleep(200);
  ok(await page.$('[data-act="fdl"][data-id="SHARED0001"]') !== null, 'Downloads button on the series screen');
  ok(await page.$('[data-act="dlSheet"], [data-act="lecMenu"], .off [data-act="offTg"]') === null, 'no Download sheet, ⋯ menu or nearby switch on the series screen');

  console.log('3. Downloads page → whole folder, inside the app (no phone folder yet), Content-Range hidden');
  await page.click('[data-act="fdl"][data-id="SHARED0001"]'); await sleep(200);
  const txt = await page.innerText('.scr');
  ok(/Keep nearby lectures offline/.test(txt) && /Download whole folder/.test(txt) && /Wi-Fi/.test(txt) && /Mobile data/.test(txt), 'page shows nearby, whole folder, Wi-Fi, mobile data');
  ok(await page.evaluate(() => { const b = document.querySelectorAll('[data-act="netTg"] .box'); return b[0].classList.contains('on') && !b[1].classList.contains('on'); }), 'Wi-Fi ticked, mobile data not, by default');
  hideRange = true; flaky = 3;
  await page.evaluate(() => { window.showDirectoryPicker = () => Promise.reject(new DOMException('cancel', 'AbortError')); });
  await page.click('[data-act="fullTg"]');
  await page.evaluate(() => setInterval(() => Player.kick(), 1500));   // skip the back-off waits in the test
  ok(await until(page, () => ['sh1', 'sh2', 'sh3'].every(id => Player.cached[id] === 1), null, 30000), 'whole folder downloaded into the app despite 3 server errors (kept retries)');
  ok(await page.evaluate(async () => { const c = await caches.open('alp-audio'); const r = await c.match(location.origin + '/listen/media/sh1'); return r && (await r.blob()).size === 150 * 1024; }), 'saved file has the full size (no cut-short copy)');
  hideRange = false;

  console.log('4. Choose a phone folder; new lecture added in Drive is picked up on open');
  await page.evaluate(() => { delete window.showDirectoryPicker; });
  await home(page);
  await page.evaluate(async () => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Phone', { create: true }); });
  await page.evaluate(() => App.toast(''));
  await page.evaluate(() => { history.pushState({}, ''); }); await page.click('[data-act="tab"][data-t="shared"]'); await page.click('[data-act="ser"][data-id="SHARED0001"]'); await page.click('[data-act="fdl"]');
  await page.click('[data-act="pickFolder"]');
  ok(await until(page, () => Local.ok()), 'phone folder chosen');
  drive.sh4 = { name: '04 Added later.mp3', parents: ['SHARED0001'], size: 80 * KB, pub: true, ct: Date.now() };
  await home(page);
  ok(await until(page, () => Player.cached.sh4 === 'L', null, 20000), 'new Drive lecture found on open and downloaded to the phone folder');
  const pf = await phoneFiles(page, 'Shared Series');
  ok(pf && pf['04 Added later.mp3'] === 80 * KB, 'file is in Phone/Shared Series/ with the right size');
  ok(await page.evaluate(() => Local.file('sh4').then(f => f.size)) === 80 * KB, 'plays from the phone file');

  console.log('5. Network rules per folder');
  await page.evaluate(() => { __setNet('cellular'); Player.setCfg('SHARED0001', { full: 1 }); });
  drive.sh5 = { name: '05 Mobile.mp3', parents: ['SHARED0001'], size: 40 * KB, pub: true, ct: Date.now() };
  await page.evaluate(() => Drive.refreshFolder('SHARED0001', 'k'));
  await sleep(1500);
  ok(await page.evaluate(() => !Player.cached.sh5 && (Player.dl.sh5 || {}).w === 'wifi'), 'on mobile data it waits for Wi-Fi');
  await page.evaluate(() => { history.pushState({}, ''); });
  await home(page); await page.evaluate(() => __setNet('cellular'));
  await page.evaluate(() => { Player.setCfg('SHARED0001', { mob: 1 }); Player.kick(); });
  ok(await until(page, () => !!Player.cached.sh5), 'ticking Mobile data lets it download');
  await page.evaluate(() => { __setNet('wifi'); Player.setCfg('SHARED0001', { mob: 0 }); });

  console.log('6. Settings: no mobile-data switch; phone folder row');
  await page.click('.av'); await sleep(200);
  const st = await page.innerText('.scr');
  ok(!/Download using mobile data/.test(st) && /phone folder/i.test(st), 'Settings has the phone folder, not the mobile-data switch');

  console.log('7. Signed in: Library + a folder added on the phone → upload to Drive');
  await page.evaluate(seedSignedIn => eval(seedSignedIn), seedSignedIn);
  await page.evaluate(async () => { const r = await (await navigator.storage.getDirectory()).getDirectoryHandle('Phone'); const d = await r.getDirectoryHandle('My Talks', { create: true });
    for (const [n, sz] of [['Talk A.mp3', 100 * 1024], ['Talk B.mp3', 20 * 1024]]) { const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(new Uint8Array(sz).fill(7)); await w.close(); } });
  await home(page); await page.evaluate(() => { Sync.scope = 'https://www.googleapis.com/auth/drive'; });
  ok(await until(page, () => !!Store.ser('L:My Talks')), '“My Talks” appears as an On-this-phone series');
  await page.evaluate(() => { Store.setPr('L:My Talks/Talk A.mp3', { p: 40, d: 100, s: 'L:My Talks' }); Store.setSer('L:My Talks', { star: 1 }); });
  await page.click('[data-act="tab"][data-t="lib"]'); await sleep(300);
  ok(/On this phone/.test(await page.innerText('.scr')), 'Library shows the “On this phone” section');
  await page.evaluate(() => { history.pushState({}, ''); }); await page.click('[data-act="ser"][data-id="L:My Talks"]'); await page.click('[data-act="fdl"]'); await sleep(200);
  ok(/Upload to Drive/.test(await page.innerText('.scr')), 'phone folder offers Upload to Drive');
  await page.evaluate(() => { Up.CH = 0; });
  await page.click('[data-act="upTg"]');
  ok(await until(page, () => !Store.ser('L:My Talks') && Object.values(Store.d.series).some(r => r.name === 'My Talks' && r.src === 'lib'), null, 20000), 'uploaded: it is now a Library series');
  const newId = await page.evaluate(() => Object.values(Store.d.series).find(r => r.name === 'My Talks').id);
  ok(stats.uploads === 2 && Object.values(drive).filter(f => f.parents && f.parents.includes(newId)).length === 2, 'both files are in a “My Talks” folder inside the Library folder in Drive');
  ok(await page.evaluate(id => { const f = Drive.files(id).find(x => x.n === 'Talk A.mp3'); return f && Store.pr(f.id).p === 40 && Store.ser(id).star === 1 && Player.cached[f.id] === 'L'; }, newId), 'place, star and the phone copies carried over');

  console.log('8. Finished folder → asks where to delete');
  await home(page);
  await page.evaluate(() => { Player.open('SHARED0001', 'sh1', false); Drive.files('SHARED0001').forEach(f => Store.setPr(f.id, { p: 0, d: 10, done: 1, s: 'SHARED0001' })); Player.checkFinished(); });
  ok(await until(page, () => /You finished/.test((document.getElementById('dlgw') || {}).innerText || '')), 'finish dialog appears');
  const dlg = await page.innerText('#dlgw');
  ok(/Delete from this phone/.test(dlg) && !/Delete from Google Drive/.test(dlg), 'shared series: phone only (not his Drive folder)');
  await page.click('[data-act="finDel"][data-w="phone"]');
  ok(await until(page, () => !Object.keys(Player.cached).some(k => /^sh/.test(k))), 'phone copies deleted');
  ok(await phoneFiles(page, 'Shared Series') === null, 'its phone sub-folder is gone');
  await page.evaluate(id => { Player.open(id, null, false); Drive.files(id).forEach(f => Store.setPr(f.id, { p: 0, d: 10, done: 1, s: id })); Player.checkFinished(); }, newId);
  ok(await until(page, () => /Delete from Google Drive/.test((document.getElementById('dlgw') || {}).innerText || '')), 'Library series: offers phone, Drive and both');
  await page.click('[data-act="finDel"][data-w="both"]');
  ok(await until(page, () => true) && await (async () => { for (let i = 0; i < 40 && !drive[newId].trashed; i++) await sleep(150); return !!drive[newId].trashed; })(), 'Drive folder moved to trash');

  console.log('9. Library series download with the token; desktop view renders the page');
  await page.evaluate(() => { Store.setSer('LS', { name: 'Fiqh: Part 1', src: 'lib', seen: Date.now() }); return Drive.refreshFolder('LS', 't').then(() => { Player.setCfg('LS', { full: 1 }); Player.fullSync('LS'); Player.kick(); }); });
  ok(await until(page, () => Player.cached.ls1 === 'L' && Player.cached.ls2 === 'L'), 'private Library lectures downloaded (token)');
  const pf2 = await phoneFiles(page, 'Fiqh_ Part 1');
  ok(pf2 && pf2['Lesson 1.mp3'] === 130 * KB, 'saved under a safe folder name (“Fiqh_ Part 1”)');
  await page.setViewportSize({ width: 1300, height: 850 }); await page.evaluate(() => { Store.d.ui.desk = 1; App.render(); });
  await sleep(300); await page.click('.side [data-act="tab"][data-t="lib"]'); await page.click('[data-act="ser"][data-id="LS"]'); await page.click('[data-act="fdl"]'); await sleep(300);
  ok(/Download whole folder/.test(await page.innerText('.main')), 'desktop: Downloads page in the main column');
  await page.screenshot({ path: '/tmp/e2e-desk.png' });
  await page.setViewportSize({ width: 400, height: 860 }); await page.evaluate(() => { Store.d.ui.desk = 0; App.render(); });
  await page.evaluate(() => { history.pushState({}, ''); }); await page.click('[data-act="tab"][data-t="lib"]').catch(() => {});
  await home(page); await page.evaluate(() => { history.pushState({}, ''); }); await page.click('[data-act="tab"][data-t="lib"]'); await page.click('[data-act="ser"][data-id="LS"]'); await sleep(200);
  await page.screenshot({ path: '/tmp/e2e-series.png' }); await page.click('[data-act="fdl"]'); await sleep(200); await page.screenshot({ path: '/tmp/e2e-fdl.png', fullPage: true });

  ok(!errs.filter(e => !/Failed to load resource|favicon|net::/.test(e)).length, 'no script errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
