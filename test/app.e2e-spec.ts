import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
