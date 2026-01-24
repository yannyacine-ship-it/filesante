/**
 * Tests d'intégration - API Routes
 */

const request = require('supertest');
const express = require('express');

// Setup de l'app pour les tests
const app = express();
app.use(express.json());

// Mock des modules
jest.mock('../../config/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  healthCheck: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/models/Patient', () => ({
  create: jest.fn(),
  activate: jest.fn(),
  getByToken: jest.fn(),
  getById: jest.fn(),
  notify: jest.fn(),
  markReturned: jest.fn(),
  markNoShow: jest.fn(),
  cancel: jest.fn(),
  getQueue: jest.fn(),
  getStats: jest.fn()
}));

jest.mock('../../src/services/SmsService', () => ({
  sendRegistrationConfirmation: jest.fn().mockResolvedValue({ success: true }),
  sendNotification: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mockQRCode')
}));

const Patient = require('../../src/models/Patient');
const patientsRoutes = require('../../src/routes/patients');
const hospitalsRoutes = require('../../src/routes/hospitals');

app.use('/api/patients', patientsRoutes);
app.use('/api/hospitals', hospitalsRoutes);

describe('API Patients', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/patients', () => {
    it('devrait créer un patient et retourner un QR code', async () => {
      Patient.create.mockResolvedValue({
        id: 1,
        uuid: 'test-uuid',
        token: 'ABC123XY',
        priority: 'P4',
        estimated_wait_minutes: 180,
        position_in_queue: 5
      });

      const response = await request(app)
        .post('/api/patients')
        .send({
          hospitalCode: 'HMR',
          priority: 'P4',
          reason: 'douleur_mineure'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.token).toBe('ABC123XY');
      expect(response.body.data.qrCode).toContain('data:image/png;base64');
    });

    it('devrait rejeter une priorité invalide', async () => {
      const response = await request(app)
        .post('/api/patients')
        .send({
          hospitalCode: 'HMR',
          priority: 'P1' // Invalide
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('devrait rejeter un code hôpital invalide', async () => {
      const response = await request(app)
        .post('/api/patients')
        .send({
          hospitalCode: 'INVALID',
          priority: 'P4'
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/patients/:token/activate', () => {
    it('devrait activer un patient avec un numéro de téléphone valide', async () => {
      Patient.activate.mockResolvedValue({
        id: 1,
        status: 'waiting',
        priority: 'P4',
        estimated_wait_minutes: 180,
        position_in_queue: 5,
        activated_at: new Date()
      });

      const response = await request(app)
        .post('/api/patients/ABC123XY/activate')
        .send({ phone: '5141234567' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('waiting');
    });

    it('devrait rejeter un numéro de téléphone invalide', async () => {
      const response = await request(app)
        .post('/api/patients/ABC123XY/activate')
        .send({ phone: '123' }); // Trop court

      expect(response.status).toBe(400);
    });

    it('devrait retourner 404 si le token n\'existe pas', async () => {
      Patient.activate.mockRejectedValue(new Error('Patient non trouvé ou déjà activé'));

      const response = await request(app)
        .post('/api/patients/INVALID/activate')
        .send({ phone: '5141234567' });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/patients/:token', () => {
    it('devrait retourner les infos d\'un patient', async () => {
      Patient.getByToken.mockResolvedValue({
        id: 1,
        token: 'ABC123XY',
        status: 'waiting',
        priority: 'P4',
        estimated_wait_minutes: 120,
        position_in_queue: 3,
        hospital_code: 'HMR',
        hospital_name: 'Hôpital Maisonneuve-Rosemont',
        hospital_address: '5415 boul. de l\'Assomption',
        hospital_phone: '514-252-3400',
        is_escalated: false,
        created_at: new Date(),
        activated_at: new Date(Date.now() - 3600000)
      });

      const response = await request(app)
        .get('/api/patients/ABC123XY');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.token).toBe('ABC123XY');
      expect(response.body.data.hospital.code).toBe('HMR');
      expect(response.body.data.waitingMinutes).toBeGreaterThan(0);
    });

    it('devrait retourner 404 si non trouvé', async () => {
      Patient.getByToken.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/patients/INVALID');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/patients/:id/notify', () => {
    it('devrait notifier un patient', async () => {
      Patient.getById.mockResolvedValue({
        id: 1,
        phone: '5141234567',
        hospital_name: 'Test Hospital'
      });
      Patient.notify.mockResolvedValue({
        id: 1,
        status: 'notified',
        notified_at: new Date()
      });

      const response = await request(app)
        .post('/api/patients/1/notify');

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('notified');
    });
  });

  describe('POST /api/patients/:id/return', () => {
    it('devrait marquer un patient comme revenu', async () => {
      Patient.markReturned.mockResolvedValue({
        id: 1,
        status: 'returned',
        returned_at: new Date()
      });

      const response = await request(app)
        .post('/api/patients/1/return');

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('returned');
    });
  });

  describe('POST /api/patients/:id/noshow', () => {
    it('devrait marquer un patient comme no-show', async () => {
      Patient.markNoShow.mockResolvedValue({
        id: 1,
        status: 'noshow'
      });

      const response = await request(app)
        .post('/api/patients/1/noshow');

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('noshow');
    });
  });
});

describe('API Hospitals', () => {
  const db = require('../../config/database');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/hospitals', () => {
    it('devrait lister tous les hôpitaux', async () => {
      db.query.mockResolvedValue({
        rows: [
          { id: 1, code: 'HMR', name: 'Hôpital Maisonneuve-Rosemont', is_active: true },
          { id: 2, code: 'HND', name: 'Hôpital Notre-Dame', is_active: true }
        ]
      });

      const response = await request(app)
        .get('/api/hospitals');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/hospitals/:code/queue', () => {
    it('devrait retourner la file d\'attente', async () => {
      Patient.getQueue.mockResolvedValue([
        { id: 1, token: 'ABC', status: 'waiting', priority: 'P4', waiting_minutes: 45 },
        { id: 2, token: 'DEF', status: 'notified', priority: 'P5', waiting_minutes: 120 }
      ]);

      const response = await request(app)
        .get('/api/hospitals/HMR/queue');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta.hospitalCode).toBe('HMR');
    });

    it('devrait filtrer par priorité', async () => {
      Patient.getQueue.mockResolvedValue([
        { id: 1, token: 'ABC', status: 'waiting', priority: 'P4' }
      ]);

      const response = await request(app)
        .get('/api/hospitals/HMR/queue?priority=P4');

      expect(response.status).toBe(200);
      expect(Patient.getQueue).toHaveBeenCalledWith('HMR', expect.objectContaining({ priority: 'P4' }));
    });
  });

  describe('GET /api/hospitals/:code/stats', () => {
    it('devrait retourner les statistiques', async () => {
      Patient.getStats.mockResolvedValue({
        total_active: '15',
        pending: '3',
        waiting: '10',
        notified: '2',
        avg_estimated_wait: '145.5'
      });
      
      db.query.mockResolvedValue({
        rows: [{
          total_registered: 50,
          total_activated: 45,
          total_notified: 40,
          total_returned: 35,
          total_noshow: 3,
          total_cancelled: 2,
          avg_wait_time_minutes: 132.5
        }]
      });

      const response = await request(app)
        .get('/api/hospitals/HMR/stats');

      expect(response.status).toBe(200);
      expect(response.body.data.realtime.totalActive).toBe(15);
      expect(response.body.data.daily.returned).toBe(35);
    });
  });
});
