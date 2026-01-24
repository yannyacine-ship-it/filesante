#!/bin/bash

# ============================================
# FileSanté - Script de Setup Local
# ============================================
# Ce script configure et lance une démo locale complète
# Usage: ./scripts/setup-local.sh

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fonctions utilitaires
print_header() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
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

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# ============================================
# Vérifications préalables
# ============================================
print_header "Vérification des prérequis"

# Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    print_success "Node.js installé: $NODE_VERSION"
else
    print_error "Node.js n'est pas installé"
    echo "  Installer depuis: https://nodejs.org/"
    exit 1
fi

# npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    print_success "npm installé: $NPM_VERSION"
else
    print_error "npm n'est pas installé"
    exit 1
fi

# PostgreSQL (optionnel - on peut utiliser SQLite pour la démo)
if command -v psql &> /dev/null; then
    print_success "PostgreSQL installé"
    USE_POSTGRES=true
else
    print_warning "PostgreSQL non installé - utilisation de la simulation en mémoire"
    USE_POSTGRES=false
fi

# ============================================
# Installation des dépendances
# ============================================
print_header "Installation des dépendances"

npm install
print_success "Dépendances installées"

# ============================================
# Configuration de l'environnement
# ============================================
print_header "Configuration de l'environnement"

# Créer .env s'il n'existe pas
if [ ! -f .env ]; then
    cp .env.example .env
    
    # Générer un JWT secret
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 64 | head -n 1)
    
    # Mettre à jour le fichier .env
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/your_super_secret_jwt_key_change_in_production/$JWT_SECRET/" .env
    else
        # Linux
        sed -i "s/your_super_secret_jwt_key_change_in_production/$JWT_SECRET/" .env
    fi
    
    print_success "Fichier .env créé avec JWT_SECRET généré"
else
    print_info "Fichier .env existe déjà"
fi

# ============================================
# Base de données
# ============================================
print_header "Configuration de la base de données"

if [ "$USE_POSTGRES" = true ]; then
    # Vérifier si la base existe
    if psql -lqt | cut -d \| -f 1 | grep -qw filesante; then
        print_info "Base de données 'filesante' existe déjà"
    else
        print_info "Création de la base de données..."
        createdb filesante 2>/dev/null || true
        print_success "Base de données créée"
    fi
    
    # Exécuter les migrations
    print_info "Exécution des migrations..."
    npm run migrate
    print_success "Migrations exécutées"
    
    # Seeder les données
    print_info "Insertion des données de démo..."
    npm run seed
    print_success "Données de démo insérées"
else
    print_warning "PostgreSQL non disponible"
    print_info "Le serveur fonctionnera en mode simulation"
fi

# ============================================
# Résumé
# ============================================
print_header "🎉 Setup terminé!"

echo ""
echo "Pour démarrer FileSanté:"
echo ""
echo -e "  ${GREEN}npm run dev${NC}     # Mode développement avec hot-reload"
echo -e "  ${GREEN}npm start${NC}       # Mode production"
echo ""
echo "URLs:"
echo ""
echo -e "  🏠 Frontend:    ${BLUE}http://localhost:8080${NC} (si servi séparément)"
echo -e "  🔧 API:         ${BLUE}http://localhost:3000/api${NC}"
echo -e "  💚 Health:      ${BLUE}http://localhost:3000/health${NC}"
echo -e "  🔌 WebSocket:   ${BLUE}ws://localhost:3000/ws${NC}"
echo ""
echo "Comptes de démo:"
echo ""
echo -e "  👨‍💼 Admin:       admin@filesante.ca / admin123"
echo -e "  👩‍⚕️ Infirmière:  nurse@hmr.filesante.ca / nurse123"
echo ""
echo "Pour lancer une simulation:"
echo ""
echo -e "  ${GREEN}node scripts/demo.js${NC}"
echo ""
echo -e "${YELLOW}Note: Les SMS sont simulés en mode développement.${NC}"
echo -e "${YELLOW}Pour activer Twilio, configurez les variables dans .env${NC}"
echo ""
