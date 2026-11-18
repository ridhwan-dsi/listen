/* App: screens, actions, boot. Rendered as HTML strings into #app; one delegated click listener (data-act).
   Phone: 5 tabs + bottom nav + mini player; series / player / settings / folder picker are views on a stack
   (Android back pops them). Desktop: an explicit switch (wide screens only) — sidebar · main · now playing · bottom bar. */
(function () {
  var S = window.Store, D = window.Drive, P = window.Player, C = window.APP_CONFIG, Sync = window.Sync, Local = window.Local, Up = window.Up;
  var E = UI.esc, ic = UI.ic, U;
  var root = document.getElementById('app');
  var V = [];                  // view stack: {t:'series',id} | {t:'fdl',id} (its Downloads page) | {t:'player'} | {t:'settings'} | {t:'downloads'} | {t:'picker',path,items}
  var DSEL = null, DEXP = {}, DLS = null, PEND = null, lastCheck = 0;   // Downloads screen selection; last Drive check of whole-folder series
  var dlgHtml = null, bip = null, after = [], closing = false, drag = null, holdT = null, SC = {}, lastTick = 0, rq = 0, tried = {};
  var TABS = [['listen', 'head', 'Listening'], ['star', 'star', 'Starred'], ['lib', 'lib', 'Library'], ['shared', 'sh', 'Shared'], ['fin', 'done', 'Finished']];
  var THEMES = [['midnight', 'Midnight', '#07090d', '#1a2029', '#3ba7ff'], ['emerald', 'Emerald', '#05100c', '#15291f', '#d9b25a'], ['dusk', 'Dusk', '#0d0a14', '#221a33', '#b68cff'], ['sand', 'Sand', '#f5efe3', '#e3d7c0', '#b4612a']];
  var BASE = location.origin + location.pathname.replace(/[^/]*$/, '');

  function wide() { return innerWidth >= 1000; }
  function desk() { return !!U.desk && wide(); }
  function top() { return V[V.length - 1] || null; }
  function vib() { try { navigator.vibrate && navigator.vibrate(15); } catch (e) {} }

  /* ---------- data helpers ---------- */
  function name(sid) { var r = S.ser(sid), f = D.folder(sid); return (r && r.name) || (f && f.name) || 'Loading…'; }
  function tint(sid) { return UI.coverInfo(sid, name(sid)).h; }
  function stats(sid) {
    if (SC[sid]) return SC[sid];
    var fs = D.files(sid), kb = 0, ks = 0, o = { n: fs.length, eq: 0, tot: 0, left: 0, started: false, fr: [], approx: false };
    fs.forEach(function (f) { var d = (S.pr(f.id) || {}).d || D.dur(f.id); if (d && f.sz) { kb += f.sz; ks += d; } });
    var bps = o.bps = ks ? kb / ks : 8000;   // unknown lengths estimated from file size (64 kbps until one is known)
    fs.forEach(function (f) {
      var pr = S.pr(f.id) || {}, d = pr.d || D.dur(f.id);
      if (!d) { d = f.sz / bps; o.approx = true; }
      var x = pr.done ? 1 : d ? Math.min((pr.p || 0) / d, 0.99) : 0;
      if (pr.done || (pr.p || 0) > 5) o.started = true;
      o.fr.push(x); o.eq += x; o.tot += d; o.left += pr.done ? 0 : Math.max(0, d - (pr.p || 0));
    });
    o.pct = o.n ? Math.round(o.eq / o.n * 100) : 0;
    if (!o.n) { var r = S.ser(sid); if (r && r.last) o.started = true; }
    return (SC[sid] = o);
  }
  function fdur(f, sid) { var d = (S.pr(f.id) || {}).d || D.dur(f.id); return d ? { d: d, ap: false } : { d: f.sz / ((sid && stats(sid).bps) || 8000), ap: true }; }
  function status(sid) { var r = S.ser(sid); if (r && r.fin) return 'done'; return stats(sid).started ? 'go' : 'new'; }
  function cov(sid, size, dot) { return UI.cover(sid, name(sid), size, dot === false ? null : status(sid), P.img(sid)); }
  function all() { return Object.keys(S.d.series).map(function (k) { return S.d.series[k]; }).filter(function (r) { return r && r.id; }); }
  function byLast(a, b) { return (b.last || 0) - (a.last || 0); }
  function inProgress() { return all().filter(function (r) { return !r.fin && (r.src !== 'lib' || isLib(r.id)) && status(r.id) === 'go'; }).sort(byLast); }
  function isLib(id) { return D.libIds().indexOf(id) >= 0 || (S.ser(id) || {}).src !== 'lib'; }
  function libList() { return D.libIds().map(S.ser.bind(S)).filter(Boolean).filter(function (r) { return !r.fin; }); }
  function sharedList() { return all().filter(function (r) { return r.src === 'shared'; }).sort(function (a, b) { return (b.last || b.seen || 0) - (a.last || a.seen || 0); }); }
  function starList() { return all().filter(function (r) { return r.star; }).sort(byLast); }
  function finList() { return all().filter(function (r) { return r.fin; }).sort(function (a, b) { return (b.finAt || 0) - (a.finAt || 0); }); }
  function heroId() {
    var n = S.d.now; if (n && S.ser(n.s) && !S.ser(n.s).fin) return n.s;
    var l = inProgress(); return l.length ? l[0].id : null;
  }
  function lecNo(sid) { var fid = P.s === sid ? P.f : P.resumeFile(sid), fs = D.files(sid); for (var i = 0; i < fs.length; i++) if (fs[i].id === fid) return { i: i, f: fs[i] }; return null; }
  function srcLabel(sid) { var r = S.ser(sid) || {}; return r.src === 'lib' ? 'Library' : r.src === 'local' ? 'On this phone' : 'Shared'; }
  function sub(sid, ctx) {
    var r = S.ser(sid) || {}, s = stats(sid), st = status(sid), L = lecNo(sid);
    if (!s.n && !D.folder(sid)) return tried[sid] ? 'Could not load — tap Refresh' : 'Loading…';
    if (st === 'done') return s.n + ' lectures · finished ' + (r.finAt ? UI.ago(r.finAt) : '');
    if (st === 'new') return s.n + ' lectures · ' + (ctx === 'shared' ? 'added ' + UI.ago(r.seen) : 'new');
    return (ctx !== 'shared' && r.src === 'shared' ? 'Shared · ' : '') + 'Lecture ' + (L ? L.i + 1 : 1) + ' of ' + s.n + (r.last ? ' · ' + UI.ago(r.last) : '');
  }
  /* folders we know about but haven't listed on this device yet (e.g. synced from the other phone) */
  function need(sid) {
    if (Local.isLocal(sid) || D.folder(sid) || tried[sid] || D.busy[sid]) return;
    var mode = P.mode(sid);
    if (mode === 't' && !Sync.token() && !C.apiKey) return;
    D.refreshFolder(sid, mode).then(function () { App.state(); }, function (e) { tried[sid] = e.status || 1; App.state(); });
  }

  /* ---------- pieces ---------- */
  function hdr(title, smallTxt, extra) {
    return '<div class="hd"><div class="t">' + (smallTxt ? '<small>' + smallTxt + '</small>' : '') + '<h1>' + title + '</h1></div>' + (extra || '') +
      (wide() && !desk() ? '<div class="ib" data-act="desk" title="Computer view">' + ic('mon') + '</div>' : '') + avatar() + '</div>';
  }
  function avatar() {
    var n = S.d.name || S.d.acct || '';
    return '<div class="av" data-act="settings" title="Settings">' + (S.d.acct ? E((n[0] || 'R').toUpperCase()) : ic('gear')) + '</div>';
  }
  function refBtn() { var b = D.busy.lib || Object.keys(D.busy).length; return '<div class="ib' + (b ? ' spin' : '') + '" data-act="refresh" title="Refresh">' + ic('ref') + '</div>'; }
  function row(sid, ctx) {
    var s = stats(sid), st = status(sid), pct = st === 'done' ? 100 : s.pct;
    return '<div class="row' + (st === 'done' ? ' gone' : '') + '" data-act="ser" data-id="' + sid + '">' + cov(sid, 64) +
      '<div class="tx"><h4>' + E(name(sid)) + '</h4><p>' + E(sub(sid, ctx)) + '</p><div class="bar"><b style="width:' + pct + '%;' + (st === 'done' ? 'background:var(--mu)' : '') + '"></b></div></div><div class="pct">' + pct + '%</div></div>';
  }
  function card(sid, ctx) {
    var s = stats(sid), st = status(sid);
    var line = !s.n && !D.folder(sid) ? sub(sid) : st === 'done' ? s.n + ' lectures · finished' : st === 'new' ? s.n + ' lectures · new' : s.n + ' lectures · ' + s.pct + '%';
    return '<div data-act="ser" data-id="' + sid + '"><div class="cw">' + cov(sid, 0) + (st !== 'new' ? '<div class="ring">' + UI.ring(st === 'done' ? 100 : s.pct, st === 'done' ? '#8b95a3' : '#fff') + '</div>' : '') + '</div><h4>' + E(name(sid)) + '</h4><p>' + E(line) + '</p></div>';
  }
  function chips(tab, opts) {
    var cur = (U.chip || {})[tab] || 'all';
    return '<div class="chips">' + opts.map(function (o) {
      return '<span class="chip' + (cur === o[0] ? ' on' : '') + '" data-act="chip" data-t="' + tab + '" data-v="' + o[0] + '">' + (o[2] ? '<i class="dot d-' + o[2] + '"></i>' : '') + o[1] + '</span>';
    }).join('') + '</div>';
  }
  function filt(tab, list) {
    var cur = (U.chip || {})[tab] || 'all', q = ((U.q || {})[tab] || '').toLowerCase();
    return list.filter(function (r) { return (cur === 'all' || status(r.id) === cur) && (!q || name(r.id).toLowerCase().indexOf(q) >= 0); });
  }
  function searchBox(tab, ph) { return '<div class="search">' + ic('srch') + '<input data-keep="q-' + tab + '" data-q="' + tab + '" placeholder="' + ph + '" value="' + E((U.q || {})[tab] || '') + '" autocomplete="off"></div>'; }
  function playIcon(sid) { return P.s === sid && P.playing() ? UI.PAUSE : UI.PLAY; }
  function installBanner() {
    return (Local.root && !Local.ok() ? '<div class="install" data-act="reconnect">' + ic('folder') + '<span>Allow the phone folder “' + E(Local.name()) + '” again to use your saved lectures</span><span class="b">Allow</span></div>' : '') +
      (bip && !standalone() ? '<div class="install" data-act="install">' + ic('dl') + '<span>Install the app for one-tap listening</span><span class="b">Install</span></div>' : '');
  }
  function standalone() { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches; }

  /* ---------- tabs ---------- */
  function tabListen() {
    var h = '', hid = heroId(), dk = desk();
    if (!dk) h += hdr('Listening', 'As-salāmu ʿalaykum', refBtn());
    h += installBanner();
    if (hid) {
      need(hid);
      var s = stats(hid), L = lecNo(hid), lf = L && fdur(L.f, hid), pr = L ? S.pr(L.f.id) || {} : {};
      var leftL = L ? Math.max(0, lf.d - (pr.p || 0)) : 0;
      var line = L ? 'Lecture ' + (L.i + 1) + ' · ' + E(UI.title(L.f.n)) + (dk ? ' — ' : '<br>') + (lf.ap ? '~' : '') + UI.dur(leftL) + ' left in lecture' : E(sub(hid));
      var meta = '<div class="meta2"><span>' + s.eq.toFixed(1).replace('.0', '') + ' of ' + s.n + ' lectures' + (dk ? ' · ' + s.pct + '%' : '') + '</span><span>' + (s.approx ? '~' : '') + UI.hrs(s.left) + ' left' + (dk ? ' in series' : '') + '</span></div>';
      if (dk) {
        var r = S.ser(hid) || {};
        h += '<div class="dhero" style="--h1:' + tint(hid) + '88">' + '<div data-act="ser" data-id="' + hid + '">' + cov(hid, 170, false) + '</div><div style="flex:1;min-width:0"><div class="lab">Continue listening</div><h2 style="margin-top:8px">' + E(name(hid)) + '</h2><p>' + line + '</p>' + UI.seg(s.fr) + meta +
          '<div class="acts"><div class="res" style="flex:none;padding:0 26px" data-act="heroPlay" data-id="' + hid + '">' + playIcon(hid) + (P.s === hid && P.playing() ? 'Pause' : 'Resume') + '</div>' +
          '<div class="cb' + (r.star ? ' starred' : '') + '" data-act="star" data-id="' + hid + '" title="Star">' + ic('star') + '</div><div class="cb" data-act="share" data-id="' + hid + '" title="Share">' + ic('shr') + '</div><div class="cb" data-act="ser" data-id="' + hid + '" title="Lectures">' + ic('list') + '</div></div></div></div>';
      } else {
        h += '<div class="hero" style="--h1:' + tint(hid) + '66"><div class="lab">Continue</div><div class="hrow" data-act="ser" data-id="' + hid + '">' + cov(hid, 112, false) +
          '<div style="flex:1;min-width:0"><h2>' + E(name(hid)) + '</h2><p>' + line + '</p></div></div>' +
          '<div style="display:flex;align-items:flex-end;gap:12px"><div style="flex:1;min-width:0">' + UI.seg(s.fr) + meta + '</div><div class="pbtn" data-act="heroPlay" data-id="' + hid + '">' + playIcon(hid) + '</div></div></div>';
      }
    }
    var month = Date.now() - 30 * 864e5;
    var also = inProgress().filter(function (r) { return r.id !== hid && (r.last || 0) > month; });
    if (also.length) {
      h += '<div class="sec"><h3>Also in progress</h3></div>';
      h += dk ? '<div class="dgrid">' + also.map(function (r) { return card(r.id); }).join('') + '</div>' : also.map(function (r) { return row(r.id); }).join('');
    }
    if (!hid && !also.length) h += emptyStart();
    return h;
  }
  function emptyStart() {
    return '<div class="empty"><h3>Nothing playing yet</h3><p>Open a lecture link someone shared with you, or sign in with Google to browse your own Drive folder of lectures.</p><div class="btns">' +
      '<div class="res" data-act="addLink">' + ic('link', 'i', 'stroke:var(--on)') + 'Add a shared link</div>' +
      '<div class="res sec2" data-act="tab" data-t="lib">' + ic('lib') + 'Open my Library</div></div></div>';
  }
  function tabList(tab) {
    var dk = desk(), h = '', list, title, opts, ctx = tab, extra = refBtn();
    if (tab === 'star') { title = 'Starred'; list = starList(); opts = [['all', 'All'], ['new', 'New', 'new'], ['go', 'Started', 'go'], ['done', 'Finished', 'done']]; }
    if (tab === 'shared') { title = 'Shared with me'; list = sharedList(); opts = [['all', 'All'], ['new', 'New', 'new'], ['go', 'Started', 'go'], ['done', 'Finished', 'done']]; }
    if (tab === 'fin') { title = 'Finished'; list = finList(); opts = null; }
    if (!dk) h += hdr(title, '', extra);
    else if (tab === 'shared') h += '<div style="margin:-6px 0 14px"><span class="btn2 gh" data-act="addLink" style="display:inline-flex;gap:6px;align-items:center">' + ic('plus', 'i', 'width:15px;height:15px') + 'Add a shared link</span></div>';
    list.forEach(function (r) { need(r.id); });
    if (opts && list.length) h += chips(tab, opts.map(function (o) { var n = o[0] === 'all' ? list.length : list.filter(function (r) { return status(r.id) === o[0]; }).length; return [o[0], o[1] + ' ' + n, o[2]]; }))
      .replace(/<\/div>$/, tab === 'shared' && !dk ? '<span class="chip" data-act="addLink">' + ic('plus') + 'Add link</span></div>' : '</div>');
    var show = filt(tab, list);
    if (!list.length) {
      var msg = tab === 'star' ? ['No starred series', 'Tap the star on any series to keep it here.'] : tab === 'fin' ? ['Nothing finished yet', 'When you finish every lecture of a series it moves here.'] :
        ['No shared lectures yet', 'When someone sends you a lecture link, open it and tap “Add & play”. You can also paste a Google Drive folder link.'];
      h += '<div class="empty"><h3>' + msg[0] + '</h3><p>' + msg[1] + '</p>' + (tab === 'shared' ? '<div class="btns"><div class="res" data-act="addLink">' + ic('link', 'i', 'stroke:var(--on)') + 'Add a shared link</div></div>' : '') + '</div>';
    } else if (!show.length) h += '<p class="note">Nothing here with this filter.</p>';
    h += dk ? '<div class="dgrid">' + show.map(function (r) { return card(r.id, ctx); }).join('') + '</div>' : show.map(function (r) { return row(r.id, ctx); }).join('');
    return h;
  }
  function tabLib() {
    var dk = desk(), h = '', loc = all().filter(function (r) { return r.src === 'local' && !r.fin; }).sort(function (a, b) { return name(a.id).localeCompare(name(b.id)); });
    var locH = loc.length ? '<div class="sec"><h3>On this phone</h3></div><div class="' + (dk ? 'dgrid' : 'grid') + '">' + loc.map(function (r) { return card(r.id); }).join('') + '</div>' : '';
    if (!dk) h += '<div class="hd"><div class="t"><h1>Library</h1></div>' + refBtn() + (wide() ? '<div class="ib" data-act="desk" title="Computer view">' + ic('mon') + '</div>' : '') + '<div class="ib" data-act="settings">' + ic('gear') + '</div></div>';
    if (Local.root && !Local.ok()) h += installBanner();
    if (!S.d.acct) return h + locH + '<div class="empty"><h3>Your lectures in Google Drive</h3><p>Sign in with Google and pick one folder in your Drive. Each folder inside it becomes a series here, with its audio files as lectures.</p><div class="btns"><div class="res" data-act="signIn">' + ic('user', 'i', 'stroke:var(--on)') + 'Sign in with Google</div></div></div>';
    if (!S.d.lib || !S.d.lib.id) return h + locH + '<div class="empty"><h3>Choose your Library folder</h3><p>Pick the Drive folder that holds your lecture folders (owned by you or shared with you).</p><div class="btns"><div class="res" data-act="pickLib">' + ic('folder', 'i', 'stroke:var(--on)') + 'Choose folder</div></div></div>';
    var list = libList(), ids = D.libIds();
    if (!dk) h += searchBox('lib', 'Search lectures');
    var opts = [['all', 'All ' + list.length], ['new', 'New ' + list.filter(function (r) { return status(r.id) === 'new'; }).length], ['go', 'Started ' + list.filter(function (r) { return status(r.id) === 'go'; }).length]];
    h += chips('lib', opts).replace('</div>', '<span class="chip" data-act="pickLib" title="Change Library folder">' + ic('drive') + E(S.d.lib.name || 'Library') + '/</span></div>');
    if (!ids.length) {
      h += '<div class="empty"><h3>' + (D.busy.lib ? 'Reading your folder…' : 'No series yet') + '</h3><p>' + (D.busy.lib ? 'One moment.' : Sync.token() ? 'Folders inside “' + E(S.d.lib.name) + '” appear here. Add some in Drive, then tap Refresh.' : 'Tap Refresh to read your folder from Google Drive.') + '</p>' +
        (D.busy.lib ? '' : '<div class="btns"><div class="res" data-act="refresh">' + ic('ref', 'i', 'stroke:var(--on)') + 'Refresh</div></div>') + '</div>';
      return h + locH;
    }
    var show = filt('lib', list);
    h += '<div class="' + (dk ? 'dgrid' : 'grid') + '">' + show.map(function (r) { return card(r.id); }).join('') + '</div>';
    if (!show.length) h += '<p class="note">' + (list.length ? 'Nothing matches.' : 'Everything here is finished — see the Finished tab.') + '</p>';
    return h + locH;
  }

  /* ---------- series screen ---------- */
  /* ---------- downloads ---------- */
  function box(on) { return '<div class="box' + (on ? ' on' : '') + '">' + (on ? '<svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9" stroke="var(--on)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '') + '</div>'; }
  function fileOf(sid, fid) { return D.files(sid).filter(function (f) { return f.id === fid; })[0] || null; }
  /* a lecture's line in the list only says whether it is on this device */
  function dlState(fid) { return P.cached[fid] ? ' <span class="ofk" title="On this device">' + UI.DLK + '</span>' : ''; }
  function sizeOf(ids) { var sz = {}, b = 0; P.saved().forEach(function (x) { sz[x.f.id] = x.f.sz || 0; }); ids.forEach(function (id) { b += sz[id] || 0; }); return b; }
  function confirmDel(title, b, extra, fn) {
    PEND = function () { fn().then(function () { DLS = null; DSEL = null; App.toast('Deleted · ' + UI.mb(b) + ' freed'); render(); }); };
    openDlg(msgDlg(title, 'This frees ' + UI.mb(b) + ' on this device.' + (extra || '') + ' You can download them again any time.', '<div class="res sec2" data-act="closeDlg">Cancel</div><div class="res red" data-act="pendGo">Delete</div>'));
  }
  function viewDownloads() {
    var all = P.saved(), groups = {}, order = [], tot = P.offBytes();
    all.forEach(function (x) { if (!groups[x.s]) { groups[x.s] = []; order.push(x.s); } groups[x.s].push(x.f); });
    if (!DLS) { DLS = { wait: 1 }; P.free().then(function (sp) { DLS = sp || { none: 1 }; schedule(); }); }
    var h = '<div class="hd">' + (desk() ? '' : '<div class="ib" data-act="back">' + ic('back') + '</div>') + '<div class="t"><h1 style="font-size:24px">All downloads</h1></div>' + (all.length ? '<span class="btn2 gh" data-act="dselMode">' + (DSEL ? 'Cancel' : 'Select') + '</span>' : '') + '</div>';
    h += '<div class="grp"><div class="it">' + ic('dl') + '<div class="tx">' + (tot ? UI.mb(tot) + ' of lectures on this device' : 'No lectures saved on this device') + '<small>' +
      (DLS.wait ? 'Checking space…' : DLS.none ? 'This browser doesn’t report free space' : 'App uses ' + UI.mb(DLS.used) + ' · ' + UI.mb(DLS.free) + ' free for it') + '</small></div></div></div>';
    if (P.q.length) {
      var qi = P.qInfo();
      h += '<div class="gt">DOWNLOADING</div><div class="grp">';
      if (qi.w) h += '<div class="it"><div class="tx">' + wtxt(qi.w) + ' — ' + qi.n + ' queued<small>Each folder’s Wi-Fi / mobile data choice is on its Downloads page</small></div></div>';
      h += P.q.slice().sort(function (a, b) { return (P.running === b) - (P.running === a) || b.k - a.k; }).map(function (x) {
        var f = fileOf(x.s, x.f), d = P.dl[x.f] || {}, run = P.running === x, pc = d.tot ? Math.round(d.got / d.tot * 100) : 0;
        var st = d.fail ? 'Failed' : run ? (d.tot ? pc + '% of ' + UI.mb(d.tot) : 'Starting…') : d.w ? wtxt(d.w) : d.next > Date.now() ? 'Trying again soon' : 'Queued' + (d.tot ? ' · ' + UI.mb(d.tot) : '');
        return '<div class="it">' + UI.cover(x.s, name(x.s), 34, null) + '<div class="tx">' + E(f ? UI.title(f.n) : 'Lecture') + '<small><span class="tag' + (x.k ? ' k' : '') + '">' + (x.k ? 'Kept' : 'Auto') + '</span>' + E(name(x.s)) + ' · ' + st + '</small>' +
          (run && d.tot ? '<div class="qbar"><b style="width:' + pc + '%"></b></div>' : '') + '</div>' +
          (d.fail ? '<span class="btn2" data-act="dlRetry" data-id="' + x.f + '">Retry</span>' : '') + '<div class="ib sm" data-act="dlCancel" data-id="' + x.f + '" title="Cancel">' + ic('x') + '</div></div>';
      }).join('') + '</div>';
    }
    if (order.length) {
      h += '<div class="gt">ON THIS DEVICE</div>';
      order.forEach(function (sid) {
        var fs = groups[sid], b = 0, open = DEXP[sid] || !!DSEL, allOn = DSEL && fs.every(function (f) { return DSEL[f.id]; });
        fs.forEach(function (f) { b += f.sz || 0; });
        h += '<div class="grp dgp"><div class="it" data-act="' + (DSEL ? 'dselSer' : 'dexp') + '" data-id="' + sid + '">' + (DSEL ? box(allOn) : '') + UI.cover(sid, name(sid), 40, null) +
          '<div class="tx">' + E(name(sid)) + '<small>' + fs.length + (fs.length === 1 ? ' lecture' : ' lectures') + ' · ' + UI.mb(b) + (P.cfg(sid).full ? ' · whole folder' : '') + '</small></div>' +
          (DSEL ? '' : '<span class="btn2 gh" data-act="fdl" data-id="' + sid + '">Settings</span>') +
          (DSEL ? '' : '<div class="ib sm" data-act="drmSer" data-id="' + sid + '" title="Delete series downloads">' + ic('trash') + '</div><span class="chev' + (open ? ' up' : '') + '">' + ic('down') + '</span>') + '</div>';
        if (open) h += fs.map(function (f) {
          var k = P.kept(f.id);
          return '<div class="it dl2' + (DSEL ? ' s' : '') + '"' + (DSEL ? ' data-act="dselLec" data-id="' + f.id + '"' : '') + '>' + (DSEL ? box(DSEL[f.id]) : '') + '<div class="tx">' + E(UI.title(f.n)) +
            '<small><span class="tag' + (k ? ' k' : '') + '">' + (k ? 'Kept' : 'Auto') + '</span>' + UI.mb(f.sz || 0) + (P.s === sid && P.f === f.id ? ' · playing' : '') + '</small></div>' +
            (DSEL ? '' : '<div class="ib sm" data-act="drmLec" data-id="' + f.id + '" title="Delete">' + ic('trash') + '</div>') + '</div>';
        }).join('');
        h += '</div>';
      });
    }
    if (DSEL) { var n = Object.keys(DSEL).length; h += '<div class="selgo"><div class="res' + (n ? ' red' : ' sec2') + '" data-act="dselGo">' + (n ? 'Delete ' + n + ' (' + UI.mb(sizeOf(Object.keys(DSEL))) + ')' : 'Tick lectures to delete') + '</div></div>'; }
    else if (order.length || Object.keys(P.cached).length) h += '<div class="dbtns">' + (P.autoIds().length ? '<div class="res sec2" data-act="drmAuto">Delete all auto copies</div>' : '') + '<div class="res sec2 red2" data-act="drmAll">Delete everything</div></div>';
    if (!order.length && !P.q.length) h += '<p class="note" style="margin-top:12px">To keep lectures on this device, open a series and tap its Downloads button: keep nearby lectures, or download the whole folder.</p>';
    return h;
  }

  /* ---------- a series' Downloads page (the one place for download settings) ---------- */
  function wtxt(w) { return { off: 'Waiting for connection', wifi: 'Waiting for Wi-Fi', mob: 'Waiting — Wi-Fi is switched off for this folder', none: 'Paused — tick Wi-Fi or Mobile data', auth: 'Waiting for Google sign-in — tap anywhere to continue', folder: 'Waiting for the phone folder' }[w] || ''; }
  function folderRow(sid) {
    if (!Local.supported()) return '<div class="it">' + ic('folder') + '<div class="tx">Saved inside the app<small>This browser can’t save into a phone folder (needs Chrome on Android or a computer)</small></div></div>';
    if (!Local.root) return '<div class="it" data-act="pickFolder">' + ic('folder') + '<div class="tx">Saved inside the app<small>Choose a phone folder to keep lectures as files you can see and add to</small></div><span class="btn2">Choose</span></div>';
    if (!Local.ok()) return '<div class="it" data-act="reconnect">' + ic('folder') + '<div class="tx">Phone folder “' + E(Local.name()) + '”<small>Chrome needs your OK to use it again</small></div><span class="btn2">Allow</span></div>';
    return '<div class="it">' + ic('folder') + '<div class="tx">Saved in the phone folder<small>' + E(Local.name() + (sid ? ' / ' + Local.dirOf(sid) : '')) + '</small></div><span class="btn2 gh" data-act="pickFolder">Change</span></div>';
  }
  function qItem(x) {
    var f = fileOf(x.s, x.f), d = P.dl[x.f] || {}, run = P.running === x, pc = d.tot ? Math.round(d.got / d.tot * 100) : 0;
    var st = d.fail ? 'Failed' + (d.err ? ' (' + d.err + ')' : '') : run ? (d.tot ? pc + '% of ' + UI.mb(d.tot) : 'Starting…') : d.w ? wtxt(d.w) : d.next > Date.now() ? 'Trying again soon' + (d.err ? ' (' + d.err + ')' : '') : 'Queued' + (d.tot ? ' · ' + UI.mb(d.tot) : '');
    return '<div class="it"><div class="tx">' + E(f ? UI.title(f.n) : 'Lecture') + '<small>' + E(st) + '</small>' + (run && d.tot ? '<div class="qbar"><b style="width:' + pc + '%"></b></div>' : '') + '</div>' +
      (d.fail ? '<span class="btn2" data-act="dlRetry" data-id="' + x.f + '">Retry</span>' : '') + '</div>';
  }
  function viewFolderDl(v) {
    var sid = v.id, c = P.cfg(sid), r = S.ser(sid) || {}, loc = Local.isLocal(sid), fs = D.files(sid);
    var on = fs.filter(function (x) { return P.cached[x.id]; }), onB = 0, allB = 0, win = loc ? [] : P.window(sid), wb = 0;
    on.forEach(function (x) { onB += x.sz || 0; }); fs.forEach(function (x) { allB += x.sz || 0; }); win.forEach(function (x) { wb += x.sz || 0; });
    var h = '<div class="hd">' + (desk() ? '' : '<div class="ib" data-act="back">' + ic('back') + '</div>') + '<div class="t"><small>' + E(name(sid)) + '</small><h1 style="font-size:24px">Downloads</h1></div></div>';
    h += '<div class="grp"><div class="it">' + ic('dl') + '<div class="tx">' + (loc ? fs.length + ' lectures on this phone' : on.length + ' of ' + fs.length + ' lectures on this device') + '<small>' + UI.mb(onB) + (loc ? '' : ' of ' + UI.mb(allB)) + '</small></div></div>' + folderRow(sid) + '</div>';
    if (!loc) {
      var left = 0; fs.forEach(function (x) { if (!P.cached[x.id]) left += x.sz || 0; });
      h += '<div class="gt">KEEP ON THIS DEVICE</div><div class="grp">' +
        '<div class="it" data-act="offTg" data-id="' + sid + '"><div class="tx">Keep nearby lectures offline<small>Current, 2 before, next 2 or 1 hour · ' + UI.mb(wb) + '</small></div><div class="tg' + (r.off ? ' on' : '') + '"></div></div>' +
        '<div class="it" data-act="fullTg" data-id="' + sid + '"><div class="tx">Download whole folder<small>' + fs.length + ' lectures · ' + (left ? UI.mb(left) + ' to download' : 'all on this device') + ' · new lectures added in Drive download when the app opens</small></div><div class="tg' + (c.full ? ' on' : '') + '"></div></div></div>';
    }
    h += '<div class="gt">' + (loc ? 'UPLOAD USING' : 'DOWNLOAD USING') + '</div><div class="grp">' +
      '<div class="it" data-act="netTg" data-k="wifi" data-id="' + sid + '">' + box(c.wifi) + '<div class="tx">Wi-Fi</div></div>' +
      '<div class="it" data-act="netTg" data-k="mob" data-id="' + sid + '">' + box(c.mob) + '<div class="tx">Mobile data<small>' + (P.netKnown() ? 'Streaming the lecture you play always works' : 'This browser can’t tell Wi-Fi from mobile data, so these settings can’t be applied here') + '</small></div></div></div>';
    var canUp = loc || ((r.src === 'lib') && Local.ok() && Local.hasDir(sid));
    if (canUp) {
      var u = Up.info(sid), ut = '';
      if (u && Up.running === sid && u.n != null) ut = 'Uploading ' + Math.min(u.done + 1, u.n) + ' of ' + u.n + (u.tot ? ' · ' + Math.round(u.got / u.tot * 100) + '%' : '');
      else if (u && u.w) ut = wtxt(u.w);
      else if (u && u.err) ut = 'Trying again soon (' + u.err + ')';
      else if (u) ut = 'Starting…';
      var lib = S.d.lib && S.d.lib.id ? S.d.lib.name || 'Library' : null;
      h += '<div class="gt">GOOGLE DRIVE</div><div class="grp"><div class="it" data-act="upTg" data-id="' + sid + '"><div class="tx">' + (loc ? 'Upload to Drive' : 'Upload files added on the phone') +
        '<small>' + (ut ? E(ut) : loc ? (lib ? 'Copies this folder into “' + E(lib) + '” in Drive, so it plays on your other devices' : 'Sign in and choose your Library folder first') : 'New files you put in this phone folder go up to its Drive folder') + '</small>' +
        (u && u.tot && Up.running === sid ? '<div class="qbar"><b style="width:' + Math.round(u.got / u.tot * 100) + '%"></b></div>' : '') + '</div><div class="tg' + (c.up ? ' on' : '') + '"></div></div></div>';
    }
    var mine = P.q.filter(function (x) { return x.s === sid; });
    if (mine.length) {
      mine.sort(function (a, b) { return (P.running === b) - (P.running === a) || b.k - a.k || a.at - b.at; });
      h += '<div class="gt">DOWNLOADING · ' + mine.length + '</div><div class="grp">' + mine.slice(0, 30).map(qItem).join('') + (mine.length > 30 ? '<div class="it"><div class="tx"><small>…and ' + (mine.length - 30) + ' more</small></div></div>' : '') + '</div>';
    }
    h += '<div class="dbtns">' + (mine.length ? '<div class="res sec2" data-act="dlNow">' + ic('ref') + 'Try now</div>' : '') +
      (loc ? '' : '<div class="res sec2" data-act="checkNew" data-id="' + sid + '">' + ic('drive') + 'Check Drive for new lectures</div>') +
      (on.length && !loc ? '<div class="res sec2 red2" data-act="fdlDel" data-id="' + sid + '">Delete this folder’s downloads</div>' : '') + '</div>';
    return h;
  }
  /* ask for the phone folder once (from a tap); without it, downloads go inside the app */
  function needFolder(go) {
    if (!Local.supported() || Local.ok()) return go();
    (Local.root ? Local.reconnect() : Local.choose()).then(function () { P.scanCached().then(function () { Local.match(); go(); }); },
      function () { App.toast('No phone folder — saving inside the app'); go(); });
  }
  function delPhone(sid) {
    P.setCfg(sid, { full: 0, up: 0 }); if (!Local.isLocal(sid)) S.setSer(sid, { off: 0 });
    var ids = D.files(sid).map(function (f) { return f.id; }).filter(function (id) { return P.cached[id] || P.inQ(id); });
    return (Local.isLocal(sid) ? Promise.resolve() : P.remove(ids)).then(function () { return Local.hasDir(sid) ? Local.removeDir(sid) : null; }).then(function () { return Local.isLocal(sid) ? Local.scan() : null; });
  }
  function delDrive(sid) {
    Sync.needWrite(function () {
      D.trash(sid).then(function () { App.toast('Moved to Drive’s trash'); if (S.d.lib && S.d.lib.id) D.refreshLib().then(schedule, schedule); },
        function (e) { App.toast('Could not delete in Drive: ' + (e.message || 'error')); });
    });
  }

  function viewSeries(v) {
    var sid = v.id, r = S.ser(sid) || {}, f = D.folder(sid), s = stats(sid), dk = desk();
    need(sid); if (f) P.probe(sid);
    var h = '<div class="amb"></div><div class="hd" style="position:relative">' + (dk ? '' : '<div class="ib" data-act="back">' + ic('back') + '</div>') + '<div class="t"></div>' + refBtn() + '</div>';
    var fs = D.files(sid), L = lecNo(sid), st = status(sid);
    var resumeTxt = st === 'done' ? 'Listen again' : !s.started ? 'Play lecture 1' : 'Resume lecture ' + (L ? L.i + 1 : 1);
    if (P.s === sid && P.playing()) resumeTxt = 'Pause';
    h += '<div class="fhead"><div class="fbig">' + cov(sid, dk ? 150 : 120, false) + '<div style="min-width:0"><h2>' + E(name(sid)) + '</h2><p>' + (f ? s.n + ' lectures · ' + (s.approx ? '~' : '') + UI.hrs(s.tot) + ' · ' : '') + srcLabel(sid) + '</p></div></div>';
    if (!f) {
      var er = tried[sid];
      h += '<div class="empty" style="margin:16px 0 0">' + (er ? '<h3>Could not open this folder</h3><p>' + (er === 404 || er === 403 ? 'It is not shared with “Anyone with the link”, or it was removed.' + (S.d.acct ? '' : ' If it is shared with your Google account, sign in.') : 'Check your connection and tap Refresh.') + '</p>' : '<h3>Loading lectures…</h3>') + '</div></div>';
      return h;
    }
    var loc = Local.isLocal(sid), dc = P.cfg(sid), dOn = dc.full || r.off || (loc && dc.up);
    h += UI.seg(s.fr) + '<div class="meta2"><span>' + s.eq.toFixed(1).replace('.0', '') + ' of ' + s.n + ' lectures · ' + s.pct + '%</span><span>' + (s.approx ? '~' : '') + UI.hrs(s.left) + ' left</span></div>' +
      '<div class="acts">' + (fs.length ? '<div class="res" data-act="resume" data-id="' + sid + '">' + (resumeTxt === 'Pause' ? UI.PAUSE : UI.PLAY) + resumeTxt + '</div>' : '<div class="res sec2">No audio files yet</div>') +
      '<div class="cb' + (dOn ? ' dlon' : '') + '" data-act="fdl" data-id="' + sid + '" title="Downloads">' + (dOn ? UI.DLK : ic('dl')) + '</div>' + '<div class="cb' + (r.star ? ' starred' : '') + '" data-act="star" data-id="' + sid + '" title="Star">' + ic('star') + '</div>' +
      (loc ? '' : '<div class="cb" data-act="share" data-id="' + sid + '" title="Share">' + ic('shr') + '</div>') + '</div></div>';
    var early = [], late = [];
    fs.forEach(function (x, i) { (D.late(sid, x) ? late : early).push([x, i]); });
    var cur = P.s === sid ? P.f : (s.started ? P.resumeFile(sid) : null);
    var lec = function (p) {
      var x = p[0], i = p[1], pr = S.pr(x.id) || {}, fd = fdur(x, sid), isCur = x.id === cur, pct = fd.d ? Math.round((pr.p || 0) / fd.d * 100) : 0, dn = pr.done && !isCur;
      var num = pr.done && !isCur ? UI.CHECK : isCur || (pr.p || 0) > 5 ? UI.ring(pr.done ? 100 : pct) : '<span>' + (i + 1 < 10 ? '0' : '') + (i + 1) + '</span>';
      var left = Math.max(0, fd.d - (pr.p || 0)), ap = fd.ap ? '~' : '';
      var line = isCur && P.s === sid ? (P.playing() ? 'Playing' : 'Paused') + ' · ' + ap + UI.dur(left) + ' left' : (pr.p || 0) > 5 && !pr.done ? ap + UI.dur(left) + ' left' : ap + UI.dur(fd.d);
      var off = dlState(x.id);
      var isNew = D.late(sid, x) && !pr.p && !pr.done;
      return '<div class="fl' + (isCur ? ' cur' : '') + (dn ? ' dn' : '') + '" data-act="lec" data-id="' + x.id + '"><div class="num">' + num + '</div><div class="tx"><h4>' + E(UI.title(x.n)) + (isNew ? ' <span class="new">NEW</span>' : '') + '</h4><p>' + line + (loc ? '' : off) + '</p></div></div>';
    };
    h += early.map(lec).join('');
    if (late.length) h += '<div class="added">ADDED LATER</div>' + late.map(lec).join('');
    if (!fs.length) h += '<p class="note">This folder has no audio files yet. ' + (loc ? 'Add them to the folder on the phone' : 'Add them in Drive') + ', then tap Refresh.</p>';
    if (fs.length) h += '<span class="lnk" data-act="finTg" data-id="' + sid + '" style="text-align:center">' + (r.fin ? 'Mark as not finished' : 'Mark series as finished') + '</span>';
    return h;
  }

  /* ---------- player (phone) ---------- */
  function viewPlayer() {
    var sid = P.s, f = P.file(), s = stats(sid), i = P.idx(), r = S.ser(sid) || {}, lk = !!U.lock;
    var paused = !P.playing(), d = P.dur(), c = P.cur();
    var cv = cov(sid, 0, false).replace('class="cov fill', 'class="cov pcov');
    var ovl = paused ? '<div class="ovl"><div>' + UI.PLAY + '</div></div>' : '';
    cv = cv.replace(/<div class="ar/, ovl + '<div class="ar');
    return '<div class="pl' + (lk ? ' lk' : '') + (S.d.settings.tint === false ? ' notint' : '') + '" style="--h1:' + tint(sid) + '"><div class="pamb"></div><div class="in">' +
      '<div class="ptop"><div class="ib" data-act="back">' + ic('down') + '</div><div class="c">PLAYING FROM ' + srcLabel(sid).toUpperCase() + '<b>' + E(name(sid)) + '</b></div>' +
      (lk ? '<div class="lockb" data-hold="unlock"><svg viewBox="0 0 24 24">' + UI.I.lock + '</svg><span>Locked</span></div>' : '<div class="ib" data-act="lock" title="Lock controls">' + ic('unlock') + '</div>') + '</div>' +
      '<div class="pcw" data-act="toggle">' + cv + '</div>' +
      '<div class="ptit"><div class="tx"><h2>' + E(f ? UI.title(f.n) : '') + '</h2><p>Lecture ' + (i + 1) + ' of ' + s.n + '</p></div><div class="nx2 ib" style="background:none" data-act="plList">' + ic('list') + '</div></div>' +
      '<div class="scrub"><div class="tr" data-scrub><b style="width:' + (d ? c / d * 100 : 0) + '%"></b><i style="left:' + (d ? c / d * 100 : 0) + '%"></i></div><div class="tm"><span class="t-cur">' + UI.hms(c) + '</span><span class="t-rem">−' + UI.hms(d - c) + '</span></div></div>' +
      '<div class="ctl"><div class="nx" data-act="prev" title="Previous lecture">' + UI.PREV + '</div><div class="sk" data-act="skip" data-s="-60">' + UI.rw('1m') + '</div><div class="sk" data-act="skip" data-s="-10">' + UI.rw('10s') + '</div>' +
      '<div class="sk" data-act="skip" data-s="10">' + UI.ff('10s') + '</div><div class="sk" data-act="skip" data-s="60">' + UI.ff('1m') + '</div><div class="nx" data-act="next" title="Next lecture">' + UI.NEXT + '</div></div>' +
      '<div class="bookp"><div class="l">Series progress<span>' + s.eq.toFixed(1).replace('.0', '') + ' of ' + s.n + ' · ' + (s.approx ? '~' : '') + UI.hrs(s.left) + ' left</span></div>' + UI.seg(s.fr) + '</div>' +
      '<div class="hint">' + (lk ? 'Tap the cover to play or pause · hold the lock to unlock' : 'Tap the cover to ' + (paused ? 'play' : 'pause')) + '</div></div></div>';
  }
  function mini() {
    if (!P.s) return '';
    var f = P.file(), d = P.dur(), c = P.cur();
    return '<div class="mini" data-act="openPl">' + cov(P.s, 44, false) + '<div class="tx">' + E(f ? UI.title(f.n) : name(P.s)) + '<small><bdi>' + E(name(P.s)) + '</bdi> · <span class="m-left">' + UI.hms(d - c) + ' left</span></small></div>' +
      '<div class="pp" data-act="toggle">' + (P.playing() ? UI.PAUSE : UI.PLAY) + '</div><div class="pg"><b class="m-pg" style="width:' + (d ? c / d * 100 : 0) + '%"></b></div></div>';
  }
  function nav() {
    return '<div class="nav">' + TABS.map(function (t) { return '<div class="' + (U.tab === t[0] ? 'on' : '') + '" data-act="tab" data-t="' + t[0] + '"><svg viewBox="0 0 24 24">' + UI.I[t[1]] + '</svg>' + t[2] + '</div>'; }).join('') + '</div>';
  }

  /* ---------- settings ---------- */
  function viewSettings() {
    var dk = desk(), t = S.d.settings.theme, st = Sync.state;
    var syncTxt = { off: 'Not signed in', idle: 'Signed in · synced when you change something', paused: 'Sync paused — tap anywhere to resume', syncing: 'Syncing…', ok: 'Signed in · synced', error: 'Sync error — tap to retry' }[st] || '';
    var h = '<div class="hd">' + (dk ? '' : '<div class="ib" data-act="back">' + ic('back') + '</div>') + '<div class="t"><h1 style="font-size:24px">Settings</h1></div></div>';
    h += '<div class="gt">APPEARANCE</div><div class="grp"><div class="themes">' + THEMES.map(function (x) {
      return '<div class="th' + (t === x[0] ? ' on' : '') + '" data-act="theme" data-t="' + x[0] + '"><div class="sw" style="background:' + x[2] + '"><i style="background:' + x[3] + ';width:80%"></i><i style="background:' + x[3] + ';width:55%"></i><b style="background:' + x[4] + '"></b></div><p>' + x[1] + '</p></div>';
    }).join('') + '</div><div class="it" data-act="tintTg"><div>Cover-tinted player<small>Player and series screens take the colour of the cover</small></div><div class="tg' + (S.d.settings.tint !== false ? ' on' : '') + '" style="margin-left:auto"></div></div>' +
      (wide() ? '<div class="it" data-act="desk"><div>Computer view<small>Sidebar, now-playing panel and keyboard shortcuts</small></div><div class="tg' + (U.desk ? ' on' : '') + '" style="margin-left:auto"></div></div>' : '') + '</div>';
    h += '<div class="gt">ACCOUNT &amp; LIBRARY</div><div class="grp">';
    if (S.d.acct) h += '<div class="it">' + avatar().replace('data-act="settings"', '').replace('class="av"', 'class="av" style="width:34px;height:34px"') + '<div>' + E(S.d.name || S.d.acct) + '<small>' + E(S.d.acct) + ' · ' + syncTxt + '</small></div><span class="btn2 gh" data-act="signOut">Sign out</span></div>';
    else h += '<div class="it">' + ic('user') + '<div>Google account<small>Optional. Adds your Library and keeps your place on every device.</small></div><span class="btn2" data-act="signIn">Sign in</span></div>';
    h += '<div class="it"' + (S.d.acct ? ' data-act="pickLib"' : '') + '>' + ic('drive') + '<div>Library folder<small>' + (S.d.lib && S.d.lib.id ? E(S.d.lib.name || '') : S.d.acct ? 'Not chosen yet' : 'Sign in to choose') + '</small></div>' + (S.d.acct ? '<span class="v">' + (S.d.lib && S.d.lib.id ? 'Change' : 'Choose') + '</span>' : '') + '</div>';
    h += '</div>';
    var nOff = P.saved().length, qa = P.qInfo();
    h += '<div class="gt">DOWNLOADS</div><div class="grp">' + folderRow(null) +
      '<div class="it" data-act="dlMgr">' + ic('dl') + '<div>Manage downloads<small>' + (nOff ? nOff + (nOff === 1 ? ' lecture · ' : ' lectures · ') + UI.mb(P.offBytes()) + ' on this device' : 'Nothing saved on this device') +
      (qa.n ? ' · ' + qa.n + ' queued' : '') + '</small></div><span class="v">Open</span></div></div>' +
      '<p class="note" style="margin:8px 22px 0">Wi-Fi / mobile data, nearby lectures and whole-folder downloads are set per series: open a series and tap its Downloads button.</p>';
    h += '<div class="gt">APP</div><div class="grp">' + (bip && !standalone() ? '<div class="it" data-act="install">' + ic('dl') + 'Install app<span class="btn2">Install</span></div>' : '') +
      '<div class="it" data-act="updateApp">' + ic('upd') + '<div>Update app<small>' + E(C.appVersion) + '</small></div><span class="v">Check</span></div>' +
      '<div class="it" data-act="shareApp">' + ic('shr') + 'Share app link</div></div>';
    h += '<div class="ver">Lectures ' + E(C.appVersion) + '</div>';
    return h;
  }

  /* ---------- Library folder picker ---------- */
  function viewPicker(v) {
    var dk = desk(), path = v.path || [], here = path[path.length - 1];
    var h = '<div class="hd">' + (dk ? '' : '<div class="ib" data-act="back">' + ic('back') + '</div>') + '<div class="t"><h1 style="font-size:24px">Library folder</h1></div></div>';
    h += '<div class="crumb"><span data-act="pickAt" data-n="0">Drive</span>' + path.map(function (p, i) { return ' › <span data-act="pickAt" data-n="' + (i + 1) + '">' + E(p.name) + '</span>'; }).join('') + '</div>';
    if (!path.length) {
      h += [['root', 'My Drive', 'drive'], ['shared', 'Shared with me', 'sh'], ['drives', 'Shared drives', 'lib']].map(function (x) {
        return '<div class="pk" data-act="pickGo" data-id="' + x[0] + '" data-n="' + E(x[1]) + '">' + ic(x[2]) + '<div class="tx">' + x[1] + '</div>' + ic('fwd') + '</div>';
      }).join('');
      h += '<p class="note" style="margin-top:12px">Pick the folder whose sub-folders are your lecture series. The app only changes Drive when you upload a phone folder or delete a finished one.</p>';
      return h;
    }
    if (v.loading) h += '<p class="note">Loading…</p>';
    else if (v.err) h += '<p class="note">' + E(v.err) + '</p>';
    else if (!v.items || !v.items.length) h += '<p class="note">No folders here.</p>';
    else h += v.items.map(function (x) { return '<div class="pk" data-act="pickGo" data-id="' + x.id + '" data-n="' + E(x.name) + '">' + ic('folder') + '<div class="tx">' + E(x.name) + '</div>' + ic('fwd') + '</div>'; }).join('');
    var real = here && ['shared', 'drives'].indexOf(here.id) < 0;
    if (real) h += '<div style="height:80px"></div><div class="dock"' + (dk ? ' style="position:sticky"' : '') + '><div class="res" data-act="pickUse">' + ic('done', 'i', 'stroke:var(--on)') + 'Use “' + E(here.name) + '”</div></div>';
    return h;
  }

  /* ---------- desktop ---------- */
  function renderDesk() {
    var t = top(), cnt = { listen: inProgress().length, star: starList().length, lib: libList().length, shared: sharedList().length, fin: finList().length };
    var recent = all().filter(function (r) { return r.last; }).sort(byLast).slice(0, 4);
    var main = t && t.t === 'series' ? viewSeries(t) : t && t.t === 'settings' ? viewSettings() : t && t.t === 'downloads' ? viewDownloads() : t && t.t === 'fdl' ? viewFolderDl(t) : t && t.t === 'picker' ? viewPicker(t) : U.tab === 'lib' ? tabLib() : U.tab === 'listen' ? tabListen() : tabList(U.tab);
    var label = { listen: 'Listening', star: 'Starred', lib: 'Library', shared: 'Shared with me', fin: 'Finished' }[U.tab];
    var h = '<div class="dk' + (S.d.settings.tint === false ? ' notint' : '') + '" style="--h1:' + (P.s ? tint(P.s) + '88' : 'transparent') + '">';
    h += '<div class="side"><div class="logo"><i><svg viewBox="0 0 24 24">' + UI.I.head + '</svg></i>Lectures</div>' +
      TABS.map(function (x) { return '<div class="ni' + (U.tab === x[0] && !t ? ' on' : '') + '" data-act="tab" data-t="' + x[0] + '"><svg viewBox="0 0 24 24">' + UI.I[x[1]] + '</svg>' + x[2] + '<em>' + cnt[x[0]] + '</em></div>'; }).join('');
    if (recent.length) h += '<div class="st">RECENT</div>' + recent.map(function (r) { var s = stats(r.id); return '<div class="ys" data-act="ser" data-id="' + r.id + '">' + cov(r.id, 36, false) + '<div>' + E(name(r.id)) + '<small>' + (status(r.id) === 'done' ? 'Finished' : 'Lecture ' + ((lecNo(r.id) || { i: 0 }).i + 1) + ' · ' + s.pct + '%') + '</small></div></div>'; }).join('');
    h += '<div class="sbot"><div class="ib" data-act="settings" title="Settings">' + ic('gear') + '</div><div class="ib" data-act="desk" title="Phone view">' + ic('phone') + '</div></div></div>';
    var showSearch = !t && U.tab !== 'listen';
    h += '<div class="main"><div class="top2">' + (t ? '<div class="ib" data-act="back" title="Back">' + ic('back') + '</div>' : '<h1 style="font-size:24px;font-weight:800;letter-spacing:-.5px;margin-right:10px">' + label + '</h1>') +
      (showSearch ? searchBox(U.tab, 'Search ' + label.toLowerCase()) : '') + '<div style="flex:1"></div>' + refBtn() + avatar() + '</div>' + main + '</div>';
    h += '<div class="rp">' + (P.s ? '<div class="amb2"></div>' + rightPanel() : '<div class="lab">NOW PLAYING</div><p class="note" style="padding:14px 0">Pick a series and press Resume.</p>') + '</div>';
    h += pbar() + '</div>';
    return h;
  }
  function rightPanel() {
    var sid = P.s, f = P.file(), i = P.idx(), fs = P.files(), s = stats(sid);
    var cv = cov(sid, 0, false), ovl = P.playing() ? '' : '<div class="ovl" style="position:absolute;inset:0;background:#0005;display:flex;align-items:center;justify-content:center;z-index:3"><div style="width:76px;height:76px;border-radius:50%;background:#ffffffe6;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" style="width:34px;fill:#111;margin-left:5px"><path d="M7 4.5v15l13-7.5z"/></svg></div></div>';
    cv = cv.replace(/<div class="ar/, ovl + '<div class="ar').replace('class="cov fill" style="', 'class="cov fill" style="border-radius:22px;box-shadow:0 30px 60px -20px #000c;font-size:38px;');
    var h = '<div class="lab" style="display:flex;justify-content:space-between;align-items:center">NOW PLAYING<span class="ib" style="width:32px;height:32px;background:#0003" data-act="ser" data-id="' + sid + '" title="All lectures">' + ic('list', 'i', 'width:16px;height:16px') + '</span></div>' +
      '<div class="cw" style="margin-top:14px" data-act="toggle" title="Click or Space to play/pause">' + cv + '</div>' +
      '<h2 style="font-size:19px;font-weight:800;margin-top:16px;line-height:1.25">' + E(f ? UI.title(f.n) : '') + '</h2><p style="font-size:12.5px;color:var(--mu);margin-top:5px">' + E(name(sid)) + ' · Lecture ' + (i + 1) + ' of ' + s.n + '</p>';
    var nx = fs.slice(i + 1, i + 4);
    if (nx.length) h += '<div class="lab" style="margin:22px 0 4px">UP NEXT</div>' + nx.map(function (x, k) {
      var n = i + 2 + k, fd = fdur(x, sid);
      return '<div class="un" data-act="lec" data-sid="' + sid + '" data-id="' + x.id + '"><div class="num"><span>' + (n < 10 ? '0' : '') + n + '</span></div><div>' + E(UI.title(x.n)) + '<small>' + (fd.ap ? '~' : '') + UI.dur(fd.d) + (P.cached[x.id] ? ' · offline' : '') + '</small></div></div>';
    }).join('');
    return h;
  }
  function pbar() {
    var on = !!P.s, f = P.file(), d = P.dur(), c = P.cur(), pct = d ? c / d * 100 : 0;
    return '<div class="pbar"><div class="nowp">' + (on ? '<div data-act="toggle">' + cov(P.s, 56, false) + '</div><div>' + E(f ? UI.title(f.n) : '') + '<small>' + E(name(P.s)) + ' · click cover or Space to ' + (P.playing() ? 'pause' : 'play') + '</small></div>' : '<div style="color:var(--mu);font-weight:600">Nothing playing</div>') + '</div>' +
      '<div class="cc"><div class="bt"><div class="nx" data-act="prev" title="Previous lecture">' + UI.PREV + '</div><div class="sk" data-act="skip" data-s="-60" title="Shift+←">' + UI.rw('1m') + '</div><div class="sk" data-act="skip" data-s="-10" title="←">' + UI.rw('10s') + '</div>' +
      '<div class="ppb" data-act="toggle" title="Space">' + (P.playing() ? UI.PAUSE : UI.PLAY) + '</div>' +
      '<div class="sk" data-act="skip" data-s="10" title="→">' + UI.ff('10s') + '</div><div class="sk" data-act="skip" data-s="60" title="Shift+→">' + UI.ff('1m') + '</div><div class="nx" data-act="next" title="Next lecture">' + UI.NEXT + '</div></div>' +
      '<div class="tl"><span class="t-cur">' + UI.hms(c) + '</span><div class="tr" data-scrub><b style="width:' + pct + '%"></b><i style="left:' + pct + '%"></i></div><span class="t-rem">−' + UI.hms(d - c) + '</span></div></div>' +
      '<div class="rr"><span class="kb"><b>Space</b> play <b>←</b><b>→</b> 10 s <b>⇧</b>+<b>←</b><b>→</b> 1 m</span></div></div>';
  }

  /* ---------- render ---------- */
  function vkey() { var t = top(); return desk() ? 'dk' : t ? t.t + ':' + (t.id || '') : 'tab:' + U.tab; }
  function render() {
    rq = 0; SC = {};
    if (drag) return;
    var tv = top(); if (DSEL && !(tv && tv.t === 'downloads')) DSEL = null;
    document.documentElement.dataset.theme = S.d.settings.theme || 'midnight';
    var key = vkey(), sc = root.querySelector(desk() ? '.main' : '.scr'), keepY = null;
    if (sc && root.dataset.vk === key && root.dataset.sub === subKey()) keepY = sc.scrollTop;
    var ae = document.activeElement, keep = ae && ae.dataset && ae.dataset.keep ? { k: ae.dataset.keep, s: ae.selectionStart } : null;
    var t = top(), h;
    if (desk()) h = renderDesk();
    else if (t && t.t === 'player' && P.s) h = viewPlayer();
    else {
      var body = !t ? (U.tab === 'listen' ? tabListen() : U.tab === 'lib' ? tabLib() : tabList(U.tab)) : t.t === 'series' ? viewSeries(t) : t.t === 'settings' ? viewSettings() : t.t === 'downloads' ? viewDownloads() : t.t === 'fdl' ? viewFolderDl(t) : t.t === 'picker' ? viewPicker(t) : '';
      var tl = S.d.settings.tint === false ? ' notint' : '';
      h = '<div class="ph' + tl + '"' + (t && t.t === 'series' ? ' style="--h1:' + tint(t.id) + '88"' : '') + '><div class="scr' + (t ? ' nonav' : '') + '">' + body + '</div>' + (t && t.t === 'picker' ? '' : mini()) + (t ? '' : nav()) + '</div>';
    }
    root.innerHTML = h;
    var sc2 = root.querySelector(desk() ? '.main' : '.scr');
    if (sc2) sc2.scrollTop = keepY != null ? keepY : (t && t.y) || (!t ? ((U.ty || {})[U.tab] || 0) : 0);
    root.dataset.vk = key; root.dataset.sub = subKey();
    if (keep) { var el = root.querySelector('[data-keep="' + keep.k + '"]'); if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch (e) {} } }
    if (dlgHtml) drawDlg();
  }
  function subKey() { var t = top(); return desk() ? (t ? t.t + ':' + (t.id || '') : 'tab:' + U.tab) : ''; }
  function schedule() { if (!rq) rq = requestAnimationFrame(render); }
  function rememberScroll() {
    var sc = root.querySelector(desk() ? '.main' : '.scr'), t = top(); if (!sc) return;
    if (t) t.y = sc.scrollTop; else { U.ty = U.ty || {}; U.ty[U.tab] = sc.scrollTop; }
  }
  function push(v) { rememberScroll(); V.push(v); history.pushState({ v: V.length }, ''); saveView(); render(); }
  function back(then) { if (then) after.push(then); closing = true; history.back(); }
  window.addEventListener('popstate', function () {
    closing = false;
    if (dlgHtml) { dlgHtml = null; drawDlg(); }
    else if (V.length) { V.pop(); saveView(); render(); }
    var q = after; after = []; q.forEach(function (fn) { fn(); });
  });
  function saveView() { U.view = V.filter(function (v) { return v.t !== 'picker'; }).map(function (v) { return { t: v.t, id: v.id }; }); S.saveUi(); }

  /* ---------- dialogs (top of screen) ---------- */
  function openDlg(html) { var was = !!dlgHtml; dlgHtml = html; if (!was) history.pushState({ d: 1 }, ''); drawDlg(); }
  function setDlg(html) { if (dlgHtml) { dlgHtml = html; drawDlg(); } }
  function drawDlg() {
    var w = document.getElementById('dlgw');
    if (!dlgHtml) { if (w) w.remove(); return; }
    if (!w) { w = document.createElement('div'); w.id = 'dlgw'; document.body.appendChild(w); }
    w.innerHTML = '<div class="dim" data-act="closeDlg"></div><div class="dlg">' + dlgHtml + '</div>';
    var inp = w.querySelector('input'); if (inp && document.activeElement !== inp) inp.focus();
  }
  function closeDlg(then) { if (dlgHtml) back(then); else if (then) then(); }
  function addDlg(id, e) {
    var s = stats(id), tot = s.tot;
    return '<div style="display:flex;gap:14px;align-items:center">' + UI.cover(id, e.name, 76, null, P.img(id)) + '<div style="min-width:0"><div class="lab">Shared with you</div><h3 style="margin-top:4px">' + E(e.name) + '</h3><div style="font-size:12.5px;color:var(--mu);margin-top:3px">' + e.files.length + ' lectures' + (e.files.length ? ' · ' + (s.approx ? '~' : '') + UI.dur(tot) : '') + '</div></div></div>' +
      '<p class="txt">Add it to Shared with me? Your place is remembered on this ' + (wide() ? 'device' : 'phone') + (S.d.acct ? ' and in your Google account.' : ', and in your Google account if you sign in.') + '</p>' +
      '<div class="two"><div class="res sec2" data-act="closeDlg">Not now</div><div class="res" data-act="addPlay" data-id="' + id + '">' + UI.PLAY + 'Add &amp; play</div></div>';
  }
  function msgDlg(title, txt, btns) { return '<h3>' + title + '</h3><p class="txt">' + txt + '</p><div class="two">' + (btns || '<div class="res" data-act="closeDlg">OK</div>') + '</div>'; }
  function openShared(id) {
    var r = S.ser(id);
    if (r && r.name) { V = []; U.tab = r.src === 'lib' ? 'lib' : 'shared'; render(); push({ t: 'series', id: id }); return; }
    U.tab = 'shared'; V = []; render();
    openDlg('<h3>Opening shared lectures…</h3><p class="txt">One moment.</p>');
    D.refreshFolder(id, 'k').then(function (e) { SC = {}; setDlg(addDlg(id, e)); }, function (e) {
      var txt = e.message === 'nokey' ? 'Public links are not set up in this version yet.' : e.status === 404 || e.status === 403 ? 'This folder is not shared with “Anyone with the link”. Ask the sender to change its sharing in Google Drive.' + (S.d.acct ? '' : ' If it was shared with your Google account, sign in and try again.') : 'Check your internet connection and try again.';
      setDlg(msgDlg('Could not open the link', txt));
    });
  }

  /* ---------- actions ---------- */
  var A = {
    tab: function (el) { rememberScroll(); U.tab = el.dataset.t; if (V.length) { var n = V.length; V = []; saveView(); history.go(-n); } S.saveUi(); render(); },
    ser: function (el) { var id = el.dataset.id; if (top() && top().t === 'series' && top().id === id) return; if (desk() && V.length) { V = [{ t: 'series', id: id }]; saveView(); render(); var m = root.querySelector('.main'); if (m) m.scrollTop = 0; return; } push({ t: 'series', id: id }); },
    back: function () { if (desk() && !closing) { V.pop(); saveView(); render(); return; } back(); },
    heroPlay: function (el) { var id = el.dataset.id; if (P.s === id) P.toggle(); else P.open(id, null, true); vib(); },
    resume: function (el) { var id = el.dataset.id; if (P.s === id && P.playing()) { P.pause(); return; } P.open(id, null, true); if (!desk()) push({ t: 'player' }); },
    lec: function (el) {
      var sid = el.dataset.sid || (top() && top().id) || P.s, id = el.dataset.id;
      if (P.s === sid && P.f === id) { if (!P.playing()) P.play(); if (!desk()) push({ t: 'player' }); return; }
      P.open(sid, id, true); vib();
    },
    star: function (el) { var id = el.dataset.id, r = S.ser(id) || {}; S.setSer(id, { star: r.star ? 0 : 1 }); App.toast(r.star ? 'Removed from Starred' : 'Starred'); render(); },
    finTg: function (el) { var id = el.dataset.id, r = S.ser(id) || {}; S.setSer(id, r.fin ? { fin: 0, finAt: 0 } : { fin: 1, finAt: Date.now() }); App.toast(r.fin ? 'Moved back to your lists' : 'Moved to Finished'); render(); },
    offTg: function (el) {
      var id = el.dataset.id, r = S.ser(id) || {}, on = !r.off;
      var go = function () { S.setSer(id, { off: on ? 1 : 0 }); if (on) { App.toast('Keeping nearby lectures offline'); P.keepOffline(id); } else P.dropOffline(id); render(); };
      if (on) needFolder(go); else go();
    },
    fdl: function (el) {
      var id = el.dataset.id; if (top() && top().t === 'fdl' && top().id === id) return;
      if (desk()) { V.push({ t: 'fdl', id: id }); saveView(); render(); var m = root.querySelector('.main'); if (m) m.scrollTop = 0; return; }
      push({ t: 'fdl', id: id });
    },
    fullTg: function (el) {
      var id = el.dataset.id;
      if (P.cfg(id).full) {
        P.setCfg(id, { full: 0 });
        var drop = P.q.filter(function (x) { return x.s === id && x.k; }).map(function (x) { return x.f; });
        drop.forEach(function (f) { delete S.d.dl.kept[f]; });
        P.remove(drop).then(function () { App.toast('Whole-folder download off — downloaded lectures stay'); render(); });
        return;
      }
      needFolder(function () {
        P.setCfg(id, { full: 1 });
        var n = P.fullSync(id), w = P.blockedFor(id);
        App.toast(!n ? 'All lectures are on this device' : w ? wtxt(w) + ' — ' + n + ' queued' : 'Downloading ' + n + (n === 1 ? ' lecture' : ' lectures'));
        P.kick(); render();
      });
    },
    netTg: function (el) {
      var id = el.dataset.id, k = el.dataset.k, p = {}; p[k] = P.cfg(id)[k] ? 0 : 1; P.setCfg(id, p);
      P.kick(); Up.pump(); render();
    },
    upTg: function (el) {
      var id = el.dataset.id;
      if (P.cfg(id).up) { P.setCfg(id, { up: 0 }); Up.q = Up.q.filter(function (x) { return x !== id; }); delete Up.st[id]; App.toast('Upload off'); render(); return; }
      if (!Local.ok()) return needFolder(render);
      if (!S.d.acct) { App.toast('Sign in with Google first'); return Sync.signIn(false); }
      if (!S.d.lib || !S.d.lib.id) { App.toast('Choose your Library folder first — uploads go there'); return A.pickLib(); }
      Sync.needWrite(function () { P.setCfg(id, { up: 1 }); Up.start(id); App.toast('Uploading to Drive'); render(); });
    },
    pickFolder: function () {
      if (!Local.supported()) return App.toast('This browser can’t use a phone folder');
      Local.choose().then(function () { return P.scanCached(); }).then(function () { Local.match(); P.resumeQueue(); upAll(); App.toast('Phone folder: ' + Local.name()); render(); }, function () {});
    },
    reconnect: function () { Local.reconnect().then(function () { return P.scanCached(); }).then(function () { Local.match(); P.resumeQueue(); upAll(); render(); }, function () {}); },
    dlNow: function () { P.kick(); Up.q.forEach(function (s) { if (Up.st[s]) Up.st[s].next = 0; }); Up.pump(); App.toast('Trying now'); },
    checkNew: function (el) {
      var id = el.dataset.id, mode = P.mode(id);
      var go = function () {
        App.toast('Checking Drive…');
        D.refreshFolder(id, mode).then(function () { var n = P.qInfo(id).n; App.toast(P.cfg(id).full && n ? 'Up to date · ' + n + ' to download' : 'Up to date'); render(); }, function () { App.toast('Could not reach Drive'); });
      };
      if (mode === 't' && !Sync.token() && S.d.acct) Sync.need(go); else go();
    },
    fdlDel: function (el) {
      var sid = el.dataset.id, ids = D.files(sid).map(function (f) { return f.id; }).filter(function (id) { return P.cached[id]; });
      confirmDel('Delete ' + name(sid) + ' downloads?', sizeOf(ids), ' “Keep nearby” and “Download whole folder” are turned off for this series.', function () { P.setCfg(sid, { full: 0 }); S.setSer(sid, { off: 0 }); return P.remove(ids); });
    },
    finDel: function (el) {
      var sid = el.dataset.id, w = el.dataset.w;
      closeDlg(function () {
        if (w === 'phone' || w === 'both') delPhone(sid).then(function () { App.toast('Deleted from this phone'); render(); });
        if (w === 'drive' || w === 'both') delDrive(sid);
      });
    },
    share: function (el) {
      var id = el.dataset.id, url = BASE + '#s=' + id, nm = name(id);
      var send = function () {
        if (navigator.share) navigator.share({ title: nm, text: nm + ' — lectures', url: url }).catch(function () {});
        else (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { App.toast('Link copied'); }, function () { App.toast(url); });
      };
      D.isPublic(id).then(function (pub) {
        if (pub === false) openDlg(msgDlg('This folder is private', 'Only people who can open it in Google Drive will be able to play it. In Drive, set its sharing to “Anyone with the link” first.',
          '<div class="res sec2" data-act="shareAnyway" data-id="' + id + '">Share anyway</div><div class="res" data-act="openDrive" data-id="' + id + '">' + ic('ext', 'i', 'stroke:var(--on)') + 'Open in Drive</div>'));
        else send();
      });
    },
    shareAnyway: function (el) { var id = el.dataset.id; closeDlg(function () { var url = BASE + '#s=' + id; if (navigator.share) navigator.share({ title: name(id), url: url }).catch(function () {}); else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { App.toast('Link copied'); }); }); },
    openDrive: function (el) { window.open('https://drive.google.com/drive/folders/' + el.dataset.id, '_blank'); closeDlg(); },
    refresh: function () {
      var t = top();
      if (t && t.t === 'series') {
        var id = t.id; delete tried[id];
        if (Local.isLocal(id)) { Local.scan().then(function () { App.toast('Up to date'); }); return; }
        var go = function () { D.refreshFolder(id, P.mode(id)).then(function () { App.toast('Up to date'); App.state(); }, function (e) { tried[id] = e.status || 1; App.toast('Could not refresh'); App.state(); }); App.state(); };
        if (P.mode(id) === 't' && !Sync.token() && S.d.acct) Sync.need(go); else go();
        return;
      }
      tried = {}; if (Local.ok()) Local.scan();
      var ids = (U.tab === 'shared' ? sharedList() : U.tab === 'star' ? starList() : U.tab === 'fin' ? finList() : U.tab === 'listen' ? inProgress() : []).filter(function (r) { return r.src === 'shared'; });
      ids.forEach(function (r) { D.refreshFolder(r.id, 'k').then(App.state, App.state); });
      if (S.d.acct && S.d.lib && S.d.lib.id) Sync.need(function () { D.refreshLib().then(App.state, function (e) { App.toast('Could not read the Library: ' + (e.message || '')); App.state(); }); App.state(); });
      App.state();
    },
    openPl: function () { if (desk()) return; push({ t: 'player' }); },
    toggle: function () { P.toggle(); vib(); },
    skip: function (el) { P.skip(+el.dataset.s); vib(); },
    prev: function () { P.step(-1); }, next: function () { P.step(1); },
    lock: function () { U.lock = 1; vib(); render(); },
    plList: function () { V[V.length - 1] = { t: 'series', id: P.s }; saveView(); render(); },
    settings: function () { if (top() && top().t === 'settings') return; if (desk()) { V = [{ t: 'settings' }]; render(); return; } push({ t: 'settings' }); },
    theme: function (el) { S.d.settings.theme = el.dataset.t; S.saveSettings(); render(); },
    tintTg: function () { S.d.settings.tint = S.d.settings.tint === false; S.saveSettings(); render(); },
    desk: function () { U.desk = !U.desk; V = V.filter(function (v) { return v.t !== 'player'; }); S.saveUi(); render(); },
    signIn: function () { Sync.signIn(false); },
    signOut: function () { openDlg(msgDlg('Sign out?', 'Your place in every lecture stays on this device. Library needs sign-in.', '<div class="res sec2" data-act="closeDlg">Cancel</div><div class="res" data-act="signOutOk">Sign out</div>')); },
    signOutOk: function () { closeDlg(function () { Sync.signOut(); }); },
    pickLib: function () { if (!S.d.acct) return Sync.signIn(false); var go = function () { if (desk()) { V = [{ t: 'picker', path: [] }]; render(); } else push({ t: 'picker', path: [] }); }; if (Sync.token()) go(); else Sync.need(go); },
    pickGo: function (el) {
      var v = top(); if (!v || v.t !== 'picker') return;
      v.path = v.path.concat([{ id: el.dataset.id, name: el.dataset.n }]); loadPick(v);
    },
    pickAt: function (el) { var v = top(); v.path = v.path.slice(0, +el.dataset.n); if (v.path.length) loadPick(v); else render(); },
    pickUse: function () {
      var v = top(), here = v.path[v.path.length - 1];
      S.setLib(here.id, here.name); D.clearLib(); U.tab = 'lib';
      var done = function () { D.refreshLib().then(App.state, function (e) { App.toast('Could not read the folder: ' + (e.message || '')); App.state(); }); App.state(); };
      if (desk()) { V = []; done(); } else { var n = V.length; V = []; saveView(); history.go(-n); setTimeout(done, 50); }
    },
    dlMgr: function () {
      DLS = null; DSEL = null;
      if (top() && top().t === 'downloads') return;
      if (desk()) { V.push({ t: 'downloads' }); saveView(); render(); var m = root.querySelector('.main'); if (m) m.scrollTop = 0; return; }
      push({ t: 'downloads' });
    },
    pendGo: function () { var go = PEND; PEND = null; closeDlg(function () { if (go) go(); }); },
    dlRetry: function (el) { var d = P.dl[el.dataset.id]; if (d) { d.fail = 0; d.tries = 0; d.next = 0; d.w = null; } P.pump(); render(); },
    dlCancel: function (el) { P.remove([el.dataset.id]).then(function () { App.toast('Download cancelled'); }); },
    dexp: function (el) { var id = el.dataset.id; DEXP[id] = !DEXP[id]; render(); },
    dselMode: function () { DSEL = DSEL ? null : {}; render(); },
    dselLec: function (el) { var id = el.dataset.id; if (DSEL[id]) delete DSEL[id]; else DSEL[id] = 1; render(); },
    dselSer: function (el) {
      var sid = el.dataset.id, ids = P.saved().filter(function (x) { return x.s === sid; }).map(function (x) { return x.f.id; });
      var on = !ids.every(function (id) { return DSEL[id]; }); ids.forEach(function (id) { if (on) DSEL[id] = 1; else delete DSEL[id]; }); render();
    },
    dselGo: function () {
      var ids = Object.keys(DSEL || {}); if (!ids.length) return App.toast('Tick the lectures to delete');
      confirmDel('Delete ' + ids.length + (ids.length === 1 ? ' lecture?' : ' lectures?'), sizeOf(ids), '', function () { return P.remove(ids); });
    },
    drmLec: function (el) { var id = el.dataset.id; confirmDel('Delete this download?', sizeOf([id]), P.f === id ? ' It’s playing now — it carries on by streaming.' : '', function () { return P.remove([id]); }); },
    drmSer: function (el) {
      var sid = el.dataset.id, ids = P.saved().filter(function (x) { return x.s === sid; }).map(function (x) { return x.f.id; });
      confirmDel('Delete ' + name(sid) + ' downloads?', sizeOf(ids), (S.ser(sid) || {}).off ? ' “Keep nearby lectures offline” is turned off for this series too.' : '', function () { S.setSer(sid, { off: 0 }); return P.remove(ids); });
    },
    drmAuto: function () {
      var ids = P.autoIds();
      confirmDel('Delete all auto copies?', sizeOf(ids), ' Kept downloads stay. “Keep nearby lectures offline” is turned off in every series.', function () {
        Object.keys(S.d.series).forEach(function (k) { if (S.d.series[k].off) S.setSer(k, { off: 0 }, true); }); S.save(); return P.remove(ids);
      });
    },
    drmAll: function () {
      confirmDel('Delete everything?', P.offBytes(), ' All kept and auto downloads go, and “Keep nearby lectures offline” is turned off.', function () {
        Object.keys(S.d.series).forEach(function (k) { if (S.d.series[k].off) S.setSer(k, { off: 0 }, true); }); S.save(); return P.dropAll();
      });
    },
    install: function () { if (!bip) return; bip.prompt(); bip.userChoice.then(function () { bip = null; render(); }); },
    shareApp: function () { var u = BASE; if (navigator.share) navigator.share({ title: 'Lectures', url: u }).catch(function () {}); else (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { App.toast('Link copied'); }, function () { App.toast(u); }); },
    chip: function (el) { U.chip = U.chip || {}; U.chip[el.dataset.t] = el.dataset.v; S.saveUi(); render(); },
    addLink: function () { openDlg('<h3>Add a shared link</h3><p class="txt">Paste a lecture link from the app, or a Google Drive folder link shared with “Anyone with the link”.</p><input class="in" id="linkIn" placeholder="https://drive.google.com/drive/folders/…" autocomplete="off" enterkeyhint="go"><div class="two"><div class="res sec2" data-act="closeDlg">Cancel</div><div class="res" data-act="addLinkGo">Add</div></div>'); },
    addLinkGo: function () {
      var v = (document.getElementById('linkIn') || {}).value, id = D.parseLink(v);
      if (!id) return App.toast('That doesn’t look like a folder link');
      closeDlg(function () { openShared(id); });
    },
    addPlay: function (el) {
      var id = el.dataset.id, f = D.folder(id) || {};
      S.setSer(id, { name: f.name, src: 'shared', seen: Date.now() });
      closeDlg(function () { U.tab = 'shared'; render(); push({ t: 'series', id: id }); if (D.files(id).length) P.open(id, null, true); });
    },
    closeDlg: function () { closeDlg(); },
    updateApp: function (el) {
      el.style.opacity = .5;
      var files = ['./', 'index.html', 'css/app.css', 'js/config.js', 'js/store.js', 'js/sync.js', 'js/drive.js', 'js/ui.js', 'js/player.js', 'js/app.js', 'sw.js'];
      var sw = navigator.serviceWorker;
      var p1 = sw ? sw.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }) : Promise.resolve();
      var p2 = window.caches ? caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('-shell') >= 0; }).map(function (k) { return caches.delete(k); })); }) : Promise.resolve();
      var p3 = Promise.all(files.map(function (f) { return fetch(f, { cache: 'reload' }).catch(function () {}); }));
      var sc = root.querySelector(desk() ? '.main' : '.scr');
      try { sessionStorage.setItem('alp.upd', JSON.stringify({ v: C.appVersion, y: sc ? sc.scrollTop : 0 })); } catch (e) {}
      P.savePos(true);
      Promise.all([p1, p2, p3]).catch(function () {}).then(function () { location.replace(location.pathname + '?v=' + Date.now()); });
    }
  };
  function loadPick(v) {
    var here = v.path[v.path.length - 1]; v.loading = true; v.err = null; v.items = null; render();
    D.pickList(here.id).then(function (items) { if (top() !== v) return; v.loading = false; v.items = items; render(); },
      function (e) { v.loading = false; v.err = e.message === 'notoken' ? 'Sign-in expired — tap the folder again.' : 'Could not read this folder (' + (e.message || 'error') + ').'; render(); });
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var fn = A[el.dataset.act]; if (!fn) return;
    e.preventDefault(); e.stopPropagation();
    if (closing) after.push(function () { fn(el); }); else fn(el);
  });
  document.addEventListener('input', function (e) {
    var t = e.target.dataset && e.target.dataset.q; if (!t) return;
    U.q = U.q || {}; U.q[t] = e.target.value; S.saveUi(); render();
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.id === 'linkIn' && e.key === 'Enter') { e.preventDefault(); A.addLinkGo(); return; }
    if (/INPUT|TEXTAREA/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); P.toggle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); P.skip(e.shiftKey ? -60 : -10); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); P.skip(e.shiftKey ? 60 : 10); }
    else if (e.key === 'Escape' && (dlgHtml || V.length)) A.back();
  });
  /* scrub bar drag + hold-to-unlock */
  document.addEventListener('pointerdown', function (e) {
    var tr = e.target.closest('[data-scrub]');
    if (tr && P.s && !(U.lock && !desk())) {
      drag = { el: tr, r: tr.getBoundingClientRect() }; tr.setPointerCapture(e.pointerId); moveDrag(e); e.preventDefault(); return;
    }
    var hl = e.target.closest('[data-hold]');
    if (hl) { hl.classList.add('hold'); clearTimeout(holdT); holdT = setTimeout(function () { U.lock = 0; vib(); render(); App.toast('Unlocked'); }, 800); }
  });
  function moveDrag(e) {
    var f = Math.min(1, Math.max(0, (e.clientX - drag.r.left) / drag.r.width)); drag.f = f;
    drag.el.querySelector('b').style.width = f * 100 + '%'; drag.el.querySelector('i').style.left = f * 100 + '%';
    var d = P.dur(), w = drag.el.closest('.scrub,.tl'); if (w && d) { var a = w.querySelector('.t-cur'), b = w.querySelector('.t-rem'); if (a) a.textContent = UI.hms(f * d); if (b) b.textContent = '−' + UI.hms(d - f * d); }
  }
  document.addEventListener('pointermove', function (e) { if (drag) moveDrag(e); });
  function endDrag() { if (!drag) return; var f = drag.f, d = P.dur(); drag = null; if (d) P.seek(f * d); render(); }
  document.addEventListener('pointerup', function () { endDrag(); var h = document.querySelector('.hold'); if (h) h.classList.remove('hold'); clearTimeout(holdT); });
  document.addEventListener('pointercancel', function () { endDrag(); var h = document.querySelector('.hold'); if (h) h.classList.remove('hold'); clearTimeout(holdT); });

  /* ---------- hooks used by Player / Sync ---------- */
  var toastT;
  window.App = {
    render: schedule,
    state: schedule,
    syncChanged: function () { var t = top(); if (t && t.t === 'settings') schedule(); },
    remoteMerged: function () {
      if (!P.s && S.d.now && S.d.now.s) P.restore(S.d.now.s, S.d.now.f);
      schedule();
      if (S.d.lib && S.d.lib.id && !D.libIds().length && Sync.token()) D.refreshLib().then(schedule, schedule);
    },
    /* a series was just finished: offer to delete it from the phone, Drive or both (only if it is on the phone) */
    finished: function (sid) {
      var loc = Local.isLocal(sid), r = S.ser(sid) || {};
      var onPhone = loc ? Local.ok() : D.files(sid).some(function (f) { return P.cached[f.id]; }) || P.q.some(function (x) { return x.s === sid; });
      if (!onPhone) return;
      var drive = !loc && r.src === 'lib' && !!S.d.acct;
      var o = function (w, icon, txt, sm) { return '<div class="opt" data-act="finDel" data-w="' + w + '" data-id="' + sid + '">' + icon + '<div class="tx">' + txt + '<small>' + sm + '</small></div></div>'; };
      setTimeout(function () {
        openDlg('<h3>You finished ' + E(name(sid)) + '</h3><p class="txt">Delete its lectures to free space?</p>' +
          o('phone', ic('trash'), 'Delete from this phone', loc ? 'Removes the folder and its files from the phone' : 'Removes the downloaded lectures; you can still stream them') +
          (drive ? o('drive', ic('drive'), 'Delete from Google Drive', 'Moves the folder to Drive’s trash (restorable for 30 days)') + o('both', ic('trash'), 'Delete from both', 'Phone copies and the Drive folder') : '') +
          '<div class="two"><div class="res sec2" data-act="closeDlg">Keep</div></div>');
      }, 400);
    },
    lengthsChanged: function () { clearTimeout(this._lt); this._lt = setTimeout(schedule, 800); },
    viewSid: function () { var t = top(); return t && t.t === 'series' ? t.id : null; },
    tick: function (force) {
      var now = Date.now(); if (!force && now - lastTick < 400) return; lastTick = now;
      if (drag) return;
      var d = P.dur(), c = P.cur(), p = d ? Math.min(100, c / d * 100) : 0;
      root.querySelectorAll('[data-scrub]').forEach(function (tr) { tr.querySelector('b').style.width = p + '%'; tr.querySelector('i').style.left = p + '%'; });
      root.querySelectorAll('.t-cur').forEach(function (x) { x.textContent = UI.hms(c); });
      root.querySelectorAll('.t-rem').forEach(function (x) { x.textContent = '−' + UI.hms(d - c); });
      var mp = root.querySelector('.m-pg'); if (mp) mp.style.width = p + '%';
      var ml = root.querySelector('.m-left'); if (ml && P.s) ml.textContent = UI.hms(d - c) + ' left';
    },
    toast: function (m) { var t = document.getElementById('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2600); }
  };

  /* ---------- boot ---------- */
  S.load(); D.load(); U = S.d.ui;
  document.documentElement.dataset.theme = S.d.settings.theme || 'midnight';
  var fresh = U.left && Date.now() - U.left < 3600000;
  if (S.d.now && S.d.now.s) P.restore(S.d.now.s, S.d.now.f);
  if (fresh && U.view && U.view.length) U.view.forEach(function (v) { if (v.t === 'player' && !P.s) return; V.push(v); history.pushState({ v: V.length }, ''); });
  if (!fresh) { U.ty = {}; }
  render();
  /* downloads: what's saved (app storage + phone folder) → resume the queue; uploads; then ask Drive for new lectures */
  function upAll() { Object.keys(S.d.dl.f).forEach(function (sid) { if (S.d.dl.f[sid].up && (Local.isLocal(sid) ? Local.hasDir(sid) : D.folder(sid))) Up.start(sid); }); }
  function checkFull() {
    lastCheck = Date.now();
    var ids = Object.keys(S.d.dl.f).filter(function (sid) { return S.d.dl.f[sid].full && !Local.isLocal(sid) && S.ser(sid); });
    ids.reduce(function (p, sid) {
      return p.then(function () {
        var m = P.mode(sid); if (m === 't' && !Sync.token()) return;   // Library listing needs sign-in; the cached list is queued meanwhile
        return D.refreshFolder(sid, m).then(schedule, function () {});
      });
    }, Promise.resolve()).then(function () { P.kick(); });
  }
  P.scanCached().then(function () { return Local.init(); }).then(function () { Local.match(); P.resumeQueue(); upAll(); schedule(); setTimeout(checkFull, 2500); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { P.kick(); Up.pump(); if (Date.now() - lastCheck > 15 * 60000) checkFull(); } });
  function leaving() { rememberScroll(); U.left = Date.now(); saveView(); P.savePos(true); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) { leaving(); if (window.Sync) Sync.schedule(100); } });
  window.addEventListener('pagehide', leaving);
  window.addEventListener('resize', function () { clearTimeout(App._rz); App._rz = setTimeout(schedule, 150); });
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); bip = e; schedule(); });
  window.addEventListener('appinstalled', function () { bip = null; schedule(); });
  Sync.init();
  (function () {   // after Update app: back to Settings, same scroll, say what happened
    var old = null; try { old = JSON.parse(sessionStorage.getItem('alp.upd')); sessionStorage.removeItem('alp.upd'); } catch (e) {}
    if (!old) return;
    history.replaceState(null, '', location.pathname);
    if (!(top() && top().t === 'settings')) push({ t: 'settings' });
    var sc = root.querySelector(desk() ? '.main' : '.scr'); if (sc) sc.scrollTop = old.y || 0;
    var v = C.appVersion.split(' ·')[0]; App.toast(old.v !== C.appVersion ? 'Updated to ' + v : 'Already on the latest version (' + v + ')');
  })();
  /* opened from a shared link: #s=<folderId> */
  (function () {
    var id = D.parseLink(location.hash); if (!id) return;
    history.replaceState(history.state, '', location.pathname);
    setTimeout(function () { openShared(id); }, 60);
  })();
  /* background refresh: shared series older than 6 h (key, no sign-in needed); Library older than 1 h if signed in */
  setTimeout(function () {
    var old = Date.now() - 6 * 3600e3;
    all().filter(function (r) { return r.src === 'shared' && (!D.folder(r.id) || D.folder(r.id).at < old); }).slice(0, 12)
      .reduce(function (p, r) { return p.then(function () { return D.refreshFolder(r.id, 'k').then(schedule, function () {}); }); }, Promise.resolve());
    if (Sync.token() && S.d.lib && S.d.lib.id && (!D.c.lib || D.c.lib.at < Date.now() - 3600e3)) D.refreshLib().then(schedule, function () {});
  }, 1500);
  if ('serviceWorker' in navigator) {
    var hadSW = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (hadSW && !reloaded && !P.playing()) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) { reg.update(); }).catch(function () {});
  }
})();
