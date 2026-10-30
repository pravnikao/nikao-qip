(function () {
  const $ = (q) => document.querySelector(`[data-qa="${q}"]`);
  const state = { page: 1 };
  const cols = ['isin', 'issuer', 'quantity', 'marketValue', 'tradeDate', 'status'];

  async function load() {
    const size = Number($('positions-page-size').value);
    const params = new URLSearchParams({
      page: String(state.page),
      // Planted UI defect after "migration": asks for one row more than the page size.
      size: String(window.DEMO_DEFECTS ? size + 1 : size),
      sort: $('positions-sort').value,
    });
    const q = $('positions-search-input').value.trim();
    if (q) params.set('q', q);
    if ($('positions-from').value) params.set('from', $('positions-from').value);
    if ($('positions-to').value) params.set('to', $('positions-to').value);
    const tbody = $('positions-table').querySelector('tbody');
    tbody.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
    const res = await fetch('/api/v1/positions?' + params.toString());
    const body = await res.json();
    tbody.innerHTML = '';
    for (const p of body.items) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-qa', `positions-row-${p.id}`);
      for (const c of cols) {
        const td = document.createElement('td');
        td.setAttribute('data-qa', `positions-cell-${c}-${p.id}`);
        td.textContent = c === 'marketValue' ? Number(p[c]).toFixed(2) : String(p[c]);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    $('positions-empty').hidden = body.items.length > 0;
    const pages = Math.max(1, Math.ceil(body.total / size));
    $('positions-page-summary').textContent = `Page ${state.page} of ${pages} · ${body.total} positions`;
    $('positions-page-prev').disabled = state.page <= 1;
    $('positions-page-next').disabled = state.page >= pages;
  }

  $('positions-search-button').addEventListener('click', () => { state.page = 1; load(); });
  $('positions-page-next').addEventListener('click', () => { state.page++; load(); });
  $('positions-page-prev').addEventListener('click', () => { state.page--; load(); });
  $('positions-page-size').addEventListener('change', () => { state.page = 1; load(); });
  $('positions-sort').addEventListener('change', () => { state.page = 1; load(); });
  load();
})();
