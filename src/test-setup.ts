import { runMigrations } from './db/migrate';

// Run migrations before all tests
runMigrations();
