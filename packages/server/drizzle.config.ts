// SPDX-License-Identifier: AGPL-3.0-or-later
// drizzle-kit solo se usa para generar migraciones (no necesita base de datos).
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
})
