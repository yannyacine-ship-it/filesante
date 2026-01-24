/**
 * Routes API - Hôpitaux et File d'attente
 */

const express = require('express');
const router = express.Router();
const { param, query, validationResult } = require('express-validator');

const Patient = require('../models/Patient');
const db = require('../../config/database');
const config = require('../../config');
const logger = require('../utils/logger');

// Middleware de validation
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false, 
      errors: errors.array() 
    });
  }
  next();
};

/**
 * GET /api/hospitals
 * Liste tous les hôpitaux
 */
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, code, name, address, phone, is_active
      FROM hospitals
      WHERE is_active = true
      ORDER BY name
    `);
    
    res.json({
      success: true,
      data: rows
    });
    
  } catch (error) {
    logger.error('Erreur liste hôpitaux', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la récupération' 
    });
  }
});

/**
 * GET /api/hospitals/:code
 * Détails d'un hôpital
 */
router.get('/:code',
  [
    param('code').isIn(Object.keys(config.hospitals))
  ],
  validate,
  async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT * FROM hospitals WHERE code = $1
      `, [req.params.code]);
      
      if (rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Hôpital non trouvé' 
        });
      }
      
      res.json({
        success: true,
        data: rows[0]
      });
      
    } catch (error) {
      logger.error('Erreur détails hôpital', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors de la récupération' 
      });
    }
  }
);

/**
 * GET /api/hospitals/:code/queue
 * Liste la file d'attente d'un hôpital
 */
router.get('/:code/queue',
  [
    param('code').isIn(Object.keys(config.hospitals)),
    query('status').optional().isIn(['all', 'pending', 'waiting', 'notified']),
    query('priority').optional().isIn(['P4', 'P5']),
    query('limit').optional().isInt({ min: 1, max: 500 })
  ],
  validate,
  async (req, res) => {
    try {
      const { code } = req.params;
      const { status, priority, limit } = req.query;
      
      const options = {
        priority,
        limit: parseInt(limit) || 100
      };
      
      if (status && status !== 'all') {
        options.status = status;
      }
      
      const patients = await Patient.getQueue(code, options);
      
      // Formater pour le frontend
      const formattedPatients = patients.map(p => ({
        id: p.id,
        token: p.token,
        priority: p.priority,
        reason: p.reason,
        status: p.status,
        phone: p.phone ? `***-***-${p.phone.slice(-4)}` : null,
        estimatedWait: p.estimated_wait_minutes,
        position: p.position_in_queue,
        waitingMinutes: Math.round(p.waiting_minutes || 0),
        isEscalated: p.is_escalated,
        alertType: p.alert_type,
        createdAt: p.created_at,
        activatedAt: p.activated_at,
        notifiedAt: p.notified_at
      }));
      
      res.json({
        success: true,
        data: formattedPatients,
        meta: {
          total: patients.length,
          hospitalCode: code
        }
      });
      
    } catch (error) {
      logger.error('Erreur récupération file', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors de la récupération' 
      });
    }
  }
);

/**
 * GET /api/hospitals/:code/stats
 * Statistiques temps réel d'un hôpital
 */
router.get('/:code/stats',
  [
    param('code').isIn(Object.keys(config.hospitals))
  ],
  validate,
  async (req, res) => {
    try {
      const { code } = req.params;
      
      // Stats en temps réel
      const queueStats = await Patient.getStats(code);
      
      // Stats du jour
      const { rows: dailyStats } = await db.query(`
        SELECT ds.*
        FROM daily_stats ds
        JOIN hospitals h ON ds.hospital_id = h.id
        WHERE h.code = $1 AND ds.date = CURRENT_DATE
      `, [code]);
      
      const daily = dailyStats[0] || {
        total_registered: 0,
        total_activated: 0,
        total_notified: 0,
        total_returned: 0,
        total_noshow: 0,
        total_cancelled: 0,
        avg_wait_time_minutes: null
      };
      
      res.json({
        success: true,
        data: {
          realtime: {
            totalActive: parseInt(queueStats.total_active) || 0,
            pending: parseInt(queueStats.pending) || 0,
            waiting: parseInt(queueStats.waiting) || 0,
            notified: parseInt(queueStats.notified) || 0,
            avgEstimatedWait: Math.round(queueStats.avg_estimated_wait) || 0
          },
          daily: {
            registered: daily.total_registered,
            activated: daily.total_activated,
            notified: daily.total_notified,
            returned: daily.total_returned,
            noshow: daily.total_noshow,
            cancelled: daily.total_cancelled,
            avgWaitTime: daily.avg_wait_time_minutes ? Math.round(daily.avg_wait_time_minutes) : null,
            returnRate: daily.total_activated > 0 
              ? Math.round((daily.total_returned / daily.total_activated) * 100) 
              : null,
            noshowRate: daily.total_notified > 0 
              ? Math.round((daily.total_noshow / daily.total_notified) * 100) 
              : null
          }
        }
      });
      
    } catch (error) {
      logger.error('Erreur stats hôpital', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors de la récupération' 
      });
    }
  }
);

/**
 * GET /api/hospitals/:code/alerts
 * Patients avec alertes (escaladés)
 */
router.get('/:code/alerts',
  [
    param('code').isIn(Object.keys(config.hospitals))
  ],
  validate,
  async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT p.*, 
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(p.activated_at, p.created_at))) / 60 as waiting_minutes
        FROM patients p
        JOIN hospitals h ON p.hospital_id = h.id
        WHERE h.code = $1
          AND p.is_escalated = true
          AND p.status IN ('waiting', 'notified')
        ORDER BY p.escalated_at ASC
      `, [req.params.code]);
      
      res.json({
        success: true,
        data: rows.map(p => ({
          id: p.id,
          token: p.token,
          priority: p.priority,
          status: p.status,
          alertType: p.alert_type,
          alertMessage: p.alert_message,
          waitingMinutes: Math.round(p.waiting_minutes),
          escalatedAt: p.escalated_at
        }))
      });
      
    } catch (error) {
      logger.error('Erreur alertes hôpital', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors de la récupération' 
      });
    }
  }
);

/**
 * GET /api/hospitals/:code/history
 * Historique des stats journalières
 */
router.get('/:code/history',
  [
    param('code').isIn(Object.keys(config.hospitals)),
    query('days').optional().isInt({ min: 1, max: 365 })
  ],
  validate,
  async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      
      const { rows } = await db.query(`
        SELECT ds.date, ds.total_registered, ds.total_returned, ds.total_noshow,
               ds.avg_wait_time_minutes, ds.peak_hour, ds.peak_count
        FROM daily_stats ds
        JOIN hospitals h ON ds.hospital_id = h.id
        WHERE h.code = $1
          AND ds.date >= CURRENT_DATE - INTERVAL '${days} days'
        ORDER BY ds.date DESC
      `, [req.params.code]);
      
      res.json({
        success: true,
        data: rows
      });
      
    } catch (error) {
      logger.error('Erreur historique hôpital', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors de la récupération' 
      });
    }
  }
);

module.exports = router;
