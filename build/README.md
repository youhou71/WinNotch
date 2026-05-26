# Build resources

Ce dossier est consommé par `electron-builder` pour packager l'app.

## Fichiers attendus

### `icon.ico` (obligatoire pour Windows)
Icône multi-résolution **.ico** contenant au minimum les tailles suivantes :

- 16×16
- 24×24
- 32×32
- 48×48
- 64×64
- 128×128
- **256×256** (utilisée par Windows pour les vignettes)

> Place ton fichier ici sous le nom exact `icon.ico`. Il sera utilisé à la fois
> par l'installateur NSIS, l'exécutable bundlé, et le raccourci créé sur le bureau.

### `installerIcon.ico` (optionnel)
Si présent, override l'icône de l'installateur uniquement. Sinon `icon.ico` est utilisé.

### `uninstallerIcon.ico` (optionnel)
Idem pour l'uninstaller.

### `installerHeader.bmp` (optionnel, 150×57)
Image affichée en haut de l'assistant d'installation NSIS (mode "classic").

### `installerSidebar.bmp` (optionnel, 164×314)
Image affichée sur le côté du premier et dernier écran (NSIS modern UI).

## Génération rapide d'une .ico depuis un .png

Avec ImageMagick (PowerShell) :

```powershell
magick convert source.png -define icon:auto-resize=256,128,64,48,32,24,16 build/icon.ico
```

Ou en ligne sur https://realfavicongenerator.net/ → "Generate the Favicons" → télécharger le `.ico`.
