/**
 * Route demo — seed de démonstration (Feature 9)
 * POST /api/demo/reset
 */

const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const logger = require('../utils/logger');

const DEMO_PATIENTS = [
  { name: 'Marie Tremblay',  priority: 'P4', reason: 'Douleur abdominale légère',   minutesAgo: 90 },
  { name: 'Jean Pelletier',  priority: 'P5', reason: 'Éruption cutanée bénigne',     minutesAgo: 75 },
  { name: 'Fatima Benali',   priority: 'P4', reason: 'Fièvre persistante modérée',   minutesAgo: 60 },
  { name: 'Roger Lavoie',    priority: 'P5', reason: 'Mal de dos chronique',          minutesAgo: 45 },
  { name: 'Sophie Gagnon',   priority: 'P4', reason: 'Contusion genou droit',         minutesAgo: 20 }
];

/**
 * POST /api/demo/reset
 * Supprime les patients demo existants et réinsère les 5 patients de démo
 */
router.post('/reset', async (req, res) => {
  try {
    // Récupérer l'hôpital HMR
    const { rows: hospitals } = await db.query(
      "SELECT id FROM hospitals WHERE code = 'HMR' LIMIT 1"
    );

    if (hospitals.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Hôpital HMR non trouvé — exécutez d\'abord les migrations et le seed'
      });
    }

    const hospitalId = hospitals[0].id;

    // Supprimer les patients demo précédents (token commençant par DEMO)
    await db.query("DELETE FROM patients WHERE token LIKE 'DEMO%'");

    const inserted = [];

    for (let i = 0; i < DEMO_PATIENTS.length; i++) {
      const p = DEMO_PATIENTS[i];
      const createdAt = new Date(Date.now() - p.minutesAgo * 60 * 1000);
      const token = `DEMO${String(i + 1).padStart(2, '0')}`;

      // Estimation: P4 = 180min base + 15min par position, P5 = 240min base
      const baseWait = p.priority === 'P4' ? 180 : 240;
      const estimatedWait = baseWait + i * 15;
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

      const { rows } = await db.query(`
        INSERT INTO patients (
          uuid, token, hospital_id, priority, reason,
          status, estimated_wait_minutes, position_in_queue,
          activated_at, expires_at, created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4,
          'waiting', $5, $6,
          $7, $8, $7
        )
        ON CONFLICT (token) DO UPDATE SET
          priority = EXCLUDED.priority,
          reason = EXCLUDED.reason,
          estimated_wait_minutes = EXCLUDED.estimated_wait_minutes,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id, token, priority, reason, estimated_wait_minutes, status
      `, [token, hospitalId, p.priority, p.reason, estimatedWait, i + 1, createdAt, expiresAt]);

      inserted.push({ name: p.name, ...rows[0] });
    }

    logger.info('Demo reset effectué', { count: inserted.length });

    res.json({
      success: true,
      message: `${inserted.length} patients de démo insérés dans HMR`,
      data: inserted
    });
  } catch (error) {
    const msg = error.message || error.code || String(error);
    logger.error('Erreur demo reset', { msg, code: error.code });
    if (!error.message && error.code === 'ETIMEDOUT') {
      return res.status(503).json({ success: false, error: 'Base de données non accessible (ETIMEDOUT). Définissez DATABASE_URL.' });
    }
    res.status(500).json({ success: false, error: msg });
  }
});

module.exports = router;
