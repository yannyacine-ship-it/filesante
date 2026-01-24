/**
 * Tests unitaires - Modèle Patient
 */

const db = require('../../config/database');

// Mock de la base de données
jest.mock('../../config/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  transaction: jest.fn()
}));

// Mock de la config
jest.mock('../../config', () => ({
  ttl: {
    pending: 7200000,
    waiting: 43200000,
    notified: 10800000,
    returned: 3600000,
    noshow: 86400000,
    cancelled: 86400000
  },
  alerts: {
    overdue: 21600000,
    escalate: 28800000,
    notifyBefore: 2700000
  },
  hospitals: {
    HMR: { name: 'Hôpital Maisonneuve-Rosemont' },
    HND: { name: 'Hôpital Notre-Dame' }
  }
}));

const Patient = require('../../src/models/Patient');

describe('Patient Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create()', () => {
    it('devrait créer un patient avec les bonnes valeurs', async () => {
      // Mock de la requête pour récupérer l'hôpital
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // Hospital lookup
        .mockResolvedValueOnce({ rows: [{ queue_length: '5', avg_wait: '180' }] }) // Queue info
        .mockResolvedValueOnce({ 
          rows: [{ 
            id: 1,
            uuid: 'test-uuid',
            token: 'ABC123',
            priority: 'P4',
            estimated_wait_minutes: 180,
            position_in_queue: 6
          }] 
        }); // Insert
      
      const result = await Patient.create({
        hospitalCode: 'HMR',
        priority: 'P4',
        reason: 'Test'
      });
      
      expect(result.priority).toBe('P4');
      expect(db.query).toHaveBeenCalledTimes(3);
    });

    it('devrait rejeter si l\'hôpital n\'existe pas', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      
      await expect(Patient.create({
        hospitalCode: 'INVALID',
        priority: 'P4'
      })).rejects.toThrow('Hôpital INVALID non trouvé');
    });

    it('devrait calculer la position et le temps estimé correctement', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ queue_length: '10', avg_wait: '200' }] })
        .mockResolvedValueOnce({ 
          rows: [{ 
            id: 1,
            token: 'XYZ789',
            priority: 'P5',
            estimated_wait_minutes: 240 + (10 * 15), // baseWait + position * 15
            position_in_queue: 11
          }] 
        });
      
      const result = await Patient.create({
        hospitalCode: 'HMR',
        priority: 'P5'
      });
      
      // P5 base wait = 240, position 11, so 240 + (10 * 15) = 390
      expect(result.position_in_queue).toBe(11);
    });
  });

  describe('activate()', () => {
    it('devrait activer un patient en statut pending', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ 
            rows: [{ 
              id: 1, 
              token: 'ABC123', 
              status: 'pending',
              hospital_id: 1 
            }] 
          }) // SELECT FOR UPDATE
          .mockResolvedValueOnce({ 
            rows: [{ 
              id: 1, 
              status: 'waiting', 
              phone: '5141234567',
              activated_at: new Date()
            }] 
          }) // UPDATE
          .mockResolvedValueOnce({}) // Stats update
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn()
      };
      
      db.getClient.mockResolvedValue(mockClient);
      
      const result = await Patient.activate('ABC123', '5141234567');
      
      expect(result.status).toBe('waiting');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('devrait rejeter si le patient n\'existe pas ou est déjà activé', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // SELECT returns empty
          .mockResolvedValueOnce({}), // ROLLBACK
        release: jest.fn()
      };
      
      db.getClient.mockResolvedValue(mockClient);
      
      await expect(Patient.activate('INVALID', '5141234567'))
        .rejects.toThrow('Patient non trouvé ou déjà activé');
    });
  });

  describe('notify()', () => {
    it('devrait notifier un patient en statut waiting', async () => {
      db.query
        .mockResolvedValueOnce({ 
          rows: [{ 
            id: 1, 
            status: 'notified',
            notified_at: new Date(),
            hospital_id: 1
          }] 
        })
        .mockResolvedValueOnce({}); // Stats update
      
      const result = await Patient.notify(1);
      
      expect(result.status).toBe('notified');
    });

    it('devrait rejeter si le patient n\'est pas en statut waiting', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      
      await expect(Patient.notify(999))
        .rejects.toThrow('Patient non trouvé ou statut invalide');
    });
  });

  describe('markReturned()', () => {
    it('devrait marquer un patient comme revenu', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ 
            rows: [{ 
              id: 1, 
              status: 'returned',
              activated_at: new Date(Date.now() - 3600000),
              returned_at: new Date(),
              hospital_id: 1
            }] 
          })
          .mockResolvedValueOnce({}) // Stats
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn()
      };
      
      db.getClient.mockResolvedValue(mockClient);
      
      const result = await Patient.markReturned(1);
      
      expect(result.status).toBe('returned');
    });
  });

  describe('getByToken()', () => {
    it('devrait retourner le patient avec les infos hôpital', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          token: 'ABC123',
          hospital_code: 'HMR',
          hospital_name: 'Hôpital Maisonneuve-Rosemont'
        }]
      });
      
      const result = await Patient.getByToken('ABC123');
      
      expect(result.token).toBe('ABC123');
      expect(result.hospital_code).toBe('HMR');
    });

    it('devrait retourner null si non trouvé', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      
      const result = await Patient.getByToken('INVALID');
      
      expect(result).toBeNull();
    });
  });

  describe('getQueue()', () => {
    it('devrait retourner la file d\'attente', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          { id: 1, token: 'ABC', status: 'waiting', waiting_minutes: 45 },
          { id: 2, token: 'DEF', status: 'notified', waiting_minutes: 120 }
        ]
      });
      
      const result = await Patient.getQueue('HMR');
      
      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('waiting');
    });

    it('devrait filtrer par priorité', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 1, token: 'ABC', priority: 'P4' }]
      });
      
      await Patient.getQueue('HMR', { priority: 'P4' });
      
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('p.priority = $'),
        expect.arrayContaining(['HMR', 'P4'])
      );
    });
  });

  describe('cleanupExpired()', () => {
    it('devrait supprimer les patients expirés', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          { id: 1, status: 'pending', hospital_id: 1 },
          { id: 2, status: 'noshow', hospital_id: 1 }
        ]
      });
      
      const result = await Patient.cleanupExpired();
      
      expect(result).toHaveLength(2);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM patients'),
        undefined
      );
    });
  });

  describe('escalateOverdue()', () => {
    it('devrait escalader les patients en attente prolongée', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          { id: 1, token: 'ABC', is_escalated: true }
        ]
      });
      
      const result = await Patient.escalateOverdue();
      
      expect(result[0].is_escalated).toBe(true);
    });
  });
});
