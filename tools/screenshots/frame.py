"""Puts each screen in a captioned App Store frame (1290 x 2796 for iPhone)."""
import base64, pathlib, json, sys
from playwright.sync_api import sync_playwright
KIT = pathlib.Path(__file__).parent
FONTS = pathlib.Path(__file__).resolve().parents[2] / 'src' / 'fonts'

SHOTS = [  # file, headline, line under it
    ('s1', 'Blogs, as a social feed', 'The people you read, newest first. No algorithm deciding what you see.'),
    ('s2', 'Writers answer each other', 'When one blog replies to another, the replies gather into a conversation.'),
    ('s3', 'A page for each person', 'Their posts, who they talk with, and the blogs they recommend.'),
    ('s4', 'A calm place to read', 'Just the words and the pictures. Highlight what stays with you.'),
    ('s5', 'Write back to the writer', 'Reply by email from your own address. No platform in the middle.'),
    ('s6', 'Start the day with people', 'Today puts posts from the people you read ahead of the big outlets.'),
]

def b64(p): return base64.b64encode(pathlib.Path(p).read_bytes()).decode()

CSS = """
@font-face { font-family: N; src: url(data:font/woff2;base64,%s); font-weight: 200 800; }
@font-face { font-family: G; src: url(data:font/woff2;base64,%s); font-weight: 500; }
html,body { margin:0; width:430px; height:932px; overflow:hidden; }
body { background: #127A62; background: linear-gradient(170deg, #158a6e 0%%, #0f6551 100%%); color: #fff; position: relative; }
.cap { position:absolute; left:28px; right:28px; top:58px; text-align:center; }
h1 { text-wrap: balance; font-family: N; font-weight: 560; font-size: 38px; line-height: 1.08; letter-spacing: -0.5px; margin: 0 0 12px; }
p { text-wrap: balance; font-family: G; font-weight: 500; font-size: 16.5px; line-height: 1.4; margin: 0 auto; max-width: 340px; color: rgba(255,255,255,.86); }
.phone { position:absolute; left:50%%; top:228px; width:340px; transform:translateX(-50%%); border-radius: 42px; padding: 9px;
  background: #0b1f1a; box-shadow: 0 30px 60px rgba(0,0,0,.35), 0 0 0 1.5px rgba(255,255,255,.12); }
.phone img { display:block; width:100%%; border-radius: 34px; }
"""

WIDE = """
html,body { width:%(W)dpx; height:%(H)dpx; }
.cap { top: 44px; left: 60px; right: 60px; }
h1 { font-size: 46px; margin-bottom: 10px; }
p { font-size: 19px; max-width: 760px; }
.phone { top: 196px; width: %(dw)dpx; border-radius: %(r)dpx; padding: %(pad)dpx; }
.phone img { border-radius: %(ir)dpx; }
.bar { height: 30px; background:#e9ecee; border-radius: 12px 12px 0 0; display:flex; gap:8px; align-items:center; padding-left:14px; }
.bar i { width:12px; height:12px; border-radius:50%%; display:block; }
"""

def main(prefix='iphone'):
    css = CSS % (b64(FONTS / 'newsreader-latin-opsz-normal.woff2'), b64(FONTS / 'geist-latin-500-normal.woff2'))
    out = KIT / 'final'; out.mkdir(exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        W, H, sc = {'iphone': (430, 932, 3), 'ipad': (1366, 1024, 2), 'mac': (1440, 900, 2)}[prefix]
        pg = b.new_page(viewport={'width': W, 'height': H}, device_scale_factor=sc)
        if prefix == 'ipad': css2 = WIDE % dict(W=W, H=H, dw=1060, r=34, pad=14, ir=20)
        elif prefix == 'mac': css2 = WIDE % dict(W=W, H=H, dw=1180, r=12, pad=0, ir=0) + '.phone{background:#fff}'
        else: css2 = ''
        bar = '<div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>' if prefix == 'mac' else ''
        for k, (f, h, line) in enumerate(SHOTS, 1):
            img = b64(KIT / 'out' / f'{prefix}-{f}.png')
            pg.set_content(f'<style>{css}{css2}</style><div class="cap"><h1>{h}</h1><p>{line}</p></div><div class="phone">{bar}<img src="data:image/png;base64,{img}"></div>')
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / f'{prefix}-{k}.png'))
        b.close()

if __name__ == '__main__': main(sys.argv[1] if len(sys.argv) > 1 else 'iphone')
