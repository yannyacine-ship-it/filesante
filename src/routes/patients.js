/**
 * Routes API - Patients
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const QRCode = require('qrcode');

const Patient = require('../models/Patient');
const SmsService = require('../services/SmsService');
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
 * POST /api/patients
 * Crée un nouveau patient dans la file (utilisé par l'infirmière)
 */
router.post('/',
  [
    body('hospitalCode').isIn(Object.keys(config.hospitals)).withMessage('Code hôpital invalide'),
    body('priority').isIn(config.priorities).withMessage('Priorité invalide (P4 ou P5)'),
    body('reason').optional().isString().isLength({ max: 100 }),
    body('notificationMode').optional().isIn(['sms', 'call'])
  ],
  validate,
  async (req, res) => {
    try {
      const { hospitalCode, priority, reason, notificationMode = 'sms' } = req.body;
      const createdBy = req.user?.id || null;

      const patient = await Patient.create({
        hospitalCode,
        priority,
        reason,
        createdBy,
        notificationMode
      });
      
      // Générer l'URL pour le QR code
      const qrUrl = `${config.urls.frontend}/patient.html?token=${patient.token}&h=${hospitalCode}`;
      
      // Générer le QR code en base64
      const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
        width: 300,
        margin: 2,
        color: { dark: '#1e40af', light: '#ffffff' }
      });
      
      res.status(201).json({
        success: true,
        data: {
          id: patient.id,
          uuid: patient.uuid,
          token: patient.token,
          priority: patient.priority,
          estimatedWait: patient.estimated_wait_minutes,
          position: patient.position_in_queue,
          qrCode: qrCodeDataUrl,
          qrUrl
        }
      });
      
    } catch (error) {
      logger.error('Erreur création patient', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors de la création du patient' 
      });
    }
  }
);

/**
 * POST /api/patients/:token/activate
 * Active un patient après scan du QR (utilisé par le patient)
 */
router.post('/:token/activate',
  [
    param('token').isAlphanumeric().isLength({ min: 6, max: 20 }),
    body('phone').matches(/^[0-9]{10,15}$/).withMessage('Numéro de téléphone invalide')
  ],
  validate,
  async (req, res) => {
    try {
      const { token } = req.params;
      const { phone } = req.body;
      
      const patient = await Patient.activate(token, phone);
      
      // Envoyer SMS de confirmation
      await SmsService.sendRegistrationConfirmation(patient);
      
      res.json({
        success: true,
        data: {
          id: patient.id,
          status: patient.status,
          priority: patient.priority,
          estimatedWait: patient.estimated_wait_minutes,
          position: patient.position_in_queue,
          activatedAt: patient.activated_at
        }
      });
      
    } catch (error) {
      logger.error('Erreur activation patient', error);
      
      if (error.message.includes('non trouvé')) {
        return res.status(404).json({ 
          success: false, 
          error: 'Patient non trouvé ou déjà activé' 
        });
      }
      
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors de l\'activation' 
      });
    }
  }
);

/**
 * GET /api/patients/:token
 * Récupère les infos d'un patient par token (utilisé par le patient)
 */
router.get('/:token',
  [
    param('token').isAlphanumeric().isLength({ min: 6, max: 20 })
  ],
  validate,
  async (req, res) => {
    try {
      const patient = await Patient.getByToken(req.params.token);
      
      if (!patient) {
        return res.status(404).json({ 
          success: false, 
          error: 'Patient non trouvé' 
        });
      }
      
      // Calculer le temps en file
      let waitingMinutes = 0;
      if (patient.activated_at) {
        waitingMinutes = Math.round(
          (Date.now() - new Date(patient.activated_at).getTime()) / 60000
        );
      }
      
      res.json({
        success: true,
        data: {
          id: patient.id,
          token: patient.token,
          status: patient.status,
          priority: patient.priority,
          estimatedWait: patient.estimated_wait_minutes,
          position: patient.position_in_queue,
          waitingMinutes,
          hospital: {
            code: patient.hospital_code,
            name: patient.hospital_name,
            address: patient.hospital_address,
            phone: patient.hospital_phone
          },
          isEscalated: patient.is_escalated,
          createdAt: patient.created_at,
          activatedAt: patient.activated_at,
          notifiedAt: patient.notified_at
        }
      });
      
    } catch (error) {
      logger.error('Erreur récupération patient', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors de la récupération' 
      });
    }
  }
);

/**
 * POST /api/patients/:id/notify
 * Notifie un patient manuellement (utilisé par l'infirmière)
 */
router.post('/:id/notify',
  [
    param('id').isInt()
  ],
  validate,
  async (req, res) => {
    try {
      const patient = await Patient.getById(req.params.id);
      
      if (!patient) {
        return res.status(404).json({ 
          success: false, 
          error: 'Patient non trouvé' 
        });
      }
      
      // Envoyer SMS (phone override from body for testing)
      if (req.body && req.body.phone) patient.phone = req.body.phone;
      const smsResult = await SmsService.sendNotification(patient);
      
      if (smsResult.success) {
        // Mettre à jour le statut
        const updated = await Patient.notify(patient.id);
        
        res.json({
          success: true,
          data: {
            id: updated.id,
            status: updated.status,
            notifiedAt: updated.notified_at
          }
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: 'Erreur envoi SMS' 
        });
      }
      
    } catch (error) {
      logger.error('Erreur notification patient', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors de la notification' 
      });
    }
  }
);

