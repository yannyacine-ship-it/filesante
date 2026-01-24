/**
 * Logger Winston configuré pour FileSanté
 */

const winston = require('winston');
const path = require('path');

// Déterminer le niveau de log selon l'environnement
const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// Format personnalisé
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...metadata }) => {
    let msg = `${timestamp} [${level.toUpperCase()}] ${message}`;
    
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    
    if (stack) {
      msg += `\n${stack}`;
    }
    
    return msg;
  })
);

// Format pour la console (avec couleurs)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} ${level}: ${message}`;
    
    if (Object.keys(metadata).length > 0 && process.env.NODE_ENV !== 'production') {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    
    return msg;
  })
);

// Configuration des transports
const transports = [
  // Console
  new winston.transports.Console({
    format: consoleFormat
  })
];

// Ajouter fichier en production
if (process.env.NODE_ENV === 'production') {
  const logDir = process.env.LOG_FILE ? path.dirname(process.env.LOG_FILE) : 'logs';
  
  transports.push(
    // Fichier général
    new winston.transports.File({
      filename: path.join(logDir, 'filesante.log'),
      format: customFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Fichier erreurs seulement
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: customFormat,
      maxsize: 5242880,
      maxFiles: 5
    })
  );
}

// Créer le logger
const logger = winston.createLogger({
  level,
  transports,
  // Ne pas quitter sur exception non gérée
  exitOnError: false
});

// Méthodes utilitaires
logger.logRequest = (req, res, duration) => {
  const { method, originalUrl, ip } = req;
  const { statusCode } = res;
  
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  
  logger.log(level, `${method} ${originalUrl} ${statusCode} ${duration}ms`, {
    ip,
    userAgent: req.get('User-Agent')?.substring(0, 50)
  });
};

logger.logPatientAction = (action, patientId, hospitalCode, metadata = {}) => {
  logger.info(`[PATIENT] ${action}`, {
    patientId,
    hospitalCode,
    ...metadata
  });
};

logger.logJob = (jobName, status, metadata = {}) => {
  const level = status === 'error' ? 'error' : 'info';
  logger.log(level, `[JOB:${jobName}] ${status}`, metadata);
};

module.exports = logger;
