#!/usr/bin/env bash

# Build a standalone macOS application and, optionally, an installer image.
# This script intentionally uses only tools shipped with macOS and the
# repository's existing Node/Yarn dependencies.

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
SHELL_DIR="$ROOT_DIR/packages/shell"
APP_NAME="damecon-browser"
FORMAT="pkg"
ARCH=""
TMP_DIR=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Build Damecon as a standalone macOS application.

Options:
  --format FORMAT  Output format: app, pkg, dmg, or all (default: pkg)
  --arch ARCH      macOS architecture: arm64 or x64 (default: host arch)
  -h, --help       Show this help without running build checks

Examples:
  $(basename "$0")
  $(basename "$0") --format app --arch arm64
  $(basename "$0") --format all

The app is locally ad-hoc signed for local installation and testing.
The installer is not notarized. Set INSTALLER_SIGN_IDENTITY to sign the product .pkg.
EOF
}

die() {
  printf 'build-mac.sh: error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}

normalize_arch() {
  case "$1" in
    arm64|aarch64)
      ARCH="arm64"
      ;;
    x64|x86_64|amd64)
      ARCH="x64"
      ;;
    *)
      die "unsupported architecture '$1' (use arm64 or x64)"
      ;;
  esac
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --format)
        [ "$#" -ge 2 ] || die "--format requires app, pkg, dmg, or all"
        FORMAT="$2"
        shift 2
        ;;
      --format=*)
        FORMAT=${1#*=}
        shift
        ;;
      --arch)
        [ "$#" -ge 2 ] || die "--arch requires arm64 or x64"
        normalize_arch "$2"
        shift 2
        ;;
      --arch=*)
        normalize_arch "${1#*=}"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown option '$1' (use --help for usage)"
        ;;
    esac
  done

  case "$FORMAT" in
    app|pkg|dmg|all)
      ;;
    *)
      die "unsupported format '$FORMAT' (use app, pkg, dmg, or all)"
      ;;
  esac
}

check_node_version() {
  local version major
  version=$(node -p 'process.versions.node' 2>/dev/null) || die "unable to read Node.js version"
  major=${version%%.*}
  case "$major" in
    ''|*[!0-9]*)
      die "unable to parse Node.js version '$version'"
      ;;
  esac
  if [ "$major" -ne 20 ] && [ "$major" -lt 22 ]; then
    die "Node.js 20 or >=22 is required (found $version)"
  fi
}

check_yarn_version() {
  local version major minor
  version=$(yarn --version 2>/dev/null) || die "unable to read Yarn version"
  major=${version%%.*}
  minor=${version#*.}
  minor=${minor%%.*}
  case "$major:$minor" in
    1:''|1:*[!0-9]*)
      die "unable to parse Yarn version '$version'"
      ;;
    1:*)
      ;;
    *)
      die "Yarn 1.x is required (found $version)"
      ;;
  esac
  if [ "$minor" -lt 10 ]; then
    die "Yarn >=1.10 and <2 is required (found $version)"
  fi
}

check_source_inputs() {
  local path lang_json

  for path in \
    "$ROOT_DIR/packages/kccacheproxy/src/proxy/proxy.js" \
    "$ROOT_DIR/packages/kccacheproxy/src/proxy/mod/gitModHandler.js" \
    "$ROOT_DIR/packages/kccacheproxy/minimum-cache.zip" \
    "$SHELL_DIR/icon.icns" \
    "$SHELL_DIR/browser/ui/assets/js/knockout-i18n.js"; do
    [ -f "$path" ] || die "required source file is missing: $path"
  done
  [ -s "$ROOT_DIR/packages/kccacheproxy/minimum-cache.zip" ] || \
    die "minimum-cache.zip is missing or empty: $ROOT_DIR/packages/kccacheproxy/minimum-cache.zip"

  [ -d "$ROOT_DIR/extensions/kc3kai-release" ] || \
    die "KC3Kai release directory is missing: $ROOT_DIR/extensions/kc3kai-release"

  if [ -f "$ROOT_DIR/extensions/kc3kai-release/manifest.json" ]; then
    :
  elif [ -f "$ROOT_DIR/extensions/kc3kai-release/src/manifest.json" ]; then
    :
  else
    die "KC3Kai release manifest.json is missing (expected release root or src/)"
  fi

  if [ -f "$ROOT_DIR/extensions/kc3kai-release/data/lang/data/en/terms.json" ]; then
    lang_json="$ROOT_DIR/extensions/kc3kai-release/data/lang/data/en/terms.json"
  elif [ -f "$ROOT_DIR/extensions/kc3kai-release/src/data/lang/data/en/terms.json" ]; then
    lang_json="$ROOT_DIR/extensions/kc3kai-release/src/data/lang/data/en/terms.json"
  else
    die "KC3Kai English translation is missing: data/lang/data/en/terms.json"
  fi
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
    "$lang_json" >/dev/null 2>&1 || die "KC3Kai translation is not valid JSON: $lang_json"
}

