// Runs the worker against an in-memory SQLite stand-in for Cloudflare D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { receive } from '../src/worker.js';

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return { prepare: sql => stmt(sql), batch: async list => Promise.all(list.map(s => s.run())) };
}
const env = { DB: fakeD1(), MAIL_DOMAIN: 'readingroomapp.com', FEED_HOST: 'mail.readingroomapp.com' };
const call = (path, init) => worker.fetch(new Request('https://mail.readingroomapp.com' + path, init), env);

test('make an address, get mail, read the feed, remove it', async () => {
  const r = await call('/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Own Your Web' }) });
  assert.equal(r.status, 201);
  const { email, feed } = await r.json();
  assert.match(email, /^[a-z]+-[a-z]+-\d{4}@readingroomapp\.com$/);
  const tok = feed.match(/feeds\/(.+)\.xml$/)[1];

  const raw = new TextEncoder().encode([
    'From: Matthias <hello@example.com>', `To: ${email}`, 'Subject: Issue 12 & more',
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', '<p>Hello <b>reader</b></p>'].join('\r\n'));
  assert.equal(await receive(env, email, 'hello@example.com', raw), null);
  assert.equal(await receive(env, 'nobody-here-0000@readingroomapp.com', 'x@example.com', raw), 'No such address.');

  const f = await (await call(`/feeds/${tok}.xml`)).text();
  assert.match(f, /<title>Own Your Web<\/title>/);
  assert.match(f, /<title>Issue 12 &amp; more<\/title>/);
  assert.match(f, /<name>Matthias<\/name>/);
  assert.match(f, /&lt;b&gt;reader&lt;\/b&gt;/);
  assert.match(f, /is ready/); // the welcome story
  const id = f.match(/urn:uuid:([0-9a-f-]{36})/)[1];
  const page = await call(`/feeds/${tok}/${id}.html`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('Content-Security-Policy'), /sandbox/);

  assert.equal((await call(`/feeds/${tok}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/feeds/${tok}.xml`)).status, 404);
  assert.equal(await receive(env, email, 'hello@example.com', raw), 'No such address.');
});

test('plain-text email becomes paragraphs with links', async () => {
  const { email, feed } = await (await call('/new', { method: 'POST', body: new URLSearchParams({ title: 'Forwarded' }) })).json();
  const raw = new TextEncoder().encode(`From: me@example.com\r\nTo: ${email}\r\nSubject: Fwd: note\r\n\r\nFirst line\r\n\r\nSee https://daviddaniels.com/now.`);
  await receive(env, email, 'me@example.com', raw);
  const f = await (await call(new URL(feed).pathname)).text();
  assert.match(f, /&lt;a href=&quot;https:\/\/daviddaniels.com\/now&quot;&gt;/);
});

test('one place can only make so many a day', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call('/new', { method: 'POST', headers: { 'CF-Connecting-IP': '9.9.9.9' } });
  assert.equal(last.status, 429);
});

test('daily tidy keeps the newest 100', async () => {
  const { email, feed } = await (await call('/new', { method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4' } })).json();
  const tok = feed.match(/feeds\/(.+)\.xml$/)[1];
  for (let i = 0; i < 105; i++) await receive(env, email, 'a@b.c', new TextEncoder().encode(`Subject: ${i}\r\n\r\nx`));
  await worker.scheduled({}, env);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries WHERE token = ?').bind(tok).first();
  assert.equal(n, 100);
});
