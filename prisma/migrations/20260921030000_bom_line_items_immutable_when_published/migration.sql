-- Việc 2 (changelog-2026-09-11-bom-revision-ghim-cu-canh-bao.md mục 8): assertDraft() ở
-- BomRevisionsService/SkusService chặn được MỌI đường sửa qua API, nhưng KHÔNG chặn được ai
-- sửa thẳng vào DB bằng script/SQL (đúng đường đã gây ra ca 6mm -> 60mm trên bom_revision id=1
-- ACTIVE). Chốt này đặt bất biến "chỉ DRAFT mới sửa được dòng con" ở tầng DB - script/SQL đi
-- thẳng qua psql/pg cũng bị chặn như đi qua API.
--
-- Escape hatch: SET LOCAL "dna.bom_maintenance" = 'on' trong đúng transaction cần bỏ qua (vd
-- seed/khôi phục dữ liệu) - xem CONTRIBUTING.md mục "Sửa dữ liệu BOM ngoài API".
--
-- Áp cho cả 8 bảng con có cột "bomRevisionId" (tra information_schema.columns xác nhận đúng 8,
-- không phải chỉ piece_bom - bỏ sót bảng nào là chừa lại đúng 1 cửa sau):
-- bom_piece, bom_part, piece_bom, part_bom, piece_material_item, piece_material_yield,
-- consumable_bom, bom_accessory_items.
--
-- ERRCODE 'IE001' chọn theo quy ước chữ cái I-Z / chữ số 5-9 dành cho lỗi tự đặt của ứng dụng,
-- tránh trùng dải mã đã/sẽ được chuẩn SQL gán cho lỗi hệ thống. Thực nghiệm xác nhận (không đoán):
-- một lệnh Prisma bình thường (không phải $queryRaw) khi trigger raise exception sẽ trả về
-- PrismaClientKnownRequestError code P2039 ("Database error"), với mã lỗi Postgres gốc nằm ở
-- meta.driverAdapterError.cause.originalCode - AllExceptionsFilter đọc đúng chỗ này để map 409.

CREATE OR REPLACE FUNCTION assert_bom_revision_draft() RETURNS TRIGGER AS $$
DECLARE
  v_rev_id BIGINT;
  v_status "BomRevisionStatus";
BEGIN
  -- Lối thoát có kiểm soát cho seed/khôi phục dữ liệu - CHỈ có hiệu lực trong transaction gọi
  -- SET LOCAL, không rò sang transaction/connection khác.
  IF current_setting('dna.bom_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_rev_id := OLD."bomRevisionId";
  ELSE
    v_rev_id := NEW."bomRevisionId";
  END IF;

  SELECT status INTO v_status FROM bom_revision WHERE id = v_rev_id;

  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'BomRevision % đang % - chỉ DRAFT mới sửa được dòng con (thao tác % trên %)',
      v_rev_id, v_status, TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'IE001';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assert_bom_revision_draft() IS
  'Chặn INSERT/UPDATE/DELETE trên dòng con của một bom_revision không còn DRAFT - xem changelog-2026-09-11-bom-revision-ghim-cu-canh-bao.md mục 8. Bỏ qua trong transaction có SET LOCAL "dna.bom_maintenance" = ''on''.';

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bom_piece', 'bom_part', 'piece_bom', 'part_bom',
    'piece_material_item', 'piece_material_yield', 'consumable_bom', 'bom_accessory_items'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS bom_revision_draft_guard ON %I', t
    );
    EXECUTE format(
      'CREATE TRIGGER bom_revision_draft_guard
         BEFORE INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION assert_bom_revision_draft()',
      t
    );
  END LOOP;
END $$;
