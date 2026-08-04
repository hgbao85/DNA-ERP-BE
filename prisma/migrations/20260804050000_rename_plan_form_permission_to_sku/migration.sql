-- Rename the PLAN_FORM permission module key to SKU (endpoint/module rename, see
-- PERMISSION_MODULES in permission-modules.constant.ts). Update-in-place keeps each
-- permission's id stable, so existing role_permissions links are not affected.
UPDATE "permissions" SET "module" = 'SKU' WHERE "module" = 'PLAN_FORM';
