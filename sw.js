/* Service worker.
   1. App shell: precached at install, served CACHE-FIRST (opens instantly and offline; never the browser's offline page).
      Updates: the page calls reg.update() on launch → this file changes → new shell precached → takes over → one reload.
   2. Audio route media/<fileId>?m=k|t&k=<apiKey>&t=<token>: an offline copy if saved (cache 'alp-audio', never wiped by
      updates), otherwise streamed from Drive — with the signed-in token, else the API key — passing Range through.
   Bump SHELL with every release (same number as appVersion in js/config.js). */
var SHELL = 'alp-shell-v2', AUDIO = 'alp-audio', PART = 'alp-part';   // PART: half-finished downloads (see player.js)
var FILES = ['./', 'index.html', 'css/app.css', 'js/config.js', 'js/store.js', 'js/sync.js', 'js/drive.js', 'js/ui.js', 'js/player.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
var FONTS = 'alp-fonts';

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== SHELL && k !== AUDIO && k !== PART && k !== FONTS; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function rangeFrom(resp, range) {
  return resp.blob().then(function (b) {
    var type = resp.headers.get('Content-Type') || 'audio/mpeg', size = b.size;
    var m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (!m) return new Response(b, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
    var start = m[1] === '' ? Math.max(0, size - (+m[2])) : +m[1];
    var end = m[1] !== '' && m[2] !== '' ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    return new Response(b.slice(start, end + 1), { status: 206, headers: {
      'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Accept-Ranges': 'bytes' } });
  });
}
function media(req, url) {
  var id = url.pathname.split('/media/')[1], key = new URL('media/' + id, self.registration.scope).href;
  var range = req.headers.get('range');
  return caches.open(AUDIO).then(function (c) { return c.match(key, { ignoreSearch: true }); }).then(function (hit) {
    if (hit) return rangeFrom(hit, range);
    var api = 'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media&supportsAllDrives=true';
    var tok = url.searchParams.get('t'), k = url.searchParams.get('k'), h = range ? { Range: range } : {};
    var withKey = function () { return k ? fetch(api + '&key=' + encodeURIComponent(k), { headers: h }) : Promise.resolve(new Response(null, { status: 401 })); };
    if (!tok) return withKey();
    return fetch(api, { headers: Object.assign({ Authorization: 'Bearer ' + tok }, h) }).then(function (r) {
      return r.ok ? r : withKey().then(function (r2) { return r2.ok ? r2 : r; });   // public file with an expired token still plays
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin && url.pathname.indexOf('/media/') >= 0) { e.respondWith(media(req, url)); return; }
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {   // fonts: cache-first so the app looks right offline
    e.respondWith(caches.open(FONTS).then(function (c) {
      return c.match(req).then(function (hit) { return hit || fetch(req).then(function (r) { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }); });
    }));
    return;
  }
  if (url.origin !== location.origin) return;   // Google APIs go straight to the network
  if (url.pathname.endsWith('/sw.js')) return;
  e.respondWith(caches.open(SHELL).then(function (c) {
    var k = req.mode === 'navigate' ? 'index.html' : req;
    return c.match(k, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (r) { if (r.ok && req.mode !== 'navigate') c.put(req, r.clone()); return r; })
        .catch(function () { return c.match('index.html'); });
    });
  }));
});
