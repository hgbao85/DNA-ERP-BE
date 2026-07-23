import { execSync } from 'child_process';
import { TEST_DATABASE_URL } from './test-db.constants';

/** Applies all Prisma migrations to the test database before the suite runs. */
export default function globalSetup(): void {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
