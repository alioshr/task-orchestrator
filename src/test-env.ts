import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const testDir = join(process.cwd(), '.tmp-test-db');
const testDbPath = join(testDir, 'tasks.db');

mkdirSync(testDir, { recursive: true });
rmSync(testDbPath, { force: true });
rmSync(`${testDbPath}-wal`, { force: true });
rmSync(`${testDbPath}-shm`, { force: true });

process.env.TASK_ORCHESTRATOR_HOME = testDir;
