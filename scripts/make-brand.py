#!/usr/bin/env python3
"""由 assets/source/ 原圖產生外掛圖示與品牌 PNG(需 Pillow)。產物已提交進 repo,建置不需執行本腳本。
用法:python3 scripts/make-brand.py
"""
from pathlib import Path
from PIL import Image, ImageFilter, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets/source'

def trim(im, pad=0.0):
    """裁到不透明內容,補成正方形(pad = 四周留白比例)"""
    im = im.convert('RGBA')
    bbox = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    im = im.crop(bbox)
    side = int(max(im.size) * (1 + 2 * pad))
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return sq

def trim_wide(im, pad=0.04):
    im = im.convert('RGBA')
    bbox = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    im = im.crop(bbox)
    p = int(max(im.size) * pad)
    out = Image.new('RGBA', (im.width + 2 * p, im.height + 2 * p), (0, 0, 0, 0))
    out.paste(im, (p, p), im)
    return out

def save(im, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, optimize=True)
    Image.open(path).load()   # 寫完立即解碼驗證
    print('✓', path.relative_to(ROOT), im.size)

# 工具列小圖示(16/24/32 px):直長的臺灣標誌在工具列只剩輪廓,另畫方形版「藍底 + 白色針筒 + 黃勾」。
# 以 16 格為設計網格、8 倍超取樣再縮小;色票取自原圖。刻度只在 24 px 以上畫。
BLUE=(0,58,156); GREEN=(2,131,58); YEL=(222,173,1); LIGHT=(202,230,251); WHITE=(255,255,255)
def small(size, SS=8):
    k=size*SS/16.0; S=size*SS
    im=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    R=lambda *xy: [v*k for v in xy]
    d.rounded_rectangle(R(0,0,16,16),radius=3.2*k,fill=BLUE)
    # 針筒(白):推桿頭、推桿、筒身(下半為藥液)、針頭
    d.rounded_rectangle(R(2.4,1.2,8.6,2.8),radius=0.7*k,fill=WHITE)
    d.rectangle(R(4.7,2.8,6.3,4.0),fill=WHITE)
    d.rounded_rectangle(R(2.9,4.0,8.1,11.2),radius=1.1*k,fill=WHITE)
    if size >= 24:
        for y in (5.6,7.4): d.rectangle(R(2.9,y,4.6,y+0.9),fill=BLUE)   # 刻度(24 px 以上才畫)
    d.rounded_rectangle(R(4.5,7.6,6.5,10.4),radius=0.4*k,fill=LIGHT)   # 藥液
    d.polygon([(4.3*k,11.2*k),(6.7*k,11.2*k),(5.5*k,14.6*k)],fill=WHITE)
    # 勾(黃,外圍藍色間隔)
    pts=[(7.6*k,10.6*k),(9.9*k,12.9*k),(14.3*k,8.1*k)]
    for col,w in ((BLUE,4.4),(YEL,2.6)):
        d.line(pts,fill=col,width=round(w*k),joint='curve')
        for p in (pts[0],pts[-1]): d.ellipse([p[0]-w/2*k,p[1]-w/2*k,p[0]+w/2*k,p[1]+w/2*k],fill=col)
    # 圓角外切乾淨
    mask=Image.new('L',(S,S),0); ImageDraw.Draw(mask).rounded_rectangle(R(0,0,16,16),radius=3.2*k,fill=255)
    im.putalpha(Image.composite(im.getchannel('A'),Image.new('L',(S,S),0),mask))
    return im.resize((size,size),Image.BOX)

# 擴充功能圖示(不含文字):16/24/32 用方形小圖示;48/128(擴充功能清單)用原圖白描邊版
mark = trim(Image.open(SRC / 'vaxcheck-mark-sticker.png'), pad=0.02)
for s in (16, 24, 32):
    save(small(s), ROOT / f'assets/icons/icon{s}.png')
for s in (48, 128):
    save(mark.resize((s, s), Image.LANCZOS), ROOT / f'assets/icons/icon{s}.png')

# 預覽圖 docs/img/toolbar-icon.png:淺色/深色工具列,左上原尺寸、中間放大
Z = 6
cw = 48 * Z + 30
pv = Image.new('RGB', (4 * cw + 20, 2 * (48 * Z + 30) + 20), 'white')
dd = ImageDraw.Draw(pv)
for r, bg in enumerate(('#F1F3F4', '#35363A')):
    y = 10 + r * (48 * Z + 30)
    for c, sz in enumerate((16, 24, 32, 48)):
        x = 10 + c * cw
        dd.rectangle([x, y, x + 48 * Z + 10, y + 48 * Z + 10], fill=bg)
        ic = Image.open(ROOT / f'assets/icons/icon{sz}.png').convert('RGBA')
        big = ic.resize((sz * Z, sz * Z), Image.NEAREST)
        pv.paste(big, (x + 5 + (48 - sz) * Z // 2, y + 5 + (48 - sz) * Z // 2), big)
        pv.paste(ic, (x + 8, y + 8), ic)
save(pv, ROOT / 'docs/img/toolbar-icon.png')

# 品牌 PNG(README、文件用;縮到網頁合用大小)
def fit(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
save(fit(trim(Image.open(SRC / 'vaxcheck-lockup-vertical-zh.png'), pad=0.03), 840), ROOT / 'assets/brand/vaxcheck-lockup-vertical-zh.png')
save(fit(trim_wide(Image.open(SRC / 'vaxcheck-lockup-horizontal.png')), 1000), ROOT / 'assets/brand/vaxcheck-lockup-horizontal.png')
save(mark.resize((512, 512), Image.LANCZOS), ROOT / 'assets/brand/vaxcheck-mark.png')
