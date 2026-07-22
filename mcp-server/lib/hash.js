'use strict';
// Content-hashing for the server's change-detection (DESIGN.md: "computes a
// sha256 content hash ... If the hash matches what's already in the index
// for that path, skip [the embeddings call]"). Pure -- takes content in,
// does not read files itself, so callers (the file-watcher, tests) own I/O.

const crypto = require('node:crypto');

// Returns the lowercase hex sha256 digest of `content` (string or Buffer).
// Identical content always produces the identical hash, regardless of how
// many times or in what process it's computed.
function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

module.exports = { hashContent };
