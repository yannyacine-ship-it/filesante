#!/usr/bin/env node

/**
 * Script de démonstration FileSanté
 * Simule des patients en temps réel pour tester le système
 * 
 * Usage: node scripts/demo.js [options]
 * 
 * Options:
 *   --hospital HMR   Code hôpital (défaut: HMR)
 *   --patients 10    Nombre de patients à créer (défaut: 10)
 *   --interval 5     Intervalle entre les actions en secondes (défaut: 5)
 *   --realtime       Mode temps réel (suit le cycle de vie complet)
 */

const http = require('http');

// Configuration
const config = {
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  hospital: process.argv.includes('--hospital') 
    ? process.argv[process.argv.indexOf('--hospital') + 1] 
    : 'HMR',
  patientCount: process.argv.includes('--patients')
    ? parseInt(process.argv[process.argv.indexOf('--patients') + 1])
    : 10,
  interval: process.argv.includes('--interval')
    ? parseInt(process.argv[process.argv.indexOf('--interval') + 1]) * 1000
    : 5000,
  realtime: process.argv.includes('--realtime')
};

// Raisons possibles pour les patients
const REASONS = [
  'douleur_mineure',
  'mal_de_tete',
  'toux_persistante',
  'douleur_abdominale',
  'entorse',
  'coupure_superficielle',
  'eruption_cutanee',
  'mal_de_dos',
  'nausees',
  'fievre_legere'
];

// Générateur de numéros de téléphone fictifs
function generatePhone() {
  const prefix = ['514', '438', '450'][Math.floor(Math.random() * 3)];
  const number = Math.floor(Math.random() * 9000000) + 1000000;
  return `${prefix}${number}`;
}

// Helper pour les requêtes HTTP
function request(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, config.apiUrl);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

// Actions de simulation
async function createPatient() {
  const priority = Math.random() > 0.4 ? 'P4' : 'P5';
  const reason = REASONS[Math.floor(Math.random() * REASONS.length)];
  
  console.log(`\n📝 Création patient ${priority} - ${reason}`);
  
  const result = await request('POST', '/api/patients', {
    hospitalCode: config.hospital,
    priority,
    reason
  });
  
  if (result.success) {
    console.log(`   ✅ Token: ${result.data.token}`);
    console.log(`   ⏱️  Temps estimé: ${result.data.estimatedWait} min`);
    console.log(`   📊 Position: #${result.data.position}`);
    return result.data;
  } else {
    console.log(`   ❌ Erreur: ${result.error}`);
    return null;
  }
}

async function activatePatient(token) {
  const phone = generatePhone();
  
  console.log(`\n📱 Activation patient ${token.substring(0, 6)}...`);
  
  const result = await request('POST', `/api/patients/${token}/activate`, { phone });
  
  if (result.success) {
    console.log(`   ✅ Activé avec téléphone ***-***-${phone.slice(-4)}`);
    return result.data;
  } else {
    console.log(`   ❌ Erreur: ${result.error}`);
    return null;
  }
}

async function notifyPatient(id) {
  console.log(`\n🔔 Notification patient #${id}`);
  
  const result = await request('POST', `/api/patients/${id}/notify`);
  
  if (result.success) {
    console.log(`   ✅ Notification envoyée`);
    return result.data;
  } else {
    console.log(`   ❌ Erreur: ${result.error}`);
    return null;
  }
}

async function markReturned(id) {
  console.log(`\n✅ Patient #${id} revenu`);
  
  const result = await request('POST', `/api/patients/${id}/return`);
  
  if (result.success) {
    console.log(`   ✅ Marqué comme revenu`);
    return result.data;
  } else {
    console.log(`   ❌ Erreur: ${result.error}`);
    return null;
  }
}

async function markNoShow(id) {
  console.log(`\n❌ Patient #${id} no-show`);
  
  const result = await request('POST', `/api/patients/${id}/noshow`);
  
  if (result.success) {
    console.log(`   ✅ Marqué comme no-show`);
    return result.data;
  } else {
    console.log(`   ❌ Erreur: ${result.error}`);
    return null;
  }
}

async function getQueueStats() {
  const result = await request('GET', `/api/hospitals/${config.hospital}/stats`);
  
  if (result.success) {
    const { realtime, daily } = result.data;
    console.log(`\n📊 Stats ${config.hospital}:`);
    console.log(`   En file: ${realtime.totalActive} (${realtime.waiting} en attente, ${realtime.notified} notifiés)`);
    console.log(`   Aujourd'hui: ${daily.returned} revenus, ${daily.noshow} no-shows`);
    if (daily.returnRate) {
      console.log(`   Taux de retour: ${daily.returnRate}%`);
    }
  }
}

