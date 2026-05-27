#!/usr/bin/env bash
#
# publish-release.sh — bump version + tag + push pour déclencher le
# workflow CI `.github/workflows/release.yml` qui build et publie la
# release GitHub.
#
# Usage :
#   ./publish-release.sh           # x.y.z → x.(y+1).0   (bump central, défaut)
#   ./publish-release.sh --minor   # x.y.z → x.y.(z+1)   (bump du dernier numéro)
#   ./publish-release.sh --major   # x.y.z → (x+1).0.0   (bump majeur, reset)
#
# Prérequis :
#   - branche `main`
#   - working tree clean (rien de modifié, rien de staged)
#   - branche à jour avec `origin/main`
#
# Effets :
#   1. Bump de `package.json` (et `package-lock.json`) via `npm version`.
#   2. Commit `chore(release): v<version>` sur main.
#   3. Push de main vers origin.
#   4. Création du tag `v<version>` et push du tag vers origin.
#   5. Le push du tag déclenche la CI qui build + publie sur GitHub Releases.

set -euo pipefail

# Toujours opérer depuis la racine du repo (le script peut être lancé
# depuis n'importe où).
cd "$(dirname "$0")"

# --- 1. Parse arguments ----------------------------------------------------

bump_type="central"
case "${1:-}" in
  --major) bump_type="major" ;;
  --minor) bump_type="patch" ;;
  '')      bump_type="central" ;;
  *)
    echo "Usage : $0 [--major | --minor]" >&2
    echo "  --major  : x.y.z → (x+1).0.0" >&2
    echo "  --minor  : x.y.z → x.y.(z+1)" >&2
    echo "  (aucun)  : x.y.z → x.(y+1).0" >&2
    exit 1
    ;;
esac

# --- 2. Vérifications préalables -------------------------------------------

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current_branch" != "main" ]; then
  echo "✗ Branche courante : '$current_branch'. Il faut être sur 'main' pour publier." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Working tree non clean. Commit ou stash avant de publier :" >&2
  git status --short >&2
  exit 1
fi

# Synchronise avec origin pour détecter les commits non poussés ou un
# retard sur le remote (sinon le push échoue ou écrase du travail
# distant).
echo "→ Fetch origin..."
git fetch origin main --quiet

local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse origin/main)"
if [ "$local_sha" != "$remote_sha" ]; then
  echo "✗ La branche main locale et origin/main divergent." >&2
  echo "  local  : $local_sha" >&2
  echo "  remote : $remote_sha" >&2
  echo "  Fais un 'git pull --ff-only' (ou 'git push') avant de publier." >&2
  exit 1
fi

# --- 3. Calcule la nouvelle version ----------------------------------------

current_version="$(node -p "require('./package.json').version")"
IFS='.' read -r v_major v_minor v_patch <<<"$current_version"

case "$bump_type" in
  major)   new_version="$((v_major + 1)).0.0" ;;
  central) new_version="$v_major.$((v_minor + 1)).0" ;;
  patch)   new_version="$v_major.$v_minor.$((v_patch + 1))" ;;
esac

tag="v$new_version"

# Vérifie que le tag n'existe pas déjà (localement ou sur origin).
if git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null; then
  echo "✗ Le tag '$tag' existe déjà localement." >&2
  exit 1
fi
if git ls-remote --tags origin "refs/tags/$tag" | grep -q "$tag"; then
  echo "✗ Le tag '$tag' existe déjà sur origin." >&2
  exit 1
fi

echo "Version courante : $current_version"
echo "Nouvelle version : $new_version  (tag : $tag)"
echo ""

# --- 4. Bump du package.json (et package-lock.json) ------------------------

# `npm version` met aussi à jour package-lock.json. `--no-git-tag-version`
# = pas de commit/tag automatique (on les fait nous-mêmes ci-dessous).
echo "→ npm version $new_version --no-git-tag-version"
npm version "$new_version" --no-git-tag-version --allow-same-version >/dev/null

# --- 5. Commit + push de main + tag + push du tag --------------------------

echo "→ git commit"
git add package.json package-lock.json
git commit -m "Release: $tag"

echo "→ git push origin main"
git push origin main

echo "→ git tag $tag"
git tag "$tag"

echo "→ git push origin $tag"
git push origin "$tag"

echo ""
echo "✓ Release $tag poussée."
echo "  Le workflow GitHub Actions va builder et publier l'installeur."
echo "  Suivi : https://github.com/youhou71/WinNotch/actions"
