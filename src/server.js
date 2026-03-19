/**
 * FileSanté - Serveur Principal Express
 * File virtuelle pour urgences hospitalières
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const http = require('http');

const config = require('../config');
const db = require('../config/database');
const logger = require('./utils/logger');

// Routes
const authRoutes = require('./routes/auth');
const patientsRoutes = require('./routes/patients');
const hospitalsRoutes = require('./routes/hospitals');

// Services
const WebSocketService = require('./services/WebSocketService');

// Créer l'app Express
const app = express();
const server = http.createServer(app);

// Trust proxy pour Railway (IMPORTANT!)
app.set('trust proxy', 1);

// Middleware de sécurité
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS
app.use(cors({
  origin: true,
  credentials: true
}));

// Compression
app.use(compression());

// Parse JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Servir le frontend statique
app.use(express.static(path.join(__dirname, '../frontend')));

// Logging des requêtes
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api') || duration > 1000) {
      logger.info(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// ==================== ROUTES API ====================

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbHealth = await db.healthCheck();
    
    res.json({
      status: dbHealth.healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: config.env,
      services: {
        database: dbHealth.healthy ? 'connected' : 'disconnected',
        websocket: 'active'
      },
      database: dbHealth
    });
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Routes API
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api/hospitals', hospitalsRoutes);

// Liste des hôpitaux (endpoint public simplifié)
app.get('/api/hospitals-list', (req, res) => {
  const hospitals = Object.entries(config.hospitals).map(([code, data]) => ({
    code,
    ...data
  }));
  res.json({ success: true, data: hospitals });
});

// ==================== FRONTEND ROUTES ====================

// Servir les fichiers frontend individuellement
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: 'Route API non trouvée' });
  }
  const filePath = path.join(__dirname, '../frontend', req.path);
  res.sendFile(filePath, err => {
    if (err) res.sendFile(path.join(__dirname, '../frontend/index.html'));
  });
});

// ==================== ERROR HANDLING ====================

// Error handler global
app.use((err, req, res, next) => {
  logger.error('Erreur serveur:', err);
  res.status(500).json({
    success: false,
    message: config.env === 'production' ? 'Erreur serveur' : err.message
  });
});

// ==================== DÉMARRAGE ====================

// Initialiser WebSocket
const wss = WebSocketService.init(server);

// Démarrer le serveur
const PORT = config.port;

server.listen(PORT, '0.0.0.0', () => {
  logger.info('========================================');
  logger.info('🏥 FileSanté Backend démarré avec succès');
  logger.info('========================================');
  logger.info(`   Environment: ${config.env}`);
  logger.info(`   Port: ${PORT}`);
  logger.info(`   API: http://localhost:${PORT}/api`);
  logger.info(`   Frontend: http://localhost:${PORT}/`);
  logger.info(`   WebSocket: ws://localhost:${PORT}/ws`);
  logger.info(`   Health: http://localhost:${PORT}/health`);
  logger.info('========================================');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM reçu, fermeture graceful...');
  server.close(() => {
    logger.info('Serveur HTTP fermé');
    db.close().then(() => {
      process.exit(0);
    });
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Exception non capturée:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Promise rejection non gérée:', reason);
});

module.exports = { app, server };
