/**
 * Routes API - Authentification
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

const User = require('../models/User');
const { authenticate, authorize, auditLog } = require('../middleware/auth');
const config = require('../../config');
const logger = require('../utils/logger');

// Validation middleware
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
 * POST /api/auth/login
 * Authentification utilisateur
 */
router.post('/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
    body('password').isLength({ min: 6 }).withMessage('Mot de passe requis (min 6 caractères)')
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      
      const result = await User.authenticate(email, password);
      
      // Définir le cookie de refresh token (httpOnly)
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: config.env === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 jours
      });
      
      res.json({
        success: true,
        data: {
          token: result.token,
          user: result.user
        }
      });
      
    } catch (error) {
      logger.warn('Échec connexion', { email: req.body.email, error: error.message });
      
      res.status(401).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /api/auth/register
 * Inscription d'un nouvel utilisateur (admin seulement)
 */
router.post('/register',
  authenticate,
  authorize('admin', 'superadmin'),
  auditLog('user_created'),
  [
    body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
    body('password').isLength({ min: 8 }).withMessage('Mot de passe min 8 caractères')
      .matches(/[A-Z]/).withMessage('Doit contenir une majuscule')
      .matches(/[0-9]/).withMessage('Doit contenir un chiffre'),
    body('firstName').trim().isLength({ min: 2 }).withMessage('Prénom requis'),
    body('lastName').trim().isLength({ min: 2 }).withMessage('Nom requis'),
    body('role').isIn(['nurse', 'admin']).withMessage('Rôle invalide'),
    body('hospitalCode').optional().isIn(Object.keys(config.hospitals))
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password, firstName, lastName, role, hospitalCode } = req.body;
      
      // Un admin ne peut créer que des nurses pour son hôpital
      if (req.user.role === 'admin') {
        if (role !== 'nurse') {
          return res.status(403).json({
            success: false,
            error: 'Vous ne pouvez créer que des comptes infirmier'
          });
        }
        if (hospitalCode && hospitalCode !== req.user.hospitalCode) {
          return res.status(403).json({
            success: false,
            error: 'Vous ne pouvez créer des comptes que pour votre hôpital'
          });
        }
      }
      
      const user = await User.create({
        email,
        password,
        firstName,
        lastName,
        role,
        hospitalCode: hospitalCode || req.user.hospitalCode
      });
      
      res.status(201).json({
        success: true,
        data: {
          id: user.id,
          uuid: user.uuid,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role
        }
      });
      
    } catch (error) {
      logger.error('Erreur création utilisateur', error);
      
      if (error.message.includes('déjà utilisé')) {
        return res.status(409).json({
          success: false,
          error: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la création du compte'
      });
    }
  }
);

/**
 * POST /api/auth/refresh
 * Rafraîchir le token JWT
 */
router.post('/refresh', async (req, res) => {
  try {
    // Récupérer le refresh token du cookie ou du body
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Token de rafraîchissement manquant'
      });
    }
    
    const result = await User.refreshToken(refreshToken);
    
    res.json({
      success: true,
      data: {
        token: result.token
      }
    });
    
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Impossible de rafraîchir le token'
    });
  }
});

/**
 * POST /api/auth/logout
 * Déconnexion (efface le cookie)
 */
router.post('/logout', (req, res) => {
  res.clearCookie('refreshToken');
  
  res.json({
    success: true,
    message: 'Déconnexion réussie'
  });
});

/**
 * GET /api/auth/me
 * Récupère les infos de l'utilisateur connecté
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.getById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }
    
    res.json({
      success: true,
      data: {
        id: user.id,
        uuid: user.uuid,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        hospital: user.hospital_code ? {
          code: user.hospital_code,
          name: user.hospital_name
        } : null,
        lastLogin: user.last_login,
        createdAt: user.created_at
      }
    });
    
  } catch (error) {
    logger.error('Erreur récupération profil', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur'
    });
  }
});

/**
 * PUT /api/auth/password
 * Change le mot de passe de l'utilisateur connecté
 */
router.put('/password',
  authenticate,
  auditLog('password_changed'),
  [
    body('currentPassword').notEmpty().withMessage('Mot de passe actuel requis'),
    body('newPassword').isLength({ min: 8 }).withMessage('Nouveau mot de passe min 8 caractères')
      .matches(/[A-Z]/).withMessage('Doit contenir une majuscule')
      .matches(/[0-9]/).withMessage('Doit contenir un chiffre')
  ],
  validate,
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      
      await User.changePassword(req.user.id, currentPassword, newPassword);
      
      res.json({
        success: true,
        message: 'Mot de passe modifié avec succès'
      });
      
    } catch (error) {
      if (error.message.includes('incorrect')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Erreur lors du changement de mot de passe'
      });
    }
  }
);

/**
 * GET /api/auth/users
 * Liste les utilisateurs (admin seulement)
 */
router.get('/users',
  authenticate,
  authorize('admin', 'superadmin'),
  async (req, res) => {
    try {
      const { hospitalCode, role, limit, offset } = req.query;
      
      // Admin ne peut voir que les users de son hôpital
      const filterHospital = req.user.role === 'admin' 
        ? req.user.hospitalCode 
        : hospitalCode;
      
      const users = await User.list({
        hospitalCode: filterHospital,
        role,
        limit: parseInt(limit) || 100,
        offset: parseInt(offset) || 0
      });
      
      res.json({
        success: true,
        data: users.map(u => ({
          id: u.id,
          uuid: u.uuid,
          email: u.email,
          firstName: u.first_name,
          lastName: u.last_name,
          role: u.role,
          hospital: u.hospital_code ? {
            code: u.hospital_code,
            name: u.hospital_name
          } : null,
          isActive: u.is_active,
          lastLogin: u.last_login,
          createdAt: u.created_at
        }))
      });
      
    } catch (error) {
      logger.error('Erreur liste utilisateurs', error);
      res.status(500).json({
        success: false,
        error: 'Erreur serveur'
      });
    }
  }
);

/**
 * PUT /api/auth/users/:id
 * Met à jour un utilisateur (admin seulement)
 */
router.put('/users/:id',
  authenticate,
  authorize('admin', 'superadmin'),
  auditLog('user_updated'),
  [
    body('firstName').optional().trim().isLength({ min: 2 }),
    body('lastName').optional().trim().isLength({ min: 2 }),
    body('isActive').optional().isBoolean()
  ],
  validate,
  async (req, res) => {
    try {
      const user = await User.update(req.params.id, req.body);
      
      res.json({
        success: true,
        data: user
      });
      
    } catch (error) {
      logger.error('Erreur mise à jour utilisateur', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la mise à jour'
      });
    }
  }
);

/**
 * DELETE /api/auth/users/:id
 * Désactive un utilisateur (admin seulement)
 */
router.delete('/users/:id',
  authenticate,
  authorize('admin', 'superadmin'),
  auditLog('user_deactivated'),
  async (req, res) => {
    try {
      // Empêcher de se désactiver soi-même
      if (req.params.id == req.user.id) {
        return res.status(400).json({
          success: false,
          error: 'Vous ne pouvez pas désactiver votre propre compte'
        });
      }
      
      const user = await User.deactivate(req.params.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'Utilisateur non trouvé'
        });
      }
      
      res.json({
        success: true,
        message: 'Utilisateur désactivé'
      });
      
    } catch (error) {
      logger.error('Erreur désactivation utilisateur', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la désactivation'
      });
    }
  }
);

module.exports = router;
