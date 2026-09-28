#!/usr/bin/env python3
"""由 assets/source/ 原圖產生外掛圖示與品牌 PNG(需 Pillow、numpy)。產物已提交進 repo,建置不需執行本腳本。
用法:python3 scripts/make-brand.py
"""
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np

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

def drop_shadow(im):
    """去掉圖形下方的淡藍橢圓陰影(只在圖高 86% 以下找淡藍像素)"""
    a = np.array(im.convert('RGBA'))
    h = a.shape[0]
    low = np.arange(h)[:, None] > h * 0.86
    a[low & (a[..., 2] > 200) & (a[..., 0] < 235) & (a[..., 1] > 200)] = 0
    return Image.fromarray(a)

# 擴充功能圖示(不含文字):
#  48/128 px 用白描邊版(與品牌素材一致);
#  16/24/32 px 用無描邊平面版去陰影 — 白描邊在工具列尺寸只會變成糊邊,深色主題下平面版較清楚
mark = trim(Image.open(SRC / 'vaxcheck-mark-sticker.png'), pad=0.02)
flat = trim(drop_shadow(Image.open(SRC / 'vaxcheck-mark-flat-shadow.png')), pad=0.02)
for s in (16, 24, 32, 48, 128):
    ic = (flat if s <= 32 else mark).resize((s, s), Image.LANCZOS)
    if s <= 32:
        ic = ic.filter(ImageFilter.UnsharpMask(radius=0.6, percent=80, threshold=0))
    save(ic, ROOT / f'assets/icons/icon{s}.png')

# 品牌 PNG(README、文件用;縮到網頁合用大小)
def fit(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
save(fit(trim(Image.open(SRC / 'vaxcheck-lockup-vertical-zh.png'), pad=0.03), 840), ROOT / 'assets/brand/vaxcheck-lockup-vertical-zh.png')
save(fit(trim_wide(Image.open(SRC / 'vaxcheck-lockup-horizontal.png')), 1000), ROOT / 'assets/brand/vaxcheck-lockup-horizontal.png')
save(mark.resize((512, 512), Image.LANCZOS), ROOT / 'assets/brand/vaxcheck-mark.png')
