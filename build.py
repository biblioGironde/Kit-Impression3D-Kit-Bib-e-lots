"""Assemble index.html à partir de src/ (version web et Electron).

  python3 build.py            -> index.html (bibliothèques locales dans vendor/)
"""
import pathlib
d = pathlib.Path(__file__).parent
h = (d / 'src/app.html').read_text(encoding='utf-8')
for k, f in [('SLICER', 'slicer.js'), ('CATALOG', 'catalog.js'), ('APP', 'app.js')]:
    h = h.replace(f'/*@@{k}@@*/', (d / 'src' / f).read_text(encoding='utf-8'))
# bibliothèques servies localement : fonctionne hors ligne (Electron) et sur GitHub Pages
h = (h.replace('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'vendor/three.min.js')
      .replace('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js', 'vendor/OrbitControls.js')
      .replace('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/STLLoader.js', 'vendor/STLLoader.js')
      .replace('https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js', 'vendor/clipper.js'))
page = ('<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '</head>\n<body>\n' + h + '\n</body>\n</html>\n')
(d / 'index.html').write_text(page, encoding='utf-8')
print('index.html :', len(page), 'octets')
