/**
 * Service WebSocket - Mises à jour temps réel
 */

const WebSocket = require('ws');
const logger = require('../utils/logger');

let wss = null;
const clients = new Map(); // hospitalCode -> Set of WebSocket clients

/**
 * Initialise le serveur WebSocket
 */
function initWebSocket(server) {
  wss = new WebSocket.Server({ 
    server,
    path: '/ws'
  });
  
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'ws://localhost');
    const hospitalCode = url.searchParams.get('hospital');
    const clientType = url.searchParams.get('type') || 'dashboard';
    const patientToken = url.searchParams.get('token');
    
    ws.hospitalCode = hospitalCode;
    ws.clientType = clientType;
    ws.patientToken = patientToken;
    ws.isAlive = true;
    
    if (hospitalCode) {
      if (!clients.has(hospitalCode)) {
        clients.set(hospitalCode, new Set());
      }
      clients.get(hospitalCode).add(ws);
      logger.debug('WebSocket connecté', { hospitalCode, clientType });
    }
    
    ws.on('pong', () => { ws.isAlive = true; });
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        handleMessage(ws, data);
      } catch (error) {
        logger.error('Erreur parsing message WebSocket', error);
      }
    });
    
    ws.on('close', () => {
      if (hospitalCode && clients.has(hospitalCode)) {
        clients.get(hospitalCode).delete(ws);
      }
    });
    
    ws.on('error', (error) => {
      logger.error('Erreur WebSocket', error);
    });
    
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connexion établie',
      hospitalCode,
      timestamp: new Date().toISOString()
    }));
  });
  
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  
  wss.on('close', () => clearInterval(pingInterval));
  
  logger.info('Serveur WebSocket initialisé sur /ws');
  return wss;
}

function handleMessage(ws, data) {
  switch (data.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;
    case 'subscribe':
      if (data.hospitalCode && data.hospitalCode !== ws.hospitalCode) {
        if (ws.hospitalCode && clients.has(ws.hospitalCode)) {
          clients.get(ws.hospitalCode).delete(ws);
        }
        ws.hospitalCode = data.hospitalCode;
        if (!clients.has(data.hospitalCode)) {
          clients.set(data.hospitalCode, new Set());
        }
        clients.get(data.hospitalCode).add(ws);
      }
      break;
  }
}

function broadcast(hospitalCode, message) {
  if (!clients.has(hospitalCode)) return;
  const payload = JSON.stringify({ ...message, timestamp: new Date().toISOString() });
  clients.get(hospitalCode).forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

function broadcastToPatient(patientToken, message) {
  if (!wss) return;
  const payload = JSON.stringify({ ...message, timestamp: new Date().toISOString() });
  wss.clients.forEach((ws) => {
    if (ws.patientToken === patientToken && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

const WebSocketService = {
  init: initWebSocket,
  
  notifyPatientCreated(hospitalCode, patient) {
    broadcast(hospitalCode, {
      type: 'patient_created',
      data: {
        id: patient.id,
        token: patient.token,
        priority: patient.priority,
        position: patient.position_in_queue,
        estimatedWait: patient.estimated_wait_minutes
      }
    });
  },
  
  notifyPatientActivated(hospitalCode, patient) {
    broadcast(hospitalCode, {
      type: 'patient_activated',
      data: { id: patient.id, token: patient.token, status: 'waiting' }
    });
  },
  
  notifyPatientNotified(hospitalCode, patient) {
    broadcast(hospitalCode, {
      type: 'patient_notified',
      data: { id: patient.id, token: patient.token, status: 'notified' }
    });
    broadcastToPatient(patient.token, {
      type: 'notification',
      data: { message: 'C\'est bientôt votre tour!', estimatedMinutes: 45 }
    });
  },
  
  notifyPatientReturned(hospitalCode, patient) {
    broadcast(hospitalCode, {
      type: 'patient_returned',
      data: { id: patient.id, token: patient.token, status: 'returned' }
    });
  },
  
  notifyPatientNoShow(hospitalCode, patient) {
    broadcast(hospitalCode, {
      type: 'patient_noshow',
      data: { id: patient.id, token: patient.token, status: 'noshow' }
    });
  },
  
  notifyAlert(hospitalCode, patient, alertType) {
    broadcast(hospitalCode, {
      type: 'alert',
      data: {
        id: patient.id,
        token: patient.token,
        alertType,
        priority: patient.priority,
        message: `Patient ${patient.priority} a signalé: ${alertType}`
      }
    });
  },
  
  notifyQueueUpdate(hospitalCode, stats) {
    broadcast(hospitalCode, { type: 'queue_update', data: stats });
  },
  
  notifyPatientPosition(patientToken, position, estimatedWait) {
    broadcastToPatient(patientToken, {
      type: 'position_update',
      data: { position, estimatedWait }
    });
  },
  
  getConnectedClients(hospitalCode) {
    return clients.has(hospitalCode) ? clients.get(hospitalCode).size : 0;
  }
};

module.exports = WebSocketService;
