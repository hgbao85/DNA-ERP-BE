import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import configuration from '../../src/config/configuration';
import { envValidationSchema } from '../../src/config/env.validation';
import { UsersModule } from '../../src/modules/users/users.module';
import { UsersService } from '../../src/modules/users/users.service';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { PrismaModule } from '../../src/prisma/prisma.module';

describe('UsersService (integration, real Postgres)', () => {
  let usersService: UsersService;
  let prisma: PrismaServiceType;

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
        UsersModule,
      ],
    }).compile();

    usersService = moduleRef.get(UsersService);
    prisma = moduleRef.get(PRISMA_SERVICE);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a user transactionally and writes a CREATE audit-log entry', async () => {
    const email = `integration-${Date.now()}@dna-erp.local`;

    const created = await usersService.create({
      email,
      password: 'IntegrationTest123!',
      firstName: 'Integration',
      lastName: 'Test',
    });

    expect(created.id).toEqual(expect.any(String));
    expect(created.email).toBe(email);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { tableName: 'User', recordId: created.id, action: 'CREATE' },
    });
    expect(auditEntry).not.toBeNull();
  });

  it('soft-deletes a user: excluded from reads, delete recorded as an audit UPDATE', async () => {
    const email = `integration-delete-${Date.now()}@dna-erp.local`;

    const created = await usersService.create({
      email,
      password: 'IntegrationTest123!',
      firstName: 'ToDelete',
      lastName: 'User',
    });

    await usersService.remove(created.id);

    await expect(usersService.findOne(created.id)).rejects.toThrow();

    // the row must still physically exist (soft delete, not hard delete)
    const raw = await prisma.$queryRaw<
      { deletedAt: Date | null }[]
    >`SELECT "deletedAt" FROM users WHERE id = ${created.id}`;
    expect(raw[0]?.deletedAt).not.toBeNull();

    const auditEntry = await prisma.auditLog.findFirst({
      where: { tableName: 'User', recordId: created.id, action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditEntry).not.toBeNull();
  });
});
