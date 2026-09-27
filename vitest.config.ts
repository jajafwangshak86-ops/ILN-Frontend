import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@/app', replacement: path.resolve(dirname, 'app') },
      { find: '@', replacement: path.resolve(dirname, 'src') },
    ],
  },
  test: {
    // Playwright specs live in ./e2e (see playwright.config.ts testDir) and are
    // run by `pnpm test:e2e`. They match Vitest's default include glob, so they
    // must be excluded here or Playwright throws
    // "Playwright Test did not expect test.describe() to be called here".
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // A handful of suites render large trees (LP dashboard, activity heatmap,
    // full page routes). The 5s default is tight enough that they flake on a
    // loaded runner - especially under `--coverage`, which instruments every
    // module - while still catching genuinely hung tests. 15s still wasn't
    // enough for the CI/coverage job's broad `--coverage.include=src/**`
    // glob (full-src instrumentation, not just the narrow list below) once
    // it moved off the self-hosted runner onto ubuntu-latest - bumped
    // further to give that job real headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: [
        // ── Contract / utils layer (original scope) ──────────────────────
        'src/utils/soroban.ts',
        'src/utils/contract-stats.ts',
        'src/utils/governance.ts',
        'src/lib/contract-events.ts',
        'src/lib/contract-event-stream-state.ts',
        'src/lib/contract/**/*.ts',
        // Phase 1 — hooks directory (issue #882).
        // 38 hook files; tests exist for most but coverage is not yet
        // enforced. Thresholds below are set at the floor measured before
        // enforcement was added; raise them incrementally as gaps are closed.
        // Target: reach parity with the contract-layer thresholds (90/90/90)
        // in two further increments once per-file gaps are identified and
        // addressed.
        'src/hooks/**/*.ts',
        'src/hooks/**/*.tsx',
        // Admin surface — issue #921.
        // Admin components, audit logging, and admin-health utilities operate
        // on privileged protocol actions (pause, token management, governance
        // execution) and must be held to a higher bar than the general
        // component defaults. 90/90/80/90 across lines/functions/branches/
        // statements; the branch floor is 80 rather than 90 because the
        // confirmation-dialog Escape path requires a real browser focus-trap
        // environment that is impractical to simulate end-to-end in jsdom.
        'src/components/admin/**/*.tsx',
        'src/lib/auditLog.ts',
        'src/utils/admin-health.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        // soroban.ts has many internal XDR-parsing branches (transaction
        // result decoding, retry/error paths) that are only reachable with
        // deep Stellar SDK payload mocking. 74% is the current, verified
        // level; raise this incrementally as those paths get covered.
        // src/hooks/** branches are also on a phased plan (issue #882):
        // the initial floor is set conservatively at 50% to avoid
        // an unrealistic jump; raise to ≥70% once the low-coverage hooks
        // (e.g. useTransaction, useAdminActions) gain additional test cases,
        // then to 74%+ to match the contract-layer interim floor.
        branches: 50,
        statements: 90,
        // Per-path overrides — admin surface (issue #921).
        // These are evaluated independently of the global thresholds above.
        // Branch threshold is set at 80 (not 90) because the focus-trap
        // Escape-key path in AdminConfirmDialog requires real browser APIs
        // unavailable in jsdom; all other branch paths are covered.
        'src/components/admin/**/*.tsx': {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        'src/lib/auditLog.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/utils/admin-health.ts': {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
      },
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
    },
    projects: [
      {
        extends: true,
        test: {
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      // The Storybook project is only added when STORYBOOK_TESTS=1 is set
      // (requires: npx playwright install chromium). Setting browser.enabled
      // to false still collects and executes every .stories.tsx file outside
      // a browser context, crashing with "window is not defined" - so the
      // whole project must be omitted, not just disabled.
      ...(process.env.STORYBOOK_TESTS === '1'
        ? [
            {
              extends: true as const,
              plugins: [
                // The plugin will run tests for the stories defined in your Storybook config
                // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
                storybookTest({
                  configDir: path.join(dirname, '.storybook'),
                }),
              ],
              test: {
                name: 'storybook',
                browser: {
                  enabled: true,
                  headless: true,
                  provider: playwright({}),
                  instances: [
                    {
                      browser: 'chromium' as const,
                    },
                  ],
                },
              },
            },
          ]
        : []),
    ],
  },
});
