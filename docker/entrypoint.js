#!/usr/bin/env node
'use strict';

// Runs `prisma migrate deploy` against the direct (non-pooled) database connection, then hands
// off to the app. If the migrate step times out on the advisory lock (P1002) - typically because
// an earlier deploy was killed mid-migrate and left a stale session holding it - this clears the
// stale session and retries once before giving up.
//
// B4 (danh sách lỗi 16/11, 17/11/2026): the app DOES take advisory locks now (lockBusinessKey /
// pg_advisory_xact_lock in business transactions, daily jobs...). The old version terminated EVERY
// backend holding any advisory lock, killing live business transactions of a still-running
// instance. Now only the backend holding Prisma Migrate's own lock key (pg_advisory_lock(72707369),
// read from the schema engine) is terminated, and only when it has sat idle for a while - a
// migrate that is genuinely running elsewhere is left alone.

const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const migrateUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

function runMigrate() {
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: migrateUrl },
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  return result;
}

/** Prisma Migrate's advisory lock key: `SELECT pg_advisory_lock(72707369)` (single bigint key -> classid 0, objid key, objsubid 1). */
const PRISMA_MIGRATE_LOCK_KEY = 72707369;
/** A holder idle at least this long is a leftover of a killed deploy, not a migrate in progress. */
const STALE_IDLE_SECONDS = 30;

const STALE_MIGRATE_LOCK_SQL = `
  SELECT l.pid, a.state, EXTRACT(EPOCH FROM (now() - a.state_change))::int AS idle_seconds
  FROM pg_locks l
  JOIN pg_stat_activity a ON a.pid = l.pid
  WHERE l.locktype = 'advisory' AND l.granted
    AND l.classid = 0 AND l.objid = $1 AND l.objsubid = 1
    AND l.pid <> pg_backend_pid()`;

async function clearStaleAdvisoryLocks() {
  const client = new Client({ connectionString: migrateUrl });
  await client.connect();
  try {
    const { rows } = await client.query(STALE_MIGRATE_LOCK_SQL, [PRISMA_MIGRATE_LOCK_KEY]);
    for (const { pid, state, idle_seconds: idleSeconds } of rows) {
      if (state === 'active' || idleSeconds < STALE_IDLE_SECONDS) {
        console.log(
          `[entrypoint] migrate lock held by pid=${pid} (${state}, idle ${idleSeconds}s) - looks like a running migrate, not terminating`,
        );
        continue;
      }
      console.log(`[entrypoint] terminating stale migrate-lock backend pid=${pid} (${state}, idle ${idleSeconds}s)`);
      await client.query('SELECT pg_terminate_backend($1)', [pid]);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  let result = runMigrate();

  if (result.status !== 0 && `${result.stdout}${result.stderr}`.includes('P1002')) {
    console.log('[entrypoint] P1002 (advisory lock timeout) detected - clearing stale locks and retrying once');
    await clearStaleAdvisoryLocks();
    result = runMigrate();
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  require(path.join(__dirname, '..', 'dist', 'main.js'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
