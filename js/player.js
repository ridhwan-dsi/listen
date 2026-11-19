/* Player: one <audio> element, resume positions, lock-screen controls, offline copies.
   Audio URLs go through the service worker route media/<fileId> when it is running: it serves an offline copy
   if there is one, otherwise streams from Drive with the token (Library) or the API key (shared), passing the
   Range header through so seeking works. Without the SW: public files stream straight from Drive with the key. */
(function () {
  var S = window.Store, D = window.Drive, C = window.APP_CONFIG, AC = 'alp-audio', PART = 'alp-part';
  var BASE = location.origin + location.pathname.replace(/[^/]*$/, '');
  var a = document.createElement('audio');
  a.preload = 'auto'; a.setAttribute('playsinline', ''); document.body.appendChild(a);

  var P = {
    a: a, s: null, f: null, CH: 8 * 1024 * 1024, err: false, pend: null, lastSave: 0, cached: {}, dl: {}, art: {}, blobUrl: null,
    mode: function (sid) { var r = S.ser(sid || this.s); return r && r.src === 'lib' ? 't' : 'k'; },
    sw: function () { return !!(navigator.serviceWorker && navigator.serviceWorker.controller); },
    url: function (fid, mode) {
      var t = window.Sync && Sync.token();
      if (this.sw()) return BASE + 'media/' + fid + '?m=' + mode + (C.apiKey ? '&k=' + encodeURIComponent(C.apiKey) : '') + (t && mode === 't' ? '&t=' + encodeURIComponent(t) : '');
      if (C.apiKey && (mode === 'k' || !t)) return D.mediaUrl(fid) + '&key=' + C.apiKey;
      return null;
    },
    img: function (sid) { var f = D.folder(sid); return f && f.img ? this.url(f.img, this.mode(sid)) : null; },
    needsToken: function () { var self = this; return (!!this.s && this.mode() === 't' && !this.cached[this.f]) || Object.keys(this.dl).some(function (k) { return self.dl[k].w === 'auth'; }); },
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
      var self = this; clearTimeout(this.offT);
      if ((S.ser(sid) || {}).off) this.offT = setTimeout(function () { if (self.s === sid) self.keepOffline(sid); }, 5000);
      App.state();
    },
    setSrc: function (at) {
      var self = this, fid = this.f, u = this.url(fid, this.mode());
      this.err = false; this.pend = at || 0;
      if (this.blobUrl) { URL.revokeObjectURL(this.blobUrl); this.blobUrl = null; }
      if (this.cached[fid] === 'L' && window.Local) {   // saved in the phone folder: play the file itself
        Local.file(fid).then(function (file) {
          if (self.f !== fid) return; self.blobUrl = URL.createObjectURL(file); a.src = self.blobUrl; a.load(); if (self.wantPlay) a.play().catch(function () {});
        }, function () { delete self.cached[fid]; if (self.f === fid) self.setSrc(at); });
        return;
      }
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
      var r = S.ser(this.s); if (r && !r.fin) { S.setSer(this.s, { fin: 1, finAt: Date.now() }); App.toast('Series finished — moved to Finished'); App.finished(this.s); }
    },
    tokenChanged: function () { if (this.s && this.err) { this.setSrc(this.cur()); if (this.wantPlay) a.play().catch(function () {}); } this.kick(); if (window.Up) Up.pump(); },

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

    /* ---- offline copies ----
       One download queue, one file at a time. Kept = whole-folder downloads (and older manual ones): never removed
       automatically (Store.d.dl.kept). Auto = the nearby-lectures window of a series; cleared as the window moves on.
       Where: the series' sub-folder of the phone folder when one is chosen (Local), otherwise inside the app ('alp-audio').
       Files come down in 8 MB pieces (HTTP Range) kept in cache 'alp-part', so a dropped connection or a closed app
       resumes from the last piece; the pieces are then joined into the saved file, after checking the size.
       Never holds up listening: waits while the streamed lecture has under 45 s buffered.
       Network: per series (Store.d.dl.f[sid] = { wifi, mob, full, up }): Wi-Fi on, mobile data off by default.
       Kept downloads never give up (retry every few minutes); a sign-in that ran out waits instead of failing. */
    q: [], running: null, force: {}, paused: {},   // per series, this session only: Force start (ignores the Wi-Fi rule and the buffering pause, goes first) / Pause
    kept: function (fid) { return !!S.d.dl.kept[fid]; },
    cfg: function (sid) { var f = S.d.dl.f[sid] || {}; return { wifi: f.wifi == null ? 1 : f.wifi, mob: f.mob ? 1 : 0, full: f.full ? 1 : 0, up: f.up ? 1 : 0 }; },
    setCfg: function (sid, patch) { var f = S.d.dl.f[sid] = S.d.dl.f[sid] || {}; Object.keys(patch).forEach(function (k) { f[k] = patch[k]; }); S.persist(); },
    net: function () { var c = navigator.connection; return c && c.type && c.type !== 'unknown' ? c.type : null; },
    netKnown: function () { return !!this.net(); },
    /* why this series may not download right now: 'off' | 'wifi' (waiting for Wi-Fi) | 'mob' (Wi-Fi not allowed) | 'none' */
    blockedFor: function (sid) {
      if (navigator.onLine === false) return 'off';
      if (this.paused[sid]) return 'pause';
      if (this.force[sid]) return null;
      var c = this.cfg(sid), t = this.net();
      if (!c.wifi && !c.mob) return 'none';
      if (t === 'cellular') return c.mob ? null : 'wifi';
      if (t && !c.wifi) return 'mob';
      return null;
    },
    size: function (sid, fid) { var f = D.files(sid).filter(function (x) { return x.id === fid; })[0]; return (f && f.sz) || 0; },
    inQ: function (fid) { for (var i = 0; i < this.q.length; i++) if (this.q[i].f === fid) return this.q[i]; return null; },
    scanCached: function () {
      var self = this; if (!window.caches) return Promise.resolve();
      return caches.open(AC).then(function (c) { return c.keys(); }).then(function (ks) {
        Object.keys(self.cached).forEach(function (k) { if (self.cached[k] === 1) delete self.cached[k]; });
        ks.forEach(function (r) { var m = r.url.match(/media\/([\w-]+)/); if (m && !self.cached[m[1]]) self.cached[m[1]] = 1; });
      }).catch(function () {});
    },
    /* on launch and when the app comes back: finish kept downloads, pick up new files in whole-folder series,
       refill the nearby window, and retry everything that was waiting — straight away */
    resumeQueue: function () {
      var self = this, k = S.d.dl.kept, by = {};
      Object.keys(k).forEach(function (fid) { if (!self.cached[fid]) (by[k[fid].s] = by[k[fid].s] || []).push(fid); });
      Object.keys(by).forEach(function (sid) { if (D.folder(sid)) self.enqueue(sid, by[sid].sort(function (a, b) { return k[a].at - k[b].at; }), true, true); });
      Object.keys(S.d.dl.f).forEach(function (sid) { if (self.cfg(sid).full && D.folder(sid)) self.fullSync(sid); });
      if (this.s && (S.ser(this.s) || {}).off) this.keepOffline(this.s);
      this.kick();
    },
    /* retry now: clears waits and back-offs (kept downloads that had failed get another go) */
    kick: function () { var self = this; Object.keys(this.dl).forEach(function (k) { var d = self.dl[k]; d.next = 0; if (d.w === 'auth' && window.Sync && Sync.token()) d.w = null; if (d.fail && (self.inQ(k) || {}).k) { d.fail = 0; d.tries = 0; } }); this.pump(); App.state(); },
    /* whole-folder: queue every lecture not on the device yet (also files added to the Drive folder later) */
    fullSync: function (sid) {
      var self = this; if (!this.cfg(sid).full || Local.isLocal(sid)) return 0;
      var ids = D.files(sid).filter(function (f) { return !self.cached[f.id]; }).map(function (f) { return f.id; });
      D.files(sid).forEach(function (f) { if (self.cached[f.id] && !S.d.dl.kept[f.id]) S.d.dl.kept[f.id] = { s: sid, at: Date.now() }; });
      if (ids.length) this.enqueue(sid, ids, true, true);
      S.persist(); return ids.length;
    },
    /* kept=true: never cleared automatically. Already-saved auto copies just become Kept. Returns how many will download. */
    enqueue: function (sid, fids, kept, quiet) {
      var self = this, n = 0, now = Date.now();
      fids.forEach(function (fid, i) {
        if (kept && !S.d.dl.kept[fid]) S.d.dl.kept[fid] = { s: sid, at: now + i };
        if (self.cached[fid]) return;
        var q = self.inQ(fid);
        if (q) { if (kept && !q.k) { q.k = 1; q.at = now + i; } if (self.dl[fid] && self.dl[fid].fail) { self.dl[fid].fail = 0; self.dl[fid].tries = 0; } n++; return; }
        self.q.push({ f: fid, s: sid, k: kept ? 1 : 0, at: now + i, o: 0 });
        self.dl[fid] = { got: 0, tot: self.size(sid, fid), tries: 0 }; n++;
      });
      if (kept) S.persist();
      if (!quiet) { this.pump(); App.state(); }
      return n;
    },
    pick: function () {
      var now = Date.now(), self = this, fs = this.s ? this.files() : [], i = this.idx(), nx = i >= 0 && fs[i + 1] ? fs[i + 1].id : null;
      var ok = this.q.filter(function (x) { var d = self.dl[x.f]; return d && !d.fail && !d.w && !(d.next > now); });
      ok.sort(function (a, b) { return (!!self.force[b.s]) - (!!self.force[a.s]) || (b.f === nx) - (a.f === nx) || b.k - a.k || (a.k ? a.at - b.at : a.o - b.o); });
      return ok[0] || null;
    },
    pump: function () {
      var self = this; clearTimeout(this.pumpT);
      if (this.running || !this.q.length || !window.caches) return;
      var tok = !!(window.Sync && Sync.token());
      this.q.forEach(function (x) { var d = self.dl[x.f]; if (!d) return; var b = self.blockedFor(x.s); d.w = b || (d.w === 'auth' && !tok ? 'auth' : null); });
      var job = this.pick();
      if (!job) {   // all waiting to retry: come back at the earliest
        var t = Math.min.apply(null, this.q.map(function (x) { var d = self.dl[x.f]; return d && !d.fail && !d.w && d.next ? d.next : Infinity; }));
        if (isFinite(t)) this.pumpT = setTimeout(function () { self.pump(); }, Math.max(500, t - Date.now()));
        App.state(); return;
      }
      this.running = job; App.state();
      this.fetchFile(job).then(function () {
        self.q = self.q.filter(function (x) { return x !== job; }); delete self.dl[job.f];
        if (!self.q.some(function (x) { return x.s === job.s; })) { delete self.force[job.s]; delete self.paused[job.s]; }
      }, function (e) {
        var d = self.dl[job.f];
        if (e === 'cancel' || !d) { self.dropParts(job.f); return; }
        if (e === 'wait') return;   // offline / network not allowed: the pieces stay, it resumes from there
        if (e === 'auth') { d.w = 'auth'; return; }   // sign-in ran out: waits for the next tap / sign-in
        d.tries = (d.tries || 0) + 1; d.err = (e && e.message) || String(e); console.warn('download failed', job.f, e);
        if (!job.k && d.tries >= 5) d.fail = 1;
        else d.next = Date.now() + [5, 15, 45, 120, 300][Math.min(d.tries, 5) - 1] * 1000;
      }).then(function () { self.running = null; App.state(); self.pumpT = setTimeout(function () { self.pump(); }, 300); });
    },
    /* one piece. Token first (works for Library and shared files alike), API key for public files.
       Rejects 'auth' when neither works because the sign-in ran out. */
    get: function (fid, mode, from, to) {
      var t = window.Sync && Sync.token(), u = D.mediaUrl(fid), h = { Range: 'bytes=' + from + '-' + to };
      var key = function () { return C.apiKey ? fetch(u + '&key=' + C.apiKey, { headers: h, referrerPolicy: 'no-referrer-when-downgrade' }) : Promise.resolve(null); };
      var noAuth = function (r) { if (S.d.acct && (!t || (r && r.status === 401)) && (!r || r.status === 401 || r.status === 403 || r.status === 404)) throw 'auth'; return r || Promise.reject(new Error('no key')); };
      if (t) return fetch(u, { headers: Object.assign({ Authorization: 'Bearer ' + t }, h) }).then(function (r) {
        if (r.ok) return r;
        return key().then(function (r2) { if (r2 && r2.ok) return r2; if (r.status === 401) { if (window.Sync) Sync.dropTok(); throw 'auth'; } return r; });
      });
      return key().then(function (r) { return r && r.ok ? r : noAuth(r); });
    },
    /* wait while the lecture being streamed has under 45 s buffered ahead */
    calm: function (sid, d, live) {
      var self = this;
      return new Promise(function (res) {
        (function chk() {
          var stop = false; try { live(); } catch (e) { stop = true; }
          if (stop || self.force[sid]) { d.ph = 'get'; return res(); }
          if (!self.s || a.paused || self.cached[self.f] || self.blobUrl) { d.ph = 'get'; return res(); }
          var b = a.buffered, t = a.currentTime, ahead = 0, du = self.dur();
          for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 1 && b.end(i) > t) ahead = b.end(i) - t;
          if (ahead >= 45 || (du && t + ahead >= du - 1)) { d.ph = 'get'; return res(); }
          if (d.ph !== 'calm') { d.ph = 'calm'; self.tick(true); }
          setTimeout(chk, 1500);
        })();
      });
    },
    /* the finished file: into the phone folder (series sub-folder) if chosen, else inside the app */
    save: function (job, parts, type) {
      var self = this, fid = job.f, f = Local.find(fid);
      var toCache = function () {
        var b = new Blob(parts, { type: type });
        return caches.open(AC).then(function (c) { return c.put(BASE + 'media/' + fid, new Response(b, { headers: { 'Content-Type': type, 'Content-Length': String(b.size) } })); })
          .then(function () { self.cached[fid] = 1; });
      };
      if (!(Local.ok() && f)) return toCache();
      return Local.write(job.s, f.f, parts).then(function () {
        self.cached[fid] = 'L'; if (!job.k) S.d.dl.mine[fid] = 1; S.persist();
        caches.open(AC).then(function (c) { c.delete(BASE + 'media/' + fid); }).catch(function () {});
      }, function (e) { console.warn('phone folder write failed, saved in the app instead', e); return toCache(); });
    },
    fetchFile: function (job) {
      var self = this, fid = job.f, d = this.dl[fid], mode = this.mode(job.s), PB = BASE + 'part/' + fid + '/', CH = this.CH;
      var live = function () { if (!self.inQ(fid) || self.dl[fid] !== d) throw 'cancel'; if (self.blockedFor(job.s) || self.yieldFor(job.s)) throw 'wait'; };
      return caches.open(PART).then(function (pc) {
        return pc.keys().then(function (ks) {
          var have = {}, n = 0, tot = d.tot || 0;
          ks.forEach(function (r) { if (r.url.indexOf(PB) === 0) have[+r.url.slice(PB.length)] = 1; });
          var drop = function (urls) { urls.forEach(function (u) { pc.delete(u); }); };
          var finish = function () {
            var urls = []; for (var i = 0; i * CH < tot; i++) urls.push(PB + i);
            return Promise.all(urls.map(function (u) { return pc.match(u); })).then(function (rs) {
              if (rs.some(function (r) { return !r; })) { drop(urls); throw new Error('missing piece'); }
              return Promise.all(rs.map(function (r) { return r.blob(); }));
            }).then(function (bs) {
              var sz = 0; bs.forEach(function (b) { sz += b.size; });
              if (sz !== tot) { drop(urls); throw new Error('size ' + sz + ' ≠ ' + tot); }   // never save a cut-short file
              live(); d.ph = 'save'; self.tick(true);
              return self.save(job, bs, d.type || 'audio/mpeg');
            }).then(function () { drop(urls); });
          };
          var step = function () {
            live();
            if (tot && n * CH >= tot) return finish();
            if (tot && have[n]) { n++; d.got = Math.min(tot, n * CH); return step(); }
            return self.calm(job.s, d, live).then(function () {
              live();
              return self.get(fid, mode, n * CH, n * CH + CH - 1).catch(function (e) { if (e === 'auth') throw e; throw navigator.onLine === false ? 'wait' : new Error('network'); });
            }).then(function (r) {
              if (r.status === 416 && tot) return finish();
              if (!r.ok) throw new Error('HTTP ' + r.status);
              d.type = (r.headers.get('Content-Type') || d.type || 'audio/mpeg').split(';')[0];
              var m = /\/(\d+)\s*$/.exec(r.headers.get('Content-Range') || '');
              return self.body(r, d, r.status === 200 ? 0 : n * CH, live).then(function (b) {
                live();
                if (r.status === 200) {   // the server sent the whole file in one go
                  if (tot && b.size !== tot) throw new Error('got ' + b.size + ' of ' + tot + ' bytes');
                  d.ph = 'save';
                  return self.save(job, [b], d.type).then(function () { drop(Object.keys(have).map(function (k) { return PB + k; })); });
                }
                if (m) tot = d.tot = +m[1];
                else if (!tot) { if (b.size < CH) tot = d.tot = n * CH + b.size; else throw new Error('size unknown'); }   // header hidden: use the size Drive listed
                if (b.size !== Math.min(CH, tot - n * CH)) throw new Error('short piece ' + b.size);
                return pc.put(PB + n, new Response(b, { headers: { 'Content-Type': d.type } })).then(function () {
                  have[n] = 1; n++; d.got = Math.min(tot, n * CH); d.tries = 0; App.state(); return step();
                });
              });
            });
          };
          return step();
        });
      });
    },
    /* read a response as it arrives, so the progress bar and speed move within each 8 MB piece */
    body: function (r, d, base, live) {
      var self = this;
      if (!r.body || !r.body.getReader) return r.blob();
      var rd = r.body.getReader(), parts = [], got = 0, type = (r.headers.get('Content-Type') || '').split(';')[0];
      d.ph = 'get';
      return (function more() {
        return rd.read().then(function (x) {
          if (x.done) return new Blob(parts, { type: type });
          parts.push(x.value); got += x.value.byteLength; self.rate(d, x.value.byteLength);
          d.got = d.tot ? Math.min(d.tot, base + got) : base + got;
          try { live(); } catch (e) { rd.cancel().catch(function () {}); throw e; }
          self.tick(); return more();
        });
      })();
    },
    rate: function (d, b) {
      var now = Date.now(); if (!d.rt || now - d.rt > 10000) { d.rt = now; d.rb = 0; }
      d.rb += b; var dt = now - d.rt;
      if (dt >= 1000) { var v = d.rb / dt * 1000; d.spd = d.spd ? d.spd * 0.6 + v * 0.4 : v; d.rt = now; d.rb = 0; }
    },
    /* light refresh of the download card (no full re-render), at most every 400 ms */
    tick: function (now) { var t = Date.now(); if (!now && t - (this.tk || 0) < 400) return; this.tk = t; if (window.App && App.dlTick) App.dlTick(); },
    /* a running download of another series steps aside (keeping its pieces) while a forced series has something to fetch */
    yieldFor: function (sid) {
      if (this.force[sid]) return false; var self = this;
      return this.q.some(function (x) { var d = self.dl[x.f]; return self.force[x.s] && d && !d.fail && !d.w && !self.paused[x.s]; });
    },
    forceStart: function (sid) {
      var self = this, tok = !!(window.Sync && Sync.token());
      this.force[sid] = 1; delete this.paused[sid];
      this.q.forEach(function (x) { if (x.s !== sid) return; var d = self.dl[x.f]; if (!d) return; d.fail = 0; d.tries = 0; d.next = 0; if (d.w !== 'auth' || tok) d.w = null; });
      this.pump(); App.state();
    },
    pauseSer: function (sid) { this.paused[sid] = 1; delete this.force[sid]; this.pump(); App.state(); },
    resumeSer: function (sid) { delete this.paused[sid]; this.kick(); },
    /* what the download card on a series shows: overall progress (lectures saved + bytes), the current lecture and why it is or isn't moving */
    card: function (sid) {
      var self = this, mine = this.q.filter(function (x) { return x.s === sid; });
      if (!mine.length) return null;
      var qd = {}, o = { n: 0, done: 0, totB: 0, gotB: 0, left: mine.length }, now = Date.now();
      mine.forEach(function (x) { qd[x.f] = x; });
      D.files(sid).forEach(function (f) {
        var inq = qd[f.id]; if (!inq && !self.cached[f.id]) return;
        var d = self.dl[f.id] || {}, sz = f.sz || d.tot || 0;
        o.n++; o.totB += sz;
        if (!inq) { o.done++; o.gotB += sz; } else o.gotB += Math.min(sz, d.got || 0);
      });
      var run = this.running && this.running.s === sid ? this.running : null;
      var cur = run || mine.slice().sort(function (a, b) { return b.k - a.k || a.at - b.at; })[0], d = this.dl[cur.f] || {};
      o.fid = cur.f; o.got = d.got || 0; o.tot = d.tot || this.size(sid, cur.f); o.spd = run && d.ph !== 'calm' ? d.spd || 0 : 0; o.err = d.err || '';
      o.force = !!this.force[sid]; o.paused = !!this.paused[sid];
      var allFail = mine.every(function (x) { return (self.dl[x.f] || {}).fail; });
      o.k = navigator.onLine === false ? 'off' : run ? (d.ph === 'calm' ? 'calm' : d.ph === 'save' ? 'save' : 'run') : o.paused ? 'pause'
        : allFail ? 'fail' : this.running ? 'other' : d.w ? d.w : d.next > now ? 'retry' : 'queued';
      o.secs = d.next > now ? Math.ceil((d.next - now) / 1000) : 0;
      o.mob = o.force && this.net() === 'cellular' && !this.cfg(sid).mob;
      return o;
    },
    dropParts: function (fid) {
      if (!window.caches) return Promise.resolve(); var PB = BASE + 'part/' + fid + '/';
      return caches.open(PART).then(function (pc) { return pc.keys().then(function (ks) { return Promise.all(ks.filter(function (r) { return r.url.indexOf(PB) === 0; }).map(function (r) { return pc.delete(r); })); }); }).catch(function () {});
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
    /* an auto copy the app may clear: in the app's storage, or a file the app itself put in the phone folder */
    isAuto: function (fid) { return !!this.cached[fid] && !this.kept(fid) && (this.cached[fid] === 1 || !!S.d.dl.mine[fid]); },
    /* auto window: queue upcoming first, then the current lecture, then the earlier ones; clear auto copies outside it */
    keepOffline: function (sid) {
      if (Local.isLocal(sid)) return Promise.resolve();
      var self = this, want = this.window(sid), keep = {}, fs = D.files(sid), fid = (this.s === sid && this.f) || this.resumeFile(sid), ci = 0;
      want.forEach(function (f, k) { keep[f.id] = 1; if (f.id === fid) ci = k; });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      this.q = this.q.filter(function (x) { if (x.s === sid && !x.k && !keep[x.f]) { delete self.dl[x.f]; return false; } return true; });
      var order = want.slice(ci + 1).concat(want.slice(ci, ci + 1), want.slice(0, ci).reverse());
      order.forEach(function (f, k) {
        var q = self.inQ(f.id);
        if (q) { if (!q.k) q.o = k; }
        else if (!self.cached[f.id]) { self.q.push({ f: f.id, s: sid, k: 0, o: k, at: Date.now() }); self.dl[f.id] = { got: 0, tot: f.sz || 0, tries: 0 }; }
      });
      var old = fs.filter(function (f) { return self.isAuto(f.id) && !keep[f.id] && f.id !== self.f; }).map(function (f) { return f.id; });
      return (old.length ? this.remove(old, true) : Promise.resolve()).then(function () { self.pump(); App.state(); });
    },
    /* switch off: auto copies and queued auto downloads of that series go; Kept stay */
    dropOffline: function (sid) {
      var self = this, ids = D.files(sid).filter(function (f) { return !self.kept(f.id); }).map(function (f) { return f.id; });
      return this.remove(ids.filter(function (id) { return self.isAuto(id) || (self.inQ(id) && !self.cached[id]); }));
    },
    /* delete saved copies (and cancel their downloads); the lecture playing carries on by streaming */
    remove: function (fids, quiet) {
      var self = this, gone = {}, local = [];
      fids.forEach(function (id) {
        if (self.cached[id] === 'L') { var x = Local.find(id); if (x) local.push(x); }
        gone[id] = 1; delete S.d.dl.kept[id]; delete S.d.dl.mine[id]; delete self.dl[id]; delete self.cached[id]; self.dropParts(id);
      });
      this.q = this.q.filter(function (x) { return !gone[x.f]; });
      S.persist();
      var p1 = Promise.all(local.map(function (x) { return Local.removeFile(x.s, x.f); }));
      var p2 = window.caches ? caches.open(AC).then(function (c) { return Promise.all(fids.map(function (id) { return c.delete(BASE + 'media/' + id); })); }) : Promise.resolve();
      return Promise.all([p1, p2]).then(function () { if (!quiet) { App.state(); self.pump(); } });
    },
    autoIds: function () { var self = this; return Object.keys(this.cached).filter(function (id) { return self.isAuto(id); }); },
    /* everything the app downloaded (phone-folder files of "On this phone" series are the user's own and stay) */
    dropAll: function () {
      var self = this, ids = Object.keys(this.cached).filter(function (id) { return !Local.isLocal(id); });
      Object.keys(S.d.dl.f).forEach(function (sid) { if (S.d.dl.f[sid].full) S.d.dl.f[sid].full = 0; });
      this.q = []; this.dl = {};
      return this.remove(ids).then(function () { S.d.dl.kept = {}; S.persist(); return Promise.all([caches.delete(AC), caches.delete(PART)]); }).then(function () { App.state(); });
    },
    /* every lecture we know of with a saved copy: [{f: file, s: seriesId}] */
    saved: function () {
      var self = this, out = [], seen = {};
      Object.keys(D.c.f).forEach(function (sid) { if (Local.isLocal(sid)) return; D.files(sid).forEach(function (f) { if (self.cached[f.id] && !seen[f.id]) { seen[f.id] = 1; out.push({ f: f, s: sid }); } }); });
      return out;
    },
    offBytes: function (sid, which) {
      var self = this, b = 0;
      this.saved().forEach(function (x) { if ((!sid || x.s === sid) && (!which || (which === 'k') === self.kept(x.f.id))) b += x.f.sz || 0; });
      return b;
    },
    /* what a series' download line says */
    qInfo: function (sid) {
      var self = this, list = this.q.filter(function (x) { return !sid || x.s === sid; });
      var w = list.length && list.every(function (x) { var d = self.dl[x.f]; return d && d.w; }) ? (self.dl[list[0].f] || {}).w : null;
      return { n: list.length, w: w, fail: list.filter(function (x) { return (self.dl[x.f] || {}).fail; }).length };
    },
    free: function () {
      if (!(navigator.storage && navigator.storage.estimate)) return Promise.resolve(null);
      return navigator.storage.estimate().then(function (e) { return { used: e.usage || 0, free: Math.max(0, (e.quota || 0) - (e.usage || 0)) }; }, function () { return null; });
    },

    /* ---- learn lecture lengths in the background (Drive doesn't report audio duration) ---- */
    probe: function (sid) {
      var self = this; if (this.probing === sid) return; this.probing = sid;
      var pa = this.pa || (this.pa = new Audio()); pa.preload = 'metadata'; pa.muted = true;
      var list = Local.isLocal(sid) ? [] : D.files(sid).filter(function (f) { return !D.dur(f.id) && !((S.pr(f.id) || {}).d); }).slice(0, 80), i = 0;
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
    P.err = true; if (P.pend == null && a.currentTime > 0) P.pend = a.currentTime;
    var why = navigator.onLine === false ? 'You are offline and this lecture is not saved on the phone'
      : (P.mode() === 't' && !(window.Sync && Sync.token())) ? 'Google sign-in expired — tap anywhere to resume'
        : !C.apiKey && P.mode() === 'k' ? 'Public playback is not set up yet (API key missing)' : 'Could not play this lecture';
    App.toast(why); App.state();
  });
  /* flaky connection: a stream stalled for 20 s, or that broke while offline, reconnects from the same second */
  var stallT, revive = function () { if (P.s && P.wantPlay && (P.err || a.readyState < 3)) { P.setSrc(P.cur()); a.play().catch(function () {}); } };
  a.addEventListener('waiting', function () { clearTimeout(stallT); stallT = setTimeout(function () { if (navigator.onLine !== false) revive(); }, 20000); });
  a.addEventListener('playing', function () { clearTimeout(stallT); });
  window.addEventListener('online', function () {
    revive();
    P.kick(); if (window.Up) Up.pump();
  });
  window.addEventListener('offline', function () { App.state(); });
  if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', function () { P.kick(); if (window.Up) Up.pump(); });
  if ('mediaSession' in navigator) {
    var h = function (n, fn) { try { navigator.mediaSession.setActionHandler(n, fn); } catch (e) {} };
    h('play', function () { P.play(); }); h('pause', function () { P.pause(); });
    h('previoustrack', function () { P.step(-1); }); h('nexttrack', function () { P.step(1); });
    h('seekbackward', function (d) { P.skip(-(d && d.seekOffset || 10)); }); h('seekforward', function (d) { P.skip(d && d.seekOffset || 10); });
    h('seekto', function (d) { if (d && d.seekTime != null) P.seek(d.seekTime); });
  }
  window.Player = P;
})();
