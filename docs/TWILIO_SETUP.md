# 📱 Guide de Configuration Twilio pour FileSanté

Ce guide vous accompagne étape par étape pour configurer l'envoi de SMS avec Twilio.

## 📋 Sommaire

1. [Création du compte](#1-création-du-compte)
2. [Configuration du projet](#2-configuration-du-projet)
3. [Achat d'un numéro](#3-achat-dun-numéro)
4. [Configuration des webhooks](#4-configuration-des-webhooks)
5. [Test de l'intégration](#5-test-de-lintégration)
6. [Mode production](#6-mode-production)
7. [Optimisation des coûts](#7-optimisation-des-coûts)

---

## 1. Création du compte

### Étape 1.1: Inscription

1. Aller sur **[twilio.com/try-twilio](https://www.twilio.com/try-twilio)**

2. Remplir le formulaire:
   - Email professionnel
   - Mot de passe fort
   - Prénom et nom

3. **Vérification email**: Cliquer sur le lien reçu par email

4. **Vérification téléphone**: 
   - Entrer votre numéro personnel
   - Recevoir et entrer le code SMS

### Étape 1.2: Configuration initiale

Après inscription, Twilio pose quelques questions:

```
❓ Which Twilio product are you here to use?
→ Sélectionner: "SMS"

❓ What do you plan to build with Twilio?
→ Sélectionner: "Alerts & Notifications"

❓ How do you want to build with Twilio?
→ Sélectionner: "With code"

❓ What is your preferred coding language?
→ Sélectionner: "Node.js"
```

### Étape 1.3: Récupérer les credentials

1. Aller sur **[console.twilio.com](https://console.twilio.com)**

2. Sur le dashboard, vous verrez:
   ```
   Account SID: ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   Auth Token:  xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (cliquer pour révéler)
   ```

3. **IMPORTANT**: Copier ces valeurs dans un endroit sécurisé

---

## 2. Configuration du projet

### Variables d'environnement

Ajouter dans votre fichier `.env`:

```env
# Twilio Configuration
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+15141234567
```

### Vérification

```javascript
// Test dans Node.js
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

console.log('Account SID:', accountSid); // Doit commencer par "AC"
console.log('Auth Token:', authToken ? '✓ Configuré' : '✗ Manquant');
```

---

## 3. Achat d'un numéro

### Étape 3.1: Rechercher un numéro canadien

1. Aller sur **Console** → **Phone Numbers** → **Buy a Number**

2. Filtrer:
   - **Country**: Canada 🇨🇦
   - **Capabilities**: ☑️ SMS
   - **Number Type**: Local

3. Choisir un indicatif régional:
   - `514` - Montréal
   - `438` - Montréal (nouveau)
   - `450` - Rive-Sud/Rive-Nord

### Étape 3.2: Acheter

1. Cliquer **Buy** sur le numéro souhaité
2. Confirmer l'achat (~$1.15 CAD/mois)
3. Le numéro apparaît dans **Active Numbers**

### Étape 3.3: Format du numéro

Twilio utilise le format E.164:

```
Format correct:  +15141234567
Format incorrect: 514-123-4567
Format incorrect: (514) 123-4567
```

---

## 4. Configuration des webhooks

Les webhooks permettent de recevoir les confirmations de livraison SMS.

### Étape 4.1: Configurer le status callback

1. **Console** → **Phone Numbers** → **Manage** → **Active Numbers**

2. Cliquer sur votre numéro

3. Dans **Messaging Configuration**:
   ```
   A MESSAGE COMES IN:
   - Webhook URL: https://votre-api.onrender.com/webhooks/twilio/status
   - HTTP Method: POST
   ```

4. **Save Configuration**

### Étape 4.2: Ajouter le callback dans le code

Le backend FileSanté inclut déjà le endpoint `/webhooks/twilio/status`. 
Il traite automatiquement les statuts: `sent`, `delivered`, `failed`.

---

## 5. Test de l'intégration

### Test en mode développement

Le backend simule les SMS si Twilio n'est pas configuré:

```bash
# Démarrer le backend
npm run dev

# Logs attendus:
# SMS simulé (dev mode) {to: "***4567", message: "FileSanté: Inscription..."}
```

### Test avec Twilio (compte trial)

⚠️ **Limitation compte trial**: Vous ne pouvez envoyer qu'aux numéros vérifiés.

1. **Console** → **Phone Numbers** → **Verified Caller IDs**
2. Ajouter votre numéro personnel
3. Tester l'envoi

### Test manuel avec cURL

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@filesante.ca","password":"admin123"}' \
  | jq -r '.data.token')

# 2. Créer un patient
PATIENT=$(curl -s -X POST http://localhost:3000/api/patients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"hospitalCode":"HMR","priority":"P4"}')

echo $PATIENT | jq

# 3. Activer avec un vrai numéro
TOKEN_PATIENT=$(echo $PATIENT | jq -r '.data.token')
curl -X POST http://localhost:3000/api/patients/$TOKEN_PATIENT/activate \
  -H "Content-Type: application/json" \
  -d '{"phone":"5141234567"}'

# → SMS de confirmation envoyé!
```

### Vérifier les logs Twilio

1. **Console** → **Monitor** → **Logs** → **Messaging**
2. Vous verrez chaque SMS avec son statut

---

## 6. Mode production

### Passer de Trial à Production

1. **Console** → **Billing** → **Upgrade**
2. Ajouter une carte de crédit
3. Les limitations sont levées:
   - Envoi à tous les numéros
   - Plus de mention "Sent from Twilio trial"

### Configuration recommandée

```env
# Production
NODE_ENV=production
TWILIO_ACCOUNT_SID=ACxxxx...
TWILIO_AUTH_TOKEN=xxxxx...
TWILIO_PHONE_NUMBER=+15141234567
```

### Sécurité

- **Ne jamais** commiter les credentials Twilio
- Utiliser les variables d'environnement
- Activer l'authentification à 2 facteurs sur Twilio
- Configurer des alertes de facturation

---

## 7. Optimisation des coûts

### Tarifs Twilio Canada (2024)

| Service | Prix |
|---------|------|
| Numéro local | $1.15/mois |
| SMS sortant | $0.0075/SMS |
| SMS entrant | $0.0075/SMS |

### Estimation pour FileSanté

| Scénario | Patients/jour | SMS/patient | Coût mensuel |
|----------|---------------|-------------|--------------|
| Petit hôpital | 20 | 2 | ~$9 |
| Moyen | 50 | 2 | ~$22 |
| Grand | 100 | 2 | ~$45 |

### Réduire les coûts

1. **Limiter les SMS**:
   - 1 SMS confirmation + 1 SMS notification = 2 SMS/patient
   - Éviter les rappels inutiles

2. **Utiliser les templates courts**:
   - SMS < 160 caractères = 1 segment
   - SMS > 160 caractères = 2+ segments (coût x2)

3. **Désactiver les SMS de test**:
   ```env
   # En dev, les SMS sont simulés (gratuit)
   NODE_ENV=development
   ```

### Templates SMS optimisés (< 160 caractères)

```javascript
// Confirmation (155 caractères)
`FileSanté: Inscription ${hospital}. Position #${pos}. ~${time}h. SMS 45min avant.`

// Notification (142 caractères)
`FileSanté: Votre tour approche! Dirigez-vous vers ${hospital}. ~45min avant passage.`
```

---

## 🔧 Troubleshooting

### Erreur "Invalid phone number"

```
❌ Error: The 'To' number +1514123456 is not a valid phone number
```

**Solution**: Vérifier le format E.164 (`+15141234567`)

### Erreur "Unverified destination"

```
❌ Error: The number +15141234567 is unverified
```

**Solution**: 
- Compte trial → Vérifier le numéro dans Console
- Ou passer en mode production

### Erreur "Authentication failed"

```
❌ Error: Authenticate
```

**Solution**: Vérifier `TWILIO_ACCOUNT_SID` et `TWILIO_AUTH_TOKEN`

### SMS non reçu

1. Vérifier les logs Twilio Console
2. Vérifier que le numéro n'est pas sur liste noire
3. Vérifier que le compte n'est pas suspendu

---

## 📊 Monitoring

### Dashboard Twilio

- **Usage** → Voir la consommation
- **Logs** → Voir chaque SMS
- **Alerts** → Configurer des alertes

### Alertes recommandées

1. **Dépenses** → Alerte si > $50/mois
2. **Échecs** → Alerte si taux d'échec > 5%

---

## 🔒 Sécurité

### Best practices

1. **Ne jamais exposer les credentials** dans le code
2. **Utiliser des variables d'environnement**
3. **Activer 2FA** sur le compte Twilio
4. **Restreindre les permissions** API
5. **Monitorer les dépenses**

### Variables d'environnement sécurisées

```bash
# ✅ Correct: utiliser .env
TWILIO_AUTH_TOKEN=xxx

# ❌ Incorrect: dans le code
const authToken = "xxx";
```

---

## 📞 Support Twilio

- **Documentation**: [twilio.com/docs](https://www.twilio.com/docs)
- **Support**: [twilio.com/help](https://www.twilio.com/help)
- **Status**: [status.twilio.com](https://status.twilio.com)

---

**Temps de configuration estimé**: 15-20 minutes
