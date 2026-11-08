// The Reading Room's mail service.
// Make an address, give it out (to a newsletter, or forward mail to it), and each email arrives
// in the app as a story in that address's feed. Runs on Cloudflare: Email Routing hands mail to
// email(), the app and the feeds talk to fetch(), and scheduled() tidies up once a day.
import PostalMime from 'postal-mime';

const KEEP = 100;                 // emails kept per address
const MAX_DAYS = 365;             // and none older than this
const MAX_MAIL = 5 * 1024 * 1024; // bigger emails are turned away
const MAX_HTML = 400 * 1024;      // an email's text is cut off past this
const PER_DAY = 10;               // new addresses one place can make in a day

const WORDS_A = ['quiet', 'amber', 'early', 'gentle', 'little', 'silver', 'golden', 'hidden', 'lucky', 'mellow',
  'misty', 'quick', 'rosy', 'sunny', 'tidy', 'brave', 'calm', 'clever', 'cozy', 'eager', 'fancy', 'happy', 'jolly',
  'kind', 'lively', 'merry', 'noble', 'patient', 'proud', 'shy', 'snowy', 'sweet', 'warm', 'wise', 'witty', 'bright'];
const WORDS_B = ['river', 'meadow', 'lantern', 'harbor', 'orchard', 'garden', 'porch', 'willow', 'maple', 'cedar',
  'robin', 'sparrow', 'finch', 'heron', 'otter', 'fox', 'badger', 'pebble', 'brook', 'hill', 'valley', 'island',
  'library', 'teacup', 'notebook', 'pencil', 'letter', 'parcel', 'kettle', 'candle', 'compass', 'ribbon', 'thimble'];

const pick = a => a[crypto.getRandomValues(new Uint32Array(1))[0] % a.length];
const digits = () => String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
const token = () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const now = () => new Date().toISOString();

const xml = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c])
  // characters XML doesn't allow at all
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
const html = xml;

function textToHtml(text) {
  const esc = html(text || '');
  const linked = esc.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => `<a href="${u}">${u}</a>`);
  return linked.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
}

async function ipHash(req) {
  const ip = req.headers.get('CF-Connecting-IP') || '';
  const day = now().slice(0, 10);
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${day}|reading-room`));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

function feedUrl(env, tok) { return `https://${env.FEED_HOST}/feeds/${tok}.xml`; }
function entryUrl(env, tok, id) { return `https://${env.FEED_HOST}/feeds/${tok}/${id}.html`; }

async function welcome(env, box) {
  const email = `${box.local}@${env.MAIL_DOMAIN}`;
  await addEntry(env, box.token, {
    title: `“${box.title}” is ready`,
    author: 'The Reading Room',
    html: `<p>Mail sent to <b>${html(email)}</b> will show up here, one story per email.</p>
<p>Sign up for newsletters with this address, or forward an email to it from your own inbox. Anyone who knows the address can send to it, so give it only to people and newsletters you want to read here.</p>
<p>To stop using it, unsubscribe from its newsletters, then choose Remove next to the address in the app’s Newsletters panel. That deletes the address and everything sent to it.</p>`,
  });
}

async function addEntry(env, tok, { title, author, html: body }) {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO entries (id, token, title, author, received, html) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, tok, title.slice(0, 300), author.slice(0, 200), now(), body).run();
  return id;
}

async function makeBox(req, env) {
  let title = '';
  const type = req.headers.get('Content-Type') || '';
  try {
    if (type.includes('application/json')) title = String((await req.json()).title || '');
    else title = String((await req.formData()).get('title') || '');
  } catch { /* no title: use the default */ }
  title = title.trim().slice(0, 200) || 'Newsletters';

  const ip = await ipHash(req);
  const since = new Date(Date.now() - 86400e3).toISOString();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM boxes WHERE ip_hash = ? AND created > ?').bind(ip, since).first();
  if (n >= PER_DAY) return json({ error: 'That’s a lot of new addresses for one day. Try again tomorrow.' }, 429);

  for (let tries = 0; tries < 8; tries++) {
    const local = `${pick(WORDS_A)}-${pick(WORDS_B)}-${digits()}`;
    const box = { local, token: token(), title };
    const r = await env.DB.prepare('INSERT OR IGNORE INTO boxes (local, token, title, created, ip_hash) VALUES (?, ?, ?, ?, ?)')
      .bind(local, box.token, title, now(), ip).run();
    if (r.meta.changes) {
      await welcome(env, box);
      return json({ email: `${local}@${env.MAIL_DOMAIN}`, feed: feedUrl(env, box.token) }, 201);
    }
  }
  return json({ error: 'Couldn’t make an address just now. Try again.' }, 503);
}

