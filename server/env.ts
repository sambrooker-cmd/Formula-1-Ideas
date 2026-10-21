// Load .env (OPENF1_USERNAME / OPENF1_PASSWORD) if present. Never committed: see .gitignore.
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

export const credentials =
  process.env.OPENF1_USERNAME && process.env.OPENF1_PASSWORD
    ? { username: process.env.OPENF1_USERNAME, password: process.env.OPENF1_PASSWORD }
    : null;
