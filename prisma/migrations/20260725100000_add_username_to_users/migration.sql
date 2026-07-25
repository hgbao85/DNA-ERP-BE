-- Add username as the new login identifier (replaces email for authentication).
-- Existing rows are backfilled from the local-part of their email so the column can be
-- made NOT NULL + UNIQUE in the same migration without breaking prod data. Two different
-- users can share the same email local-part (e.g. admin@dna-erp.local and admin@demo.com
-- both start with "admin"), so a plain split_part() backfill could collide with the new
-- UNIQUE constraint - row_number() disambiguates by appending a suffix to duplicates.
-- (Whatever value lands here is provisional: prisma/seed.ts and prisma/seed-demo.ts
-- overwrite it to the intended value on their next run.)
ALTER TABLE "users" ADD COLUMN "username" TEXT;

UPDATE "users" u
SET "username" = sub.new_username
FROM (
  SELECT
    id,
    CASE
      WHEN row_number() OVER (PARTITION BY split_part(email, '@', 1) ORDER BY "createdAt") = 1
        THEN split_part(email, '@', 1)
      ELSE split_part(email, '@', 1)
           || '_' || row_number() OVER (PARTITION BY split_part(email, '@', 1) ORDER BY "createdAt")
    END AS new_username
  FROM "users"
) sub
WHERE u.id = sub.id AND u."username" IS NULL;

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

ALTER TABLE "users" ADD CONSTRAINT "users_username_key" UNIQUE ("username");
