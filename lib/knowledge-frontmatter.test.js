'use strict';
// Tests for knowledge-frontmatter.js: the dependency-free frontmatter
// parser/serializer shared by scripts/, hooks/, and mcp-server/ for
// spearhead-knowledge notes. Covers the full field set (type, tags,
// related, source, updated), the type:unknown fallback for malformed or
// missing frontmatter (never throws), and the parse(serialize(x)) round
// trip for well-formed input.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFrontmatter, serializeFrontmatter } = require('./knowledge-frontmatter.js');

test('parses a full frontmatter block with every field', () => {
  const content = [
    '---',
    'type: code',
    'tags: [alpha, beta]',
    'related: [[[spearhead-knowledge/code/foo.md]], [[spearhead-knowledge/code/bar.md]]]',
    'source: lib/foo.js',
    'updated: 2026-07-22',
    '---',
    '',
    '# Foo',
    'body text',
  ].join('\n');
  const { fields, body } = parseFrontmatter(content);
  assert.equal(fields.type, 'code');
  assert.deepEqual(fields.tags, ['alpha', 'beta']);
  assert.deepEqual(fields.related, ['[[spearhead-knowledge/code/foo.md]]', '[[spearhead-knowledge/code/bar.md]]']);
  assert.equal(fields.source, 'lib/foo.js');
  assert.equal(fields.updated, '2026-07-22');
  assert.equal(body, '\n# Foo\nbody text');
});

test('missing optional fields: only type is required, rest are absent', () => {
  const content = ['---', 'type: decision', '---', 'just a body'].join('\n');
  const { fields, body } = parseFrontmatter(content);
  assert.equal(fields.type, 'decision');
  assert.equal(fields.tags, undefined);
  assert.equal(fields.related, undefined);
  assert.equal(fields.source, undefined);
  assert.equal(fields.updated, undefined);
  assert.equal(body, 'just a body');
});

test('malformed frontmatter (no closing ---) falls back to type:unknown without throwing', () => {
  const content = ['---', 'type: code', 'tags: [alpha', 'no closing delimiter here'].join('\n');
  let result;
  assert.doesNotThrow(() => {
    result = parseFrontmatter(content);
  });
  assert.equal(result.fields.type, 'unknown');
  assert.equal(result.body, content);
});

test('malformed frontmatter (invalid YAML-ish syntax) falls back to type:unknown without throwing', () => {
  const content = ['---', ': : : garbage : : :', '---', 'body'].join('\n');
  let result;
  assert.doesNotThrow(() => {
    result = parseFrontmatter(content);
  });
  assert.equal(result.fields.type, 'unknown');
});

test('empty input does not throw and falls back to type:unknown', () => {
  let result;
  assert.doesNotThrow(() => {
    result = parseFrontmatter('');
  });
  assert.equal(result.fields.type, 'unknown');
  assert.equal(result.body, '');
});

test('no-frontmatter input (plain markdown) falls back to type:unknown, body unchanged', () => {
  const content = '# Just a heading\n\nsome text, no frontmatter at all';
  const { fields, body } = parseFrontmatter(content);
  assert.equal(fields.type, 'unknown');
  assert.equal(body, content);
});

test('null/undefined input does not throw and falls back to type:unknown', () => {
  assert.doesNotThrow(() => parseFrontmatter(null));
  assert.doesNotThrow(() => parseFrontmatter(undefined));
  assert.equal(parseFrontmatter(null).fields.type, 'unknown');
});

test('serializes all fields into a valid frontmatter block', () => {
  const fields = {
    type: 'code',
    tags: ['alpha', 'beta'],
    related: ['[[spearhead-knowledge/code/foo.md]]'],
    source: 'lib/foo.js',
    updated: '2026-07-22',
  };
  const out = serializeFrontmatter(fields, '\nbody here');
  assert.ok(out.startsWith('---\n'));
  assert.match(out, /type: code/);
  assert.match(out, /tags: \[alpha, beta\]/);
  assert.match(out, /related: \[\[\[spearhead-knowledge\/code\/foo\.md\]\]\]/);
  assert.match(out, /source: lib\/foo\.js/);
  assert.match(out, /updated: 2026-07-22/);
  assert.ok(out.includes('body here'));
});

test('serializes with only type when optional fields are absent', () => {
  const out = serializeFrontmatter({ type: 'unknown' }, 'body');
  assert.equal(out, '---\ntype: unknown\n---\nbody');
});

test('round-trip: parse(serialize(x)) === x for well-formed input with all fields', () => {
  const fields = {
    type: 'architecture',
    tags: ['one', 'two', 'three'],
    related: ['[[a.md]]', '[[b.md]]'],
    source: 'scripts/state.js',
    updated: '2026-01-15',
  };
  const body = '\n# Title\n\nSome content.\n';
  const serialized = serializeFrontmatter(fields, body);
  const { fields: parsedFields, body: parsedBody } = parseFrontmatter(serialized);
  assert.deepEqual(parsedFields, fields);
  assert.equal(parsedBody, body);
});

test('round-trip: parse(serialize(x)) === x for minimal input (type only)', () => {
  const fields = { type: 'decision' };
  const body = 'just a body, no trailing newline';
  const serialized = serializeFrontmatter(fields, body);
  const { fields: parsedFields, body: parsedBody } = parseFrontmatter(serialized);
  assert.deepEqual(parsedFields, fields);
  assert.equal(parsedBody, body);
});

test('round-trip: empty tags/related lists serialize and parse back as empty arrays', () => {
  const fields = { type: 'code', tags: [], related: [] };
  const body = 'body';
  const serialized = serializeFrontmatter(fields, body);
  const { fields: parsedFields } = parseFrontmatter(serialized);
  assert.deepEqual(parsedFields.tags, []);
  assert.deepEqual(parsedFields.related, []);
});
