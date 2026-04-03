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
  cleanup: null,
  notifications: null,
  escalation: null,
  dailyReset: null,
  confirmationCheck: null
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
 * Job double SMS: 60 min puis 30 min avant passage
 */
async function runNotifications() {
  logger.logJob('notifications', 'started');

  try {
    // --- SMS 60 min: "Votre tour approche" ---
    const patients60 = await Patient.getPatientsFor60min();
    for (const patient of patients60) {
      try {
        const result = await SmsService.sendApproaching(patient);
        if (result.success) {
          await Patient.markSms60Sent(patient.id);
        }
      } catch (err) {
        logger.error('Erreur SMS 60min', { patientId: patient.id, error: err.message });
      }
    }

    // --- SMS 30 min: "Partez maintenant" ---
    const patients30 = await Patient.getPatientsFor30min();
    for (const patient of patients30) {
      try {
        const result = await SmsService.sendDepartNow(patient);
        if (result.success) {
          await Patient.notify(patient.id); // sets sms_30_sent + confirmation_deadline
        }
      } catch (err) {
        logger.error('Erreur SMS 30min', { patientId: patient.id, error: err.message });
      }
    }

    const total = patients60.length + patients30.length;
    if (total > 0) {
      logger.logJob('notifications', 'completed', {
        sms60Count: patients60.length,
        sms30Count: patients30.length
      });
    }
  } catch (error) {
    logger.logJob('notifications', 'error', { error: error.message });
  }
}

/**
 * Job de vérification des confirmations (30 min après "Partez maintenant")
 * - À 15 min restantes: rappel SMS
 * - À 0 min: status = non_confirme, prochain patient avancé
 */
async function runConfirmationCheck() {
  try {
    const pending = await Patient.getPendingConfirmations();

    for (const patient of pending) {
      const secsRemaining = parseFloat(patient.seconds_remaining);

      // Rappel à 15 min restantes
      if (secsRemaining <= 15 * 60 && secsRemaining > 0 && !patient.confirmation_reminder_sent && patient.phone) {
        try {
          await SmsService.sendConfirmationReminder(patient);
          await db.query(
            'UPDATE patients SET confirmation_reminder_sent = true WHERE id = $1',
            [patient.id]
          );
          logger.info('Rappel confirmation envoyé', { patientId: patient.id });
        } catch (err) {
          logger.error('Erreur rappel confirmation', { patientId: patient.id, error: err.message });
        }
      }

      // Deadline dépassée → non_confirme
      if (secsRemaining <= 0) {
        try {
          const marked = await Patient.markNonConfirme(patient.id);
          logger.info('Patient marqué non_confirme', { patientId: patient.id });

          // Promouvoir le prochain patient en file
          const next = await Patient.promoteNext(marked.hospital_id);
          if (next) {
            const result = await SmsService.sendDepartNow(next);
            if (result.success) {
              await Patient.notify(next.id);
              logger.info('Prochain patient promu', { patientId: next.id });
            }
          }
        } catch (err) {
          logger.error('Erreur marquage non_confirme', { patientId: patient.id, error: err.message });
        }
      }
    }
  } catch (error) {
    logger.error('Erreur job confirmation check', { error: error.message });
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

  // Vérification confirmations toutes les 2 minutes
  jobs.confirmationCheck = cron.schedule('*/2 * * * *', runConfirmationCheck, {
    scheduled: true,
    timezone: 'America/Montreal'
  });
  logger.info('Job confirmationCheck planifié: */2 * * * *');
  
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
    case 'confirmationCheck':
      return runConfirmationCheck();
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
