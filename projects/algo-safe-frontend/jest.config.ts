import type { Config } from 'jest'

const config: Config = {
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
  moduleDirectories: ['node_modules', 'src'],
  transform: {
    '^.+\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  coveragePathIgnorePatterns: ['tests'],
  // Playwright specs live under tests/ and must not run under Jest.
  testPathIgnorePatterns: ['/node_modules/', '/tests/'],
}

export default config
