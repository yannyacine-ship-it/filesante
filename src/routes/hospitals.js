/**
 * Routes API - Hôpitaux et File d'attente
 */

const express = require('express');
const router = express.Router();
const { param, body, query, validationResult } = require('express-validator');

const Patient = require('../models/Patient');
const SmsService = require('../services/SmsService');
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

/**
 * POST /api/hospitals/:code/surge
 * Bouton urgence entrante — ajoute N minutes à tous les patients en attente (Feature 5)
 */
router.post('/:code/surge',
  [
    param('code').isIn(Object.keys(config.hospitals)),
    body('minutes').isInt({ min: 1, max: 120 })
  ],
  validate,
  async (req, res) => {
    try {
      const { code } = req.params;
      const { minutes } = req.body;

      // Récupérer tous les patients en attente
      const { rows: affected } = await db.query(`
        UPDATE patients SET
          estimated_wait_minutes = estimated_wait_minutes + $1,
          surge_added_minutes = COALESCE(surge_added_minutes, 0) + $1
        FROM hospitals h
        WHERE patients.hospital_id = h.id
          AND h.code = $2
          AND patients.status IN ('waiting', 'notified')
        RETURNING patients.*, h.name as hospital_name
      `, [minutes, code]);

      // Envoyer SMS à tous les patients SMS avec un téléphone
      let smsSent = 0;
      for (const patient of affected) {
        if (patient.phone && patient.notification_mode !== 'call') {
          try {
            await SmsService.sendSurgeAdjustment(patient);
            smsSent++;
          } catch (err) {
            logger.error('Erreur SMS surge', { patientId: patient.id });
          }
        }
      }

      logger.info('Surge appliqué', { hospitalCode: code, minutes, affected: affected.length, smsSent });

      res.json({
        success: true,
        data: { minutes, affectedCount: affected.length, smsSent }
      });
    } catch (error) {
      logger.error('Erreur surge', error);
      res.status(500).json({ success: false, error: 'Erreur lors de l\'application du surge' });
    }
  }
);

/**
 * GET /api/hospitals/:code/call-alerts
 * Patients en mode appel qui ont besoin d'être appelés (Feature 6)
 */
router.get('/:code/call-alerts',
  [param('code').isIn(Object.keys(config.hospitals))],
  validate,
  async (req, res) => {
    try {
      const patients = await Patient.getCallAlerts(req.params.code);
      res.json({
        success: true,
        data: patients.map(p => ({
          id: p.id,
          token: p.token,
          phone: p.phone ? `***-***-${p.phone.slice(-4)}` : null,
          phoneRaw: p.phone,
          priority: p.priority,
          status: p.status,
          remainingMinutes: Math.round((p.remaining_seconds || 0) / 60),
          callNotified60: p.call_notified_60,
          callNotified30: p.call_notified_30
        }))
      });
    } catch (error) {
      logger.error('Erreur call-alerts', error);
      res.status(500).json({ success: false, error: 'Erreur lors de la récupération' });
    }
  }
);

/**
 * GET /api/hospitals/all/admin-stats
 * Vue admin — tous hôpitaux (Feature 7)
 */
