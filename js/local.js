/* Local: the phone folder (File System Access API — Chrome on Android 132+, desktop Chrome/Edge).
   The user picks ONE parent folder; each series gets a sub-folder named after it (Store.d.dl.dir[seriesId] = folder name),
   and downloaded lectures are written there as normal files (visible in the Files app).
   Sub-folders the user adds himself, with no matching series, become "On this phone" series with ids
   'L:<folder>' and lecture ids 'L:<folder>/<file>'. They can be uploaded to Drive (Up, below), which turns them
   into Library series on every device. The folder handle is kept in IndexedDB; after a restart Chrome may need a tap
   to allow it again (Local.perm === 'prompt' → the app shows "Reconnect phone folder").
   No phone folder (or a browser without the API) → downloads stay inside the app (Cache Storage), as before. */
(function () {
  var S = window.Store, D = window.Drive, DB = 'alp-fs', OS = 'h';
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(OS); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  function iget(k) { return idb().then(function (db) { return new Promise(function (res, rej) { var q = db.transaction(OS).objectStore(OS).get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; }); }); }
  function iput(k, v) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(OS, 'readwrite'); t.objectStore(OS).put(v, k); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }
  /* a name that is safe as a file / folder name on Android and Windows */
  function clean(n) { n = String(n || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim(); return n || 'Untitled'; }
  function isLocal(sid) { return String(sid || '').indexOf('L:') === 0; }

  var L = {
    root: null, perm: 'none', idx: {}, scanning: null, clean: clean, isLocal: isLocal,
    supported: function () { return 'showDirectoryPicker' in window && !!window.indexedDB; },
    ok: function () { return !!this.root && this.perm === 'granted'; },
    name: function () { return this.root ? this.root.name : ''; },
    init: function () {
      var self = this; if (!this.supported()) return Promise.resolve();
      return iget('root').then(function (h) {
        if (!h) return;
        self.root = h;
        return h.queryPermission({ mode: 'readwrite' }).then(function (p) { self.perm = p; if (p === 'granted') return self.scan(); });
      }).catch(function (e) { console.warn('phone folder', e); });
    },
    /* must run from a tap */
    choose: function () {
      var self = this;
      return window.showDirectoryPicker({ id: 'lectures', mode: 'readwrite', startIn: 'music' }).then(function (h) {
        self.root = h; self.perm = 'granted';
        return iput('root', h).then(function () { return self.scan(); });
      });
    },
    reconnect: function () {
      var self = this; if (!this.root) return this.choose();
      return this.root.requestPermission({ mode: 'readwrite' }).then(function (p) { self.perm = p; if (p === 'granted') return self.scan(); });
    },
    /* the sub-folder of a series (assigned on first use, unique) */
    dirOf: function (sid) {
      if (isLocal(sid)) return sid.slice(2);
      var m = S.d.dl.dir; if (m[sid]) return m[sid];
      var r = S.ser(sid) || {}, base = clean(r.name || (D.folder(sid) || {}).name || sid), n = base, k = 2, used = {};
      Object.keys(m).forEach(function (x) { used[m[x]] = 1; });
      while (used[n]) n = base + ' (' + (k++) + ')';
      m[sid] = n; S.persist(); return n;
    },
    hasDir: function (sid) { return !!this.idx[isLocal(sid) ? sid.slice(2) : S.d.dl.dir[sid]]; },
    dir: function (sid, create) { return this.root.getDirectoryHandle(this.dirOf(sid), { create: !!create }); },
    /* read every sub-folder: audio file names + sizes */
    scan: function () {
      var self = this; if (!this.ok()) return Promise.resolve();
      if (this.scanning) return this.scanning;
      var p = (async function () {
        var idx = {};
        for await (var [nm, h] of self.root.entries()) {
          if (h.kind !== 'directory' || nm[0] === '.') continue;
          var e = { files: {} };
          for await (var [fn, fh] of h.entries()) {
            if (fh.kind !== 'file' || fn[0] === '.' || /\.part$/i.test(fn)) continue;
            if (!D.isAudio({ name: fn })) continue;
            var file = await fh.getFile();
            e.files[fn] = { sz: file.size, c: file.lastModified };
          }
          idx[nm] = e;
        }
        self.idx = idx; self.scanned = true; self.adopt(); self.match();
      })();
      this.scanning = p;
      var done = function () { self.scanning = null; if (window.App) App.state(); };
      p.then(done, function (e) { done(); console.warn('scan failed', e); if (e && e.name === 'NotAllowedError') self.perm = 'prompt'; });
      return p;
    },
    /* match sub-folders to series by name; the rest become "On this phone" series */
    adopt: function () {
      var self = this, m = S.d.dl.dir, used = {}, byName = {};
      if (!this.ok() || !this.scanned) return;   // not read yet: keep the phone series as they are
      Object.keys(m).forEach(function (sid) { used[m[sid]] = sid; });
      Object.keys(S.d.series).forEach(function (sid) {
        if (isLocal(sid) || m[sid]) return;
        var r = S.d.series[sid], n = clean(r.name || (D.folder(sid) || {}).name || '');
        if (r.name && !byName[n]) byName[n] = sid;
      });
      Object.keys(this.idx).forEach(function (dn) {
        if (used[dn]) return;
        if (byName[dn]) { m[byName[dn]] = dn; used[dn] = byName[dn]; return; }
        var lid = 'L:' + dn, e = self.idx[dn];
        var files = Object.keys(e.files).map(function (fn) { return { id: lid + '/' + fn, n: fn, sz: e.files[fn].sz, c: e.files[fn].c, m: '' }; }).sort(D.sortName);
        D.c.f[lid] = { name: dn, files: files, img: null, at: Date.now(), local: 1 };
        if (!S.ser(lid)) S.setSer(lid, { name: dn, src: 'local', seen: Date.now() }, true);
      });
      Object.keys(S.d.series).forEach(function (sid) {   // folder deleted, or now belongs to a Drive series
        if (!isLocal(sid)) return; var dn = sid.slice(2);
        if (!self.idx[dn] || (used[dn] && used[dn] !== sid)) { delete S.d.series[sid]; delete D.c.f[sid]; }
      });
      D.persist(); S.persist();
    },
    /* mark lectures whose file is in their series' sub-folder (same name, same size) as on the phone */
    match: function () {
      var P = window.Player, self = this, m = S.d.dl.dir; if (!P) return;
      Object.keys(P.cached).forEach(function (fid) { if (P.cached[fid] === 'L') delete P.cached[fid]; });
      if (!this.ok()) return;
      Object.keys(D.c.f).forEach(function (sid) {
        var dn = isLocal(sid) ? sid.slice(2) : m[sid], e = dn && self.idx[dn]; if (!e) return;
        D.c.f[sid].files.forEach(function (f) { var x = e.files[clean(f.n)]; if (x && (!f.sz || x.sz === f.sz)) P.cached[f.id] = 'L'; });
      });
    },
    find: function (fid) {
      var sids = Object.keys(D.c.f);
      for (var i = 0; i < sids.length; i++) { var fs = D.c.f[sids[i]].files; for (var j = 0; j < fs.length; j++) if (fs[j].id === fid) return { s: sids[i], f: fs[j] }; }
      return null;
    },
    file: function (fid) {
      var x = this.find(fid); if (!x || !this.ok()) return Promise.reject(new Error('not on phone'));
      return this.dir(x.s).then(function (d) { return d.getFileHandle(clean(x.f.n)); }).then(function (h) { return h.getFile(); });
    },
    /* save a downloaded lecture: the pieces are streamed into the file, which only appears when complete */
    write: async function (sid, f, parts) {
      var d = await this.dir(sid, true), fh = await d.getFileHandle(clean(f.n), { create: true }), w = await fh.createWritable(), sz = 0;
      try { for (var i = 0; i < parts.length; i++) { await w.write(parts[i]); sz += parts[i].size; } await w.close(); }
      catch (e) { try { await w.abort(); } catch (x) {} throw e; }
      var dn = this.dirOf(sid); (this.idx[dn] = this.idx[dn] || { files: {} }).files[clean(f.n)] = { sz: sz, c: Date.now() };
    },
    removeFile: function (sid, f) {
      var self = this, dn = this.dirOf(sid); if (!this.ok()) return Promise.resolve();
      return this.dir(sid).then(function (d) { return d.removeEntry(clean(f.n)); }).catch(function () {}).then(function () { var e = self.idx[dn]; if (e) delete e.files[clean(f.n)]; });
    },
    removeDir: function (sid) {
      var self = this, dn = this.dirOf(sid); if (!this.ok()) return Promise.resolve();
      return this.root.removeEntry(dn, { recursive: true }).catch(function () {}).then(function () { delete self.idx[dn]; if (!isLocal(sid)) delete S.d.dl.dir[sid]; S.persist(); });
    },
    /* audio files in a series' sub-folder (for uploading) */
    localFiles: function (sid) { var e = this.idx[isLocal(sid) ? sid.slice(2) : S.d.dl.dir[sid]]; return e ? e.files : {}; }
  };
  window.Local = L;

  /* ---- Up: upload a phone folder into the Library folder in Drive (resumable, 8 MB pieces) ----
     Uses the signed-in token with full Drive access. A finished upload of an "On this phone" series turns it into the
     Library series (progress, star and place carried over). With "Upload new files" on, new files added on the phone
     are uploaded whenever the app opens. Upload sessions are kept in localStorage so a closed app resumes. */
  var API = 'https://www.googleapis.com/drive/v3', UPL = 'https://www.googleapis.com/upload/drive/v3', FOLDER = 'application/vnd.google-apps.folder', CH = 8 * 1024 * 1024;
  function hErr(r, what) { return r.json().catch(function () { return {}; }).then(function (j) { var e = new Error((what ? what + ': ' : '') + ((j.error && j.error.message) || 'HTTP ' + r.status)); e.status = r.status; throw e; }); }
  var Up = {
    st: {}, q: [], running: null,
    auth: function () { return { Authorization: 'Bearer ' + Sync.token() }; },
    ready: function () { return !!(Sync.token() && Sync.canWrite() && S.d.lib && S.d.lib.id); },
    start: function (sid) { if (this.q.indexOf(sid) < 0) this.q.push(sid); this.st[sid] = this.st[sid] || { w: null }; this.st[sid].next = 0; this.pump(); },
    pump: function () {
      var self = this; clearTimeout(this.t);
      if (this.running || !this.q.length) return;
      var now = Date.now(), sid = null;
      for (var i = 0; i < this.q.length; i++) {
        var s = this.q[i], st = this.st[s];
        st.w = navigator.onLine === false ? 'off' : Player.blockedFor(s) || (!Local.ok() ? 'folder' : !this.ready() ? 'auth' : null);
        if (!st.w && !(st.next > now)) { sid = s; break; }
      }
      if (window.App) App.state();
      if (!sid) { var nx = Math.min.apply(null, this.q.map(function (s) { return self.st[s].next || Infinity; })); if (isFinite(nx)) this.t = setTimeout(function () { self.pump(); }, Math.max(1000, nx - now)); return; }
      this.running = sid;
      this.run(sid).then(function (msg) {
        self.q = self.q.filter(function (x) { return x !== sid; }); delete self.st[sid];
        if (msg && window.App) App.toast(msg);
      }, function (e) {
        var st = self.st[sid]; if (!st) return;
        st.tries = (st.tries || 0) + 1; st.err = e.message || String(e);
        st.next = Date.now() + [15, 60, 300][Math.min(st.tries - 1, 2)] * 1000;
        console.warn('upload failed', sid, e);
      }).then(function () { self.running = null; if (window.App) App.state(); self.t = setTimeout(function () { self.pump(); }, 500); });
    },
    run: async function (sid) {
      var st = this.st[sid], dn = Local.dirOf(sid), files = Local.localFiles(sid), lib = S.d.lib.id;
      var folderId = Local.isLocal(sid) ? await this.folder(lib, dn) : sid;
      var remote = {}; (await D.listIn([folderId], 't')).forEach(function (f) { remote[f.name] = +f.size || 0; });
      var todo = Object.keys(files).filter(function (fn) { return remote[fn] !== files[fn].sz; });
      st.n = todo.length; st.done = 0; st.tot = 0; st.got = 0; st.err = null; st.tries = 0;
      todo.forEach(function (fn) { st.tot += files[fn].sz; });
      for (var i = 0; i < todo.length; i++) {
        st.cur = todo[i];
        await this.file(sid, folderId, dn, todo[i]);
        st.done++;
      }
      if (Local.isLocal(sid)) {   // snapshot first: the Library refresh itself matches the phone folder to the new series
        var snap = { r: Object.assign({}, S.ser(sid)), files: (D.c.f[sid] ? D.c.f[sid].files : []).slice() };
        await D.refreshLib(); this.adopt(sid, folderId, snap); return todo.length ? 'Uploaded ' + dn + ' to Drive' : null;
      }
      if (todo.length) await D.refreshFolder(sid, 't');
      return todo.length ? 'Uploaded ' + todo.length + (todo.length === 1 ? ' new file' : ' new files') + ' to Drive' : null;
    },
    /* the series folder inside the Library folder (made if missing) */
    folder: async function (lib, name) {
      var kids = await D.listIn([lib], 't', true), hit = kids.filter(function (k) { return k.name === name && k.mimeType === FOLDER; })[0];
      if (hit) return hit.id;
      var r = await fetch(API + '/files?supportsAllDrives=true&fields=id', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, this.auth()), body: JSON.stringify({ name: name, mimeType: FOLDER, parents: [lib] }) });
      if (!r.ok) await hErr(r, 'create folder');
      return (await r.json()).id;
    },
    file: async function (sid, folderId, dn, fn) {
      var st = this.st[sid], file = await (await (await Local.root.getDirectoryHandle(dn)).getFileHandle(fn)).getFile();
      var key = 'alp.up:' + folderId + '/' + fn + '/' + file.size, sess = null, off = 0, base = st.got;
      try { sess = localStorage.getItem(key); } catch (e) {}
      if (sess) {   // ask the session how far it got
        var q = await fetch(sess, { method: 'PUT', headers: { 'Content-Range': 'bytes */' + file.size } }).catch(function () { return null; });
        if (q && q.ok) { st.got = base + file.size; try { localStorage.removeItem(key); } catch (e) {} return; }
        if (q && q.status === 308) { var rg = q.headers.get('Range'); off = rg ? +rg.split('-')[1] + 1 : 0; } else sess = null;
      }
      if (!sess) {
        var r = await fetch(UPL + '/files?uploadType=resumable&supportsAllDrives=true', { method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': file.type || 'audio/mpeg', 'X-Upload-Content-Length': String(file.size) }, this.auth()),
          body: JSON.stringify({ name: fn, parents: [folderId] }) });
        if (!r.ok) await hErr(r, 'start upload');
        sess = r.headers.get('Location'); if (!sess) throw new Error('Drive did not return an upload address');
        try { localStorage.setItem(key, sess); } catch (e) {}
        off = 0;
      }
      while (off < file.size) {
        if (Player.blockedFor(sid) || navigator.onLine === false) throw new Error('paused — waiting for the allowed network');
        var end = Math.min(off + CH, file.size);
        var p = await fetch(sess, { method: 'PUT', headers: { 'Content-Range': 'bytes ' + off + '-' + (end - 1) + '/' + file.size }, body: file.slice(off, end) });
        if (p.status === 308) { var rg2 = p.headers.get('Range'); off = rg2 ? +rg2.split('-')[1] + 1 : end; }
        else if (p.ok) off = file.size;
        else { if (p.status === 404 || p.status === 410) { try { localStorage.removeItem(key); } catch (e) {} } await hErr(p, 'upload'); }
        st.got = base + off; if (window.App) App.state();
      }
      try { localStorage.removeItem(key); } catch (e) {}
    },
    /* "On this phone" series → the Library series it became: carry over place, progress, star, settings */
    adopt: function (lid, fid, snap) {
      var dn = lid.slice(2), r = snap.r || {}, f = D.folder(fid), byN = {}, P = window.Player;
      (f ? f.files : []).forEach(function (x) { byN[x.n] = x.id; });
      var map = function (id) { return id && byN[id.slice(lid.length + 1)] || null; };
      S.d.dl.dir[fid] = dn;
      if (S.d.dl.f[lid]) { S.d.dl.f[fid] = S.d.dl.f[lid]; delete S.d.dl.f[lid]; }
      snap.files.forEach(function (x) { var p = S.pr(x.id), to = byN[x.n]; if (p && to) { S.setPr(to, Object.assign({}, p, { s: fid }), true); delete S.d.prog[x.id]; } });
      S.setSer(fid, { name: dn, src: 'lib', star: r.star || 0, fin: r.fin || 0, finAt: r.finAt || 0, last: r.last || 0, cur: map(r.cur), seen: r.seen || Date.now() });
      if (P && P.s === lid) { P.s = fid; P.f = map(P.f) || P.f; S.setNow(fid, P.f); }
      else if (S.d.now && S.d.now.s === lid) S.setNow(fid, map(S.d.now.f));
      delete S.d.series[lid]; delete D.c.f[lid]; D.persist(); S.save();
      Local.match();
    },
    info: function (sid) { return this.st[sid] || null; }
  };
  window.Up = Up;
})();
