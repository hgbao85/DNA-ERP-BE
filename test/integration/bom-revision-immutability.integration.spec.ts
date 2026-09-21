import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import configuration from '../../src/config/configuration';
import { envValidationSchema } from '../../src/config/env.validation';
import { BomRevisionStatus, ProcessStep } from '../../src/generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { PrismaModule } from '../../src/prisma/prisma.module';

/**
 * Test này chạy trên Postgres THẬT (test/jest-integration.json) - KHÔNG mock Prisma. Mục đích:
 * chứng minh trigger `assert_bom_revision_draft()` (migration 20260921030000) THẬT SỰ chặn ở tầng
 * DB, không chỉ "trên giấy" như `BomRevisionsService.assertDraft()` (guard ở tầng service, một
 * unit test mock Prisma sẽ luôn pass dù trigger có tồn tại hay không).
 *
 * Bối cảnh: `changelog-2026-09-11-bom-revision-ghim-cu-canh-bao.md` mục 8 - một BomRevision đã
 * ACTIVE (đã có CuttingProposal duyệt treo lên) bị sửa RUỘT bằng script/SQL đi thẳng qua DB, không
 * qua bất kỳ service nào nên `assertDraft()` không có cơ hội chặn. Trigger là chốt tầng dưới cùng:
 * chặn cả đường polite (Prisma Client, như test dưới đây mô phỏng) lẫn đường raw SQL.
 */
