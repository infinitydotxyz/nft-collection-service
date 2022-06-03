import 'reflect-metadata';
import { migrateAttributes } from './migrations/migrateAttributes';

// TODO: proper migration handling? (e.g. kinda like how laravel does it; keep track of the last migration that ran by storing the file name in firestore)

async function runMigrations() {
  await migrateAttributes();
}

runMigrations().then(() => console.log('All migrations finished.')).catch(console.error);
