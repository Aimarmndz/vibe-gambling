// SPDX-License-Identifier: AGPL-3.0-or-later
// Arranca el GitHub falso (solo desarrollo, tests y E2E).
import { ConfigError, loadFakeGitHubEnv } from '../config.ts'
import { buildFakeGitHub } from './app.ts'

try {
  const env = loadFakeGitHubEnv()
  const app = buildFakeGitHub(env, { level: env.LOG_LEVEL })
  const stop = () => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    )
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  await app.listen({ host: env.FAKE_GITHUB_HOST, port: env.FAKE_GITHUB_PORT })
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error)
  process.exit(1)
}