router.get('/all/admin-stats', async (req, res) => {
  try {
    // Check which optional columns exist to build a safe query
    const { rows: cols } = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'patients'
        AND column_name IN ('manually_notified')
    `);
    const hasManuallyNotified = cols.some(c => c.column_name === 'manually_notified');

    const manuallyNotifiedExpr = hasManuallyNotified
      ? `COUNT(p.id) FILTER (WHERE p.manually_notified = true AND p.created_at >= CURRENT_DATE)`
      : `0`;

    const { rows } = await db.query(`
      SELECT
        h.code, h.name, h.is_active,
        COUNT(p.id) FILTER (WHERE p.status IN ('waiting','notified')) AS queue_count,
        COUNT(p.id) FILTER (WHERE p.status = 'notified') AS notified_count,
        COUNT(p.id) FILTER (WHERE p.status = 'non_confirme' AND p.created_at >= CURRENT_DATE) AS non_confirme_today,
        COUNT(p.id) FILTER (WHERE p.status = 'noshow' AND p.created_at >= CURRENT_DATE) AS noshow_today,
        COUNT(p.id) FILTER (WHERE p.status = 'returned' AND p.created_at >= CURRENT_DATE) AS returned_today,
        ${manuallyNotifiedExpr} AS manually_notified_today,
        ROUND(AVG(p.estimated_wait_minutes) FILTER (WHERE p.status IN ('waiting','notified'))) AS avg_wait
      FROM hospitals h
      LEFT JOIN patients p ON p.hospital_id = h.id
      GROUP BY h.id, h.code, h.name, h.is_active
      ORDER BY h.name
    `);

    // Civières stats (active + today metrics)
    let civiereRows = [];
    try {
      const { rows: cr } = await db.query(`
        SELECT
          h.code,
          COUNT(c.id) FILTER (WHERE c.status != 'liberee') as active_civieres,
          COUNT(c.id) FILTER (WHERE c.created_at >= CURRENT_DATE) as total_today,
          ROUND(AVG(EXTRACT(EPOCH FROM (c.liberated_at - c.created_at))/60)
            FILTER (WHERE c.liberated_at IS NOT NULL AND c.created_at >= CURRENT_DATE)) as avg_occupation_min,
          ROUND(AVG(EXTRACT(EPOCH FROM (c.liberated_at - c.results_flagged_at))/60)
            FILTER (WHERE c.liberated_at IS NOT NULL AND c.results_flagged_at IS NOT NULL AND c.created_at >= CURRENT_DATE)) as avg_results_liberation_min
        FROM hospitals h
        LEFT JOIN civieres c ON c.hospital_id = h.id
        GROUP BY h.code
      `);
      civiereRows = cr;
    } catch (_) { /* table may not exist yet */ }

    const civiereMap = {};
    civiereRows.forEach(r => { civiereMap[r.code] = r; });

    // Patients par heure (last 12h)
    const { rows: hourly } = await db.query(`
      SELECT
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as count
      FROM patients
      WHERE created_at >= NOW() - INTERVAL '12 hours'
      GROUP BY DATE_TRUNC('hour', created_at)
      ORDER BY hour
    `);

    // Trend data: compare last 30 min vs previous 30 min for each KPI
    const { rows: trendRows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 minutes') AS queue_recent,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '60 minutes'
                           AND created_at  <  NOW() - INTERVAL '30 minutes') AS queue_prev,
        COUNT(*) FILTER (WHERE status = 'returned'
                           AND returned_at >= NOW() - INTERVAL '30 minutes') AS returned_recent,
        COUNT(*) FILTER (WHERE status = 'returned'
                           AND returned_at >= NOW() - INTERVAL '60 minutes'
                           AND returned_at  <  NOW() - INTERVAL '30 minutes') AS returned_prev,
        COUNT(*) FILTER (WHERE status IN ('noshow','non_confirme')
                           AND updated_at >= NOW() - INTERVAL '30 minutes') AS lwbs_recent,
        COUNT(*) FILTER (WHERE status IN ('noshow','non_confirme')
                           AND updated_at >= NOW() - INTERVAL '60 minutes'
                           AND updated_at  <  NOW() - INTERVAL '30 minutes') AS lwbs_prev,
        ROUND(AVG(estimated_wait_minutes) FILTER (WHERE status IN ('waiting','notified'))) AS avg_wait_now
      FROM patients
      WHERE created_at >= CURRENT_DATE
    `);
    const trend = trendRows[0] || {};

    // Helper: compute trend direction (+1 = improving, -1 = degrading, 0 = stable)
    const dir = (recent, prev, higherIsBetter) => {
      const r = parseInt(recent) || 0;
      const p = parseInt(prev)   || 0;
      if (r === p) return 0;
      return (r > p) === higherIsBetter ? 1 : -1;
    };

    const trends = {
      // More patients queued recently = more demand (neutral/slight negative)
      queue:    dir(trend.queue_recent,   trend.queue_prev,   false),
      // More returned recently = good
      returned: dir(trend.returned_recent, trend.returned_prev, true),
      // More LWBS recently = bad
      lwbs:     dir(trend.lwbs_recent,    trend.lwbs_prev,    false),
      // Lower avg wait = good (compare current state)
      avgWait:  0  // computed from snapshot, tracked client-side
    };

    res.json({
      success: true,
      data: {
        hospitals: rows.map(h => {
          const cv = civiereMap[h.code] || {};
          const noshow    = parseInt(h.noshow_today)      || 0;
          const nonConf   = parseInt(h.non_confirme_today) || 0;
          return {
            code: h.code,
            name: h.name,
            isActive: h.is_active,
            queueCount: parseInt(h.queue_count)       || 0,
            notifiedCount: parseInt(h.notified_count) || 0,
            lwbs: noshow + nonConf,
            returnedToday: parseInt(h.returned_today) || 0,
            manuallyNotifiedToday: parseInt(h.manually_notified_today) || 0,
            avgWaitMinutes: parseInt(h.avg_wait)      || 0,
            activeCivieres: parseInt(cv.active_civieres) || 0,
            civieresToday: parseInt(cv.total_today)   || 0,
            avgCiviereOccupationMin: parseInt(cv.avg_occupation_min)         || null,
            avgResultsLiberationMin: parseInt(cv.avg_results_liberation_min) || null
          };
        }),
        hourlyPatients: hourly.map(r => ({
          hour: r.hour,
          count: parseInt(r.count)
        })),
        trends,
        globalAvgWait: parseInt(trend.avg_wait_now) || 0
      }
    });
  } catch (error) {
    logger.error('Erreur admin stats', error);
    res.status(500).json({ success: false, error: 'Erreur lors de la récupération' });
  }
});

