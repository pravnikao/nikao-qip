import { defineProbe } from '../../core/data/probes';
import { RestClient } from '../../core/api/rest-client';
import { GraphQLClient } from '../../core/api/graphql-client';

/**
 * One probe per screen that needs data. Each returns the row count at the data
 * sheet's anchor and throws on any API error (so an outage is never read as "no data").
 */

export const positionsProbe = defineProbe<{ from: string; to: string; tenant: string }>({
  name: 'PositionsInWindow',
  screen: 'positions',
  count: async ({ anchor }) => {
    const rest = await RestClient.create();
    try {
      const r = await rest.get<{ total: number }>('/positions', { query: { from: anchor.from, to: anchor.to, size: 1 }, tenant: anchor.tenant, name: 'PositionsProbe' });
      return r.data.total;
    } finally {
      await rest.dispose();
    }
  },
});

export const documentsProbe = defineProbe<{ search: string }>({
  name: 'DocumentSearchProbe',
  screen: 'documents',
  count: async ({ anchor }) => {
    const gql = await GraphQLClient.create();
    try {
      const d = await gql.data<{ documents: { totalCount: number } }>('query DocumentSearchProbe($search: String!) { documents(search: $search, first: 1) { totalCount } }', { search: anchor.search });
      return d.documents.totalCount;
    } finally {
      await gql.dispose();
    }
  },
});

function commentsProbe(screen: string) {
  return defineProbe<{ tenant: string }>({
    name: `CommentsProbe:${screen}`,
    screen,
    count: async ({ anchor }) => {
      const rest = await RestClient.create();
      try {
        const r = await rest.get<{ items: unknown[] }>('/comments', { tenant: anchor.tenant, name: 'CommentsProbe' });
        return r.data.items.length;
      } finally {
        await rest.dispose();
      }
    },
  });
}

export const commentsAlphaProbe = commentsProbe('comments');
export const commentsBetaProbe = commentsProbe('comments-beta');
