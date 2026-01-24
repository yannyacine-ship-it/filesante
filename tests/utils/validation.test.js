/**
 * Tests - Utilitaires de validation
 */

const {
  schemas,
  sanitizeString,
  sanitizeObject,
  isValidCanadianPhone,
  formatPhoneForTwilio
} = require('../../src/utils/validation');

describe('Validation Schemas', () => {
  describe('createPatient', () => {
    it('devrait valider des données correctes', () => {
      const data = {
        hospitalCode: 'HMR',
        priority: 'P4',
        reason: 'Test'
      };
      
      const { error } = schemas.createPatient.validate(data);
      expect(error).toBeUndefined();
    });

    it('devrait rejeter une priorité invalide', () => {
      const data = {
        hospitalCode: 'HMR',
        priority: 'P1'
      };
      
      const { error } = schemas.createPatient.validate(data);
      expect(error).toBeDefined();
      expect(error.details[0].message).toContain('P4 ou P5');
    });

    it('devrait rejeter un code hôpital manquant', () => {
      const data = {
        priority: 'P4'
      };
      
      const { error } = schemas.createPatient.validate(data);
      expect(error).toBeDefined();
    });
  });

  describe('activatePatient', () => {
    it('devrait valider un numéro de téléphone valide', () => {
      const data = { phone: '5141234567' };
      
      const { error } = schemas.activatePatient.validate(data);
      expect(error).toBeUndefined();
    });

    it('devrait rejeter un numéro trop court', () => {
      const data = { phone: '514123' };
      
      const { error } = schemas.activatePatient.validate(data);
      expect(error).toBeDefined();
    });

    it('devrait rejeter un numéro avec des lettres', () => {
      const data = { phone: '514ABC4567' };
      
      const { error } = schemas.activatePatient.validate(data);
      expect(error).toBeDefined();
    });
  });

  describe('login', () => {
    it('devrait valider des credentials corrects', () => {
      const data = {
        email: 'test@test.com',
        password: 'password123'
      };
      
      const { error } = schemas.login.validate(data);
      expect(error).toBeUndefined();
    });

    it('devrait rejeter un email invalide', () => {
      const data = {
        email: 'invalid-email',
        password: 'password123'
      };
      
      const { error } = schemas.login.validate(data);
      expect(error).toBeDefined();
    });

    it('devrait rejeter un mot de passe trop court', () => {
      const data = {
        email: 'test@test.com',
        password: '123'
      };
      
      const { error } = schemas.login.validate(data);
      expect(error).toBeDefined();
    });
  });

  describe('register', () => {
    it('devrait valider une inscription correcte', () => {
      const data = {
        email: 'new@test.com',
        password: 'Password1',
        firstName: 'John',
        lastName: 'Doe',
        role: 'nurse'
      };
      
      const { error } = schemas.register.validate(data);
      expect(error).toBeUndefined();
    });

    it('devrait rejeter un mot de passe sans majuscule', () => {
      const data = {
        email: 'new@test.com',
        password: 'password1',
        firstName: 'John',
        lastName: 'Doe',
        role: 'nurse'
      };
      
      const { error } = schemas.register.validate(data);
      expect(error).toBeDefined();
    });

    it('devrait rejeter un mot de passe sans chiffre', () => {
      const data = {
        email: 'new@test.com',
        password: 'Password',
        firstName: 'John',
        lastName: 'Doe',
        role: 'nurse'
      };
      
      const { error } = schemas.register.validate(data);
      expect(error).toBeDefined();
    });

    it('devrait rejeter un rôle invalide', () => {
      const data = {
        email: 'new@test.com',
        password: 'Password1',
        firstName: 'John',
        lastName: 'Doe',
        role: 'superadmin' // Non autorisé à la création
      };
      
      const { error } = schemas.register.validate(data);
      expect(error).toBeDefined();
    });
  });
});

describe('Sanitization', () => {
  describe('sanitizeString()', () => {
    it('devrait trimmer les espaces', () => {
      expect(sanitizeString('  test  ')).toBe('test');
    });

    it('devrait supprimer les balises HTML', () => {
      expect(sanitizeString('<script>alert("xss")</script>')).toBe('scriptalert("xss")/script');
    });

    it('devrait limiter la longueur', () => {
      const longString = 'a'.repeat(2000);
      expect(sanitizeString(longString).length).toBe(1000);
    });

    it('devrait retourner les non-strings tels quels', () => {
      expect(sanitizeString(123)).toBe(123);
      expect(sanitizeString(null)).toBe(null);
    });
  });

  describe('sanitizeObject()', () => {
    it('devrait sanitizer les valeurs d\'un objet', () => {
      const obj = {
        name: '  John  ',
        html: '<b>Bold</b>'
      };
      
      const result = sanitizeObject(obj);
      
      expect(result.name).toBe('John');
      expect(result.html).toBe('bBold/b');
    });

    it('devrait gérer les objets imbriqués', () => {
      const obj = {
        user: {
          name: '  John  ',
          email: 'test@test.com'
        }
      };
      
      const result = sanitizeObject(obj);
      
      expect(result.user.name).toBe('John');
    });

    it('devrait gérer les tableaux', () => {
      const arr = ['  one  ', '  two  '];
      
      const result = sanitizeObject(arr);
      
      expect(result).toEqual(['one', 'two']);
    });
  });
});

describe('Phone Validation', () => {
  describe('isValidCanadianPhone()', () => {
    it('devrait accepter un numéro à 10 chiffres', () => {
      expect(isValidCanadianPhone('5141234567')).toBe(true);
    });

    it('devrait accepter un numéro avec le 1 devant', () => {
      expect(isValidCanadianPhone('15141234567')).toBe(true);
    });

    it('devrait accepter un numéro formaté', () => {
      expect(isValidCanadianPhone('514-123-4567')).toBe(true);
      expect(isValidCanadianPhone('(514) 123-4567')).toBe(true);
    });

    it('devrait rejeter un numéro trop court', () => {
      expect(isValidCanadianPhone('514123')).toBe(false);
    });

    it('devrait rejeter un numéro trop long', () => {
      expect(isValidCanadianPhone('514123456789')).toBe(false);
    });
  });

  describe('formatPhoneForTwilio()', () => {
    it('devrait formater un numéro à 10 chiffres', () => {
      expect(formatPhoneForTwilio('5141234567')).toBe('+15141234567');
    });

    it('devrait formater un numéro avec le 1 devant', () => {
      expect(formatPhoneForTwilio('15141234567')).toBe('+15141234567');
    });

    it('devrait nettoyer les caractères non numériques', () => {
      expect(formatPhoneForTwilio('(514) 123-4567')).toBe('+15141234567');
    });
  });
});
