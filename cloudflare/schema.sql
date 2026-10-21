CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0,1)),
  download INTEGER NOT NULL DEFAULT 0 CHECK (download IN (0,1)),
  admin INTEGER NOT NULL DEFAULT 0 CHECK (admin IN (0,1))
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

CREATE TABLE IF NOT EXISTS manuals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  object TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS manuals_name_idx ON manuals(name);
