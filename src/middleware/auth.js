/**
 * Middleware d'authentification et d'autorisation
 */

const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Middleware d'authentification JWT
 * Vérifie le token et ajoute req.user
 */
const authenticate = async (req, res, next) => {
  try {
    // Récupérer le token du header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Token d\'authentification manquant'
      });
    }
    
    const token = authHeader.substring(7); // Enlever "Bearer "
    
    // Vérifier le token
    const decoded = User.verifyToken(token);
    
    // Récupérer l'utilisateur complet
    const user = await User.getById(decoded.userId);
    
    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Utilisateur non trouvé ou désactivé'
      });
    }
    
    // Ajouter l'utilisateur à la requête
    req.user = {
      id: user.id,
      uuid: user.uuid,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      hospitalId: user.hospital_id,
      hospitalCode: user.hospital_code
    };
    
    next();
    
  } catch (error) {
    logger.debug('Erreur authentification', { error: error.message });
    
    if (error.message === 'Token expiré') {
      return res.status(401).json({
        success: false,
        error: 'Token expiré',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    return res.status(401).json({
      success: false,
      error: 'Token invalide'
    });
  }
};

/**
 * Middleware d'authentification optionnel
 * Ajoute req.user si token présent, mais ne bloque pas
 */
const authenticateOptional = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = User.verifyToken(token);
      const user = await User.getById(decoded.userId);
      
      if (user && user.is_active) {
        req.user = {
          id: user.id,
          uuid: user.uuid,
          email: user.email,
          role: user.role,
          hospitalId: user.hospital_id,
          hospitalCode: user.hospital_code
        };
      }
    }
  } catch (error) {
    // Ignorer les erreurs d'auth en mode optionnel
  }
  
  next();
};

/**
 * Middleware d'autorisation par rôle
 * @param {...string} allowedRoles - Rôles autorisés
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentification requise'
      });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('Accès non autorisé', {
        userId: req.user.id,
        role: req.user.role,
        requiredRoles: allowedRoles,
        path: req.path
      });
      
      return res.status(403).json({
        success: false,
        error: 'Accès non autorisé pour ce rôle'
      });
    }
    
    next();
  };
};

/**
 * Middleware de vérification d'accès à un hôpital
 * L'utilisateur doit appartenir à l'hôpital demandé (sauf superadmin)
 */
const authorizeHospital = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentification requise'
    });
  }
  
  // Superadmin a accès à tous les hôpitaux
  if (req.user.role === 'superadmin') {
    return next();
  }
  
  // Récupérer le code hôpital de la requête
  const hospitalCode = req.params.code || req.params.hospitalCode || req.body.hospitalCode;
  
  if (!hospitalCode) {
    return next(); // Pas de vérification si pas de code hôpital
  }
  
  // Vérifier que l'utilisateur appartient à cet hôpital
  if (req.user.hospitalCode !== hospitalCode) {
    logger.warn('Accès hôpital non autorisé', {
      userId: req.user.id,
      userHospital: req.user.hospitalCode,
      requestedHospital: hospitalCode
    });
    
    return res.status(403).json({
      success: false,
      error: 'Accès non autorisé à cet hôpital'
    });
  }
  
  next();
};

/**
 * Middleware de vérification de propriété de ressource
 * Pour les routes où l'utilisateur ne peut modifier que ses propres données
 */
const authorizeOwner = (paramName = 'id') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentification requise'
      });
    }
    
    // Admin et superadmin peuvent tout modifier
    if (['admin', 'superadmin'].includes(req.user.role)) {
      return next();
    }
    
    const resourceId = req.params[paramName];
    
    if (req.user.id.toString() !== resourceId && req.user.uuid !== resourceId) {
      return res.status(403).json({
        success: false,
        error: 'Vous ne pouvez modifier que vos propres données'
      });
    }
    
    next();
  };
};

/**
 * Middleware de logging des actions sensibles
 */
const auditLog = (action) => {
  return async (req, res, next) => {
    // Capturer la réponse originale
    const originalSend = res.send;
    
    res.send = function(body) {
      // Logger l'action après la réponse
      const logData = {
        action,
        userId: req.user?.id,
        hospitalCode: req.user?.hospitalCode,
        method: req.method,
        path: req.path,
        params: req.params,
        statusCode: res.statusCode,
        ip: req.ip
      };
      
      // Ne pas logger le body en production pour la sécurité
      if (process.env.NODE_ENV !== 'production') {
        logData.body = req.body;
      }
      
      logger.info(`[AUDIT] ${action}`, logData);
      
      // Enregistrer dans la base si c'est une action importante
      if (req.user && res.statusCode < 400) {
        const db = require('../../config/database');
        db.query(`
          INSERT INTO activity_logs (hospital_id, user_id, action, details, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          req.user.hospitalId,
          req.user.id,
          action,
          JSON.stringify({ params: req.params, statusCode: res.statusCode }),
          req.ip,
          req.get('User-Agent')?.substring(0, 200)
        ]).catch(err => logger.error('Erreur audit log', err));
      }
      
      return originalSend.call(this, body);
    };
    
    next();
  };
};

module.exports = {
  authenticate,
  authenticateOptional,
  authorize,
  authorizeHospital,
  authorizeOwner,
  auditLog
};
