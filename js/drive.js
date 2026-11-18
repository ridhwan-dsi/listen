/* Drive: reads folders and audio files.
   Two ways in: the API key (folders shared "Anyone with the link", no sign-in) or the signed-in token (Library,
   read-only). Shared series try the key first, Library series the token first; each falls back to the other.
   Listings are cached on this device (localStorage 'alp.cache'); the Refresh button re-reads them. */
(function () {
  var C = window.APP_CONFIG, API = 'https://www.googleapis.com/drive/v3', CK = 'alp.cache';
  var FOLDER = 'application/vnd.google-apps.folder', SHORTCUT = 'application/vnd.google-apps.shortcut';
  var AUDIO_EXT = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|wav|flac|wma|amr|weba|webm|mp4a)$/i;
  var FIELDS = 'nextPageToken,files(id,name,mimeType,size,createdTime,parents,shortcutDetails(targetId,targetMimeType))';

  function err(status, msg) { var e = new Error(msg || 'http'); e.status = status; return e; }
  function call(url, how) {
    var sep = url.indexOf('?') < 0 ? '?' : '&';
    if (how === 't') {
      var t = window.Sync && Sync.token();
      if (!t) return Promise.reject(err(0, 'notoken'));
      return fetch(url, { headers: { Authorization: 'Bearer ' + t } }).then(ok);
    }
    if (!C.apiKey) return Promise.reject(err(0, 'nokey'));
    return fetch(url + sep + 'key=' + C.apiKey, { referrerPolicy: 'no-referrer-when-downgrade' }).then(ok);
  }
  function ok(r) {
    if (r.ok) return r.json();
    return r.json().catch(function () { return {}; }).then(function (j) { throw err(r.status, (j.error && j.error.message) || 'HTTP ' + r.status); });
  }
  /* pref 't' = token first, 'k' = key first */
  function get(url, pref) {
    var order = pref === 't' ? ['t', 'k'] : ['k', 't'];
    return call(url, order[0]).catch(function (e1) {
      return call(url, order[1]).catch(function (e2) { throw (e2.message === 'notoken' || e2.message === 'nokey') ? e1 : e2; });
    });
  }

  var D = {
    c: null, busy: {},
    load: function () {
      try { this.c = JSON.parse(localStorage.getItem(CK)); } catch (e) { this.c = null; }
      if (!this.c) this.c = {};
      this.c.f = this.c.f || {}; this.c.dur = this.c.dur || {}; this.c.lib = this.c.lib || null;
    },
    persist: function () { try { localStorage.setItem(CK, JSON.stringify(this.c)); } catch (e) { console.warn('cache save failed', e); } },
    clearLib: function () { this.c.lib = null; this.persist(); },
    folder: function (id) { return this.c.f[id] || null; },
    /* lectures in play order: by file name, files added after the series was first seen go last ("ADDED LATER") */
    files: function (id) {
      var f = this.c.f[id]; if (!f) return [];
      var r = window.Store && Store.ser(id), seen = r && r.seen ? r.seen + 120000 : 0;
      if (!seen) return f.files;
      var a = [], b = []; f.files.forEach(function (x) { (x.c > seen ? b : a).push(x); });
      return b.length ? a.concat(b) : f.files;
    },
    late: function (id, x) { var r = window.Store && Store.ser(id); return !!(r && r.seen && x.c > r.seen + 120000); },
    dur: function (fid) { return this.c.dur[fid] || 0; },
    setDur: function (fid, d) { if (d > 0 && isFinite(d) && Math.abs((this.c.dur[fid] || 0) - d) > 1) { this.c.dur[fid] = Math.round(d); this.persist(); } },
    isAudio: function (f) { return (f.mimeType || '').indexOf('audio/') === 0 || AUDIO_EXT.test(f.name || ''); },
    isImage: function (f) { return (f.mimeType || '').indexOf('image/') === 0; },
    sortName: function (a, b) { return a.n.localeCompare(b.n, undefined, { numeric: true, sensitivity: 'base' }); },

    /* a Drive folder link, an app share link, or a bare ID → folder ID */
    parseLink: function (s) {
      s = (s || '').trim();
      var m = s.match(/[#&?]s=([\w-]{10,})/) || s.match(/\/folders\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/^([\w-]{20,})$/);
      return m ? m[1] : null;
    },
    meta: function (id, pref) {
      return get(API + '/files/' + id + '?supportsAllDrives=true&fields=id,name,mimeType,shortcutDetails(targetId,targetMimeType)', pref);
    },
    /* every child of these parents, paged; parents chunked so the query stays short */
    listIn: function (parents, pref, onlyFolders) {
      var out = [], chunks = [];
      for (var i = 0; i < parents.length; i += 20) chunks.push(parents.slice(i, i + 20));
      return chunks.reduce(function (p, ch) {
        return p.then(function () {
          var q = '(' + ch.map(function (id) { return "'" + id + "' in parents"; }).join(' or ') + ') and trashed=false';
          if (onlyFolders) q += " and (mimeType='" + FOLDER + "' or mimeType='" + SHORTCUT + "')";
          var page = function (tok) {
            var url = API + '/files?pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=' + encodeURIComponent(FIELDS) +
              '&q=' + encodeURIComponent(q) + (tok ? '&pageToken=' + tok : '');
            return get(url, pref).then(function (j) { out = out.concat(j.files || []); if (j.nextPageToken) return page(j.nextPageToken); });
          };
          return page();
        });
      }, Promise.resolve()).then(function () { return out; });
    },
    /* turn raw children of one folder into the cached series entry */
    store: function (id, name, kids) {
      var self = this, files = [], img = null;
      kids.forEach(function (f) {
        if (self.isAudio(f)) files.push({ id: f.id, n: f.name, sz: +f.size || 0, c: Date.parse(f.createdTime) || 0, m: f.mimeType });
        else if (!img && self.isImage(f)) img = f.id;
      });
      files.sort(this.sortName);
      var e = { name: name, files: files, img: img, at: Date.now() };
      this.c.f[id] = e; return e;
    },
    refreshFolder: function (id, pref) {
      var self = this;
      if (this.busy[id]) return this.busy[id];
      var p = this.meta(id, pref).then(function (m) {
        if (m.shortcutDetails && m.shortcutDetails.targetId) { id = m.shortcutDetails.targetId; }
        return self.listIn([id], pref).then(function (kids) { var e = self.store(id, m.name, kids); self.persist(); self.listed([id]); return e; });
      });
      this.busy[id] = p;
      p.then(function () { delete self.busy[id]; }, function () { delete self.busy[id]; });
      return p;
    },
    /* Library: subfolders of the chosen parent are the series; one batched listing reads all their files */
    refreshLib: function () {
      var self = this, S = window.Store, lib = S.d.lib;
      if (!lib || !lib.id) return Promise.resolve(null);
      if (this.busy.lib) return this.busy.lib;
      var p = this.listIn([lib.id], 't', true).then(function (kids) {
        var folders = kids.map(function (k) {
          var tid = k.shortcutDetails && k.shortcutDetails.targetMimeType === FOLDER ? k.shortcutDetails.targetId : (k.mimeType === FOLDER ? k.id : null);
          return tid ? { id: tid, name: k.name } : null;
        }).filter(Boolean);
        var ids = folders.map(function (f) { return f.id; });
        return self.listIn(ids, 't').then(function (all) {
          var by = {}; ids.forEach(function (id) { by[id] = []; });
          all.forEach(function (f) { (f.parents || []).forEach(function (pid) { if (by[pid]) by[pid].push(f); }); });
          folders.forEach(function (f) {
            self.store(f.id, f.name, by[f.id]);
            var r = S.ser(f.id);
            if (!r) S.setSer(f.id, { name: f.name, src: 'lib', seen: Date.now() }, true);
            else if (r.name !== f.name || (r.src !== 'lib' && r.src !== 'shared')) S.setSer(f.id, { name: f.name, src: r.src || 'lib' }, true);
          });
          self.c.lib = { id: lib.id, kids: ids, at: Date.now() }; self.persist(); S.save(); self.listed(ids);
          return ids;
        });
      });
      this.busy.lib = p;
      p.then(function () { delete self.busy.lib; }, function () { delete self.busy.lib; });
      return p;
    },
    /* after a listing: match phone-folder files, queue new files of whole-folder series */
    listed: function (ids) {
      if (window.Local) { Local.adopt(); Local.match(); }
      var P = window.Player; if (!P) return;
      var n = 0; ids.forEach(function (id) { n += P.fullSync(id); }); if (n) P.pump();
    },
    /* move a folder to Drive's trash (restorable for 30 days) */
    trash: function (id) {
      var t = window.Sync && Sync.token(); if (!t) return Promise.reject(err(0, 'notoken'));
      return fetch(API + '/files/' + id + '?supportsAllDrives=true', { method: 'PATCH', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }).then(ok);
    },
    libIds: function () { var l = this.c.lib, S = window.Store; return (l && S.d.lib && l.id === S.d.lib.id) ? l.kids : []; },

    /* folder picker (signed in) */
    pickList: function (where) {
      var q, url;
      if (where === 'drives') return call(API + '/drives?pageSize=100', 't').then(function (j) { return (j.drives || []).map(function (d) { return { id: d.id, name: d.name }; }); });
      if (where === 'shared') q = "sharedWithMe and mimeType='" + FOLDER + "' and trashed=false";
      else q = "'" + (where || 'root') + "' in parents and (mimeType='" + FOLDER + "' or mimeType='" + SHORTCUT + "') and trashed=false";
      url = API + '/files?pageSize=500&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=' + encodeURIComponent(FIELDS) + '&q=' + encodeURIComponent(q);
      return call(url, 't').then(function (j) {
        return (j.files || []).map(function (f) {
          if (f.mimeType === SHORTCUT) return f.shortcutDetails && f.shortcutDetails.targetMimeType === FOLDER ? { id: f.shortcutDetails.targetId, name: f.name } : null;
          return { id: f.id, name: f.name };
        }).filter(Boolean);
      });
    },
    /* is the folder readable with just the key, i.e. shared "Anyone with the link"? */
    isPublic: function (id) {
      if (!C.apiKey) return Promise.resolve(null);
      return call(API + '/files/' + id + '?supportsAllDrives=true&fields=id', 'k').then(function () { return true; }, function (e) { return e.status === 404 || e.status === 403 ? false : null; });
    },
    mediaUrl: function (fid) { return API + '/files/' + fid + '?alt=media&supportsAllDrives=true'; }
  };
  window.Drive = D;
})();
