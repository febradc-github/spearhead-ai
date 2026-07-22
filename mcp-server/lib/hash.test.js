'use strict';
// Tests for hash.js: content hashing used by the server's change-detection
// (DESIGN.md "On a create/change event: ... computes a sha256 content hash
// ... If the hash matches what's already in the index for that path,
// skip"). Pure function, no fs/network -- content is passed in, not read
// from disk, so tests exercise the hashing logic directly.
const test = require('node:test');
const assert = require('node:assert/strict');

const { hashContent } = require('./hash.js');

test('identical content always produces the identical hash', () => {
  const a = hashContent('the quick brown fox');
  const b = hashContent('the quick brown fox');
  assert.equal(a, b);
});

test('different content produces a different hash', () => {
  const a = hashContent('the quick brown fox');
  const b = hashContent('the quick brown fox.');
  assert.notEqual(a, b);
});

test('returns a 64-character lowercase hex string (sha256 digest)', () => {
  const h = hashContent('anything');
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('hashes Buffer input the same way as the equivalent string', () => {
  const fromString = hashContent('hello knowledge base');
  const fromBuffer = hashContent(Buffer.from('hello knowledge base', 'utf8'));
  assert.equal(fromString, fromBuffer);
});

test('empty content produces the well-known empty-string sha256 hash', () => {
  assert.equal(
    hashContent(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});
