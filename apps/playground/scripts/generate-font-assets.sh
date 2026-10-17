#!/usr/bin/env bash
# Generates browser-fetchable Noto subsets from local system font paths only.
set -euo pipefail

readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
readonly APP_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
readonly FONT_DIR="$APP_DIR/public/fonts"
readonly MANIFEST="$FONT_DIR/manifest.json"
readonly PYFTSUBSET="${PYFTSUBSET:-pyftsubset}"
readonly PYTHON="${PYTHON:-python3}"

readonly LATIN_SOURCE="${LATIN_SOURCE:-/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf}"
readonly CJK_SOURCE="${CJK_SOURCE:-/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc}"
readonly ARABIC_SOURCE="${ARABIC_SOURCE:-/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf}"
readonly EMOJI_SOURCE="${EMOJI_SOURCE:-/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf}"

readonly LATIN_OUTPUT="$FONT_DIR/latin/hamsternote-web-latin-regular.ttf"
readonly CJK_OUTPUT="$FONT_DIR/cjk/hamsternote-web-cjk-sc-fixed-3500.otf"
readonly ARABIC_OUTPUT="$FONT_DIR/arabic/hamsternote-web-arabic-regular.ttf"
readonly EMOJI_OUTPUT="$FONT_DIR/emoji/hamsternote-web-emoji-family.ttf"

readonly LATIN_UNICODES='U+0000-00FF,U+0100-024F,U+0259,U+1E00-1EFF,U+0300-036F,U+2000-206F,U+20AC,U+2122'
# Fixed and deterministic on-demand tier: the contiguous range U+4E00-U+5BAA
# (3,499 codepoints) plus explicitly appended extra codepoints U+6587 (文) and
# U+754C (界). Extras are concatenated after the range so the range semantics
# stay stable instead of becoming an opaque "all CJK" claim.
# It intentionally does not claim to be a frequency-ranked or complete CJK set.
readonly CJK_UNICODES='U+4E00-5BAA,U+6587,U+754C'
readonly ARABIC_UNICODES='U+0000-00FF,U+0300-036F,U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200D,U+2010-2015,U+2018-201F,U+2026'
readonly EMOJI_TEXT='👨‍👩‍👧‍👦'

