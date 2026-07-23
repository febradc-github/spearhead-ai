'use strict';
// Dependency-free frontmatter parser/serializer for spearhead-knowledge
// notes. Shared by scripts/, hooks/, and mcp-server/ (per DESIGN.md) so all
// three components agree on one reading of `type`, `tags`, `related`,
// `cssclasses`, `source`, `updated`, `source_hash`.
//
// Grammar (a small, block-list YAML subset -- same spirit as the custom
// parser in hooks/validate-state.js, not the same schema):
//   ---
//   type: <scalar>
//   tags:
//     - <scalar>
//   related:
//     - "[[wikilink]]"
//   cssclasses:
//     - <scalar>
//   source: <scalar>
//   updated: <scalar>
//   source_hash: <scalar>
//   ---
//   <body>
// `tags`/`related`/`cssclasses` may also be written as an explicit empty
// list (`[]`). Scalars are quoted (`"..."`) only when they contain
// characters that would otherwise be ambiguous (brackets, colons, hashes,
// surrounding whitespace); plain values are left bare, matching
// validate-state.js's `scalar()` convention.
//
// `type` taxonomy (four valid note categories; `type` itself is parsed as
// an arbitrary scalar -- this list is documentation, not validation):
//   - code         -- one code doc per source file (scripts/knowledge-path.js)
//   - decisions    -- ADR-style records of a choice made and why
//   - design       -- opportunistic-capture notes (README.md's
//                     "Opportunistic capture" section): design rationale
//                     jotted down as a byproduct of normal work, not tied
//                     1:1 to a single source file the way `code` is
//   - architecture -- system/component-level structure notes
//
// `cssclasses` is Obsidian's native frontmatter field for applying CSS
// classes to a note's rendering; this module treats it exactly like
// `tags`/`related` (a plain list of scalars) and imposes no meaning of its
// own. See spearhead-knowledge/obsidian-css-snippet.css for an opt-in
// snippet that color-codes notes by `type` via `cssclasses` values like
// `kb-code`, `kb-decisions`, `kb-design`, `kb-architecture`.
//
// Failure mode (DESIGN.md): any frontmatter this parser cannot confidently
// read -- no closing `---`, or a line it does not recognize -- falls back
// to `{ type: 'unknown' }` with the body left byte-for-byte unchanged. It
// never throws.
//
// Dependency-free: Node built-ins only. No network, no fs (callers own I/O).

const LIST_FIELDS = new Set(['tags', 'related', 'cssclasses']);
const SCALAR_FIELDS = new Set(['type', 'source', 'updated', 'source_hash']);
const KEY_LINE = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/;
const LIST_ITEM_LINE = /^ {2}- (.*)$/;

function unquote(raw) {
  const v = String(raw).trim();
  let m = v.match(/^"([\s\S]*)"$/);
  if (m) return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  m = v.match(/^'([\s\S]*)'$/);
  if (m) return m[1];
  return v;
}

function needsQuote(v) {
  const s = String(v);
  return s === '' || s.trim() !== s || /[[\]:#"]/.test(s);
}

function quote(v) {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function scalarOut(v) {
  return needsQuote(v) ? quote(v) : String(v);
}

// Parses a note's leading `---`-delimited frontmatter block. Returns
// `{ fields, body }`. `fields.type` is always present (falls back to
// 'unknown'); `tags`/`related`/`cssclasses`/`source`/`updated`/
// `source_hash` are present only when the input supplied them. Never
// throws -- malformed or absent frontmatter falls back to
// `{ fields: { type: 'unknown' }, body: <original content> }`.
function parseFrontmatter(content) {
  const text = content == null ? '' : String(content);
  const fallback = { fields: { type: 'unknown' }, body: text };
  if (!text) return fallback;

  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return fallback;

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) return fallback;

  try {
    const fields = {};
    let listKey = null;
    for (let i = 1; i < closingIndex; i++) {
      const line = lines[i];
      const listMatch = line.match(LIST_ITEM_LINE);
      if (listMatch && listKey) {
        fields[listKey].push(unquote(listMatch[1]));
        continue;
      }
      const kv = line.match(KEY_LINE);
      if (!kv) throw new Error(`unrecognized frontmatter line: "${line}"`);
      const [, key, rawRest] = kv;
      const rest = rawRest.trim();
      listKey = null;
      if (LIST_FIELDS.has(key)) {
        if (rest === '') {
          fields[key] = [];
          listKey = key;
        } else if (rest === '[]') {
          fields[key] = [];
        } else {
          throw new Error(`expected a block list or [] for "${key}", got "${rest}"`);
        }
      } else if (SCALAR_FIELDS.has(key)) {
        fields[key] = unquote(rest);
      }
      // Unrecognized keys are ignored rather than treated as malformed --
      // forward-compatible with fields this module doesn't know about yet.
    }
    if (fields.type === undefined) fields.type = 'unknown';
    const body = lines.slice(closingIndex + 1).join('\n');
    return { fields, body };
  } catch {
    return fallback;
  }
}

// Serializes `fields` (same shape as parseFrontmatter's `fields`) back into
// a `---`-delimited frontmatter block followed by `body`. `fields.type`
// defaults to 'unknown' when absent; `tags`/`related`/`cssclasses` are only
// emitted as block lists (or `[]`) when they are arrays; `source`/
// `updated`/`source_hash` are only emitted when defined. For well-formed
// `fields`, `parseFrontmatter(serializeFrontmatter(fields, body))`
// round-trips to `{ fields, body }`.
function serializeFrontmatter(fields, body) {
  const f = fields || {};
  const out = ['---'];
  out.push(`type: ${scalarOut(f.type == null ? 'unknown' : f.type)}`);
  for (const key of ['tags', 'related', 'cssclasses']) {
    if (!Array.isArray(f[key])) continue;
    if (f[key].length === 0) {
      out.push(`${key}: []`);
    } else {
      out.push(`${key}:`);
      for (const item of f[key]) out.push(`  - ${scalarOut(item)}`);
    }
  }
  for (const key of ['source', 'updated', 'source_hash']) {
    if (f[key] === undefined) continue;
    out.push(`${key}: ${scalarOut(f[key])}`);
  }
  out.push('---');
  return `${out.join('\n')}\n${body == null ? '' : body}`;
}

module.exports = { parseFrontmatter, serializeFrontmatter };
