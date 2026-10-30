import { test, expect } from '../../../core/fixtures';
import { meta, rowsChecked } from '../../../core/defects/annotations';
import { requireRows } from '../../../core/data/probes';
import { commentsBetaProbe } from '../../data/probes';

test.describe('Comments — REST API', () => {
  test('TC-01: a comment without text is rejected with a problem+json 400', async ({ rest }) => {
    meta({ screen: 'comments', fr: 'FR-CM-API-01' });
    const r = await rest.post('/comments', { positionId: 1000, text: '  ' }, { expectStatus: 400 });
    expect(r.problem?.title).toBe('Invalid comment');
  });

  test('TC-02: the Beta tenant lists its comments with author and time', async ({ rest }) => {
    meta({ screen: 'comments', fr: 'FR-CM-API-02', what: 'Read side of comments for a second tenant.' });
    await requireRows(commentsBetaProbe);
    const r = await rest.get<{ items: { author: string; createdAt: string }[] }>('/comments', { tenant: 'beta' });
    rowsChecked(r.data.items.length);
    for (const c of r.data.items) expect(c.author && c.createdAt).toBeTruthy();
  });
});
