/**
 * Configuration et pool de connexion PostgreSQL
 * CORRIGÉ: Utilise correctement DATABASE_URL Railway
 */

const { Pool } = require('pg');
const config = require('./index');
const logger = require('../src/utils/logger');

// ==========================================
// CORRIGÉ: Parser correctement DATABASE_URL Railway
// ==========================================

/**
 * Extrait les informations de connexion depuis DATABASE_URL
 * Fonctionne avec les formats Railway standard
 */
function parseConnectionString(connectionString) {
  if (!connectionString) {
    return null;
  }

  try {
    // Parser le protocol
    const protocolMatch = connectionString.match(/^(postgres(?:ql)?:\/\/)/i);
    if (!protocolMatch) {
      return null;
    }

    const rest = connectionString.substring(protocolMatch[0].length);

    // Parser host:port/database
    // Format Railway: postgresql://user:pass@host.internal:port/database
    const urlParts = rest.split('@');
    
    if (urlParts.length >= 2) {
      const authPart = urlParts[0]; // user:pass (peut être vide)
      const hostAndDb = urlParts[1];
      
      // host.internal:port/database
      const lastSlashIndex = hostAndDb.lastIndexOf('/');
      
      let hostPort = '';
      let database = '';
      
      if (lastSlashIndex > 0) {
        hostPort = hostAndDb.substring(0, lastSlashIndex);
        database = hostAndDb.substring(lastSlashIndex + 1);
      } else {
        hostPort = hostAndDb;
      }

      return {
        host: hostPort,
        database: database,
        // Le port est déjà inclus dans hostPort (ex: filesante-db.railway.internal:6173)
        user: authPart || '',
        password: '',
        connectionString: connectionString,
        ssl: true
      };
    }

    // Fallback: parser simple pour localhost
    const urlObj = new URL(connectionString);
    return {
      host: urlObj.hostname,
      port: urlObj.port || 5432,
      database: urlObj.pathname.substring(1) || 'filesante',
      user: urlObj.username || '',
      password: urlObj.password || '',
      connectionString: connectionString,
      ssl: connectionString.includes('sslmode=require')
    };
  } catch (error) {
    logger.warn('Impossible de parser DATABASE_URL:', error.message);
    return null;
  }
}

// ==========================================
// Configuration du pool
// ==========================================

let dbConfig = {};

// Priorité 1: Utiliser DATABASE_URL (Railway)
if (config.database.url) {
  const parsed = parseConnectionString(config.database.url);
  
  if (parsed) {
    logger.info('✅ Utilisation de DATABASE_URL Railway:', {
      host: parsed.host,
      database: parsed.database,
      ssl: parsed.ssl
    });
    
    dbConfig = {
      connectionString: config.database.url,
      ssl: config.env === 'production' ? { rejectUnauthorized: false } : false
    };
  } else {
    // DATABASE_URL est configurée mais invalide
    logger.warn('⚠️  DATABASE_URL configurée mais impossible à parser');
    // Fallback sur configuration individuelle
    dbConfig = {
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
      min: config.database.pool.min,
      max: config.database.pool.max
    };
  }
} else {
  // Priorité 2: Utiliser la configuration individuelle
  dbConfig = {
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    min: config.database.pool.min,
    max: config.database.pool.max
  };
}

const pool = new Pool(dbConfig);

// Event listeners
pool.on('connect', () => {
  logger.info('✅ Nouvelle connexion au pool PostgreSQL', {
    host: dbConfig.connectionString ? 'Railway (via DATABASE_URL)' : `${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
    database: dbConfig.database
  });
});

pool.on('error', (err) => {
  logger.error('❌ Erreur inattendue sur le pool PostgreSQL', err.message);
});

// ==========================================
// Helper pour les requêtes
// ==========================================

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
      logger.debug(`Requête exécutée en ${duration}ms`, { text: text.substring(0, 100), rowCount: result.rowCount });
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
    try {
      await pool.end();
      logger.info('Pool PostgreSQL fermé');
    } catch (error) {
      logger.error('Erreur lors de la fermeture du pool', error);
    }
  }
};

module.exports = db;
