import { test, expect } from '../../../core/fixtures';
import { bug, meta, rowsChecked } from '../../../core/defects/annotations';
import { isUnauthorised } from '../../../core/api/graphql-client';
import { requireRows } from '../../../core/data/probes';
import { documentsProbe } from '../../data/probes';

const SEARCH = `query DocumentSearch($search: String!, $first: Int) {
  documents(search: $search, first: $first) { totalCount nodes { id fileName formCode issuerName status createdAt } }
}`;

type Docs = { documents: { totalCount: number; nodes: { id: string; fileName: string; formCode: string; issuerName: string | null; status: string }[] } };

test.describe('Documents — GraphQL API', () => {
  test('TC-01: an unauthenticated DocumentSearch is rejected', async ({ gql }) => {
    meta({ screen: 'documents', fr: 'FR-DOC-API-01', what: 'Gateway answers 200 with UNAUTHENTICATED; no data leaks.' });
    const r = await gql.execute<Docs>(SEARCH, { search: 'CA' }, { anonymous: true });
    expect(isUnauthorised(r)).toBe(true);
    expect(r.data).toBeNull();
  });

  test('TC-02: DocumentSearch returns only matching packages, with a consistent total', async ({ gql }) => {
    meta({ screen: 'documents', fr: 'FR-DOC-API-02' });
    const { data } = await requireRows(documentsProbe);
    const d = await gql.data<Docs>(SEARCH, { search: data.anchor.search, first: 50 });
    rowsChecked(d.documents.nodes.length);
    expect(d.documents.totalCount).toBeGreaterThanOrEqual(d.documents.nodes.length);
    for (const n of d.documents.nodes) expect(`${n.fileName} ${n.formCode}`.toUpperCase()).toContain(data.anchor.search.toUpperCase());
  });

  test('TC-03: Failed packages still carry the issuer name', async ({ gql }) => {
    meta({ screen: 'documents', fr: 'FR-DOC-API-03' });
    bug('BUG-API-003', { priority: 'High', summary: 'issuerName null on Failed packages' });
    const d = await gql.data<Docs>(SEARCH, { search: '', first: 50 });
    const failed = d.documents.nodes.filter((n) => n.status === 'Failed');
    rowsChecked(failed.length);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.filter((n) => !n.issuerName).map((n) => n.id)).toEqual([]);
  });

  test('TC-04: the schema still exposes DocumentPackage.issuerName as a String', async ({ gql }) => {
    meta({ screen: 'documents', fr: 'FR-DOC-API-04', what: 'Schema contract via introspection.' });
    const types = await gql.introspect();
    const pkg = types.find((t) => t.name === 'DocumentPackage');
    expect(pkg?.fields.issuerName).toBe('String');
  });
});
