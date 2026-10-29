// Only this server module handles Cloudinary credentials. Stored keys identify the
// provider, so existing R2 images keep working when new uploads use Cloudinary.
export class PhotoStorageError extends Error {
  constructor(message = 'Photo storage is temporarily unavailable. Please try again.') {
    super(message); this.status = 503;
  }
}
const cloudPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const publicIdPattern = /^vmate\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/;
const formats = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
function config(env) {
  const cloud = env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = env.CLOUDINARY_API_KEY?.trim();
  const secret = env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudPattern.test(cloud || '') || !apiKey || !secret) {
    throw new PhotoStorageError('Photo uploads are not configured yet. You can still publish a story without photos.');
  }
  return { cloud, apiKey, secret };
}
function parseKey(key) {
  if (!key.startsWith('cloudinary:')) return null;
  const [, cloud, publicId, extra] = key.split(':');
  if (extra !== undefined || !cloudPattern.test(cloud || '') || !publicIdPattern.test(publicId || '')) throw new PhotoStorageError();
  return { cloud, publicId };
}
function r2(env) { if (!env.PHOTOS) throw new PhotoStorageError('Photo storage is not configured yet.'); return env.PHOTOS; }
export function createPhotoKey(env, postId, imageId) {
  if (env.CLOUDINARY_CLOUD_NAME || env.CLOUDINARY_API_KEY || env.CLOUDINARY_API_SECRET) {
    return `cloudinary:${config(env).cloud}:vmate/${postId}/${imageId}`;
  }
  if (env.PHOTOS) return `${postId}/${imageId}`;
  throw new PhotoStorageError('Photo uploads are not configured yet. You can still publish a story without photos.');
}
async function fetchStorage(url, init) {
  // Workers supports manual/follow; callers reject non-2xx responses, including redirects.
  try { return await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
  catch { throw new PhotoStorageError(); }
}
async function signedRequest(env, target, action, parameters, file) {
  const { cloud, apiKey, secret } = config(env);
  if (cloud !== target.cloud) throw new PhotoStorageError();
  const params = { ...parameters, public_id: target.publicId, timestamp: String(Math.floor(Date.now() / 1000)) };
  const input = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&') + secret;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const signature = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.append(key, value);
  form.append('api_key', apiKey); form.append('signature', signature);
  if (file) form.append('file', new Blob([file.bytes], { type: file.mime }), `photo.${formats[file.mime]}`);
  const response = await fetchStorage(`https://api.cloudinary.com/v1_1/${cloud}/image/${action}`, { method: 'POST', body: form });
  if (!response.ok) { await response.body?.cancel(); throw new PhotoStorageError(); }
  try { return await response.json(); } catch { throw new PhotoStorageError(); }
}
export async function putPhoto(env, image) {
  const target = parseKey(image.key);
  if (!target) return r2(env).put(image.key, image.bytes, { httpMetadata: { contentType: image.mime } });
  const result = await signedRequest(env, target, 'upload', { overwrite: 'false' }, image);
  if (result.public_id !== target.publicId || result.resource_type !== 'image' || result.type !== 'upload' ||
      result.format !== formats[image.mime]) throw new PhotoStorageError();
}
export async function getPhoto(env, key, method = 'GET') {
  const target = parseKey(key);
  if (!target) return r2(env).get(key);
  // v1 disambiguates a public ID containing folders from transformation syntax.
  const response = await fetchStorage(`https://res.cloudinary.com/${target.cloud}/image/upload/v1/${target.publicId}`, { method });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  const mime = response.headers.get('Content-Type')?.split(';')[0];
  if (!response.ok || !formats[mime]) { await response.body?.cancel(); throw new PhotoStorageError(); }
  return { body: response.body, size: response.headers.get('Content-Length'), httpEtag: response.headers.get('ETag'), mime };
}
export async function deletePhoto(env, key) {
  const target = parseKey(key);
  if (!target) return r2(env).delete(key);
  const result = await signedRequest(env, target, 'destroy', { invalidate: 'true' });
  if (!['ok', 'not found'].includes(result.result)) throw new PhotoStorageError();
}
