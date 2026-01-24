#!/bin/bash

# ============================================
# FileSanté - Déploiement 100% CLI
# ============================================
# Ce script déploie FileSanté sans interface web
# Usage: ./deploy.sh
#
# Prérequis à installer:
#   - git
#   - gh (GitHub CLI)
#   - railway (Railway CLI) OU render (Render CLI)
#   - twilio (Twilio CLI)
#   - jq (JSON parser)
# ============================================

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}════════════════════════════════════════════${NC}"
    echo ""
}

print_step() {
    echo -e "${BLUE}▶ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# ============================================
# VÉRIFICATION DES PRÉREQUIS
# ============================================
print_header "Vérification des prérequis"

check_command() {
    if command -v $1 &> /dev/null; then
        print_success "$1 installé"
        return 0
    else
        print_error "$1 non installé"
        return 1
    fi
}

MISSING=0

check_command git || MISSING=1
check_command gh || { print_warning "Installer: brew install gh"; MISSING=1; }
check_command railway || { print_warning "Installer: npm install -g @railway/cli"; MISSING=1; }
check_command jq || { print_warning "Installer: brew install jq"; MISSING=1; }

if [ $MISSING -eq 1 ]; then
    echo ""
    print_error "Installez les outils manquants puis relancez le script"
    echo ""
    echo "Installation rapide (macOS):"
    echo "  brew install git gh jq"
    echo "  npm install -g @railway/cli"
    echo ""
    echo "Installation rapide (Linux):"
    echo "  sudo apt install git jq"
    echo "  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg"
    echo "  npm install -g @railway/cli"
    exit 1
fi

# ============================================
# CONFIGURATION
# ============================================
print_header "Configuration"

# Nom du projet
read -p "Nom du projet GitHub (ex: filesante): " PROJECT_NAME
PROJECT_NAME=${PROJECT_NAME:-filesante}

# Domaine (optionnel)
read -p "Domaine personnalisé (laisser vide pour utiliser railway.app): " CUSTOM_DOMAIN

echo ""
print_success "Projet: $PROJECT_NAME"
[ -n "$CUSTOM_DOMAIN" ] && print_success "Domaine: $CUSTOM_DOMAIN"

# ============================================
# ÉTAPE 1: AUTHENTIFICATION GITHUB
# ============================================
print_header "Étape 1: GitHub"

print_step "Vérification authentification GitHub..."
if ! gh auth status &> /dev/null; then
    print_warning "Connexion à GitHub requise"
    gh auth login
fi
print_success "Connecté à GitHub"

# Créer le repo
print_step "Création du repository GitHub..."
if gh repo view $PROJECT_NAME &> /dev/null 2>&1; then
    print_warning "Le repo $PROJECT_NAME existe déjà"
else
    gh repo create $PROJECT_NAME --public --description "FileSanté - File virtuelle pour urgences hospitalières"
    print_success "Repository créé: https://github.com/$(gh api user -q .login)/$PROJECT_NAME"
fi

# ============================================
# ÉTAPE 2: INITIALISER GIT ET PUSH
# ============================================
print_header "Étape 2: Git"

print_step "Initialisation du repository local..."

# Vérifier si on est dans le bon dossier
if [ ! -f "package.json" ]; then
    print_error "Exécutez ce script depuis le dossier filesante-backend/"
    exit 1
fi

# Init git si nécessaire
if [ ! -d ".git" ]; then
    git init
    print_success "Git initialisé"
fi

# Configurer remote
GITHUB_USER=$(gh api user -q .login)
REMOTE_URL="https://github.com/$GITHUB_USER/$PROJECT_NAME.git"

if git remote get-url origin &> /dev/null; then
    git remote set-url origin $REMOTE_URL
else
    git remote add origin $REMOTE_URL
fi

# Commit et push
git add .
git commit -m "Initial commit - FileSanté v1.0" 2>/dev/null || print_warning "Rien à commiter"
git branch -M main
git push -u origin main --force
print_success "Code poussé sur GitHub"

# ============================================
# ÉTAPE 3: DÉPLOIEMENT RAILWAY
# ============================================
print_header "Étape 3: Railway (Hébergement)"

print_step "Connexion à Railway..."
if ! railway whoami &> /dev/null 2>&1; then
    print_warning "Connexion à Railway requise"
    railway login
fi
print_success "Connecté à Railway"

# Créer le projet
print_step "Création du projet Railway..."
railway init --name $PROJECT_NAME 2>/dev/null || print_warning "Projet existant ou erreur"

# Lier au repo GitHub
print_step "Liaison avec GitHub..."
railway link

# Créer la base de données PostgreSQL
print_step "Création de la base de données PostgreSQL..."
railway add --plugin postgresql

# Attendre que la DB soit prête
print_step "Attente de la base de données..."
sleep 10

# Configurer les variables d'environnement
print_step "Configuration des variables d'environnement..."

# Générer JWT secret
JWT_SECRET=$(openssl rand -hex 32)

railway variables set NODE_ENV=production
railway variables set JWT_SECRET=$JWT_SECRET
railway variables set PORT=3000

print_success "Variables configurées"

# Déployer
print_step "Déploiement en cours..."
railway up --detach

print_success "Déploiement lancé!"

# Récupérer l'URL
sleep 5
RAILWAY_URL=$(railway domain 2>/dev/null || echo "")

if [ -z "$RAILWAY_URL" ]; then
    print_step "Génération du domaine..."
    railway domain
    RAILWAY_URL=$(railway domain)
fi

print_success "URL de l'application: https://$RAILWAY_URL"

# ============================================
# ÉTAPE 4: MIGRATIONS
# ============================================
print_header "Étape 4: Base de données"

print_step "Exécution des migrations..."
railway run npm run migrate

print_step "Insertion des données de démo..."
railway run npm run seed

print_success "Base de données initialisée"

# ============================================
# ÉTAPE 5: TWILIO (OPTIONNEL)
# ============================================
print_header "Étape 5: Twilio (SMS)"

read -p "Configurer Twilio maintenant? (o/n): " SETUP_TWILIO

if [ "$SETUP_TWILIO" = "o" ] || [ "$SETUP_TWILIO" = "O" ]; then
    
    # Vérifier si Twilio CLI est installé
    if ! command -v twilio &> /dev/null; then
        print_step "Installation de Twilio CLI..."
        npm install -g twilio-cli
    fi
    
    # Login Twilio
    print_step "Connexion à Twilio..."
    if ! twilio profiles:list | grep -q "Active"; then
        twilio login
    fi
    print_success "Connecté à Twilio"
    
    # Récupérer les credentials
    TWILIO_SID=$(twilio profiles:list --no-header | grep "true" | awk '{print $2}')
    
    # Acheter un numéro canadien
    print_step "Recherche d'un numéro canadien..."
    AVAILABLE_NUMBER=$(twilio api:core:available-phone-numbers:local:list \
        --country-code CA \
        --sms-enabled \
        --limit 1 \
        -o json | jq -r '.[0].phoneNumber')
    
    if [ -n "$AVAILABLE_NUMBER" ] && [ "$AVAILABLE_NUMBER" != "null" ]; then
        read -p "Acheter le numéro $AVAILABLE_NUMBER ? (~$1.15/mois) (o/n): " BUY_NUMBER
        
        if [ "$BUY_NUMBER" = "o" ] || [ "$BUY_NUMBER" = "O" ]; then
            twilio api:core:incoming-phone-numbers:create --phone-number=$AVAILABLE_NUMBER
            print_success "Numéro acheté: $AVAILABLE_NUMBER"
            
            # Configurer les variables Railway
            railway variables set TWILIO_PHONE_NUMBER=$AVAILABLE_NUMBER
        fi
    else
        print_warning "Aucun numéro disponible. Configurez manuellement sur twilio.com"
    fi
    
    # Demander Account SID et Auth Token
    echo ""
    echo "Entrez vos credentials Twilio (depuis console.twilio.com):"
    read -p "Account SID (ACxxxx...): " TWILIO_ACCOUNT_SID
    read -s -p "Auth Token: " TWILIO_AUTH_TOKEN
    echo ""
    
    if [ -n "$TWILIO_ACCOUNT_SID" ] && [ -n "$TWILIO_AUTH_TOKEN" ]; then
        railway variables set TWILIO_ACCOUNT_SID=$TWILIO_ACCOUNT_SID
        railway variables set TWILIO_AUTH_TOKEN=$TWILIO_AUTH_TOKEN
        print_success "Twilio configuré"
        
        # Redéployer avec les nouvelles variables
        print_step "Redéploiement avec Twilio..."
        railway up --detach
    fi
else
    print_warning "Twilio non configuré - SMS simulés"
fi

# ============================================
# ÉTAPE 6: DOMAINE PERSONNALISÉ (OPTIONNEL)
# ============================================
if [ -n "$CUSTOM_DOMAIN" ]; then
    print_header "Étape 6: Domaine personnalisé"
    
    print_step "Configuration du domaine $CUSTOM_DOMAIN..."
    railway domain $CUSTOM_DOMAIN
    
    echo ""
    echo -e "${YELLOW}Configuration DNS requise:${NC}"
    echo ""
    echo "Ajoutez ces enregistrements chez votre registraire:"
    echo ""
    echo "  Type   | Nom | Valeur"
    echo "  -------|-----|-------"
    echo "  CNAME  | @   | $RAILWAY_URL"
    echo "  CNAME  | www | $RAILWAY_URL"
    echo ""
    print_warning "Le SSL sera actif après propagation DNS (~5-30 min)"
fi

# ============================================
# RÉSUMÉ
# ============================================
print_header "🎉 Déploiement terminé!"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  FileSanté est en ligne!                                   ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "URLs:"
if [ -n "$CUSTOM_DOMAIN" ]; then
    echo -e "  🌐 Site:      ${CYAN}https://$CUSTOM_DOMAIN${NC}"
else
    echo -e "  🌐 Site:      ${CYAN}https://$RAILWAY_URL${NC}"
fi
echo -e "  🔧 API:       ${CYAN}https://$RAILWAY_URL/api${NC}"
echo -e "  💚 Health:    ${CYAN}https://$RAILWAY_URL/health${NC}"
echo ""
echo "Comptes de démo:"
echo -e "  👨‍💼 Admin:      admin@filesante.ca / admin123"
echo -e "  👩‍⚕️ Infirmière: nurse@hmr.filesante.ca / nurse123"
echo ""
echo "Commandes utiles:"
echo -e "  ${BLUE}railway logs${NC}        # Voir les logs"
echo -e "  ${BLUE}railway status${NC}      # Statut du déploiement"
echo -e "  ${BLUE}railway open${NC}        # Ouvrir le dashboard Railway"
echo -e "  ${BLUE}railway run bash${NC}    # Shell dans le conteneur"
echo ""

# Test de l'API
print_step "Test de l'API..."
sleep 3
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$RAILWAY_URL/health" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
    print_success "API opérationnelle!"
else
    print_warning "L'API démarre... Attendez 1-2 minutes puis testez: curl https://$RAILWAY_URL/health"
fi

echo ""
