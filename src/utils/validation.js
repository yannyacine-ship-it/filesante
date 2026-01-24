/**
 * Utilitaires de validation
 */

const Joi = require('joi');

/**
 * Schémas de validation réutilisables
 */
const schemas = {
  // Patient
  createPatient: Joi.object({
    hospitalCode: Joi.string().uppercase().length(3).required()
      .messages({ 'any.required': 'Code hôpital requis' }),
    priority: Joi.string().valid('P4', 'P5').required()
      .messages({ 'any.only': 'Priorité doit être P4 ou P5' }),
    reason: Joi.string().max(100).optional()
  }),
  
  activatePatient: Joi.object({
    phone: Joi.string().pattern(/^[0-9]{10,15}$/).required()
      .messages({ 
        'string.pattern.base': 'Numéro de téléphone invalide (10-15 chiffres)',
        'any.required': 'Numéro de téléphone requis'
      })
  }),
  
  patientAlert: Joi.object({
    alertType: Joi.string().valid('worsening', 'emergency', 'other').required(),
    message: Joi.string().max(500).optional()
  }),
  
  // Authentification
  login: Joi.object({
    email: Joi.string().email().required()
      .messages({ 'string.email': 'Email invalide' }),
    password: Joi.string().min(6).required()
      .messages({ 'string.min': 'Mot de passe min 6 caractères' })
  }),
  
  register: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8)
      .pattern(/[A-Z]/, 'uppercase')
      .pattern(/[0-9]/, 'number')
      .required()
      .messages({
        'string.min': 'Mot de passe min 8 caractères',
        'string.pattern.name': 'Doit contenir une majuscule et un chiffre'
      }),
    firstName: Joi.string().min(2).max(100).required(),
    lastName: Joi.string().min(2).max(100).required(),
    role: Joi.string().valid('nurse', 'admin').required(),
    hospitalCode: Joi.string().uppercase().length(3).optional()
  }),
  
  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(8)
      .pattern(/[A-Z]/)
      .pattern(/[0-9]/)
      .required()
  }),
  
  // Query params
  queueQuery: Joi.object({
    status: Joi.string().valid('all', 'pending', 'waiting', 'notified').optional(),
    priority: Joi.string().valid('P4', 'P5').optional(),
    limit: Joi.number().integer().min(1).max(500).optional()
  }),
  
  // Pagination
  pagination: Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(20),
    offset: Joi.number().integer().min(0).default(0),
    sort: Joi.string().valid('asc', 'desc').default('desc')
  })
};

/**
 * Middleware de validation Joi
 * @param {string} schemaName - Nom du schéma à utiliser
 * @param {string} source - Source des données ('body', 'query', 'params')
 */
function validate(schemaName, source = 'body') {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    
    if (!schema) {
      return res.status(500).json({
        success: false,
        error: `Schéma de validation '${schemaName}' non trouvé`
      });
    }
    
    const data = req[source];
    const { error, value } = schema.validate(data, { 
      abortEarly: false,
      stripUnknown: true
    });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(400).json({
        success: false,
        error: 'Données invalides',
        details: errors
      });
    }
    
    // Remplacer les données par les données validées et nettoyées
    req[source] = value;
    next();
  };
}

/**
 * Sanitize une chaîne pour éviter les injections
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  
  return str
    .trim()
    .replace(/[<>]/g, '') // Enlever les balises HTML
    .substring(0, 1000); // Limiter la longueur
}

/**
 * Sanitize un objet récursivement
 */
function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return sanitizeString(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[sanitizeString(key)] = sanitizeObject(value);
  }
  return sanitized;
}

/**
 * Middleware de sanitization
 */
function sanitize(req, res, next) {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  next();
}

/**
 * Valide un numéro de téléphone canadien
 */
function isValidCanadianPhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  
  // 10 chiffres ou 11 avec le 1 devant
  if (cleaned.length === 10) {
    return true;
  }
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return true;
  }
  
  return false;
}

/**
 * Formate un numéro de téléphone pour Twilio
 */
function formatPhoneForTwilio(phone) {
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  
  return `+${cleaned}`;
}

module.exports = {
  schemas,
  validate,
  sanitize,
  sanitizeString,
  sanitizeObject,
  isValidCanadianPhone,
  formatPhoneForTwilio
};
