-- Standardizes soft-delete for the 5 Phase 2 entities that already had an isActive-based
-- pseudo-delete (materials, suppliers, weaving_points, warehouses, product_variants), but
-- never actually filtered reads by it - "deleted" rows kept showing up in every list/get.
-- Adds deletedAt to match the pattern already proven correct for users/roles (see
-- CONTRIBUTING.md "1. Xoá mềm"). isActive is kept as-is: it remains a separate,
-- independently-toggleable business flag, not tied to visibility.
ALTER TABLE "materials" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "suppliers" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "weaving_points" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "warehouses" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "product_variants" ADD COLUMN "deletedAt" TIMESTAMP(3);
