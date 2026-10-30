/** The demo platform's published REST contract (OpenAPI 3.0). */
export const openApiDoc = {
  openapi: '3.0.3',
  info: { title: 'Demo Holdings API', version: '1.4.0' },
  servers: [{ url: '/api/v1' }],
  paths: {
    '/health': { get: { responses: { '200': { description: 'up', content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } } } } }, '401': { $ref: '#/components/responses/Problem' } } } },
    '/positions': {
      get: {
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'size', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['issuer', 'quantity', 'tradeDate'] } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          '200': { description: 'A page of positions', content: { 'application/json': { schema: { $ref: '#/components/schemas/PositionPage' } } } },
          '400': { $ref: '#/components/responses/Problem' },
          '401': { $ref: '#/components/responses/Problem' },
        },
      },
    },
    '/positions/{id}': {
      get: {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'One position', content: { 'application/json': { schema: { $ref: '#/components/schemas/Position' } } } },
          '404': { $ref: '#/components/responses/Problem' },
        },
      },
    },
    '/comments': {
      get: {
        parameters: [{ name: 'positionId', in: 'query', schema: { type: 'integer' } }],
        responses: { '200': { description: 'Comments', content: { 'application/json': { schema: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Comment' } } } } } } } },
      },
      post: {
        requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['positionId', 'text'], properties: { positionId: { type: 'integer' }, text: { type: 'string', minLength: 1 } } } } } },
        responses: {
          '201': { description: 'Accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/Comment' } } } },
          '400': { $ref: '#/components/responses/Problem' },
        },
      },
    },
  },
  components: {
    responses: { Problem: { description: 'Problem details', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } } },
    schemas: {
      Problem: { type: 'object', required: ['title', 'status'], properties: { type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, detail: { type: 'string' } } },
      Position: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'isin', 'issuer', 'quantity', 'marketValue', 'tradeDate', 'status'],
        properties: {
          id: { type: 'integer' },
          isin: { type: 'string', pattern: '^[A-Z]{2}[0-9]{10}$' },
          issuer: { type: 'string' },
          quantity: { type: 'integer', minimum: 0 },
          marketValue: { type: 'number' },
          tradeDate: { type: 'string', format: 'date' },
          status: { type: 'string', enum: ['NEW', 'INVESTIGATING', 'CLOSED'] },
        },
      },
      PositionPage: {
        type: 'object',
        required: ['items', 'page', 'size', 'total'],
        properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Position' } }, page: { type: 'integer' }, size: { type: 'integer' }, total: { type: 'integer' } },
      },
      Comment: {
        type: 'object',
        required: ['id', 'positionId', 'text', 'author', 'createdAt'],
        properties: { id: { type: 'integer' }, positionId: { type: 'integer' }, text: { type: 'string' }, author: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } },
      },
    },
  },
} as const;
