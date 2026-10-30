import { z } from 'zod';
import { test, expect } from '../../../core/fixtures';
import { bug, meta, rowsChecked } from '../../../core/defects/annotations';
import { OpenApiContract } from '../../../core/api/openapi';
import { RestClient } from '../../../core/api/rest-client';
import { requireRows } from '../../../core/data/probes';
import { activeEnvironment } from '../../../core/config/client-config';
import { positionsProbe } from '../../data/probes';

const Position = z.object({ id: z.number().int(), isin: z.string(), issuer: z.string(), quantity: z.number().int(), marketValue: z.number(), tradeDate: z.string(), status: z.enum(['NEW', 'INVESTIGATING', 'CLOSED']) });
const PositionPage = z.object({ items: z.array(Position), page: z.number(), size: z.number(), total: z.number() });

let contract: OpenApiContract;

test.describe('Positions — REST API', () => {
  test.beforeAll(async () => {
    contract = await OpenApiContract.fetch(activeEnvironment().openApi!);
  });

  test('TC-01: the API rejects a caller with no credentials (401, problem+json)', async ({ rest }) => {
    meta({ screen: 'positions', fr: 'FR-PS-API-01', what: 'An anonymous caller cannot read positions.' });
    const r = await rest.get('/health', { anonymous: true, expectStatus: 401 });
    expect(r.problem?.title).toBe('Unauthorized');
    contract.assertConforms(r);
  });

  test('TC-02: a page of positions matches the published contract', async ({ rest }) => {
    meta({ screen: 'positions', fr: 'FR-PS-API-02', what: 'GET /positions conforms to the OpenAPI schema.' });
    const r = await rest.get('/positions', { query: { page: 1, size: 20 }, schema: PositionPage });
    contract.assertConforms(r);
    rowsChecked(r.data.items.length);
    expect(r.data.items.length).toBeGreaterThan(0);
  });

  test('TC-03: a single position matches the published contract', async ({ rest }) => {
    meta({ screen: 'positions', fr: 'FR-PS-API-03', what: 'GET /positions/{id} returns the documented Position shape.' });
    const list = await rest.get<{ items: { id: number }[] }>('/positions', { query: { size: 1 } });
    const id = list.data.items[0].id;
    const r = await rest.get(RestClient.path('/positions/{id}', { id }));
    contract.assertConforms(r);
  });

  test('TC-04: sort=quantity orders quantities numerically', async ({ rest }) => {
    meta({ screen: 'positions', fr: 'FR-PS-API-04' });
    bug('BUG-API-001', { priority: 'Medium', summary: 'quantity sorts as text' });
    const r = await rest.get<{ items: { quantity: number }[] }>('/positions', { query: { sort: 'quantity', size: 50 } });
    const q = r.data.items.map((i) => i.quantity);
    rowsChecked(q.length);
    expect(q).toEqual([...q].sort((a, b) => a - b));
  });

  test('TC-05: paging through every page returns each position exactly once', async ({ rest }) => {
    meta({ screen: 'positions', fr: 'FR-PS-API-05', what: 'Page-based paging is complete and has no duplicates.' });
    await requireRows(positionsProbe, { dataSensitive: true });
    const first = await rest.get<{ total: number }>('/positions', { query: { size: 1 } });
    const { items, pages } = await rest.collectAll<{ id: number }>('/positions', { kind: 'page', pageSize: 10, itemsPath: 'items', firstPage: 1 });
    rowsChecked(items.length);
    expect(items.length, `${pages} pages walked`).toBe(first.data.total);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  test('TC-06: invalid paging is rejected with a problem+json 400', async ({ rest }) => {
    meta({ screen: 'positions', fr: 'FR-PS-API-06' });
    const r = await rest.get('/positions', { query: { page: 0, size: 500 }, expectStatus: 400 });
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.problem?.title).toBe('Invalid paging');
    contract.assertConforms(r);
  });

  test('TC-07: a tenant cannot read another tenant’s position', async ({ rest }) => {
    meta({ screen: 'positions', fr: 'FR-PS-API-07', what: 'Tenant isolation on GET /positions/{id}.' });
    const alpha = await rest.get<{ items: { id: number }[] }>('/positions', { query: { size: 1 }, tenant: 'alpha' });
    const id = alpha.data.items[0].id;
    const r = await rest.get(RestClient.path('/positions/{id}', { id }), { tenant: 'beta', expectStatus: 404 });
    expect(r.problem?.status).toBe(404);
  });

  test('TC-08: the date window returns only trades inside it', async ({ rest }) => {
    meta({ screen: 'positions', fr: 'FR-PS-API-08', what: 'from/to filter on the business data window.' });
    const { data } = await requireRows(positionsProbe);
    const r = await rest.get<{ items: { tradeDate: string }[] }>('/positions', { query: { from: data.anchor.from, to: data.anchor.to, size: 100 } });
    rowsChecked(r.data.items.length);
    for (const i of r.data.items) {
      expect(i.tradeDate >= data.anchor.from && i.tradeDate <= data.anchor.to, i.tradeDate).toBe(true);
    }
  });
});
