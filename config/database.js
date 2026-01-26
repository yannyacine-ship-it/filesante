/**
 * Configuration et pool de connexion PostgreSQL - Version corrigée
 */

const { Pool } = require('pg');
const logger = require('../src/utils/logger');

// Configuration directe depuis Railway
const connectionString = process.env.DATABASE_URL;

// Log de débogage (sans afficher le mot de passe)
if (connectionString) {
  const safeUrl = connectionString.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
  logger.info('Configuration DB chargée depuis DATABASE_URL:', { 
    url: safeUrl,
    env: process.env.NODE_ENV 
  });
} else {
  logger.error('DATABASE_URL non définie dans les variables d\'environnement');
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false
});

// Event listeners
pool.on('connect', () => {
  logger.debug('Nouvelle connexion au pool PostgreSQL');
});

pool.on('error', (err) => {
  logger.error('Erreur inattendue sur le pool PostgreSQL', err);
});

// Helper pour les requêtes
const db = {
  query: async (text, params) => {
    const start = Date.now();
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug(`Requête exécutée en ${duration}ms`, { 
        text: text.substring(0, 100), 
        rows: result.rowCount 
      });
      return result;
    } catch (error) {
      logger.error('Erreur requête SQL', { 
        text: text.substring(0, 100), 
        error: error.message 
      });
      throw error;
    }
  },
  
  getClient: async () => {
    const client = await pool.connect();
    const query = client.query.bind(client);
    const release = client.release.bind(client);
    
    const timeout = setTimeout(() => {
      logger.error('Client PostgreSQL tenu trop longtemps, release forcé');
      client.release();
    }, 30000);
    
    client.release = () => {
      clearTimeout(timeout);
      release();
    };
    
    return client;
  },
  
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
  
  healthCheck: async () => {
    try {
      const result = await pool.query('SELECT NOW()');
      return { 
        healthy: true, 
        time: result.rows[0].now 
      };
    } catch (error) {
      logger.error('Health check PostgreSQL échoué:', error.message);
      return { 
        healthy: false, 
        error: error.message 
      };
    }
  },
  
  close: async () => {
    await pool.end();
    logger.info('Pool PostgreSQL fermé');
  },
  
  pool
};

module.exports = db;