// Simulation simple
async function runSimpleDemo() {
  console.log('🏥 FileSanté - Démonstration Simple');
  console.log(`   Hôpital: ${config.hospital}`);
  console.log(`   Patients: ${config.patientCount}`);
  console.log('='.repeat(50));
  
  const patients = [];
  
  // Créer les patients
  for (let i = 0; i < config.patientCount; i++) {
    const patient = await createPatient();
    if (patient) {
      patients.push(patient);
    }
    await sleep(config.interval);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📋 Activation des patients...');
  console.log('='.repeat(50));
  
  // Activer 80% des patients
  const toActivate = patients.slice(0, Math.floor(patients.length * 0.8));
  for (const patient of toActivate) {
    await activatePatient(patient.token);
    patient.activated = true;
    await sleep(config.interval);
  }
  
  await getQueueStats();
  
  console.log('\n' + '='.repeat(50));
  console.log('🔔 Notification des patients...');
  console.log('='.repeat(50));
  
  // Notifier les patients activés
  const activated = patients.filter(p => p.activated);
  for (const patient of activated.slice(0, 5)) {
    await notifyPatient(patient.id);
    patient.notified = true;
    await sleep(config.interval);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ Retour des patients...');
  console.log('='.repeat(50));
  
  // 90% reviennent, 10% no-show
  const notified = patients.filter(p => p.notified);
  for (const patient of notified) {
    if (Math.random() > 0.1) {
      await markReturned(patient.id);
    } else {
      await markNoShow(patient.id);
    }
    await sleep(config.interval);
  }
  
  await getQueueStats();
  
  console.log('\n' + '='.repeat(50));
  console.log('✨ Démonstration terminée!');
  console.log('='.repeat(50));
}

// Simulation temps réel
async function runRealtimeDemo() {
  console.log('🏥 FileSanté - Démonstration Temps Réel');
  console.log(`   Hôpital: ${config.hospital}`);
  console.log('   Mode: Simulation continue');
  console.log('   Ctrl+C pour arrêter');
  console.log('='.repeat(50));
  
  const activePatients = [];
  
  // Boucle infinie
  while (true) {
    const action = Math.random();
    
    if (action < 0.3 && activePatients.length < 20) {
      // Créer un nouveau patient
      const patient = await createPatient();
      if (patient) {
        activePatients.push({ ...patient, status: 'pending' });
      }
    } else if (action < 0.5) {
      // Activer un patient en pending
      const pending = activePatients.find(p => p.status === 'pending');
      if (pending) {
        const result = await activatePatient(pending.token);
        if (result) {
          pending.status = 'waiting';
        }
      }
    } else if (action < 0.7) {
      // Notifier un patient en waiting
      const waiting = activePatients.filter(p => p.status === 'waiting');
      if (waiting.length > 0) {
        const patient = waiting[0];
        const result = await notifyPatient(patient.id);
        if (result) {
          patient.status = 'notified';
        }
      }
    } else if (action < 0.9) {
      // Marquer un patient comme revenu
      const notified = activePatients.find(p => p.status === 'notified');
      if (notified) {
        if (Math.random() > 0.1) {
          await markReturned(notified.id);
        } else {
          await markNoShow(notified.id);
        }
        // Retirer de la liste active
        const idx = activePatients.indexOf(notified);
        activePatients.splice(idx, 1);
      }
    } else {
      // Afficher les stats
      await getQueueStats();
    }
    
    await sleep(config.interval);
  }
}

// Utilitaire sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Point d'entrée
async function main() {
  console.log('\n');
  
  // Vérifier la connexion à l'API
  try {
    const health = await request('GET', '/health');
    if (health.status !== 'healthy') {
      console.error('❌ API non disponible. Démarrez le serveur avec: npm start');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Impossible de contacter l\'API:', error.message);
    console.error('   Assurez-vous que le serveur est démarré: npm start');
    process.exit(1);
  }
  
  if (config.realtime) {
    await runRealtimeDemo();
  } else {
    await runSimpleDemo();
  }
}

// Gestion Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Arrêt de la démonstration');
  process.exit(0);
});

main().catch(error => {
  console.error('Erreur:', error);
  process.exit(1);
});
