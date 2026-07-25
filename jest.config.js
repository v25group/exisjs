

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  displayName: 'Exis Framework',
  verbose: true,
  roots: [
    '<rootDir>/packages/exis/tests',
    '<rootDir>/packages/create-exis/tests'
  ],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  modulePathIgnorePatterns: [
    '<rootDir>/packages/*/dist/',
    '<rootDir>/.github/',
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: [
    'packages/exis/src/**/*.ts',
    '!packages/exis/src/index.ts',
  ],
  coverageDirectory: 'coverage',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: '<rootDir>/packages/exis/tsconfig.test.json' },
    ],
  },
}
