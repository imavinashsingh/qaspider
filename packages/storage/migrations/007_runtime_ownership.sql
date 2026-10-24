-- Process ownership allows interrupted work to be reconciled without touching live workers.
CREATE TABLE runtime_ownership(
 kind TEXT NOT NULL CHECK(kind IN ('qa','test','navigation','operation')),
 work_id TEXT NOT NULL,
 owner_pid INTEGER NOT NULL,
 owner_start TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(kind,work_id)
) STRICT;
