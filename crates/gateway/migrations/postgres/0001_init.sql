CREATE TABLE vault (
    id TEXT PRIMARY KEY,
    auth_sha256 BYTEA NOT NULL,
    version BIGINT NOT NULL,
    blob BYTEA NOT NULL,
    -- Set when the owner deletes the vault. The row stays as a marker with an empty blob, so the other
    -- devices learn the vault is gone instead of taking it for new and writing it back.
    deleted_at BIGINT
);

CREATE TABLE link (
    id TEXT PRIMARY KEY,
    body BYTEA NOT NULL,
    expires_at BIGINT NOT NULL
);

-- device and account are keyed hashes of the token and address, so they group registrations
-- without naming anyone. secret_sha256 is the sha256 of the secret returned when registering;
-- key_id names the key that sealed the row.
CREATE TABLE push_registration (
    id TEXT PRIMARY KEY,
    device TEXT NOT NULL,
    account TEXT NOT NULL,
    sealed BYTEA NOT NULL,
    secret_sha256 BYTEA NOT NULL,
    key_id TEXT NOT NULL,
    owner TEXT,
    lease_until BIGINT NOT NULL DEFAULT 0,
    -- Where the inbox stood when a watcher last looked, so the worker that takes a registration over
    -- still pings for mail that arrived while nobody watched. Empty until the first look.
    uid_validity BIGINT,
    uid_next BIGINT
);

CREATE INDEX push_registration_device ON push_registration (device);
CREATE INDEX push_registration_account ON push_registration (account);
CREATE INDEX push_registration_owner ON push_registration (owner);
CREATE INDEX push_registration_lease ON push_registration (lease_until);

-- client is a hash of the rate-limit scope and the client address. Each window ends at
-- expires_at, and its row is dropped once it has.
CREATE TABLE rate_window (
    client TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    hits BIGINT NOT NULL,
    PRIMARY KEY (client, expires_at)
);
