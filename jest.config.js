/**
 * Configuration Jest pour FileSanté
 */

module.exports = {
  // Environnement de test
  testEnvironment: 'node',
  
  // Répertoire racine
  rootDir: '.',
  
  // Patterns de fichiers de test
  testMatch: [
    '**/tests/**/*.test.js',
    '**/__tests__/**/*.js'
  ],
  
  // Fichiers à ignorer
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/'
  ],
  
  // Fichiers de setup
  setupFilesAfterEnv: ['./tests/setup.js'],
  
  // Coverage
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 60,
      lines: 60,
      statements: 60
    }
  },
  
  // Timeout
  testTimeout: 10000,
  
  // Variables d'environnement pour les tests
  globals: {
    'process.env.NODE_ENV': 'test'
  },
  
  // Reporter verbeux
  verbose: true,
  
  // Forcer la sortie après les tests
  forceExit: true,
  
  // Détecter les handles ouverts
  detectOpenHandles: true
};
