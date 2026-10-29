/* =====================================================================
   Kit bib-e-lots - Atelier Impression 3D — application (multi-imprimantes)
   ===================================================================== */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let M = NevaSlicer.PROFILES.neva;
  /* fiche affichée pour chaque imprimante (écran d'accueil, textes) */
  const PRINTERS = {
    neva:  { short: 'Neva',  marque: 'Dagoma',   plateau: 'Plateau rond Ø 180 mm', infos: ['Imprimante delta', 'Hauteur max. 190 mm', 'Un seul bouton'] },
    vyper: { short: 'Vyper', marque: 'Anycubic', plateau: 'Plateau 245 × 245 mm', infos: ['Plateau chauffant', 'Hauteur max. 250 mm', 'Écran tactile'] }
  };
  const UI = () => PRINTERS[M.id];
  const laMachine = () => 'la ' + UI().short;
  const PRESETS = NevaSlicer.PRESETS;
  const fr = (x, d = 0) => x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const duree = s => {
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    if (!h) return Math.max(1, m) + ' min';
    return h + ' h ' + String(m).padStart(2, '0');
  };
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  /* ---------------- réglages animateur ---------------- */
  const defaultsFor = P => ({ temp: P.temp, bedTemp: P.bedTemp, file: P.sdFile, baud: String(P.baud), start: P.startGcode });
  let store = { price: 25, last: null, p: {} };
  try {
    const saved = JSON.parse(localStorage.getItem('atelier-impression3d-cfg') || 'null');
    if (saved) store = Object.assign(store, saved);
    else {
      const old = JSON.parse(localStorage.getItem('atelier-neva-cfg') || 'null'); // ancienne version Neva seule
      if (old) { store.price = old.price ?? 25; store.p.neva = { temp: old.temp, file: old.file, baud: old.baud, start: old.start }; }
    }
  } catch (e) { /* stockage indisponible */ }
  let cfg = {};
  const loadCfg = () => { cfg = Object.assign({ price: store.price }, defaultsFor(M), store.p[M.id] || {}); };
  const saveCfg = () => {
    store.price = cfg.price;
    store.p[M.id] = { temp: cfg.temp, bedTemp: cfg.bedTemp, file: cfg.file, baud: cfg.baud, start: cfg.start };
    try { localStorage.setItem('atelier-impression3d-cfg', JSON.stringify(store)); } catch (e) { /* ignoré */ }
  };
  loadCfg();

  /* ---------------- état ---------------- */
  const S = {
    step: 1,
    cat: 'Tous',
    preview: null,          // id du modèle affiché en grand à l'étape 1
    basket: new Map(),      // id -> quantité
    layout: { placed: [], failed: [] },
    preset: 'equilibre',
    result: null, resultKey: '', slicing: false, progress: 0, sliceError: '',
    view: 'pieces', layer: 0,
    mode: null,             // 'usb' | 'sd'
    sel: null,              // pièce sélectionnée dans la vue 3D (uid)
    variant: {},            // groupe -> variante affichée
    confirmClear: false,
    guide: { current: 0, done: new Set() },
    downloaded: false, renamedTxt: false
  };
  const MODELS = new Map(); // id -> { entry, geo, w, h, z, thumb }
  const COLORS = ['#EE7A1C', '#2149C9', '#19774A', '#B03A8C', '#9A6200', '#2C8C9C', '#6B4FC8', '#C2362B'];
  const colorFor = id => COLORS[[...MODELS.keys()].indexOf(id) % COLORS.length];

  /* ---------------- catalogue ---------------- */
  function register(entry, geo) {
    const b = geo.boundingBox;
    MODELS.set(entry.id, { entry, geo, w: b.max.x - b.min.x, h: b.max.y - b.min.y, z: b.max.z - b.min.z, thumb: null });
  }
  async function loadCatalogue() {
    const list = [];
    for (const entry of NevaCatalogue.CATALOGUE) {
      if (entry.variantes) entry.variantes.forEach((v, i) => list.push(Object.assign({}, entry, { id: v.id, fichier: v.fichier, groupe: entry.id, variante: v.label, rang: i, variantes: undefined })));
      else list.push(entry);
    }
    // Dans l'aperçu Claude, les STL sont publiés encodés en base64 dans des .txt
    const b64 = !!window.NEVA_STL_B64;
    const lire = url => fetch(b64 ? url + '.txt' : url).then(r => { if (!r.ok) throw new Error(r.status); return b64 ? r.text() : r.arrayBuffer(); })
      .then(d => { if (!b64) return d; const bin = atob(d.trim()); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; });
    await Promise.all(list.filter(e => e.fichier).map(e => lire(e.fichier).then(b => { e._buf = b; }).catch(err => console.warn('Modèle non chargé :', e.id, err))));
    for (const entry of list) {
      try {
        if (entry._buf) {
          const geo = new THREE.STLLoader().parse(entry._buf);
          delete entry._buf;
          register(entry, NevaCatalogue.normaliser(geo.index ? geo.toNonIndexed() : geo));
        } else if (entry.fichier) {
          continue;
        } else {
          register(entry, NevaCatalogue.construire(entry));
        }
      } catch (e) {
        console.warn('Modèle non chargé :', entry.id, e);
      }
    }
  }
  const nomAff = m => m.entry.nom + (m.entry.variante ? ` (${m.entry.variante})` : '');
  const groupeDe = m => m.entry.groupe || m.entry.id;
  const variantesDe = g => [...MODELS.values()].filter(m => groupeDe(m) === g);
  function creditHtml(m) {
    const c = m.entry.credit;
    if (!c) return '';
    const list = Array.isArray(c) ? c : [c];
    return `<div class="credit">${list.map(x => `${esc(x.auteur)} · ${esc(x.licence)} · <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.source)}</a>`).join('<br>')}</div>`;
  }
  const dimsText = m => `${fr(m.w, m.w < 10 ? 1 : 0)} × ${fr(m.h, m.h < 10 ? 1 : 0)} × ${fr(m.z, m.z < 10 ? 1 : 0)} mm`;

  /* ---------------- placement automatique ---------------- */
  /* zone utile du plateau (marge pour la jupe comprise) */
  const usable = () => NevaSlicer.usableBed(M);
  const bedHalfX = () => { const U = usable(); return U.shape === 'round' ? U.r : U.hw; };
  const bedHalfY = () => { const U = usable(); return U.shape === 'round' ? U.r : U.hh; };
  function inside(x, y, W, H) {
    const U = usable();
    if (U.shape === 'round') { const cx = Math.abs(x) + W / 2, cy = Math.abs(y) + H / 2; return cx * cx + cy * cy <= U.r * U.r; }
    return Math.abs(x) + W / 2 <= U.hw && Math.abs(y) + H / 2 <= U.hh;
  }
  const fitsAlone = m => m.z <= M.maxHeight && (inside(0, 0, m.w, m.h) || inside(0, 0, m.h, m.w));
  const bedText = () => UI().plateau;

  /* Placement automatique sur le plateau (rond ou rectangulaire).
     Plusieurs dispositions sont essayées (pièces regroupées au centre ou
     poussées vers un bord) ; on garde celle qui place le plus de pièces. */
  function computeLayout(basket) {
    const items = [];
    let uid = 0;
    for (const [id, q] of basket) for (let k = 0; k < q; k++) {
      const m = MODELS.get(id);
      if (m) items.push({ uid: uid++, id, w: m.w, h: m.h });
    }
    items.sort((a, b) => (b.w * b.h) - (a.w * a.h) || a.uid - b.uid);
    const gap = 6;
    const ex = bedHalfX(), ey = bedHalfY();
    const stepXY = Math.max(ex, ey) > 100 ? 3 : 2;
    const anchors = [[0, 0]];
    for (let k = 0; k < 8; k++) { const t = k * Math.PI / 4 - Math.PI / 2; anchors.push([Math.round(Math.cos(t) * ex), Math.round(Math.sin(t) * ey)]); }
    let bestLayout = null;
    for (const [ax, ay] of anchors) {
      const placed = [], failed = [];
      for (const it of items) {
        let best = null;
        for (const rot of [0, 1]) {
          const W = rot ? it.h : it.w, H = rot ? it.w : it.h;
          for (let x = -ex; x <= ex; x += stepXY) {
            if (Math.abs(x) + W / 2 > ex) continue;
            for (let y = -ey; y <= ey; y += stepXY) {
              if (!inside(x, y, W, H)) continue;
              const score = (x - ax) ** 2 + (y - ay) ** 2 + rot * 3;
              if (best && score >= best.score) continue;
              let ok = true;
              for (const p of placed) {
                if (Math.abs(x - p.x) < (W + p.W) / 2 + gap && Math.abs(y - p.y) < (H + p.H) / 2 + gap) { ok = false; break; }
              }
              if (ok) best = { x, y, rot, W, H, score };
            }
          }
        }
        if (best) placed.push(Object.assign({ id: it.id, uid: it.uid }, best));
        else failed.push(it);
      }
      if (!bestLayout || failed.length < bestLayout.failed.length) bestLayout = { placed, failed };
      if (!failed.length) break; // la disposition centrée suffit : on la garde
    }
    return bestLayout;
  }

  /* triangles de la mise en plateau, en coordonnées machine */
  function buildSoups(layout) {
    return layout.placed.map(p => {
      const src = MODELS.get(p.id).geo.attributes.position.array;
      const out = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        const x = src[i], y = src[i + 1];
        out[i] = (p.rot ? -y : x) + p.x;
        out[i + 1] = (p.rot ? x : y) + p.y;
        out[i + 2] = src[i + 2];
      }
      return out;
    });
  }

  /* ---------------- vue 3D ---------------- */
  const V = {
    init() {
      const canvas = $('#scene');
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(32, 1, 1, 4000);
      this.camera.up.set(0, 0, 1);
      this.camera.position.set(40, -330, 230);
      this.controls = new THREE.OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.target.set(0, 0, 20);
      this.controls.minDistance = 40;
      this.controls.maxDistance = 1100;
      this.controls.maxPolarAngle = Math.PI * 0.495;
      this.goal = null;
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.75));
      const sun = new THREE.DirectionalLight(0xffffff, 0.75);
      sun.position.set(-120, -200, 320);
      this.scene.add(sun);
      const back = new THREE.DirectionalLight(0xffffff, 0.25);
      back.position.set(150, 200, 120);
      this.scene.add(back);
      this.buildPrinter();
      this.parts = new THREE.Group();
      this.scene.add(this.parts);
      this.paths = new THREE.Group();
      this.scene.add(this.paths);
      this.applyTheme();
      new ResizeObserver(() => this.resize()).observe($('#viewport'));
      this.resize();
      const loop = () => {
        requestAnimationFrame(loop);
        if (this.goal) {
          this.controls.target.lerp(this.goal.target, 0.12);
          this.camera.position.lerp(this.goal.pos, 0.12);
          if (this.camera.position.distanceTo(this.goal.pos) < 0.5) this.goal = null;
        }
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
      };
      loop();
      // l'utilisateur reprend la main : on arrête l'animation de cadrage
      this.controls.addEventListener('start', () => { this.goal = null; });
      let down = null;
      canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
      canvas.addEventListener('pointerup', e => {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
        down = null;
        if (!selectable()) return;
        select(this.pick(e.clientX, e.clientY));
      });
    },
    resize() {
      const el = $('#viewport');
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    },
    buildPrinter() {
      if (this.printer) {
        this.scene.remove(this.printer);
        this.printer.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      }
      const g = new THREE.Group();
      this.plateMat = this.plateMat || new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
      this.lineMat = this.lineMat || new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 });
      this.zoneMat = this.zoneMat || new THREE.LineDashedMaterial({ dashSize: 3, gapSize: 3, transparent: true, opacity: 0.8 });
      this.frameMat = this.frameMat || new THREE.MeshStandardMaterial({ roughness: 0.6, transparent: true, opacity: 0.28, depthWrite: false });
      this.volMat = this.volMat || new THREE.LineBasicMaterial({ transparent: true, opacity: 0.22 });
      const line = (pts, mat, closed) => {
        const v = pts.map(p => new THREE.Vector3(p[0], p[1], p[2]));
        if (closed) v.push(v[0].clone());
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), mat);
        l.computeLineDistances();
        return l;
      };
      const ring = (r, z, mat, n = 128) => {
        const pts = [];
        for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r, z]); }
        return line(pts, mat, true);
      };
      const U = usable();
      if (M.bed.shape === 'round') {
        const R = M.bed.radius;
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 3, 96), this.plateMat);
        plate.rotation.x = Math.PI / 2;
        plate.position.z = -1.6;
        g.add(plate);
        [R / 3, 2 * R / 3].forEach(r => g.add(ring(r, 0.05, this.lineMat)));
        g.add(ring(U.r, 0.08, this.zoneMat));
        g.add(line([[-R, 0, 0.05], [R, 0, 0.05]], this.lineMat));
        g.add(line([[0, -R, 0.05], [0, R, 0.05]], this.lineMat));
        // colonnes de la delta + volume d'impression
        const towerR = R + 32, H = M.maxHeight + 60;
        const tops = [];
        for (let k = 0; k < 3; k++) {
          const a = Math.PI / 2 + k * Math.PI * 2 / 3;
          const t = new THREE.Mesh(new THREE.BoxGeometry(9, 9, H + 30), this.frameMat);
          t.position.set(Math.cos(a) * towerR, Math.sin(a) * towerR, (H + 30) / 2 - 30);
          t.rotation.z = a;
          g.add(t);
          tops.push([Math.cos(a) * towerR, Math.sin(a) * towerR, H]);
        }
        g.add(line(tops, this.volMat, true));
        g.add(ring(R, M.maxHeight, this.volMat, 96));
      } else {
        const w = M.bed.w, h = M.bed.h;
        const plate = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), this.plateMat);
        plate.position.z = -2.1;
        g.add(plate);
        for (let x = -w / 2 + 50; x < w / 2; x += 50) g.add(line([[x, -h / 2, 0.05], [x, h / 2, 0.05]], this.lineMat));
        for (let y = -h / 2 + 50; y < h / 2; y += 50) g.add(line([[-w / 2, y, 0.05], [w / 2, y, 0.05]], this.lineMat));
        g.add(line([[-U.hw, -U.hh, 0.08], [U.hw, -U.hh, 0.08], [U.hw, U.hh, 0.08], [-U.hw, U.hh, 0.08]], this.zoneMat, true));
        // portique de la cartésienne + volume d'impression
        const H = M.maxHeight + 70, px = w / 2 + 28;
        [-px, px].forEach(x => {
          const up = new THREE.Mesh(new THREE.BoxGeometry(14, 28, H), this.frameMat);
          up.position.set(x, 0, H / 2 - 40);
          g.add(up);
        });
        const top = new THREE.Mesh(new THREE.BoxGeometry(2 * px + 14, 28, 14), this.frameMat);
        top.position.set(0, 0, H - 40);
        g.add(top);
        const base = new THREE.Mesh(new THREE.BoxGeometry(2 * px + 40, h + 60, 30), this.frameMat);
        base.position.set(0, 0, -40);
        g.add(base);
        const zt = M.maxHeight;
        g.add(line([[-w / 2, -h / 2, zt], [w / 2, -h / 2, zt], [w / 2, h / 2, zt], [-w / 2, h / 2, zt]], this.volMat, true));
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => g.add(line([[sx * w / 2, sy * h / 2, 0], [sx * w / 2, sy * h / 2, zt]], this.volMat)));
      }
      this.printer = g;
      this.scene.add(g);
    },
    applyTheme() {
      this.scene.background = new THREE.Color(cssVar('--view') || '#E3E8EE');
      this.plateMat.color = new THREE.Color(cssVar('--plate') || '#39424D');
      const ink = new THREE.Color(cssVar('--muted') || '#566577');
      this.lineMat.color = new THREE.Color('#ffffff');
      this.zoneMat.color = new THREE.Color(cssVar('--pla') || '#EE7A1C');
      this.frameMat.color = ink;
      this.volMat.color = ink;
      this.parts.children.forEach(m => m.userData.colorKey && (m.material.color = new THREE.Color(m.userData.colorKey)));
    },
    clearParts() {
      this.parts.children.slice().forEach(m => { this.parts.remove(m); m.material.dispose(); });
    },
    showSingle(id) {
      this.clearParts();
      const m = MODELS.get(id);
      if (!m) return;
      const mesh = new THREE.Mesh(m.geo, new THREE.MeshStandardMaterial({ color: colorFor(id), roughness: 0.55, metalness: 0.02, side: THREE.DoubleSide }));
      mesh.userData.colorKey = colorFor(id);
      this.parts.add(mesh);
      this.frameBox(Math.max(m.w, m.h) / 2, m.z);
    },
    showLayout(layout, ghost = false) {
      this.clearParts();
      for (const p of layout.placed) {
        const m = MODELS.get(p.id);
        const mat = new THREE.MeshStandardMaterial({ color: colorFor(p.id), roughness: 0.55, metalness: 0.02, side: THREE.DoubleSide, transparent: ghost, opacity: ghost ? 0.12 : 1, depthWrite: !ghost });
        const mesh = new THREE.Mesh(m.geo, mat);
        mesh.userData.colorKey = colorFor(p.id);
        mesh.userData.uid = p.uid;
        mesh.userData.id = p.id;
        mesh.position.set(p.x, p.y, 0);
        mesh.rotation.z = p.rot ? Math.PI / 2 : 0;
        this.parts.add(mesh);
      }
    },
    highlight(uid) {
      this.parts.children.forEach(m => {
        if (!m.material.emissive) return;
        const on = uid != null && m.userData.uid === uid;
        m.material.emissive.set(on ? '#ffffff' : '#000000');
        m.material.emissiveIntensity = on ? 0.3 : 1;
      });
    },
    pick(clientX, clientY) {
      const r = this.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObjects(this.parts.children, false)[0];
      return hit && hit.object.userData.uid != null ? hit.object.userData.uid : null;
    },
    frameBox(r, h) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      if (dir.z < 0.25) { dir.z = 0.5; dir.normalize(); }
      const size = Math.max(r * 2, h, 24);
      const dist = size / (2 * Math.tan(this.camera.fov * Math.PI / 360)) * 2.6 + 30;
      const target = new THREE.Vector3(0, 0, Math.min(h / 2, 100));
      this.goal = { target, pos: target.clone().add(dir.multiplyScalar(dist)) };
    },
    framePlate() {
      const dir = new THREE.Vector3(0.12, -0.8, 0.6).normalize();
      const target = new THREE.Vector3(0, 0, 12);
      const span = M.bed.shape === 'round' ? 2 * M.bed.radius : Math.max(M.bed.w, M.bed.h);
      const dist = span / (2 * Math.tan(this.camera.fov * Math.PI / 360)) * 1.5;
      this.goal = { target, pos: target.clone().add(dir.multiplyScalar(dist)) };
    },
    setPaths(preview) {
      this.paths.children.slice().forEach(o => { this.paths.remove(o); o.geometry.dispose(); o.material.dispose(); });
      if (!preview) return;
      const n = preview.positions.length / 3;
      const pal = this.pathPalette();
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const c = pal[preview.types[i]]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      const posAttr = new THREE.BufferAttribute(preview.positions, 3);
      const colAttr = new THREE.BufferAttribute(col, 3);
      const mk = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', posAttr); g.setAttribute('color', colAttr); return g; };
      this.pathBelow = new THREE.LineSegments(mk(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4 }));
      this.pathTop = new THREE.LineSegments(mk(), new THREE.LineBasicMaterial({ vertexColors: true }));
      this.pathBelow.frustumCulled = this.pathTop.frustumCulled = false;
      this.paths.add(this.pathBelow, this.pathTop);
      this.preview = preview;
    },
    pathPalette() {
      return [new THREE.Color('#8C96A3'), new THREE.Color(cssVar('--pla') || '#EE7A1C'), new THREE.Color('#E8B730'), new THREE.Color(cssVar('--accent') || '#2149C9'), new THREE.Color('#2FA36B')];
    },
    showLayer(L) {
      if (!this.preview || !this.pathTop) return;
      const ends = this.preview.layerEnds;
      const start = L > 0 ? ends[L - 1] : 0;
      this.pathBelow.geometry.setDrawRange(0, start);
      this.pathTop.geometry.setDrawRange(start, ends[L] - start);
    },
    setMode(mode) {
      this.paths.visible = mode === 'trajets';
      this.parts.children.forEach(m => {
        m.material.transparent = mode === 'trajets';
        m.material.opacity = mode === 'trajets' ? 0.1 : 1;
        m.material.depthWrite = mode !== 'trajets';
      });
    }
  };

  /* miniatures du catalogue */
  async function renderThumbs() {
    const size = 220;
    let r;
    try {
      r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) { return; }
    r.setSize(size, size);
    r.setPixelRatio(1);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(-100, -160, 260);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(28, 1, 1, 3000);
    cam.up.set(0, 0, 1);
    for (const [id, m] of MODELS) {
      if (m.thumb) continue;
      const mesh = new THREE.Mesh(m.geo, new THREE.MeshStandardMaterial({ color: colorFor(id), roughness: 0.55, side: THREE.DoubleSide }));
      scene.add(mesh);
      m.geo.computeBoundingSphere();
      const s = m.geo.boundingSphere;
      const dist = s.radius / Math.sin(cam.fov * Math.PI / 360) * 1.05;
      const dir = new THREE.Vector3(0.5, -0.75, 0.6).normalize();
      cam.position.copy(s.center).add(dir.multiplyScalar(dist));
      cam.lookAt(s.center);
      r.render(scene, cam);
      m.thumb = r.domElement.toDataURL('image/png');
      scene.remove(mesh);
      mesh.material.dispose();
      const img = document.querySelector(`[data-thumb="${CSS.escape(id)}"]`);
      if (img) img.innerHTML = `<img alt="" src="${m.thumb}">`;
      await new Promise(res => setTimeout(res, 0));
    }
    r.dispose();
  }

  /* ---------------- découpe ---------------- */
  function sliceKey() {
    return JSON.stringify([M.id, S.layout.placed.map(p => [p.id, p.x, p.y, p.rot]), S.preset, cfg.temp, cfg.bedTemp, cfg.start]);
  }
  let sliceToken = 0;
  async function runSlice() {
    const key = sliceKey();
    if (!S.layout.placed.length) return;
    if (S.resultKey === key && (S.result || S.slicing)) return;
    const token = ++sliceToken;
    S.slicing = true; S.progress = 0; S.sliceError = ''; S.result = null; S.resultKey = key;
    renderPanel(); renderOverlay(); renderFooter();
    try {
      const res = await NevaSlicer.slice(buildSoups(S.layout), {
        preset: S.preset,
        profile: M.id,
        machine: { temp: cfg.temp, bedTemp: cfg.bedTemp, startGcode: cfg.start }
      }, (p) => {
        if (token !== sliceToken) return;
        S.progress = p;
        const bar = $('#sliceBar'); if (bar) bar.style.width = Math.round(p * 100) + '%';
      });
      if (token !== sliceToken) return;
      S.result = res;
      S.layer = res.stats.layers - 1;
      V.setPaths(res.preview);
      V.showLayer(S.layer);
      V.setMode(S.view);
    } catch (e) {
      if (token !== sliceToken) return;
      console.error(e);
      S.sliceError = e.message || String(e);
    } finally {
      if (token === sliceToken) { S.slicing = false; renderAll(); }
    }
  }
  function invalidateSlice() {
    sliceToken++;
    S.result = null; S.resultKey = ''; S.slicing = false;
    V.setPaths(null);
    S.mode = S.mode; // le choix d'envoi reste valable
    S.downloaded = false;
    S.guide = { current: 0, done: new Set() };
  }

  /* ---------------- étapes ---------------- */
  const STEPS = [
    { n: 1, label: 'Choisir les modèles' },
    { n: 2, label: 'Préparer le plateau' },
    { n: 3, label: 'Mode d’envoi' },
    { n: 4, label: 'Imprimer' }
  ];
  const canReach = n => {
    if (n === 1) return true;
    if (n === 2) return S.layout.placed.length > 0;
    if (n === 3) return !!S.result;
    if (n === 4) return !!S.result && !!S.mode;
    return false;
  };
  function goto(n) {
    if (!canReach(n)) return;
    if (n === S.step) return;
    if (n === 4 && S.step !== 4) S.guide = { current: 0, done: new Set() };
    S.step = n;
    S.sel = null;
    S.confirmClear = false;
    renderAll();
    $('#panel').scrollTop = 0;
    if (n === 1) { if (S.preview) V.showSingle(S.preview); else { V.showLayout(S.layout); V.framePlate(); } V.paths.visible = false; }
    if (n === 2 || n === 3) { V.showLayout(S.layout); V.framePlate(); V.setMode(n === 2 ? S.view : 'pieces'); runSlice(); }
    setTimeout(() => V.resize(), 0);
  }

  function renderSteps() {
    $('#steps').innerHTML = STEPS.map(s => `
      <li><button type="button" data-goto="${s.n}" ${s.n === S.step ? 'aria-current="step"' : ''} class="${s.n < S.step ? 'done' : ''}" ${canReach(s.n) ? '' : 'disabled'}>
        <span class="n">${s.n}</span><span class="lbl">${s.label}</span></button></li>`).join('');
  }

  function renderFooter() {
    const back = $('#back'), next = $('#next');
    back.hidden = S.step === 1;
    let label = 'Continuer →', ok = canReach(S.step + 1), sum = '';
    const n = S.layout.placed.length;
    if (S.step === 1) sum = n ? `${n} pièce${n > 1 ? 's' : ''} sur le plateau` : 'Ajoutez au moins un modèle';
    if (S.step === 2) sum = S.slicing ? 'Calcul en cours…' : S.result ? `${n} pièce${n > 1 ? 's' : ''} · ≈ ${duree(S.result.stats.seconds)} · ${fr(S.result.stats.grams)} g` : '';
    if (S.step === 3) sum = S.mode ? (S.mode === 'sd' ? 'Envoi par carte SD' : 'Envoi par câble USB') : 'Choisissez un mode d’envoi';
    if (S.step === 4) { label = 'Nouvelle impression'; ok = true; sum = S.mode === 'sd' ? 'Guide carte SD' : 'Guide câble USB'; }
    next.textContent = label;
    next.disabled = !ok;
    $('#summary').textContent = sum;
    $('#stage').classList.toggle('full', S.step === 4);
  }

  function renderAll() { renderSteps(); renderPanel(); renderOverlay(); renderFooter(); }

  /* ----- étape 1 ----- */
  function miniPlan() {
    const U = usable();
    const span = M.bed.shape === 'round' ? 2 * M.bed.radius : Math.max(M.bed.w, M.bed.h);
    const s = 132 / (span + 8);
    const rects = S.layout.placed.map(p => `<rect x="${(p.x - p.W / 2) * s}" y="${(-p.y - p.H / 2) * s}" width="${p.W * s}" height="${p.H * s}" rx="1.5" fill="${colorFor(p.id)}"/>`).join('');
    const bed = M.bed.shape === 'round'
      ? `<circle r="${M.bed.radius * s}" fill="var(--plate)"/><circle r="${U.r * s}" fill="none" stroke="var(--pla)" stroke-dasharray="2 2" stroke-width="1"/>`
      : `<rect x="${-M.bed.w / 2 * s}" y="${-M.bed.h / 2 * s}" width="${M.bed.w * s}" height="${M.bed.h * s}" rx="3" fill="var(--plate)"/><rect x="${-U.hw * s}" y="${-U.hh * s}" width="${2 * U.hw * s}" height="${2 * U.hh * s}" fill="none" stroke="var(--pla)" stroke-dasharray="2 2" stroke-width="1"/>`;
    return `<svg viewBox="-66 -66 132 132" width="132" height="132" role="img" aria-label="Plan du plateau vu de dessus">${bed}${rects}</svg>`;
  }
  function usedPct() {
    const U = usable();
    const area = S.layout.placed.reduce((a, p) => a + p.W * p.H, 0);
    const total = U.shape === 'round' ? Math.PI * U.r ** 2 : 4 * U.hw * U.hh;
    return Math.min(100, Math.round(area / total * 100));
  }
  const TRASH = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v4.5M9.4 6.5v4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function basketBlock() {
    const rows = [...S.basket].map(([id, q]) => {
      const m = MODELS.get(id);
      const nom = esc(nomAff(m));
      return `<li><span class="dot" style="background:${colorFor(id)}"></span><span>${nom}</span>
        <span class="stepper"><button type="button" data-dec="${esc(id)}" aria-label="Retirer un ${nom}">−</button><span class="num">${q}</span><button type="button" data-inc="${esc(id)}" aria-label="Ajouter un ${nom}">+</button></span>
        <button type="button" class="trash" data-remove="${esc(id)}" aria-label="Supprimer ${q > 1 ? 'les ' + q + ' ' : ''}${nom} du plateau" title="Supprimer du plateau">${TRASH}</button></li>`;
    }).join('');
    return `<div class="basket">
        <div>${miniPlan()}<div class="fill">Occupé ≈ ${usedPct()} %</div></div>
        <div style="min-width:0">
          <div class="basket-head"><h3>Sur le plateau</h3>
            ${rows ? `<button type="button" class="linkbtn ${S.confirmClear ? 'warn' : ''}" data-act="clear">${S.confirmClear ? 'Confirmer : tout retirer' : 'Vider le plateau'}</button>` : ''}</div>
          ${rows ? `<ul>${rows}</ul><p class="hint">Astuce : touchez une pièce dans la vue 3D pour la sélectionner et la supprimer.</p>` : '<p class="empty">Rien pour l’instant. Ajoutez un modèle du catalogue.</p>'}
        </div>
      </div>`;
  }
  function panelStep1() {
    const cats = ['Tous', ...new Set([...MODELS.values()].map(m => m.entry.categorie))];
    const seen = new Set();
    const list = [...MODELS.values()].filter(m => (S.cat === 'Tous' || m.entry.categorie === S.cat) && !seen.has(groupeDe(m)) && seen.add(groupeDe(m)))
      .map(m => { const g = groupeDe(m); const cur = S.variant[g] && MODELS.get(S.variant[g]); return cur || m; });
    const prev = S.preview && MODELS.get(S.preview);
    return `
      <div>
        <div class="kicker">Étape 1 sur 4</div>
        <h2>Choisissez vos modèles</h2>
        <p class="lead">Touchez un modèle pour le voir en 3D, puis ajoutez-le. Le plateau se remplit automatiquement.</p>
      </div>
      <div class="chips" role="group" aria-label="Catégories">
        ${cats.map(c => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${c === S.cat}">${esc(c)}</button>`).join('')}
      </div>
      <div class="cards">
        ${list.map(m => {
          const vs = variantesDe(groupeDe(m));
          const q = vs.reduce((a, x) => a + (S.basket.get(x.entry.id) || 0), 0);
          const cur = S.preview && MODELS.get(S.preview) && groupeDe(MODELS.get(S.preview)) === groupeDe(m);
          return `<button type="button" class="card" data-preview="${esc(m.entry.id)}" aria-current="${!!cur}">
            <span class="thumb" data-thumb="${esc(m.entry.id)}">${m.thumb ? `<img alt="" src="${m.thumb}">` : '<span class="ph"></span>'}</span>
            <span class="meta"><b>${esc(m.entry.nom)}</b><span>${vs.length > 1 ? vs.length + ' variantes' : dimsText(m)}</span>${vs.some(fitsAlone) ? '' : `<span class="toobig">Trop grand pour ${laMachine()}</span>`}</span>
            ${q ? `<span class="qty" aria-label="${q} sur le plateau">×${q}</span>` : ''}
          </button>`;
        }).join('')}
      </div>
      ${basketBlock()}`;
  }

  /* ----- étape 2 ----- */
  function panelStep2() {
    const r = S.result;
    const st = r && r.stats;
    const price = st ? st.grams / 1000 * cfg.price : 0;
    const tall = S.layout.placed.some(p => MODELS.get(p.id).z > M.maxHeight);
    return `
      <div>
        <div class="kicker">Étape 2 sur 4</div>
        <h2>Vérifiez le plateau</h2>
        <p class="lead">Les pièces sont placées et préparées automatiquement. Choisissez seulement la qualité.</p>
      </div>
      ${tall ? `<div class="callout bad">Une pièce dépasse la hauteur utile de ${M.maxHeight} mm.</div>` : ''}
      ${basketBlock()}
      <div class="presets" role="radiogroup" aria-label="Qualité d’impression">
        ${Object.values(PRESETS).map(p => `
          <button type="button" class="preset" role="radio" aria-checked="${S.preset === p.key}" data-preset="${p.key}">
            <span class="radio" aria-hidden="true"></span>
            <b>${p.label}${p.key === 'equilibre' ? ' <span class="badge ok">conseillé</span>' : ''}</b>
            <span class="spec">${fr(p.layer, 2)} mm<br>${p.walls} parois · ${Math.round(p.infill * 100)} %</span>
            <small>${p.hint}</small>
          </button>`).join('')}
      </div>
      <div>
        <div class="stats ${st ? '' : 'pending'}" aria-live="polite">
          <div class="stat"><span class="k">Durée estimée</span><span class="v">${st ? '≈ ' + duree(st.seconds) : '…'}</span><span class="s">chauffe et calibration comprises</span></div>
          <div class="stat"><span class="k">Filament</span><span class="v">${st ? fr(st.grams) + ' g' : '…'}</span><span class="s">${st ? fr(st.meters, 1) + ' m de PLA 1,75 mm' : '&nbsp;'}</span></div>
          <div class="stat"><span class="k">Coût matière</span><span class="v">${st ? fr(price, 2) + ' €' : '…'}</span><span class="s">sur la base de ${fr(cfg.price)} €/kg</span></div>
          <div class="stat"><span class="k">Couches</span><span class="v num">${st ? st.layers : '…'}</span><span class="s">${st ? 'hauteur ' + fr(st.height, 1) + ' mm' : '&nbsp;'}</span></div>
        </div>
        ${S.slicing ? `<div style="margin-top:10px"><div class="progress"><i id="sliceBar" style="width:${Math.round(S.progress * 100)}%"></i></div><p class="note" style="margin:6px 0 0">Préparation de l’impression…</p></div>` : ''}
        ${S.sliceError ? `<div class="callout bad" style="margin-top:10px">La préparation a échoué : ${esc(S.sliceError)}. Retirez le dernier modèle ajouté et réessayez.</div>` : ''}
      </div>
      <p class="note">Les estimations sont indicatives : la durée réelle peut varier de 10 à 20 %. Dans la vue 3D, « Trajets de la buse » montre le chemin couche par couche.</p>`;
  }

  /* ----- étape 3 ----- */
  /* Vérification du navigateur, faite une seule fois au lancement :
     le câble USB n'est proposé que dans Chrome ou Edge sur ordinateur,
     avec l'API Web Serial réellement utilisable. */
  const USB = (() => {
    const ua = navigator.userAgent;
    const brands = (navigator.userAgentData && navigator.userAgentData.brands || []).map(b => b.brand);
    const mobile = navigator.userAgentData ? navigator.userAgentData.mobile : /Android|iPhone|iPad|Mobile/i.test(ua);
    const isEdge = brands.includes('Microsoft Edge') || /Edg\//.test(ua);
    const isChrome = brands.includes('Google Chrome') || (/Chrome\//.test(ua) && !/Edg\/|OPR\/|Opera|SamsungBrowser|YaBrowser|Vivaldi/.test(ua));
    if (!(isEdge || isChrome) || mobile) return { ok: false, why: 'Le câble USB n’est proposé que dans Chrome ou Edge sur ordinateur. Utilisez la carte SD, ou ouvrez l’application dans l’un de ces navigateurs.' };
    if (!('serial' in navigator)) return { ok: false, why: 'Ce navigateur ne permet pas de piloter l’imprimante par câble USB. Mettez Chrome ou Edge à jour, ou utilisez la carte SD.' };
    const fp = document.featurePolicy || document.permissionsPolicy;
    if (fp && fp.allowsFeature && !fp.allowsFeature('serial')) return { ok: false, why: 'Le câble USB n’est pas disponible dans cet aperçu. Il apparaît quand l’application est ouverte directement (site de la bibliothèque).' };
    return { ok: true, why: '' };
  })();
  function serialSupport() { return USB; }
  function panelStep3() {
    const sd = `
        <button type="button" class="choice" role="radio" aria-checked="${S.mode === 'sd'}" data-mode="sd">
          ${ILLO.sdChoice()}
          <span>
            <h3><span class="letter">A</span> Carte SD <span class="badge ok">conseillé</span></h3>
            <p>On copie le fichier sur la carte, puis ${laMachine()} imprime seule.</p>
            <ul><li>L’ordinateur peut être éteint pendant l’impression.</li><li>Fonctionne depuis n’importe quel ordinateur.</li></ul>
          </span>
        </button>`;
    const usb = USB.ok ? `
        <button type="button" class="choice" role="radio" aria-checked="${S.mode === 'usb'}" data-mode="usb">
          ${ILLO.usbChoice()}
          <span>
            <h3><span class="letter">B</span> Câble USB</h3>
            <p>L’ordinateur envoie l’impression à ${laMachine()} en direct, depuis cette page.</p>
            <ul><li>Chrome ou Edge sur ordinateur.</li><li>L’ordinateur et cette page restent ouverts jusqu’à la fin.</li></ul>
          </span>
        </button>` : '';
    return `
      <div>
        <div class="kicker">Étape 3 sur 4</div>
        <h2>Comment envoyer l’impression ?</h2>
        <p class="lead">${USB.ok
          ? 'Les deux méthodes donnent le même résultat. La carte SD est la plus simple et libère l’ordinateur.'
          : 'Avec ce navigateur, l’impression se lance avec la carte SD.'}</p>
      </div>
      <div class="choices" role="radiogroup" aria-label="Mode d’envoi">${sd}${usb}</div>
      ${USB.ok ? '' : `<p class="note">${esc(USB.why)}</p>`}`;
  }

  /* ----- étape 4 ----- */
  function guideSteps() {
    const st = S.result.stats;
    const file = cfg.file;
    const isArtifact = !!(window.claude && window.claude.use);
    if (S.mode === 'sd') {
      const commun = [
        { illo: ILLO.download(file), title: 'Télécharger le fichier',
          body: `<p>Le fichier <code>${esc(file)}</code> contient toutes les instructions pour ${laMachine()}.</p>
            ${isArtifact ? `<p class="note">Dans cet aperçu, le fichier arrive sous le nom <code>${esc(file)}.txt</code> : renommez-le en <code>${esc(file)}</code> avant de le copier.</p>` : ''}
            <div class="row"><button type="button" class="btn primary" data-act="download">Télécharger ${esc(file)}</button>${S.downloaded ? '<span class="badge ok">téléchargé</span>' : ''}</div>` },
        { illo: ILLO.cardIn(), title: 'Brancher la carte sur l’ordinateur',
          body: `<p>Glissez la carte mémoire fournie avec ${laMachine()} dans son lecteur, puis branchez le lecteur sur l’ordinateur.</p>` },
        { illo: ILLO.copy(file), title: 'Copier le fichier sur la carte',
          body: `<p>Ouvrez la carte dans l’explorateur de fichiers. Copiez <code>${esc(file)}</code> directement dans la carte, pas dans un dossier.</p><p>S’il y a déjà un fichier <code>${esc(file)}</code>, choisissez « Remplacer ».</p>` },
        { illo: ILLO.eject(), title: 'Éjecter la carte',
          body: `<p>Sous Windows : clic droit sur la carte, puis « Éjecter ». Sur Mac : faites glisser la carte vers la corbeille. Attendez le message qui confirme qu’on peut la retirer.</p>` },
        { illo: ILLO.cardToPrinter(), title: `Insérer la carte dans ${laMachine()}`,
          body: `<p>Retirez la carte du lecteur et insérez-la dans le lecteur de carte de l’imprimante.</p>` },
        { illo: ILLO.prepare(), title: 'Préparer l’imprimante',
          body: `<p>Vérifiez que le filament est chargé et que le plateau est propre et vide : aucun reste d’impression.</p>` }
      ];
      const lancer = M.id === 'vyper'
        ? { illo: ILLO.screen(file), title: 'Lancer depuis l’écran tactile',
            body: `<p>Allumez la Vyper. Sur l’écran, touchez <strong>Imprimer</strong>, choisissez <code>${esc(file)}</code>, puis confirmez.</p><p>Le plateau chauffe d’abord, puis la buse : comptez quelques minutes avant le début de l’impression.</p>` }
        : { illo: ILLO.button(), title: 'Appuyer sur le bouton',
            body: `<p>Allumez la Neva, puis appuyez une fois sur le bouton. Elle chauffe, se calibre en venant toucher le plateau, puis commence à imprimer.</p><p>Pendant l’impression, évitez de toucher ou tapoter le plateau. Un nouvel appui sur le bouton met l’impression en pause.</p>` };
      const fin = { illo: ILLO.collect(), title: 'Récupérer les pièces',
        body: M.bedTemp
          ? `<p>Comptez environ <strong>${duree(st.seconds)}</strong>. Attention : le plateau est chaud. Attendez qu’il ait refroidi, puis décollez les pièces doucement.</p>`
          : `<p>Comptez environ <strong>${duree(st.seconds)}</strong>. À la fin, la tête remonte. Laissez refroidir quelques minutes, puis décollez les pièces doucement.</p>` };
      return [...commun, lancer, fin];
    }
    const ser = serialSupport();
    const P = PRINTER;
    const conn = P.connected ? '<span class="status on">Imprimante connectée</span>' : P.error ? `<span class="status err">${esc(P.error)}</span>` : '<span class="status">Non connectée</span>';
    return [
      { illo: ILLO.cable(), title: 'Brancher le câble USB',
        body: `<p>Reliez ${laMachine()} à l’ordinateur avec le câble USB, puis allumez l’imprimante.</p>` },
      { illo: ILLO.prepare(), title: 'Préparer l’imprimante',
        body: `<p>Vérifiez que le filament est chargé et que le plateau est propre et vide.</p>` },
      { illo: ILLO.connect(), title: 'Connecter l’imprimante',
        body: ser.ok
          ? `<p>Cliquez sur « Connecter », puis choisissez le port de l’imprimante dans la fenêtre du navigateur (souvent « USB Serial » ou « Arduino »).</p>
             <div class="row"><button type="button" class="btn primary" data-act="connect" ${P.connected || P.busy ? 'disabled' : ''}>Connecter</button>${conn}</div>`
          : `<div class="callout">${esc(ser.why)}</div><div class="row"><button type="button" class="btn" data-act="switch-sd">Utiliser la carte SD</button></div>` },
      { illo: ILLO.play(), title: 'Lancer l’impression',
        body: `<p>${M.bedTemp ? 'Le plateau puis la buse chauffent' : 'La Neva chauffe et se calibre'} avant de commencer. La température et l’avancement s’affichent ici.</p>
          <div class="row">
            <button type="button" class="btn primary" data-act="print" ${P.connected && !P.printing ? '' : 'disabled'}>Lancer l’impression</button>
            <button type="button" class="btn" data-act="pause" ${P.printing ? '' : 'disabled'}>${P.paused ? 'Reprendre' : 'Pause'}</button>
            <button type="button" class="btn danger" data-act="stop" ${P.printing ? '' : 'disabled'}>${P.confirmStop ? 'Confirmer l’arrêt' : 'Arrêter'}</button>
          </div>
          <div class="console" aria-live="polite">
            <div><div class="k">Buse</div><div class="v" id="pTemp">${P.temp != null ? fr(P.temp) + ' / ' + fr(P.target || 0) + ' °C' : '—'}</div></div>
            <div><div class="k">Avancement</div><div class="v" id="pPct">${P.total ? fr(P.sent / P.total * 100, 1) + ' %' : '—'}</div></div>
            <div><div class="k">État</div><div class="v" id="pState">${esc(P.state)}</div></div>
          </div>
          <div class="progress" style="margin-top:8px"><i id="pBar" style="width:${P.total ? (P.sent / P.total * 100) : 0}%"></i></div>` },
      { illo: ILLO.awake(), title: 'Laisser l’ordinateur allumé',
        body: `<p>Gardez cet onglet ouvert et l’ordinateur branché jusqu’à la fin (environ <strong>${duree(st.seconds)}</strong>). La mise en veille arrêterait l’impression.</p>` },
      { illo: ILLO.collect(), title: 'Récupérer les pièces',
        body: `<p>À la fin, la tête remonte. Laissez refroidir quelques minutes, puis décollez les pièces doucement.</p>` }
    ];
  }
  function panelStep4() {
    const steps = guideSteps();
    const g = S.guide;
    return `
      <div>
        <div class="kicker">Étape 4 sur 4 · ${S.mode === 'sd' ? 'Carte SD' : 'Câble USB'}</div>
        <h2>Lancez l’impression, pas à pas</h2>
        <p class="lead">Suivez les étapes dans l’ordre et cochez-les au fur et à mesure.</p>
      </div>
      <ol class="guide">
        ${steps.map((s, i) => `
          <li class="gstep ${g.done.has(i) ? 'done' : ''} ${i === g.current ? 'current' : ''}">
            <span class="no" aria-hidden="true">${g.done.has(i) ? '✓' : i + 1}</span>
            <div class="illo" aria-hidden="true">${s.illo}</div>
            <div class="body">
              <h3>${s.title}</h3>
              ${s.body}
              <div class="row"><button type="button" class="donebtn" data-done="${i}" aria-pressed="${g.done.has(i)}">${g.done.has(i) ? 'Fait' : 'C’est fait'}</button></div>
            </div>
          </li>`).join('')}
      </ol>`;
  }

  function renderPanel() {
    const html = S.step === 1 ? panelStep1() : S.step === 2 ? panelStep2() : S.step === 3 ? panelStep3() : panelStep4();
    $('#panel').innerHTML = `<div class="panel-inner">${html}</div>`;
  }

  function renderOverlay() {
    const top = $('#ovTop'), bottom = $('#ovBottom');
    top.innerHTML = ''; bottom.innerHTML = '';
    if (S.step === 1) {
      const m = S.preview && MODELS.get(S.preview);
      const vs = m ? variantesDe(groupeDe(m)) : [];
      if (m) top.innerHTML = `<div class="tag"><strong>${esc(m.entry.nom)}</strong><div class="dims">${dimsText(m)} · ${esc(m.entry.categorie)}</div>
          ${vs.length > 1 ? `<div class="variants" role="group" aria-label="Variante">${vs.map(x => `<button type="button" class="chip" data-variant="${esc(x.entry.id)}" aria-pressed="${x === m}">${esc(x.entry.variante)}</button>`).join('')}</div>` : ''}
          <p>${esc(m.entry.description)}${m.entry.conseil ? ' ' + esc(m.entry.conseil) : ''}</p>
          ${creditHtml(m)}
          ${fitsAlone(m) ? `<button type="button" class="btn primary" data-inc="${esc(m.entry.id)}">+ Ajouter au plateau</button>` : `<p class="toobig">Trop grand pour ${laMachine()}${vs.length > 1 ? ' : essayez une autre variante' : ''}.</p>`}</div>
        <button type="button" class="iconbtn" data-act="show-plate">Voir tout le plateau</button>`;
      else top.innerHTML = selTag() || `<div class="tag"><strong>Plateau de ${laMachine()}</strong><div class="dims">${esc(bedText())} · zone utile en pointillés${S.layout.placed.length ? ' · touchez une pièce pour la sélectionner' : ''}</div></div>`;
    }
    if (S.step === 2) {
      top.innerHTML = `<div class="seg" role="group" aria-label="Affichage">
          <button type="button" data-view="pieces" aria-pressed="${S.view === 'pieces'}">Pièces</button>
          <button type="button" data-view="trajets" aria-pressed="${S.view === 'trajets'}" ${S.result ? '' : 'disabled'}>Trajets de la buse</button>
        </div>${S.view === 'pieces' ? selTag() : ''}`;
      if (S.view === 'trajets' && S.result) {
        const st = S.result.stats, tops = S.result.preview.layerTops;
        bottom.innerHTML = `<div class="tag">
            <div class="slider-row"><label for="layer" class="dims">Couche</label>
              <input type="range" id="layer" min="0" max="${st.layers - 1}" value="${S.layer}">
              <output id="layerOut">${S.layer + 1} / ${st.layers} · ${fr(tops[S.layer], 2)} mm</output></div>
            <div class="legend" style="margin-top:6px">
              <span><i style="background:var(--pla)"></i>paroi extérieure</span>
              <span><i style="background:#E8B730"></i>paroi intérieure</span>
              <span><i style="background:var(--accent)"></i>dessus / dessous pleins</span>
              <span><i style="background:#2FA36B"></i>remplissage</span>
              <span><i style="background:#8C96A3"></i>jupe</span>
            </div></div>`;
      }
    }
    if (S.step === 3) top.innerHTML = `<div class="tag"><strong>Prêt à imprimer</strong><div class="dims">${S.layout.placed.length} pièce(s) · ≈ ${duree(S.result.stats.seconds)}</div></div>`;
  }

  function selTag() {
    const p = S.sel != null && S.layout.placed.find(x => x.uid === S.sel);
    if (!p) return '';
    const m = MODELS.get(p.id);
    const n = S.basket.get(p.id) || 1;
    return `<div class="tag sel"><strong>${esc(nomAff(m))}</strong><div class="dims">${dimsText(m)}${n > 1 ? ' · ' + n + ' exemplaires' : ''}</div>
      <div class="row-btns">
        <button type="button" class="btn small danger" data-act="remove-sel">${TRASH} Supprimer cette pièce</button>
        <button type="button" class="btn small" data-act="unselect">Annuler</button>
      </div></div>`;
  }
  function selectable() {
    return (S.step === 1 && !S.preview) || (S.step === 2 && S.view === 'pieces');
  }
  function select(uid) {
    S.sel = uid;
    V.highlight(uid);
    renderOverlay();
  }

  /* ---------------- impression USB (Web Serial) ---------------- */
  const PRINTER = {
    port: null, writer: null, reader: null, connected: false, busy: false, printing: false, paused: false, stopFlag: false,
    confirmStop: false, temp: null, target: null, sent: 0, total: 0, state: 'En attente', error: '',
    waiters: [], resend: null, wake: null, n: 0,
    async connect() {
      this.error = '';
      try {
        this.busy = true; refreshGuide();
        this.port = await navigator.serial.requestPort();
        await this.port.open({ baudRate: Number(cfg.baud) });
        this.writer = this.port.writable.getWriter();
        this.readLoop();
        this.state = 'Démarrage…'; refreshGuide();
        await new Promise(r => setTimeout(r, 2500)); // la carte redémarre à l'ouverture du port
        this.n = 0;
        await this.cmd('M110 N0');
        await this.cmd('M155 S2'); // rapport automatique de température
        await this.cmd('M105');
        this.connected = true; this.state = 'Prête';
      } catch (e) {
        this.error = e && e.name === 'NotFoundError' ? 'Aucun port choisi' : 'Connexion impossible';
        console.warn(e);
        try { if (this.port) await this.port.close(); } catch (_) { /* déjà fermé */ }
      } finally { this.busy = false; refreshGuide(); }
    },
    async readLoop() {
      const dec = new TextDecoder();
      let buf = '';
      try {
        this.reader = this.port.readable.getReader();
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) { this.onLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
        }
      } catch (e) {
        this.connected = false; this.printing = false; this.error = 'Imprimante déconnectée'; refreshGuide();
      }
    },
    onLine(l) {
      if (!l) return;
      const t = /T:\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(l);
      if (t) { this.temp = +t[1]; this.target = +t[2]; updateConsole(); }
      const rs = /Resend:\s*(\d+)/i.exec(l);
      if (rs) this.resend = +rs[1];
      if (l.startsWith('ok')) { const w = this.waiters.shift(); if (w) w(); }
    },
    checksum(s) { let c = 0; for (let i = 0; i < s.length; i++) c ^= s.charCodeAt(i); return c & 0xff; },
    async cmd(c) {
      const line = c === 'M110 N0' ? 'N0 M110 N0' : `N${++this.n} ${c}`;
      if (c === 'M110 N0') this.n = 0;
      const ok = new Promise(r => this.waiters.push(r));
      await this.writer.write(new TextEncoder().encode(`${line}*${this.checksum(line)}\n`));
      await ok;
    },
    async print(gcode) {
      const lines = gcode.split('\n').map(l => l.replace(/;.*$/, '').trim()).filter(Boolean);
      this.total = lines.length; this.sent = 0; this.printing = true; this.paused = false; this.stopFlag = false;
      this.state = 'Chauffe et calibration'; refreshGuide();
      try { this.wake = await navigator.wakeLock?.request('screen'); } catch (e) { /* refusé */ }
      const base = this.n; // numéro de ligne avant le début
      let i = 0;
      while (i < lines.length) {
        if (this.stopFlag) break;
        while (this.paused && !this.stopFlag) await new Promise(r => setTimeout(r, 200));
        if (this.stopFlag) break;
        this.resend = null;
        await this.cmd(lines[i]);
        if (this.resend != null && this.resend > base) { i = this.resend - base - 1; this.n = this.resend - 1; continue; }
        i++;
        this.sent = i;
        if (/^G1 .*E/.test(lines[i - 1]) && this.state !== 'Impression') { this.state = 'Impression'; updateConsole(); }
        if (i % 25 === 0) updateConsole();
      }
      if (this.stopFlag) {
        for (const c of ['M104 S0', 'M107', 'G91', 'G1 Z10 F3000', 'G90', 'G28', 'M84']) await this.cmd(c);
        this.state = 'Arrêtée';
      } else this.state = 'Terminée';
      this.printing = false;
      try { await this.wake?.release(); } catch (e) { /* ignoré */ }
      refreshGuide();
    }
  };
  function updateConsole() {
    const P = PRINTER;
    const t = $('#pTemp'), p = $('#pPct'), s = $('#pState'), b = $('#pBar');
    if (t) t.textContent = P.temp != null ? fr(P.temp) + ' / ' + fr(P.target || 0) + ' °C' : '—';
    if (p) p.textContent = P.total ? fr(P.sent / P.total * 100, 1) + ' %' : '—';
    if (s) s.textContent = P.state;
    if (b) b.style.width = (P.total ? P.sent / P.total * 100 : 0) + '%';
  }
  function refreshGuide() { if (S.step === 4) renderPanel(); }
  window.addEventListener('beforeunload', e => { if (PRINTER.printing) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------- téléchargement ---------------- */
  async function download() {
    const gcode = S.result.gcode;
    const file = cfg.file || M.sdFile;
    if (window.claude && window.claude.use) {
      const dl = await window.claude.use('downloads');
      if (dl) {
        try {
          await dl.save({ filename: file + '.txt', data: new Blob([gcode]) });
          S.downloaded = true; toast('Fichier enregistré'); markDone(0);
        } catch (e) {
          if (e && e.code === 'declined') toast('Téléchargement annulé');
          else toast('Le téléchargement n’est pas disponible ici');
        }
        return;
      }
    }
    const url = URL.createObjectURL(new Blob([gcode], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    S.downloaded = true; toast('Fichier téléchargé'); markDone(0);
  }
  function markDone(i) {
    S.guide.done.add(i);
    let c = 0;
    while (S.guide.done.has(c)) c++;
    S.guide.current = c;
    renderPanel();
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  /* ---------------- panier ---------------- */
  function changeQty(id, d) {
    const m = MODELS.get(id);
    const q = Math.max(0, (S.basket.get(id) || 0) + d);
    const next = new Map(S.basket);
    if (q === 0) next.delete(id); else next.set(id, q);
    if (d > 0 && !fitsAlone(m)) { toast(`Ce modèle est trop grand pour ${laMachine()}`); return; }
    const layout = computeLayout(next);
    if (d > 0 && layout.failed.length) { toast('Plus de place sur le plateau : imprimez d’abord ce plateau, puis ce modèle à part'); return; }
    const msg = d > 0 ? `« ${nomAff(m)} » ajouté` : q === 0 ? `« ${nomAff(m)} » retiré du plateau` : `Un « ${nomAff(m)} » retiré`;
    commitBasket(next, layout, msg, d > 0);
  }
  function commitBasket(next, layout, msg, added) {
    S.basket = next;
    S.layout = layout || computeLayout(next);
    S.sel = null;
    S.confirmClear = false;
    invalidateSlice();
    if (msg) toast(msg);
    if (!S.layout.placed.length && S.step > 1) { S.step = 2; S.preview = null; goto(1); return; }
    if (S.step === 2) { S.view = 'pieces'; V.showLayout(S.layout); V.setMode('pieces'); renderAll(); runSlice(); return; }
    renderAll();
    if (S.step === 1 && (added || !S.preview)) { S.preview = null; V.showLayout(S.layout); V.framePlate(); renderPanel(); renderOverlay(); }
  }

  /* ---------------- événements ---------------- */
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.goto) goto(+d.goto);
    if (d.cat) { S.cat = d.cat; renderPanel(); }
    if (d.variant) { const vm = MODELS.get(d.variant); S.variant[groupeDe(vm)] = d.variant; S.preview = d.variant; V.showSingle(d.variant); renderPanel(); renderOverlay(); }
    if (d.preview) { S.sel = null; S.preview = d.preview; V.showSingle(d.preview); renderPanel(); renderOverlay(); }
    if (d.inc) changeQty(d.inc, 1);
    if (d.dec) changeQty(d.dec, -1);
    if (d.remove) changeQty(d.remove, -(S.basket.get(d.remove) || 0));
    if (d.act === 'remove-sel') { const p = S.layout.placed.find(x => x.uid === S.sel); if (p) changeQty(p.id, -1); }
    if (d.act === 'unselect') select(null);
    if (d.act === 'clear') {
      if (!S.confirmClear) {
        S.confirmClear = true; renderPanel();
        setTimeout(() => { if (S.confirmClear) { S.confirmClear = false; renderPanel(); } }, 4000);
      } else commitBasket(new Map(), null, 'Plateau vidé', false);
    }
    if (d.preset && d.preset !== S.preset) { S.preset = d.preset; invalidateSlice(); renderAll(); runSlice(); }
    if (d.view) { S.view = d.view; S.sel = null; V.highlight(null); V.setMode(S.view); if (S.result) V.showLayer(S.layer); renderOverlay(); }
    if (d.mode) { S.mode = d.mode === 'usb' && !USB.ok ? 'sd' : d.mode; renderAll(); }
    if (d.done) { const i = +d.done; if (S.guide.done.has(i)) { S.guide.done.delete(i); S.guide.current = Math.min(S.guide.current, i); renderPanel(); } else markDone(i); }
    if (d.act === 'show-plate') { S.preview = null; V.showLayout(S.layout); V.framePlate(); renderAll(); }
    if (d.act === 'download') download();
    if (d.act === 'switch-sd') { S.mode = 'sd'; S.guide = { current: 0, done: new Set() }; renderAll(); }
    if (d.act === 'connect') PRINTER.connect();
    if (d.act === 'print') { markDone(2); PRINTER.print(S.result.gcode); }
    if (d.act === 'pause') { PRINTER.paused = !PRINTER.paused; PRINTER.state = PRINTER.paused ? 'En pause' : 'Impression'; renderPanel(); }
    if (d.act === 'stop') {
      if (!PRINTER.confirmStop) { PRINTER.confirmStop = true; renderPanel(); setTimeout(() => { PRINTER.confirmStop = false; refreshGuide(); }, 4000); }
      else { PRINTER.confirmStop = false; PRINTER.stopFlag = true; PRINTER.paused = false; PRINTER.state = 'Arrêt…'; renderPanel(); }
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'layer') {
      S.layer = +e.target.value;
      V.showLayer(S.layer);
      const o = $('#layerOut');
      if (o) o.textContent = `${S.layer + 1} / ${S.result.stats.layers} · ${fr(S.result.preview.layerTops[S.layer], 2)} mm`;
    }
  });
  document.addEventListener('keydown', e => {
    if (S.sel == null || e.target.closest('input, textarea, select, dialog')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const p = S.layout.placed.find(x => x.uid === S.sel);
      if (p) changeQty(p.id, -1);
    }
    if (e.key === 'Escape') select(null);
  });
  $('#back').addEventListener('click', () => goto(S.step - 1));
  $('#next').addEventListener('click', () => {
    if (S.step === 4) {
      if (PRINTER.printing) { toast('Attendez la fin de l’impression en cours'); return; }
      S.basket = new Map(); S.layout = { placed: [], failed: [] }; S.preview = null; S.mode = USB.ok ? null : 'sd'; invalidateSlice();
      S.step = 2; goto(1); return;
    }
    goto(S.step + 1);
  });

  /* réglages animateur */
  const dlg = $('#settings');
  function fillSettings() {
    $('#settingsTitle').textContent = 'Réglages animateur · ' + M.name;
    $('#cfgTemp').value = cfg.temp; $('#cfgPrice').value = cfg.price; $('#cfgFile').value = cfg.file;
    $('#cfgBed').value = cfg.bedTemp || 0; $('#bedField').hidden = !M.bedTemp;
    $('#cfgBaud').value = cfg.baud; $('#cfgStart').value = cfg.start;
  }
  $('#openSettings').addEventListener('click', () => { fillSettings(); dlg.showModal(); });
  $('#cfgReset').addEventListener('click', () => { cfg = Object.assign({ price: 25 }, defaultsFor(M)); fillSettings(); });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'save') return;
    const before = sliceKey();
    const D = defaultsFor(M);
    cfg.temp = Math.min(260, Math.max(180, +$('#cfgTemp').value || D.temp));
    cfg.bedTemp = M.bedTemp ? Math.min(110, Math.max(0, +$('#cfgBed').value || 0)) : 0;
    cfg.price = Math.max(0, +$('#cfgPrice').value || 0);
    cfg.file = ($('#cfgFile').value || D.file).trim();
    cfg.baud = $('#cfgBaud').value;
    cfg.start = $('#cfgStart').value.trim() || D.start;
    saveCfg();
    if (sliceKey() !== before) { invalidateSlice(); if (S.step >= 2) { S.step = Math.min(S.step, 2); runSlice(); } }
    renderAll();
    toast('Réglages enregistrés');
  });
  $('#cfgStl').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      let geo = new THREE.STLLoader().parse(await f.arrayBuffer());
      if (geo.index) geo = geo.toNonIndexed();
      geo = NevaCatalogue.normaliser(geo);
      const id = 'import-' + Date.now();
      const nom = f.name.replace(/\.stl$/i, '');
      register({ id, nom, categorie: 'Importés', description: 'Modèle importé pour test.', conseil: '' }, geo);
      const m = MODELS.get(id);
      if (!fitsAlone(m)) toast(`Attention : ce modèle dépasse le volume de ${laMachine()}`);
      else toast(`« ${nom} » ajouté au catalogue`);
      S.cat = 'Importés'; S.preview = id; S.step = 1;
      dlg.close('cancel');
      renderAll(); V.showSingle(id); renderThumbs();
    } catch (err) {
      toast('Fichier STL illisible');
    }
    e.target.value = '';
  });

  /* thème clair / sombre */
  const themeChanged = () => {
    V.applyTheme();
    if (S.result) { V.setPaths(S.result.preview); V.showLayer(S.layer); V.setMode(S.step === 2 ? S.view : 'pieces'); }
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
  new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---------------- illustrations ---------------- */
  const neva = (x, y, s = 1, extra = '') => `<g transform="translate(${x} ${y}) scale(${s})">
      <path class="fsoft" d="M-34 62 L34 62 L30 70 L-30 70 Z"/>
      <path class="s" d="M-34 62 L34 62 L30 70 L-30 70 Z"/>
      <path class="s" d="M-30 62 V-6 M30 62 V-6 M0 60 V-10"/>
      <path class="s" d="M-33 -6 L0 -12 L33 -6 L0 -2 Z"/>
      <path class="t" d="M-30 26 L-4 40 M30 26 L4 40 M0 24 L0 38"/>
      <circle class="fp" cx="0" cy="42" r="3"/>
      <ellipse class="fa" cx="0" cy="58" rx="24" ry="4"/>
      ${extra}</g>`;
  const vyper = (x, y, s = 1, extra = '') => `<g transform="translate(${x} ${y}) scale(${s})">
      <path class="fsoft" d="M-36 58 H36 V70 H-36 Z"/><path class="s" d="M-36 58 H36 V70 H-36 Z"/>
      <rect class="fa" x="16" y="61" width="14" height="6" rx="1"/>
      <path class="s" d="M-30 58 V-8 M30 58 V-8 M-33 -8 H33"/>
      <path class="s" d="M-30 18 H30"/><rect class="fs s" x="-6" y="12" width="12" height="12" rx="2"/>
      <circle class="fp" cx="0" cy="28" r="2.6"/>
      <path class="fa" d="M-26 50 H26 L22 55 H-22 Z"/>
      ${extra}</g>`;
  const printerArt = (x, y, s) => (M.kind === 'delta' ? neva : vyper)(x, y, s);
  const laptop = (x, y) => `<g transform="translate(${x} ${y})"><rect class="fs s" x="0" y="0" width="64" height="40" rx="3"/><path class="s" d="M-8 46 H72 L66 40 H-2 Z"/></g>`;
  const sdCard = (x, y, r = 0) => `<g transform="translate(${x} ${y}) rotate(${r})"><path class="fp" d="M0 0 H14 L18 4 V24 H0 Z"/><path class="s" d="M0 0 H14 L18 4 V24 H0 Z"/><path class="t" d="M4 3 V8 M8 3 V8 M12 3 V8" style="stroke:#fff;opacity:.9"/></g>`;
  const fileIcon = (x, y, label) => `<g transform="translate(${x} ${y})"><path class="fs s" d="M0 0 H18 L26 8 V34 H0 Z"/><path class="t" d="M5 15 H21 M5 21 H21 M5 27 H15"/>${label ? `<text x="13" y="46" text-anchor="middle">${esc(label)}</text>` : ''}</g>`;
  const arrow = (d) => `<path class="sa" d="${d}"/>`;
  const W = (inner) => `<svg viewBox="0 0 168 112" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  const ILLO = {
    sdChoice: () => `<svg viewBox="0 0 96 96" class="illo">${sdCard(10, 38)}${arrow('M34 50 H50 M45 45 L50 50 L45 55')}${printerArt(72, 14, 0.62)}</svg>`,
    usbChoice: () => `<svg viewBox="0 0 96 96" class="illo">${laptop(6, 30).replace('width="64" height="40"', 'width="34" height="24"').replace('M-8 46 H72 L66 40 H-2 Z', 'M-4 30 H38 L35 24 H-1 Z')}<path class="sa" d="M42 58 C 52 58, 52 74, 64 74"/>${printerArt(76, 14, 0.62)}</svg>`,
    download: (file) => W(`${laptop(30, 30)}${fileIcon(50, 6, '')}${arrow('M63 50 V64 M57 58 L63 64 L69 58')}<text x="84" y="104" text-anchor="middle">${esc(file)}</text>`),
    cardIn: () => W(`${laptop(70, 34)}<rect class="fsoft s" x="34" y="60" width="26" height="14" rx="3"/><path class="s" d="M60 67 H70"/>${sdCard(38, 20)}${arrow('M47 48 V58')}`),
    copy: (file) => W(`${fileIcon(18, 26, file)}${arrow('M54 44 H96 M90 38 L96 44 L90 50')}<path class="fsoft s" d="M106 26 H128 L134 32 H150 V66 H106 Z"/>${sdCard(119, 36)}<text x="128" y="84" text-anchor="middle">carte SD</text>`),
    eject: () => W(`<path class="fa" d="M84 22 L106 46 H62 Z"/><rect class="fa" x="62" y="52" width="44" height="8" rx="2"/>${sdCard(74, 72)}`),
    cardToPrinter: () => W(`${printerArt(100, 20, 1)}${sdCard(24, 70)}${arrow('M46 82 H64 M58 76 L64 82 L58 88')}`),
    prepare: () => W(`<circle class="fp" cx="40" cy="56" r="26"/><circle class="s" cx="40" cy="56" r="26"/><circle class="fs s" cx="40" cy="56" r="8"/><path class="s" d="M40 30 C 70 18, 92 30, 112 40"/>${printerArt(124, 20, 0.9)}`),
    button: () => W(`${neva(66, 18, 1)}<circle class="fs s" cx="128" cy="78" r="12"/><circle class="fa" cx="128" cy="78" r="6"/><path class="s" d="M140 98 L132 86 M146 92 L134 84"/><text x="128" y="106" text-anchor="middle">1 appui</text>`),
    screen: (file) => W(`<rect class="fs s" x="34" y="10" width="100" height="78" rx="6"/><rect class="fsoft" x="42" y="18" width="84" height="12" rx="2"/><text x="48" y="27">Imprimer</text><rect class="fa" x="42" y="36" width="84" height="14" rx="2"/><text x="48" y="46" style="fill:var(--accent-ink)">${esc(file)}</text><path class="t" d="M48 60 H110 M48 70 H96"/><path class="s" d="M118 98 L110 84 M126 92 L114 80"/>`),
    collect: () => W(`<ellipse class="fa" cx="84" cy="80" rx="62" ry="10"/><rect class="fp" x="56" y="58" width="18" height="18" rx="2"/><path class="fp" d="M90 76 L100 54 L110 76 Z"/><path class="s" d="M124 64 L104 74"/><rect class="fs s" x="122" y="54" width="30" height="12" rx="3" transform="rotate(-24 137 60)"/><text x="40" y="30">refroidir</text><path class="s" d="M24 16 V34 M24 16 a4 4 0 0 1 8 0 V34" /><circle class="fa" cx="28" cy="38" r="6"/>`),
    cable: () => W(`${laptop(12, 34)}<path class="sa" d="M84 74 C 100 74, 100 92, 118 92"/>${printerArt(132, 20, 0.9)}`),
    connect: () => W(`<rect class="fs s" x="24" y="16" width="120" height="80" rx="6"/><path class="s" d="M24 32 H144"/><text x="34" y="27">Choisir un port série</text><rect class="fa" x="34" y="42" width="100" height="16" rx="3"/><text x="40" y="53" style="fill:var(--accent-ink)">USB Serial (COM3)</text><path class="t" d="M40 70 H110"/><rect class="fsoft s" x="100" y="76" width="36" height="14" rx="3"/>`),
    play: () => W(`<circle class="fa" cx="56" cy="56" r="26"/><path d="M50 44 L66 56 L50 68 Z" style="fill:var(--accent-ink)"/><rect class="fsoft" x="94" y="50" width="56" height="10" rx="5"/><rect class="fp" x="94" y="50" width="30" height="10" rx="5"/><text x="94" y="78">avancement</text>`),
    awake: () => W(`${laptop(52, 30)}<circle class="fs s" cx="84" cy="50" r="12"/><path class="s" d="M84 42 V50 L90 54"/><path class="s" d="M30 20 L46 36 M46 20 L30 36" style="stroke:var(--bad)"/><path class="t" d="M30 28 a9 9 0 1 0 12 -10 a7 7 0 0 1 -12 10"/>`)
  };

  /* ---------------- choix de l'imprimante ---------------- */
  const ART = {
    // dessins au trait, fond transparent ; remplaçables par imprimantes/<id>.png
    neva: `<svg viewBox="0 0 240 280" aria-hidden="true" class="pdraw">
      <ellipse class="ps" cx="120" cy="34" rx="34" ry="10"/><path class="pl" d="M86 34 V44 M154 34 V44"/>
      <path class="pf" d="M40 64 L120 50 L200 64 L120 78 Z"/>
      <path class="pl" d="M48 66 V236 M192 66 V236 M120 76 V230"/>
      <path class="pt" d="M48 130 L112 172 M192 130 L128 172 M120 118 L120 166"/>
      <path class="pa" d="M110 170 H130 L124 184 H116 Z"/><circle class="pp" cx="120" cy="190" r="4"/>
      <ellipse class="pb" cx="120" cy="228" rx="70" ry="13"/>
      <path class="pf" d="M36 236 H204 L196 256 H44 Z"/>
      <rect class="pp" x="108" y="210" width="24" height="14" rx="2"/>
    </svg>`,
    vyper: `<svg viewBox="0 0 280 280" aria-hidden="true" class="pdraw">
      <ellipse class="ps" cx="140" cy="28" rx="30" ry="9"/><path class="pl" d="M110 28 V38 M170 28 V38"/>
      <path class="pl" d="M50 44 H230 M58 44 V214 M222 44 V214"/>
      <path class="pl" d="M58 118 H222"/><rect class="pf" x="126" y="106" width="28" height="26" rx="3"/>
      <path class="pa" d="M134 132 H146 L142 142 H138 Z"/><circle class="pp" cx="140" cy="148" r="4"/>
      <path class="pb" d="M70 196 H210 L226 214 H54 Z"/>
      <rect class="pp" x="122" y="180" width="36" height="16" rx="2"/>
      <path class="pf" d="M36 214 H244 V246 H36 Z"/>
      <rect class="pa" x="180" y="221" width="46" height="18" rx="3"/>
    </svg>`
  };
  function renderSplash() {
    const last = store.last;
    $('#splashCards').innerHTML = Object.keys(PRINTERS).map(id => {
      const P = PRINTERS[id], prof = NevaSlicer.PROFILES[id];
      return `<button type="button" class="pcard" data-printer="${id}">
        ${id === last ? '<span class="lastused">Utilisée la dernière fois</span>' : ''}
        <span class="pimg" data-pimg="${id}">${ART[id]}</span>
        <span class="pname"><small>${esc(P.marque)}</small>${esc(P.short)}</span>
        <span class="pspec">${esc(P.plateau)}</span>
        <span class="pinfos">${P.infos.map(esc).join(' · ')}</span>
      </button>`;
    }).join('');
    // photo détourée facultative : imprimantes/<id>.png
    Object.keys(PRINTERS).forEach(id => {
      const img = new Image();
      img.onload = () => { const el = document.querySelector(`[data-pimg="${id}"]`); if (el) { el.innerHTML = ''; img.alt = ''; el.appendChild(img); } };
      img.src = `imprimantes/${id}.png`;
    });
  }
  function showSplash() {
    renderSplash();
    $('#splash').hidden = false;
    const btn = document.querySelector(`[data-printer="${store.last || 'neva'}"]`);
    if (btn) btn.focus();
  }
  function selectPrinter(id) {
    if (PRINTER.printing) { toast('Attendez la fin de l’impression en cours'); return; }
    M = NevaSlicer.PROFILES[id];
    store.last = id;
    loadCfg(); saveCfg();
    $('#printerName').textContent = M.name;
    $('#printerBed').textContent = bedText();
    // les pièces qui ne tiennent plus sur ce plateau sont retirées
    const next = new Map([...S.basket].filter(([mid]) => fitsAlone(MODELS.get(mid))));
    const removed = S.basket.size - next.size;
    S.basket = next;
    S.layout = computeLayout(S.basket);
    let cleared = false;
    if (S.layout.failed.length) { S.basket = new Map(); S.layout = { placed: [], failed: [] }; cleared = true; }
    S.preview = null; S.sel = null; S.step = 1;
    if (!USB.ok) S.mode = 'sd'; else if (S.mode === 'usb') S.mode = null;
    invalidateSlice();
    V.buildPrinter(); V.applyTheme();
    V.showLayout(S.layout); V.framePlate();
    $('#splash').hidden = true;
    renderAll();
    toast(cleared ? `${M.name} : les pièces ne tenaient pas toutes sur ce plateau, il a été vidé`
      : removed ? `${M.name} : ${removed} modèle(s) trop grand(s) retiré(s) du plateau` : `${M.name} sélectionnée`);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-printer]');
    if (b) selectPrinter(b.dataset.printer);
    if (e.target.closest('#changePrinter')) showSplash();
  });

  /* ---------------- démarrage ---------------- */  /* ---------------- démarrage ---------------- */
  async function start() {
    if (!USB.ok) S.mode = 'sd';
    V.init();
    await loadCatalogue();
    // départ sur un plateau vide
    S.basket = new Map();
    S.layout = { placed: [], failed: [] };
    S.preview = null;
    renderAll();
    V.showLayout(S.layout);
    V.framePlate();
    renderThumbs();
    showSplash();
  }
  start();
})();
