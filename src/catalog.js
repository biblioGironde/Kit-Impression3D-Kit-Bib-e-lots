/* =====================================================================
   Atelier Neva — catalogue des modèles
   ---------------------------------------------------------------------
   Pour utiliser vos propres fichiers STL, ajoutez des entrées avec
   « fichier » (chemin relatif à index.html) au lieu de « forme » :
     { id:'hibou', nom:'Hibou', categorie:'Déco', fichier:'modeles/hibou.stl',
       description:'…' }
   Les STL doivent être orientés Z vers le haut, en millimètres.
   ===================================================================== */
(function (global) {
  'use strict';
  const THREE = global.THREE || (typeof require !== 'undefined' ? require('three') : null);

  function roundedRect(w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function polyPath(cls, pts) {
    const p = new cls();
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    p.closePath();
    return p;
  }
  function circle(cls, cx, cy, r) {
    const p = new cls();
    p.absarc(cx, cy, r, 0, Math.PI * 2, false);
    return p;
  }
  function ngon(n, r, cx = 0, cy = 0, rot = 0) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  }
  function extrude(shape, depth, z0 = 0) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 20 });
    g.translate(0, 0, z0);
    return g.index ? g.toNonIndexed() : g;
  }
  function lathe(points, segs = 64) {
    const g = new THREE.LatheGeometry(points.map(p => new THREE.Vector2(p[0], p[1])), segs);
    g.rotateX(Math.PI / 2);
    return g.index ? g.toNonIndexed() : g;
  }
  function merge(geos) {
    let n = 0;
    geos.forEach(g => { n += g.attributes.position.array.length; });
    const arr = new Float32Array(n);
    let o = 0;
    geos.forEach(g => { arr.set(g.attributes.position.array, o); o += g.attributes.position.array.length; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  /* --------- formes de démonstration (dimensions en mm) --------- */
  const FORMES = {
    marquePage() {
      const s = roundedRect(32, 140, 5);
      for (let i = 0; i < 9; i++) {
        const y = -50 + i * 11.5;
        const x = i % 2 ? 5 : -5;
        s.holes.push(polyPath(THREE.Path, ngon(6, 4.2, x, y, Math.PI / 6)));
      }
      s.holes.push(circle(THREE.Path, 0, 63, 2.6));
      return extrude(s, 1.6);
    },
    porteClesBiblio() {
      const base = roundedRect(44, 30, 6);
      base.holes.push(circle(THREE.Path, 0, 9, 3.2));
      const frame = roundedRect(38, 14, 3);
      frame.holes.push(roundedRect(32, 8, 1.5));
      const g1 = extrude(base, 3);
      const g2 = extrude(frame, 1.2, 3);
      g2.translate(0, -5, 0);
      return merge([g1, g2]);
    },
    porteClesEtoile() {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 ? 10 : 23;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      const s = polyPath(THREE.Shape, pts);
      s.holes.push(circle(THREE.Path, 0, 0, 3.2));
      return extrude(s, 3.5);
    },
    cube() {
      return extrude(roundedRect(20, 20, 1.2), 20);
    },
    pion() {
      const p = [[0, 0], [10, 0], [10, 1.6], [8.4, 2.8], [5, 6.5], [3.8, 14], [5.4, 16], [5.4, 17.2], [3.4, 18.4], [3.2, 20.5]];
      const cy = 25.5, r = 5.6;
      for (let i = 0; i <= 10; i++) {
        const a = -Math.PI / 2.6 + (i / 10) * (Math.PI / 2 + Math.PI / 2.6);
        p.push([Math.max(0, Math.cos(a) * r), cy + Math.sin(a) * r]);
      }
      p[p.length - 1][0] = 0;
      return lathe(p, 48);
    },
    potCrayons() {
      const outer = ngon(6, 36, 0, 0, Math.PI / 6);
      const inner = ngon(6, 32.8, 0, 0, Math.PI / 6);
      const base = extrude(polyPath(THREE.Shape, outer), 2.4);
      const wallShape = polyPath(THREE.Shape, outer);
      wallShape.holes.push(polyPath(THREE.Path, inner.slice().reverse()));
      const wall = extrude(wallShape, 82.6, 2.4);
      return merge([base, wall]);
    },
    supportTel() {
      const s = polyPath(THREE.Shape, [[0, 0], [80, 0], [80, 5], [51, 72], [45, 72], [17, 5], [5, 5], [5, 15], [0, 15]]);
      s.holes.push(polyPath(THREE.Path, [[27, 11], [48, 52], [70, 11]]));
      const g = extrude(s, 60);
      return g;
    },
    sousVerre() {
      const s = new THREE.Shape();
      s.absarc(0, 0, 45, 0, Math.PI * 2, false);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        s.holes.push(circle(THREE.Path, Math.cos(a) * 28, Math.sin(a) * 28, 5.5));
      }
      s.holes.push(circle(THREE.Path, 0, 0, 9));
      return extrude(s, 4);
    },
    vase() {
      const R = z => 27 + 6 * Math.sin((z / 110) * Math.PI * 1.6 + 0.4);
      const p = [[0, 0], [R(0), 0]];
      for (let z = 4; z <= 110; z += 4) p.push([R(z), z]);
      for (let z = 110; z >= 4; z -= 4) p.push([R(z) - 2.2, z]);
      p.push([R(2.4) - 2.2, 2.4], [0, 2.4]);
      return lathe(p, 72);
    }
  };

  const CATALOGUE = [
    { id: 'marque-page', nom: 'Marque-page alvéoles', categorie: 'Lecture', forme: 'marquePage',
      description: 'Fin et léger, avec un trou pour un ruban.', conseil: 'Imprime vite : moins de 2 mm d’épaisseur.' },
    { id: 'porte-cles-biblio', nom: 'Porte-clés étiquette', categorie: 'Porte-clés', forme: 'porteClesBiblio',
      description: 'Une étiquette avec un cadre en relief, à personnaliser au feutre.', conseil: '' },
    { id: 'porte-cles-etoile', nom: 'Porte-clés étoile', categorie: 'Porte-clés', forme: 'porteClesEtoile',
      description: 'Une étoile à cinq branches percée au centre.', conseil: '' },
    { id: 'pion', nom: 'Pion de jeu', categorie: 'Jeux', forme: 'pion',
      description: 'Un pion classique pour les jeux de société.', conseil: 'Ajoutez-en plusieurs : ils sont petits.' },
    { id: 'cube', nom: 'Cube de test 20 mm', categorie: 'Tests', forme: 'cube',
      description: 'Le cube de référence pour vérifier les dimensions.', conseil: '' },
    { id: 'sous-verre', nom: 'Sous-verre ajouré', categorie: 'Maison', forme: 'sousVerre',
      description: 'Un disque de 90 mm percé de neuf cercles.', conseil: '' },
    { id: 'pot-crayons', nom: 'Pot à crayons hexagonal', categorie: 'Bureau', forme: 'potCrayons',
      description: 'Hauteur 85 mm, parois de 3 mm.', conseil: 'Impression longue.' },
    { id: 'support-tel', nom: 'Support de téléphone', categorie: 'Bureau', forme: 'supportTel',
      description: 'Tient un téléphone incliné, imprimé sur le côté.', conseil: 'Aucun support d’impression nécessaire.' },
    { id: 'vase', nom: 'Vase ondulé', categorie: 'Maison', forme: 'vase',
      description: 'Un vase de 11 cm au profil ondulé.', conseil: 'Impression longue.' },

    /* ---------- Objets en Bib : modèles sous licence Creative Commons ----------
       « variantes » : plusieurs fichiers pour un même objet (tailles, côtés…).
       « credit »    : affiché sur la fiche (obligatoire pour les licences CC). */
    ...(() => {
      const D = 'modeles/objets-en-bib/';
      const C = 'Objets en Bib';
      const v = (id, label) => ({ id, label, fichier: D + id + '.stl' });
      return [
        { id: 'presentoir-incline', nom: 'Présentoir de livre incliné', categorie: C,
          description: 'Présente un livre ouvert ou fermé, couverture visible.', conseil: 'Choisissez la taille du rebord selon l’épaisseur du livre.',
          variantes: [10, 15, 20, 25, 30, 35, 40].map(n => v('mitabula-' + n, 'rebord ' + n + ' mm')),
          credit: { auteur: 'Mitabula', licence: 'CC BY-SA', source: 'Thingiverse', url: 'https://www.thingiverse.com/thing:7050021' } },
        { id: 'chevalet', nom: 'Chevalet de présentation', categorie: C,
          description: 'Chevalet en A pour livres, affiches ou tablettes.', conseil: 'La taille indique l’épaisseur maximale acceptée.',
          variantes: [25, 35, 45, 55, 65, 75, 85].map(n => v('display-stand-' + n, n + ' mm')),
          credit: { auteur: 'OtakuMx', licence: 'CC BY-SA', source: 'MakerWorld', url: 'https://makerworld.com/fr/models/550731' } },
        { id: 'presentoir-couverture', nom: 'Présentoir couverture', categorie: C,
          description: 'Support bas pour mettre une nouveauté en avant sur une table.', conseil: 'La taille indique l’épaisseur du livre.',
          variantes: [17, 18, 19, 20, 21, 22, 23, 24].map(n => v('display-1342040-' + n, n + ' mm')),
          credit: { auteur: 'Sandyz Printz', licence: 'CC BY-SA', source: 'Printables', url: 'https://www.printables.com/model/1342040' } },
        { id: 'presentoir-bd', nom: 'Présentoir BD et albums', categorie: C,
          description: 'Support incliné pour bandes dessinées et albums.', conseil: '',
          fichier: D + 'comic-book-stand.stl',
          credit: { auteur: 'BeyondAwesome', licence: 'CC BY', source: 'Thingiverse', url: 'https://www.thingiverse.com/thing:5219516' } },
        { id: 'presentoir-pince', nom: 'Présentoir à pincer sur l’étagère', categorie: C,
          description: 'Se pince sur le bord d’une tablette pour présenter un livre en façade.', conseil: '',
          fichier: D + 'shelf-pinching-stand.stl',
          credit: { auteur: 'allm1l3s', licence: 'CC BY-SA', source: 'Thingiverse', url: 'https://www.thingiverse.com/thing:6484069' } },
        { id: 'serre-livre-invisible', nom: 'Serre-livre invisible', categorie: C,
          description: 'Se glisse sous les livres : on ne voit que les livres.', conseil: 'Imprimez les deux pièces pour une paire.',
          variantes: [v('invisible-bookend-a', 'pièce A'), v('invisible-bookend-b', 'pièce B')],
          credit: { auteur: 'Joshs', licence: 'CC BY-NC-SA', source: 'MakerWorld', url: 'https://makerworld.com/fr/models/589106' } },
        { id: 'serre-livre-discret', nom: 'Serre-livre discret', categorie: C,
          description: 'Équerre fine qui tient une rangée de livres.', conseil: 'Une version par côté de la rangée.',
          variantes: [v('invisible-bookend-446245', 'gauche'), v('invisible-bookend-446245-miroir', 'droite')],
          credit: { auteur: 'ateldsign', licence: 'CC BY-SA', source: 'Printables', url: 'https://www.printables.com/model/446245' } },
        { id: 'aligneur-rayon', nom: 'Aligneur de livres en rayon', categorie: C,
          description: 'Cale posée en fond de tablette pour aligner le dos des livres.', conseil: '',
          fichier: D + 'book-shelf-tidy.stl',
          credit: { auteur: 'James Holmes', licence: 'CC BY-NC-SA', source: 'MakerWorld', url: 'https://makerworld.com/fr/models/411207' } },
        { id: 'support-un-livre', nom: 'Support pour un livre', categorie: C,
          description: 'Gouttière qui tient un livre seul, debout.', conseil: 'Trois longueurs selon la hauteur du livre.',
          variantes: [v('one-book-shelf-2', 'petit'), v('one-book-shelf-3', 'moyen'), v('one-book-shelf-4', 'grand'), v('one-book-shelf-5', 'très grand')],
          credit: { auteur: 'miLAB_IDC', licence: 'CC BY', source: 'Thingiverse', url: 'https://www.thingiverse.com/thing:3464374' } },
        { id: 'etagere-invisible', nom: 'Étagère invisible', categorie: C,
          description: 'Se fixe au mur et se cache sous la pile de livres.', conseil: 'Vis de fixation non fournies.',
          variantes: [v('floating-shelf-1012183', 'modèle compact'), v('floating-shelf-713136', '120 × 100 mm')],
          credit: [{ auteur: 'RoamieTheHomie3D', licence: 'CC BY-SA', source: 'Printables', url: 'https://www.printables.com/model/1012183' },
                   { auteur: 'bgraue', licence: 'CC BY-NC', source: 'Printables', url: 'https://www.printables.com/model/713136' }] },
        { id: 'support-mural', nom: 'Support mural pour un livre', categorie: C,
          description: 'Rail mural et crochets pour exposer un livre au mur.', conseil: 'Imprimez le rail et un crochet.',
          variantes: [v('wall-rail', 'rail mural'), v('wall-hook-lite', 'crochet léger'), v('wall-hook-heavy', 'crochet renforcé')],
          credit: { auteur: 'ravi72munde', licence: 'CC BY', source: 'Printables', url: 'https://www.printables.com/model/220245' } },
        { id: 'etiquette-rayon', nom: 'Étiquette de rayon Fiction', categorie: C,
          description: 'Petit panneau à poser sur une tablette.', conseil: 'Le fichier d’origine permet de graver un autre mot.',
          fichier: D + 'shelf-talker-fiction.stl',
          credit: { auteur: 'TheNewHobbyist', licence: 'CC BY-NC', source: 'Thingiverse', url: 'https://www.thingiverse.com/thing:80211' } },
        { id: 'raccord-hexagone', nom: 'Raccord d’étagère hexagonale', categorie: C,
          description: 'Raccords pour monter une étagère à vinyles en nid d’abeille.', conseil: 'Planches non fournies.',
          variantes: [v('hexagon-h', 'horizontal'), v('hexagon-v', 'vertical')],
          credit: { auteur: 'ToniL81', licence: 'CC BY-NC-SA', source: 'Thingiverse', url: 'https://www.thingiverse.com/thing:4899311' } },

        /* modèles plus grands : visibles seulement sur les imprimantes où ils tiennent */
        { id: 'serre-livre-crochet', nom: 'Serre-livre à crochet', categorie: C,
          description: 'S’accroche au bord de la tablette pour tenir une rangée de livres.', conseil: '',
          fichier: D + 'bookend-shelf-hook.stl',
          credit: { auteur: 'seastara', licence: 'CC BY-NC', source: 'Thingiverse', url: 'https://www.thingiverse.com/thing:2161245' } },
        { id: 'serre-livre-leger', nom: 'Serre-livre léger', categorie: C,
          description: 'Serre-livre ajouré, rapide à imprimer.', conseil: '',
          fichier: D + 'medium-lightweight-bookend.stl',
          credit: { auteur: 'MagicSmokeSTAT', licence: 'CC BY-NC-SA', source: 'Thingiverse', url: 'https://www.thingiverse.com/thing:4730051' } },
        { id: 'serre-livre-emboitable', nom: 'Serre-livre emboîtable', categorie: C,
          description: 'Cadre ajouré qui maintient une rangée de livres.', conseil: '',
          fichier: D + 'book-shelf-plug-in.stl',
          credit: { auteur: 'Michael / Bischoff AG', licence: 'CC BY-NC', source: 'Printables', url: 'https://www.printables.com/model/137641' } },
        { id: 'separateur-rayon', nom: 'Séparateur de rayon', categorie: C,
          description: 'Sépare deux rangées ou tient un livre debout.', conseil: '',
          fichier: D + 'shelf-separator.stl',
          credit: { auteur: 'bouddha', licence: 'CC BY', source: 'Thingiverse', url: 'https://www.thingiverse.com/thing:3120347' } },
        { id: 'rehausseur-rayon', nom: 'Rehausseur de fond de rayon', categorie: C,
          description: 'Surélève la rangée du fond pour que les dos des livres restent visibles.', conseil: '',
          fichier: D + 'billy-riser.stl',
          credit: { auteur: 'JWhittaker101', licence: 'CC BY-NC', source: 'MakerWorld', url: 'https://makerworld.com/fr/models/667410' } },
        { id: 'pupitre-livre', nom: 'Pupitre pour livre ouvert', categorie: C,
          description: 'Pupitre incliné pour lire ou présenter un livre ouvert.', conseil: '',
          fichier: D + 'book-stand-6029750.stl',
          credit: { auteur: 'XShocker427X', licence: 'CC BY-NC-SA', source: 'Thingiverse', url: 'https://www.thingiverse.com/thing:6029750' } },
        { id: 'lutrin-lecture', nom: 'Lutrin de lecture', categorie: C,
          description: 'Lutrin en deux plaques croisées.', conseil: '',
          fichier: D + 'book-stand-518600.stl',
          credit: { auteur: 'Richard', licence: 'CC BY', source: 'Printables', url: 'https://www.printables.com/model/518600' } },
        { id: 'presentoir-reglable', nom: 'Présentoir réglable', categorie: C,
          description: 'Présentoir en pièces séparées, pour les grands livres.', conseil: 'Imprimez deux pieds et une traverse.',
          variantes: [v('adjustable-leg', 'pied'), v('adjustable-brace', 'traverse')],
          credit: { auteur: 'DDivs', licence: 'CC BY', source: 'Printables', url: 'https://www.printables.com/model/105553' } },
        { id: 'presentoir-vague', nom: 'Présentoir vague', categorie: C,
          description: 'Paroi ondulée qui présente un livre de face.', conseil: '',
          fichier: D + 'wavey-book-stand.stl',
          credit: { auteur: 'moWerk', licence: 'CC BY-NC-SA', source: 'Thingiverse', url: 'https://www.thingiverse.com/thing:6890678' } },
        { id: 'presentoir-mural', nom: 'Présentoir mural', categorie: C,
          description: 'Rebord à fixer au mur pour exposer un livre de face.', conseil: 'Vis de fixation non fournies.',
          fichier: D + 'wall-display-stand.stl',
          credit: { auteur: 'protohuf', licence: 'CC BY', source: 'Thingiverse', url: 'https://www.thingiverse.com/thing:4847665' } },
        { id: 'etagere-livres-cuisine', nom: 'Étagère pour livres de cuisine', categorie: C,
          description: 'Petite étagère murale pour quelques livres.', conseil: '',
          fichier: D + 'cooking-book-shelf.stl',
          credit: { auteur: 'Hegre Engineering', licence: 'CC BY', source: 'Printables', url: 'https://www.printables.com/model/151464' } },
        { id: 'etagere-ronde', nom: 'Étagère arrondie', categorie: C,
          description: 'Petite étagère aux bords arrondis.', conseil: '',
          fichier: D + 'round-book-shelf.stl',
          credit: { auteur: 'biehler-josef', licence: 'CC0', source: 'Printables', url: 'https://www.printables.com/model/818676' } },
        { id: 'rangement-mangas', nom: 'Rangement mangas modulaire', categorie: C,
          description: 'Cases empilables pour mangas ou petits livres, assemblées par des clips.', conseil: 'Imprimez les modules, puis les clips pour les assembler.',
          variantes: [v('manga-main', 'module'), v('manga-side-clip', 'clip latéral'), v('manga-corner-2', 'clip d’angle, 2 côtés'), v('manga-corner-3', 'clip d’angle, 3 côtés'), v('manga-corner-4', 'clip d’angle, 4 côtés')],
          credit: { auteur: 'Ystvan', licence: 'CC BY', source: 'Printables', url: 'https://www.printables.com/model/813488' } }
      ];
    })()
  ];

  /* centre la pièce sur X/Y et la pose sur le plateau (z = 0) */
  function normaliser(geo) {
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    geo.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z);
    geo.computeBoundingBox();
    geo.computeVertexNormals();
    return geo;
  }

  function construire(entree) {
    const fn = FORMES[entree.forme];
    if (!fn) throw new Error('Forme inconnue : ' + entree.forme);
    return normaliser(fn());
  }

  const api = { CATALOGUE, construire, normaliser };
  global.NevaCatalogue = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
