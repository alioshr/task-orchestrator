import { existsSync } from 'fs';
import { runMigrations } from './db/migrate';
import { getConfigPath, getDbPath, writeDefaultConfig, initConfig } from './config';
import { runStartupChecks } from './config/startup-checks';

/**
 * Safe bootstrap for library consumers.
 *
 * - First run (no config or db): creates config.yaml, runs migrations, loads config.
 * - Subsequent runs: loads config and checks for orphaned states. Never touches db schema.
 *
 * Set TASK_ORCHESTRATOR_HOME env before calling to control the storage directory.
 * Defaults to ~/.task-orchestrator/
 */
export function bootstrap(): void {
  const configPath = getConfigPath();
  const dbPath = getDbPath();

  if (!existsSync(configPath) && !existsSync(dbPath)) {
    writeDefaultConfig(configPath);
    runMigrations();
    initConfig();
    return;
  }

  initConfig();
  runStartupChecks();
}