fail() {
  printf 'font asset generation failed: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

require_file() {
  [ -s "$1" ] || fail "required source font is missing or empty: $1"
}

rename_font() {
  "$PYTHON" - "$1" "$2" "$3" <<'PY'
import sys
from fontTools.ttLib import TTFont

path, family, postscript_name = sys.argv[1:]
# Keep the source 'modified' timestamp instead of stamping the current time so
# repeated runs on the same toolchain reproduce identical bytes and SHA256.
font = TTFont(path, recalcTimestamp=False)
# These are derivative subsets. Do not expose an OFL source font name as primary.
font['name'].names = [
    record for record in font['name'].names
    if record.nameID not in {1, 2, 3, 4, 6, 16, 17}
]
for platform_id, encoding_id, language_id in ((3, 1, 0x0409), (1, 0, 0)):
    font['name'].setName(family, 1, platform_id, encoding_id, language_id)
    font['name'].setName('Regular', 2, platform_id, encoding_id, language_id)
    font['name'].setName(f'{family}; 1.0', 3, platform_id, encoding_id, language_id)
    font['name'].setName(family, 4, platform_id, encoding_id, language_id)
    font['name'].setName(postscript_name, 6, platform_id, encoding_id, language_id)
    font['name'].setName(family, 16, platform_id, encoding_id, language_id)
    font['name'].setName('Regular', 17, platform_id, encoding_id, language_id)
if 'CFF ' in font:
    cff = font['CFF '].cff
    cff.fontNames[0] = postscript_name.encode('ascii')
    top_dict = cff.topDictIndex[0]
    top_dict.FamilyName = family
    top_dict.FullName = family
    top_dict.FontName = postscript_name
font.save(path)
PY
}

verify_assets() {
  "$PYTHON" - "$FONT_DIR" "$MANIFEST" <<'PY'
import hashlib
import json
import sys
from pathlib import Path
from fontTools.ttLib import TTFont

font_dir = Path(sys.argv[1])
manifest_path = Path(sys.argv[2])
if not manifest_path.is_file():
    raise SystemExit(f'manifest is missing: {manifest_path}')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
checks = {
    'latin': ('Cafe\u0301', {'cmap', 'glyf', 'GSUB', 'GPOS'}),
    'cjk-on-demand': ('世界文', {'cmap', 'CFF ', 'GSUB', 'GPOS'}),
    'arabic-on-demand': ('مرحبا', {'cmap', 'glyf', 'GSUB', 'GPOS'}),
    'emoji-on-demand': ('👨\u200d👩\u200d👧\u200d👦', {'cmap', 'CBDT', 'CBLC', 'GSUB'}),
}
def has_emoji_family_ligature(font, cmap):
    starter = cmap[0x1F468]
    components = [
        cmap[0x200D], cmap[0x1F469], cmap[0x200D], cmap[0x1F467],
        cmap[0x200D], cmap[0x1F466],
    ]
    for lookup in font['GSUB'].table.LookupList.Lookup:
        if lookup.LookupType != 4:
            continue
        for subtable in lookup.SubTable:
            for ligature in subtable.ligatures.get(starter, []):
                if ligature.Component == components:
                    return True
    return False
for asset in manifest['assets']:
    path = font_dir.parent / asset['url'].lstrip('/')
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f'asset is missing or empty: {path}')
    if hashlib.sha256(path.read_bytes()).hexdigest() != asset['sha256']:
        raise SystemExit(f'SHA256 mismatch for {asset["id"]}')
    font = TTFont(path, lazy=True)
    sample, required_tables = checks[asset['id']]
    missing_tables = required_tables.difference(font.keys())
    if missing_tables:
        raise SystemExit(f'{asset["id"]} is missing tables: {sorted(missing_tables)}')
    cmap = font.getBestCmap()
    missing = [f'U+{ord(char):04X}' for char in sample if ord(char) not in cmap]
    if missing:
        raise SystemExit(f'{asset["id"]} is missing sample codepoints: {missing}')
    families = {record.toUnicode() for record in font['name'].names if record.nameID in {1, 16}}
    if families != {asset['family']}:
        raise SystemExit(f'{asset["id"]} exposes unexpected primary families: {sorted(families)}')
    if asset['id'] == 'emoji-on-demand' and not has_emoji_family_ligature(font, cmap):
        raise SystemExit('emoji-on-demand is missing the 👨‍👩‍👧‍👦 GSUB ligature')
    font.close()
print(f'font assets verified: {len(manifest["assets"])} files, readable tables, samples, SHA256')
PY
}

if [ "${1:-}" = '--verify' ]; then
  require_command "$PYTHON"
  verify_assets
  exit 0
fi
[ -z "${1:-}" ] || fail "unknown argument: $1 (supported: --verify)"

require_command "$PYFTSUBSET"
require_command "$PYTHON"
require_file "$LATIN_SOURCE"
require_file "$CJK_SOURCE"
require_file "$ARABIC_SOURCE"
require_file "$EMOJI_SOURCE"
mkdir -p "$(dirname -- "$LATIN_OUTPUT")" "$(dirname -- "$CJK_OUTPUT")" "$(dirname -- "$ARABIC_OUTPUT")" "$(dirname -- "$EMOJI_OUTPUT")"

"$PYFTSUBSET" "$LATIN_SOURCE" --unicodes="$LATIN_UNICODES" --layout-features='*' --no-hinting --output-file="$LATIN_OUTPUT"
rename_font "$LATIN_OUTPUT" 'HamsterNote Web Latin' 'HamsterNoteWebLatin-Regular'

# The locally installed SC face is index 2 in its CFF font collection.
"$PYFTSUBSET" "$CJK_SOURCE" --font-number=2 --unicodes="$CJK_UNICODES" --layout-features='*' --no-hinting --output-file="$CJK_OUTPUT"
rename_font "$CJK_OUTPUT" 'HamsterNote Web CJK SC Fixed 3500' 'HamsterNoteWebCJKSCFixed3500-Regular'

"$PYFTSUBSET" "$ARABIC_SOURCE" --unicodes="$ARABIC_UNICODES" --layout-features='*' --no-hinting --output-file="$ARABIC_OUTPUT"
rename_font "$ARABIC_OUTPUT" 'HamsterNote Web Arabic' 'HamsterNoteWebArabic-Regular'

