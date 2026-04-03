/**
 * Modèle Patient - Logique métier file virtuelle
 */

const db = require('../../config/database');
const config = require('../../config');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Génère un token court unique pour le patient
 */
function generateToken() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

/**
 * Calcule la date d'expiration selon le statut
 */
function calculateExpiresAt(status, referenceDate = new Date()) {
  const ttl = config.ttl[status] || config.ttl.waiting;
  return new Date(referenceDate.getTime() + ttl);
}

const Patient = {
  /**
   * Crée un nouveau patient dans la file
   */
  async create({ hospitalCode, priority, reason, createdBy, notificationMode = 'sms' }) {
    const token = generateToken();
    const uuid = uuidv4();
    
    // Récupérer l'ID de l'hôpital
    const { rows: hospitals } = await db.query(
      'SELECT id FROM hospitals WHERE code = $1',
      [hospitalCode]
    );
    
    if (hospitals.length === 0) {
      throw new Error(`Hôpital ${hospitalCode} non trouvé`);
    }
    
    const hospitalId = hospitals[0].id;
    
    // Calculer la position et le temps estimé
    const { rows: queueInfo } = await db.query(`
      SELECT 
        COUNT(*) as queue_length,
        COALESCE(AVG(estimated_wait_minutes), 180) as avg_wait
      FROM patients 
      WHERE hospital_id = $1 
        AND status IN ('waiting', 'notified')
        AND priority = $2
    `, [hospitalId, priority]);
    
    const position = parseInt(queueInfo[0].queue_length) + 1;
    const baseWait = priority === 'P4' ? 180 : 240;
    const estimatedWait = Math.round(baseWait + (position - 1) * 15);
    
    const expiresAt = calculateExpiresAt('pending');
    
    const { rows } = await db.query(`
      INSERT INTO patients (
        uuid, token, hospital_id, created_by, priority, reason,
        estimated_wait_minutes, position_in_queue, expires_at, notification_mode
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [uuid, token, hospitalId, createdBy, priority, reason, estimatedWait, position, expiresAt, notificationMode]);
    
    logger.logPatientAction('created', rows[0].id, hospitalCode, { priority, position });
    
    return rows[0];
  },
  
  /**
   * Active un patient (après scan QR)
   */
  async activate(token, phone) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Récupérer le patient
      const { rows } = await client.query(
        'SELECT * FROM patients WHERE token = $1 AND status = $2 FOR UPDATE',
        [token, 'pending']
      );
      
      if (rows.length === 0) {
        throw new Error('Patient non trouvé ou déjà activé');
      }
      
      const patient = rows[0];
      const expiresAt = calculateExpiresAt('waiting');
      
      // Mettre à jour
      const { rows: updated } = await client.query(`
        UPDATE patients SET
          phone = $1,
          status = 'waiting',
          activated_at = CURRENT_TIMESTAMP,
          expires_at = $2
        WHERE id = $3
        RETURNING *
      `, [phone, expiresAt, patient.id]);
      
      // Mettre à jour les stats
      await client.query(`
        INSERT INTO daily_stats (hospital_id, date, total_activated)
        VALUES ($1, CURRENT_DATE, 1)
        ON CONFLICT (hospital_id, date) 
        DO UPDATE SET total_activated = daily_stats.total_activated + 1
      `, [patient.hospital_id]);
      
      await client.query('COMMIT');
      
      logger.logPatientAction('activated', patient.id, null, { phone: phone.slice(-4) });
      
      return updated[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
  
  /**
   * Notifie un patient — SMS "Partez maintenant" (30 min avant)
   * Sets confirmation_deadline = NOW + 30min
   */
  async notify(patientId) {
    const expiresAt = calculateExpiresAt('notified');
    const confirmationDeadline = new Date(Date.now() + 30 * 60 * 1000);

    const { rows } = await db.query(`
      UPDATE patients SET
        status = 'notified',
        notified_at = CURRENT_TIMESTAMP,
        expires_at = $1,
        sms_30_sent = true,
        sms_30_sent_at = CURRENT_TIMESTAMP,
        confirmation_deadline = $2
      WHERE id = $3 AND status = 'waiting'
      RETURNING *
    `, [expiresAt, confirmationDeadline, patientId]);
    
    if (rows.length === 0) {
      throw new Error('Patient non trouvé ou statut invalide');
    }
    
    // Mettre à jour les stats
    await db.query(`
      INSERT INTO daily_stats (hospital_id, date, total_notified)
      VALUES ($1, CURRENT_DATE, 1)
      ON CONFLICT (hospital_id, date) 
      DO UPDATE SET total_notified = daily_stats.total_notified + 1
    `, [rows[0].hospital_id]);
    
    logger.logPatientAction('notified', patientId, null);
    
    return rows[0];
  },
  
  /**
   * Marque un patient comme revenu
   */
  async markReturned(patientId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      const expiresAt = calculateExpiresAt('returned');
      
      const { rows } = await client.query(`
        UPDATE patients SET
          status = 'returned',
          returned_at = CURRENT_TIMESTAMP,
          expires_at = $1
        WHERE id = $2 AND status = 'notified'
        RETURNING *
      `, [expiresAt, patientId]);
      
      if (rows.length === 0) {
        throw new Error('Patient non trouvé ou statut invalide');
      }
      
      const patient = rows[0];
      
      // Calculer le temps d'attente réel
      let waitTimeMinutes = null;
      if (patient.activated_at && patient.returned_at) {
        waitTimeMinutes = Math.round(
          (new Date(patient.returned_at) - new Date(patient.activated_at)) / 60000
        );
      }
      
      // Mettre à jour les stats
      await client.query(`
        INSERT INTO daily_stats (hospital_id, date, total_returned, avg_wait_time_minutes)
        VALUES ($1, CURRENT_DATE, 1, $2)
        ON CONFLICT (hospital_id, date) 
        DO UPDATE SET 
          total_returned = daily_stats.total_returned + 1,
          avg_wait_time_minutes = (
            COALESCE(daily_stats.avg_wait_time_minutes, 0) * daily_stats.total_returned + $2
          ) / (daily_stats.total_returned + 1)
      `, [patient.hospital_id, waitTimeMinutes]);
      
      await client.query('COMMIT');
      
      logger.logPatientAction('returned', patientId, null, { waitTimeMinutes });
      
      return patient;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
  
  /**
   * Marque un patient comme no-show
   */
  async markNoShow(patientId) {
    const expiresAt = calculateExpiresAt('noshow');
    
    const { rows } = await db.query(`
      UPDATE patients SET
        status = 'noshow',
        expires_at = $1
      WHERE id = $2 AND status = 'notified'
      RETURNING *
    `, [expiresAt, patientId]);
    
    if (rows.length === 0) {
      throw new Error('Patient non trouvé ou statut invalide');
    }
    
    // Mettre à jour les stats
    await db.query(`
      INSERT INTO daily_stats (hospital_id, date, total_noshow)
      VALUES ($1, CURRENT_DATE, 1)
      ON CONFLICT (hospital_id, date) 
      DO UPDATE SET total_noshow = daily_stats.total_noshow + 1
    `, [rows[0].hospital_id]);
    
    logger.logPatientAction('noshow', patientId, null);
    
    return rows[0];
  },
  
  /**
   * Annule un patient
   */
  async cancel(patientId) {
    const expiresAt = calculateExpiresAt('cancelled');
    
    const { rows } = await db.query(`
      UPDATE patients SET
        status = 'cancelled',
        expires_at = $1
      WHERE id = $2 AND status IN ('pending', 'waiting', 'notified')
      RETURNING *
    `, [expiresAt, patientId]);
    
    if (rows.length === 0) {
      throw new Error('Patient non trouvé ou statut invalide');
    }
    
    // Mettre à jour les stats
    await db.query(`
      INSERT INTO daily_stats (hospital_id, date, total_cancelled)
      VALUES ($1, CURRENT_DATE, 1)
      ON CONFLICT (hospital_id, date) 
      DO UPDATE SET total_cancelled = daily_stats.total_cancelled + 1
    `, [rows[0].hospital_id]);
    
    logger.logPatientAction('cancelled', patientId, null);
    
    return rows[0];
  },
  
  /**
   * Récupère un patient par token
   */
  async getByToken(token) {
    const { rows } = await db.query(`
      SELECT p.*, h.code as hospital_code, h.name as hospital_name, 
             h.address as hospital_address, h.phone as hospital_phone
      FROM patients p
      JOIN hospitals h ON p.hospital_id = h.id
      WHERE p.token = $1
    `, [token]);
    
    return rows[0] || null;
  },
  
  /**
   * Récupère un patient par ID
   */
  async getById(id) {
    const { rows } = await db.query(`
      SELECT p.*, h.code as hospital_code, h.name as hospital_name
      FROM patients p
      JOIN hospitals h ON p.hospital_id = h.id
      WHERE p.id = $1
    `, [id]);
    
    return rows[0] || null;
  },
  
  /**
   * Liste les patients en file pour un hôpital
   */
  async getQueue(hospitalCode, options = {}) {
    const { status, priority, limit = 100 } = options;
    
    let query = `
      SELECT p.*, 
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(p.activated_at, p.created_at))) / 60 as waiting_minutes
      FROM patients p
      JOIN hospitals h ON p.hospital_id = h.id
      WHERE h.code = $1
    `;
    
    const params = [hospitalCode];
    let paramIndex = 2;
    
    if (status) {
      if (Array.isArray(status)) {
        query += ` AND p.status = ANY($${paramIndex})`;
        params.push(status);
      } else {
        query += ` AND p.status = $${paramIndex}`;
        params.push(status);
      }
      paramIndex++;
    } else {
      query += ` AND p.status IN ('pending', 'waiting', 'notified')`;
    }
    
    if (priority) {
      query += ` AND p.priority = $${paramIndex}`;
      params.push(priority);
      paramIndex++;
    }
    
    query += ` ORDER BY CASE p.priority WHEN 'P4' THEN 1 WHEN 'P5' THEN 2 ELSE 3 END ASC, p.created_at ASC LIMIT $${paramIndex}`;
    params.push(limit);
    
    const { rows } = await db.query(query, params);
    return rows;
  },
  
  /**
   * Compte les patients par statut pour un hôpital
   */
  async getStats(hospitalCode) {
    const { rows } = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status IN ('pending', 'waiting', 'notified')) as total_active,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'waiting') as waiting,
        COUNT(*) FILTER (WHERE status = 'notified') as notified,
        AVG(estimated_wait_minutes) FILTER (WHERE status IN ('waiting', 'notified')) as avg_estimated_wait
      FROM patients p
      JOIN hospitals h ON p.hospital_id = h.id
      WHERE h.code = $1
    `, [hospitalCode]);
    
    return rows[0];
  },
  
  /**
   * Escalade les patients en attente prolongée
   */
  async escalateOverdue() {
    const threshold = new Date(Date.now() - config.alerts.escalate);
    
    const { rows } = await db.query(`
      UPDATE patients SET
        is_escalated = true,
        escalated_at = CURRENT_TIMESTAMP,
        alert_type = 'overdue',
        alert_message = 'Attente prolongée dépassant 8 heures'
      WHERE status = 'waiting'
        AND is_escalated = false
        AND activated_at < $1
      RETURNING *
    `, [threshold]);
    
    if (rows.length > 0) {
      logger.logJob('escalation', 'completed', { escalatedCount: rows.length });
    }
    
    return rows;
  },
  
  /**
   * Legacy: patients à notifier (45 min avant) — conservé pour compatibilité
   */
  async getPatientsToNotify() {
    const threshold = config.alerts.notifyBefore;
    const { rows } = await db.query(`
      SELECT p.*, h.code as hospital_code, h.name as hospital_name
      FROM patients p
      JOIN hospitals h ON p.hospital_id = h.id
      WHERE p.status = 'waiting'
        AND p.phone IS NOT NULL
        AND p.notification_mode = 'sms'
        AND p.sms_30_sent = false
        AND p.estimated_wait_minutes IS NOT NULL
        AND (
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - p.activated_at)) * 1000
          + $1
        ) >= (p.estimated_wait_minutes * 60 * 1000)
    `, [threshold]);
    return rows;
  },

  /**
   * Patients à notifier 60 min avant (premier SMS)
   */
  async getPatientsFor60min() {
    const { rows } = await db.query(`
      SELECT p.*, h.code as hospital_code, h.name as hospital_name,
        COALESCE(h.settings->>'sms_delay_60', '60')::int as delay_60
      FROM patients p
      JOIN hospitals h ON p.hospital_id = h.id
      WHERE p.status = 'waiting'
        AND p.phone IS NOT NULL
        AND p.notification_mode = 'sms'
        AND p.sms_60_sent = false
        AND p.activated_at IS NOT NULL
        AND p.estimated_wait_minutes IS NOT NULL
        AND (
          p.estimated_wait_minutes * 60
          - EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - p.activated_at))
        ) BETWEEN 0 AND COALESCE((h.settings->>'sms_delay_60')::int, 60) * 60
    `);
    return rows;
  },

  /**
   * Patients à notifier 30 min avant (second SMS "Partez maintenant")
   */
  async getPatientsFor30min() {
    const { rows } = await db.query(`
      SELECT p.*, h.code as hospital_code, h.name as hospital_name,
        COALESCE(h.settings->>'sms_delay_30', '30')::int as delay_30
      FROM patients p
      JOIN hospitals h ON p.hospital_id = h.id
      WHERE p.status = 'waiting'
        AND p.phone IS NOT NULL
        AND p.notification_mode = 'sms'
        AND p.sms_30_sent = false
        AND p.activated_at IS NOT NULL
        AND p.estimated_wait_minutes IS NOT NULL
        AND (
          p.estimated_wait_minutes * 60
          - EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - p.activated_at))
        ) BETWEEN 0 AND COALESCE((h.settings->>'sms_delay_30')::int, 30) * 60
    `);
    return rows;
  },

  /**
   * Marque le patient comme ayant reçu le SMS 60min
   */
  async markSms60Sent(patientId) {
    const { rows } = await db.query(`
      UPDATE patients SET sms_60_sent = true, sms_60_sent_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *
    `, [patientId]);
    return rows[0];
  },

  /**
   * Patients notifiés dont la deadline de confirmation est dépassée ou proche
   */
  async getPendingConfirmations() {
    const { rows } = await db.query(`
      SELECT p.*, h.code as hospital_code, h.name as hospital_name,
        EXTRACT(EPOCH FROM (p.confirmation_deadline - CURRENT_TIMESTAMP)) as seconds_remaining
      FROM patients p
      JOIN hospitals h ON p.hospital_id = h.id
      WHERE p.status = 'notified'
        AND p.confirmation_deadline IS NOT NULL
    `);
    return rows;
  },

  /**
   * Marque un patient comme non confirmé
   */
  async markNonConfirme(patientId) {
    const { rows } = await db.query(`
      UPDATE patients SET
        status = 'non_confirme',
        non_confirme_at = CURRENT_TIMESTAMP,
        expires_at = CURRENT_TIMESTAMP + INTERVAL '24 hours'
      WHERE id = $1 AND status = 'notified'
      RETURNING *
    `, [patientId]);

    if (rows.length === 0) throw new Error('Patient non trouvé ou statut invalide');

    await db.query(`
      INSERT INTO daily_stats (hospital_id, date, total_noshow)
      VALUES ($1, CURRENT_DATE, 1)
      ON CONFLICT (hospital_id, date)
      DO UPDATE SET total_noshow = daily_stats.total_noshow + 1
    `, [rows[0].hospital_id]);

    return rows[0];
  },

  /**
   * Patients en mode appel qui ont besoin d'être appelés (60min ou 30min)
   */
  async getCallAlerts(hospitalCode) {
    const { rows } = await db.query(`
      SELECT p.*, h.code as hospital_code,
        (p.estimated_wait_minutes * 60 - EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - p.activated_at))) as remaining_seconds
      FROM patients p
      JOIN hospitals h ON p.hospital_id = h.id
      WHERE h.code = $1
        AND p.status = 'waiting'
        AND p.notification_mode = 'call'
        AND p.activated_at IS NOT NULL
        AND p.estimated_wait_minutes IS NOT NULL
        AND (
          p.estimated_wait_minutes * 60 - EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - p.activated_at))
        ) BETWEEN 0 AND 3600
      ORDER BY CASE p.priority WHEN 'P4' THEN 1 WHEN 'P5' THEN 2 END ASC, p.created_at ASC
    `, [hospitalCode]);
    return rows;
  },

  /**
   * Marque un patient en mode appel comme notifié par téléphone
   */
  async markCallNotified(patientId, slot) {
    const col = slot === 60 ? 'call_notified_60' : 'call_notified_30';
    const { rows } = await db.query(
      `UPDATE patients SET ${col} = true WHERE id = $1 RETURNING *`,
      [patientId]
    );
    return rows[0];
  },

  /**
   * Avance le prochain patient de la file (après non_confirme)
   * Envoie immédiatement le SMS 30min au suivant
   */
  async promoteNext(hospitalId) {
    const { rows } = await db.query(`
      SELECT p.*, h.code as hospital_code, h.name as hospital_name
      FROM patients p
      JOIN hospitals h ON p.hospital_id = h.id
      WHERE p.hospital_id = $1
        AND p.status = 'waiting'
        AND p.notification_mode = 'sms'
        AND p.sms_30_sent = false
      ORDER BY CASE p.priority WHEN 'P4' THEN 1 WHEN 'P5' THEN 2 END ASC, p.created_at ASC
      LIMIT 1
    `, [hospitalId]);
    return rows[0] || null;
  },
  
  /**
   * Nettoie les patients expirés
   */
  async cleanupExpired() {
    const { rows } = await db.query(`
      DELETE FROM patients
      WHERE expires_at < CURRENT_TIMESTAMP
      RETURNING id, status, hospital_id
    `);
    
    if (rows.length > 0) {
      logger.logJob('cleanup', 'completed', { deletedCount: rows.length });
    }
    
    return rows;
  }
};

module.exports = Patient;
