'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const PRODUCTS = { 'white-tea': 'White Tea Muse', lavender: 'Dreamy Lavender', osmanthus: 'Osmanthus Moon', 'discovery-set': 'Discovery Set', general: 'Just chatting' };
const TOPICS = { all: 'All conversations', stories: 'Scent stories', photos: 'Photos & setups', questions: 'Tips & questions' };
const EMOJI = ['😊', '😍', '🥰', '✨', '💙', '💜', '🤍', '🌿', '🌸', '🚗', '☀️', '🙌', '👍', '🎉', '🤔', '🙏'];
let user = null, authMode = 'register', authNext = null, feedVersion = 0, offset = 0;
let topic = 'all', product = 'all', search = '', photos = [], processingPhotos = false, publishing = false;
let draftId = crypto.randomUUID(), reportTarget = null, photoGallery = [], photoIndex = 0, photoTitle = '', confirmation = null;
const initial = new URLSearchParams(location.search);
let selectedPost = initial.get('post');
if (PRODUCTS[initial.get('product')]) { product = initial.get('product'); $('#product-filter').value = product; }
function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`); svg.setAttribute('aria-hidden', 'true'); svg.append(use); return svg;
}
function button(label, className, action, iconName) {
  const node = el('button', className); node.type = 'button';
  if (iconName) node.append(icon(iconName));
  node.append(el('span', '', label));
  if (action) node.addEventListener('click', action);
  return node;
}
function showError(target, message) { target.textContent = message || ''; target.hidden = !message; }
let toastTimer;
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 5000); }
function openDialog(dialog) { if (!dialog.open) dialog.showModal(); }
async function api(path, options = {}) {
  const headers = { 'X-VMATE-Request': '1' };
  if (options.body && !(options.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.body); }
  let response;
  try { response = await fetch(path, { credentials: 'same-origin', ...options, headers }); }
  catch { throw new Error('Couldn’t connect. Your changes are still here — please try again.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('The community is unavailable right now. Please try again shortly.'); }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') { user = null; updateAccount(); }
    const error = new Error(data.error || 'Something went wrong. Please try again.'); error.status = response.status; throw error;
  }
  return data;
}
function updateAccount() {
  $('#auth-open').hidden = !!user; $('#logout').hidden = !user; $('#account-name').hidden = !user;
  $('#account-name').textContent = user ? `Hi, ${user.name}` : '';
  $('#moderation-open').hidden = user?.role !== 'admin';
}
function needAuth(next) {
  if (user) { next(); return; }
  authNext = next; showError($('#auth-error'), ''); openDialog($('#auth-dialog'));
}
function setAuthMode(mode) {
  authMode = mode; const register = mode === 'register';
  $('#name-field').hidden = !register; $('#name-field input').required = register;
  $('#auth-form [name=password]').autocomplete = register ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = register ? 'Create account ↗' : 'Sign in ↗';
  $('#register-tab').classList.toggle('active', register); $('#register-tab').setAttribute('aria-pressed', String(register));
  $('#login-tab').classList.toggle('active', !register); $('#login-tab').setAttribute('aria-pressed', String(!register));
  showError($('#auth-error'), '');
}
$('#register-tab').addEventListener('click', () => setAuthMode('register'));
$('#login-tab').addEventListener('click', () => setAuthMode('login'));
$('#auth-open').addEventListener('click', () => { authNext = null; showError($('#auth-error'), ''); openDialog($('#auth-dialog')); });
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = $('#auth-submit'); submit.disabled = true; showError($('#auth-error'), '');
  try {
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const result = await api(`/api/${authMode}`, { method: 'POST', body: data });
    user = result.user; updateAccount(); $('#auth-form').reset(); $('#auth-dialog').close();
    toast(`Welcome${authMode === 'login' ? ' back' : ''}, ${user.name}.`);
    const next = authNext; authNext = null; if (next) next();
    await loadFeed();
  } catch (error) { showError($('#auth-error'), error.message); }
  finally { submit.disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  $('#logout').disabled = true;
  try { await api('/api/logout', { method: 'POST' }); user = null; updateAccount(); toast('You’re signed out. See you on your next drive.'); await loadFeed(); }
  catch (error) { toast(error.message); }
  finally { $('#logout').disabled = false; }
});
$$('[data-close]').forEach(node => node.addEventListener('click', () => {
  const dialog = node.closest('dialog');
  if (dialog.id === 'compose-dialog' && publishing) return;
  dialog.close();
}));
$$('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) { if (!(dialog.id === 'compose-dialog' && publishing)) dialog.close(); } });
});
$('#compose-dialog').addEventListener('cancel', event => { if (publishing) event.preventDefault(); });
$('#guidelines-open').addEventListener('click', () => openDialog($('#guidelines-dialog')));
function compose() {
  needAuth(() => {
    if (!$('#post-form [name=title]').value && !$('#post-body').value) {
      $('#post-form [name=product]').value = product === 'all' ? 'general' : product;
      $('#post-form [name=topic]').value = topic === 'all' ? 'stories' : topic;
    }
    openDialog($('#compose-dialog'));
  });
}
$$('[data-compose]').forEach(node => node.addEventListener('click', compose));
function setupEmoji(root) {
  $$('.emoji-picker', root).forEach(picker => {
    if (picker.dataset.ready) return; picker.dataset.ready = 'true';
    const textarea = document.getElementById(picker.dataset.for), toggle = $('.emoji-toggle', picker), options = $('.emoji-options', picker);
    // Keep the caret when the user opens the picker or chooses an emoji.
    let start = textarea.selectionStart, end = textarea.selectionEnd;
    ['keyup', 'click', 'select', 'input', 'blur'].forEach(type => textarea.addEventListener(type, () => { start = textarea.selectionStart; end = textarea.selectionEnd; }));
    toggle.addEventListener('click', () => { options.hidden = !options.hidden; toggle.setAttribute('aria-expanded', String(!options.hidden)); });
    for (const emoji of EMOJI) {
      const choice = button(emoji, '', () => {
        if (textarea.value.length - (end - start) + emoji.length > textarea.maxLength) return;
        textarea.setRangeText(emoji, start, end, 'end'); start = end = textarea.selectionEnd;
        textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.focus();
      }); choice.setAttribute('aria-label', `Insert ${emoji}`); options.append(choice);
    }
  });
}
setupEmoji(document);
$('#post-body').addEventListener('input', () => { $('#body-count').textContent = $('#post-body').value.length.toLocaleString(); });
function renderPreviews() {
  $('#photo-previews').replaceChildren();
  photos.forEach((photo, index) => {
    const item = el('div', 'photo-preview'), img = el('img'); img.src = photo.url; img.alt = `Selected photo ${index + 1}: ${photo.name}`;
    const remove = button('', 'icon-button', () => { if (publishing || processingPhotos) return; URL.revokeObjectURL(photo.url); photos.splice(index, 1); renderPreviews(); }, 'close'); remove.setAttribute('aria-label', `Remove photo ${index + 1}`);
    item.append(img, remove, el('p', '', photo.name)); $('#photo-previews').append(item);
  });
}
async function preparePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Please choose JPG, PNG or WebP photos.');
  if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is larger than 8 MB. Please choose a smaller photo.`);
  const url = URL.createObjectURL(file), img = new Image();
  try {
    img.src = url; await img.decode();
    if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 25000000) throw new Error('Please choose a photo up to 25 megapixels.');
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .86));
    if (!blob || blob.size > 2 * 1024 * 1024) throw new Error('This photo is too large to prepare. Please choose a smaller photo.');
    return { blob, url: URL.createObjectURL(blob), name: file.name, key: `${file.name}:${file.size}:${file.lastModified}` };
  } finally { URL.revokeObjectURL(url); }
}
async function addPhotos(files) {
  if (processingPhotos || publishing) return;
  processingPhotos = true; $('#post-submit').disabled = true; $('#photo-input').disabled = true; showError($('#post-error'), '');
  const errors = [];
  try {
    for (const file of files) {
      if (photos.some(photo => photo.key === `${file.name}:${file.size}:${file.lastModified}`)) continue;
      if (photos.length >= 4) { errors.push('You can share up to 4 photos. Remove one to add another.'); break; }
      try { photos.push(await preparePhoto(file)); renderPreviews(); } catch (error) { errors.push(error.name === 'EncodingError' ? `${file.name} couldn’t be read. Please choose another image.` : error.message); }
    }
  } finally { processingPhotos = false; $('#post-submit').disabled = false; $('#photo-input').disabled = false; $('#photo-input').value = ''; showError($('#post-error'), errors.join(' ')); }
}
$('#photo-input').addEventListener('change', event => addPhotos([...event.target.files]));
const dropZone = $('#drop-zone');
['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('drag-over'); }));
['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('drag-over'); }));
dropZone.addEventListener('drop', event => addPhotos([...event.dataTransfer.files]));
$('#post-form').addEventListener('submit', async event => {
  event.preventDefault(); if (processingPhotos || publishing) return;
  if (!user) { needAuth(() => toast('You’re signed in. Your story is ready to publish.')); return; }
  const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
  data.id = draftId; data.rating = data.rating ? Number(data.rating) : null;
  if (!data.title.trim() || !data.body.trim()) { showError($('#post-error'), 'Add a title and a few words about your experience.'); return; }
  if (data.topic === 'photos' && !photos.length) { showError($('#post-error'), 'Add a photo to share in Photos & setups.'); return; }
  const payload = new FormData(); payload.append('post', JSON.stringify(data)); photos.forEach((photo, i) => payload.append('photos', photo.blob, `photo-${i + 1}.jpg`));
  publishing = true; showError($('#post-error'), '');
  const controls = $$('input,textarea,select,button', form); controls.forEach(control => control.disabled = true); $('#post-submit').textContent = 'Publishing…';
  try {
    const result = await api('/api/posts', { method: 'POST', body: payload });
    photos.forEach(photo => URL.revokeObjectURL(photo.url)); photos = []; renderPreviews(); form.reset(); $('#body-count').textContent = '0'; draftId = crypto.randomUUID();
    $('#compose-dialog').close(); toast('Your story is live. Thanks for sharing a little of your world.');
    selectedPost = result.id; history.replaceState({}, '', `?post=${result.id}#conversations`); await loadFeed(); $('#conversations').scrollIntoView({ behavior: 'smooth' });
  } catch (error) { showError($('#post-error'), error.message); }
  finally { publishing = false; controls.forEach(control => control.disabled = false); $('#post-submit').replaceChildren(document.createTextNode('Publish story '), icon('arrow')); }
});
window.addEventListener('beforeunload', event => { if (photos.length || $('#post-body').value.trim() || $('#post-form [name=title]').value.trim()) { event.preventDefault(); event.returnValue = ''; } });
function dateLabel(timestamp) { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp)); }
function avatar(name) { const node = el('span', `avatar tone-${name.codePointAt(0) % 4}`, [...name][0]?.toUpperCase() || 'V'); node.setAttribute('aria-hidden', 'true'); return node; }
function setGallery(images, index, title) { photoGallery = images; photoIndex = index; photoTitle = title; updatePhoto(); openDialog($('#lightbox')); }
function updatePhoto() { const image = photoGallery[photoIndex]; $('#lightbox-image').src = image.url; $('#lightbox-image').alt = `${photoTitle} — photo ${photoIndex + 1}`; $('#lightbox-caption').textContent = `${photoTitle} · ${photoIndex + 1} / ${photoGallery.length}`; $('#photo-prev').hidden = $('#photo-next').hidden = photoGallery.length < 2; }
function movePhoto(delta) { photoIndex = (photoIndex + delta + photoGallery.length) % photoGallery.length; updatePhoto(); }
$('#photo-prev').addEventListener('click', () => movePhoto(-1)); $('#photo-next').addEventListener('click', () => movePhoto(1));
$('#lightbox').addEventListener('keydown', event => { if (event.key === 'ArrowLeft') movePhoto(-1); if (event.key === 'ArrowRight') movePhoto(1); });
function askDelete(title, action) { $('#confirm-title').textContent = title; confirmation = action; $('#confirm-description').textContent = 'This will permanently remove the content and any attached photos. This cannot be undone.'; openDialog($('#confirm-dialog')); }
$('#confirm-action').addEventListener('click', async () => {
  const btn = $('#confirm-action'); btn.disabled = true;
  try { await confirmation(); $('#confirm-dialog').close(); }
  catch (error) { $('#confirm-description').textContent = error.message; }
  finally { btn.disabled = false; }
});
function report(postId, commentId = null) { needAuth(() => { reportTarget = { postId, commentId }; $('#report-form').reset(); showError($('#report-error'), ''); openDialog($('#report-dialog')); }); }
$('#report-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = $('button[type=submit]', event.currentTarget); submit.disabled = true;
  try { await api(`/api/posts/${reportTarget.postId}/report`, { method: 'POST', body: { reason: event.currentTarget.elements.reason.value, comment_id: reportTarget.commentId } }); $('#report-dialog').close(); toast('Thank you. Your report has been sent to our moderators.'); }
  catch (error) { showError($('#report-error'), error.message); }
  finally { submit.disabled = false; }
});
function renderPost(post) {
  const card = el('article', 'post-card'); card.id = `post-${post.id}`;
  const top = el('div', 'post-top'), author = el('div'); author.append(el('p', 'author-name', post.author));
  const time = el('time', 'post-date', dateLabel(post.created_at)); time.dateTime = new Date(post.created_at).toISOString(); author.append(time);
  top.append(avatar(post.author), author, el('span', 'post-topic', TOPICS[post.topic]));
  card.append(top, el('h3', '', post.title), el('p', 'post-body', post.body));
  const tags = el('div', 'post-tags'); tags.append(el('span', `scent-tag ${post.product}`, PRODUCTS[post.product]));
  if (post.rating) { const stars = el('span', 'stars', '★'.repeat(post.rating) + '☆'.repeat(5 - post.rating)); stars.setAttribute('aria-label', `${post.rating} out of 5 stars`); tags.append(stars); }
  card.append(tags);
  if (post.images.length) {
    const grid = el('div', `post-photos${post.images.length === 1 ? ' single' : ''}`);
    post.images.forEach((photo, i) => { const view = button('', '', () => setGallery(post.images, i, post.title)); view.replaceChildren(); view.setAttribute('aria-label', `View photo ${i + 1} of ${post.images.length}: ${post.title}`); const image = el('img'); image.src = photo.url; image.alt = `${post.title} — photo ${i + 1}`; image.loading = 'lazy'; image.decoding = 'async'; view.append(image); grid.append(view); }); card.append(grid);
  }
  const actions = el('div', 'post-actions');
  const like = button(String(post.like_count), 'action', () => needAuth(async () => {
    like.disabled = true;
    try { const result = await api(`/api/posts/${post.id}/like`, { method: 'POST', body: { liked: !post.liked } }); post.liked = result.liked; $('span', like).textContent = result.count; like.setAttribute('aria-pressed', String(result.liked)); }
    catch (error) { toast(error.message); } finally { like.disabled = false; }
  }), 'heart'); like.setAttribute('aria-label', 'Love this story'); like.setAttribute('aria-pressed', String(post.liked));
  const comments = el('section', 'comments'); comments.id = `comments-${post.id}`; comments.hidden = true; comments.setAttribute('aria-label', `Replies to ${post.title}`);
  const reply = button(`${post.comment_count} replies`, 'action', async () => { comments.hidden = !comments.hidden; reply.setAttribute('aria-expanded', String(!comments.hidden)); if (!comments.hidden && !comments.dataset.loaded) await loadComments(post, comments, reply); }, 'chat'); reply.setAttribute('aria-expanded', 'false'); reply.setAttribute('aria-controls', comments.id);
  const copy = button('Share', 'action', async () => {
    const url = new URL('community.html', location.href); url.searchParams.set('post', post.id);
    try { await navigator.clipboard.writeText(url.href); toast('Story link copied.'); }
    catch { toast('Open this story and copy the link from your address bar.'); history.replaceState({}, '', url); }
  }, 'link');
  actions.append(like, reply, copy, button('Report', 'action subtle push-right', () => report(post.id)));
  if (post.can_delete) actions.append(button('Delete', 'action subtle', () => askDelete('Delete this story?', async () => { await api(`/api/posts/${post.id}`, { method: 'DELETE' }); if (selectedPost === post.id) resetSelection(); await loadFeed(); toast('Story deleted.'); })));
  card.append(actions, comments); return card;
}
async function loadComments(post, container, replyButton) {
  container.replaceChildren(el('p', 'comments-message', 'Loading replies…')); let commentOffset = 0;
  try {
    const data = await api(`/api/posts/${post.id}/comments`); container.replaceChildren();
    const list = el('div', 'comment-list');
    const makeComment = comment => {
      const node = el('article', 'comment'), top = el('div', 'comment-top'); top.append(avatar(comment.author), el('strong', 'author-name', comment.author), el('span', 'post-date', dateLabel(comment.created_at)));
      node.append(top, el('p', '', comment.body));
      node.append(button('Report', 'action subtle', () => report(post.id, comment.id)));
      if (comment.can_delete) node.append(button('Delete', 'action subtle', () => askDelete('Delete this reply?', async () => { await api(`/api/comments/${comment.id}`, { method: 'DELETE' }); post.comment_count--; $('span', replyButton).textContent = `${post.comment_count} replies`; await loadComments(post, container, replyButton); toast('Reply deleted.'); })));
      return node;
    };
    if (!data.comments.length) list.append(el('p', 'comments-message', 'Be the first to say hello.'));
    data.comments.forEach(comment => list.append(makeComment(comment))); commentOffset = data.comments.length;
    const more = button('More replies ↓', 'action comments-more', async () => {
      more.disabled = true;
      try { const next = await api(`/api/posts/${post.id}/comments?offset=${commentOffset}`); next.comments.forEach(comment => list.append(makeComment(comment))); commentOffset += next.comments.length; more.hidden = !next.has_more; }
      catch (error) { toast(error.message); } finally { more.disabled = false; }
    }); more.hidden = !data.has_more; container.append(list, more);
    if (user) {
      const form = el('form', 'reply-form'), label = el('label', '', 'Keep the conversation going'), textarea = el('textarea'); textarea.id = `reply-${post.id}`; textarea.name = 'body'; textarea.required = true; textarea.maxLength = 1000; textarea.rows = 2; textarea.placeholder = 'A kind word, a good question…'; label.htmlFor = textarea.id;
      const controls = el('div', 'reply-tools'), picker = el('div', 'emoji-picker'); picker.dataset.for = textarea.id;
      const toggle = button('Emoji', 'emoji-toggle', null, 'smile'); toggle.setAttribute('aria-expanded', 'false'); const options = el('div', 'emoji-options'); options.hidden = true; picker.append(toggle, options);
      const submit = button('Post reply', 'button primary'); submit.type = 'submit'; controls.append(picker, submit);
      const errorBox = el('p', 'form-error'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
      form.append(label, textarea, controls, errorBox); container.append(form); setupEmoji(container);
      let replyId = crypto.randomUUID();
      form.addEventListener('submit', async event => {
        event.preventDefault(); submit.disabled = true; textarea.disabled = true; showError(errorBox, '');
        try { await api(`/api/posts/${post.id}/comments`, { method: 'POST', body: { id: replyId, body: textarea.value } }); replyId = crypto.randomUUID(); post.comment_count++; $('span', replyButton).textContent = `${post.comment_count} replies`; await loadComments(post, container, replyButton); toast('Reply posted.'); }
        catch (error) { showError(errorBox, error.message); } finally { submit.disabled = false; textarea.disabled = false; }
      });
    } else container.append(button('Sign in to reply ↗', 'button secondary', () => needAuth(() => {})));
    container.dataset.loaded = 'true';
  } catch (error) { container.replaceChildren(el('p', 'comments-message', error.message), button('Try again', 'button secondary', () => loadComments(post, container, replyButton))); }
}
function emptyState(filtered) {
  const empty = el('div', 'empty-state'); empty.append(el('div', 'empty-symbol', filtered ? '⌕' : 'hello.'));
  empty.append(el('h3', '', filtered ? 'A fresh trail to explore.' : 'Every journey starts with a hello.'));
  empty.append(el('p', '', filtered ? 'No conversations match just yet. Try another fragrance or start one of your own.' : 'How did vmate find a place in your everyday? Share your first impressions, a photo of your setup, or a question for the community.'));
  empty.append(button(filtered ? 'Clear filters' : 'Share the first story', 'button primary', filtered ? () => { resetFilters(); loadFeed(); } : compose, 'plus'));
  if (!filtered) { const ideas = el('div', 'starter-ideas'); ['🚗 Your car setup', '🌿 Your favourite scent', '💬 Your first impressions'].forEach(idea => ideas.append(el('span', '', idea))); empty.append(ideas); }
  return empty;
}
function resetSelection() { selectedPost = null; const url = new URL(location.href); url.searchParams.delete('post'); history.replaceState({}, '', url); }
function resetFilters() {
  topic = 'all'; product = 'all'; search = ''; resetSelection(); $('#search-input').value = ''; $('#product-filter').value = 'all'; $('#sort').value = 'newest';
  $$('.topic').forEach(node => { const active = node.dataset.topic === topic; node.classList.toggle('active', active); node.setAttribute('aria-pressed', String(active)); });
}
async function loadFeed(append = false) {
  const version = ++feedVersion; if (!append) offset = 0;
  const status = $('#feed-status'), feed = $('#feed'); feed.setAttribute('aria-busy', 'true'); $('#load-more').disabled = true;
  if (!append) { feed.replaceChildren(); status.textContent = 'Finding your next inspiration…'; }
  $('#feed-end').hidden = true;
  try {
    const params = new URLSearchParams({ topic, product, q: search, sort: $('#sort').value, offset: String(offset) });
    const data = selectedPost ? await api(`/api/posts/${encodeURIComponent(selectedPost)}`) : await api(`/api/posts?${params}`);
    if (version !== feedVersion) return;
    status.replaceChildren();
    const posts = selectedPost ? [data.post] : data.posts;
    if (selectedPost) status.append(button('← Back to all conversations', 'text-link', () => { resetSelection(); loadFeed(); }));
    if (!append) feed.replaceChildren();
    if (!posts.length && !append) feed.append(emptyState(topic !== 'all' || product !== 'all' || !!search));
    posts.forEach(post => feed.append(renderPost(post))); offset += posts.length;
    $('#result-count').textContent = selectedPost ? '1' : data.total;
    $('#feed-heading').firstChild.textContent = selectedPost ? 'A community story ' : `${TOPICS[topic]} `;
    $('#load-more').hidden = !data.has_more; $('#feed-end').hidden = !!data.has_more || !posts.length || !!selectedPost;
    if (data.stats) { $('#stat-posts').textContent = data.stats.posts; $('#stat-photos').textContent = data.stats.photos; $('#stat-members').textContent = data.stats.members; }
    else { api('/api/posts?offset=0').then(result => { $('#stat-posts').textContent = result.stats.posts; $('#stat-photos').textContent = result.stats.photos; $('#stat-members').textContent = result.stats.members; }).catch(() => {}); }
  } catch (error) {
    if (version !== feedVersion) return;
    status.replaceChildren(el('p', '', error.message), button('Try again', 'button secondary', () => loadFeed(append)));
    if (selectedPost) status.append(button('Back to all conversations', 'button secondary', () => { resetSelection(); loadFeed(); }));
    $('#load-more').hidden = true;
  } finally { if (version === feedVersion) { feed.setAttribute('aria-busy', 'false'); $('#load-more').disabled = false; } }
}
$$('.topic').forEach(node => node.addEventListener('click', () => {
  topic = node.dataset.topic; resetSelection();
  $$('.topic').forEach(item => { item.classList.toggle('active', item === node); item.setAttribute('aria-pressed', String(item === node)); }); loadFeed();
}));
$('#product-filter').addEventListener('change', event => { product = event.target.value; resetSelection(); loadFeed(); });
$('#sort').addEventListener('change', () => { resetSelection(); loadFeed(); });
$('#search-form').addEventListener('submit', event => { event.preventDefault(); search = $('#search-input').value.trim(); resetSelection(); loadFeed(); });
$('#search-input').addEventListener('search', () => { if (!$('#search-input').value) { search = ''; resetSelection(); loadFeed(); } });
$('#load-more').addEventListener('click', () => loadFeed(true));
async function loadReports() {
  const container = $('#reports'); container.textContent = 'Loading reports…';
  try {
    const { reports } = await api('/api/reports'); container.replaceChildren();
    if (!reports.length) container.append(el('p', '', 'All clear. There are no open reports.'));
    reports.forEach(item => {
      const row = el('article', 'report-item'), link = el('a', '', item.title); link.href = `?post=${item.post_id}#conversations`; link.target = '_blank'; link.rel = 'noopener';
      row.append(link, el('p', '', `Reported by ${item.reporter}: ${item.reason}`));
      if (item.comment_body) row.append(el('p', '', `Reply: ${item.comment_body}`));
      row.append(button('Dismiss report', 'action', async () => { try { await api(`/api/reports/${item.id}`, { method: 'DELETE' }); await loadReports(); } catch (error) { row.append(el('p', 'form-error', error.message)); } }));
      row.append(button(item.comment_id ? 'Delete reply' : 'Delete story', 'action', () => askDelete('Remove reported content?', async () => { await api(item.comment_id ? `/api/comments/${item.comment_id}` : `/api/posts/${item.post_id}`, { method: 'DELETE' }); await loadReports(); await loadFeed(); })));
      container.append(row);
    });
  } catch (error) { container.textContent = error.message; }
}
$('#moderation-open').addEventListener('click', () => { openDialog($('#moderation-dialog')); loadReports(); });
async function init() {
  try { const result = await api('/api/session'); user = result.user; } catch { /* The feed presents a visible retry state. */ }
  updateAccount(); await loadFeed();
}
init();
