import { test, expect } from '@playwright/test';
import { OpenApiContract, diffOpenApi } from '../../core/api/openapi';
import { parseLinkNext, retryAfterMs, RestClient } from '../../core/api/rest-client';
import { operationNameOf, isUnauthorised, typeRefString } from '../../core/api/graphql-client';
import { getPath, redactHeaders } from '../../core/api/http-common';
import { diffSchemas, diffHooks } from '../../core/sentinel/sentinel';
import { openApiDoc } from '../../demo-app/openapi';

const contract = OpenApiContract.load(JSON.parse(JSON.stringify(openApiDoc)));
const res = (method: string, url: string, status: number, data: unknown, ct = 'application/json') => ({ method, url, status, headers: { 'content-type': ct }, data });

test.describe('OpenAPI contract', () => {
  test('matches templated paths behind the server base path', () => {
    expect(contract.findOperation('GET', 'http://h/api/v1/positions/1019')?.template).toBe('/positions/{id}');
    expect(contract.findOperation('GET', '/api/v1/positions?page=2')?.template).toBe('/positions');
    expect(contract.findOperation('DELETE', '/api/v1/positions/1')).toBeUndefined();
  });

  test('a conforming body has no issues', () => {
    const body = { id: 1, isin: 'GB0000000001', issuer: 'A', quantity: 5, marketValue: 12.5, tradeDate: '2026-10-27', status: 'NEW' };
    expect(contract.check(res('GET', '/api/v1/positions/1', 200, body))).toEqual([]);
  });

  test('type, enum, required, pattern, additionalProperties and nullability are enforced', () => {
    const body = { id: 1, isin: 'bad', issuer: null, quantity: 5, marketValue: '12.50', tradeDate: '27/10/2026', status: 'OPEN', extra: true };
    const issues = contract.check(res('GET', '/api/v1/positions/1', 200, body)).map((i) => `${i.path}: ${i.message}`);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('$.isin: does not match'),
        expect.stringContaining('$.issuer: is null but not nullable'),
        expect.stringContaining('$.marketValue: expected number, got string'),
        expect.stringContaining('$.tradeDate: "27/10/2026" is not a date'),
        expect.stringContaining('$.status: "OPEN" is not one of'),
        expect.stringContaining('$.extra: is not allowed'),
      ]),
    );
  });

  test('undocumented statuses and content types are reported', () => {
    expect(contract.check(res('GET', '/api/v1/positions/1', 500, {}))[0].message).toMatch(/status 500 is not documented/);
    expect(contract.check(res('GET', '/api/v1/positions/1', 404, { title: 'x', status: 404 }, 'text/html'))[0].message).toMatch(/content-type text\/html is not documented/);
  });

  test('problem+json errors validate against the shared Problem schema', () => {
    expect(contract.check(res('GET', '/api/v1/positions', 400, { title: 'Invalid paging', status: 400 }, 'application/problem+json'))).toEqual([]);
  });

  test('coverage lists exercised operations', () => {
    const cov = contract.coverage();
    expect(cov.find((c) => c.operation === 'GET /positions/{id}')?.exercised).toBe(true);
    expect(cov.find((c) => c.operation === 'POST /comments')?.exercised).toBe(false);
  });

  test('spec diff finds removed operations and changed property types', () => {
    const after = JSON.parse(JSON.stringify(openApiDoc));
    delete after.paths['/comments'].post;
    after.components.schemas.Position.properties.marketValue = { type: 'string' };
    const d = diffOpenApi(JSON.parse(JSON.stringify(openApiDoc)), after);
    expect(d.removed).toContain('op POST /comments');
    expect(d.changed).toContain('schema Position.marketValue: "number" → "string"');
  });
});

test.describe('REST helpers', () => {
  test('Link header, Retry-After and path parameters', () => {
    expect(parseLinkNext('<https://api/x?page=3>; rel="next", <https://api/x?page=9>; rel="last"')).toBe('https://api/x?page=3');
    expect(parseLinkNext('<https://api/x?page=9>; rel="last"')).toBeUndefined();
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs('120')).toBe(30_000);
    expect(retryAfterMs(undefined)).toBeUndefined();
    expect(RestClient.path('/positions/{id}/comments/{cid}', { id: 7, cid: 'a b' })).toBe('/positions/7/comments/a%20b');
    expect(() => RestClient.path('/positions/{id}', {})).toThrow(/Missing path parameter id/);
  });

  test('secrets are redacted and dotted paths read', () => {
    expect(redactHeaders({ authorization: 'Bearer abcdefgh', accept: 'json' })).toEqual({ authorization: 'Bear…', accept: 'json' });
    expect(getPath({ data: { items: [1] } }, 'data.items')).toEqual([1]);
  });
});

test.describe('GraphQL helpers', () => {
  test('operation names, gateway-style 401s and type strings', () => {
    expect(operationNameOf('query DocumentSearch($s: String!) { x }')).toBe('DocumentSearch');
    expect(operationNameOf('{ x }')).toBe('anonymous');
    expect(isUnauthorised({ status: 200, data: null, errors: [{ message: 'no', extensions: { code: 'UNAUTHENTICATED' } }], ms: 1, operationName: 'X' })).toBe(true);
    expect(typeRefString({ kind: 'NON_NULL', name: null, ofType: { kind: 'LIST', name: null, ofType: { kind: 'SCALAR', name: 'String' } } })).toBe('[String]!');
  });

  test('schema diff names removed fields and changed types', () => {
    const before = [{ name: 'Override', kind: 'OBJECT', fields: { status: 'String!', comment: 'String' } }];
    const after = [{ name: 'Override', kind: 'OBJECT', fields: { status: 'String', reviewDate: 'Date' } }];
    const d = diffSchemas(before, after);
    expect(d.removed).toEqual(['Override.comment']);
    expect(d.changed).toEqual(['Override.status: String! → String']);
    expect(d.added).toEqual(['Override.reviewDate']);
  });

  test('screen hook diff', () => {
    expect(diffHooks(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
  });
});
