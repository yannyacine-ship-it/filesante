/**
 * Seed data - Données initiales FileSanté
 */

const db = require('../config/database');
const bcrypt = require('bcryptjs');
const logger = require('../src/utils/logger');
const config = require('../config');

async function seed() {
  logger.info('Démarrage du seeding...');
  
  try {
    // Insérer les hôpitaux
    logger.info('Insertion des hôpitaux...');
    
    for (const [code, hospital] of Object.entries(config.hospitals)) {
      await db.query(`
        INSERT INTO hospitals (code, name, address, phone, timezone)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name,
          address = EXCLUDED.address,
          phone = EXCLUDED.phone,
          timezone = EXCLUDED.timezone
      `, [code, hospital.name, hospital.address, hospital.phone, hospital.timezone]);
      
      logger.info(`Hôpital ${code} inséré/mis à jour`);
    }
    
    // Créer un admin par défaut
    logger.info('Création du compte admin par défaut...');
    
    const adminEmail = 'admin@filesante.ca';
    const adminPassword = await bcrypt.hash('admin123', 10); // Changer en production!
    
    const { rows: existingAdmin } = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [adminEmail]
    );
    
    if (existingAdmin.length === 0) {
      await db.query(`
        INSERT INTO users (email, password_hash, first_name, last_name, role)
        VALUES ($1, $2, $3, $4, $5)
      `, [adminEmail, adminPassword, 'Admin', 'FileSanté', 'superadmin']);
      
      logger.info('Compte admin créé: admin@filesante.ca / admin123');
    } else {
      logger.info('Compte admin existe déjà');
    }
    
    // Créer des infirmières de test pour chaque hôpital
    if (config.env === 'development') {
      logger.info('Création des comptes de test...');
      
      const { rows: hospitals } = await db.query('SELECT id, code FROM hospitals');
      
      for (const hospital of hospitals) {
        const nurseEmail = `nurse@${hospital.code.toLowerCase()}.filesante.ca`;
        const nursePassword = await bcrypt.hash('nurse123', 10);
        
        const { rows: existing } = await db.query(
          'SELECT id FROM users WHERE email = $1',
          [nurseEmail]
        );
        
        if (existing.length === 0) {
          await db.query(`
            INSERT INTO users (hospital_id, email, password_hash, first_name, last_name, role)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [hospital.id, nurseEmail, nursePassword, 'Infirmière', hospital.code, 'nurse']);
          
          logger.info(`Compte nurse créé: ${nurseEmail} / nurse123`);
        }
      }
    }
    
    // Initialiser les stats du jour pour chaque hôpital
    logger.info('Initialisation des stats journalières...');
    
    const today = new Date().toISOString().split('T')[0];
    const { rows: hospitals } = await db.query('SELECT id FROM hospitals');
    
    for (const hospital of hospitals) {
      await db.query(`
        INSERT INTO daily_stats (hospital_id, date)
        VALUES ($1, $2)
        ON CONFLICT (hospital_id, date) DO NOTHING
      `, [hospital.id, today]);
    }
    
    logger.info('Seeding terminé avec succès');
    
  } catch (error) {
    logger.error('Erreur seeding:', error);
    throw error;
  }
}

// Exécuter si appelé directement
if (require.main === module) {
  seed()
    .then(() => {
      logger.info('Seed terminé');
      process.exit(0);
    })
    .catch(err => {
      logger.error('Erreur seed:', err);
      process.exit(1);
    });
}

module.exports = seed;