check_dependencies() {
  [ -d "$ROOT_DIR/node_modules" ] || \
    die "dependencies are not installed; run Yarn 1 install from the repository root"

  if ! node - "$SHELL_DIR/package.json" <<'NODE'
const { createRequire } = require('module')
const requireFromShell = createRequire(process.argv[2])
const cliPackagePath = requireFromShell.resolve('@electron-forge/cli/package.json')
const cliVersion = require(cliPackagePath).version
const cliMajor = Number(cliVersion.split('.')[0])
if (!Number.isInteger(cliMajor) || cliMajor < 7) {
  throw new Error(`Electron Forge CLI 7+ is required (found ${cliVersion})`)
}
requireFromShell.resolve('electron/package.json')
requireFromShell.resolve('@electron/osx-sign/package.json')
NODE
  then
    die "required shell dependencies are not installed; run Yarn 1 install from the repository root"
  fi

  if [ "$FORMAT" = "dmg" ] || [ "$FORMAT" = "all" ]; then
    if ! node - "$SHELL_DIR/package.json" <<'NODE'
const { createRequire } = require('module')
const requireFromShell = createRequire(process.argv[2])
requireFromShell.resolve('@electron-forge/maker-dmg/package.json')
NODE
    then
      die "installed dependency is missing: @electron-forge/maker-dmg"
    fi
  fi
}

check_platform_and_tools() {
  [ "$(uname -s)" = "Darwin" ] || die "macOS is required (uname -s must be Darwin)"

  require_command node
  require_command yarn
  require_command uname
  require_command find
  require_command file
  require_command mktemp
  require_command codesign

  if [ "$FORMAT" = "pkg" ] || [ "$FORMAT" = "all" ]; then
    require_command ditto
    require_command /usr/libexec/PlistBuddy
    require_command pkgbuild
    require_command productbuild
    require_command pkgutil
  fi
  if [ "$FORMAT" = "dmg" ] || [ "$FORMAT" = "all" ]; then
    require_command hdiutil
  fi
}

read_version() {
  VERSION=$(node -e 'console.log(require(process.argv[1]).version)' "$SHELL_DIR/package.json") || \
    die "unable to read version from packages/shell/package.json"
  [ -n "$VERSION" ] || die "packages/shell/package.json has no version"
}

package_app() {
  printf 'Building dependencies...\n'
  yarn --cwd "$ROOT_DIR" build:context-menu
  yarn --cwd "$ROOT_DIR" build:chrome-web-store
  yarn --cwd "$ROOT_DIR" build:extensions

  printf 'Packaging %s for darwin/%s...\n' "$APP_NAME" "$ARCH"
  yarn --cwd "$SHELL_DIR" package --platform darwin --arch "$ARCH"
}

app_path() {
  APP_PATH="$SHELL_DIR/out/${APP_NAME}-darwin-${ARCH}/${APP_NAME}.app"
}

