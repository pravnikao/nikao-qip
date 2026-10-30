(function () {
  const $ = (q) => document.querySelector(`[data-qa="${q}"]`);

  async function load() {
    const res = await fetch('/api/v1/comments');
    const body = await res.json();
    const ul = $('comments-list');
    ul.innerHTML = '';
    for (const c of body.items) {
      const li = document.createElement('li');
      li.setAttribute('data-qa', `comment-item-${c.id}`);
      li.textContent = `#${c.positionId} · ${c.author}: ${c.text}`;
      ul.appendChild(li);
    }
    $('comments-empty').hidden = body.items.length > 0;
  }

  $('comment-add').addEventListener('click', async () => {
    $('comment-status').textContent = 'Saving…';
    const res = await fetch('/api/v1/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positionId: Number($('comment-position-id').value), text: $('comment-input').value }),
    });
    $('comment-status').textContent = res.ok ? 'Saved' : 'Could not save';
    setTimeout(load, 500);
  });
  load();
})();
