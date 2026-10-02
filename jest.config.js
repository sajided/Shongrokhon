// Unit + component tests (jest-expo). Integration tests against the local
// Supabase stack run separately: `npm run test:integration`.
module.exports = {
  preset: 'jest-expo',
  testTimeout: 15000,
  // supabase/functions: pure helpers of Edge Functions (no Deno APIs), e.g. pay/score.ts.
  testMatch: ['<rootDir>/src/**/*.test.ts?(x)', '<rootDir>/supabase/functions/**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  collectCoverageFrom: ['src/lib/**/*.ts', 'src/components/**/*.tsx', '!src/lib/supabase.ts'],
};
