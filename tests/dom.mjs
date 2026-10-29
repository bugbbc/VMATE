// Lower-privilege frontend check for environments that cannot launch Chromium.
// This verifies DOM rendering and event handlers, not visual layout or canvas encoding.
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const origin = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw Error('Local test server required.');
const html = await readFile(new URL('../community.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../assets/community/community.js', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: `${origin}/community.html`, runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
let cookie = '', postId, errors = [];
window.addEventListener('error', event => errors.push(event.error || event.message));
Object.defineProperty(window, 'crypto', { value: webcrypto });
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
window.HTMLElement.prototype.scrollIntoView = function () {};
const originalFormData = window.FormData;
// Preserve browser form parsing, while adapting binary/multipart requests for Node Fetch.
window.fetch = async (url, options = {}) => {
  let body = options.body;
  if (body instanceof originalFormData) {
    const converted = new FormData();
    for (const [name, value] of body) converted.append(name, value);
    body = converted;
  }
  const response = await fetch(new URL(url, origin), { ...options, body,
    headers: { ...options.headers, Cookie: cookie, Origin: origin } });
  const updated = response.headers.get('set-cookie'); if (updated) cookie = updated.split(';')[0];
  return response;
};
const $ = selector => window.document.querySelector(selector);
function input(selector, value) { $(selector).value = value; $(selector).dispatchEvent(new window.Event('input', { bubbles: true })); }
function submit(selector) { $(selector).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }
async function until(condition, description) {
  for (let i = 0; i < 200; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error(`Timed out: ${description}; visible error: ${$('.form-error:not([hidden])')?.textContent || $('#feed-status').textContent}`);
}
try {
  window.eval(script);
  await until(() => $('#feed').getAttribute('aria-busy') === 'false', 'initial feed');
  $('[data-compose]').click(); assert.equal($('#auth-dialog').open, true);
  input('#auth-form [name=name]', 'QA DOM member'); input('#auth-form [name=username]', `qa_dom_${Date.now()}`);
  input('#auth-form [name=password]', 'DOM-test-password-2026!'); submit('#auth-form');
  await until(() => $('#compose-dialog').open, 'register and open composer');
  input('#post-form [name=title]', 'QA DOM story'); input('#post-body', 'Hello <img src=x onerror=alert(1)> 中文');
  $('#post-body').setSelectionRange($('#post-body').value.length, $('#post-body').value.length);
  $('#post-body').dispatchEvent(new window.Event('select'));
  $('#compose-dialog .emoji-toggle').click();
  $('#compose-dialog [aria-label="Insert 🌿"]').click();
  assert.match($('#post-body').value, /🌿$/);
  assert.equal(Number($('#body-count').textContent), $('#post-body').value.length);
  submit('#post-form'); await until(() => $('.post-card'), 'publish and render');
  postId = new URL(window.location.href).searchParams.get('post'); assert.ok(postId);
  assert.equal($('.post-body img'), null); assert.match($('.post-body').textContent, /<img/);
  $('.post-actions [aria-label="Love this story"]').click();
  await until(() => $('.post-actions [aria-label="Love this story"]').getAttribute('aria-pressed') === 'true', 'like');
  $('.post-actions [aria-controls]').click(); await until(() => $('.reply-form textarea'), 'reply form');
  input('.reply-form textarea', 'Reply 😍 中文'); submit('.reply-form');
  await until(() => $('.comment'), 'reply persisted'); assert.match($('.comment').textContent, /Reply 😍 中文/);
  const response = await fetch(`${origin}/api/posts/${postId}`); const stored = await response.json(); assert.equal(stored.post.comment_count, 1);
  $('.post-actions .push-right').click(); await until(() => $('#report-dialog').open, 'report form');
  input('#report-form textarea', 'QA test report'); submit('#report-form'); await until(() => !$('#report-dialog').open, 'report submit');
  $('#product-filter').value = 'lavender'; $('#product-filter').dispatchEvent(new window.Event('change'));
  await until(() => $('#feed').getAttribute('aria-busy') === 'false' && $('.empty-state'), 'filtered empty state');
  $('.empty-state button').click(); await until(() => $('.post-card'), 'clear filters');
  const deleteButton = [...window.document.querySelectorAll('.post-actions button')].find(button => button.textContent === 'Delete');
  deleteButton.click(); $('#confirm-action').click();
  await until(() => !$('#confirm-dialog').open && !$('.post-card'), 'delete story'); postId = null;
  $('#logout').click(); await until(() => !$('#auth-open').hidden, 'logout');
  assert.deepEqual(errors, []);
  console.log('PASS: DOM registration, composer, emoji insertion, publish, safe text rendering, likes, comments, reports, filters, deletion and logout against real local Cloudflare API.');
} finally {
  if (postId) await fetch(`${origin}/api/posts/${postId}`, { method: 'DELETE', headers: { Cookie: cookie, Origin: origin, 'X-VMATE-Request': '1' } });
  window.close();
}
