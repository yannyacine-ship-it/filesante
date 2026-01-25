/**
 * Configuration et pool de connexion PostgreSQL
 * VERSION SIMPLIE - Sans parser complexe
 */

const { Pool } = require('pg');
const config = require('./index');
const logger = require('../src/utils/logger');

// Utiliser DIRECTEMENT la connection string de Railway
// Si DATABASE_URL est présente, l'utiliser SINSS parsing
const poolConfig = config.database.url
  ? { connectionString: config.database.url }  // Railway fournit l'URL complète avec SSL
  : {
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
      min: config.database.pool?.min || 2,
      max: config.database.pool?.max || 10
    };

const pool = new Pool(poolConfig);

// Event listeners
pool.on('connect', () => {
  logger.info('✅ Nouvelle connexion au pool PostgreSQL');
});

pool.on('error', (err) => {
  logger.error('❌ Erreur inattendue sur le pool PostgreSQL:', err.message);
});

// Helper pour les requêtes
const db = {
  /**
   * Exécute une requête SQL
   */
  query: async (text, params) => {
    const start = Date.now();
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug(`Requête exécutée en ${duration}ms`, { text: text.substring(0, 100), rows: result.rowCount });
      return result;
    } catch (error) {
      logger.error('Erreur requête SQL', { text: text.substring(0, 100), error: error.message });
      throw error;
    }
  },

  /**
   * Obtient un client du pool pour les transactions
   */
  getClient: async () => {
    const client = await pool.connect();
    const query = client.query.bind(client);
    const release = client.release.bind(client);
    
    // Timeout pour éviter les clients orphelins
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

  /**
   * Exécute une transaction
   */
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

  /**
   * Vérifie la connexion
   */
  healthCheck: async () => {
    try {
      const result = await pool.query('SELECT NOW()');
      return !!result.rows[0];
    } catch (error) {
      logger.error('Health check PostgreSQL échoué', error);
      return false;
    }
  },

  /**
   * Ferme le pool
   */
  close: async () => {
    try {
      await pool.end();
      logger.info('Pool PostgreSQL fermé');
    } catch (error) failed {
      logger.error('Erreur lors de la fermeture du pool', error);
    }
  }
};

module.exports = db;
