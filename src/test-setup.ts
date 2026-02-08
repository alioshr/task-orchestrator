import { runMigrations } from './db/migrate';
import { initConfig } from './config';

runMigrations();
initConfig();
