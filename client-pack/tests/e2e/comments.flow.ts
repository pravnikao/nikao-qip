import { test, expect } from '../../../core/fixtures';
import { bug, meta } from '../../../core/defects/annotations';
import { eventually } from '../../../core/run/eventually';
import { clientConfig } from '../../../core/config/client-config';
import { CommentsPage } from '../../pages/CommentsPage';

/**
 * Write path end to end: add a comment in the UI, see it in the read model (API),
 * then on the screen. Serial: step 2 depends on step 1's comment.
 */
test.describe.serial('Comments flow @creates-data', () => {
  const text = `QA flow ${Date.now()}`;
  let positionId = 0;

  test('TC-01: a comment added on screen reaches the read model within budget', async ({ page, rest }) => {
    meta({ screen: 'comments', fr: 'FR-CM-01', what: 'UI write, then API read side, within the read-model budget.' });
    bug('BUG-API-007', { priority: 'Medium', summary: 'comments slow to appear' });
    const list = await rest.get<{ items: { id: number }[] }>('/positions', { query: { size: 1 }, tenant: 'alpha' });
    positionId = list.data.items[0].id;
    const cp = await new CommentsPage(page).open();
    await cp.add(positionId, text);
    await expect(cp.status).toHaveText('Saved');
    await eventually(
      `comment "${text}" on position ${positionId}`,
      async () => (await rest.get<{ items: { text: string }[] }>('/comments', { query: { positionId }, tenant: 'alpha' })).data.items.find((c) => c.text === text),
      { timeoutMs: clientConfig().timeouts.readModelMs },
    );
  });

  test('TC-02: the new comment is listed on the Comments screen', async ({ page }) => {
    meta({ screen: 'comments', fr: 'FR-CM-02' });
    const cp = await new CommentsPage(page).open();
    await expect(cp.items().filter({ hasText: text })).toHaveCount(1);
  });
});
