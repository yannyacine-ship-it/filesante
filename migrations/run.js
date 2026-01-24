/**
 * Migration initiale - Schéma de base FileSanté
 */

const db = require('../config/database');
const logger = require('../src/utils/logger');

const migrations = [
  {
    name: '001_initial_schema',
    up: `
      -- Extension pour UUID
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      
      -- Table des hôpitaux
      CREATE TABLE IF NOT EXISTS hospitals (
        id SERIAL PRIMARY KEY,
        code VARCHAR(10) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        address TEXT,
        phone VARCHAR(20),
        timezone VARCHAR(50) DEFAULT 'America/Montreal',
        is_active BOOLEAN DEFAULT true,
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Table des utilisateurs (infirmières, admins)
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
        hospital_id INTEGER REFERENCES hospitals(id),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        role VARCHAR(20) DEFAULT 'nurse' CHECK (role IN ('nurse', 'admin', 'superadmin')),
        is_active BOOLEAN DEFAULT true,
        last_login TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Table principale des patients en file
      CREATE TABLE IF NOT EXISTS patients (
        id SERIAL PRIMARY KEY,
        uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
        token VARCHAR(20) UNIQUE NOT NULL,
        hospital_id INTEGER REFERENCES hospitals(id) NOT NULL,
        created_by INTEGER REFERENCES users(id),
        
        -- Informations triage
        priority VARCHAR(5) NOT NULL CHECK (priority IN ('P4', 'P5')),
        reason VARCHAR(100),
        
        -- Contact
        phone VARCHAR(20),
        phone_verified BOOLEAN DEFAULT false,
        
        -- Statut et timestamps
        status VARCHAR(20) DEFAULT 'pending' 
          CHECK (status IN ('pending', 'waiting', 'notified', 'returned', 'noshow', 'cancelled')),
        
        -- Estimations
        estimated_wait_minutes INTEGER,
        position_in_queue INTEGER,
        
        -- Timestamps par statut
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        activated_at TIMESTAMP WITH TIME ZONE,
        notified_at TIMESTAMP WITH TIME ZONE,
        returned_at TIMESTAMP WITH TIME ZONE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP WITH TIME ZONE,
        
        -- Alertes
        is_escalated BOOLEAN DEFAULT false,
        escalated_at TIMESTAMP WITH TIME ZONE,
        alert_type VARCHAR(50),
        alert_message TEXT,
        
        -- Métadonnées
        metadata JSONB DEFAULT '{}'
      );
      
      -- Table des notifications SMS
      CREATE TABLE IF NOT EXISTS sms_notifications (
        id SERIAL PRIMARY KEY,
        patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
        phone VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(30) NOT NULL CHECK (type IN ('registration', 'reminder', 'notification', 'alert')),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
        provider_id VARCHAR(100),
        error_message TEXT,
        sent_at TIMESTAMP WITH TIME ZONE,
        delivered_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Table des statistiques journalières
      CREATE TABLE IF NOT EXISTS daily_stats (
        id SERIAL PRIMARY KEY,
        hospital_id INTEGER REFERENCES hospitals(id),
        date DATE NOT NULL,
        total_registered INTEGER DEFAULT 0,
        total_activated INTEGER DEFAULT 0,
        total_notified INTEGER DEFAULT 0,
        total_returned INTEGER DEFAULT 0,
        total_noshow INTEGER DEFAULT 0,
        total_cancelled INTEGER DEFAULT 0,
        avg_wait_time_minutes DECIMAL(10,2),
        avg_time_saved_minutes DECIMAL(10,2),
        peak_hour INTEGER,
        peak_count INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(hospital_id, date)
      );
      
      -- Table des logs d'activité
      CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY,
        hospital_id INTEGER REFERENCES hospitals(id),
        user_id INTEGER REFERENCES users(id),
        patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
        action VARCHAR(50) NOT NULL,
        details JSONB DEFAULT '{}',
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Index pour performance
      CREATE INDEX IF NOT EXISTS idx_patients_hospital_status ON patients(hospital_id, status);
      CREATE INDEX IF NOT EXISTS idx_patients_token ON patients(token);
      CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status);
      CREATE INDEX IF NOT EXISTS idx_patients_expires_at ON patients(expires_at);
      CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients(created_at);
      CREATE INDEX IF NOT EXISTS idx_sms_patient ON sms_notifications(patient_id);
      CREATE INDEX IF NOT EXISTS idx_sms_status ON sms_notifications(status);
      CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(hospital_id, date);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_hospital ON activity_logs(hospital_id, created_at);
      
      -- Fonction pour mettre à jour updated_at automatiquement
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      -- Triggers pour updated_at
      DROP TRIGGER IF EXISTS update_hospitals_updated_at ON hospitals;
      CREATE TRIGGER update_hospitals_updated_at 
        BEFORE UPDATE ON hospitals 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at 
        BEFORE UPDATE ON users 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_patients_updated_at ON patients;
      CREATE TRIGGER update_patients_updated_at 
        BEFORE UPDATE ON patients 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_daily_stats_updated_at ON daily_stats;
      CREATE TRIGGER update_daily_stats_updated_at 
        BEFORE UPDATE ON daily_stats 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `
  }
];

async function runMigrations() {
  logger.info('Démarrage des migrations...');
  
  // Créer la table de suivi des migrations si elle n'existe pas
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Récupérer les migrations déjà exécutées
  const { rows: executed } = await db.query('SELECT name FROM migrations');
  const executedNames = executed.map(r => r.name);
  
  for (const migration of migrations) {
    if (executedNames.includes(migration.name)) {
      logger.info(`Migration ${migration.name} déjà exécutée, skip`);
      continue;
    }
    
    try {
      logger.info(`Exécution de la migration: ${migration.name}`);
      await db.query(migration.up);
      await db.query('INSERT INTO migrations (name) VALUES ($1)', [migration.name]);
      logger.info(`Migration ${migration.name} terminée avec succès`);
    } catch (error) {
      logger.error(`Erreur migration ${migration.name}:`, error);
      throw error;
    }
  }
  
  logger.info('Toutes les migrations terminées');
}

// Exécuter si appelé directement
if (require.main === module) {
  runMigrations()
    .then(() => {
      logger.info('Migrations terminées');
      process.exit(0);
    })
    .catch(err => {
      logger.error('Erreur migrations:', err);
      process.exit(1);
    });
}

module.exports = { runMigrations, migrations };
