# 🖥️ Déploiement 100% Ligne de Commande

Ce guide permet de déployer FileSanté entièrement depuis le terminal, sans jamais ouvrir un navigateur web.

## 📋 Prérequis à installer

```bash
# macOS (avec Homebrew)
brew install git gh jq
npm install -g @railway/cli twilio-cli

# Linux (Ubuntu/Debian)
sudo apt update && sudo apt install -y git jq curl
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install gh
npm install -g @railway/cli twilio-cli

# Windows (avec Chocolatey)
choco install git gh jq
npm install -g @railway/cli twilio-cli
```

---

## 🚀 Déploiement Automatique (1 commande)

```bash
cd filesante-backend
chmod +x deploy.sh
./deploy.sh
```

Le script fait tout automatiquement !

---

## 🔧 Déploiement Manuel (étape par étape)

### Étape 1: GitHub

```bash
# Connexion GitHub (une seule fois)
gh auth login

# Créer le repository
gh repo create filesante --public --description "FileSanté - File virtuelle urgences"

# Initialiser et pousser le code
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/$(gh api user -q .login)/filesante.git
git branch -M main
git push -u origin main
```

### Étape 2: Railway (Hébergement)

```bash
# Connexion Railway (une seule fois)
railway login

# Créer le projet
railway init --name filesante

# Ajouter PostgreSQL
railway add --plugin postgresql

# Configurer les variables
railway variables set NODE_ENV=production
railway variables set JWT_SECRET=$(openssl rand -hex 32)
railway variables set PORT=3000

# Déployer
railway up

# Obtenir l'URL
railway domain
```

### Étape 3: Base de données

```bash
# Exécuter les migrations
railway run npm run migrate

# Insérer les données de démo
railway run npm run seed
```

### Étape 4: Twilio (SMS) - Optionnel

```bash
# Connexion Twilio
twilio login

# Voir les numéros disponibles au Canada
twilio api:core:available-phone-numbers:local:list --country-code CA --sms-enabled --limit 5

# Acheter un numéro (remplacer +15141234567 par celui choisi)
twilio api:core:incoming-phone-numbers:create --phone-number=+15141234567

# Récupérer les credentials (depuis le terminal)
twilio profiles:list

# Configurer dans Railway
railway variables set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxx
railway variables set TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxx
railway variables set TWILIO_PHONE_NUMBER=+15141234567

# Redéployer
railway up
```

### Étape 5: Domaine personnalisé - Optionnel

```bash
# Ajouter un domaine personnalisé
railway domain filesante.ca

# Configuration DNS (chez ton registraire via leur CLI ou API)
# Exemple avec Cloudflare CLI:
cloudflare dns create filesante.ca CNAME @ your-app.railway.app
```

---

## 🔍 Commandes Utiles

```bash
# Voir les logs en temps réel
railway logs -f

# Statut du déploiement
railway status

# Variables d'environnement
railway variables

# Shell dans le conteneur
railway run bash

# Ouvrir l'app dans le navigateur
railway open

# Redéployer après modification
git add . && git commit -m "update" && git push && railway up
```

---

## 🧪 Tester l'API (CLI)

```bash
# Health check
curl https://your-app.railway.app/health | jq

# Login et récupérer token
TOKEN=$(curl -s -X POST https://your-app.railway.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@filesante.ca","password":"admin123"}' | jq -r '.data.token')

echo "Token: $TOKEN"

# Créer un patient
curl -X POST https://your-app.railway.app/api/patients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"hospitalCode":"HMR","priority":"P4"}' | jq

# Voir la file d'attente
curl https://your-app.railway.app/api/hospitals/HMR/queue \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## 🌐 Acheter un Domaine (CLI)

### Option A: Cloudflare (recommandé)

```bash
# Installer Cloudflare CLI
npm install -g cloudflare-cli

# Connexion
cloudflare login

# Vérifier disponibilité
cloudflare domain check filesante.ca

# Acheter (nécessite compte avec paiement configuré)
cloudflare domain register filesante.ca
```

### Option B: Namecheap API

```bash
# Nécessite API key depuis namecheap.com/settings/tools/apiaccess
curl "https://api.namecheap.com/xml.response" \
  --data "ApiUser=YOUR_USER" \
  --data "ApiKey=YOUR_API_KEY" \
  --data "UserName=YOUR_USER" \
  --data "Command=namecheap.domains.check" \
  --data "DomainList=filesante.ca" \
  --data "ClientIp=YOUR_IP"
```

### Option C: Porkbun API

```bash
# Vérifier disponibilité
curl -X POST https://porkbun.com/api/json/v3/domain/check \
  -H "Content-Type: application/json" \
  -d '{"apikey":"YOUR_API_KEY","secretapikey":"YOUR_SECRET","domain":"filesante.ca"}'
```

---

## 📊 Monitoring (CLI)

```bash
# Logs Railway
railway logs --tail 100

# Métriques (si datadog configuré)
# railway variables set DD_API_KEY=xxx
# Les métriques apparaissent dans datadog

# Test de charge simple
for i in {1..10}; do
  curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" https://your-app.railway.app/health
done
```

---

## 🔒 Backup Base de Données (CLI)

```bash
# Récupérer l'URL de la DB
railway variables | grep DATABASE_URL

# Backup (depuis ta machine locale)
pg_dump "postgres://..." > backup_$(date +%Y%m%d).sql

# Restore
psql "postgres://..." < backup_20240115.sql
```

---

## ❓ Troubleshooting

### "railway: command not found"
```bash
npm install -g @railway/cli
# ou
curl -fsSL https://railway.app/install.sh | sh
```

### "gh: command not found"
```bash
# macOS
brew install gh

# Linux
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
sudo apt install gh
```

### "Permission denied"
```bash
chmod +x deploy.sh
./deploy.sh
```

### Déploiement bloqué
```bash
railway logs  # Voir les erreurs
railway status  # Voir le statut
railway up --verbose  # Déployer avec détails
```

---

## 🎉 Résultat Final

Après le déploiement, tu auras :

```
https://filesante-production.up.railway.app/           # Landing page
https://filesante-production.up.railway.app/login.html # Connexion
https://filesante-production.up.railway.app/dashboard.html # Dashboard
https://filesante-production.up.railway.app/health     # API Health

# Ou avec domaine personnalisé:
https://filesante.ca/
https://filesante.ca/login.html
https://filesante.ca/dashboard.html
```

**Tout ça sans jamais ouvrir un navigateur !** 🖥️
