/**
 * Tests - Authentification et Autorisation
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Setup
const app = express();
app.use(express.json());

// Mock config
jest.mock('../../config', () => ({
  jwt: {
    secret: 'test-secret',
    expiresIn: '1h'
  },
  hospitals: {
    HMR: { name: 'Test Hospital' }
  },
  env: 'test'
}));

// Mock database
jest.mock('../../config/database', () => ({
  query: jest.fn()
}));

const db = require('../../config/database');
const { authenticate, authorize, authorizeHospital } = require('../../src/middleware/auth');

// Routes de test
app.get('/protected', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.get('/admin-only', authenticate, authorize('admin', 'superadmin'), (req, res) => {
  res.json({ success: true });
});

app.get('/hospital/:code', authenticate, authorizeHospital, (req, res) => {
  res.json({ success: true });
});

describe('Authentication Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createToken = (payload, expiresIn = '1h') => {
    return jwt.sign(payload, 'test-secret', { expiresIn });
  };

  describe('authenticate()', () => {
    it('devrait autoriser avec un token valide', async () => {
      const token = createToken({
        userId: 1,
        uuid: 'test-uuid',
        email: 'test@test.com',
        role: 'nurse',
        hospitalId: 1,
        hospitalCode: 'HMR'
      });

      db.query.mockResolvedValue({
        rows: [{
          id: 1,
          uuid: 'test-uuid',
          email: 'test@test.com',
          first_name: 'Test',
          last_name: 'User',
          role: 'nurse',
          hospital_id: 1,
          hospital_code: 'HMR',
          is_active: true
        }]
      });

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe('test@test.com');
    });

    it('devrait rejeter sans token', async () => {
      const response = await request(app)
        .get('/protected');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('manquant');
    });

    it('devrait rejeter un token invalide', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('invalide');
    });

    it('devrait rejeter un token expiré', async () => {
      const token = createToken({ userId: 1 }, '-1s'); // Expiré immédiatement

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('TOKEN_EXPIRED');
    });

    it('devrait rejeter si l\'utilisateur est désactivé', async () => {
      const token = createToken({ userId: 1 });

      db.query.mockResolvedValue({
        rows: [{
          id: 1,
          is_active: false
        }]
      });

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('désactivé');
    });
  });

  describe('authorize()', () => {
    it('devrait autoriser un rôle valide', async () => {
      const token = createToken({
        userId: 1,
        role: 'admin'
      });

      db.query.mockResolvedValue({
        rows: [{
          id: 1,
          role: 'admin',
          is_active: true
        }]
      });

      const response = await request(app)
        .get('/admin-only')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
    });

    it('devrait rejeter un rôle non autorisé', async () => {
      const token = createToken({
        userId: 1,
        role: 'nurse'
      });

      db.query.mockResolvedValue({
        rows: [{
          id: 1,
          role: 'nurse',
          is_active: true
        }]
      });

      const response = await request(app)
        .get('/admin-only')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('non autorisé');
    });
  });

  describe('authorizeHospital()', () => {
    it('devrait autoriser l\'accès à son propre hôpital', async () => {
      const token = createToken({
        userId: 1,
        role: 'nurse',
        hospitalCode: 'HMR'
      });

      db.query.mockResolvedValue({
        rows: [{
          id: 1,
          role: 'nurse',
          hospital_code: 'HMR',
          is_active: true
        }]
      });

      const response = await request(app)
        .get('/hospital/HMR')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
    });

    it('devrait rejeter l\'accès à un autre hôpital', async () => {
      const token = createToken({
        userId: 1,
        role: 'nurse',
        hospitalCode: 'HND'
      });

      db.query.mockResolvedValue({
        rows: [{
          id: 1,
          role: 'nurse',
          hospital_code: 'HND',
          is_active: true
        }]
      });

      const response = await request(app)
        .get('/hospital/HMR')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });

    it('devrait autoriser superadmin à tous les hôpitaux', async () => {
      const token = createToken({
        userId: 1,
        role: 'superadmin'
      });

      db.query.mockResolvedValue({
        rows: [{
          id: 1,
          role: 'superadmin',
          is_active: true
        }]
      });

      const response = await request(app)
        .get('/hospital/HMR')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
    });
  });
});

describe('User Model Authentication', () => {
  const bcrypt = require('bcryptjs');
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('authenticate()', () => {
    it('devrait authentifier avec des credentials valides', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      
      db.query
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            uuid: 'test-uuid',
            email: 'test@test.com',
            password_hash: passwordHash,
            first_name: 'Test',
            last_name: 'User',
            role: 'nurse',
            hospital_id: 1,
            hospital_code: 'HMR',
            hospital_name: 'Test Hospital',
            is_active: true
          }]
        })
        .mockResolvedValueOnce({}); // Update last_login

      const User = require('../../src/models/User');
      const result = await User.authenticate('test@test.com', 'password123');

      expect(result.token).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe('test@test.com');
    });

    it('devrait rejeter un email inexistant', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const User = require('../../src/models/User');
      
      await expect(User.authenticate('wrong@test.com', 'password'))
        .rejects.toThrow('incorrect');
    });

    it('devrait rejeter un mot de passe incorrect', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      
      db.query.mockResolvedValue({
        rows: [{
          id: 1,
          email: 'test@test.com',
          password_hash: passwordHash,
          is_active: true
        }]
      });

      const User = require('../../src/models/User');
      
      await expect(User.authenticate('test@test.com', 'wrongpassword'))
        .rejects.toThrow('incorrect');
    });
  });

  describe('verifyToken()', () => {
    it('devrait vérifier un token valide', () => {
      const User = require('../../src/models/User');
      const token = jwt.sign({ userId: 1 }, 'test-secret', { expiresIn: '1h' });
      
      const decoded = User.verifyToken(token);
      
      expect(decoded.userId).toBe(1);
    });

    it('devrait rejeter un token expiré', () => {
      const User = require('../../src/models/User');
      const token = jwt.sign({ userId: 1 }, 'test-secret', { expiresIn: '-1s' });
      
      expect(() => User.verifyToken(token)).toThrow('expiré');
    });
  });
});
