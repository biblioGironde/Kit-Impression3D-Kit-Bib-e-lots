# Kit bib-e-lots - Atelier Impression 3D

![Écran d’accueil : choix de l’imprimante, Dagoma Neva ou Anycubic Vyper](docs/accueil.png)

![Choix des modèles « Objets en Bib » placés automatiquement sur le plateau de la Vyper](docs/capture.png)

Application web pour imprimer en 3D sans connaître le slicing, sur **Dagoma Neva**, **Anycubic Vyper** ou **Ultimaker S7**.
Au lancement, l'usager touche l'imprimante posée devant lui ; l'atelier s'adapte à son plateau et à son mode d'emploi.
Tout se passe dans le navigateur, sans serveur.

Le parcours se fait en quatre étapes :

1. **Choix des modèles** dans un catalogue classé, avec un aperçu 3D.
2. **Aperçu du plateau**. Le placement est automatique sur le plateau rond Ø 180 mm. L'écran affiche aussi la durée, le poids et le coût du filament, et propose trois qualités : Rapide, Équilibré ou Fin.
3. **Mode d'envoi** : câble USB ou carte SD.
4. **Guide illustré pas à pas** pour le mode choisi.

## Télécharger l'application

Les versions de bureau sont dans les [Releases](https://github.com/biblioGironde/Kit-Impression3D-Atelier-Dagoma-Neva/releases) :

| Système | Fichier |
|---|---|
| macOS (Apple Silicon M1–M4) | `Atelier-Impression3D-…-mac-arm64.dmg` |
| macOS (Intel) | `Atelier-Impression3D-…-mac-x64.dmg` |
| Windows | `Atelier-Impression3D-…-windows-installation.exe` (installeur) ou `…-windows-portable.exe` (sans installation) |
| Linux | `Atelier-Impression3D-…-linux-x86_64.AppImage` ou `.tar.gz` |

L'application de bureau fonctionne **hors ligne** et propose toujours le **câble USB**, quel que soit le navigateur installé.

Les applications ne sont pas signées :

- **macOS** : au premier lancement, clic droit sur l'application → **Ouvrir**, puis confirmer. Si macOS indique que l'application est « endommagée », lancer dans le Terminal : `xattr -cr "/Applications/Atelier Impression 3D.app"`.
- **Windows** : si SmartScreen s'affiche, cliquer sur **Informations complémentaires** → **Exécuter quand même**.
- **Linux** : rendre l'AppImage exécutable (`chmod +x Atelier-Impression3D-*.AppImage`).

## Version web

Le dossier se publie tel quel sur GitHub Pages (Settings → Pages → branche `main`, dossier racine). La page utile est `index.html`.

- **Mode USB** dans la version web : Web Serial API, donc Chrome ou Edge sur ordinateur, page servie en HTTPS.
- **Mode SD** : télécharge directement `dagoma0.g`.

## Ajouter vos modèles

Le code source est dans `src/`. Après une modification, régénérer `index.html` :

```
python3 build.py
```

Dans `src/catalog.js`, ajoutez une entrée au tableau `CATALOGUE` :

```js
{ id: 'hibou', nom: 'Hibou', categorie: 'Déco', fichier: 'modeles/hibou.stl',
  description: 'Un petit hibou de 6 cm.', conseil: 'Sans support.',
  credit: { auteur: 'Nom', licence: 'CC BY', source: 'Printables', url: 'https://…' } },
```

Pour un objet en plusieurs tailles, utilisez `variantes: [{ id, label, fichier }, …]` à la place de `fichier`.
Les fichiers STL doivent être en millimètres, posés à plat, Z vers le haut.

Pour tester un STL sans modifier le code : **Réglages animateur → Tester un fichier STL**.

## Imprimantes prises en charge

| | Dagoma Neva | Anycubic Vyper | Ultimaker S7 |
|---|---|---|---|
| Type | delta | cartésienne | cartésienne (boîtier fermé) |
| Plateau | rond Ø 180 mm | 245 × 245 mm, chauffant | 330 × 240 mm, chauffant |
| Hauteur utile retenue | 190 mm | 250 mm | 290 mm |
| Filament | 1,75 mm | 1,75 mm | **2,85 mm** |
| Envoi | carte SD ou câble USB | carte SD ou câble USB | clé USB uniquement |
| Lancement | un appui sur le bouton | écran tactile | écran tactile |
| Fichier | `dagoma0.g` | `atelier.gcode` | `atelier.gcode` (G-code Griffin) |

Pour changer d'imprimante en cours de séance : cliquer sur **Changer**, à côté du nom de l'imprimante dans l'en-tête. L'écran d'accueil se rouvre (bouton « Retour à l'atelier » ou touche Échap pour annuler).

Les profils sont dans `src/slicer.js` (`PROFILES`). Les réglages animateur sont enregistrés séparément pour chaque imprimante.

Pour remplacer les dessins de l'écran d'accueil par des photos de vos machines, ajoutez des images détourées sur fond transparent :
`imprimantes/neva.png`, `imprimantes/vyper.png` et `imprimantes/s7.png`. Elles sont utilisées automatiquement si elles existent.

## Points à valider sur l'Anycubic Vyper

Le profil Vyper n'a pas encore été testé sur la machine. Vérifiez ces valeurs avant d'ouvrir l'outil au public :

| Réglage | Valeur actuelle | Où le changer |
|---|---|---|
| G-code de démarrage | chauffe plateau + buse, `G28`, `M420 S1` (nivellement enregistré), ligne de purge | Réglages animateur : collez l'en-tête d'un fichier produit par Cura avec le profil Vyper |
| Rétraction | 2 mm à 35 mm/s | `PROFILES.vyper.retract` dans `src/slicer.js` |
| Vitesse du port USB | 115200 bauds | Réglages animateur |
| Températures PLA | buse 205 °C, plateau 60 °C | Réglages animateur |
| Étapes sur l'écran tactile | « Imprimer » → choix du fichier → confirmer | texte du guide dans `src/app.js` |

