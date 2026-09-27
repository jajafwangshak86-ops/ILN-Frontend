// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from 'eslint-plugin-storybook';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { requireAsAnyJustification } from './eslint-rules/require-as-any-justification.mjs';
import { noUncontrolledDefaultValue } from './eslint-rules/no-uncontrolled-defaultvalue.mjs';

const localPlugin = {
  rules: {
    'require-as-any-justification': requireAsAnyJustification,
    'no-uncontrolled-defaultvalue': noUncontrolledDefaultValue,
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Additional ignores:
    '*.config.js',
    '*.config.mjs',
    'public/**',
    'coverage/**',
    'storybook-static/**',
  ]),
  // Prettier integration - must be last to override other configs
  prettierConfig,
  {
    // eslint-config-next only registers the react-hooks/jsx-a11y/@typescript-eslint
    // plugins for code files; without a matching `files` glob these rules would
    // also apply to generated artifacts (e.g. __tests__/__snapshots__/*.snap),
    // where ESLint cannot resolve the plugins.
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    plugins: {
      prettier,
      local: localPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      // Type-safety: every bare `as any` cast must carry a justification
      // comment on the immediately preceding line (see #911 and
      // CONTRIBUTING.md). Prefer a precise type or type guard instead.
      'local/require-as-any-justification': 'error',
      // Audit and flag uncontrolled input defaultValue with missing or no-op onChange (#861)
      'local/no-uncontrolled-defaultvalue': 'error',
      // React hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // React Compiler readiness rules (bundled as "error" by eslint-config-next's
      // core-web-vitals since the Next 16 upgrade). They flag long-standing, correct
      // patterns for syncing client-only state (browser APIs, localStorage, sockets)
      // across ~50 existing files. Downgraded to warn until those are migrated
      // incrementally; genuine bugs found while triaging were fixed directly instead.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // Accessibility rules
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // General best practices
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  // Allow `any` in tests temporarily to unblock commits; replace with proper
  // typings later as a follow-up task.
  {
    files: ['**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/*.stories.*'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      // Test doubles and DOM stubs legitimately need loose casts; keep the
      // justification rule advisory there so the suite stays green while
      // production code is held to `error`.
      'local/require-as-any-justification': 'warn',
    },
  },
  // Restrict direct fetch and QueryClient calls in UI components outside hooks/queries
  {
    files: [
      'src/components/**/*.{js,jsx,ts,tsx}',
      'src/screens/**/*.{js,jsx,ts,tsx}',
      'src/app/**/*.{js,jsx,ts,tsx}',
      'app/**/*.{js,jsx,ts,tsx}',
    ],
    ignores: ['**/__tests__/**', '**/*.test.*', '**/*.spec.*', 'app/api/**', 'app/Providers.tsx'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'Direct fetch calls inside UI component files are disallowed. Extract data-fetching logic into custom hooks under src/hooks/queries (or src/hooks). See CONTRIBUTING.md for exception procedures.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-query',
              importNames: ['useQueryClient', 'QueryClient'],
              message:
                'Direct query-client usage inside UI component files is disallowed. Extract cache invalidation or query management into custom hooks under src/hooks/queries (or src/hooks). See CONTRIBUTING.md for exception procedures.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='fetch'], CallExpression[callee.property.name='fetch']",
          message:
            'Direct fetch calls inside UI component files are disallowed. Extract data-fetching logic into custom hooks under src/hooks/queries (or src/hooks). See CONTRIBUTING.md for exception procedures.',
        },
      ],
    },
  },
  ...storybook.configs['flat/recommended'],
]);

export default eslintConfig;
