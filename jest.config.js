export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.js'],
  coverageDirectory: './coverage',
  collectCoverageFrom: ['src/**/*.js', '!src/**/*.test.js']
};
