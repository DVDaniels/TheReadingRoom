-- One row per address. The address and its feed token are separate secrets:
-- knowing someone's address doesn't let you read their feed.
CREATE TABLE IF NOT EXISTS boxes (
  local    TEXT PRIMARY KEY,          -- the part before @
  token    TEXT NOT NULL UNIQUE,      -- in the feed's address
  title    TEXT NOT NULL,
  created  TEXT NOT NULL,
  ip_hash  TEXT NOT NULL DEFAULT ''   -- to limit how many addresses one place can make in a day
);
CREATE INDEX IF NOT EXISTS boxes_ip ON boxes (ip_hash, created);

-- One row per email received.
CREATE TABLE IF NOT EXISTS entries (
  id       TEXT PRIMARY KEY,
  token    TEXT NOT NULL,
  title    TEXT NOT NULL,
  author   TEXT NOT NULL,
  received TEXT NOT NULL,
  html     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_token ON entries (token, received);