## Points à valider sur l'Ultimaker S7

Le G-code S7 suit le format décrit par Anson Liu pour son profil PrusaSlicer des Ultimaker S3/S5/S7
([source](https://ansonliu.com/2024/04/ultimaker-s3-s5-s7-prusaslicer-profile/)) :

- en-tête Griffin complet (`;START_OF_HEADER` … `;END_OF_HEADER`) avec durée, volume de matériau, emprise, `MATERIAL.GUID`, `BUILD_VOLUME.TEMPERATURE` et `SLICE_UUID` ;
- version du générateur en trois nombres (`2.1.1`) ;
- démarrage avec `G280 S1` (origine et nivellement ; `G28`/`G29` ne sont pas reconnus), puis une ligne d'amorçage à l'avant du plateau ;
- fichier en ASCII pur (sans accents), extension `.gcode`, sur clé USB.

Le profil n'a pas encore été testé sur la machine :

| Réglage | Valeur actuelle | Où le changer |
|---|---|---|
| Matériau | identifiant repris du profil d'Anson Liu ; selon lui, il n'influence pas l'impression. L'imprimante peut demander de confirmer le PLA chargé | `PROFILES.s7.materialGuid` dans `src/slicer.js` |
| Ligne d'amorçage | de X10 à X290 à 6 mm du bord avant, 14 mm de filament | Réglages animateur (G-code de démarrage) |
| Origine des coordonnées | coin avant gauche, plateau 330 × 240 mm | `PROFILES.s7.origin` |
| Rétraction | 6,5 mm à 25 mm/s | `PROFILES.s7.retract` |
| Températures PLA | buse 210 °C, plateau 60 °C | Réglages animateur |

## Points à valider sur votre Neva

Les valeurs ci-dessous sont des hypothèses raisonnables. Vérifiez-les avant d'ouvrir l'outil au public.

| Réglage | Valeur actuelle | Où le changer |
|---|---|---|
| Nom du fichier SD lu au bouton | `dagoma0.g` | Réglages animateur |
| G-code de démarrage (G28, G29…) | générique Marlin | Réglages animateur : collez l'en-tête d'un fichier Cura by Dagoma |
| Vitesse du port USB | 250000 bauds | Réglages animateur |
| Température PLA | 210 °C | Réglages animateur |
| Rétraction (Bowden) | 3,5 mm à 40 mm/s | `MACHINE.retract` dans le code |
| Zone utile du plateau | rayon 84 mm (marge de 6 mm pour la jupe) | `MACHINE.partRadius` |

Le moyen le plus sûr de régler la machine : trancher un petit modèle avec Cura by Dagoma, puis copier le début du fichier `.g` obtenu (jusqu'à `;LAYER:0`) dans le champ « G-code de démarrage ».

## Limites du moteur de découpe

Le moteur intégré produit des parois, des dessus et dessous pleins, un remplissage en lignes croisées et une jupe. Il ne génère **pas de supports**. Choisissez donc pour le catalogue des modèles imprimables sans support, avec des surplombs de 45° au maximum.

Les durées sont estimées à partir des vitesses programmées. L'écart réel est de l'ordre de 10 à 20 %.

## Catégorie « Objets en Bib »

26 objets pour la bibliothèque (présentoirs, serre-livres, rehausseurs, étagères, rangement mangas, signalétique), soit 59 fichiers STL dans `modeles/objets-en-bib/`.
Beaucoup existent en plusieurs tailles ou pièces : on les choisit sur la fiche du modèle.

**Le catalogue s'adapte à l'imprimante choisie** : les objets et les tailles qui ne tiennent pas sur son plateau sont masqués, avec une phrase qui indique combien le sont.
Sur la Neva (Ø 180 mm), 15 objets sont visibles (dont 3 dans certaines tailles seulement) ; sur la Vyper et la S7, les 26.

En tête de la catégorie, le bouton **Voir des photos des objets** ouvre `modeles/objets-en-bib/Objets-en-Bib-catalogue.pdf` : une photo d'usage par objet, avec les imprimantes compatibles.

Tous sont sous licence Creative Commons. L'auteur, la licence et le lien source s'affichent sur chaque fiche ; le détail est dans `modeles/objets-en-bib/CREDITS.md`.
Non intégrés :
- les modèles MakerWorld sous « Standard Digital File License » ou « MakerWorld Exclusive License » : leur licence interdit de redistribuer les fichiers ;
- le présentoir en kit 312025 (une pièce ne s'imprime que debout sur une arête fine) et le serre-livre hibou (maillage trop lourd pour le navigateur).

## Construire l'application de bureau

```
npm install
npm start            # lancer en développement
npm run dist:linux   # ou dist:mac / dist:win
```

Pour publier une nouvelle version : changer `version` dans `package.json` et pousser sur `main`.
Le workflow GitHub Actions construit macOS, Windows et Linux et crée la release `v<version>`.

## Organisation du dépôt

| Dossier | Contenu |
|---|---|
| `index.html` | application web complète (générée par `build.py`) |
| `src/` | sources : interface, moteur de découpe, catalogue |
| `modeles/objets-en-bib/` | fichiers STL et `CREDITS.md` |
| `vendor/` | three.js r128 (licence MIT) et Clipper 6.4.2 (licence Boost) |
| `electron/` | application de bureau |
| `.github/workflows/` | construction des releases |
