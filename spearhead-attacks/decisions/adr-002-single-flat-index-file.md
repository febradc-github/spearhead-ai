## Context

Embeddings and index metadata need durable local storage. Options considered:
one JSON file per note (mirroring the knowledge tree) versus a single flat
index file covering all notes.

## Decision

Store the whole index in one file, `spearhead-knowledge/index/embeddings.json`,
keyed by relative note path, written atomically (temp file + rename). Each
entry is `{hash, embedding, updated, type}`. Content hashes (`sha256`, via
`node:crypto`) gate re-embedding: a file whose hash is unchanged is skipped,
never re-sent to the embeddings API.

## Consequences

- The server loads the full index into memory once and does cosine
  similarity in a plain loop at query time — no per-note file I/O during
  `search`.
- One file to keep consistent (atomic rewrite) instead of many; at
  project-documentation scale (hundreds of notes, not millions) this is
  negligible overhead.
- Hash-gated re-embedding means the incremental-reindex acceptance
  criterion (only the changed note's entry updates) falls out naturally,
  and the same check doubles as crash recovery on server restart.
