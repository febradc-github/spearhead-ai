'use strict';
// CLI-based relevance ranking (plan/tasks/T-1.md; replaces embeddings.js +
// similarity.js's vector approach): ranks candidate notes against a query
// by asking the runtime's already-authenticated `claude` or `kimi` CLI to
// judge relevance, instead of computing and comparing embedding vectors.
//
// Dependency-down handling mirrors embeddings.js' MissingApiKeyError: an
// eager `detectCli` check throws before any ranking subprocess spawns, so
// callers get a clear, named error instead of a silent empty result. A
// validly-parsed empty array (the model found nothing relevant) is a
// distinct, legitimate outcome from a parse/spawn/timeout failure.
//
// `execFile`-style invocation with an argument array (never shell-string
// concatenation) passes the query/prompt as a literal argument value, so
// prompt/excerpt content can never be interpreted by a shell.

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30000;
const PROBE_TIMEOUT_MS = 5000;
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5';
const DEFAULT_KIMI_MODEL = 'kimi-k2';
const CANDIDATE_CLIS = ['claude', 'kimi'];

class RankingCliUnavailableError extends Error {
  constructor(message = 'no ranking CLI (claude or kimi) is available') {
    super(message);
    this.name = 'RankingCliUnavailableError';
  }
}

class RankingCliRequestError extends Error {
  constructor(message, options) {
    super(message);
    this.name = 'RankingCliRequestError';
    if (options && options.cause !== undefined) this.cause = options.cause;
  }
}

// Real `node:child_process` seam used when no `options.exec` is injected.
// Contract: exec(cmd, args, execOptions) => Promise<{stdout, stderr}>,
// rejecting on spawn failure, non-zero exit, or timeout.
async function defaultExec(cmd, args, execOptions) {
  return execFileAsync(cmd, args, { maxBuffer: 10 * 1024 * 1024, ...execOptions });
}

// Cached resolved CLI name, for the process lifetime (DESIGN.md: probing
// twice per process would be wasteful and the answer can't change mid-run).
let cachedCli = null;

// Test-only escape hatch: the cache above is deliberately process-lifetime,
// but a single test-suite process exercises many detectCli scenarios, so
// tests reset it between cases.
function resetCliCache() {
  cachedCli = null;
}

// Resolves which CLI to use for ranking: SPEARHEAD_RANKING_CLI overrides
// (if set to "claude" or "kimi"), otherwise probes `claude --version` then
// `kimi --version` via the injectable exec seam, first success wins.
// Throws RankingCliUnavailableError if neither is set and neither probe
// succeeds -- eager, before any ranking subprocess spawns.
async function detectCli(options = {}) {
  if (cachedCli) return cachedCli;

  const override = process.env.SPEARHEAD_RANKING_CLI;
  if (override === 'claude' || override === 'kimi') {
    cachedCli = override;
    return cachedCli;
  }

  const exec = options.exec || defaultExec;
  for (const name of CANDIDATE_CLIS) {
    try {
      await exec(name, ['--version'], { timeout: PROBE_TIMEOUT_MS });
      cachedCli = name;
      return cachedCli;
    } catch {
      // Try the next candidate CLI.
    }
  }
  throw new RankingCliUnavailableError();
}

// Builds the single prompt sent to the ranking CLI: instructs the model to
// respond with ONLY a strict JSON array of relevant candidate paths, most
// relevant first, omitting non-matches.
function buildPrompt(query, candidates) {
  const candidateLines = candidates
    .map((c, i) => `${i + 1}. path: ${c.path}\n   excerpt: ${c.excerpt}`)
    .join('\n');
  return [
    'You are ranking candidate notes by relevance to a search query.',
    `Query: ${query}`,
    'Candidates:',
    candidateLines,
    '',
    'Respond with ONLY a strict JSON array of the relevant candidate paths',
    '(the "path" value of each candidate above), ordered from most to least',
    'relevant. Omit any candidate that is not relevant to the query. Do not',
    'include any explanation, markdown formatting, or text other than the',
    'JSON array itself. If no candidates are relevant, respond with an',
    'empty JSON array: []',
  ].join('\n');
}

