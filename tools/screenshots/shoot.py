"""Runs the app's interface in a browser with a pretend Rust side, and takes pictures of it.
usage: python3 shoot.py <name> <steps-js> [--w 430 --h 932 --dark]"""
import json, sys, shutil, pathlib, argparse
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import data

SRC = pathlib.Path(__file__).resolve().parents[2] / 'src'
KIT = pathlib.Path(__file__).parent
OUT = KIT / 'out'; OUT.mkdir(exist_ok=True)

MOCK = """
window.__STATE = %s;
window.__LOG = [];
const answers = {
  get_state: () => window.__STATE,
  app_info: () => ({ platform: window.__PLATFORM, mobile: window.__PLATFORM === 'ios', version: '1.2.5' }),
  social_accounts: () => ({}), social_conversations: () => null, site_accounts: () => [],
  weather_now: () => ({ temp: 58, code: 1, place: 'Fort Mill' }), sync_status: () => ({}), mail_account: () => null,
  discover_get: () => null, get_article: () => ({ html: %s, byline: 'Ben Harlow' }), wm_counts: () => ({}), email_account: () => window.__MAIL || null, email_check: () => ({ added: 0 }), reply_options: () => ({ email: { address: 'ben@benharlow.net' }, comments: 'https://benharlow.net/keep-a-blogroll/#comments', webmention: true }), lists_get: () => [],
};
window.__TAURI__ = {
  core: { invoke: async (cmd, args) => { window.__LOG.push(cmd); const f = answers[cmd]; if (f) return f(args); return null; },
          convertFileSrc: s => s },
  event: { listen: async () => () => {}, emit: async () => {} },
  window: { getCurrentWindow: () => ({ setTitle(){}, onFocusChanged: async () => () => {} }) },
  webview: {}, app: {}, opener: {},
};
""" % (json.dumps(data.STATE), json.dumps(data.ARTICLE))

def run(name, steps, w, h, dark, platform, scale, mail=False):
    tmp = KIT / 'site'
    if tmp.exists(): shutil.rmtree(tmp)
    shutil.copytree(SRC, tmp)
    html = (tmp / 'index.html').read_text()
    html = html.replace('<script', '<script>window.__MAIL=%s;window.__PLATFORM=%s;</script><script src="mock.js"></script><script' % (json.dumps({'address':'alex@alexmoreno.net','name':'Alex Moreno','imap_host':'imap.fastmail.com'} if mail else None), json.dumps(platform)), 1)
    (tmp / 'index.html').write_text(html)
    (tmp / 'mock.js').write_text(MOCK)
    with sync_playwright() as p:
        b = p.chromium.launch()
        ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' if platform == 'ios' else None
        ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=scale, color_scheme='dark' if dark else 'light',
                            user_agent=ua, has_touch=platform == 'ios')
        ctx.add_init_script('localStorage.setItem("plinks", %s);' % json.dumps(json.dumps(data.PLINKS)))
        ctx.add_init_script("""for (const [k,v] of Object.entries({guideSeen:'1', nbWelcomed:'1', nbHinted:'1', rulesSeen:'1', likeExplained:'1', nbSeen:String(Date.now()-5*3600e3), discoverSeen:'1', alertsAsked:'1', youSeeded:'1'})) localStorage.setItem(k,v);""")
        def route(r):
            n = r.request.url.split('/')[-1]
            f = KIT / 'pics' / n
            r.fulfill(path=str(f)) if f.exists() else r.fulfill(status=404, body='')
        ctx.route('https://pics.test/**', route)
        ctx.route(lambda u: u.startswith('http') and 'pics.test' not in u and 'localhost' not in u and '127.0.0.1' not in u, lambda r: r.fulfill(status=404, body=''))
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto((tmp / 'index.html').as_uri())
        pg.wait_for_timeout(800)
        if steps:
            pg.evaluate("async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); %s }" % steps)
        pg.wait_for_timeout(700)
        pg.screenshot(path=str(OUT / f'{name}.png'))
        print('errors:', errs[:5])
        print('calls:', sorted(set(pg.evaluate('window.__LOG'))))
        b.close()

if __name__ == '__main__':
    a = argparse.ArgumentParser(); a.add_argument('name'); a.add_argument('steps', nargs='?', default='')
    a.add_argument('--w', type=int, default=430); a.add_argument('--h', type=int, default=932)
    a.add_argument('--dark', action='store_true'); a.add_argument('--platform', default='ios'); a.add_argument('--scale', type=float, default=3); a.add_argument('--mail', action='store_true')
    x = a.parse_args(); run(x.name, x.steps, x.w, x.h, x.dark, x.platform, x.scale, x.mail)
