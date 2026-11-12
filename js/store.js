/* Store: one local state object (localStorage 'alp.v1'), synced to Drive appData by Sync when signed in.
   Synced records carry u (updated ms); merge = per record, newer u wins.
   series[id]  = { id, name, src:'lib'|'shared', star, fin, finAt, seen, last, cur, off, u }
   prog[fileId]= { p: position s, d: duration s, done, s: seriesId, u }
   lib         = { id, name, u }  — the Library parent folder (signed in only)
   now         = { s, f, u }      — the lecture loaded in the player
   Local only: ui (tab, view, scroll), cache (folder listings — see drive.js),
   dl = { mob: allow mobile data 0|1, kept: { fileId: { s: seriesId, at } } } — downloads belong to this device. */
(function () {
  var KEY = 'alp.v1', SCHEMA = 1;
  function blank() { return { schema: SCHEMA, acct: null, settings: { theme: 'midnight', tint: true }, su: 0, series: {}, prog: {}, lib: null, now: null, ui: { tab: 'listen' }, dl: { mob: 0, kept: {} } }; }
  var S = {
    d: null, dirty: false,
    load: function () {
      try { this.d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { this.d = null; }
      if (!this.d) this.d = blank();
      this.migrate();
    },
    migrate: function () {
      var d = this.d, b = blank();
      Object.keys(b).forEach(function (k) { if (d[k] === undefined) d[k] = b[k]; });
      if (!d.ui) d.ui = { tab: 'listen' };
      if (!d.dl.kept) d.dl.kept = {};
      d.schema = SCHEMA;
    },
    reset: function (acct) { var ui = this.d.ui, st = this.d.settings, dl = this.d.dl; this.d = blank(); this.d.acct = acct; this.d.ui = ui; this.d.settings = st; this.d.dl = dl; this.persist(); },
    persist: function () { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) { console.warn('save failed', e); } },
    save: function () { this.dirty = true; this.persist(); if (window.Sync) Sync.schedule(); },
    saveUi: function () { this.persist(); },
    saveSettings: function () { this.d.su = Date.now(); this.save(); },

    ser: function (id) { return this.d.series[id] || null; },
    /* create or patch a series record */
    setSer: function (id, patch, quiet) {
      var r = this.d.series[id] || { id: id, star: 0, fin: 0, seen: Date.now() };
      Object.keys(patch || {}).forEach(function (k) { r[k] = patch[k]; });
      r.u = Date.now(); this.d.series[id] = r;
      if (quiet) { this.dirty = true; this.persist(); } else this.save();
      return r;
    },
    pr: function (fid) { return this.d.prog[fid] || null; },
    /* quiet = save locally only (used every few seconds while playing); sync happens on pause/hide/next */
    setPr: function (fid, patch, quiet) {
      var r = this.d.prog[fid] || { p: 0, d: 0, done: 0 };
      Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
      r.u = Date.now(); this.d.prog[fid] = r;
      if (quiet) { this.dirty = true; this.persist(); } else this.save();
      return r;
    },
    setNow: function (s, f) { this.d.now = { s: s, f: f, u: Date.now() }; this.dirty = true; this.persist(); },
    setLib: function (id, name) { this.d.lib = id ? { id: id, name: name, u: Date.now() } : { id: null, u: Date.now() }; this.save(); },

    merge: function (r) {
      var L = this.d;
      ['series', 'prog'].forEach(function (t) {
        var R = r[t] || {}, M = L[t];
        Object.keys(R).forEach(function (k) { var a = R[k], b = M[k]; if (!b || (a.u || 0) > (b.u || 0)) M[k] = a; });
      });
      if (r.lib && (!L.lib || (r.lib.u || 0) > (L.lib.u || 0))) L.lib = r.lib;
      if (r.now && (!L.now || (r.now.u || 0) > (L.now.u || 0))) L.now = r.now;
      if ((r.su || 0) > (L.su || 0)) { L.settings = r.settings; L.su = r.su; }
      this.dirty = true; this.persist();
    },
    exportData: function () { var c = JSON.parse(JSON.stringify(this.d)); delete c.ui; delete c.dl; return c; }
  };
  window.Store = S;
})();
