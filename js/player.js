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
      var self = this; clearTimeout(this.offT);
      if ((S.ser(sid) || {}).off) this.offT = setTimeout(function () { if (self.s === sid) self.keepOffline(sid); }, 5000);
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

    /* ---- offline copies ----
       One download queue, one file at a time. Kept = downloaded by hand, never removed automatically (Store.d.dl.kept).
       Auto = the nearby-lectures window of a series with the switch on; cleared as the window moves on.
       Files come down in 8 MB pieces (HTTP Range) kept in cache 'alp-part', so a dropped connection or a closed app
       resumes from the last piece; the pieces are then joined into the offline copy in 'alp-audio'.
       Never holds up listening: waits while the streamed lecture has under 45 s buffered.
       Mobile data: off by default — on a cellular connection downloads wait for Wi-Fi (only where the browser says so). */
    q: [], running: null,
    kept: function (fid) { return !!S.d.dl.kept[fid]; },
    cell: function () { var c = navigator.connection; return !!(c && c.type === 'cellular'); },
    netKnown: function () { var c = navigator.connection; return !!(c && c.type); },
    blocked: function () { return navigator.onLine === false ? 'off' : (!S.d.dl.mob && this.cell()) ? 'wifi' : null; },
    size: function (sid, fid) { var f = D.files(sid).filter(function (x) { return x.id === fid; })[0]; return (f && f.sz) || 0; },
    inQ: function (fid) { for (var i = 0; i < this.q.length; i++) if (this.q[i].f === fid) return this.q[i]; return null; },
    scanCached: function () {
      var self = this; if (!window.caches) return Promise.resolve();
      return caches.open(AC).then(function (c) { return c.keys(); }).then(function (ks) {
        self.cached = {}; ks.forEach(function (r) { var m = r.url.match(/media\/([\w-]+)/); if (m) self.cached[m[1]] = 1; });
      }).catch(function () {});
    },
    /* after launch: finish kept downloads that were left half done, and refill the window of the series in the player */
    resumeQueue: function () {
      var self = this, k = S.d.dl.kept, by = {};
      Object.keys(k).forEach(function (fid) { if (!self.cached[fid]) (by[k[fid].s] = by[k[fid].s] || []).push(fid); });
      Object.keys(by).forEach(function (sid) { self.enqueue(sid, by[sid].sort(function (a, b) { return k[a].at - k[b].at; }), true, true); });
      if (this.s && (S.ser(this.s) || {}).off) this.keepOffline(this.s);
      this.pump();
    },
    /* manual download: kept=true. Already-saved auto copies just become Kept. Returns how many will download. */
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
      var ok = this.q.filter(function (x) { var d = self.dl[x.f]; return d && !d.fail && !(d.next > now); });
      ok.sort(function (a, b) { return (b.f === nx) - (a.f === nx) || b.k - a.k || (a.k ? a.at - b.at : a.o - b.o); });
      return ok[0] || null;
    },
    pump: function () {
      var self = this; clearTimeout(this.pumpT);
      if (this.running || !this.q.length || !window.caches) return;
      var why = this.blocked();
      this.q.forEach(function (x) { if (self.dl[x.f]) self.dl[x.f].w = why; });
      if (why) { App.state(); return; }
      var job = this.pick();
      if (!job) {   // all waiting to retry: come back at the earliest
        var t = Math.min.apply(null, this.q.map(function (x) { var d = self.dl[x.f]; return d && !d.fail && d.next ? d.next : Infinity; }));
        if (isFinite(t)) this.pumpT = setTimeout(function () { self.pump(); }, Math.max(500, t - Date.now()));
        return;
      }
      this.running = job; App.state();
      this.fetchFile(job).then(function () {
        self.cached[job.f] = 1; self.q = self.q.filter(function (x) { return x !== job; }); delete self.dl[job.f];
      }, function (e) {
        var d = self.dl[job.f];
        if (e === 'cancel' || !d) { self.dropParts(job.f); return; }
        if (e === 'wait') return;   // offline / mobile data: the pieces stay, it resumes from there
        d.tries = (d.tries || 0) + 1; console.warn('download failed', job.f, e);
        if (d.tries >= 5) d.fail = 1; else d.next = Date.now() + [5, 15, 45, 120][d.tries - 1] * 1000;
      }).then(function () { self.running = null; App.state(); self.pumpT = setTimeout(function () { self.pump(); }, 300); });
    },
    get: function (fid, mode, from, to) {
      var t = window.Sync && Sync.token(), u = D.mediaUrl(fid), h = { Range: 'bytes=' + from + '-' + to };
      if (mode === 't' && t) h.Authorization = 'Bearer ' + t; else if (C.apiKey) u += '&key=' + C.apiKey; else return Promise.reject(new Error('no key'));
      return fetch(u, { headers: h });
    },
    /* wait while the lecture being streamed has under 45 s buffered ahead */
    calm: function () {
      var self = this;
      return new Promise(function (res) {
        (function chk() {
          if (!self.s || a.paused || self.cached[self.f] || self.blobUrl) return res();
          var b = a.buffered, t = a.currentTime, ahead = 0, d = self.dur();
          for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 1 && b.end(i) > t) ahead = b.end(i) - t;
          if (ahead >= 45 || (d && t + ahead >= d - 1)) return res();
          setTimeout(chk, 3000);
        })();
      });
    },
    fetchFile: function (job) {
      var self = this, fid = job.f, d = this.dl[fid], mode = this.mode(job.s), PB = BASE + 'part/' + fid + '/', CH = this.CH;
      var live = function () { if (!self.inQ(fid) || self.dl[fid] !== d) throw 'cancel'; if (self.blocked()) throw 'wait'; };
      return caches.open(PART).then(function (pc) {
        return pc.keys().then(function (ks) {
          var have = {}, n = 0, tot = d.tot || 0;
          ks.forEach(function (r) { if (r.url.indexOf(PB) === 0) have[+r.url.slice(PB.length)] = 1; });
          var finish = function () {
            var urls = []; for (var i = 0; i * CH < tot; i++) urls.push(PB + i);
            return Promise.all(urls.map(function (u) { return pc.match(u); })).then(function (rs) {
              if (rs.some(function (r) { return !r; })) { urls.forEach(function (u) { pc.delete(u); }); throw new Error('missing piece'); }
              return Promise.all(rs.map(function (r) { return r.blob(); }));
            }).then(function (bs) {
              var b = new Blob(bs, { type: d.type || 'audio/mpeg' });
              if (b.size !== tot) { urls.forEach(function (u) { pc.delete(u); }); throw new Error('size ' + b.size + ' ≠ ' + tot); }
              live();
              return caches.open(AC).then(function (c) { return c.put(BASE + 'media/' + fid, new Response(b, { headers: { 'Content-Type': b.type, 'Content-Length': String(b.size) } })); });
            }).then(function () { return Promise.all(urls.map(function (u) { return pc.delete(u); })); });
          };
          var step = function () {
            live();
            if (tot && n * CH >= tot) return finish();
            if (tot && have[n]) { n++; d.got = Math.min(tot, n * CH); return step(); }
            return self.calm().then(function () {
              live();
              return self.get(fid, mode, n * CH, n * CH + CH - 1).catch(function () { throw navigator.onLine === false ? 'wait' : new Error('network'); });
            }).then(function (r) {
              if (r.status === 416 && tot) return finish();
              if (!r.ok) throw new Error('HTTP ' + r.status);
              var m = /\/(\d+)\s*$/.exec(r.headers.get('Content-Range') || '');
              d.type = (r.headers.get('Content-Type') || d.type || 'audio/mpeg').split(';')[0];
              if (r.status === 200 || !m) {   // the server sent the whole file in one go
                return r.blob().then(function (b) { live(); return caches.open(AC).then(function (c) { return c.put(BASE + 'media/' + fid, new Response(b, { headers: { 'Content-Type': d.type, 'Content-Length': String(b.size) } })); }); });
              }
              tot = d.tot = +m[1];
              return r.blob().then(function (b) {
                live();
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
    /* auto window: queue upcoming first, then the current lecture, then the earlier ones; clear auto copies outside it */
    keepOffline: function (sid) {
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
      return caches.open(AC).then(function (c) {
        return Promise.all(fs.map(function (f) { if (self.cached[f.id] && !keep[f.id] && !self.kept(f.id) && f.id !== self.f) { delete self.cached[f.id]; return c.delete(BASE + 'media/' + f.id); } }));
      }).then(function () { self.pump(); App.state(); });
    },
    /* switch off: auto copies and queued auto downloads of that series go; Kept stay */
    dropOffline: function (sid) {
      var self = this, ids = D.files(sid).filter(function (f) { return !self.kept(f.id); }).map(function (f) { return f.id; });
      return this.remove(ids.filter(function (id) { return self.cached[id] || self.inQ(id); }));
    },
    /* delete offline copies (and cancel their downloads); the lecture playing carries on by streaming */
    remove: function (fids) {
      var self = this, gone = {};
      fids.forEach(function (id) { gone[id] = 1; delete S.d.dl.kept[id]; delete self.dl[id]; delete self.cached[id]; self.dropParts(id); });
      this.q = this.q.filter(function (x) { return !gone[x.f]; });
      S.persist();
      if (!window.caches) return Promise.resolve();
      return caches.open(AC).then(function (c) { return Promise.all(fids.map(function (id) { return c.delete(BASE + 'media/' + id); })); })
        .then(function () { App.state(); self.pump(); });
    },
    autoIds: function () { var self = this; return Object.keys(this.cached).filter(function (id) { return !self.kept(id); }); },
    dropAll: function () {
      var self = this; S.d.dl.kept = {}; S.persist(); this.q = []; this.dl = {}; this.cached = {};
      return Promise.all([caches.delete(AC), caches.delete(PART)]).then(function () { App.state(); });
    },
    /* every lecture we know of with an offline copy: [{f: file, s: seriesId}] */
    saved: function () {
      var self = this, out = [], seen = {};
      Object.keys(D.c.f).forEach(function (sid) { D.files(sid).forEach(function (f) { if (self.cached[f.id] && !seen[f.id]) { seen[f.id] = 1; out.push({ f: f, s: sid }); } }); });
      return out;
    },
    offBytes: function (sid, which) {
      var self = this, b = 0;
      this.saved().forEach(function (x) { if ((!sid || x.s === sid) && (!which || (which === 'k') === self.kept(x.f.id))) b += x.f.sz || 0; });
      return b;
    },
    /* what the series screen says about its downloads */
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
    Object.keys(P.dl).forEach(function (k) { P.dl[k].next = 0; });
    P.pump();
  });
  window.addEventListener('offline', function () { App.state(); });
  if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', function () { P.pump(); App.state(); });
  if ('mediaSession' in navigator) {
    var h = function (n, fn) { try { navigator.mediaSession.setActionHandler(n, fn); } catch (e) {} };
    h('play', function () { P.play(); }); h('pause', function () { P.pause(); });
    h('previoustrack', function () { P.step(-1); }); h('nexttrack', function () { P.step(1); });
    h('seekbackward', function (d) { P.skip(-(d && d.seekOffset || 10)); }); h('seekforward', function (d) { P.skip(d && d.seekOffset || 10); });
    h('seekto', function (d) { if (d && d.seekTime != null) P.seek(d.seekTime); });
  }
  window.Player = P;
})();
