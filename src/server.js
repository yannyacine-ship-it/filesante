/**
 * FileSanté Backend - Serveur Principal
 * File virtuelle pour urgences hospitalières
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const config = require('../config');
const db = require('../config/database');
const logger = require('./utils/logger');
const WebSocketService = require('./services/WebSocketService');
const { startJobs } = require('./jobs/scheduler');

// Routes
const patientsRoutes = require('./routes/patients');
const hospitalsRoutes = require('./routes/hospitals');
const authRoutes = require('./routes/auth');
const { authenticateOptional } = require('./middleware/auth');

// Créer l'application Express
const app = express();
const server = http.createServer(app);

// ============================================
// MIDDLEWARES
// ============================================

// Sécurité
app.use(helmet({
  contentSecurityPolicy: false // Désactiver pour permettre les QR codes inline
}));

// CORS
app.use(cors({
  origin: config.env === 'production' 
    ? [config.urls.frontend] 
    : '*',
  credentials: true
}));

// Compression
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { 
    success: false, 
    error: 'Trop de requêtes, veuillez réessayer plus tard' 
  }
});
app.use('/api/', limiter);

// Parsing JSON
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging des requêtes
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api/')) {
      logger.logRequest(req, res, duration);
    }
  });
  next();
});

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/health', async (req, res) => {
  const dbHealthy = await db.healthCheck();
  
  res.status(dbHealthy ? 200 : 503).json({
    status: dbHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    version: require('../package.json').version,
    environment: config.env,
    services: {
      database: dbHealthy ? 'connected' : 'disconnected',
      websocket: WebSocketService.getConnectedClients('*') >= 0 ? 'active' : 'inactive'
    }
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api/hospitals', hospitalsRoutes);

// Webhook Twilio pour status SMS
app.post('/webhooks/twilio/status', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const SmsService = require('./services/SmsService');
    await SmsService.handleStatusCallback(req.body);
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Erreur webhook Twilio', error);
    res.status(500).send('Error');
  }
});

// Route pour les stats globales (admin)
app.get('/api/admin/stats', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        h.code,
        h.name,
        COUNT(*) FILTER (WHERE p.status IN ('pending', 'waiting', 'notified')) as active_patients,
        ds.total_registered,
        ds.total_returned,
        ds.total_noshow,
        ds.avg_wait_time_minutes
      FROM hospitals h
      LEFT JOIN patients p ON p.hospital_id = h.id
      LEFT JOIN daily_stats ds ON ds.hospital_id = h.id AND ds.date = CURRENT_DATE
      WHERE h.is_active = true
      GROUP BY h.id, h.code, h.name, ds.total_registered, ds.total_returned, ds.total_noshow, ds.avg_wait_time_minutes
    `);
    
    res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('Erreur stats admin', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// Route pour exécuter un job manuellement (admin)
app.post('/api/admin/jobs/:jobName', async (req, res) => {
  try {
    const { runManually } = require('./jobs/scheduler');
    await runManually(req.params.jobName);
    res.json({ success: true, message: `Job ${req.params.jobName} exécuté` });
  } catch (error) {
    logger.error('Erreur exécution job', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Route non trouvée' 
  });
});

// Gestionnaire d'erreurs global
app.use((err, req, res, next) => {
  logger.error('Erreur non gérée', err);
  
  res.status(err.status || 500).json({
    success: false,
    error: config.env === 'production' 
      ? 'Erreur serveur interne' 
      : err.message
  });
});

// ============================================
// DÉMARRAGE
// ============================================

async function start() {
  try {
    // Vérifier la connexion à la base de données
    logger.info('Vérification de la connexion à la base de données...');
    const dbConnected = await db.healthCheck();
    
    if (!dbConnected) {
      throw new Error('Impossible de se connecter à la base de données');
    }
    logger.info('Base de données connectée');
    
    // Exécuter les migrations si nécessaire
    if (config.env !== 'production') {
      logger.info('Exécution des migrations...');
      const { runMigrations } = require('../migrations/run');
      await runMigrations();
    }
    
    // Initialiser WebSocket
    WebSocketService.init(server);
    
    // Démarrer les jobs planifiés
    startJobs();
    
    // Démarrer le serveur
    server.listen(config.port, () => {
      logger.info(`🏥 FileSanté Backend démarré`);
      logger.info(`   Environment: ${config.env}`);
      logger.info(`   Port: ${config.port}`);
      logger.info(`   API: http://localhost:${config.port}/api`);
      logger.info(`   WebSocket: ws://localhost:${config.port}/ws`);
      logger.info(`   Health: http://localhost:${config.port}/health`);
    });
    
  } catch (error) {
    logger.error('Erreur démarrage serveur', error);
    process.exit(1);
  }
}

// Gestion de l'arrêt propre
process.on('SIGTERM', async () => {
  logger.info('Signal SIGTERM reçu, arrêt en cours...');
  
  server.close(() => {
    logger.info('Serveur HTTP fermé');
  });
  
  await db.close();
  
  const { stopJobs } = require('./jobs/scheduler');
  stopJobs();
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Signal SIGINT reçu, arrêt en cours...');
  process.exit(0);
});

// Démarrer si c'est le fichier principal
if (require.main === module) {
  start();
}

module.exports = { app, server, start };
