// Unit + component tests (jest-expo). Integration tests against the local
// Supabase stack run separately: `npm run test:integration`.
module.exports = {
  preset: 'jest-expo',
  testTimeout: 15000,
  testMatch: ['<rootDir>/src/**/*.test.ts?(x)'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  collectCoverageFrom: ['src/lib/**/*.ts', 'src/components/**/*.tsx', '!src/lib/supabase.ts'],
};
