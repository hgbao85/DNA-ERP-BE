-- Constraints that can't be expressed in schema.prisma go here as raw SQL.
-- Prisma tracks this file like any other migration (applied via `prisma migrate deploy/dev`).

-- A refresh token can never be "expired before it was created".
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_expires_after_created_chk"
  CHECK ("expiresAt" > "createdAt");

-- Permission.module is a free-form string (see PERMISSION_MODULES constant) but must not be blank.
ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_module_not_blank_chk"
  CHECK (length(trim("module")) > 0);

-- Reference pattern for future ERP modules that need an XOR constraint (exactly one of
-- two columns set, e.g. a stock movement referencing either a source OR a destination
-- warehouse but never both/neither):
--
--   ALTER TABLE "stock_movements"
--     ADD CONSTRAINT "stock_movements_source_xor_destination_chk"
--     CHECK (
--       ("sourceWarehouseId" IS NOT NULL AND "destinationWarehouseId" IS NULL)
--       OR
--       ("sourceWarehouseId" IS NULL AND "destinationWarehouseId" IS NOT NULL)
--     );
