/**
 * Routes Admin - Opérations d'administration
 * Permet d'exécuter des opérations de maintenance via HTTP
 */

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * POST /api/admin/seed
 * Exécute le script de seed pour initialiser la base de données
 * ⚠️ UTILISER SEULEMENT EN DÉMARRAGE OU RÉINITIALISATION
 */
router.post('/seed', async (req, res) => {
  try {
    logger.info('🌱 Démarrage du seed via API endpoint...');

    // Charger et exécuter le seed
    const seed = require('../../migrations/seed');
    await seed();

    logger.info('✅ Seed terminé avec succès via API endpoint');

    res.json({
      success: true,
      message: 'Base de données initialisée avec succès',
      data: {
        admin: 'admin@filesante.ca',
        nurses: 'nurse@hmr.filesante.ca, nurse@hnd.filesante.ca, nurse@hsc.filesante.ca, nurse@hgm.filesante.ca',
        hospitals: 'HMR, HND, HSC, HGM'
      }
    });

  } catch (error) {
    logger.error('❌ Erreur lors du seed via API:', error);

    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Échec de l\'initialisation de la base de données'
    });
  }
});

/**
 * POST /api/admin/migrate
 * Exécute les migrations manquantes sans supprimer les données
 */
router.post('/migrate', async (req, res) => {
  try {
    logger.info('🔄 Exécution des migrations via API...');
    const { runMigrations } = require('../../migrations/run');
    await runMigrations();
    res.json({ success: true, message: 'Migrations exécutées avec succès' });
  } catch (error) {
    logger.error('❌ Erreur migration:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/reset-database
 * ⚠️ DANGER: Réinitialise complètement la base de données
 * ⚠️ UTILISER AVEC PRUDENCE - Supprime TOUTES les données
 */
router.post('/reset-database', async (req, res) => {
  try {
    logger.warn('⚠️  Réinitialisation de la base de données demandée...');

    const db = require('../../config/database');

    // Supprimer toutes les tables (y compris migrations) séparément
    for (const table of ['patients', 'sms_notifications', 'activity_logs', 'daily_stats', 'users', 'hospitals', 'migrations']) {
      await db.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }

    logger.info('Tables supprimées, réexécution des migrations...');

    // Exécuter les migrations
    const { runMigrations } = require('../../migrations/run');
    await runMigrations();

    // Exécuter le seed
    const seed = require('../../migrations/seed');
    await seed();

    logger.info('✅ Base de données réinitialisée avec succès');

    res.json({
      success: true,
      message: 'Base de données réinitialisée complètement',
      warning: 'Toutes les données précédentes ont été supprimées'
    });

  } catch (error) {
    logger.error('❌ Erreur lors de la réinitialisation:', error);

    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Échec de la réinitialisation de la base de données'
    });
  }
});

/**
 * GET /api/admin/database-status
 * Vérifie l'état de la base de données
 */
router.get('/database-status', async (req, res) => {
  try {
    const db = require('../../config/database');

    // Vérifier les tables
    const { rows: tables } = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    // Vérifier les users
    const { rows: users } = await db.query('SELECT email, role, is_active FROM users;');

    // Vérifier les hôpitaux
    const { rows: hospitals } = await db.query('SELECT code, name, is_active FROM hospitals;');

    res.json({
      success: true,
      data: {
        tables: tables.map(t => t.table_name),
        users_count: users.length,
        users: users,
        hospitals_count: hospitals.length,
        hospitals: hospitals,
        is_initialized: users.length > 0 && hospitals.length > 0
      }
    });

  } catch (error) {
    logger.error('Erreur vérification statut base de données:', error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
