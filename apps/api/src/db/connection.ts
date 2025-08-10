import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Connection for migrations
export const migrationClient = postgres(connectionString, { max: 1 });

// Connection for queries
export const queryClient = postgres(connectionString);

// Drizzle instance
export const db = drizzle(queryClient, { schema });