# 🚀 Guide de Déploiement FileSanté

Ce guide vous accompagne pas à pas pour déployer FileSanté en production.

## 📋 Table des matières

1. [Option A: Render.com (Recommandé)](#option-a-rendercom-recommandé)
2. [Option B: Railway.app](#option-b-railwayapp)
3. [Option C: DigitalOcean](#option-c-digitalocean)
4. [Configuration Twilio](#configuration-twilio)
5. [Domaine personnalisé](#domaine-personnalisé)
6. [Vérification post-déploiement](#vérification-post-déploiement)

---

## Option A: Render.com (Recommandé)

### Pourquoi Render?
- ✅ Gratuit pour les démos (750h/mois)
- ✅ PostgreSQL gratuit inclus (256MB)
- ✅ Déploiement automatique depuis GitHub
- ✅ SSL automatique
- ✅ Simple à configurer

### Étape 1: Préparer le code

```bash
# 1. Créer un repo GitHub
git init
git add .
git commit -m "Initial commit - FileSanté"

# 2. Créer le repo sur GitHub et pusher
gh repo create filesante --public
git push -u origin main
```

### Étape 2: Créer un compte Render

1. Aller sur [render.com](https://render.com)
2. S'inscrire avec GitHub
3. Autoriser l'accès au repo `filesante`

### Étape 3: Déployer la base de données

1. Dashboard Render → **New** → **PostgreSQL**
2. Configuration:
   - **Name**: `filesante-db`
   - **Region**: `Ohio` (plus proche de Montréal)
   - **Plan**: `Free`
3. Cliquer **Create Database**
4. **Copier** l'`Internal Database URL` (commençant par `postgres://...`)

### Étape 4: Déployer l'API Backend

1. Dashboard Render → **New** → **Web Service**
2. Connecter le repo GitHub `filesante`
3. Configuration:
   - **Name**: `filesante-api`
   - **Region**: `Ohio`
   - **Branch**: `main`
   - **Root Directory**: `` (vide)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. **Environment Variables** (cliquer "Add Environment Variable"):

   | Key | Value |
   |-----|-------|
   | `NODE_ENV` | `production` |
   | `PORT` | `3000` |
   | `DATABASE_URL` | `[coller l'URL de l'étape 3]` |
   | `JWT_SECRET` | `[générer: openssl rand -hex 32]` |
   | `TWILIO_ACCOUNT_SID` | `[voir section Twilio]` |
   | `TWILIO_AUTH_TOKEN` | `[voir section Twilio]` |
   | `TWILIO_PHONE_NUMBER` | `[voir section Twilio]` |

5. Cliquer **Create Web Service**
6. Attendre le déploiement (~3-5 minutes)
7. Noter l'URL: `https://filesante-api.onrender.com`

### Étape 5: Déployer le Frontend

1. Dashboard Render → **New** → **Static Site**
2. Connecter le même repo GitHub
3. Configuration:
   - **Name**: `filesante`
   - **Branch**: `main`
   - **Root Directory**: `frontend`
   - **Build Command**: `` (vide)
   - **Publish Directory**: `.`
4. **Redirects/Rewrites** → Add Rule:
   ```
   Source: /api/*
   Destination: https://filesante-api.onrender.com/api/*
   Action: Rewrite
   ```
   ```
   Source: /*
   Destination: /index.html
   Action: Rewrite
   ```
5. Cliquer **Create Static Site**
6. Votre app est live! 🎉

### Étape 6: Exécuter les migrations

```bash
# Ouvrir un shell dans le service API
# Dashboard → filesante-api → Shell

npm run migrate
npm run seed
```

---

## Option B: Railway.app

### Pourquoi Railway?
- ✅ Interface très simple
- ✅ $5/mois de crédit gratuit
- ✅ PostgreSQL et Redis inclus
- ⚠️ Moins généreux que Render en gratuit

### Déploiement rapide

1. Aller sur [railway.app](https://railway.app)
2. **New Project** → **Deploy from GitHub repo**
3. Sélectionner le repo `filesante`
4. Railway détecte automatiquement Node.js
5. **Add Database** → **PostgreSQL**
6. Ajouter les variables d'environnement (même liste que Render)
7. **Deploy** 🚀

---

## Option C: DigitalOcean

### Pourquoi DigitalOcean?
- ✅ Plus de contrôle
- ✅ Bon pour production réelle
- ⚠️ Payant (~$12/mois minimum)

### App Platform

1. [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. **Create** → **Apps**
3. Connecter GitHub
4. Configurer les services (API + Frontend)
5. Ajouter une base de données PostgreSQL
6. **Create Resources**

---

## Configuration Twilio

### Étape 1: Créer un compte Twilio

1. Aller sur [twilio.com](https://www.twilio.com/try-twilio)
2. S'inscrire (gratuit, $15 de crédit offert)
3. Vérifier votre email et numéro de téléphone

### Étape 2: Obtenir les credentials

1. **Console** → Copier:
   - **Account SID**: `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   - **Auth Token**: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### Étape 3: Obtenir un numéro de téléphone

1. **Phone Numbers** → **Buy a Number**
2. Filtrer par:
   - **Country**: Canada
   - **Capabilities**: SMS
3. Acheter un numéro (~$1.15/mois)
4. Copier le numéro: `+15141234567`

### Étape 4: Configurer le webhook (optionnel)

1. **Phone Numbers** → Votre numéro → **Configure**
2. **Messaging** → **A MESSAGE COMES IN**:
   - Webhook URL: `https://votre-api.onrender.com/webhooks/twilio/status`
   - HTTP POST

### Coûts Twilio

| Service | Prix |
|---------|------|
| Numéro canadien | ~$1.15/mois |
| SMS sortant (Canada) | ~$0.0075/SMS |
| SMS entrant | Gratuit |

**Budget démo**: $15 crédit gratuit = ~2000 SMS

---

## Domaine personnalisé

### Option gratuite: sous-domaine Render
- `filesante.onrender.com` ✅ Inclus

### Option payante: domaine propre

1. Acheter un domaine (ex: `filesante.ca` ~$15/an sur Namecheap)
2. Dans Render → **Settings** → **Custom Domains**
3. Ajouter `filesante.ca`
4. Configurer DNS:
   ```
   Type: CNAME
   Name: @
   Value: filesante.onrender.com
   ```
5. Attendre la propagation DNS (~24h)
6. SSL automatique 🔒

---

## Vérification post-déploiement

### Checklist

```bash
# 1. Health check API
curl https://filesante-api.onrender.com/health
# Attendu: {"status":"healthy",...}

# 2. Test login
curl -X POST https://filesante-api.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@filesante.ca","password":"admin123"}'
# Attendu: {"success":true,"data":{"token":"..."}}

# 3. Test création patient
TOKEN="[token du login]"
curl -X POST https://filesante-api.onrender.com/api/patients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"hospitalCode":"HMR","priority":"P4"}'
# Attendu: {"success":true,"data":{"token":"ABC123",...}}
```

### Test SMS (si Twilio configuré)

1. Créer un patient via le dashboard
2. Activer avec votre vrai numéro
3. Vérifier la réception du SMS de confirmation

### Monitoring

- **Render Logs**: Dashboard → Service → Logs
- **Métriques**: Dashboard → Service → Metrics
- **Alertes**: Settings → Notifications

---

## 🆘 Troubleshooting

### Erreur "Database connection failed"
- Vérifier `DATABASE_URL` dans les variables d'environnement
- S'assurer que la base de données est démarrée

### Erreur "JWT_SECRET not set"
- Ajouter `JWT_SECRET` dans les variables d'environnement
- Générer avec: `openssl rand -hex 32`

### SMS non reçus
- Vérifier les credentials Twilio
- Vérifier que le numéro est un vrai numéro (pas de numéros de test en production)
- Consulter les logs Twilio: Console → Monitor → Logs

### Frontend ne communique pas avec l'API
- Vérifier les rewrites dans la configuration static site
- Vérifier que l'URL de l'API est correcte dans `js/api.js`

---

## 📞 Support

Pour toute question:
- Ouvrir une issue sur GitHub
- Email: contact@filesante.ca

---

**Temps estimé de déploiement**: 30-45 minutes
