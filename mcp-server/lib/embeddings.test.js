'use strict';
// Tests for embeddings.js: the server's only component that talks to the
// embeddings API (DESIGN.md "Open questions resolved" / PROBLEM.md #10 --
// a missing key or failed call must throw/reject with a clear, named error,
// never a silent empty result). `fetch` is always injected here so no test
// makes a live network call.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  embed,
  MissingApiKeyError,
  EmbeddingsRequestError,
  DEFAULT_ENDPOINT,
} = require('./embeddings.js');

// Runs `fn` with `vars` applied to process.env, restoring the previous
// values (including "was unset") afterwards even if fn throws/rejects.
async function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(prev)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test('throws a named MissingApiKeyError when SPEARHEAD_EMBEDDINGS_API_KEY is unset', async () => {
  await withEnv({ SPEARHEAD_EMBEDDINGS_API_KEY: undefined }, async () => {
    await assert.rejects(() => embed('hello'), MissingApiKeyError);
  });
});

test('never calls fetch at all when the API key is missing', async () => {
  await withEnv({ SPEARHEAD_EMBEDDINGS_API_KEY: undefined }, async () => {
    let called = false;
    const fakeFetch = async () => {
      called = true;
      return { ok: true, json: async () => ({ data: [{ embedding: [1] }] }) };
    };
    await assert.rejects(() => embed('hello', { fetch: fakeFetch }));
    assert.equal(called, false);
  });
});

test('calls fetch with the API key and default endpoint, returns the embedding vector', async () => {
  await withEnv(
    { SPEARHEAD_EMBEDDINGS_API_KEY: 'test-key', SPEARHEAD_EMBEDDINGS_ENDPOINT: undefined },
    async () => {
      let calledUrl;
      let calledOptions;
      const fakeFetch = async (url, options) => {
        calledUrl = url;
        calledOptions = options;
        return { ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) };
      };
      const vector = await embed('hello world', { fetch: fakeFetch });
      assert.deepEqual(vector, [0.1, 0.2, 0.3]);
      assert.equal(calledUrl, DEFAULT_ENDPOINT);
      assert.equal(calledOptions.method, 'POST');
      assert.equal(calledOptions.headers.Authorization, 'Bearer test-key');
      assert.equal(JSON.parse(calledOptions.body).input, 'hello world');
    }
  );
});

test('honors a SPEARHEAD_EMBEDDINGS_ENDPOINT override', async () => {
  await withEnv(
    { SPEARHEAD_EMBEDDINGS_API_KEY: 'test-key', SPEARHEAD_EMBEDDINGS_ENDPOINT: 'https://example.test/embed' },
    async () => {
      let calledUrl;
      const fakeFetch = async (url) => {
        calledUrl = url;
        return { ok: true, json: async () => ({ data: [{ embedding: [1] }] }) };
      };
      await embed('hi', { fetch: fakeFetch });
      assert.equal(calledUrl, 'https://example.test/embed');
    }
  );
});

test('throws a named EmbeddingsRequestError when the API responds with an error status', async () => {
  await withEnv({ SPEARHEAD_EMBEDDINGS_API_KEY: 'test-key' }, async () => {
    const fakeFetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
    await assert.rejects(() => embed('hi', { fetch: fakeFetch }), EmbeddingsRequestError);
  });
});

test('throws a named EmbeddingsRequestError when fetch itself rejects (network failure)', async () => {
  await withEnv({ SPEARHEAD_EMBEDDINGS_API_KEY: 'test-key' }, async () => {
    const fakeFetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    await assert.rejects(() => embed('hi', { fetch: fakeFetch }), EmbeddingsRequestError);
  });
});

test('throws a named EmbeddingsRequestError when the response payload has no embedding data', async () => {
  await withEnv({ SPEARHEAD_EMBEDDINGS_API_KEY: 'test-key' }, async () => {
    const fakeFetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
    await assert.rejects(() => embed('hi', { fetch: fakeFetch }), EmbeddingsRequestError);
  });
});

test('throws a named EmbeddingsRequestError when the response body is not valid JSON', async () => {
  await withEnv({ SPEARHEAD_EMBEDDINGS_API_KEY: 'test-key' }, async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('unexpected token');
      },
    });
    await assert.rejects(() => embed('hi', { fetch: fakeFetch }), EmbeddingsRequestError);
  });
});

test('MissingApiKeyError and EmbeddingsRequestError are both real, distinctly-named Error subclasses', () => {
  const missing = new MissingApiKeyError();
  const request = new EmbeddingsRequestError('boom');
  assert.ok(missing instanceof Error);
  assert.equal(missing.name, 'MissingApiKeyError');
  assert.ok(request instanceof Error);
  assert.equal(request.name, 'EmbeddingsRequestError');
});
