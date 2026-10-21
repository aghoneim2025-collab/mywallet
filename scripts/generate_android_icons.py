"""
Generate launcher icons for the Android app
"""
from PIL import Image, ImageDraw
import os

OUT_DIR = "/home/z/my-project/android/app/src/main/res"
ICON_SIZES = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

BLUE_DARK = hex_to_rgb("#1D4ED8")
BLUE_LIGHT = hex_to_rgb("#3B82F6")
WHITE = (255, 255, 255)

def make_gradient(size, top_color, bottom_color):
    img = Image.new("RGB", (size, size), top_color)
    draw = ImageDraw.Draw(img)
    for y in range(size):
        ratio = y / size
        r = int(top_color[0] + (bottom_color[0] - top_color[0]) * ratio)
        g = int(top_color[1] + (bottom_color[1] - top_color[1]) * ratio)
        b = int(top_color[2] + (bottom_color[2] - top_color[2]) * ratio)
        draw.line([(0, y), (size, y)], fill=(r, g, b))
    return img

def draw_wallet(draw, size):
    cx, cy = size // 2, size // 2
    w = int(size * 0.55)
    h = int(size * 0.45)
    x0 = cx - w // 2
    y0 = cy - h // 2 + int(size * 0.05)
    x1 = cx + w // 2
    y1 = cy + h // 2 + int(size * 0.05)
    radius = int(size * 0.06)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=WHITE)
    flap_h = int(size * 0.12)
    flap_y0 = y0 - flap_h + int(size * 0.03)
    draw.rounded_rectangle([x0, flap_y0, x1, y0 + radius], radius=radius, fill=WHITE)
    btn_r = int(size * 0.05)
    btn_x = x1 - int(size * 0.1)
    btn_y = cy + int(size * 0.05)
    draw.ellipse([btn_x - btn_r, btn_y - btn_r, btn_x + btn_r, btn_y + btn_r], fill=BLUE_DARK)

def generate(size, filepath, is_round=False):
    img = make_gradient(size, BLUE_LIGHT, BLUE_DARK)
    draw = ImageDraw.Draw(img, "RGBA")
    if is_round:
        # mask to circle for round icon
        mask = Image.new("L", (size, size), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.ellipse([0, 0, size, size], fill=255)
        img.putalpha(mask)
    draw_wallet(draw, size)
    img.save(filepath, "PNG", optimize=True)
    print(f"✓ {filepath} ({size}x{size})")

if __name__ == "__main__":
    for folder, size in ICON_SIZES.items():
        path = os.path.join(OUT_DIR, folder)
        os.makedirs(path, exist_ok=True)
        generate(size, os.path.join(path, "ic_launcher.png"), is_round=False)
        generate(size, os.path.join(path, "ic_launcher_round.png"), is_round=True)

    # splash icon - 192x192 transparent
    splash_dir = os.path.join(OUT_DIR, "drawable")
    os.makedirs(splash_dir, exist_ok=True)

    # Foreground splash icon (white wallet on transparent)
    splash_size = 192
    splash = Image.new("RGBA", (splash_size, splash_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(splash, "RGBA")
    draw_wallet(draw, splash_size)
    splash.save(os.path.join(splash_dir, "ic_splash.png"), "PNG", optimize=True)
    print(f"✓ ic_splash.png ({splash_size}x{splash_size})")

    print("✅ All Android icons generated!")
