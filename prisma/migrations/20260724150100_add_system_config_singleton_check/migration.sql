-- Enforce the system_config singleton: exactly one row, always id=1.
-- Same raw-SQL-migration pattern as 20260723021500_add_check_constraints.
ALTER TABLE "system_config"
  ADD CONSTRAINT "system_config_singleton_chk"
  CHECK ("id" = 1);
