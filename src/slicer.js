/* =====================================================================
   Atelier Neva — moteur de découpe (slicer) simplifié pour Dagoma Neva
   Entrée : soupes de triangles (Float32Array x,y,z en mm, Z vers le haut,
            origine au centre du plateau).
   Sortie : G-code Marlin + statistiques + données d'aperçu des trajets.
   ===================================================================== */
(function (global) {
  'use strict';
  const CL = global.ClipperLib || (typeof require !== 'undefined' ? require('clipper-lib') : null);
  const SC = 1000;                       // 1 mm = 1000 unités Clipper (µm)
  const FIL_D = 1.75;                    // diamètre par défaut (profil.filament sinon)
  const PLA_DENSITY = 1.24;              // g/cm3

  /* Profils des imprimantes — à ajuster si besoin (voir README).
     bed.shape : 'round' (rayon) ou 'rect' (largeur × profondeur).
     origin    : position du centre du plateau dans les coordonnées de la machine
                 ([0, 0] pour une delta, centre du plateau pour une cartésienne).
     Les valeurs marquées « à valider » n'ont pas été vérifiées sur la machine. */
  const PROFILES = {
    neva: {
      id: 'neva',
      name: 'Dagoma Neva',
      kind: 'delta',
      bed: { shape: 'round', radius: 90, margin: 6 },   // plateau Ø 180 mm
      origin: [0, 0],
      maxHeight: 190,         // 200 mm annoncés, marge de sécurité
      nozzle: 0.4,
      lineWidth: 0.45,
      firstLayer: 0.3,
      firstLayerWidth: 0.5,
      temp: 210,
      bedTemp: 0,             // pas de plateau chauffant
      speeds: { first: 20, outer: 30, inner: 45, infill: 60, solid: 40, skirt: 25, travel: 120 },
      retract: { length: 3.5, speed: 40, minTravel: 2 },
      skirt: { distance: 4, loops: 2 },
      sdFile: 'dagoma0.g',    // à valider : nom lu par la Neva au bouton
      baud: 250000,           // à valider
      startGcode: [
        'M107 ; ventilateur arrêté',
        'M82 ; extrusion absolue',
        'G90 ; coordonnées absolues',
        'M104 S{temp} ; chauffe de la buse',
        'G28 ; origine (tête en haut)',
        'G29 ; calibration automatique du plateau',
        'M109 S{temp} ; attente de la température',
        'G92 E0'
      ].join('\n'),
      endGcode: [
        'M104 S0 ; arrêt chauffe',
        'M107 ; arrêt ventilateur',
        'G91',
        'G1 E-3 F2400 ; rétraction',
        'G1 Z10 F3000',
        'G90',
        'G28 ; retour en haut',
        'M84 ; moteurs relâchés'
      ].join('\n')
    },
    vyper: {
      id: 'vyper',
      name: 'Anycubic Vyper',
      kind: 'cartesian',
      bed: { shape: 'rect', w: 245, h: 245, margin: 8 },  // plateau 245 × 245 mm
      origin: [122.5, 122.5], // origine (0, 0) dans le coin avant gauche
      maxHeight: 250,         // 260 mm annoncés, marge de sécurité
      nozzle: 0.4,
      lineWidth: 0.45,
      firstLayer: 0.3,
      firstLayerWidth: 0.5,
      temp: 205,
      bedTemp: 60,            // plateau chauffant, PLA
      speeds: { first: 20, outer: 35, inner: 50, infill: 70, solid: 45, skirt: 25, travel: 150 },
      retract: { length: 2, speed: 35, minTravel: 2 },     // à valider selon la machine
      skirt: { distance: 4, loops: 2 },
      sdFile: 'atelier.gcode', // le fichier se choisit sur l'écran tactile
      baud: 115200,           // à valider
      startGcode: [
        'M107 ; ventilateur arrêté',
        'M82 ; extrusion absolue',
        'G90 ; coordonnées absolues',
        'M140 S{bed} ; chauffe du plateau',
        'M104 S{temp} ; chauffe de la buse',
        'M190 S{bed} ; attente du plateau',
        'M109 S{temp} ; attente de la buse',
        'G28 ; origine',
        'M420 S1 ; active le nivellement enregistré (à valider)',
        'G92 E0',
        'G1 Z2 F600',
        'G1 X10 Y5 F4000 ; ligne de purge',
        'G1 Z0.3 F600',
        'G1 X120 Y5 E12 F1200',
        'G1 X120 Y5.4 F1200',
        'G1 X10 Y5.4 E24 F1200',
        'G92 E0',
        'G1 Z2 F600'
      ].join('\n'),
      endGcode: [
        'M104 S0 ; arrêt chauffe buse',
        'M140 S0 ; arrêt chauffe plateau',
        'M107 ; arrêt ventilateur',
        'G91',
        'G1 E-2 F2400 ; rétraction',
        'G1 Z10 F3000',
        'G90',
        'G1 X0 Y235 F4000 ; présente le plateau',
        'M84 ; moteurs relâchés'
      ].join('\n')
    }
  };
  PROFILES.s7 = {
    id: 's7',
    name: 'Ultimaker S7',
    kind: 'cartesian',
    flavor: 'Griffin',      // G-code Ultimaker : l'en-tête décrit chauffe et matériau
    bed: { shape: 'rect', w: 330, h: 240, margin: 8 },  // 330 × 240 mm (impression simple extrusion)
    origin: [165, 120],     // origine (0, 0) dans le coin avant gauche — à valider
    maxHeight: 290,         // 300 mm annoncés, marge de sécurité
    filament: 2.85,         // les Ultimaker utilisent du filament 2,85 mm
    nozzle: 0.4,
    lineWidth: 0.4,
    firstLayer: 0.27,
    firstLayerWidth: 0.4,
    temp: 210,
    bedTemp: 60,
    speeds: { first: 20, outer: 30, inner: 45, infill: 60, solid: 40, skirt: 25, travel: 150 },
    retract: { length: 6.5, speed: 25, minTravel: 2 },   // à valider (Bowden 2,85 mm)
    skirt: { distance: 4, loops: 2 },
    sdFile: 'atelier.gcode',
    media: 'usb',           // clé USB à l'avant de l'imprimante
    usbSerial: false,       // pas de pilotage par câble depuis l'ordinateur
    baud: 0,
    startGcode: [
      'T0 ; extrudeur 1',
      'M82 ; extrusion absolue',
      'G92 E0',
      'M190 S{bed} ; plateau',
      'M109 S{temp} ; buse'
    ].join('\n'),
    endGcode: [
      'M107 ; arrêt ventilateur',
      'M104 S0 ; arrêt chauffe buse',
      'M140 S0 ; arrêt chauffe plateau'
    ].join('\n')
  };
  const MACHINE = PROFILES.neva;

  /* rayon du cercle utile (delta) ou demi-côtés (cartésienne), marge comprise */
  function usableBed(M) {
    const b = M.bed;
    return b.shape === 'round'
      ? { shape: 'round', r: b.radius - b.margin }
      : { shape: 'rect', hw: b.w / 2 - b.margin, hh: b.h / 2 - b.margin };
  }

  const PRESETS = {
    rapide:    { key: 'rapide',    label: 'Rapide',    layer: 0.28, walls: 2, infill: 0.10, shell: 0.84, hint: 'Brouillon solide, couches visibles.' },
    equilibre: { key: 'equilibre', label: 'Équilibré', layer: 0.20, walls: 2, infill: 0.15, shell: 0.80, hint: 'Le bon compromis pour la plupart des objets.' },
    fin:       { key: 'fin',       label: 'Fin',       layer: 0.15, walls: 3, infill: 0.15, shell: 0.75, hint: 'Surfaces plus lisses, impression plus longue.' }
  };

  /* ---------- outils Clipper ---------- */
  const PT = () => CL.PolyType, CT = () => CL.ClipType, PFT = () => CL.PolyFillType;

  function boolOp(subj, clip, type) {
    if (!subj.length) return [];
    if (!clip.length) return type === CT().ctIntersection ? [] : subj.slice();
    const c = new CL.Clipper();
    c.AddPaths(subj, PT().ptSubject, true);
    c.AddPaths(clip, PT().ptClip, true);
    const out = new CL.Paths();
    c.Execute(type, out, PFT().pftNonZero, PFT().pftNonZero);
    return out;
  }
  const inter = (a, b) => boolOp(a, b, CT().ctIntersection);
  const diff = (a, b) => boolOp(a, b, CT().ctDifference);
  function union(a) {
    if (!a.length) return [];
    const c = new CL.Clipper();
    c.AddPaths(a, PT().ptSubject, true);
    const out = new CL.Paths();
    c.Execute(CT().ctUnion, out, PFT().pftNonZero, PFT().pftNonZero);
    return out;
  }
  function offset(paths, mm) {
    if (!paths.length) return [];
    const co = new CL.ClipperOffset(2, 0.02 * SC);
    co.AddPaths(paths, CL.JoinType.jtMiter, CL.EndType.etClosedPolygon);
    const out = new CL.Paths();
    co.Execute(out, mm * SC);
    return out;
  }
  function dropSmall(paths, minArea) {
    return paths.filter(p => Math.abs(CL.Clipper.Area(p)) > minArea * SC * SC);
  }
  function islandsOf(paths) {
    const c = new CL.Clipper();
    c.AddPaths(paths, PT().ptSubject, true);
    const tree = new CL.PolyTree();
    c.Execute(CT().ctUnion, tree, PFT().pftNonZero, PFT().pftNonZero);
    return CL.JS.PolyTreeToExPolygons(tree).map(e => [e.outer].concat(e.holes));
  }
  function circlePoly(r, n = 180) {
    const p = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      p.push({ X: Math.round(Math.cos(a) * r * SC), Y: Math.round(Math.sin(a) * r * SC) });
    }
    return p;
  }

  /* ---------- maillage indexé (fusion des sommets identiques) ---------- */
  function indexMesh(soups) {
    const map = new Map();
    const verts = [];
    const tris = [];
    for (const pos of soups) {
      for (let i = 0; i + 8 < pos.length; i += 9) {
        const id = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const x = pos[i + 3 * k], y = pos[i + 3 * k + 1], z = pos[i + 3 * k + 2];
          const key = Math.round(x * 1000) + ',' + Math.round(y * 1000) + ',' + Math.round(z * 1000);
          let v = map.get(key);
          if (v === undefined) { v = verts.length / 3; map.set(key, v); verts.push(x, y, z); }
          id[k] = v;
        }
        if (id[0] !== id[1] && id[1] !== id[2] && id[0] !== id[2]) tris.push(id[0], id[1], id[2]);
      }
    }
    return { v: Float64Array.from(verts), t: Uint32Array.from(tris), nv: verts.length / 3 };
  }

  /* ---------- coupe d'une couche ---------- */
  function sliceLayer(mesh, active, z) {
    const v = mesh.v, t = mesh.t, NV = mesh.nv;
    const segs = [];
    const tmp = [];
    for (let n = 0; n < active.length; n++) {
      const ti = active[n] * 3;
      tmp.length = 0;
      for (let e = 0; e < 3; e++) {
        const i = t[ti + e], j = t[ti + (e + 1) % 3];
        const ai = v[i * 3 + 2] > z, aj = v[j * 3 + 2] > z;
        if (ai === aj) continue;
        const p = i < j ? i : j, q = i < j ? j : i;
        const zp = v[p * 3 + 2], zq = v[q * 3 + 2];
        const s = (z - zp) / (zq - zp);
        tmp.push(p * NV + q, v[p * 3] + (v[q * 3] - v[p * 3]) * s, v[p * 3 + 1] + (v[q * 3 + 1] - v[p * 3 + 1]) * s);
      }
      if (tmp.length === 6) segs.push(tmp.slice());
    }
    // chaînage des segments en contours fermés via les clés d'arêtes
    const byKey = new Map();
    const add = (k, i) => { const l = byKey.get(k); if (l) l.push(i); else byKey.set(k, [i]); };
    segs.forEach((s, i) => { add(s[0], i); add(s[3], i); });
    const used = new Uint8Array(segs.length);
    const loops = [];
    const P = (x, y) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) });
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const s = segs[i];
      const startKey = s[0];
      const path = [P(s[1], s[2]), P(s[4], s[5])];
      let cur = s[3];
      let closed = false;
      for (let guard = 0; guard < segs.length + 2; guard++) {
        if (cur === startKey) { closed = true; break; }
        const list = byKey.get(cur);
        let nx = -1;
        if (list) for (const j of list) if (!used[j]) { nx = j; break; }
        if (nx < 0) break;
        used[nx] = 1;
        const sj = segs[nx];
        if (sj[0] === cur) { path.push(P(sj[4], sj[5])); cur = sj[3]; }
        else { path.push(P(sj[1], sj[2])); cur = sj[0]; }
      }
      if (closed) path.pop();
      if (path.length >= 3) loops.push(path);
    }
    let region = CL.Clipper.SimplifyPolygons(loops, PFT().pftEvenOdd);
    region = CL.Clipper.CleanPolygons(region, 0.01 * SC);
    return dropSmall(region, 0.05);
  }

  /* ---------- hachures (remplissage en lignes) ---------- */
  function hatch(area, spacing, angleDeg) {
    if (!area.length) return [];
    const a = angleDeg * Math.PI / 180;
    const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    let dmin = Infinity, dmax = -Infinity, nmin = Infinity, nmax = -Infinity;
    for (const p of area) for (const q of p) {
      const d = q.X * dx + q.Y * dy, n = q.X * nx + q.Y * ny;
      if (d < dmin) dmin = d; if (d > dmax) dmax = d;
      if (n < nmin) nmin = n; if (n > nmax) nmax = n;
    }
    const sp = spacing * SC;
    const lines = [];
    let idx = 0;
    for (let n = Math.ceil(nmin / sp) * sp; n <= nmax; n += sp, idx++) {
      const a1 = { X: Math.round(dx * (dmin - 10) + nx * n), Y: Math.round(dy * (dmin - 10) + ny * n) };
      const a2 = { X: Math.round(dx * (dmax + 10) + nx * n), Y: Math.round(dy * (dmax + 10) + ny * n) };
      lines.push(idx % 2 ? [a2, a1] : [a1, a2]);
    }
    const c = new CL.Clipper();
    c.AddPaths(lines, PT().ptSubject, false);
    c.AddPaths(area, PT().ptClip, true);
    const tree = new CL.PolyTree();
    c.Execute(CT().ctIntersection, tree, PFT().pftNonZero, PFT().pftNonZero);
    return CL.Clipper.OpenPathsFromPolyTree(tree).filter(l => l.length >= 2);
  }

  /* ---------- émetteur G-code + aperçu ---------- */
  function Emitter(M) {
    this.M = M;
    this.out = [];
    this.x = 0; this.y = 0; this.z = 0; this.e = 0;
    this.time = 0; this.filament = 0; this.retracted = false;
    this.pv = []; this.pc = [];
    this.layerEnds = [];
    this.ox = (M.origin || [0, 0])[0]; this.oy = (M.origin || [0, 0])[1];
  }
  Emitter.prototype.fmt = n => (Math.round(n * 1000) / 1000).toString();
  Emitter.prototype.raw = function (s) { this.out.push(s); };
  Emitter.prototype.retract = function () {
    if (this.retracted) return;
    const r = this.M.retract;
    this.e -= r.length;
    this.out.push('G1 E' + this.e.toFixed(5) + ' F' + (r.speed * 60));
    this.time += r.length / r.speed;
    this.retracted = true;
  };
  Emitter.prototype.unretract = function () {
    if (!this.retracted) return;
    const r = this.M.retract;
    this.e += r.length;
    this.out.push('G1 E' + this.e.toFixed(5) + ' F' + (r.speed * 60));
    this.time += r.length / r.speed;
    this.retracted = false;
  };
  Emitter.prototype.travel = function (x, y) {
    const d = Math.hypot(x - this.x, y - this.y);
    if (d < 0.01) return;
    if (d > this.M.retract.minTravel) this.retract();
    this.out.push('G0 X' + this.fmt(x + this.ox) + ' Y' + this.fmt(y + this.oy) + ' F' + (this.M.speeds.travel * 60));
    this.time += d / this.M.speeds.travel;
    this.x = x; this.y = y;
  };
  Emitter.prototype.extrudeTo = function (x, y, speed, epm, type) {
    const d = Math.hypot(x - this.x, y - this.y);
    if (d < 0.005) return;
    this.unretract();
    const de = d * epm;
    this.e += de;
    this.filament += de;
    this.out.push('G1 X' + this.fmt(x + this.ox) + ' Y' + this.fmt(y + this.oy) + ' E' + this.e.toFixed(5) + ' F' + Math.round(speed * 60));
    this.time += d / speed;
    this.pv.push(this.x, this.y, this.z, x, y, this.z);
    this.pc.push(type, type);
    this.x = x; this.y = y;
  };
  Emitter.prototype.loop = function (path, speed, epm, type) {
    // départ au point le plus proche (couture)
    let best = 0, bd = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = (path[i].X / SC - this.x) ** 2 + (path[i].Y / SC - this.y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const n = path.length;
    const p0 = path[best];
    this.travel(p0.X / SC, p0.Y / SC);
    for (let k = 1; k <= n; k++) {
      const p = path[(best + k) % n];
      this.extrudeTo(p.X / SC, p.Y / SC, speed, epm, type);
    }
  };

  function nearestOrder(items, startX, startY, getEnds) {
    // tri glouton « plus proche voisin » ; getEnds(item) -> [x1,y1,x2,y2] (mm)
    const out = [];
    const left = items.slice();
    let cx = startX, cy = startY;
    while (left.length) {
      let bi = 0, bd = Infinity, flip = false;
      for (let i = 0; i < left.length; i++) {
        const e = getEnds(left[i]);
        const d1 = (e[0] - cx) ** 2 + (e[1] - cy) ** 2;
        if (d1 < bd) { bd = d1; bi = i; flip = false; }
        if (e.length > 2) {
          const d2 = (e[2] - cx) ** 2 + (e[3] - cy) ** 2;
          if (d2 < bd) { bd = d2; bi = i; flip = true; }
        }
      }
      const it = left.splice(bi, 1)[0];
      const e = getEnds(it);
      out.push({ item: it, flip });
      if (e.length > 2) { cx = flip ? e[0] : e[2]; cy = flip ? e[1] : e[3]; }
      else { cx = e[0]; cy = e[1]; }
    }
    return out;
  }

  /* types de trajets (pour les couleurs d'aperçu) */
  const T = { SKIRT: 0, OUTER: 1, INNER: 2, SOLID: 3, INFILL: 4 };

  /* ---------- découpe complète ---------- */
  async function slice(soups, options = {}, onProgress = () => {}) {
    const base = PROFILES[options.profile] || MACHINE;
    const M = Object.assign({}, base, options.machine || {});
    M.speeds = Object.assign({}, base.speeds, (options.machine || {}).speeds || {});
    M.retract = Object.assign({}, base.retract, (options.machine || {}).retract || {});
    const Q = PRESETS[options.preset] || PRESETS.equilibre;
    const w = M.lineWidth;
    const yieldUI = () => new Promise(r => setTimeout(r, 0));

    onProgress(0, 'Préparation du maillage');
    const mesh = indexMesh(soups);
    const nt = mesh.t.length / 3;
    if (!nt) throw new Error('Aucun triangle à découper.');
    const zmin = new Float64Array(nt), zmaxT = new Float64Array(nt);
    let zTop = 0;
    for (let i = 0; i < nt; i++) {
      const a = mesh.v[mesh.t[i * 3] * 3 + 2], b = mesh.v[mesh.t[i * 3 + 1] * 3 + 2], c = mesh.v[mesh.t[i * 3 + 2] * 3 + 2];
      zmin[i] = Math.min(a, b, c); zmaxT[i] = Math.max(a, b, c);
      if (zmaxT[i] > zTop) zTop = zmaxT[i];
    }
    const order = Array.from({ length: nt }, (_, i) => i).sort((a, b) => zmin[a] - zmin[b]);

    // hauteurs des couches
    const layers = [];
    let top = M.firstLayer;
    layers.push({ top, h: M.firstLayer });
    while (top + Q.layer * 0.5 < zTop) { top += Q.layer; layers.push({ top, h: Q.layer }); }

    // passe 1 : contours de chaque couche
    let ptr = 0;
    let active = [];
    for (let L = 0; L < layers.length; L++) {
      const zc = layers[L].top - layers[L].h / 2 + 1e-5;
      while (ptr < nt && zmin[order[ptr]] <= zc) active.push(order[ptr++]);
      active = active.filter(i => zmaxT[i] >= zc);
      layers[L].region = sliceLayer(mesh, active, zc);
      if (L % 8 === 0) { onProgress(0.4 * L / layers.length, 'Découpe des couches'); await yieldUI(); }
    }

    // passe 2 : parois, remplissage, G-code
    const em = new Emitter(M);
    const shellN = Math.max(2, Math.round(Q.shell / Q.layer));
    const filD = M.filament || FIL_D;
    const fillArea = Math.PI * (filD / 2) ** 2;
    const epmFor = (width, h) => ((width - h) * h + Math.PI * (h / 2) ** 2) / fillArea;

    const header = [];
    if (M.flavor === 'Griffin') {
      // en-tête lu par le firmware Ultimaker (valeurs complétées en fin de découpe)
      [';START_OF_HEADER', ';HEADER_VERSION:0.1', ';FLAVOR:Griffin',
       ';GENERATOR.NAME:Atelier Impression 3D', ';GENERATOR.VERSION:2.1', ';GENERATOR.BUILD_DATE:2026-10-29',
       ';TARGET_MACHINE.NAME:' + M.name,
       ';EXTRUDER_TRAIN.0.INITIAL_TEMPERATURE:' + M.temp,
       ';EXTRUDER_TRAIN.0.MATERIAL.VOLUME_USED:{{VOL}}',
       ';EXTRUDER_TRAIN.0.NOZZLE.DIAMETER:' + M.nozzle,
       ';EXTRUDER_TRAIN.0.NOZZLE.NAME:AA ' + M.nozzle,
       ';BUILD_PLATE.INITIAL_TEMPERATURE:' + (M.bedTemp || 0),
       ';PRINT.TIME:{{TIME}}', ';PRINT.GROUPS:1',
       ';PRINT.SIZE.MIN.X:{{MINX}}', ';PRINT.SIZE.MIN.Y:{{MINY}}', ';PRINT.SIZE.MIN.Z:0.27',
       ';PRINT.SIZE.MAX.X:{{MAXX}}', ';PRINT.SIZE.MAX.Y:{{MAXY}}', ';PRINT.SIZE.MAX.Z:{{MAXZ}}',
       ';END_OF_HEADER'].forEach(l => em.raw(l));
    } else {
      em.raw(';FLAVOR:Marlin');
    }
    em.raw(';Généré par Atelier Impression 3D pour ' + M.name);
    em.raw(';Réglage : ' + Q.label + ' — couche ' + Q.layer + ' mm, ' + Q.walls + ' parois, remplissage ' + Math.round(Q.infill * 100) + ' %');
    em.raw(';TIME:{{TIME}}');
    em.raw(';Filament used: {{FIL}}m');
    em.raw(';Layer count: ' + layers.length);
    M.startGcode.replace(/\{temp\}/g, M.temp).replace(/\{bed\}/g, M.bedTemp || 0).split('\n').forEach(l => em.raw(l));
    em.time += 180; // chauffe + calibration (estimation)

    for (let L = 0; L < layers.length; L++) {
      const lay = layers[L];
      const first = L === 0;
      const lw = first ? M.firstLayerWidth : w;
      const epm = epmFor(lw, lay.h);
      em.raw(';LAYER:' + L);
      if (L === 1) em.raw('M106 S160 ; ventilateur pièce');
      if (L === 2) em.raw('M106 S255');
      if (L > 0) em.retract();
      em.z = lay.top;
      em.raw('G0 Z' + em.fmt(lay.top) + ' F3000');
      em.time += lay.h / 50;

      // jupe (première couche)
      if (first) {
        const base = union(islandsOf(lay.region).map(isl => isl[0]));
        const U = usableBed(M);
        const disc = U.shape === 'round' ? [circlePoly(M.bed.radius - 1)]
          : [[{ X: -(M.bed.w / 2 - 1) * SC, Y: -(M.bed.h / 2 - 1) * SC }, { X: (M.bed.w / 2 - 1) * SC, Y: -(M.bed.h / 2 - 1) * SC },
              { X: (M.bed.w / 2 - 1) * SC, Y: (M.bed.h / 2 - 1) * SC }, { X: -(M.bed.w / 2 - 1) * SC, Y: (M.bed.h / 2 - 1) * SC }]];
        for (let k = M.skirt.loops - 1; k >= 0; k--) {
          const sk = inter(offset(base, M.skirt.distance + k * lw), disc);
          const ordered = nearestOrder(sk, em.x, em.y, p => [p[0].X / SC, p[0].Y / SC]);
          for (const o of ordered) {
            if (k === M.skirt.loops - 1 && o === ordered[0]) {
              // amorçage de la buse avant la jupe
              em.travel(o.item[0].X / SC, o.item[0].Y / SC);
              em.unretract();
              em.e += 4; em.raw('G1 E' + em.e.toFixed(5) + ' F300 ; amorçage');
              em.filament += 4; em.time += 1;
            }
            em.loop(o.item, M.speeds.skirt, epm, T.SKIRT);
          }
        }
      }

      const islands = islandsOf(lay.region);
      let infillArea = [];
      const islandOrder = nearestOrder(islands, em.x, em.y, isl => [isl[0][0].X / SC, isl[0][0].Y / SC]);
      for (const io of islandOrder) {
        const isl = io.item;
        // parois : de l'intérieur vers l'extérieur
        for (let k = Q.walls - 1; k >= 0; k--) {
          const loops = dropSmall(offset(isl, -(lw / 2 + k * lw)), 0.02);
          const sp = first ? M.speeds.first : (k === 0 ? M.speeds.outer : M.speeds.inner);
          const ord = nearestOrder(loops, em.x, em.y, p => [p[0].X / SC, p[0].Y / SC]);
          for (const o of ord) em.loop(o.item, sp, epm, k === 0 ? T.OUTER : T.INNER);
        }
        infillArea = infillArea.concat(offset(isl, -(Q.walls * lw - 0.15 * lw)));
      }
      infillArea = dropSmall(offset(offset(infillArea, -lw * 0.45), lw * 0.45), 0.1);

      if (infillArea.length) {
        // zones pleines (dessous / dessus) et zones de remplissage partiel
        let support = lay.region;
        for (let j = L - shellN; j <= L + shellN; j++) {
          if (j === L) continue;
          if (j < 0 || j >= layers.length) { support = []; break; }
          support = inter(support, layers[j].region);
          if (!support.length) break;
        }
        let sparse = support.length ? inter(infillArea, support) : [];
        sparse = dropSmall(offset(offset(sparse, -lw), lw), 1);
        let solid = diff(infillArea, sparse);
        solid = dropSmall(solid, 0.15);
        const ang = L % 2 ? 135 : 45;
        const paths = [];
        const longEnough = p => { let d = 0; for (let k = 1; k < p.length; k++) d += Math.hypot(p[k].X - p[k - 1].X, p[k].Y - p[k - 1].Y); return d > lw * SC; };
        hatch(solid, lw, ang).filter(longEnough).forEach(p => paths.push({ p, t: T.SOLID }));
        if (Q.infill > 0 && sparse.length) hatch(sparse, lw / Q.infill, ang).filter(longEnough).forEach(p => paths.push({ p, t: T.INFILL }));
        const ord = nearestOrder(paths, em.x, em.y, o => {
          const a = o.p[0], b = o.p[o.p.length - 1];
          return [a.X / SC, a.Y / SC, b.X / SC, b.Y / SC];
        });
        for (const o of ord) {
          const pts = o.flip ? o.item.p.slice().reverse() : o.item.p;
          const sp = first ? M.speeds.first : (o.item.t === T.SOLID ? M.speeds.solid : M.speeds.infill);
          em.travel(pts[0].X / SC, pts[0].Y / SC);
          for (let k = 1; k < pts.length; k++) em.extrudeTo(pts[k].X / SC, pts[k].Y / SC, sp, epm, o.item.t);
        }
      }
      em.layerEnds.push(em.pv.length / 3);
      lay.region = lay.region; // conservé pour les couches voisines
      if (L % 4 === 0) { onProgress(0.4 + 0.6 * L / layers.length, 'Calcul des trajets'); await yieldUI(); }
    }
    em.raw(';FIN');
    M.endGcode.split('\n').forEach(l => em.raw(l));

    const seconds = Math.round(em.time * 1.12); // marge accélérations
    const meters = em.filament / 1000;
    const grams = em.filament * fillArea / 1000 * PLA_DENSITY;
    let gcode = em.out.join('\n') + '\n';
    gcode = gcode.replace(/\{\{TIME\}\}/g, seconds).replace('{{FIL}}', meters.toFixed(2));
    if (M.flavor === 'Griffin') {
      // emprise réelle des trajets, en coordonnées machine
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < em.pv.length; i += 3) { const x = em.pv[i] + em.ox, y = em.pv[i + 1] + em.oy; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const f = n => (Math.round(n * 1000) / 1000).toString();
      gcode = gcode.replace('{{VOL}}', Math.round(em.filament * fillArea)).replace('{{MINX}}', f(x0)).replace('{{MINY}}', f(y0))
        .replace('{{MAXX}}', f(x1)).replace('{{MAXY}}', f(y1)).replace('{{MAXZ}}', f(zTop));
    }
    onProgress(1, 'Terminé');
    return {
      gcode,
      stats: { seconds, meters, grams, layers: layers.length, height: zTop, preset: Q },
      preview: {
        positions: Float32Array.from(em.pv),
        types: Uint8Array.from(em.pc),
        layerEnds: em.layerEnds,
        layerTops: layers.map(l => l.top)
      }
    };
  }

  const api = { slice, MACHINE, PROFILES, PRESETS, TYPES: T, usableBed };
  global.NevaSlicer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
