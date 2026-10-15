import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemoryHealthIndicator } from '@nestjs/terminus';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApiEnvelope } from './api-envelope.type';

interface HealthData {
  status: string;
  info: Record<string, { status: string }>;
}

describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Chỉ báo bộ nhớ (`checkHeap`, ngưỡng 1 GiB) đo heap của CHÍNH tiến trình jest: ts-jest + 2 bộ e2e chạy chung 1 tiến trình
      // (máy CI ít nhân) làm heap vượt 1 GiB -> /health trả 503 dù app bình thường (đo: 740 MB khi chạy riêng 1 bộ). Bài này
      // chỉ kiểm "app và DB sống", nên cố định chỉ báo bộ nhớ là "up".
      .overrideProvider(MemoryHealthIndicator)
      .useValue({ checkHeap: () => Promise.resolve({ memory_heap: { status: 'up' } }) })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/health (GET) reports the app and database as up', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    const body = response.body as ApiEnvelope<HealthData>;
    expect(body.data.status).toBe('ok');
    expect(body.data.info.database.status).toBe('up');
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
  });
});