// Spawns the resolved CLI via an argument array (never shell-string
// interpolation of prompt/query/excerpt content). Returns raw stdout.
// Any spawn failure, non-zero exit, or timeout raises
// RankingCliRequestError with .cause set.
async function invokeCli(cliName, prompt, options = {}) {
  const exec = options.exec || defaultExec;
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS;

  let args;
  if (cliName === 'claude') {
    const model = options.model || DEFAULT_CLAUDE_MODEL;
    args = ['--print', prompt, '--model', model, '--output-format', 'json'];
  } else if (cliName === 'kimi') {
    const model = options.model || DEFAULT_KIMI_MODEL;
    args = ['--prompt', prompt, '--model', model, '--output-format', 'stream-json'];
  } else {
    throw new RankingCliRequestError(`unknown ranking CLI: ${cliName}`);
  }

  let result;
  try {
    result = await exec(cliName, args, { timeout });
  } catch (err) {
    throw new RankingCliRequestError(`${cliName} CLI invocation failed: ${err.message}`, { cause: err });
  }
  return result.stdout;
}

// JSON.parse's `text` as the model's instructed array, distinguishing a
// parse failure ("couldn't understand the response") from a validly-parsed
// but genuinely empty array (the legitimate "nothing relevant" outcome).
function parseModelArray(text, cliName) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new RankingCliRequestError(
      `${cliName} response was not understandable: model output was not valid JSON`,
      { cause: err }
    );
  }
  if (!Array.isArray(parsed)) {
    throw new RankingCliRequestError(`${cliName} response was not understandable: expected a JSON array`);
  }
  return parsed;
}

// Extracts plain text from a kimi stream-json message's `content`, which
// may be a plain string or an array of content blocks (`{type, text}`).
function extractContentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((block) => (block && typeof block.text === 'string' ? block.text : '')).join('');
  }
  return '';
}

// Parses claude's single `--output-format json` envelope: extracts the
// result text field, then JSON.parse's that text as the model's array.
function parseClaudeOutput(rawOutput) {
  let envelope;
  try {
    envelope = JSON.parse(rawOutput);
  } catch (err) {
    throw new RankingCliRequestError('could not understand claude CLI output: not valid JSON', { cause: err });
  }
  const text = envelope && typeof envelope.result === 'string' ? envelope.result : undefined;
  if (text === undefined) {
    throw new RankingCliRequestError('could not understand claude CLI output: no "result" text field found');
  }
  return parseModelArray(text, 'claude');
}

// Parses kimi's `--output-format stream-json` JSONL: takes the final
// Assistant message's content, then JSON.parse's that as the model's
// array. Never parses kimi's `text` mode (that's a human transcript, not
// machine-parseable).
function parseKimiOutput(rawOutput) {
  const lines = rawOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let lastAssistantContent;
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      throw new RankingCliRequestError('could not understand kimi CLI output: invalid stream-json line', {
        cause: err,
      });
    }
    const role = obj && (obj.role || obj.type);
    if (role && String(role).toLowerCase() === 'assistant') {
      lastAssistantContent = extractContentText(obj.content);
    }
  }

  if (lastAssistantContent === undefined) {
    throw new RankingCliRequestError('could not understand kimi CLI output: no Assistant message found');
  }
  return parseModelArray(lastAssistantContent, 'kimi');
}

// Parses `rawOutput` per-CLI into the model's instructed array of relevant
// candidate paths (most-relevant first). Any parse failure at any stage
// raises RankingCliRequestError.
function parseCliOutput(cliName, rawOutput) {
  if (cliName === 'claude') return parseClaudeOutput(rawOutput);
  if (cliName === 'kimi') return parseKimiOutput(rawOutput);
  throw new RankingCliRequestError(`unknown ranking CLI: ${cliName}`);
}

// Ranks `candidates` ([{path, excerpt}, ...]) against `query` by invoking
// the runtime's ranking CLI. Returns a filtered, relevance-ordered subset
// (possibly empty) as [{path, excerpt}, ...]. Any path the model returns
// that doesn't match a given candidate is silently dropped rather than
// fabricated into a result.
async function rankNotes(query, candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const cliName = options.cli || (await detectCli(options));
  const prompt = buildPrompt(query, candidates);
  const rawOutput = await invokeCli(cliName, prompt, options);
  const rankedPaths = parseCliOutput(cliName, rawOutput);

  const byPath = new Map(candidates.map((c) => [c.path, c]));
  const results = [];
  for (const path of rankedPaths) {
    const candidate = byPath.get(path);
    if (candidate) results.push(candidate);
  }
  return results;
}

module.exports = {
  rankNotes,
  detectCli,
  buildPrompt,
  invokeCli,
  parseCliOutput,
  resetCliCache,
  RankingCliUnavailableError,
  RankingCliRequestError,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_KIMI_MODEL,
};
