'use strict';
// Embeddings API client (DESIGN.md "Embeddings provider"): the server's
// only component that calls out to the embeddings API. Not hardcoded to a
// single vendor -- reads SPEARHEAD_EMBEDDINGS_API_KEY (required) and an
// optional SPEARHEAD_EMBEDDINGS_ENDPOINT (defaults to Voyage AI, Anthropic's
// recommended embeddings partner) from the environment, and calls it via
// Node's built-in `fetch` -- no HTTP client dependency (PROBLEM.md #10).
//
// Failure mode (PROBLEM.md #10 / DESIGN.md "Failure-mode handling"): a
// missing key or a failed/erroring call throws a clear, named error rather
// than resolving with a silent empty result, so callers (the index
// updater, the `search` tool) can surface it instead of writing a corrupt
// or empty entry.

const DEFAULT_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
const DEFAULT_MODEL = 'voyage-3';

class MissingApiKeyError extends Error {
  constructor(message = 'SPEARHEAD_EMBEDDINGS_API_KEY is not set') {
    super(message);
    this.name = 'MissingApiKeyError';
  }
}

class EmbeddingsRequestError extends Error {
  constructor(message, options) {
    super(message);
    this.name = 'EmbeddingsRequestError';
    if (options && options.cause !== undefined) this.cause = options.cause;
  }
}

// Embeds `text`, returning the numeric vector. `options.fetch` overrides
// the fetch implementation (tests inject a mock here; no live network call
// is ever made by this module's own test suite). Throws MissingApiKeyError
// if SPEARHEAD_EMBEDDINGS_API_KEY is unset (before any network call is
// attempted), or EmbeddingsRequestError if the call itself fails, the
// response status is not ok, the body isn't valid JSON, or the response
// doesn't contain an embedding.
async function embed(text, options = {}) {
  const apiKey = process.env.SPEARHEAD_EMBEDDINGS_API_KEY;
  if (!apiKey) {
    throw new MissingApiKeyError();
  }

  const fetchImpl = options.fetch || globalThis.fetch;
  const endpoint = process.env.SPEARHEAD_EMBEDDINGS_ENDPOINT || DEFAULT_ENDPOINT;

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input: text, model: DEFAULT_MODEL }),
    });
  } catch (err) {
    throw new EmbeddingsRequestError(`embeddings API call failed: ${err.message}`, { cause: err });
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      // Best-effort detail only; fall through with an empty detail.
    }
    throw new EmbeddingsRequestError(
      `embeddings API responded with status ${response.status}${detail ? `: ${detail}` : ''}`
    );
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    throw new EmbeddingsRequestError(`embeddings API returned a non-JSON response: ${err.message}`, {
      cause: err,
    });
  }

  const embedding = json && json.data && json.data[0] && json.data[0].embedding;
  if (!Array.isArray(embedding)) {
    throw new EmbeddingsRequestError('embeddings API response did not contain an embedding vector');
  }
  return embedding;
}

module.exports = { embed, MissingApiKeyError, EmbeddingsRequestError, DEFAULT_ENDPOINT, DEFAULT_MODEL };
