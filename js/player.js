/* Player: one <audio> element, resume positions, lock-screen controls, offline copies.
   Audio URLs go through the service worker route media/<fileId> when it is running: it serves an offline copy
   if there is one, otherwise streams from Drive with the token (Library) or the API key (shared), passing the
   Range header through so seeking works. Without the SW: public files stream straight from Drive with the key. */
(function () {
  var S = window.Store, D = window.Drive, C = window.APP_CONFIG, AC = 'alp-audio';
  var BASE = location.origin + location.pathname.replace(/[^/]*$/, '');
  var a = document.createElement('audio');
  a.preload = 'auto'; a.setAttribute('playsinline', ''); document.body.appendChild(a);

  var P = {
    a: a, s: null, f: null, err: false, pend: null, lastSave: 0, cached: {}, dl: {}, art: {}, blobUrl: null,
    mode: function (sid) { var r = S.ser(sid || this.s); return r && r.src === 'lib' ? 't' : 'k'; },
    sw: function () { return !!(navigator.serviceWorker && navigator.serviceWorker.controller); },
    url: function (fid, mode) {
      var t = window.Sync && Sync.token();
      if (this.sw()) return BASE + 'media/' + fid + '?m=' + mode + (C.apiKey ? '&k=' + encodeURIComponent(C.apiKey) : '') + (t && mode === 't' ? '&t=' + encodeURIComponent(t) : '');
      if (C.apiKey && (mode === 'k' || !t)) return D.mediaUrl(fid) + '&key=' + C.apiKey;
      return null;
    },
    img: function (sid) { var f = D.folder(sid); return f && f.img ? this.url(f.img, this.mode(sid)) : null; },
    needsToken: function () { return !!this.s && this.mode() === 't' && !this.cached[this.f]; },
    files: function () { return D.files(this.s); },
    idx: function () { var fs = this.files(), f = this.f; for (var i = 0; i < fs.length; i++) if (fs[i].id === f) return i; return -1; },
    file: function () { return this.files()[this.idx()] || null; },
    playing: function () { return !!this.s && !a.paused; },
    dur: function () { return isFinite(a.duration) && a.duration > 0 ? a.duration : ((S.pr(this.f) || {}).d || D.dur(this.f) || 0); },
    cur: function () { return this.pend != null ? this.pend : (a.currentTime || 0); },

    /* which lecture "Resume" opens for a series */
    resumeFile: function (sid) {
      var fs = D.files(sid), r = S.ser(sid) || {}, i, k = -1;
      if (!fs.length) return null;
      for (i = 0; i < fs.length; i++) if (fs[i].id === r.cur) k = i;
      if (k >= 0 && !(S.pr(fs[k].id) || {}).done) return fs[k].id;
      for (i = Math.max(0, k + 1); i < fs.length; i++) if (!(S.pr(fs[i].id) || {}).done) return fs[i].id;
      for (i = 0; i < fs.length; i++) if (!(S.pr(fs[i].id) || {}).done) return fs[i].id;
      return fs[Math.max(0, k)].id;
    },
    /* after a reload: show the last lecture in the mini player without loading audio until Play */
    restore: function (sid, fid) { if (!fid) return; this.s = sid; this.f = fid; var pr = S.pr(fid) || {}; this.pend = pr.done ? 0 : (pr.p || 0); },
    /* load a lecture; at = start position (default: its saved place) */
    open: function (sid, fid, play, at) {
      if (!fid) fid = this.resumeFile(sid);
      if (!fid) return App.toast('No audio files in this folder yet');
      if (this.s && this.f && this.f !== fid) this.savePos(true);
      var pr = S.pr(fid) || {};
      if (at == null) at = pr.done ? 0 : (pr.p || 0);
      var same = this.f === fid && this.s === sid && !this.err && a.src;
      this.s = sid; this.f = fid;
      S.setNow(sid, fid);
      S.setSer(sid, { cur: fid, last: Date.now() }, true);
      if (same) { if (Math.abs(a.currentTime - at) > 2 && at) a.currentTime = at; }
      else this.setSrc(at);
      this.meta();
      if (play) this.play();
      if ((S.ser(sid) || {}).off) this.keepOffline(sid);
      App.state();
    },
    setSrc: function (at) {
      var self = this, fid = this.f, u = this.url(fid, this.mode());
      this.err = false; this.pend = at || 0;
      if (this.blobUrl) { URL.revokeObjectURL(this.blobUrl); this.blobUrl = null; }
      if (u) { a.src = u; a.load(); return; }
      // signed in, no service worker yet (first visit): fetch the whole file with the token
      var t = window.Sync && Sync.token(); if (!t) { this.err = true; return; }
      fetch(D.mediaUrl(fid), { headers: { Authorization: 'Bearer ' + t } }).then(function (r) { if (!r.ok) throw 0; return r.blob(); })
        .then(function (b) { if (self.f !== fid) return; self.blobUrl = URL.createObjectURL(b); a.src = self.blobUrl; a.load(); if (self.wantPlay) a.play().catch(function () {}); })
        .catch(function () { self.err = true; App.toast('Could not load this lecture'); App.state(); });
    },
    play: function () {
      var self = this; if (!this.s) return;
      this.wantPlay = true;
      if (this.err || !a.src) { this.setSrc(this.cur()); }
      var p = a.play(); if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError') App.state(); });
      S.setSer(this.s, { last: Date.now(), cur: this.f }, true);
    },
    pause: function () { this.wantPlay = false; a.pause(); },
    toggle: function () { if (!this.s) return; if (a.paused) this.play(); else this.pause(); },
    seek: function (t) {
      var d = this.dur(); t = Math.max(0, d ? Math.min(t, d - 0.5) : t);
      if (this.pend != null || a.readyState < 1) this.pend = t; else a.currentTime = t;
      this.savePos(true); App.tick(true); this.posState();
    },
    skip: function (sec) { this.seek(this.cur() + sec); },
    step: function (k) {   // previous / next lecture
      var fs = this.files(), i = this.idx() + k;
      if (i < 0 || i >= fs.length) return App.toast(k < 0 ? 'This is the first lecture' : 'This is the last lecture');
      this.open(this.s, fs[i].id, !a.paused || this.wantPlay);
    },
    savePos: function (sync) {
      if (!this.s || !this.f) return;
      var d = this.dur(), p = this.cur(), old = S.pr(this.f) || {};
      var patch = { p: Math.round(p), s: this.s };
      if (d) patch.d = Math.round(d);
      if (d && p > d - 20) patch.done = 1;
      if (Math.abs((old.p || 0) - patch.p) < 1 && !sync && old.d === patch.d) return;
      S.setPr(this.f, patch, !sync);
      if (patch.done && !old.done) this.checkFinished();
    },
    checkFinished: function () {
      var fs = D.files(this.s); if (!fs.length) return;
      for (var i = 0; i < fs.length; i++) if (!(S.pr(fs[i].id) || {}).done) return;
      var r = S.ser(this.s); if (r && !r.fin) { S.setSer(this.s, { fin: 1, finAt: Date.now() }); App.toast('Series finished — moved to Finished'); }
    },
    tokenChanged: function () { if (this.s && this.err) { this.setSrc(this.cur()); if (this.wantPlay) a.play().catch(function () {}); } },

    /* ---- lock screen / headset controls ---- */
    meta: function () {
      if (!('mediaSession' in navigator) || !this.s) return;
      var f = this.file(), r = S.ser(this.s) || {}, self = this, sid = this.s;
      var md = { title: f ? UI.title(f.n) : '', artist: r.name || (D.folder(sid) || {}).name || '', album: 'Lectures' };
      var set = function (art) { try { navigator.mediaSession.metadata = new MediaMetadata(Object.assign(md, art ? { artwork: [{ src: art, sizes: '512x512', type: 'image/png' }] } : {})); } catch (e) {} };
      if (this.art[sid]) set(this.art[sid]); else { set(null); this.makeArt(sid, md.artist).then(function (u) { self.art[sid] = u; if (self.s === sid) set(u); }); }
    },
    makeArt: function (sid, name) {   // the generated cover drawn on a canvas (lock screen needs a real image)
      return new Promise(function (res) {
        try {
          var c = UI.coverInfo(sid, name), cv = document.createElement('canvas'); cv.width = cv.height = 512;
          var x = cv.getContext('2d'), g = x.createLinearGradient(0, 0, 512, 512);
          g.addColorStop(0, c.c1); g.addColorStop(1, c.c2); x.fillStyle = g; x.fillRect(0, 0, 512, 512);
          x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = 2;
          for (var i = 0; i < 512; i += 64) for (var j = 0; j < 512; j += 64) { x.strokeRect(i + 18, j + 18, 28, 28); x.save(); x.translate(i + 32, j + 32); x.rotate(Math.PI / 4); x.strokeRect(-14, -14, 28, 28); x.restore(); }
          x.fillStyle = '#fff'; x.textAlign = 'right'; x.direction = c.lat ? 'ltr' : 'rtl';
          x.font = (c.lat ? '800 120px Manrope,sans-serif' : '700 120px Amiri,serif'); x.fillText(c.ar, 470, 380, 430);
          x.font = '700 30px Manrope,sans-serif'; x.textAlign = 'left'; x.direction = 'ltr'; x.globalAlpha = .85; x.fillText(c.en.toUpperCase(), 42, 460, 430);
          cv.toBlob(function (b) { res(b ? URL.createObjectURL(b) : null); }, 'image/png');
        } catch (e) { res(null); }
      });
    },
    posState: function () {
      if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
      var d = this.dur(); if (!d) return;
      try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: a.playbackRate || 1, position: Math.min(this.cur(), d) }); } catch (e) {}
    },

    /* ---- offline: current lecture + 2 before + 2 after, per series with the switch on ---- */
    scanCached: function () {
      var self = this; if (!window.caches) return Promise.resolve();
      return caches.open(AC).then(function (c) { return c.keys(); }).then(function (ks) {
        self.cached = {}; ks.forEach(function (r) { var m = r.url.match(/media\/([\w-]+)/); if (m) self.cached[m[1]] = 1; });
      }).catch(function () {});
    },
    window: function (sid) {
      var fs = D.files(sid), fid = (this.s === sid && this.f) || this.resumeFile(sid), i = 0;
      fs.forEach(function (f, k) { if (f.id === fid) i = k; });
      /* ahead: at least 2 lectures AND at least 1 hour of listening, whichever covers more (short lectures → more files) */
      var kb = 0, ks = 0, len = function (f) { return (S.pr(f.id) || {}).d || D.dur(f.id) || 0; };
      fs.forEach(function (f) { var d = len(f); if (d && f.sz) { kb += f.sz; ks += d; } });
      var bps = ks ? kb / ks : 8000, sec = 0, end = i;
      while (end + 1 < fs.length && (end - i < 2 || sec < 3600) && end - i < 30) { end++; sec += len(fs[end]) || fs[end].sz / bps; }
      return fs.slice(Math.max(0, i - 2), end + 1);
    },
    keepOffline: function (sid) {
      var self = this, want = this.window(sid), keep = {}, fs = D.files(sid), mode = this.mode(sid);
      want.forEach(function (f) { keep[f.id] = 1; });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      return caches.open(AC).then(function (c) {
        fs.forEach(function (f) { if (self.cached[f.id] && !keep[f.id] && f.id !== self.f) { c.delete(BASE + 'media/' + f.id); delete self.cached[f.id]; } });
        var todo = want.filter(function (f) { return !self.cached[f.id] && !self.dl[f.id]; });
        return todo.reduce(function (p, f) { return p.then(function () { return self.download(c, f.id, mode); }); }, Promise.resolve());
      }).then(function () { App.state(); });
    },
    download: function (c, fid, mode) {
      var self = this, t = window.Sync && Sync.token(), u = D.mediaUrl(fid), opt = {};
      if (mode === 't' && t) opt.headers = { Authorization: 'Bearer ' + t }; else if (C.apiKey) u += '&key=' + C.apiKey; else return Promise.resolve();
      this.dl[fid] = 1; App.state();
      return fetch(u, opt).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return c.put(BASE + 'media/' + fid, r).then(function () { self.cached[fid] = 1; });
      }).catch(function (e) { console.warn('offline copy failed', fid, e); })
        .then(function () { delete self.dl[fid]; App.state(); });
    },
    dropOffline: function (sid) {
      var self = this;
      return caches.open(AC).then(function (c) {
        return Promise.all(D.files(sid).map(function (f) { if (self.cached[f.id]) { delete self.cached[f.id]; return c.delete(BASE + 'media/' + f.id); } }));
      }).then(function () { App.state(); });
    },
    dropAll: function () { var self = this; return caches.delete(AC).then(function () { self.cached = {}; App.state(); }); },
    offBytes: function (sid) { var self = this, b = 0; (sid ? D.files(sid) : [].concat.apply([], Object.keys(D.c.f).map(function (k) { return D.files(k); }))).forEach(function (f) { if (self.cached[f.id]) b += f.sz; }); return b; },

    /* ---- learn lecture lengths in the background (Drive doesn't report audio duration) ---- */
    probe: function (sid) {
      var self = this; if (this.probing === sid) return; this.probing = sid;
      var pa = this.pa || (this.pa = new Audio()); pa.preload = 'metadata'; pa.muted = true;
      var list = D.files(sid).filter(function (f) { return !D.dur(f.id) && !((S.pr(f.id) || {}).d); }).slice(0, 80), i = 0;
      var next = function () {
        if (i >= list.length || App.viewSid() !== sid || navigator.onLine === false) { self.probing = null; pa.removeAttribute('src'); return; }
        var f = list[i++], u = self.url(f.id, self.mode(sid)), done = false;
        if (!u) { self.probing = null; return; }
        var fin = function () { if (done) return; done = true; clearTimeout(to); if (isFinite(pa.duration) && pa.duration > 0) { D.setDur(f.id, pa.duration); App.lengthsChanged(sid); } setTimeout(next, 150); };
        var to = setTimeout(fin, 15000);
        pa.onloadedmetadata = fin; pa.onerror = fin; pa.src = u; pa.load();
      };
      next();
    }
  };

  a.addEventListener('loadedmetadata', function () {
    if (isFinite(a.duration)) D.setDur(P.f, a.duration);
    if (P.pend != null) { var t = P.pend; P.pend = null; if (t > 0 && t < a.duration - 1) a.currentTime = t; }
    P.posState(); App.tick(true);
  });
  a.addEventListener('timeupdate', function () {
    App.tick();
    var now = Date.now(); if (now - P.lastSave > 5000) { P.lastSave = now; P.savePos(false); }
  });
  a.addEventListener('play', function () { App.state(); P.posState(); });
  a.addEventListener('pause', function () { P.savePos(true); App.state(); });
  a.addEventListener('seeked', function () { P.posState(); });
  a.addEventListener('ended', function () {
    if (!P.f) return;
    S.setPr(P.f, { p: 0, done: 1, s: P.s, d: Math.round(a.duration || 0) });
    P.checkFinished();
    var fs = P.files(), i = P.idx();
    if (i >= 0 && i < fs.length - 1) P.open(P.s, fs[i + 1].id, true, 0); else App.state();
  });
  a.addEventListener('error', function () {
    if (!P.s || !a.src || a.src === location.href) return;
    P.err = true; P.pend = P.pend != null ? P.pend : null;
    var why = navigator.onLine === false ? 'You are offline and this lecture is not saved on the phone'
      : (P.mode() === 't' && !(window.Sync && Sync.token())) ? 'Google sign-in expired — tap anywhere to resume'
        : !C.apiKey && P.mode() === 'k' ? 'Public playback is not set up yet (API key missing)' : 'Could not play this lecture';
    App.toast(why); App.state();
  });
  if ('mediaSession' in navigator) {
    var h = function (n, fn) { try { navigator.mediaSession.setActionHandler(n, fn); } catch (e) {} };
    h('play', function () { P.play(); }); h('pause', function () { P.pause(); });
    h('previoustrack', function () { P.step(-1); }); h('nexttrack', function () { P.step(1); });
    h('seekbackward', function (d) { P.skip(-(d && d.seekOffset || 10)); }); h('seekforward', function (d) { P.skip(d && d.seekOffset || 10); });
    h('seekto', function (d) { if (d && d.seekTime != null) P.seek(d.seekTime); });
  }
  window.Player = P;
})();