async function feed(env, tok) {
  const box = await env.DB.prepare('SELECT * FROM boxes WHERE token = ?').bind(tok).first();
  if (!box) return new Response('No such feed. Its address may have been removed.', { status: 404 });
  const { results } = await env.DB.prepare('SELECT * FROM entries WHERE token = ? ORDER BY received DESC LIMIT ?').bind(tok, KEEP).all();
  const updated = results[0]?.received || box.created;
  const self = feedUrl(env, tok);
  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xml(box.title)}</title>
  <subtitle>Mail sent to ${xml(box.local)}@${xml(env.MAIL_DOMAIN)}</subtitle>
  <id>urn:reading-room-mail:${xml(tok)}</id>
  <link rel="self" type="application/atom+xml" href="${xml(self)}"/>
  <updated>${xml(updated)}</updated>
  <generator uri="https://readingroomapp.com">The Reading Room</generator>
${results.map(e => `  <entry>
    <id>urn:uuid:${xml(e.id)}</id>
    <title>${xml(e.title)}</title>
    <author><name>${xml(e.author || 'Unknown sender')}</name></author>
    <link rel="alternate" type="text/html" href="${xml(entryUrl(env, tok, e.id))}"/>
    <published>${xml(e.received)}</published>
    <updated>${xml(e.received)}</updated>
    <content type="html">${xml(e.html)}</content>
  </entry>`).join('\n')}
</feed>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' } });
}

async function entryPage(env, tok, id) {
  const e = await env.DB.prepare('SELECT * FROM entries WHERE token = ? AND id = ?').bind(tok, id).first();
  if (!e) return new Response('Not found.', { status: 404 });
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${html(e.title)}</title></head>
<body><article><h1>${html(e.title)}</h1><p>From ${html(e.author)} · ${html(e.received.slice(0, 10))}</p>
${e.html}</article></body></html>`;
  return new Response(page, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    // An email's own scripts never run here; pictures still show
    'Content-Security-Policy': "default-src 'none'; img-src * data:; style-src 'unsafe-inline' *; font-src *; sandbox allow-popups allow-popups-to-escape-sandbox",
    'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer',
  } });
}

async function removeBox(env, tok) {
  const box = await env.DB.prepare('SELECT local FROM boxes WHERE token = ?').bind(tok).first();
  if (!box) return json({ removed: false }, 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM entries WHERE token = ?').bind(tok),
    env.DB.prepare('DELETE FROM boxes WHERE token = ?').bind(tok),
  ]);
  return json({ removed: true });
}

export async function receive(env, to, from, raw) {
  const [local, domain] = to.toLowerCase().split('@');
  if (domain !== env.MAIL_DOMAIN.toLowerCase()) return 'Not an address here.';
  const box = await env.DB.prepare('SELECT token FROM boxes WHERE local = ?').bind(local).first();
  if (!box) return 'No such address.';
  const m = await PostalMime.parse(raw);
  let body = m.html || textToHtml(m.text);
  if (body.length > MAX_HTML) body = body.slice(0, MAX_HTML) + '<p>[This email was too long to keep the rest.]</p>';
  const author = m.from?.name || m.from?.address || from || '';
  await addEntry(env, box.token, { title: (m.subject || '(No subject)').trim(), author, html: body });
  return null;
}

export default {
  async email(message, env) {
    if (message.rawSize > MAX_MAIL) { message.setReject('This email is too large.'); return; }
    const raw = await new Response(message.raw).arrayBuffer();
    const refused = await receive(env, message.to, message.from, raw);
    if (refused) message.setReject(refused);
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === '/' && req.method === 'GET')
      return new Response('The Reading Room’s mail service. Make an address in the app: Add a feed › Read newsletters here.\nhttps://readingroomapp.com\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    if (p === '/new' && req.method === 'POST') return makeBox(req, env);
    let m = p.match(/^\/feeds\/([A-Za-z0-9_-]{20,64})\.xml$/);
    if (m && (req.method === 'GET' || req.method === 'HEAD')) return feed(env, m[1]);
    m = p.match(/^\/feeds\/([A-Za-z0-9_-]{20,64})$/);
    if (m && req.method === 'DELETE') return removeBox(env, m[1]);
    m = p.match(/^\/feeds\/([A-Za-z0-9_-]{20,64})\/([0-9a-f-]{36})\.html$/);
    if (m && req.method === 'GET') return entryPage(env, m[1], m[2]);
    return new Response('Not found.', { status: 404 });
  },

  async scheduled(_event, env) {
    const old = new Date(Date.now() - MAX_DAYS * 86400e3).toISOString();
    await env.DB.prepare('DELETE FROM entries WHERE received < ?').bind(old).run();
    // Past the last KEEP emails for an address, the oldest go
    await env.DB.prepare(`DELETE FROM entries WHERE id IN (
      SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY token ORDER BY received DESC) AS n FROM entries) WHERE n > ?)`).bind(KEEP).run();
  },
};
