import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { imageInfo } from '../worker/index.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64');
test('image validation rejects active content and excessive dimensions', () => {
  assert.equal(imageInfo(png).mime, 'image/png');
  assert.throws(() => imageInfo(Buffer.from('<svg onload="alert(1)"></svg>')));
  const oversized = Buffer.from(png); oversized.writeUInt32BE(30000, 16);
  assert.throws(() => imageInfo(oversized));
  assert.throws(() => imageInfo(Buffer.from([255,216,255])));
});

test('Cloudflare D1/R2: shared posts, images, auth, comments, permissions and moderation', async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: new URL('../worker/index.js', import.meta.url).pathname,
    compatibilityDate: '2026-10-01', d1Databases: { DB: 'test-community' }, r2Buckets: ['PHOTOS'] }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const migration = await readFile(new URL('../migrations/0001_community.sql', import.meta.url), 'utf8');
  for (const statement of migration.replace(/^--.*$/gm, '').split(';').filter(s => s.trim())) await db.prepare(statement).run();
  async function request(path, { method = 'GET', body, cookie = '', headers = {} } = {}) {
    const init = { method, headers: { 'X-VMATE-Request': '1', Origin: 'http://localhost', Cookie: cookie, ...headers } };
    if (body instanceof FormData) {
      // Serialize with Node's own Request before crossing Miniflare's Fetch implementation.
      const serialized = new Request(`http://localhost${path}`, { ...init, body });
      init.headers = Object.fromEntries(serialized.headers);
      init.body = new Uint8Array(await serialized.arrayBuffer());
    }
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    return mf.dispatchFetch(`http://localhost${path}`, init);
  }
  const aliceResponse = await request('/api/register', { method: 'POST', body: { username: 'alice', name: 'Alice 🌿', password: 'Test-strong-password-1' } });
  assert.equal(aliceResponse.status, 200, await aliceResponse.clone().text());
  const alice = aliceResponse.headers.get('set-cookie').split(';')[0];
  assert.match(aliceResponse.headers.get('set-cookie'), /HttpOnly/);
  const aliceUser = (await aliceResponse.json()).user;
  const bobResponse = await request('/api/register', { method: 'POST', body: { username: 'bobby', name: 'Bob', password: 'Test-strong-password-2' } });
  const bob = bobResponse.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/login', { method: 'POST', body: { username: 'alice', password: 'incorrect-password' } })).status, 401);
  assert.equal((await request('/api/register', { method: 'POST', body: { username: 'alice', name: 'Copy', password: 'Test-strong-password-1' } })).status, 409);
  assert.equal((await request('/api/posts', { method: 'POST' })).status, 401);
  assert.equal((await request('/api/logout', { method: 'POST', cookie: alice, headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request('/api/logout', { method: 'POST', cookie: alice, headers: { 'X-VMATE-Request': '' } })).status, 403);
  const postId = crypto.randomUUID();
  function postForm(overrides = {}, files = [png]) {
    const form = new FormData();
    form.append('post', JSON.stringify({ id: postId, title: 'My morning setup ✨', body: 'Really enjoying this scent 🌿 <script>evil()</script>', product: 'white-tea', topic: 'photos', rating: 5, ...overrides }));
    files.forEach(file => form.append('photos', new Blob([file], { type: 'image/png' }), 'photo.png'));
    return form;
  }
  const created = await request('/api/posts', { method: 'POST', cookie: alice, body: postForm() });
  assert.equal(created.status, 201, await created.clone().text());
  assert.equal((await request('/api/posts', { method: 'POST', cookie: alice, body: postForm() })).status, 200);
  const publicFeed = await (await request('/api/posts')).json();
  assert.equal(publicFeed.total, 1); assert.equal(publicFeed.stats.photos, 1); assert.equal(publicFeed.posts[0].can_delete, false);
  assert.equal(publicFeed.posts[0].body, 'Really enjoying this scent 🌿 <script>evil()</script>');
  const imageUrl = publicFeed.posts[0].images[0].url;
  const image = await request(imageUrl); assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal((await (await request('/api/posts', { cookie: bob })).json()).posts[0].id, postId);
  assert.equal((await (await request('/api/posts?product=lavender')).json()).total, 0);
  assert.equal((await (await request('/api/posts?q=morning')).json()).total, 1);
  assert.equal((await (await request('/api/posts?q=%25')).json()).total, 0);
  assert.equal((await request(`/api/posts/${postId}`, { method: 'DELETE', cookie: bob })).status, 403);
  assert.equal((await request('/api/posts', { method: 'POST', cookie: bob, body: postForm() })).status, 409);
  for (let i = 0; i < 2; i++) assert.equal((await request(`/api/posts/${postId}/like`, { method: 'POST', cookie: bob, body: { liked: true } })).status, 200);
  assert.equal((await (await request(`/api/posts/${postId}`, { cookie: bob })).json()).post.like_count, 1);
  const commentId = crypto.randomUUID();
  for (let i = 0; i < 2; i++) assert.equal((await request(`/api/posts/${postId}/comments`, { method: 'POST', cookie: bob, body: { id: commentId, body: 'Looks wonderful! 😍 中文也支持' } })).status, 201);
  const replies = await (await request(`/api/posts/${postId}/comments`)).json(); assert.equal(replies.comments.length, 1); assert.match(replies.comments[0].body, /中文/);
  assert.equal((await request(`/api/comments/${commentId}`, { method: 'DELETE', cookie: alice })).status, 403);
  assert.equal((await request('/api/posts', { method: 'POST', cookie: alice, body: postForm({ id: crypto.randomUUID() }, [Buffer.from('<svg></svg>')]) })).status, 400);
  assert.equal((await request('/api/posts', { method: 'POST', cookie: alice, body: postForm({ id: crypto.randomUUID() }, []) })).status, 400);
  assert.equal((await request('/api/posts', { method: 'POST', cookie: alice, body: postForm({ id: crypto.randomUUID() }, [png,png,png,png,png]) })).status, 400);
  assert.equal((await request('/api/posts', { method: 'POST', cookie: alice, body: postForm({ id: crypto.randomUUID(), rating: 6 }) })).status, 400);
  assert.equal((await request(`/api/posts/${postId}/report`, { method: 'POST', cookie: bob, body: { reason: 'Please review this content.' } })).status, 201);
  assert.equal((await request('/api/reports', { cookie: bob })).status, 403);
  await db.prepare("UPDATE users SET role='admin' WHERE id=?").bind(aliceUser.id).run();
  assert.equal((await (await request('/api/reports', { cookie: alice })).json()).reports.length, 1);
  assert.equal((await request(`/api/comments/${commentId}`, { method: 'DELETE', cookie: alice })).status, 200);
  assert.equal((await request(`/api/posts/${postId}`, { method: 'DELETE', cookie: alice })).status, 200);
  assert.equal((await request(imageUrl)).status, 404);
  assert.equal((await (await request('/api/posts')).json()).total, 0);
  assert.equal((await (await request('/api/reports', { cookie: alice })).json()).reports.length, 0);
  await request('/api/logout', { method: 'POST', cookie: alice });
  assert.equal((await (await request('/api/session', { cookie: alice })).json()).user, null);
  assert.equal((await request('/api/login', { method: 'POST', body: { username: 'alice', password: 'Test-strong-password-1' } })).status, 200);
});
