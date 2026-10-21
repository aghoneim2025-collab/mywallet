"""
Generate PWA icons for MyWallet app
Creates icon-192.png and icon-512.png with a gradient background
and a wallet symbol.
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT_DIR = "/home/z/my-project/public/icons"
os.makedirs(OUT_DIR, exist_ok=True)

def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

# Colors
BLUE_DARK = hex_to_rgb("#1D4ED8")
BLUE_LIGHT = hex_to_rgb("#3B82F6")
WHITE = (255, 255, 255)

def make_gradient(size, top_color, bottom_color):
    """Create a vertical gradient image."""
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
    """Draw a simple wallet icon in the center."""
    cx, cy = size // 2, size // 2
    w = int(size * 0.55)
    h = int(size * 0.45)
    x0 = cx - w // 2
    y0 = cy - h // 2 + int(size * 0.05)
    x1 = cx + w // 2
    y1 = cy + h // 2 + int(size * 0.05)
    # rounded rectangle for wallet body
    radius = int(size * 0.06)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=WHITE)
    # wallet flap (top)
    flap_h = int(size * 0.12)
    flap_y0 = y0 - flap_h + int(size * 0.03)
    draw.rounded_rectangle([x0, flap_y0, x1, y0 + radius], radius=radius, fill=WHITE)
    # button (small circle)
    btn_r = int(size * 0.05)
    btn_x = x1 - int(size * 0.1)
    btn_y = cy + int(size * 0.05)
    draw.ellipse([btn_x - btn_r, btn_y - btn_r, btn_x + btn_r, btn_y + btn_r], fill=BLUE_DARK)

def generate(size, filename):
    img = make_gradient(size, BLUE_LIGHT, BLUE_DARK)
    draw = ImageDraw.Draw(img, "RGBA")
    # subtle inner circle
    margin = int(size * 0.15)
    draw.rounded_rectangle([margin, margin, size - margin, size - margin],
                          radius=int(size * 0.22), outline=(255, 255, 255, 50), width=int(size*0.015))
    # Wallet icon
    draw_wallet(draw, size)
    img.save(os.path.join(OUT_DIR, filename), "PNG", optimize=True)
    print(f"✓ {filename} ({size}x{size})")

if __name__ == "__main__":
    generate(192, "icon-192.png")
    generate(512, "icon-512.png")
    # Apple touch icon
    generate(180, "apple-touch-icon.png")
    # Favicon
    generate(32, "favicon-32.png")
    generate(16, "favicon-16.png")
    print("✅ All icons generated!")
