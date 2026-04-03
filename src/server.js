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
const adminOpsRoutes = require('./routes/admin-ops');
const demoRoutes = require('./routes/demo');

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
app.use('/api/admin', adminOpsRoutes);
app.use('/api/demo', demoRoutes);

// Liste des hôpitaux (endpoint public simplifié)
app.get('/api/hospitals-list', (req, res) => {
  const hospitals = Object.entries(config.hospitals).map(([code, data]) => ({
    code,
    ...data
  }));
  res.json({ success: true, data: hospitals });
});

// ── PDF SHIFT REPORT (Feature 8) ──
app.get('/api/hospitals/:code/report', async (req, res) => {
  const { code } = req.params;
  try {
    const PDFDocument = require('pdfkit');
    const db = require('../config/database');

    // Fetch stats
    let stats = { returned: 0, noshow: 0, non_confirme: 0, avg_wait: 0, peak_hour: null, total: 0 };
    let hourly = [];
    try {
      const { rows } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'returned') as returned,
          COUNT(*) FILTER (WHERE status IN ('noshow','non_confirme')) as noshow,
          AVG(EXTRACT(EPOCH FROM (returned_at - activated_at))/60) FILTER (WHERE status = 'returned' AND activated_at IS NOT NULL) as avg_wait,
          COUNT(*) as total
        FROM patients p
        JOIN hospitals h ON p.hospital_id = h.id
        WHERE h.code = $1 AND p.created_at >= CURRENT_DATE
      `, [code]);
      if (rows[0]) {
        stats.returned = parseInt(rows[0].returned) || 0;
        stats.noshow = parseInt(rows[0].noshow) || 0;
        stats.total = parseInt(rows[0].total) || 0;
        stats.avg_wait = Math.round(parseFloat(rows[0].avg_wait) || 0);
      }

      const { rows: hr } = await db.query(`
        SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count
        FROM patients p JOIN hospitals h ON p.hospital_id = h.id
        WHERE h.code = $1 AND p.created_at >= CURRENT_DATE
        GROUP BY EXTRACT(HOUR FROM created_at) ORDER BY count DESC LIMIT 1
      `, [code]);
      if (hr[0]) stats.peak_hour = hr[0].hour;
    } catch (_) { /* DB might not be connected */ }

    const hospitalName = config.hospitals[code]?.name || code;
    const now = new Date();
    const shiftDate = now.toLocaleDateString('fr-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const shiftTime = now.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rapport-quart-${code}-${now.toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(22).font('Helvetica-Bold').text('FileSanté', 50, 50);
    doc.fontSize(14).font('Helvetica').fillColor('#555').text('Rapport de quart — Urgences P4/P5', 50, 78);
    doc.moveTo(50, 100).lineTo(545, 100).strokeColor('#1965D4').lineWidth(2).stroke();

    doc.fontSize(11).fillColor('#333').font('Helvetica')
      .text(`Hôpital: ${hospitalName}`, 50, 115)
      .text(`Date: ${shiftDate}`, 50, 132)
      .text(`Généré à: ${shiftTime}`, 50, 149);

    // Stats
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1965D4').text('Statistiques du quart', 50, 185);
    doc.moveTo(50, 203).lineTo(545, 203).strokeColor('#ddd').lineWidth(1).stroke();

    const statRows = [
      ['Patients traités (revenus)', stats.returned],
      ['No-show / Non confirmés', stats.noshow],
      ['Total enregistrés', stats.total],
      ['Temps moyen d\'attente', stats.avg_wait ? `${stats.avg_wait} min` : 'N/A'],
      ['Heure de pointe', stats.peak_hour !== null ? `${stats.peak_hour}h00` : 'N/A'],
      ['Taux no-show', stats.total > 0 ? `${Math.round(stats.noshow / stats.total * 100)}%` : 'N/A'],
      ['Taux de retour', stats.total > 0 ? `${Math.round(stats.returned / stats.total * 100)}%` : 'N/A']
    ];

    let y = 215;
    statRows.forEach(([label, value], i) => {
      const bg = i % 2 === 0 ? '#F8F8F8' : '#FFFFFF';
      doc.rect(50, y, 495, 22).fill(bg);
      doc.fontSize(11).font('Helvetica').fillColor('#333').text(label, 60, y + 6);
      doc.font('Helvetica-Bold').text(String(value), 400, y + 6, { width: 130, align: 'right' });
      y += 22;
    });

    // Footer
    doc.fontSize(9).font('Helvetica').fillColor('#aaa')
      .text('Rapport généré automatiquement par FileSanté — Données protégées (Loi 25 Québec)', 50, 740, { align: 'center' });

    doc.end();
  } catch (error) {
    logger.error('Erreur génération rapport PDF', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Erreur génération PDF' });
    }
  }
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