describe('BomRevision line-item immutability trigger (integration, real Postgres)', () => {
  let prisma: PrismaServiceType;
  let materialId: bigint;
  let mfgProductId: bigint;
  let pieceId: bigint;
  let segmentSpecId: bigint;
  let activeRevisionId: bigint;
  let draftRevisionId: bigint;
  const suffix = Date.now();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
          validationSchema: envValidationSchema,
        }),
        ClsModule.forRoot({ global: true }),
        PrismaModule,
      ],
    }).compile();

    prisma = moduleRef.get(PRISMA_SERVICE);

    const material = await prisma.material.create({
      data: { code: `TRIGGER-TEST-STEEL-${suffix}`, name: 'Sắt test trigger', unit: 'cây' },
    });
    materialId = material.id;

    const segmentSpec = await prisma.segmentSpec.create({
      data: { materialId, cutLengthMm: 100 },
    });
    segmentSpecId = segmentSpec.id;

    const mfgProduct = await prisma.mfgProduct.create({
      data: { factoryCode: `TRIGGER-TEST-PRODUCT-${suffix}`, name: 'SP test trigger' },
    });
    mfgProductId = mfgProduct.id;

    const piece = await prisma.piece.create({
      data: { mfgProductId, code: 'P1', groupNumber: 1, pieceNumber: 1, name: 'Mảnh test' },
    });
    pieceId = piece.id;

    // Đường ĐÚNG, không cần escape hatch: tạo DRAFT -> chèn dòng con -> mới chuyển ACTIVE. Đây
    // chính là thứ tự mà seed-cutting-fixture.ts và SkusService.replacePieces (qua PlanForm) đã
    // luôn tuân theo cho đường ghi thật; "activeRevisionId" mô phỏng đúng trạng thái một BomRevision
    // đã duyệt trong đời thật.
    const activeRevision = await prisma.bomRevision.create({
      data: { mfgProductId, revNo: 1, status: BomRevisionStatus.DRAFT },
    });
    activeRevisionId = activeRevision.id;
    await prisma.pieceBom.create({
      data: {
        bomRevisionId: activeRevisionId,
        mfgProductId,
        pieceId,
        segmentSpecId,
        qtyPerPiece: 1,
        processSteps: [ProcessStep.CAT],
      },
    });
    await prisma.bomRevision.update({
      where: { id: activeRevisionId },
      data: { status: BomRevisionStatus.ACTIVE },
    });

    // Một bản DRAFT riêng, KHÔNG có dòng con - dùng cho ca "vẫn sửa được khi còn DRAFT".
    const draftRevision = await prisma.bomRevision.create({
      data: { mfgProductId, revNo: 2, status: BomRevisionStatus.DRAFT },
    });
    draftRevisionId = draftRevision.id;
  });

  afterAll(async () => {
    await prisma.pieceBom.deleteMany({ where: { bomRevisionId: draftRevisionId } });
    // Bản ACTIVE: trigger chặn xoá thẳng - phải qua escape hatch để dọn dẹp sau test, đúng use
    // case chính đáng mà escape hatch sinh ra để phục vụ (dọn dữ liệu test).
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL "dna.bom_maintenance" = 'on'`);
      await tx.pieceBom.deleteMany({ where: { bomRevisionId: activeRevisionId } });
    });
    await prisma.bomRevision.deleteMany({ where: { mfgProductId } });
    await prisma.piece.deleteMany({ where: { mfgProductId } });
    await prisma.mfgProduct.delete({ where: { id: mfgProductId } });
    await prisma.segmentSpec.delete({ where: { id: segmentSpecId } });
    await prisma.material.delete({ where: { id: materialId } });
    await prisma.$disconnect();
  });

  /** Postgres bọc lỗi trigger dưới nhiều lớp tuỳ đường gọi (Prisma Client thường vs $transaction
   *  trần) - so khớp chuỗi thông điệp trong toàn bộ lỗi (kể cả `cause` lồng nhau) thay vì đoán
   *  1 field cụ thể, để test không giòn theo phiên bản Prisma/driver adapter. */
  function messageChain(error: unknown): string {
    const parts: string[] = [];
    let current: unknown = error;
    for (let i = 0; i < 6 && current; i++) {
      if (current instanceof Error) {
        parts.push(current.message);
        current = (current as { cause?: unknown }).cause;
      } else {
        parts.push(JSON.stringify(current));
        break;
      }
    }
    return parts.join(' | ');
  }

  /** `.rejects.toThrow(/regex/)` không đọc được lỗi lồng nhiều lớp `cause` (driver adapter bọc
   *  lỗi Postgres gốc bên trong PrismaClientKnownRequestError) - bắt tay bằng try/catch rồi so
   *  toàn bộ `messageChain()` để test không giòn theo cách Prisma lồng lỗi ở từng phiên bản. */
  async function expectBlockedByTrigger(op: Promise<unknown>): Promise<void> {
    let threw = false;
    try {
      await op;
    } catch (e) {
      threw = true;
      expect(messageChain(e)).toContain('chỉ DRAFT mới sửa được');
    }
    expect(threw).toBe(true);
  }

  it('chặn INSERT dòng con mới vào một BomRevision đã ACTIVE', async () => {
    await expectBlockedByTrigger(
      prisma.pieceBom.create({
        data: {
          bomRevisionId: activeRevisionId,
          mfgProductId,
          pieceId,
          segmentSpecId,
          qtyPerPiece: 2,
          processSteps: [ProcessStep.CAT],
        },
      }),
    );
  });

  it('chặn UPDATE dòng con đã có của một BomRevision đã ACTIVE (ca thật 6mm -> 60mm)', async () => {
    const existing = await prisma.pieceBom.findFirstOrThrow({
      where: { bomRevisionId: activeRevisionId },
    });
    await expectBlockedByTrigger(
      prisma.pieceBom.update({ where: { id: existing.id }, data: { qtyPerPiece: 99 } }),
    );

    // Xác nhận KHÔNG có gì bị đổi (trigger raise EXCEPTION rollback toàn bộ statement).
    const reread = await prisma.pieceBom.findUniqueOrThrow({ where: { id: existing.id } });
    expect(reread.qtyPerPiece).toBe(1);
  });

  it('chặn DELETE dòng con của một BomRevision đã ACTIVE', async () => {
    const existing = await prisma.pieceBom.findFirstOrThrow({
      where: { bomRevisionId: activeRevisionId },
    });
    await expectBlockedByTrigger(prisma.pieceBom.delete({ where: { id: existing.id } }));
  });

  it('VẪN cho sửa dòng con khi BomRevision còn DRAFT (không cần escape hatch)', async () => {
    const created = await prisma.pieceBom.create({
      data: {
        bomRevisionId: draftRevisionId,
        mfgProductId,
        pieceId,
        segmentSpecId,
        qtyPerPiece: 3,
        processSteps: [ProcessStep.CAT],
      },
    });
    await prisma.pieceBom.update({ where: { id: created.id }, data: { qtyPerPiece: 4 } });
    const reread = await prisma.pieceBom.findUniqueOrThrow({ where: { id: created.id } });
    expect(reread.qtyPerPiece).toBe(4);
  });

  it('escape hatch SET LOCAL "dna.bom_maintenance" cho phép sửa một BomRevision đã ACTIVE, CHỈ trong đúng transaction đó', async () => {
    const existing = await prisma.pieceBom.findFirstOrThrow({
      where: { bomRevisionId: activeRevisionId },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL "dna.bom_maintenance" = 'on'`);
      await tx.pieceBom.update({ where: { id: existing.id }, data: { qtyPerPiece: 5 } });
    });

    const reread = await prisma.pieceBom.findUniqueOrThrow({ where: { id: existing.id } });
    expect(reread.qtyPerPiece).toBe(5);

    // Đặt lại đúng giá trị ban đầu (qua chính escape hatch) để các test khác trong file không phụ
    // thuộc thứ tự chạy, và để không lộ dữ liệu "5" ra ngoài phạm vi test này.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL "dna.bom_maintenance" = 'on'`);
      await tx.pieceBom.update({ where: { id: existing.id }, data: { qtyPerPiece: 1 } });
    });

    // Cờ KHÔNG rò sang lệnh tiếp theo NGOÀI transaction - phải xin lại escape hatch mỗi lần, đúng
    // ý nghĩa "lối thoát có kiểm soát" chứ không phải tắt vĩnh viễn cho cả session/connection.
    await expectBlockedByTrigger(
      prisma.pieceBom.update({ where: { id: existing.id }, data: { qtyPerPiece: 6 } }),
    );
  });
});
