import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createPhotoKey, getPhoto, deletePhoto } from '../worker/photos.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64');
const bindings = { CLOUDINARY_CLOUD_NAME: 'vmate-test', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-only-secret' };
async function eventually(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail('Background cleanup did not finish');
}
function postForm(id, count = 1) {
  const form = new FormData();
  form.append('post', JSON.stringify({ id, title: 'Cloudinary setup 🌿', body: 'Photo and emoji ✨', product: 'general', topic: count ? 'photos' : 'stories' }));
  for (let i = 0; i < count; i++) form.append('photos', new Blob([png], { type: 'image/png' }), 'photo.png');
  return form;
}
async function setup(t, options) {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: ['index.js', 'photos.js'].map(name => ({ type: 'ESModule', path: new URL('../worker/' + name, import.meta.url).pathname })),
    compatibilityDate: '2026-10-01', d1Databases: { DB: 'test-cloudinary' }, ...options }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const migration = await readFile(new URL('../migrations/0001_community.sql', import.meta.url), 'utf8');
  for (const sql of migration.replace(/^--.*$/gm, '').split(';').filter(s => s.trim())) await db.prepare(sql).run();
  let cookie = '';
  async function request(path, method = 'GET', body) {
    const headers = { 'X-VMATE-Request': '1', Origin: 'http://localhost', Cookie: cookie };
    if (body !== undefined && !(body instanceof FormData)) { body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const request = new Request(`http://localhost${path}`, { method, headers, body });
    const response = await mf.dispatchFetch(request.url, { method, headers: Object.fromEntries(request.headers),
      ...(body !== undefined ? { body: new Uint8Array(await request.arrayBuffer()) } : {}) });
    return response;
  }
  const registered = await request('/api/register', 'POST', { username: 'cloudtester', name: 'Tester', password: 'Test-password-12345' });
  assert.equal(registered.status, 200, await registered.clone().text());
  cookie = registered.headers.get('set-cookie').split(';')[0];
  return { db, request };
}

test('Cloudinary credentials stay server-side, uploads are signed, and photos can be read and deleted', async t => {
  const stored = new Map(); let uploads = 0; let failUpload = 0; let failDelete = false;
  const { db, request } = await setup(t, { bindings, outboundService: async req => {
    const url = new URL(req.url);
    assert.ok(['api.cloudinary.com', 'res.cloudinary.com'].includes(url.hostname));
    assert.ok(!req.url.includes(bindings.CLOUDINARY_API_SECRET));
    if (url.hostname === 'res.cloudinary.com') {
      assert.ok(['GET', 'HEAD'].includes(req.method));
      const publicId = url.pathname.replace('/vmate-test/image/upload/v1/', '');
      if (!stored.has(publicId)) return new Response(null, { status: 404 });
      return new Response(req.method === 'HEAD' ? null : png, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.length), ETag: '"test-image"' } });
    }
    assert.equal(req.method, 'POST');
    const form = await req.formData();
    assert.equal(form.get('api_key'), 'test-key');
    assert.equal(form.has('api_secret'), false);
    const publicId = form.get('public_id'), timestamp = form.get('timestamp');
    assert.match(publicId, /^vmate\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/);
    assert.ok(Math.abs(Date.now() / 1000 - Number(timestamp)) < 60);
    if (url.pathname.endsWith('/upload')) {
      assert.equal(form.get('overwrite'), 'false');
      assert.equal(form.get('signature'), createHash('sha256').update(`overwrite=false&public_id=${publicId}&timestamp=${timestamp}test-only-secret`).digest('hex'));
      const file = form.get('file'); assert.equal(file.type, 'image/png');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
      if (++uploads === failUpload) return new Response('provider details must stay private', { status: 503 });
      stored.set(publicId, true);
      return Response.json({ public_id: publicId, resource_type: 'image', type: 'upload', format: 'png' });
    }
    assert.equal(url.pathname, '/v1_1/vmate-test/image/destroy');
    assert.equal(form.get('invalidate'), 'true');
    assert.equal(form.get('signature'), createHash('sha256').update(`invalidate=true&public_id=${publicId}&timestamp=${timestamp}test-only-secret`).digest('hex'));
    if (failDelete) return new Response(null, { status: 503 });
    return Response.json({ result: stored.delete(publicId) ? 'ok' : 'not found' });
  } });
  const postId = crypto.randomUUID();
  const created = await request('/api/posts', 'POST', postForm(postId));
  assert.equal(created.status, 201, await created.clone().text());
  assert.equal((await request('/api/posts', 'POST', postForm(postId))).status, 200);
  assert.equal(uploads, 1, 'idempotent retry must not upload again');
  const feedText = await (await request('/api/posts')).text();
  assert.ok(!feedText.includes('test-only-secret')); assert.ok(!feedText.includes('cloudinary:'));
  const photo = JSON.parse(feedText).posts[0].images[0].url;
  const image = await request(photo); assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  const head = await request(photo, 'HEAD'); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-type'), 'image/png');
  failDelete = true;
  assert.equal((await request(`/api/posts/${postId}`, 'DELETE')).status, 200);
  assert.equal((await request(photo)).status, 404);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pending_deletions').first()).n, 1);
  failDelete = false;
  await request('/api/login', 'POST', { username: 'cloudtester', password: 'Test-password-12345' });
  await eventually(async () => stored.size === 0 && (await db.prepare('SELECT COUNT(*) AS n FROM pending_deletions').first()).n === 0);
  failUpload = uploads + 2;
  const failed = await request('/api/posts', 'POST', postForm(crypto.randomUUID(), 2));
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('provider details'));
  await eventually(async () => stored.size === 0 && (await db.prepare('SELECT COUNT(*) AS n FROM pending_deletions').first()).n === 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM posts').first()).n, 0);
});

test('D1 alone supports text posts; missing photo configuration fails without saving a partial post', async t => {
  const { request } = await setup(t, {});
  assert.equal((await request('/api/posts', 'POST', postForm(crypto.randomUUID(), 0))).status, 201);
  const upload = await request('/api/posts', 'POST', postForm(crypto.randomUUID()));
  assert.equal(upload.status, 503); assert.match(await upload.text(), /not configured/);
  assert.equal((await (await request('/api/posts')).json()).total, 1);
});

test('partial configuration and malformed storage keys cannot fall back or target arbitrary hosts', async () => {
  assert.throws(() => createPhotoKey({ PHOTOS: {}, CLOUDINARY_CLOUD_NAME: 'test' }, crypto.randomUUID(), crypto.randomUUID()));
  await assert.rejects(getPhoto({}, 'cloudinary:attacker.example/path:vmate/a/b'));
  await assert.rejects(getPhoto({}, 'cloudinary:valid:../../private'));
  const key = createPhotoKey(bindings, crypto.randomUUID(), crypto.randomUUID());
  await assert.rejects(deletePhoto({ ...bindings, CLOUDINARY_CLOUD_NAME: 'another-account' }, key));
});
