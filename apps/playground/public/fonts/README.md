# Web Skia font assets

These are browser-fetchable production assets for the Web Skia editor. They are
generated locally by `../../scripts/generate-font-assets.sh`; no fixture base64
font data and no network download are used.

## Loader contract

Fetch `/fonts/manifest.json` first. Load the asset whose `tier` is `initial`
before initial text shaping. Load `on-demand` assets only when the document
contains their script or emoji sequence, using each asset's stable `url` field.
Pass the downloaded binary to the editor's font/typeface registration layer;
do not substitute these URLs with data URLs. Future UI code owns shaping
timeouts and retries, which are intentionally outside this asset task.

The current URLs are:

- `/fonts/latin/hamsternote-web-latin-regular.ttf` for initial Latin text.
- `/fonts/cjk/hamsternote-web-cjk-sc-fixed-3500.otf` for the documented CJK
  on-demand tier. The internally selected, stable Unicode list is
  `U+4E00-U+5BAA,U+6587,U+754C`: 3,499 contiguous codepoints plus the explicitly
  appended extras `文` (U+6587) and `界` (U+754C), so it includes `世界文`. The
  extras are concatenated after the range to keep the range semantics stable
  rather than claiming opaque full-CJK coverage. It is not a frequency-ranked
  common-character table and does not cover all CJK.
- `/fonts/arabic/hamsternote-web-arabic-regular.ttf` for Arabic on demand.
- `/fonts/emoji/hamsternote-web-emoji-family.ttf` for `👨‍👩‍👧‍👦` on demand.

## Provenance and license

The source fonts are locally installed Noto packages: Noto Sans, Noto Sans CJK
SC, Noto Naskh Arabic, and Noto Color Emoji. Exact local source paths, source
SHA256 values, subset commands, output SHA256 values, byte lengths, and Unicode
ranges are recorded in `manifest.json` after every generation.

All redistributed subset assets are derivative font software under SIL Open
Font License 1.1 (`OFL-1.1`). The source Noto names are retained only as
provenance; generated primary font names use the `HamsterNote Web` prefix to
avoid using an OFL Reserved Font Name for a modified font.

## Generation and verification

Run `pnpm fonts:generate` from `apps/playground`. It requires local
`pyftsubset`, `python3` with `fontTools`, and the four source font paths shown
in the generated manifest. Override a system-specific source path with
`LATIN_SOURCE`, `CJK_SOURCE`, `ARABIC_SOURCE`, or `EMOJI_SOURCE`.

Run `pnpm fonts:verify` to check that each file is non-empty, readable by
fontTools, has the required shaping/color tables and sample codepoints, and
matches the manifest SHA256. The CJK source installed on this system is a CFF
collection, so its correctly typed output is `.otf`; it is deliberately not
mislabelled as a TrueType `.ttf`.
