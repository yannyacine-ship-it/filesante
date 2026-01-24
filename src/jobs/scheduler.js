/**
 * Jobs planifiés - Maintenance et notifications automatiques
 */

const cron = require('node-cron');
const config = require('../../config');
const Patient = require('../models/Patient');
const SmsService = require('../services/SmsService');
const db = require('../../config/database');
const logger = require('../utils/logger');

const jobs = {
  /**
   * Nettoyage des patients expirés
   * Exécuté toutes les 15 minutes
   */
  cleanup: null,
  
  /**
   * Envoi des notifications 45 min avant
   * Exécuté toutes les 5 minutes
   */
  notifications: null,
  
  /**
   * Escalade des patients en attente prolongée
   * Exécuté toutes les 30 minutes
   */
  escalation: null,
  
  /**
   * Reset des stats journalières
   * Exécuté à 6h00 AM
   */
  dailyReset: null
};

/**
 * Job de nettoyage des données expirées
 */
async function runCleanup() {
  logger.logJob('cleanup', 'started');
  
  try {
    const deleted = await Patient.cleanupExpired();
    
    if (deleted.length > 0) {
      logger.logJob('cleanup', 'completed', { 
        deletedCount: deleted.length,
        statuses: deleted.reduce((acc, p) => {
          acc[p.status] = (acc[p.status] || 0) + 1;
          return acc;
        }, {})
      });
    }
  } catch (error) {
    logger.logJob('cleanup', 'error', { error: error.message });
  }
}

/**
 * Job d'envoi des notifications
 */
async function runNotifications() {
  logger.logJob('notifications', 'started');
  
  try {
    const patientsToNotify = await Patient.getPatientsToNotify();
    
    for (const patient of patientsToNotify) {
      try {
        // Envoyer le SMS
        const result = await SmsService.sendNotification(patient);
        
        if (result.success) {
          // Mettre à jour le statut du patient
          await Patient.notify(patient.id);
        }
      } catch (error) {
        logger.error('Erreur notification patient', { 
          patientId: patient.id, 
          error: error.message 
        });
      }
    }
    
    if (patientsToNotify.length > 0) {
      logger.logJob('notifications', 'completed', { 
        notifiedCount: patientsToNotify.length 
      });
    }
  } catch (error) {
    logger.logJob('notifications', 'error', { error: error.message });
  }
}

/**
 * Job d'escalade des patients en attente prolongée
 */
async function runEscalation() {
  logger.logJob('escalation', 'started');
  
  try {
    const escalated = await Patient.escalateOverdue();
    
    // Envoyer des alertes pour chaque patient escaladé
    for (const patient of escalated) {
      await SmsService.sendAlertToHospital(patient, 'overdue');
    }
    
    if (escalated.length > 0) {
      logger.logJob('escalation', 'completed', { 
        escalatedCount: escalated.length 
      });
    }
  } catch (error) {
    logger.logJob('escalation', 'error', { error: error.message });
  }
}

/**
 * Job de reset quotidien des statistiques
 */
async function runDailyReset() {
  logger.logJob('daily_reset', 'started');
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Créer les entrées de stats pour aujourd'hui pour chaque hôpital
    const { rows: hospitals } = await db.query('SELECT id, code FROM hospitals WHERE is_active = true');
    
    for (const hospital of hospitals) {
      await db.query(`
        INSERT INTO daily_stats (hospital_id, date)
        VALUES ($1, $2)
        ON CONFLICT (hospital_id, date) DO NOTHING
      `, [hospital.id, today]);
    }
    
    // Archiver les anciennes stats (> 90 jours)
    const archiveDate = new Date();
    archiveDate.setDate(archiveDate.getDate() - 90);
    
    const { rowCount } = await db.query(`
      DELETE FROM daily_stats WHERE date < $1
    `, [archiveDate.toISOString().split('T')[0]]);
    
    logger.logJob('daily_reset', 'completed', { 
      hospitalCount: hospitals.length,
      archivedStats: rowCount 
    });
  } catch (error) {
    logger.logJob('daily_reset', 'error', { error: error.message });
  }
}

/**
 * Démarre tous les jobs planifiés
 */
function startJobs() {
  logger.info('Démarrage des jobs planifiés...');
  
  // Cleanup toutes les 15 minutes
  jobs.cleanup = cron.schedule(config.cron.cleanup, runCleanup, {
    scheduled: true,
    timezone: 'America/Montreal'
  });
  logger.info(`Job cleanup planifié: ${config.cron.cleanup}`);
  
  // Notifications toutes les 5 minutes
  jobs.notifications = cron.schedule('*/5 * * * *', runNotifications, {
    scheduled: true,
    timezone: 'America/Montreal'
  });
  logger.info('Job notifications planifié: */5 * * * *');
  
  // Escalation toutes les 30 minutes
  jobs.escalation = cron.schedule(config.cron.escalation, runEscalation, {
    scheduled: true,
    timezone: 'America/Montreal'
  });
  logger.info(`Job escalation planifié: ${config.cron.escalation}`);
  
  // Daily reset à 6h AM
  jobs.dailyReset = cron.schedule(config.cron.dailyReset, runDailyReset, {
    scheduled: true,
    timezone: 'America/Montreal'
  });
  logger.info(`Job daily_reset planifié: ${config.cron.dailyReset}`);
  
  // Exécuter immédiatement le daily reset si nécessaire
  runDailyReset();
  
  logger.info('Tous les jobs planifiés sont actifs');
}

/**
 * Arrête tous les jobs
 */
function stopJobs() {
  Object.values(jobs).forEach(job => {
    if (job) job.stop();
  });
  logger.info('Jobs planifiés arrêtés');
}

/**
 * Exécute un job manuellement
 */
async function runManually(jobName) {
  switch (jobName) {
    case 'cleanup':
      return runCleanup();
    case 'notifications':
      return runNotifications();
    case 'escalation':
      return runEscalation();
    case 'dailyReset':
      return runDailyReset();
    default:
      throw new Error(`Job inconnu: ${jobName}`);
  }
}

module.exports = {
  startJobs,
  stopJobs,
  runManually,
  jobs
};
