/* UI helpers: line icons (never emoji), generated covers, progress segments/rings, formatting. */
(function () {
  var I = {
    head: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    lib: '<path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="m16 5 3.8-1 3 15.4-3.8 1z"/>',
    sh: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 4 6"/>',
    done: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    ref: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    back: '<path d="m15 18-6-6 6-6"/>', down: '<path d="m6 9 6 6 6-6"/>', fwd: '<path d="m9 18 6-6-6-6"/>',
    shr: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/>',
    dl: '<path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.7-1.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    srch: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    drive: '<path d="M8 3h8l6 11-4 7H6l-4-7z"/><path d="m8 3 6 11h8M2 14h12l-4 7"/>',
    upd: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    mon: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    sel: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'
  };
  var PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
  var PREV = '<svg viewBox="0 0 24 24"><path d="M6 5h2.5v14H6zM20 5v14L9.5 12z"/></svg>';
  var NEXT = '<svg viewBox="0 0 24 24"><path d="M15.5 5H18v14h-2.5zM4 5v14l10.5-7z"/></svg>';
  function ic(n, cls, st) { return '<svg class="' + (cls || 'i') + '" viewBox="0 0 24 24"' + (st ? ' style="' + st + '"' : '') + '>' + I[n] + '</svg>'; }
  function rw(s) { return '<svg viewBox="0 0 24 24"><path d="M11 6 4 12l7 6M20 6l-7 6 7 6"/></svg><span>' + s + '</span>'; }
  function ff(s) { return '<svg viewBox="0 0 24 24"><path d="m13 6 7 6-7 6M4 6l7 6-7 6"/></svg><span>' + s + '</span>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---- generated covers: palette × pattern, picked by a hash of the folder name ---- */
  var PAL = [ // gradient from, to, tint
    ['#0d3b66', '#1f7ac9', '#1f5f9e'], ['#5b3a0c', '#c89234', '#7a5418'], ['#0f4a30', '#2fa36a', '#1a5e3d'],
    ['#4a1238', '#c2457f', '#6a1e4f'], ['#2a1a5e', '#7b5cd6', '#3d2a80'], ['#123c45', '#2b9aa8', '#1c5560'],
    ['#4d2614', '#d06b3a', '#6b3519'], ['#1d2b3a', '#566b80', '#2b3b4c'], ['#4a0f14', '#b8343f', '#6b1820'],
    ['#14214d', '#3f5bd1', '#22337a'], ['#2f3a10', '#8a9a2c', '#465518'], ['#3a1f05', '#a0703a', '#55320f']
  ];
  function svgUrl(w, h, body) {
    return "url(\"data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='" + w + "' height='" + h + "'><g fill='none' stroke='white' stroke-opacity='.14'>" + body + "</g></svg>") + "\")";
  }
  var PAT = [
    svgUrl(44, 44, "<rect x='12' y='12' width='20' height='20'/><rect x='12' y='12' width='20' height='20' transform='rotate(45 22 22)'/><circle cx='22' cy='22' r='4'/>"), // 8-point star
    svgUrl(48, 28, "<path d='M0 14 8 0h16l8 14-8 14H8zM32 14h16'/>"),                                  // hexagon chain
    svgUrl(40, 48, "<path d='M4 48V22a16 16 0 0 1 32 0v26'/><circle cx='20' cy='20' r='3'/>"),       // arches
    svgUrl(44, 44, "<path d='M22 5 37 31H7zM22 39 7 13h30z'/>"),                                       // six-point star
    svgUrl(44, 44, "<path d='M22 0 44 22 22 44 0 22z'/><circle cx='22' cy='22' r='2.5'/><circle cx='0' cy='0' r='6'/><circle cx='44' cy='44' r='6'/><circle cx='44' cy='0' r='6'/><circle cx='0' cy='44' r='6'/>"), // diamond lattice
    svgUrl(56, 56, "<path d='M28 4l7 17 17 7-17 7-7 17-7-17-17-7 17-7z'/><path d='M28 16l3.5 8.5L40 28l-8.5 3.5L28 40l-3.5-8.5L16 28l8.5-3.5z'/>"), // girih star
    svgUrl(28, 28, "<circle cx='0' cy='0' r='14'/><circle cx='28' cy='0' r='14'/><circle cx='0' cy='28' r='14'/><circle cx='28' cy='28' r='14'/><circle cx='14' cy='14' r='14'/>") // interlaced circles
  ];
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var AR = [ // English keyword → Arabic word for the cover (first match wins; most specific first)
    [/juz.?\s?'?ʿ?amm?a/i, 'جزء عمّ'], [/names of allah|asma.?ul.?husna|99 names/i, 'الأسماء الحسنى'], [/40 hadith|forty hadith|arba.?een|nawawi/i, 'الأربعون'],
    [/riyad/i, 'رياض الصالحين'], [/bukhari/i, 'البخاري'], [/kahf/i, 'الكهف'], [/ya.?s[ie]e?n/i, 'يس'], [/fatiha/i, 'الفاتحة'], [/mulk/i, 'الملك'], [/baqara/i, 'البقرة'],
    [/se?e?rah?|sirah|seera/i, 'السيرة'], [/tafs[ie]e?r/i, 'تفسير'], [/fiqh/i, 'الفقه'], [/aq[ie]e?dah?/i, 'العقيدة'], [/taw[h]?[ie]e?d/i, 'التوحيد'],
    [/hadee?th|hadith/i, 'الحديث'], [/sala[ht]|prayer/i, 'الصلاة'], [/ramad[ha]?an/i, 'رمضان'], [/taj[wv]e?e?[dt]/i, 'التجويد'], [/qur.?an/i, 'القرآن'],
    [/prophets|anbiya/i, 'الأنبياء'], [/prophet|nabi/i, 'النبي ﷺ'], [/adab|manners|etiquette/i, 'الآداب'], [/akhlaq|character/i, 'الأخلاق'], [/tazkiy|purif/i, 'التزكية'],
    [/arabic|nahw|sarf/i, 'العربية'], [/du.?a\b|supplicat/i, 'الدعاء'], [/zaka/i, 'الزكاة'], [/hajj|umrah/i, 'الحج'], [/sahab|companions/i, 'الصحابة'],
    [/jannah|paradise/i, 'الجنة'], [/akhirah|hereafter|death|grave/i, 'الآخرة'], [/nikah|marriage/i, 'النكاح'], [/history|tarikh/i, 'التاريخ'], [/khutba|jumu/i, 'الجمعة'],
    [/sabr|patience/i, 'الصبر'], [/\bilm\b|knowledge/i, 'العلم'], [/iman|faith/i, 'الإيمان'], [/heart|qalb/i, 'القلب'], [/family|parent/i, 'الأسرة'], [/women|sisters/i, 'النساء'], [/youth/i, 'الشباب']
  ];
  var ARABIC = /[؀-ۿ][؀-ۿـً-ٟ\s]*/;
  function coverInfo(id, name) {
    name = name || '';
    var h = hash(name || id), pal = PAL[h % PAL.length], pat = PAT[(h >>> 4) % PAT.length];
    var ar = null, m = name.match(ARABIC), lat = false;
    if (m && m[0].trim()) ar = m[0].trim().split(/\s+/).slice(0, 3).join(' ');
    if (!ar) for (var i = 0; i < AR.length; i++) if (AR[i][0].test(name)) { ar = AR[i][1]; break; }
    var en = name.replace(ARABIC, ' ').replace(/^[\s\d._\-–—()[\]]+/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!ar) {   // no Arabic: initials of the first two words
      var w = en.split(' ').filter(function (x) { return /[A-Za-z]/.test(x) && !/^(the|of|and|a|an|on|in|by|with|to|for)$/i.test(x); });
      ar = (w.slice(0, 2).map(function (x) { return x.replace(/[^A-Za-z]/g, '')[0] || ''; }).join('') || '♪').toUpperCase(); lat = true;
    }
    var label = en.split(' ').slice(0, 3).join(' '); if (label.length > 18) label = label.slice(0, 17) + '…';
    return { g: pal[0] + ',' + pal[1], h: pal[2], pat: pat, ar: ar, lat: lat, en: label || name.slice(0, 16), c1: pal[0], c2: pal[1] };
  }
  /* size: px number, or 0 = fill the parent (.cw wrapper sets the container for cqw font sizing) */
  function cover(id, name, size, st, img) {
    var c = coverInfo(id, name), done = st === 'done';
    var dim = size ? 'width:' + size + 'px;height:' + size + 'px;font-size:' + (size / 7).toFixed(1) + 'px;' : '';
    return '<div class="cov' + (size ? '' : ' fill') + (done ? ' gone' : '') + '" style="' + dim + 'background:linear-gradient(145deg,' + c.g + ')">' +
      '<i class="pat" style="background-image:' + c.pat + '"></i>' +
      (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
      (st ? '<i class="dot d-' + st + '"></i>' : '') +
      '<div class="ar' + (c.lat ? ' lat' : '') + '"' + (!c.lat && c.ar.length > 5 ? ' style="font-size:' + (c.ar.length > 9 ? 1.15 : c.ar.length > 7 ? 1.45 : 1.75) + 'em"' : '') + '>' + esc(c.ar) + '</div><div class="en">' + esc(c.en) + '</div></div>';
  }
  function seg(fracs) {   // fracs: 0..1 per unit; more than 60 units are grouped
    var n = fracs.length, g = Math.max(1, Math.ceil(n / 60)), out = [];
    for (var i = 0; i < n; i += g) { var s = 0, k = 0; for (var j = i; j < Math.min(n, i + g); j++) { s += fracs[j]; k++; } out.push(s / k); }
    return '<div class="seg">' + out.map(function (f) { return f >= 0.999 ? '<i class="f"></i>' : f > 0 ? '<i class="p" style="--w:' + Math.round(f * 100) + '%"></i>' : '<i></i>'; }).join('') + '</div>';
  }
  function ring(p, col, sz) {
    sz = sz || 34; var r = sz / 2 - 3, C = 2 * Math.PI * r, m = sz / 2;
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 ' + sz + ' ' + sz + '"><circle cx="' + m + '" cy="' + m + '" r="' + r + '" fill="none" stroke="' + (col === '#fff' ? '#ffffff40' : 'color-mix(in srgb,var(--tx) 16%,transparent)') + '" stroke-width="3"/>' +
      '<circle cx="' + m + '" cy="' + m + '" r="' + r + '" fill="none" stroke="' + (col || 'var(--ac)') + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + (C * p / 100).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 ' + m + ' ' + m + ')"/></svg>';
  }
  var DLK = '<svg class="dlk" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 7v8m0 0-3.5-3.5M12 15l3.5-3.5" stroke="var(--bg)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHECK = '<svg width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="14" fill="var(--ac)"/><path d="m11 17 4 4 8-8" stroke="var(--on)" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function hms(s) { s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  function dur(s) { s = Math.round(s || 0); var h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60); if (m === 60) { h++; m = 0; } return h ? h + ' h' + (m ? ' ' + (m < 10 ? '0' : '') + m + ' m' : '') : Math.max(1, m) + ' min'; }
  function hrs(s) { return s >= 5400 ? Math.round(s / 3600) + ' h' : dur(s); }
  function ago(t) {
    if (!t) return ''; var d0 = new Date(); d0.setHours(0, 0, 0, 0);
    var days = Math.round((d0 - new Date(t).setHours(0, 0, 0, 0)) / 864e5);
    if (days <= 0) return 'today'; if (days === 1) return 'yesterday'; if (days < 7) return days + ' days ago';
    return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function mb(b) { return b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1e6)) + ' MB'; }
  function title(n) {   // file name → lecture title (the lecture number is shown separately)
    var t = (n || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_/g, ' ').trim(), s = t.replace(/^\d{1,4}[a-z]?\s*[-–—_.):]+\s*/i, '');
    return s.length > 1 ? s : t;
  }

  window.UI = { I: I, ic: ic, rw: rw, ff: ff, esc: esc, PLAY: PLAY, PAUSE: PAUSE, PREV: PREV, NEXT: NEXT, CHECK: CHECK, DLK: DLK,
    coverInfo: coverInfo, cover: cover, seg: seg, ring: ring, hms: hms, dur: dur, hrs: hrs, ago: ago, mb: mb, title: title, hash: hash };
})();
