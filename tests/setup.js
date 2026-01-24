/**
 * Setup des tests Jest
 */

// Variables d'environnement pour les tests
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://filesante:filesante@localhost:5432/filesante_test';

// Timeout global
jest.setTimeout(10000);

// Mock du logger pour éviter les logs pendant les tests
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  logRequest: jest.fn(),
  logPatientAction: jest.fn(),
  logJob: jest.fn()
}));

// Mock de Twilio
jest.mock('twilio', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        sid: 'SM_TEST_SID_12345',
        status: 'sent'
      })
    }
  }));
});

// Cleanup après tous les tests
afterAll(async () => {
  // Fermer les connexions DB si nécessaire
  try {
    const db = require('../config/database');
    await db.close();
  } catch (error) {
    // Ignorer si déjà fermé
  }
});