/**
 * POST /api/patients/:id/return
 * Marque un patient comme revenu (utilisé par l'infirmière)
 */
router.post('/:id/return',
  [
    param('id').isInt()
  ],
  validate,
  async (req, res) => {
    try {
      const patient = await Patient.markReturned(req.params.id);
      
      res.json({
        success: true,
        data: {
          id: patient.id,
          status: patient.status,
          returnedAt: patient.returned_at
        }
      });
      
    } catch (error) {
      logger.error('Erreur retour patient', error);
      
      if (error.message.includes('non trouvé')) {
        return res.status(404).json({ 
          success: false, 
          error: 'Patient non trouvé ou statut invalide' 
        });
      }
      
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors du marquage' 
      });
    }
  }
);

/**
 * POST /api/patients/:id/noshow
 * Marque un patient comme no-show (utilisé par l'infirmière)
 */
router.post('/:id/noshow',
  [
    param('id').isInt()
  ],
  validate,
  async (req, res) => {
    try {
      const patient = await Patient.markNoShow(req.params.id);
      
      res.json({
        success: true,
        data: {
          id: patient.id,
          status: patient.status
        }
      });
      
    } catch (error) {
      logger.error('Erreur no-show patient', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors du marquage no-show' 
      });
    }
  }
);

/**
 * POST /api/patients/:id/cancel
 * Annule un patient (utilisé par patient ou infirmière)
 */
router.post('/:id/cancel',
  [
    param('id').isInt()
  ],
  validate,
  async (req, res) => {
    try {
      const patient = await Patient.cancel(req.params.id);
      
      res.json({
        success: true,
        data: {
          id: patient.id,
          status: patient.status
        }
      });
      
    } catch (error) {
      logger.error('Erreur annulation patient', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors de l\'annulation' 
      });
    }
  }
);

/**
 * POST /api/patients/:token/alert
 * Signale une aggravation (utilisé par le patient)
 */
router.post('/:token/alert',
  [
    param('token').isAlphanumeric().isLength({ min: 6, max: 20 }),
    body('alertType').isIn(['worsening', 'emergency', 'other']),
    body('message').optional().isString().isLength({ max: 500 })
  ],
  validate,
  async (req, res) => {
    try {
      const patient = await Patient.getByToken(req.params.token);
      
      if (!patient) {
        return res.status(404).json({ 
          success: false, 
          error: 'Patient non trouvé' 
        });
      }
      
      // Mettre à jour avec l'alerte
      await db.query(`
        UPDATE patients SET
          alert_type = $1,
          alert_message = $2,
          is_escalated = true,
          escalated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [req.body.alertType, req.body.message, patient.id]);
      
      // Notifier l'hôpital
      await SmsService.sendAlertToHospital(patient, req.body.alertType);
      
      logger.logPatientAction('alert_reported', patient.id, patient.hospital_code, {
        alertType: req.body.alertType
      });
      
      res.json({
        success: true,
        message: 'Alerte transmise à l\'équipe médicale'
      });
      
    } catch (error) {
      logger.error('Erreur alerte patient', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors de l\'envoi de l\'alerte' 
      });
    }
  }
);

/**
 * POST /api/patients/:id/confirm
 * Confirmation patient après SMS "Partez maintenant" (Feature 4)
 */
router.post('/:id/confirm',
  [param('id').isInt()],
  validate,
  async (req, res) => {
    try {
      const { rows } = await require('../../config/database').query(`
        UPDATE patients SET
          status = 'returned',
          returned_at = CURRENT_TIMESTAMP,
          expires_at = CURRENT_TIMESTAMP + INTERVAL '2 hours'
        WHERE id = $1 AND status = 'notified'
        RETURNING *
      `, [req.params.id]);

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Patient non trouvé ou statut invalide' });
      }

      res.json({ success: true, data: { id: rows[0].id, status: rows[0].status } });
    } catch (error) {
      logger.error('Erreur confirmation patient', error);
      res.status(500).json({ success: false, error: 'Erreur lors de la confirmation' });
    }
  }
);

/**
 * POST /api/patients/:id/call-notified
 * Marque un appel téléphonique comme effectué (Feature 6)
 */
router.post('/:id/call-notified',
  [
    param('id').isInt(),
    require('express-validator').body('slot').isIn([60, 30])
  ],
  validate,
  async (req, res) => {
    try {
      const patient = await Patient.markCallNotified(req.params.id, req.body.slot);
      res.json({ success: true, data: { id: patient.id } });
    } catch (error) {
      logger.error('Erreur call-notified', error);
      res.status(500).json({ success: false, error: 'Erreur lors du marquage' });
    }
  }
);

module.exports = router;
