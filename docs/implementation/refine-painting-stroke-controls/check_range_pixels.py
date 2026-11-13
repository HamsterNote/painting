"""Check actual zoom slider raster evidence (requires Pillow, no browser mocks)."""
from pathlib import Path
import json
from PIL import Image

evidence = Path(__file__).parent / "evidence"
results = []

def near(pixel, target, tolerance):
    # Include antialiased circle-edge pixels, while excluding the gray track.
    return max(abs(channel - reference) for channel, reference in zip(pixel, target)) <= tolerance

for engine in ("webkit", "chromium"):
    for viewport in (1280, 390, 320):
        path = evidence / f"{engine}-range-{viewport}.png"
        image = Image.open(path).convert("RGB")
        width, height = image.size
        assert height == 44, (path, "hit area", height)
        gray_rows = [y for y in range(height) if image.getpixel((width - 20, y)) == (226, 229, 234)]
        assert len(gray_rows) == 6, (path, "gray track", gray_rows)
        fill_rows = [y for y in range(height) if image.getpixel((5, y)) == (113, 99, 217)]
        assert len(fill_rows) == 6, (path, "purple fill", fill_rows)
        # At 125%, native range thumb centers interpolate between 9px and w-9px.
        center_x = round(9 + (width - 18) * (125 - 25) / (800 - 25))
        purple_rows = [y for y in range(height) if near(image.getpixel((center_x, y)), (113, 99, 217), 20)]
        assert purple_rows, (path, "purple thumb border")
        top, bottom = min(purple_rows), max(purple_rows)
        # Rasterization at a fractional center may shift the outer edge by 1px.
        assert 17 <= bottom - top + 1 <= 19, (path, "18px thumb", top, bottom)
        white_inside = sum(near(image.getpixel((center_x, y)), (255, 255, 255), 15) for y in range(top, bottom + 1))
        assert 13 <= white_inside <= 15, (path, "14px white interior", white_inside)
        assert 3 <= len(purple_rows) <= 5, (path, "2px borders", purple_rows)
        results.append({"image": path.name, "hit_height": height, "track_height": len(gray_rows),
                        "fill_height": len(fill_rows), "thumb_outer_height": bottom - top + 1,
                        "thumb_white_height": white_inside, "purple_border_pixels": len(purple_rows), "passed": True})
print(json.dumps(results, indent=2))
