/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';

// Which build this is: the commit on Cloudflare's builds, else the local commit, else the time.
// The page knows it (__BUILD__) and `version.json` says it, so an installed copy can tell that a newer one is out
// (src/core/update.ts).
const BUILD = ((): string => {
  const ci = process.env.WORKERS_CI_COMMIT_SHA;
  if (ci) return ci.slice(0, 12);
  try {
    const sha = execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (sha) return `${sha}-${Date.now().toString(36)}`;
  } catch {
    /* not a git checkout */
  }
  return Date.now().toString(36);
})();

const version = (): Plugin => ({
  name: 'version-json',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) });
  },
});

export default defineConfig({
  // Relative base so the build works from any sub-path (static hosting).
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [version()],
  build: {
    assetsInlineLimit: 0,
  },
  test: {
    testTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'vendor/**', '.claude/**'],
  },
});
