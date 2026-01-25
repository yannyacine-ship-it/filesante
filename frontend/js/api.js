/**
 * FileSanté - Service API Frontend (CORRIGÉ)
 * Gère toutes les communications avec le backend
 */

const FileSanteAPI = (function() {
  // Configuration
  const config = {
    // CORRIGÉ: URL explicite pour Railway (plus fiable)
    baseUrl: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:3000/api'
      : 'https://filesante-api-production-caf7.up.railway.app/api',
    wsUrl: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'ws://localhost:3000/ws'
      : 'wss://filesante-api-production-caf7.up.railway.app/ws'
  };

  // Token storage
  let authToken = localStorage.getItem('filesante_token');
  let refreshToken = localStorage.getItem('filesante_refresh');
  let currentUser = JSON.parse(localStorage.getItem('filesante_user') || 'null');

  // WebSocket connection
  let ws = null;
  let wsReconnectInterval = null;
  let wsCallbacks = {};

  /**
   * Helper pour les requêtes HTTP
   */
  async function request(method, endpoint, data = null, requireAuth = true) {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (requireAuth && authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const options = {
      method,
      headers
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${config.baseUrl}${endpoint}`, options);

      // CORRIGÉ: Gérer les erreurs HTTP avant de parser JSON
      if (!response.ok) {
        // Token expiré ou invalide
        if (response.status === 401) {
          // Effacer le token invalide
          logout();
          return {
            success: false,
            error: 'Session expirée. Veuillez vous reconnecter.'
          };
        }

        // Autres erreurs
        let errorMessage = 'Erreur serveur';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          // Ignore si pas de JSON
        }

        return {
          success: false,
          error: errorMessage
        };
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('API Error:', error);

      // CORRIGÉ: Message d'erreur plus clair
      if (error.name === 'TypeError' && error.message.includes('JSON')) {
        return {
          success: false,
          error: 'Erreur de communication avec le serveur'
        };
      }

      return {
        success: false,
        error: 'Erreur de connexion au serveur'
      };
    }
  }

  /**
   * Rafraîchir le token d'authentification
   */
  async function refreshAuthToken() {
    try {
      const response = await fetch(`${config.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      if (!response.ok) {
        throw new Error('Refresh failed');
      }

      const result = await response.json();

      if (result.success) {
        authToken = result.data.token;
        localStorage.setItem('filesante_token', authToken);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Token refresh failed:', error);
    }

    // Échec - déconnecter
    logout();
    return false;
  }

  // ==========================================
  // AUTHENTIFICATION
  // ==========================================

  async function login(email, password) {
    const result = await request('POST', '/auth/login', { email, password }, false);

    if (result.success) {
      authToken = result.data.token;
      currentUser = result.data.user;
      localStorage.setItem('filesante_token', authToken);
      localStorage.setItem('filesante_user', JSON.stringify(currentUser));

      // CORRIGÉ: Gérer le refresh token correctement
      if (result.data.refreshToken) {
        refreshToken = result.data.refreshToken;
        localStorage.setItem('filesante_refresh', refreshToken);
      }
    }

    return result;
  }

  function logout() {
    authToken = null;
    refreshToken = null;
    currentUser = null;
    localStorage.removeItem('filesante_token');
    localStorage.removeItem('filesante_refresh');
    localStorage.removeItem('filesante_user');

    if (ws) {
      ws.close();
    }

    // Rediriger vers login
    if (!window.location.pathname.includes('login')) {
      window.location.href = 'login.html';
    }
  }

  function isAuthenticated() {
    return !!authToken;
  }

  function getUser() {
    return currentUser;
  }

  async function getProfile() {
    return await request('GET', '/auth/me');
  }

  async function changePassword(currentPassword, newPassword) {
    return await request('PUT', '/auth/password', { currentPassword, newPassword });
  }

  // ==========================================
  // PATIENTS
  // ==========================================

  async function createPatient(hospitalCode, priority, reason = null) {
    return await request('POST', '/patients', { hospitalCode, priority, reason });
  }

  async function activatePatient(token, phone) {
    return await request('POST', `/patients/${token}/activate`, { phone }, false);
  }

  async function getPatient(token) {
    return await request('GET', `/patients/${token}`, null, false);
  }

  async function notifyPatient(patientId) {
    return await request('POST', `/patients/${patientId}/notify`);
  }

  async function markReturned(patientId) {
    return await request('POST', `/patients/${patientId}/return`);
  }

  async function markNoShow(patientId) {
    return await request('POST', `/patients/${patientId}/noshow`);
  }

  async function cancelPatient(patientId) {
    return await request('POST', `/patients/${patientId}/cancel`);
  }

  async function reportAlert(token, alertType, message = null) {
    return await request('POST', `/patients/${token}/alert`, { alertType, message }, false);
  }

  // ==========================================
  // HÔPITAUX
  // ==========================================

  async function getHospitals() {
    return await request('GET', '/hospitals', null, false);
  }

  async function getHospital(code) {
    return await request('GET', `/hospitals/${code}`, null, false);
  }

  async function getQueue(hospitalCode, options = {}) {
    const params = new URLSearchParams();
    if (options.status) params.append('status', options.status);
    if (options.priority) params.append('priority', options.priority);
    if (options.limit) params.append('limit', options.limit);

    const query = params.toString() ? `?${params.toString()}` : '';
    return await request('GET', `/hospitals/${hospitalCode}/queue${query}`);
  }

  async function getStats(hospitalCode) {
    return await request('GET', `/hospitals/${hospitalCode}/stats`);
  }

  async function getAlerts(hospitalCode) {
    return await request('GET', `/hospitals/${hospitalCode}/alerts`);
  }

  async function getHistory(hospitalCode, days = 30) {
    return await request('GET', `/hospitals/${hospitalCode}/history?days=${days}`);
  }

  // ==========================================
  // ADMIN
  // ==========================================

  async function getUsers(options = {}) {
    const params = new URLSearchParams();
    if (options.hospitalCode) params.append('hospitalCode', options.hospitalCode);
    if (options.role) params.append('role', options.role);

    const query = params.toString() ? `?${params.toString()}` : '';
    return await request('GET', `/auth/users${query}`);
  }

  async function createUser(userData) {
    return await request('POST', '/auth/register', userData);
  }

  async function runJob(jobName) {
    return await request('POST', `/admin/jobs/${jobName}`);
  }

  async function getAdminStats() {
    return await request('GET', '/admin/stats');
  }

  // ==========================================
  // WEBSOCKET
  // ==========================================

  function connectWebSocket(hospitalCode, type = 'dashboard', patientToken = null) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }

    let url = `${config.wsUrl}?hospital=${hospitalCode}&type=${type}`;
    if (patientToken) {
      url += `&token=${patientToken}`;
    }

    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('WebSocket connecté');
      if (wsReconnectInterval) {
        clearInterval(wsReconnectInterval);
        wsReconnectInterval = null;
      }
      if (wsCallbacks.onConnect) {
        wsCallbacks.onConnect();
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (wsCallbacks.onMessage) {
          wsCallbacks.onMessage(data);
        }

        // Callbacks spécifiques par type
        if (wsCallbacks[data.type]) {
          wsCallbacks[data.type](data.data);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket déconnecté');
      if (wsCallbacks.onDisconnect) {
        wsCallbacks.onDisconnect();
      }

      // Auto-reconnexion
      if (!wsReconnectInterval) {
        wsReconnectInterval = setInterval(() => {
          console.log('Tentative de reconnexion WebSocket...');
          connectWebSocket(hospitalCode, type, patientToken);
        }, 5000);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return ws;
  }

  function onWebSocketEvent(eventType, callback) {
    wsCallbacks[eventType] = callback;
  }

  function disconnectWebSocket() {
    if (wsReconnectInterval) {
      clearInterval(wsReconnectInterval);
      wsReconnectInterval = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  // ==========================================
  // UTILITAIRES
  // ==========================================

  function formatWaitTime(minutes) {
    if (minutes < 60) {
      return `${Math.round(minutes)} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  }

  function formatPhone(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0,3)}) ${cleaned.slice(3,6)}-${cleaned.slice(6)}`;
    }
    return phone;
  }

  function getStatusLabel(status) {
    const labels = {
      pending: 'En attente d\'activation',
      waiting: 'En file d\'attente',
      notified: 'Notifié',
      returned: 'Revenu',
      noshow: 'Non présenté',
      cancelled: 'Annulé'
    };
    return labels[status] || status;
  }

  function getStatusColor(status) {
    const colors = {
      pending: 'gray',
      waiting: 'blue',
      notified: 'yellow',
      returned: 'green',
      noshow: 'red',
      cancelled: 'gray'
    };
    return colors[status] || 'gray';
  }

  function getPriorityLabel(priority) {
    return priority === 'P4' ? 'Priorité 4 - Semi-urgent' : 'Priorité 5 - Non-urgent';
  }

  // ==========================================
  // EXPORT PUBLIC API
  // ==========================================

  return {
    // Config
    config,

    // Auth
    login,
    logout,
    isAuthenticated,
    getUser,
    getProfile,
    changePassword,

    // Patients
    createPatient,
    activatePatient,
    getPatient,
    notifyPatient,
    markReturned,
    markNoShow,
    cancelPatient,
    reportAlert,

    // Hospitals
    getHospitals,
    getHospital,
    getQueue,
    getStats,
    getAlerts,
    getHistory,

    // Admin
    getUsers,
    createUser,
    runJob,
    getAdminStats,

    // WebSocket
    connectWebSocket,
    onWebSocketEvent,
    disconnectWebSocket,

    // Utils
    formatWaitTime,
    formatPhone,
    getStatusLabel,
    getStatusColor,
    getPriorityLabel
  };
})();

// Export pour compatibilité
if (typeof window !== 'undefined') {
  window.FileSanteAPI = FileSanteAPI;
}
