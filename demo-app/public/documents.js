(function () {
  const $ = (q) => document.querySelector(`[data-qa="${q}"]`);
  const QUERY = 'query DocumentSearch($search: String!, $first: Int) { documents(search: $search, first: $first) { totalCount nodes { id fileName formCode issuerName status createdAt } } }';

  async function load() {
    const tbody = $('documents-table').querySelector('tbody');
    tbody.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
    const res = await fetch('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationName: 'DocumentSearch', query: QUERY, variables: { search: $('documents-search-input').value, first: 50 } }),
    });
    const body = await res.json();
    const conn = body.data ? body.data.documents : { totalCount: 0, nodes: [] };
    tbody.innerHTML = '';
    for (const d of conn.nodes) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-qa', `documents-row-${d.id}`);
      for (const c of ['fileName', 'formCode', 'issuerName', 'status', 'createdAt']) {
        const td = document.createElement('td');
        td.setAttribute('data-qa', `documents-cell-${c}-${d.id}`);
        td.textContent = d[c] === null ? '—' : c === 'createdAt' ? d[c].slice(0, 10) : d[c];
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    $('documents-empty').hidden = conn.nodes.length > 0;
    $('documents-total').textContent = `${conn.totalCount} documents`;
  }

  $('documents-search-button').addEventListener('click', load);
  load();
})();
