/**
 * Configuration centralisée FileSanté
 * Charge les variables d'environnement et définit les valeurs par défaut
 */

require('dotenv').config();

const config = {
  // Environnement
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  
  // Base de données
  database: {
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    name: process.env.DB_NAME || 'filesante',
    user: process.env.DB_USER || 'filesante',
    password: process.env.DB_PASSWORD || 'password',
    pool: {
      min: 2,
      max: 10
    }
  },
  
  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379
  },
  
  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  },
  
  // Twilio
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER
  },
  
  // URLs
  urls: {
    frontend: process.env.FRONTEND_URL || 'http://localhost:8080',
    api: process.env.API_URL || 'http://localhost:3000'
  },
  
  // TTL Configuration (Time-To-Live par statut)
  ttl: {
    pending: parseInt(process.env.TTL_PENDING, 10) || 2 * 60 * 60 * 1000,      // 2h
    waiting: parseInt(process.env.TTL_WAITING, 10) || 12 * 60 * 60 * 1000,     // 12h
    notified: parseInt(process.env.TTL_NOTIFIED, 10) || 3 * 60 * 60 * 1000,    // 3h
    returned: parseInt(process.env.TTL_RETURNED, 10) || 1 * 60 * 60 * 1000,    // 1h
    noshow: parseInt(process.env.TTL_NOSHOW, 10) || 24 * 60 * 60 * 1000,       // 24h
    cancelled: parseInt(process.env.TTL_NOSHOW, 10) || 24 * 60 * 60 * 1000     // 24h
  },
  
  // Seuils d'alerte
  alerts: {
    overdue: parseInt(process.env.ALERT_OVERDUE, 10) || 6 * 60 * 60 * 1000,    // 6h
    escalate: parseInt(process.env.ALERT_ESCALATE, 10) || 8 * 60 * 60 * 1000,  // 8h
    notifyBefore: parseInt(process.env.NOTIFY_BEFORE, 10) || 45 * 60 * 1000    // 45min
  },
  
  // Jobs cron
  cron: {
    cleanup: process.env.CRON_CLEANUP || '*/15 * * * *',
    dailyReset: process.env.CRON_DAILY_RESET || '0 6 * * *',
    escalation: process.env.CRON_ESCALATION || '*/30 * * * *'
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/filesante.log'
  },
  
  // Hôpitaux supportés
  hospitals: {
    HMR: {
      code: 'HMR',
      name: 'Hôpital Maisonneuve-Rosemont',
      address: '5415 boul. de l\'Assomption, Montréal',
      phone: '514-252-3400',
      timezone: 'America/Montreal'
    },
    HND: {
      code: 'HND',
      name: 'Hôpital Notre-Dame',
      address: '1560 rue Sherbrooke Est, Montréal',
      phone: '514-890-8000',
      timezone: 'America/Montreal'
    },
    HSC: {
      code: 'HSC',
      name: 'Hôpital du Sacré-Cœur',
      address: '5400 boul. Gouin Ouest, Montréal',
      phone: '514-338-2222',
      timezone: 'America/Montreal'
    },
    HGM: {
      code: 'HGM',
      name: 'Hôpital Général de Montréal',
      address: '1650 av. Cedar, Montréal',
      phone: '514-934-1934',
      timezone: 'America/Montreal'
    }
  },
  
  // Priorités supportées
  priorities: ['P4', 'P5'],
  
  // Statuts possibles
  statuses: ['pending', 'waiting', 'notified', 'returned', 'noshow', 'cancelled']
};

// Validation de la configuration
function validateConfig() {
  const errors = [];
  
  if (config.env === 'production') {
    if (!config.jwt.secret || config.jwt.secret === 'dev-secret-change-me') {
      errors.push('JWT_SECRET doit être défini en production');
    }
    if (!config.twilio.accountSid) {
      errors.push('TWILIO_ACCOUNT_SID doit être défini en production');
    }
    if (!config.database.url && !config.database.password) {
      errors.push('Configuration base de données incomplète');
    }
  }
  
  if (errors.length > 0) {
    console.error('Erreurs de configuration:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
}

validateConfig();

module.exports = config;
