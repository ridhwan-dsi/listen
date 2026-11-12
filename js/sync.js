/* Sync: Google Identity Services token client + Drive appDataFolder (lectures.json).
   Same rules as Habits (toolkit 08): token kept in localStorage for its hour; a new token is asked for only on a tap,
   and only when something needs it (changes to sync, Library listing, private audio). Signed out = everything local.
   States: off | idle | paused | syncing | ok | error */
(function () {
  var S = window.Store, C = window.APP_CONFIG, API = 'https://www.googleapis.com', TK = 'alp.tok';
  var Sync = {
    tok: null, exp: 0, fileId: null, state: 'off', timer: null, client: null, lastSync: 0, asking: false, waiters: [],
    enabled: function () { return !!C.googleClientId; },
    gisReady: function () { return !!(window.google && google.accounts && google.accounts.oauth2); },
    set: function (st) { this.state = st; if (window.App) App.syncChanged(); },
    valid: function () { return !!this.tok && this.exp > Date.now() + 60000; },
    token: function () { return this.valid() ? this.tok : null; },
    saveTok: function (acct) { try { localStorage.setItem(TK, JSON.stringify({ tok: this.tok, exp: this.exp, acct: acct })); } catch (e) {} },
    dropTok: function () { this.tok = null; this.exp = 0; try { localStorage.removeItem(TK); } catch (e) {} },
    init: function () {
      var self = this;
      if (!this.enabled()) return;
      try { var t = JSON.parse(localStorage.getItem(TK)); if (t && t.exp > Date.now() + 60000 && t.acct === S.d.acct) { this.tok = t.tok; this.exp = t.exp; } } catch (e) {}
      var onTap = function () {
        setTimeout(function () {
          if (!S.d.acct || self.asking || navigator.onLine === false) return;
          var soon = !self.tok || self.exp < Date.now() + 10 * 60000;   // keep private playback alive: refresh on a tap near expiry
          if (soon && (S.dirty || (window.Player && Player.needsToken()))) self.signIn(true);
        }, 30);
      };
      document.addEventListener('pointerup', onTap, true);
      window.addEventListener('online', function () { if (self.valid()) self.pull(); });
      if (this.valid()) this.pull();
      else if (S.d.acct) this.set(S.dirty ? 'paused' : 'idle');
    },
    /* run cb(token) now, or after the sign-in popup (must be called from a tap) */
    need: function (cb) {
      if (this.valid()) return cb(this.tok);
      this.waiters.push(cb); this.signIn(!!S.d.acct);
    },
    signIn: function (silent) {
      var self = this;
      if (!this.enabled()) return App.toast('Sign-in is not set up yet');
      if (!this.gisReady()) { if (!silent) App.toast('Google sign-in is still loading — try again'); return; }
      if (!this.client) this.client = google.accounts.oauth2.initTokenClient({
        client_id: C.googleClientId, scope: C.scope,
        callback: function (r) { self.asking = false; self.onToken(r); },
        error_callback: function () { self.asking = false; self.waiters = []; self.set(S.d.acct ? 'paused' : 'off'); }
      });
      this.asking = true;
      this.client.requestAccessToken({ prompt: silent ? '' : 'select_account', login_hint: S.d.acct || undefined });
    },
    onToken: function (r) {
      var self = this;
      if (!r || r.error) { this.waiters = []; return this.set(S.d.acct ? 'paused' : 'off'); }
      this.tok = r.access_token; this.exp = Date.now() + (r.expires_in || 3600) * 1000;
      this.set('syncing');
      fetch(API + '/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + this.tok } })
        .then(function (x) { return x.json(); })
        .then(function (u) {
          if (S.d.acct && S.d.acct !== u.email) { S.reset(u.email); self.fileId = null; if (window.Drive) Drive.clearLib(); }   // other account: don't mix data
          else if (!S.d.acct) { S.d.acct = u.email; S.d.name = u.given_name || u.name || ''; S.dirty = true; S.persist(); }   // local progress joins the account
          self.saveTok(u.email);
          var w = self.waiters; self.waiters = [];
          w.forEach(function (cb) { try { cb(self.tok); } catch (e) { console.warn(e); } });
          if (window.Player) Player.tokenChanged();
          App.render();
          self.pull();
        }).catch(function () { self.set('error'); });
    },
    signOut: function () {
      if (this.tok && this.gisReady()) try { google.accounts.oauth2.revoke(this.tok, function () {}); } catch (e) {}
      this.dropTok(); this.fileId = null;
      S.d.acct = null; S.d.name = ''; S.d.lib = null; S.persist();   // progress stays on this device (signed-out mode keeps working)
      if (window.Drive) Drive.clearLib();
      this.set('off'); App.render();
    },
    api: function (url, opt) {
      var self = this; opt = opt || {};
      opt.headers = Object.assign({ Authorization: 'Bearer ' + this.tok }, opt.headers || {});
      return fetch(url, opt).then(function (r) {
        if (r.status === 401) { self.dropTok(); self.set('paused'); throw new Error('auth'); }
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) {
          var e = new Error('http'); e.status = r.status; e.msg = (j.error && j.error.message) || 'HTTP ' + r.status; throw e;
        });
        return r;
      });
    },
    fail: function (e) {
      if (e.message === 'auth') return;
      if (!e.status) { S.dirty = true; return this.set('paused'); }
      this.set('error'); if (e.msg) App.toast('Sync error: ' + e.msg.slice(0, 120));
    },
    findFile: function () {
      var self = this; if (this.fileId) return Promise.resolve(this.fileId);
      return this.api(API + '/drive/v3/files?spaces=appDataFolder&fields=files(id)&q=' + encodeURIComponent("name='" + C.driveFile + "'"))
        .then(function (r) { return r.json(); })
        .then(function (j) { self.fileId = (j.files && j.files[0] && j.files[0].id) || null; return self.fileId; });
    },
    pull: function () {
      var self = this; if (!this.valid()) return; this.set('syncing');
      this.findFile().then(function (id) {
        if (!id) { S.dirty = true; return null; }
        return self.api(API + '/drive/v3/files/' + id + '?alt=media').then(function (r) { return r.json(); });
      }).then(function (remote) { if (remote) { S.merge(remote); App.remoteMerged(); } return self.push(); })
        .catch(function (e) { self.fail(e); });
    },
    schedule: function (ms) {
      var self = this; clearTimeout(this.timer);
      if (!S.d.acct) return;
      if (!this.valid()) { if (this.state !== 'syncing') this.set('paused'); return; }
      this.timer = setTimeout(function () { self.push(); }, ms || 2500);
    },
    push: function () {
      var self = this;
      if (!this.valid()) return Promise.resolve();
      if (!S.dirty) { this.lastSync = Date.now(); this.set('ok'); return Promise.resolve(); }
      this.set('syncing');
      var body = JSON.stringify(S.exportData()), p; S.dirty = false;
      if (this.fileId) {
        p = this.api(API + '/upload/drive/v3/files/' + this.fileId + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body });
      } else {
        var b = 'bnd' + Date.now(), meta = JSON.stringify({ name: C.driveFile, parents: ['appDataFolder'], mimeType: 'application/json' });
        var multi = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + b + '--';
        p = this.api(API + '/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: multi })
          .then(function (r) { return r.json(); }).then(function (j) { self.fileId = j.id; });
      }
      return p.then(function () { self.lastSync = Date.now(); self.set('ok'); })
        .catch(function (e) { S.dirty = true; self.fail(e); });
    }
  };
  window.Sync = Sync;
})();
