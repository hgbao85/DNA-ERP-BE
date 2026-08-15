#!/usr/bin/env node
'use strict';

// Runs `prisma migrate deploy` against the direct (non-pooled) database connection, then hands
// off to the app. If the migrate step times out on the advisory lock (P1002) - typically because
// an earlier deploy was killed mid-migrate and left a stale session holding it - this clears any
// backend still holding that lock and retries once before giving up. Advisory locks on this
// database are only ever taken by `prisma migrate deploy` (the app itself never uses them), so
// terminating any backend holding one is safe.

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

async function clearStaleAdvisoryLocks() {
  const client = new Client({ connectionString: migrateUrl });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT pid FROM pg_locks WHERE locktype = 'advisory'");
    for (const { pid } of rows) {
      console.log(`[entrypoint] terminating stale advisory-lock backend pid=${pid}`);
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