validate_app() {
  local resources extension_dir translation_json executable file_info
  [ -d "$APP_PATH" ] || die "packaged app is missing: $APP_PATH"

  resources="$APP_PATH/Contents/Resources"
  [ -f "$APP_PATH/Contents/Info.plist" ] || die "packaged app Info.plist is missing"
  [ -s "$resources/app.asar" ] || die "packaged app.asar is missing or empty: $resources/app.asar"
  [ -f "$resources/ui/assets/js/knockout-i18n.js" ] || \
    die "packaged UI translation helper is missing: $resources/ui/assets/js/knockout-i18n.js"
  [ -s "$resources/minimum-cache.zip" ] || \
    die "packaged minimum-cache.zip is missing or empty: $resources/minimum-cache.zip"

  extension_dir="$resources/extensions/kc3kai-release"
  if [ ! -f "$extension_dir/manifest.json" ] && [ ! -f "$extension_dir/src/manifest.json" ]; then
    die "packaged KC3Kai manifest.json is missing: $extension_dir"
  fi
  if [ -f "$extension_dir/data/lang/data/en/terms.json" ]; then
    translation_json="$extension_dir/data/lang/data/en/terms.json"
  elif [ -f "$extension_dir/src/data/lang/data/en/terms.json" ]; then
    translation_json="$extension_dir/src/data/lang/data/en/terms.json"
  else
    die "packaged KC3Kai English translation is missing: data/lang/data/en/terms.json"
  fi
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
    "$translation_json" >/dev/null 2>&1 || die "packaged KC3Kai translation is not valid JSON: $translation_json"

  executable="$APP_PATH/Contents/MacOS/$APP_NAME"
  [ -x "$executable" ] || die "packaged app executable is missing: $executable"
  file_info=$(file "$executable")
  case "$ARCH:$file_info" in
    arm64:*arm64*)
      ;;
    x64:*x86_64*)
      ;;
    *)
      die "packaged executable architecture does not match darwin/$ARCH: $file_info"
      ;;
  esac

  printf 'Validated app: %s\n' "$APP_PATH"
  printf '  executable: %s\n' "$file_info"
  printf '  resources: app.asar, ui, minimum-cache.zip, KC3Kai translations\n'
}

sign_app() {
  # osx-sign walks nested helpers/frameworks deepest-first and applies its
  # Electron-specific entitlements. Ad-hoc signing needs no timestamp or
  # hardened runtime, and identity validation must be disabled for identity '-'.
  if ! node - "$APP_PATH" "$SHELL_DIR/package.json" <<'NODE'
const { createRequire } = require('module')
const requireFromShell = createRequire(process.argv[3])
const { signAsync } = requireFromShell('@electron/osx-sign')
const app = process.argv[2]
signAsync({
  app,
  platform: 'darwin',
  identity: '-',
  identityValidation: false,
  preAutoEntitlements: false,
  preEmbedProvisioningProfile: false,
  strictVerify: true,
  optionsForFile: () => ({
    hardenedRuntime: false,
    timestamp: 'none',
  }),
})
  .then(() => console.log(`Ad-hoc signed app: ${app}`))
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exit(1)
  })
NODE
  then
    die "ad-hoc app signing failed: $APP_PATH"
  fi

  codesign --verify --deep --strict "$APP_PATH" || \
    die "ad-hoc app signature verification failed: $APP_PATH"
}

