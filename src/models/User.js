/**
 * Modèle User - Authentification et gestion des utilisateurs
 */

const db = require('../../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const logger = require('../utils/logger');

const SALT_ROUNDS = 12;

const User = {
  /**
   * Crée un nouvel utilisateur
   */
  async create({ email, password, firstName, lastName, role = 'nurse', hospitalCode }) {
    // Vérifier si l'email existe déjà
    const { rows: existing } = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (existing.length > 0) {
      throw new Error('Cet email est déjà utilisé');
    }
    
    // Récupérer l'ID de l'hôpital si spécifié
    let hospitalId = null;
    if (hospitalCode) {
      const { rows: hospitals } = await db.query(
        'SELECT id FROM hospitals WHERE code = $1',
        [hospitalCode]
      );
      if (hospitals.length === 0) {
        throw new Error(`Hôpital ${hospitalCode} non trouvé`);
      }
      hospitalId = hospitals[0].id;
    }
    
    // Hasher le mot de passe
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Insérer l'utilisateur
    const { rows } = await db.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, role, hospital_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, uuid, email, first_name, last_name, role, hospital_id, created_at
    `, [email.toLowerCase(), passwordHash, firstName, lastName, role, hospitalId]);
    
    logger.info('Utilisateur créé', { userId: rows[0].id, email, role });
    
    return rows[0];
  },
  
  /**
   * Authentifie un utilisateur et retourne un token JWT
   */
  async authenticate(email, password) {
    // Récupérer l'utilisateur
    const { rows } = await db.query(`
      SELECT u.*, h.code as hospital_code, h.name as hospital_name
      FROM users u
      LEFT JOIN hospitals h ON u.hospital_id = h.id
      WHERE u.email = $1 AND u.is_active = true
    `, [email.toLowerCase()]);
    
    if (rows.length === 0) {
      throw new Error('Email ou mot de passe incorrect');
    }
    
    const user = rows[0];
    
    // Vérifier le mot de passe
    const isValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isValid) {
      logger.warn('Tentative de connexion échouée', { email });
      throw new Error('Email ou mot de passe incorrect');
    }
    
    // Mettre à jour la dernière connexion
    await db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );
    
    // Générer le token JWT
    const token = jwt.sign(
      {
        userId: user.id,
        uuid: user.uuid,
        email: user.email,
        role: user.role,
        hospitalId: user.hospital_id,
        hospitalCode: user.hospital_code
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    
    // Générer un refresh token (durée plus longue)
    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
      config.jwt.secret,
      { expiresIn: '7d' }
    );
    
    logger.info('Connexion réussie', { userId: user.id, email });
    
    return {
      token,
      refreshToken,
      user: {
        id: user.id,
        uuid: user.uuid,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        hospital: user.hospital_code ? {
          code: user.hospital_code,
          name: user.hospital_name
        } : null
      }
    };
  },
  
  /**
   * Vérifie et décode un token JWT
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, config.jwt.secret);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token expiré');
      }
      throw new Error('Token invalide');
    }
  },
  
  /**
   * Rafraîchit un token expiré
   */
  async refreshToken(refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, config.jwt.secret);
      
      if (decoded.type !== 'refresh') {
        throw new Error('Token de rafraîchissement invalide');
      }
      
      // Récupérer l'utilisateur
      const { rows } = await db.query(`
        SELECT u.*, h.code as hospital_code
        FROM users u
        LEFT JOIN hospitals h ON u.hospital_id = h.id
        WHERE u.id = $1 AND u.is_active = true
      `, [decoded.userId]);
      
      if (rows.length === 0) {
        throw new Error('Utilisateur non trouvé');
      }
      
      const user = rows[0];
      
      // Générer un nouveau token
      const newToken = jwt.sign(
        {
          userId: user.id,
          uuid: user.uuid,
          email: user.email,
          role: user.role,
          hospitalId: user.hospital_id,
          hospitalCode: user.hospital_code
        },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );
      
      return { token: newToken };
      
    } catch (error) {
      throw new Error('Impossible de rafraîchir le token');
    }
  },
  
  /**
   * Récupère un utilisateur par ID
   */
  async getById(id) {
    const { rows } = await db.query(`
      SELECT u.id, u.uuid, u.email, u.first_name, u.last_name, u.role,
             u.hospital_id, u.is_active, u.last_login, u.created_at,
             h.code as hospital_code, h.name as hospital_name
      FROM users u
      LEFT JOIN hospitals h ON u.hospital_id = h.id
      WHERE u.id = $1
    `, [id]);
    
    return rows[0] || null;
  },
  
  /**
   * Récupère un utilisateur par UUID
   */
  async getByUuid(uuid) {
    const { rows } = await db.query(`
      SELECT u.id, u.uuid, u.email, u.first_name, u.last_name, u.role,
             u.hospital_id, u.is_active, u.last_login, u.created_at,
             h.code as hospital_code, h.name as hospital_name
      FROM users u
      LEFT JOIN hospitals h ON u.hospital_id = h.id
      WHERE u.uuid = $1
    `, [uuid]);
    
    return rows[0] || null;
  },
  
  /**
   * Liste les utilisateurs (admin)
   */
  async list({ hospitalCode, role, limit = 100, offset = 0 }) {
    let query = `
      SELECT u.id, u.uuid, u.email, u.first_name, u.last_name, u.role,
             u.is_active, u.last_login, u.created_at,
             h.code as hospital_code, h.name as hospital_name
      FROM users u
      LEFT JOIN hospitals h ON u.hospital_id = h.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (hospitalCode) {
      query += ` AND h.code = $${paramIndex}`;
      params.push(hospitalCode);
      paramIndex++;
    }
    
    if (role) {
      query += ` AND u.role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }
    
    query += ` ORDER BY u.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const { rows } = await db.query(query, params);
    return rows;
  },
  
  /**
   * Met à jour un utilisateur
   */
  async update(id, updates) {
    const allowedFields = ['first_name', 'last_name', 'is_active', 'hospital_id'];
    const setClause = [];
    const params = [id];
    let paramIndex = 2;
    
    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase to snake_case
      if (allowedFields.includes(dbKey)) {
        setClause.push(`${dbKey} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }
    
    if (setClause.length === 0) {
      throw new Error('Aucun champ valide à mettre à jour');
    }
    
    const { rows } = await db.query(`
      UPDATE users SET ${setClause.join(', ')}
      WHERE id = $1
      RETURNING id, uuid, email, first_name, last_name, role, is_active
    `, params);
    
    return rows[0];
  },
  
  /**
   * Change le mot de passe
   */
  async changePassword(userId, currentPassword, newPassword) {
    // Récupérer le hash actuel
    const { rows } = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );
    
    if (rows.length === 0) {
      throw new Error('Utilisateur non trouvé');
    }
    
    // Vérifier le mot de passe actuel
    const isValid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    
    if (!isValid) {
      throw new Error('Mot de passe actuel incorrect');
    }
    
    // Hasher le nouveau mot de passe
    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    
    // Mettre à jour
    await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newHash, userId]
    );
    
    logger.info('Mot de passe changé', { userId });
    
    return true;
  },
  
  /**
   * Désactive un utilisateur
   */
  async deactivate(id) {
    const { rows } = await db.query(`
      UPDATE users SET is_active = false
      WHERE id = $1
      RETURNING id, email
    `, [id]);
    
    if (rows.length > 0) {
      logger.info('Utilisateur désactivé', { userId: id });
    }
    
    return rows[0];
  }
};

module.exports = User;
