'use strict';
// Tests for knowledge-frontmatter.js: the dependency-free frontmatter
// parser/serializer shared by scripts/, hooks/, and mcp-server/ for
// spearhead-knowledge notes. Covers the full field set (type, tags,
// related, source, updated, cssclasses), the type:unknown fallback for
// malformed or missing frontmatter (never throws), and the
// parse(serialize(x)) round trip for well-formed input.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFrontmatter, serializeFrontmatter } = require('./knowledge-frontmatter.js');

test('parses a full frontmatter block with every field', () => {
  const content = [
    '---',
    'type: code',
    'tags:',
    '  - alpha',
    '  - beta',
    'related:',
    '  - "[[spearhead-knowledge/code/foo.md]]"',
    '  - "[[spearhead-knowledge/code/bar.md]]"',
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
  assert.equal(fields.source_hash, undefined);
  assert.equal(body, 'just a body');
});

test('parses source_hash as a scalar field', () => {
  const content = [
    '---',
    'type: code',
    'source: lib/foo.js',
    'source_hash: abc123def456',
    '---',
    'body',
  ].join('\n');
  const { fields } = parseFrontmatter(content);
  assert.equal(fields.source_hash, 'abc123def456');
});

test('malformed frontmatter (no closing ---) falls back to type:unknown without throwing', () => {
  const content = ['---', 'type: code', 'tags:', '  - alpha', 'no closing delimiter here'].join('\n');
  let result;
  assert.doesNotThrow(() => {
    result = parseFrontmatter(content);
  });
  assert.equal(result.fields.type, 'unknown');
  assert.equal(result.body, content);
});

test('malformed frontmatter with source_hash present still falls back to type:unknown', () => {
  const content = [
    '---',
    'type: code',
    'source_hash: abc123',
    'no closing delimiter here',
  ].join('\n');
  let result;
  assert.doesNotThrow(() => {
    result = parseFrontmatter(content);
  });
  assert.equal(result.fields.type, 'unknown');
  assert.equal(result.fields.source_hash, undefined);
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
    source_hash: 'abc123def456',
  };
  const out = serializeFrontmatter(fields, '\nbody here');
  assert.ok(out.startsWith('---\n'));
  assert.match(out, /type: code/);
  assert.match(out, /tags:\n {2}- alpha\n {2}- beta/);
  assert.match(out, /related:\n {2}- "\[\[spearhead-knowledge\/code\/foo\.md\]\]"/);
  assert.match(out, /source: lib\/foo\.js/);
  assert.match(out, /updated: 2026-07-22/);
  assert.match(out, /source_hash: abc123def456/);
  assert.ok(out.includes('body here'));
});

test('serializes with only type when optional fields are absent', () => {
  const out = serializeFrontmatter({ type: 'unknown' }, 'body');
  assert.equal(out, '---\ntype: unknown\n---\nbody');
  assert.doesNotMatch(out, /source_hash/);
});

test('round-trip: parse(serialize(x)) === x for well-formed input with all fields', () => {
  const fields = {
    type: 'architecture',
    tags: ['one', 'two', 'three'],
    related: ['[[a.md]]', '[[b.md]]'],
    source: 'scripts/state.js',
    updated: '2026-01-15',
    source_hash: 'deadbeef00',
  };
  const body = '\n# Title\n\nSome content.\n';
  const serialized = serializeFrontmatter(fields, body);
  const { fields: parsedFields, body: parsedBody } = parseFrontmatter(serialized);
  assert.deepEqual(parsedFields, fields);
  assert.equal(parsedBody, body);
});

test('round-trip: source_hash present serializes and parses back exactly', () => {
  const fields = { type: 'code', source: 'lib/foo.js', source_hash: 'a1b2c3' };
  const body = 'body';
  const serialized = serializeFrontmatter(fields, body);
  const { fields: parsedFields } = parseFrontmatter(serialized);
  assert.deepEqual(parsedFields, fields);
});

test('round-trip: source_hash absent parses back as undefined, not defaulted', () => {
  const fields = { type: 'code', source: 'lib/foo.js' };
  const body = 'body';
  const serialized = serializeFrontmatter(fields, body);
  const { fields: parsedFields } = parseFrontmatter(serialized);
  assert.equal(parsedFields.source_hash, undefined);
  assert.deepEqual(parsedFields, fields);
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

test('round-trip: parse(serialize(x)) === x for well-formed input with cssclasses', () => {
  const fields = {
    type: 'design',
    cssclasses: ['kb-design'],
    tags: ['one'],
  };
  const body = 'body';
  const serialized = serializeFrontmatter(fields, body);
  const { fields: parsedFields, body: parsedBody } = parseFrontmatter(serialized);
  assert.deepEqual(parsedFields, fields);
  assert.equal(parsedBody, body);
});

test('cssclasses with multiple values round-trips exactly', () => {
  const fields = { type: 'architecture', cssclasses: ['kb-architecture', 'kb-pinned'] };
  const body = 'body';
  const serialized = serializeFrontmatter(fields, body);
  const { fields: parsedFields } = parseFrontmatter(serialized);
  assert.deepEqual(parsedFields.cssclasses, ['kb-architecture', 'kb-pinned']);
});

test('note with no cssclasses field parses as undefined, not thrown/defaulted', () => {
  const content = ['---', 'type: code', '---', 'body'].join('\n');
  const { fields } = parseFrontmatter(content);
  assert.equal(fields.cssclasses, undefined);
});

test('malformed frontmatter fallback (type:unknown) is unaffected by cssclasses field', () => {
  const content = [
    '---',
    'type: code',
    'cssclasses:',
    '  - kb-code',
    'no closing delimiter here',
  ].join('\n');
  let result;
  assert.doesNotThrow(() => {
    result = parseFrontmatter(content);
  });
  assert.equal(result.fields.type, 'unknown');
  assert.equal(result.fields.cssclasses, undefined);
  assert.equal(result.body, content);
});

test('round-trip: empty cssclasses list serializes and parses back as empty array', () => {
  const fields = { type: 'code', cssclasses: [] };
  const body = 'body';
  const serialized = serializeFrontmatter(fields, body);
  const { fields: parsedFields } = parseFrontmatter(serialized);
  assert.deepEqual(parsedFields.cssclasses, []);
});
