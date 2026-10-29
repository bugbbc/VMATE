import { createPhotoKey, putPhoto, getPhoto, deletePhoto, PhotoStorageError } from './photos.js';

const PRODUCTS = new Set(['white-tea', 'lavender', 'osmanthus', 'discovery-set', 'general']);
const TOPICS = new Set(['stories', 'photos', 'questions']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const encoder = new TextEncoder();
const DAY = 86400000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function fail(status, message) { throw new HttpError(status, message); }
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...headers,
  } });
}
function text(value, name, min, max) {
  if (typeof value !== 'string') fail(400, `${name} is required.`);
  value = value.trim();
  if (value.length < min || value.length > max) fail(400, `${name} must be ${min}–${max} characters.`);
  return value;
}
function id(value) { if (!UUID.test(value || '')) fail(400, 'Invalid identifier.'); return value; }
function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function hash(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}
function publicUser(user) { return user ? { id: user.id, username: user.username, name: user.name, role: user.role } : null; }
function cookie(request, token, maxAge = 30 * 86400) {
  return `vmate_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function session(request, env) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)vmate_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  return env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?')
    .bind(await hash(token), Date.now()).first();
}
async function requireUser(request, env) {
  const user = await session(request, env);
  if (!user) fail(401, 'Please sign in to join the conversation.');
  return user;
}
async function issueSession(request, env, user) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT INTO sessions VALUES (?, ?, ?)').bind(await hash(token), user.id, Date.now() + 30 * DAY).run();
  return json({ user: publicUser(user) }, 200, { 'Set-Cookie': cookie(request, token) });
}
async function limit(request, env, action, max, seconds, userId = '') {
  const identity = userId || request.headers.get('CF-Connecting-IP') || 'local';
  const window = Math.floor(Date.now() / (seconds * 1000));
  const key = await hash(`${action}:${identity}:${window}`);
  const row = await env.DB.prepare(`INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).bind(key, (window + 1) * seconds * 1000).first();
  if (row.count > max) fail(429, 'You’re doing that a little too often. Please try again later.');
}
async function bodyBytes(request, max) {
  if (Number(request.headers.get('Content-Length')) > max) fail(413, 'This upload is too large. Please use smaller photos.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'A request body is required.');
  let size = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); fail(413, 'This upload is too large. Please use smaller photos.'); }
    chunks.push(value);
  }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
async function readJSON(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, 'Please send JSON.');
  const bytes = await bodyBytes(request, 20000);
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { fail(400, 'The request could not be read.'); }
}
// Check the actual file signature and dimensions; extensions and supplied MIME types are not trusted.
export function imageInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start, count) => new TextDecoder().decode(bytes.subarray(start, start + count));
  let mime, width, height;
  if (bytes.length >= 33 && hex(bytes.subarray(0, 8)) === '89504e470d0a1a0a' && ascii(12, 4) === 'IHDR') {
    mime = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 20 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    mime = 'image/jpeg'; let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1];
      if (marker === 255) { offset++; continue; }
      if (marker === 218 || marker === 217) break;
      const size = view.getUint16(offset + 2);
      if (size < 2 || offset + 2 + size > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        height = view.getUint16(offset + 5); width = view.getUint16(offset + 7); break;
      }
      offset += size + 2;
    }
  } else if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    mime = 'image/webp'; const kind = ascii(12, 4);
    if (kind === 'VP8X') {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (kind === 'VP8 ' && hex(bytes.subarray(23, 26)) === '9d012a') {
      width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383;
    } else if (kind === 'VP8L' && bytes[20] === 47) {
      const bits = view.getUint32(21, true); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1;
    }
  }
  if (!mime || !width || !height || width > 10000 || height > 10000 || width * height > 25000000) fail(400, 'Choose a valid JPEG, PNG or WebP photo up to 25 megapixels.');
  return { mime, width, height };
}
async function cleanup(env) {
  const { results } = await env.DB.prepare('SELECT object_key FROM pending_deletions LIMIT 20').all();
  for (const row of results) {
    try {
      await deletePhoto(env, row.object_key);
      await env.DB.prepare('DELETE FROM pending_deletions WHERE object_key=?').bind(row.object_key).run();
    } catch { console.error('Photo deletion deferred; retained for retry.'); }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()),
    env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(Date.now()),
  ]);
}
function backgroundCleanup(env, ctx) { ctx?.waitUntil(cleanup(env).catch(error => console.error('Cleanup failed:', error.message))); }
const postSelect = `SELECT p.*, u.name AS author, u.username,
  (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS like_count,
  (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comment_count,
  EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) AS liked
  FROM posts p JOIN users u ON u.id=p.user_id`;
