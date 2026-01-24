/**
 * Service SMS - Intégration Twilio
 */

const config = require('../../config');
const db = require('../../config/database');
const logger = require('../utils/logger');

// Initialiser Twilio si configuré
let twilioClient = null;

if (config.twilio.accountSid && config.twilio.authToken) {
  const twilio = require('twilio');
  twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
  logger.info('Client Twilio initialisé');
} else {
  logger.warn('Twilio non configuré - SMS simulés en mode développement');
}

const SmsService = {
  /**
   * Envoie un SMS
   */
  async send(to, message, options = {}) {
    const { type = 'notification', patientId } = options;
    
    // Formater le numéro (ajouter +1 pour Canada si nécessaire)
    let formattedTo = to.replace(/\D/g, '');
    if (formattedTo.length === 10) {
      formattedTo = `+1${formattedTo}`;
    } else if (!formattedTo.startsWith('+')) {
      formattedTo = `+${formattedTo}`;
    }
    
    // Enregistrer dans la base
    const { rows: [smsRecord] } = await db.query(`
      INSERT INTO sms_notifications (patient_id, phone, message, type, status)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING *
    `, [patientId, formattedTo, message, type]);
    
    // Envoyer via Twilio ou simuler
    if (twilioClient) {
      try {
        const result = await twilioClient.messages.create({
          body: message,
          from: config.twilio.phoneNumber,
          to: formattedTo
        });
        
        // Mettre à jour le statut
        await db.query(`
          UPDATE sms_notifications SET
            status = 'sent',
            provider_id = $1,
            sent_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [result.sid, smsRecord.id]);
        
        logger.info('SMS envoyé', { to: formattedTo.slice(-4), sid: result.sid });
        
        return { success: true, sid: result.sid };
        
      } catch (error) {
        // Enregistrer l'erreur
        await db.query(`
          UPDATE sms_notifications SET
            status = 'failed',
            error_message = $1
          WHERE id = $2
        `, [error.message, smsRecord.id]);
        
        logger.error('Erreur envoi SMS', { error: error.message });
        
        return { success: false, error: error.message };
      }
    } else {
      // Mode développement - simuler l'envoi
      logger.info('SMS simulé (dev mode)', { to: formattedTo.slice(-4), message: message.substring(0, 50) });
      
      await db.query(`
        UPDATE sms_notifications SET
          status = 'sent',
          provider_id = 'dev-simulated',
          sent_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [smsRecord.id]);
      
      return { success: true, simulated: true };
    }
  },
  
  /**
   * Envoie la notification de confirmation d'inscription
   */
  async sendRegistrationConfirmation(patient) {
    const hospitalName = patient.hospital_name || 'l\'urgence';
    const message = `FileSanté: Inscription confirmée à ${hospitalName}. ` +
      `Position: #${patient.position_in_queue}. ` +
      `Temps estimé: ~${Math.round(patient.estimated_wait_minutes / 60)}h. ` +
      `Vous recevrez un SMS 45 min avant votre passage. ` +
      `Ne pas répondre à ce message.`;
    
    return this.send(patient.phone, message, {
      type: 'registration',
      patientId: patient.id
    });
  },
  
  /**
   * Envoie la notification 45 minutes avant
   */
  async sendNotification(patient) {
    const hospitalName = patient.hospital_name || 'l\'urgence';
    const message = `🔔 FileSanté: C'est bientôt votre tour! ` +
      `Dirigez-vous vers ${hospitalName} maintenant. ` +
      `Temps estimé avant passage: ~45 min. ` +
      `Présentez-vous à l'accueil en mentionnant FileSanté.`;
    
    return this.send(patient.phone, message, {
      type: 'notification',
      patientId: patient.id
    });
  },
  
  /**
   * Envoie un rappel si le patient n'est pas revenu
   */
  async sendReminder(patient) {
    const message = `FileSanté: Rappel - Vous êtes attendu à l'urgence. ` +
      `Si vous ne pouvez pas vous présenter, veuillez annuler votre inscription ` +
      `sur l'application.`;
    
    return this.send(patient.phone, message, {
      type: 'reminder',
      patientId: patient.id
    });
  },
  
  /**
   * Envoie une alerte (aggravation signalée)
   */
  async sendAlertToHospital(patient, alertType) {
    // En production: envoyer au numéro de l'urgence
    logger.logPatientAction('alert_sent', patient.id, patient.hospital_code, { alertType });
  },
  
  /**
   * Traite les webhooks Twilio (status updates)
   */
  async handleStatusCallback(data) {
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = data;
    
    if (!MessageSid) return;
    
    let status;
    switch (MessageStatus) {
      case 'delivered':
        status = 'delivered';
        break;
      case 'failed':
      case 'undelivered':
        status = 'failed';
        break;
      default:
        return; // Ignorer les autres statuts
    }
    
    await db.query(`
      UPDATE sms_notifications SET
        status = $1,
        delivered_at = CASE WHEN $1 = 'delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END,
        error_message = $2
      WHERE provider_id = $3
    `, [status, ErrorMessage || null, MessageSid]);
    
    logger.debug('SMS status update', { sid: MessageSid, status });
  }
};

module.exports = SmsService;
