#!/usr/bin/env node
/**
 * Loads skeepto/.env (Mongo, SKER_ADMIN_*, JWT, etc.) then starts SkServer.
 * Run: node run-with-env.mjs  |  npm start  |  chmod +x && ./run-with-env.mjs
 * Copy .env.example to ../../.env and set passwords there — never commit .env.
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envRoot = resolve(__dirname, '../../.env')
const envLocal = resolve(__dirname, '.env')
const envPath = existsSync(envLocal) ? envLocal : envRoot

if (existsSync(envPath)) {
  const { error } = config({ path: envPath })
  if (error) {
    console.error('Failed to load .env:', error.message)
    process.exit(1)
  }
  console.log('Loaded environment from', envPath)
} else {
  console.warn('No .env in', envLocal, 'or', envRoot)
  console.warn('Copy .env.example to skeepto/.env or Node/Server/.env')
}

await import('./SkServer.mjs')
