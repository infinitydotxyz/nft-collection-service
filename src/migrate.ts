import 'reflect-metadata';
import { migrateAttributes } from './migrations/migrateAttributes';

async function runMigrations() {
  await migrateAttributes();
}

runMigrations().then(() => console.log('All migrations finished.')).catch(console.error);
