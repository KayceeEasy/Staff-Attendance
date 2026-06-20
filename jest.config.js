module.exports = {
    testEnvironment: 'jsdom',
    collectCoverageFrom: ['src/**/*.js'],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'clover'],
    testMatch: ['**/tests/**/*.test.js']
};
