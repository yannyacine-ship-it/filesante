/**
 * Configuration et pool de connexion PostgreSQL - Version Railway
 */

const { Pool } = require('pg');
const logger = require('../src/utils/logger');

// URL de connexion - PRIORITÉ ABSOLUE à DATABASE_URL
const connectionString = process.env.DATABASE_URL;

// Log de débogage (sans mot de passe)
if (connectionString) {
  try {
    const url = new URL(connectionString);
    const safeUrl = `${url.protocol}//${url.hostname}:${url.port}${url.pathname}`;
    logger.info(`📦 Configuration DB: ${safeUrl}`);
  } catch (error) {
    logger.info('📦 Configuration DB: URL définie');
  }
} else {
  logger.error('❌ DATABASE_URL non définie!');
  logger.warn('⚠️  Le serveur utilisera les valeurs par défaut (localhost)');
}

// Configuration du pool
const pool = new Pool({
  connectionString: connectionString,
  // SSL requis en production sur Railway
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false,
  // Optimisations pour Railway
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Event listeners pour le débogage
pool.on('connect', () => {
  logger.debug('🔄 Nouvelle connexion au pool PostgreSQL');
});

pool.on('error', (err) => {
  logger.error('❌ Erreur pool PostgreSQL:', err.message);
});

pool.on('acquire', () => {
  logger.debug('📥 Client acquis du pool');
});

pool.on('release', () => {
  logger.debug('📤 Client libéré dans le pool');
});

// Helper pour les requêtes
const db = {
  // Exécuter une requête simple
  query: async (text, params) => {
    const start = Date.now();
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      
      // Log seulement pour les requêtes longues ou en debug
      if (duration > 1000 || process.env.LOG_LEVEL === 'debug') {
        logger.debug(`📊 Requête (${duration}ms): ${text.substring(0, 50)}...`);
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('❌ Erreur requête SQL:', {
        query: text.substring(0, 100),
        params: params,
        error: error.message,
        duration: `${duration}ms`
      });
      throw error;
    }
  },
  
  // Obtenir un client dédié (pour les transactions)
  getClient: async () => {
    const client = await pool.connect();
    
    // Timeout de sécurité
    const timeout = setTimeout(() => {
      logger.warn('⏰ Timeout client DB - release forcé');
      client.release();
    }, 30000);
    
    // Override release pour clear le timeout
    const originalRelease = client.release;
    client.release = () => {
      clearTimeout(timeout);
      originalRelease.apply(client);
    };
    
    return client;
  },
  
  // Transaction helper
  transaction: async (callback) => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
  
  // Health check amélioré
  healthCheck: async () => {
    try {
      const start = Date.now();
      const result = await pool.query('SELECT NOW(), version()');
      const duration = Date.now() - start;
      
      return {
        healthy: true,
        time: result.rows[0].now,
        version: result.rows[0].version,
        responseTime: `${duration}ms`
      };
    } catch (error) {
      logger.error('❌ Health check DB échoué:', error.message);
      return {
        healthy: false,
        error: error.message,
        databaseUrl: connectionString ? 'Set' : 'Not set'
      };
    }
  },
  
  // Fermer proprement
  close: async () => {
    try {
      await pool.end();
      logger.info('✅ Pool PostgreSQL fermé');
    } catch (error) {
      logger.error('❌ Erreur fermeture pool:', error);
    }
  },
  
  // Exposer le pool pour les cas avancés
  pool
};

module.exports = db;