async function enrich(env, posts, user) {
  if (!posts.length) return [];
  const { results: photos } = await env.DB.prepare(`SELECT id, post_id FROM images WHERE post_id IN (${posts.map(() => '?').join(',')}) ORDER BY position`).bind(...posts.map(p => p.id)).all();
  return posts.map(p => ({ ...p, liked: !!p.liked, can_delete: user?.id === p.user_id || user?.role === 'admin',
    images: photos.filter(i => i.post_id === p.id).map(i => ({ id: i.id, url: `/media/${i.id}` })) }));
}
async function getPost(env, postId) {
  const post = await env.DB.prepare('SELECT * FROM posts WHERE id=?').bind(id(postId)).first();
  if (!post) fail(404, 'This conversation is no longer available.');
  return post;
}
async function api(request, env, ctx) {
  const url = new URL(request.url); const path = url.pathname; const method = request.method;
  if (!env.DB) fail(503, 'The community is being set up. Please check back soon.');
  if (!['GET', 'HEAD'].includes(method)) {
    if (request.headers.get('X-VMATE-Request') !== '1' || (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin)) fail(403, 'Please submit from the vmate website.');
  }
  if (method === 'GET' && path === '/api/session') return json({ user: publicUser(await session(request, env)) });
  if (method === 'POST' && ['/api/register', '/api/login'].includes(path)) {
    await limit(request, env, 'auth', 25, 900);
    const data = await readJSON(request);
    const username = text(data.username, 'Username', 3, 24).toLowerCase();
    if (!/^[a-z0-9_]+$/.test(username)) fail(400, 'Use letters, numbers or underscores in your username.');
    if (typeof data.password !== 'string' || data.password.length < 10 || data.password.length > 128) fail(400, 'Use a password with 10–128 characters.');
    if (path === '/api/register') {
      await limit(request, env, 'register', 8, 3600);
      const name = text(data.name, 'Display name', 2, 40);
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      const user = { id: crypto.randomUUID(), username, name, role: 'member' };
      const password = await passwordHash(data.password, salt);
      try { await env.DB.prepare('INSERT INTO users(id,username,name,password_hash,salt,created_at) VALUES(?,?,?,?,?,?)').bind(user.id, username, name, password, salt, Date.now()).run(); }
      catch (error) { if (String(error).includes('UNIQUE')) fail(409, 'That username is taken. Please choose another.'); throw error; }
      backgroundCleanup(env, ctx);
      return issueSession(request, env, user);
    }
    const user = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
    const candidate = await passwordHash(data.password, user?.salt || '00000000000000000000000000000000');
    if (!user || candidate !== user.password_hash) fail(401, 'The username or password is incorrect.');
    backgroundCleanup(env, ctx);
    return issueSession(request, env, user);
  }
  if (method === 'POST' && path === '/api/logout') {
    const token = request.headers.get('cookie')?.match(/(?:^|;\s*)vmate_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  }
  if (method === 'GET' && path === '/api/posts') {
    const user = await session(request, env); const where = []; const values = [];
    const topic = url.searchParams.get('topic'), product = url.searchParams.get('product');
    if (TOPICS.has(topic)) { where.push('p.topic=?'); values.push(topic); }
    if (PRODUCTS.has(product)) { where.push('p.product=?'); values.push(product); }
    const search = (url.searchParams.get('q') || '').trim().slice(0, 100);
    if (search) { where.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')"); const term = `%${search.replace(/[\\%_]/g, '\\$&')}%`; values.push(term, term); }
    const filter = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const offset = Math.min(10000, Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0));
    const order = url.searchParams.get('sort') === 'popular' ? 'like_count DESC, p.created_at DESC, p.id' : 'p.created_at DESC, p.id';
    const { results } = await env.DB.prepare(`${postSelect}${filter} ORDER BY ${order} LIMIT 12 OFFSET ?`).bind(user?.id || '', ...values, offset).all();
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM posts p${filter}`).bind(...values).first();
    const stats = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM posts) AS posts, (SELECT COUNT(*) FROM images) AS photos, (SELECT COUNT(*) FROM users) AS members').first();
    return json({ posts: await enrich(env, results, user), total: count.total, stats, has_more: offset + results.length < count.total });
  }
  if (method === 'POST' && path === '/api/posts') {
    const user = await requireUser(request, env);
    await limit(request, env, 'post', 12, 3600, user.id);
    if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data')) fail(415, 'Please submit a story with its photos.');
    const bytes = await bodyBytes(request, 9 * 1024 * 1024);
    let form, data;
    try { form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('Content-Type') } }).formData(); data = JSON.parse(form.get('post')); if (!data || typeof data !== 'object') throw Error(); }
    catch { fail(400, 'The story could not be read.'); }
    const postId = id(data.id), title = text(data.title, 'Title', 3, 120), body = text(data.body, 'Story', 1, 3000);
    if (!PRODUCTS.has(data.product) || !TOPICS.has(data.topic)) fail(400, 'Please select a fragrance and topic.');
    const rating = data.rating == null ? null : data.rating;
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) fail(400, 'Choose a rating from 1 to 5.');
    const existing = await env.DB.prepare('SELECT user_id FROM posts WHERE id=?').bind(postId).first();
    if (existing) { if (existing.user_id !== user.id) fail(409, 'Please start a new story.'); return json({ id: postId }); }
    const files = form.getAll('photos');
    if (files.length > 4) fail(400, 'You can add up to 4 photos.');
    if (data.topic === 'photos' && !files.length) fail(400, 'Add a photo to share in Photos & setups.');
    const images = [];
    for (const file of files) {
      if (typeof file === 'string' || !file.size || file.size > 2 * 1024 * 1024) fail(400, 'Each prepared photo must be no larger than 2 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer()); const info = imageInfo(bytes);
      const imageId = crypto.randomUUID(); images.push({ id: imageId, key: createPhotoKey(env, postId, imageId), bytes, mime: info.mime });
    }
    try {
      for (const image of images) await putPhoto(env, image);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?)').bind(postId, user.id, title, body, data.product, data.topic, rating, Date.now()),
        ...images.map((image, i) => env.DB.prepare('INSERT INTO images VALUES(?,?,?,?,?)').bind(image.id, postId, image.key, image.mime, i)),
      ]);
    } catch (error) {
      if (images.length) {
        await env.DB.batch(images.map(image => env.DB.prepare('INSERT OR IGNORE INTO pending_deletions VALUES(?)').bind(image.key)));
        backgroundCleanup(env, ctx);
      }
      throw error;
    }
    return json({ id: postId }, 201);
  }
  const postRoute = path.match(/^\/api\/posts\/([^/]+)(?:\/(comments|like|report))?$/);
  if (postRoute) {
    const [, postId, action] = postRoute;
    const post = await getPost(env, postId);
    if (method === 'GET' && !action) {
      const user = await session(request, env);
      const row = await env.DB.prepare(`${postSelect} WHERE p.id=?`).bind(user?.id || '', postId).first();
      return json({ post: (await enrich(env, [row], user))[0] });
    }
    if (method === 'GET' && action === 'comments') {
      const user = await session(request, env);
      const offset = Math.max(0, Math.min(10000, parseInt(url.searchParams.get('offset'), 10) || 0));
      const { results } = await env.DB.prepare('SELECT c.*, u.name AS author FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.created_at,c.id LIMIT 30 OFFSET ?').bind(postId, offset).all();
      const { total } = await env.DB.prepare('SELECT COUNT(*) AS total FROM comments WHERE post_id=?').bind(postId).first();
      return json({ comments: results.map(c => ({ ...c, can_delete: c.user_id === user?.id || user?.role === 'admin' })), has_more: offset + results.length < total });
    }
    const user = await requireUser(request, env);
    if (method === 'DELETE' && !action) {
      if (user.id !== post.user_id && user.role !== 'admin') fail(403, 'You can only delete your own stories.');
      await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO pending_deletions SELECT object_key FROM images WHERE post_id=?').bind(postId),
        env.DB.prepare('DELETE FROM posts WHERE id=?').bind(postId),
      ]);
      backgroundCleanup(env, ctx); return json({ ok: true });
    }
    if (method === 'POST' && action === 'comments') {
      await limit(request, env, 'comment', 50, 3600, user.id);
      const data = await readJSON(request); const commentId = id(data.id); const body = text(data.body, 'Reply', 1, 1000);
      const existing = await env.DB.prepare('SELECT user_id,post_id FROM comments WHERE id=?').bind(commentId).first();
      if (existing && (existing.user_id !== user.id || existing.post_id !== postId)) fail(409, 'Please write a new reply.');
      if (!existing) await env.DB.prepare('INSERT INTO comments VALUES(?,?,?,?,?)').bind(commentId, postId, user.id, body, Date.now()).run();
      return json({ id: commentId }, 201);
    }
    if (method === 'POST' && action === 'like') {
      await limit(request, env, 'like', 120, 300, user.id);
      const data = await readJSON(request);
      if (typeof data.liked !== 'boolean') fail(400, 'Choose a reaction.');
      if (data.liked) await env.DB.prepare('INSERT OR IGNORE INTO likes VALUES(?,?)').bind(postId, user.id).run();
      else await env.DB.prepare('DELETE FROM likes WHERE post_id=? AND user_id=?').bind(postId, user.id).run();
      const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM likes WHERE post_id=?').bind(postId).first();
      return json({ liked: data.liked, count });
    }
    if (method === 'POST' && action === 'report') {
      await limit(request, env, 'report', 20, 3600, user.id);
      const data = await readJSON(request); const reason = text(data.reason, 'Reason', 3, 500);
      const commentId = data.comment_id ? id(data.comment_id) : null;
      if (commentId && !await env.DB.prepare('SELECT id FROM comments WHERE id=? AND post_id=?').bind(commentId, postId).first()) fail(404, 'This reply is no longer available.');
      await env.DB.prepare('INSERT OR IGNORE INTO reports VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), postId, commentId, user.id, reason, Date.now()).run();
      return json({ ok: true }, 201);
    }
  }
  const commentRoute = path.match(/^\/api\/comments\/([^/]+)$/);
  if (method === 'DELETE' && commentRoute) {
    const user = await requireUser(request, env); const commentId = id(commentRoute[1]);
    const comment = await env.DB.prepare('SELECT * FROM comments WHERE id=?').bind(commentId).first();
    if (!comment) fail(404, 'This reply is no longer available.');
    if (user.id !== comment.user_id && user.role !== 'admin') fail(403, 'You can only delete your own replies.');
    await env.DB.prepare('DELETE FROM comments WHERE id=?').bind(commentId).run(); return json({ ok: true });
  }
  if (path === '/api/reports' || /^\/api\/reports\/[^/]+$/.test(path)) {
    const user = await requireUser(request, env);
    if (user.role !== 'admin') fail(403, 'This page is for community moderators.');
    if (method === 'GET' && path === '/api/reports') {
      const { results } = await env.DB.prepare(`SELECT r.*, p.title, c.body AS comment_body, u.name AS reporter FROM reports r
        JOIN posts p ON p.id=r.post_id JOIN users u ON u.id=r.user_id LEFT JOIN comments c ON c.id=r.comment_id ORDER BY r.created_at LIMIT 100`).all();
      return json({ reports: results });
    }
    if (method === 'DELETE') { await env.DB.prepare('DELETE FROM reports WHERE id=?').bind(id(path.split('/').at(-1))).run(); return json({ ok: true }); }
  }
  fail(404, 'This community page could not be found.');
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return await api(request, env, ctx);
      if (url.pathname.startsWith('/media/')) {
        if (!['GET', 'HEAD'].includes(request.method)) fail(405, 'Method not allowed.');
        const imageId = id(url.pathname.slice(7));
        const image = await env.DB.prepare('SELECT object_key,mime FROM images WHERE id=?').bind(imageId).first();
        if (!image) fail(404, 'This photo is no longer available.');
        const object = await getPhoto(env, image.object_key, request.method);
        if (!object) fail(404, 'This photo is no longer available.');
        return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
          'Content-Type': object.mime || image.mime, 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'no-cache',
          ...(object.size != null ? { 'Content-Length': String(object.size) } : {}),
          ...(object.httpEtag ? { 'ETag': object.httpEtag } : {}),
        } });
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      const known = error instanceof HttpError || error instanceof PhotoStorageError;
      if (!known) console.error('Community request failed:', error.message);
      return json({ error: known ? error.message : 'The community is temporarily unavailable. Please try again.' }, known ? error.status : 503);
    }
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(cleanup(env)); },
};