# The family sequence is a GSUB ZWJ substitution, so retain all layout tables.
"$PYFTSUBSET" "$EMOJI_SOURCE" --text="$EMOJI_TEXT" --layout-features='*' --no-hinting --output-file="$EMOJI_OUTPUT"
rename_font "$EMOJI_OUTPUT" 'HamsterNote Web Emoji Family' 'HamsterNoteWebEmojiFamily-Regular'

"$PYTHON" - "$FONT_DIR" "$MANIFEST" "$LATIN_SOURCE" "$CJK_SOURCE" "$ARABIC_SOURCE" "$EMOJI_SOURCE" "$LATIN_UNICODES" "$CJK_UNICODES" "$ARABIC_UNICODES" "$EMOJI_TEXT" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

font_dir = Path(sys.argv[1])
manifest_path = Path(sys.argv[2])
sources = dict(zip(('latin', 'cjk', 'arabic', 'emoji'), sys.argv[3:7]))
latin_unicodes, cjk_unicodes, arabic_unicodes, emoji_text = sys.argv[7:]
def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
assets = [
    {'id': 'latin', 'tier': 'initial', 'url': '/fonts/latin/hamsternote-web-latin-regular.ttf', 'format': 'ttf', 'family': 'HamsterNote Web Latin', 'source': {'path': sources['latin'], 'sha256': sha256(sources['latin']), 'upstream': 'https://github.com/notofonts/noto-fonts'}, 'unicodeRanges': latin_unicodes, 'sample': 'Cafe\u0301', 'command': f'pyftsubset {sources["latin"]} --unicodes={latin_unicodes} --layout-features=* --no-hinting'},
    {'id': 'cjk-on-demand', 'tier': 'on-demand', 'url': '/fonts/cjk/hamsternote-web-cjk-sc-fixed-3500.otf', 'format': 'otf-cff', 'family': 'HamsterNote Web CJK SC Fixed 3500', 'source': {'path': sources['cjk'], 'sha256': sha256(sources['cjk']), 'upstream': 'https://github.com/notofonts/noto-cjk', 'fontNumber': 2}, 'unicodeRanges': cjk_unicodes, 'listSource': 'Internal fixed Unicode selection declared as CJK_UNICODES in apps/playground/scripts/generate-font-assets.sh.', 'selection': 'Fixed deterministic tier: contiguous U+4E00-U+5BAA (3,499 codepoints) plus explicitly appended extras U+6587 (文) and U+754C (界), for 3,501 codepoints total. Extras are concatenated after the range so the range semantics stay stable rather than becoming an opaque full-CJK claim. It provides a reproducible bootstrap tier and required sample coverage; it is not frequency-ranked and not all CJK coverage.', 'sample': '世界文', 'command': f'pyftsubset {sources["cjk"]} --font-number=2 --unicodes={cjk_unicodes} --layout-features=* --no-hinting'},
    {'id': 'arabic-on-demand', 'tier': 'on-demand', 'url': '/fonts/arabic/hamsternote-web-arabic-regular.ttf', 'format': 'ttf', 'family': 'HamsterNote Web Arabic', 'source': {'path': sources['arabic'], 'sha256': sha256(sources['arabic']), 'upstream': 'https://github.com/notofonts/arabic'}, 'unicodeRanges': arabic_unicodes, 'sample': 'مرحبا', 'command': f'pyftsubset {sources["arabic"]} --unicodes={arabic_unicodes} --layout-features=* --no-hinting'},
    {'id': 'emoji-on-demand', 'tier': 'on-demand', 'url': '/fonts/emoji/hamsternote-web-emoji-family.ttf', 'format': 'ttf-color', 'family': 'HamsterNote Web Emoji Family', 'source': {'path': sources['emoji'], 'sha256': sha256(sources['emoji']), 'upstream': 'https://github.com/googlefonts/noto-emoji'}, 'unicodeRanges': 'U+1F466,U+1F467,U+1F468,U+1F469,U+200D', 'sample': emoji_text, 'command': f'pyftsubset {sources["emoji"]} --text={emoji_text} --layout-features=* --no-hinting'},
]
for asset in assets:
    path = font_dir.parent / asset['url'].lstrip('/')
    asset['bytes'] = path.stat().st_size
    asset['sha256'] = sha256(path)
manifest = {'schemaVersion': 1, 'license': {'spdx': 'OFL-1.1', 'file': '/fonts/OFL-1.1.txt', 'notice': 'Subsetted Noto font derivatives. See README.md and OFL-1.1.txt.'}, 'assets': assets}
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY

verify_assets