make_pkg() {
  local plist bundle_id component_plist staging_dir staged_app component_pkg pkg_path
  plist="$APP_PATH/Contents/Info.plist"
  bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist" 2>/dev/null || true)
  [ -n "$bundle_id" ] || die "CFBundleIdentifier is missing from $plist"

  TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/damecon-browser-pkg.XXXXXX") || \
    die "unable to create temporary package staging directory"
  trap cleanup EXIT HUP INT TERM

  staging_dir="$TMP_DIR/staging"
  staged_app="$staging_dir/$APP_NAME.app"
  component_plist="$TMP_DIR/components.plist"
  component_pkg="$TMP_DIR/$APP_NAME-component.pkg"
  pkg_path="$SHELL_DIR/out/make/pkg/$ARCH/$APP_NAME-$VERSION-$ARCH.pkg"

  mkdir -p "$staging_dir"
  ditto "$APP_PATH" "$staged_app"
  mkdir -p "$(dirname "$pkg_path")"

  # A root package plus a component property list makes /Applications the
  # fixed destination and disables Installer's bundle relocation behavior.
  cat >"$component_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
  <dict>
    <key>RootRelativeBundlePath</key>
    <string>$APP_NAME.app</string>
    <key>BundleIsRelocatable</key>
    <false/>
    <key>BundleIsVersionChecked</key>
    <false/>
    <key>BundleHasStrictIdentifier</key>
    <true/>
    <key>BundleOverwriteAction</key>
    <string>upgrade</string>
  </dict>
</array>
</plist>
EOF

  pkgbuild \
    --identifier "$bundle_id" \
    --version "$VERSION" \
    --root "$staging_dir" \
    --component-plist "$component_plist" \
    --install-location /Applications \
    "$component_pkg"

  if [ -n "${INSTALLER_SIGN_IDENTITY:-}" ]; then
    productbuild \
      --identifier "$bundle_id" \
      --version "$VERSION" \
      --sign "$INSTALLER_SIGN_IDENTITY" \
      --package "$component_pkg" \
      "$pkg_path"
  else
    productbuild \
      --identifier "$bundle_id" \
      --version "$VERSION" \
      --package "$component_pkg" \
      "$pkg_path"
  fi

  [ -f "$pkg_path" ] || die "productbuild did not produce: $pkg_path"
  if [ -n "${INSTALLER_SIGN_IDENTITY:-}" ]; then
    printf 'Created signed installer package (not notarized): %s\n' "$pkg_path"
  else
    printf 'Created unsigned installer package (not notarized): %s\n' "$pkg_path"
  fi
  if [ -n "${INSTALLER_SIGN_IDENTITY:-}" ]; then
    printf '  product signed with INSTALLER_SIGN_IDENTITY=%s\n' "$INSTALLER_SIGN_IDENTITY"
  fi

  local payload_files
  payload_files=$(pkgutil --payload-files "$component_pkg" 2>/dev/null || true)
  case "$payload_files" in
    *"$APP_NAME.app"*)
      ;;
    *)
      die "pkg payload does not contain $APP_NAME.app"
      ;;
  esac
  printf 'Validated pkg payload: %s\n' "$pkg_path"
}

make_dmg() {
  local dmg_path dmg_marker rc
  dmg_marker=$(mktemp "${TMPDIR:-/tmp}/damecon-browser-dmg.XXXXXX") || \
    die "unable to create DMG output marker"
  if yarn --cwd "$SHELL_DIR" make \
      --skip-package \
      --platform darwin \
      --arch "$ARCH" \
      --targets @electron-forge/maker-dmg; then
    :
  else
    rc=$?
    rm -f "$dmg_marker"
    return "$rc"
  fi

  dmg_path="$SHELL_DIR/out/make/$APP_NAME-$VERSION-$ARCH.dmg"
  if [ ! -f "$dmg_path" ] || [ ! "$dmg_path" -nt "$dmg_marker" ]; then
    rm -f "$dmg_marker"
    die "maker-dmg did not produce a new DMG: $dmg_path"
  fi
  rm -f "$dmg_marker"

  hdiutil verify "$dmg_path" >/dev/null
  printf 'Created disk image: %s\n' "$dmg_path"
}

main() {
  parse_args "$@"

  if [ -z "$ARCH" ]; then
    normalize_arch "$(uname -m)"
  fi

  check_platform_and_tools
  check_node_version
  check_yarn_version
  check_dependencies
  check_source_inputs
  read_version
  package_app
  app_path
  validate_app
  sign_app

  case "$FORMAT" in
    app)
      printf 'Standalone app: %s\n' "$APP_PATH"
      ;;
    pkg)
      make_pkg
      ;;
    dmg)
      make_dmg
      ;;
    all)
      make_pkg
      make_dmg
      ;;
  esac

  printf 'Build complete.\n'
}

main "$@"
