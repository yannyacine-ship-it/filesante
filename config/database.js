/**
 * Configuration et pool de connexion PostgreSQL
 */

const { Pool } = require('pg');
const config = require('./index');
const logger = require('../src/utils/logger');

// Configuration du pool
const poolConfig = config.database.url
  ? { connectionString: config.database.url, ssl: config.env === 'production' ? { rejectUnauthorized: false } : false }
  : {
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
      min: config.database.pool.min,
      max: config.database.pool.max
    };

const pool = new Pool(poolConfig);

// Event listeners
pool.on('connect', () => {
  logger.debug('Nouvelle connexion au pool PostgreSQL');
});

pool.on('error', (err) => {
  logger.error('Erreur inattendue sur le pool PostgreSQL', err);
});

// Helper pour les requêtes
const db = {
  /**
   * Exécute une requête SQL
   * @param {string} text - Requête SQL
   * @param {Array} params - Paramètres
   * @returns {Promise<QueryResult>}
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
   * @returns {Promise<PoolClient>}
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
   * @param {Function} callback - Fonction recevant le client
   * @returns {Promise<any>}
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
   * @returns {Promise<boolean>}
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
    await pool.end();
    logger.info('Pool PostgreSQL fermé');
  },
  
  pool
};

module.exports = db;