/**
 * GET /api/hospitals/:code/civieres
 * Liste des civières actives d'un hôpital
 */
router.get('/:code/civieres',
  [param('code').isIn(Object.keys(config.hospitals))],
  validate,
  async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT c.*
        FROM civieres c
        JOIN hospitals h ON c.hospital_id = h.id
        WHERE h.code = $1 AND c.status != 'liberee'
        ORDER BY c.created_at ASC
      `, [req.params.code]);
      res.json({ success: true, data: rows });
    } catch (error) {
      logger.error('Erreur civieres', error);
      res.status(500).json({ success: false, error: 'Erreur récupération civières' });
    }
  }
);

/**
 * POST /api/hospitals/:code/civieres
 * Ajouter une civière
 */
router.post('/:code/civieres',
  [
    param('code').isIn(Object.keys(config.hospitals)),
    body('patientName').notEmpty().trim(),
    body('numero').isInt({ min: 1, max: 20 }),
    body('reason').optional().isString()
  ],
  validate,
  async (req, res) => {
    try {
      const { code } = req.params;
      const { patientName, numero, reason } = req.body;
      const { rows: hospitals } = await db.query('SELECT id FROM hospitals WHERE code = $1', [code]);
      if (!hospitals.length) return res.status(404).json({ success: false, error: 'Hôpital non trouvé' });

      const { rows } = await db.query(`
        INSERT INTO civieres (hospital_id, patient_name, numero, reason)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [hospitals[0].id, patientName, numero, reason]);

      res.json({ success: true, data: rows[0] });
    } catch (error) {
      logger.error('Erreur création civière', error);
      res.status(500).json({ success: false, error: 'Erreur création civière' });
    }
  }
);

/**
 * PUT /api/hospitals/:code/civieres/:id
 * Mettre à jour le statut d'une civière
 */
router.put('/:code/civieres/:id',
  [
    param('code').isIn(Object.keys(config.hospitals)),
    param('id').isInt(),
    body('status').isIn(['en_attente_resultats','resultats_signales','decision_en_cours','liberee'])
  ],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      let extraFields = '';
      if (status === 'resultats_signales') extraFields = ', results_flagged_at = CURRENT_TIMESTAMP';
      else if (status === 'decision_en_cours') extraFields = ', decision_at = CURRENT_TIMESTAMP';
      else if (status === 'liberee') extraFields = ', liberated_at = CURRENT_TIMESTAMP';

      const { rows } = await db.query(`
        UPDATE civieres SET status = $1${extraFields} WHERE id = $2 RETURNING *
      `, [status, id]);

      if (!rows.length) return res.status(404).json({ success: false, error: 'Civière non trouvée' });
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      logger.error('Erreur mise à jour civière', error);
      res.status(500).json({ success: false, error: 'Erreur mise à jour civière' });
    }
  }
);

module.exports = router;
