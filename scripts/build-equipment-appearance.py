"""Pack hand-aligned equipment fragments without independently resizing them."""
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter
import tempfile

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / '.memory/phases/2026-10-28-coherent-equipment-character/P01-coherent-character/references/frames'
OUTPUT = ROOT / 'public/assets/gear-aligned'
SLOTS = ('helmet', 'armor', 'gloves', 'boots', 'spear', 'horse')
PARTS = ('back', 'front')
POSES = ('walk1', 'walk2', 'walk3', 'walk4', 'contact1', 'contact2', 'hit1', 'hit2', 'defeat1', 'defeat2', 'town')
COLORS = {'common': None, 'uncommon': (242,242,242), 'rare': (66,148,255), 'unique': (180,92,255), 'legendary': (255,207,69)}


def accent(image, color):
    if color is None:
        return image.copy()
    alpha = image.getchannel('A')
    edge = ImageChops.subtract(alpha, alpha.filter(ImageFilter.MinFilter(3)))
    edge = edge.point(lambda value: round(value * 0.35))
    colored = Image.new('RGB', image.size, color)
    rgb = Image.composite(colored, image.convert('RGB'), edge)
    rgb.putalpha(alpha)
    return rgb


def main():
    sources = {}
    for pose in POSES:
        for slot in SLOTS:
            visible = False
            for part in PARTS:
                path = FRAMES / pose / f'{slot}-{part}.png'
                with Image.open(path) as source:
                    if source.mode != 'RGBA' or source.size != (256,256):
                        raise ValueError(f'Invalid aligned fragment: {path}')
                    image = source.copy()
                sources[pose, slot, part] = image
                visible |= bool(image.getchannel('A').getbbox())
            if not visible:
                raise ValueError(f'Empty slot {slot} in {pose}')
    # Apply the same canvas transform to every fragment in a pose. A small
    # shared margin keeps the sprite inside the viewport at the spawn point.
    for pose in POSES[:-1]:
        alpha = Image.new('L',(256,256))
        for slot in SLOTS:
            for part in PARTS:
                alpha = ImageChops.lighter(alpha, sources[pose,slot,part].getchannel('A'))
        bounds = alpha.point(lambda value: 255 if value >= 128 else 0).getbbox()
        if not bounds:
            raise ValueError(f'Empty mounted pose: {pose}')
        side = 236
        offset_x = (256 - side) // 2
        offset_y = 244 - round(bounds[3] * side / 256)
        if round(bounds[1] * side / 256) + offset_y < 0 or round(bounds[3] * side / 256) + offset_y > 256:
            raise ValueError(f'Ground alignment clips pose: {pose}')
        for slot in SLOTS:
            for part in PARTS:
                shifted = Image.new('RGBA',(256,256),(0,0,0,0))
                fragment = sources[pose,slot,part].resize((side,side), Image.Resampling.LANCZOS)
                shifted.paste(fragment, (offset_x,offset_y))
                sources[pose,slot,part] = shifted
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=OUTPUT) as tmp:
        for slot in SLOTS:
            for rarity, color in COLORS.items():
                for part in PARTS:
                    atlas = Image.new('RGBA',(512,1536),(0,0,0,0))
                    for index, pose in enumerate(POSES):
                        frame = accent(sources[pose,slot,part], color)
                        atlas.paste(frame, ((index % 2)*256,(index // 2)*256))
                    suffix = '-front' if part == 'front' else ''
                    atlas.save(Path(tmp) / f'{slot}-{rarity}{suffix}.png')
        for file in Path(tmp).iterdir():
            file.replace(OUTPUT / file.name)


if __name__ == '__main__':
    main()
