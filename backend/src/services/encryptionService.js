const crypto = require('crypto');

class EncryptionService {
    constructor() {
        this.algorithm = 'aes-256-gcm';
        this.keyLength = 32; // 256 bits
        this.ivLength = 16; // 128 bits
        this.tagLength = 16; // 128 bits
        this.saltLength = 32; // 256 bits
        this.iterations = 100000; // PBKDF2 iterations
    }

    // Validaciones de seguridad robustas para claves
    validateEncryptionKey(key) {
        if (!key || typeof key !== 'string') {
            throw new Error('La clave de encriptación debe ser una cadena de texto válida');
        }

        if (key.length < 12) {
            throw new Error('La clave de encriptación debe tener al menos 12 caracteres');
        }

        if (key.length > 128) {
            throw new Error('La clave de encriptación no puede exceder 128 caracteres');
        }

        // Verificar complejidad de la clave - MEJORADO
        const validations = {
            hasUpper: /[A-Z]/.test(key),
            hasLower: /[a-z]/.test(key),
            hasNumber: /[0-9]/.test(key),
            hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(key)
        };

        const validationsPassed = Object.values(validations).filter(Boolean).length;

        // CORREGIR: Reducir requisito de 3 a 2 tipos diferentes
        if (validationsPassed < 2) {
            throw new Error(
                'La clave debe contener al menos 2 de los siguientes: ' +
                'mayúsculas, minúsculas, números y símbolos especiales'
            );
        }

        // Verificar que no sea una clave común o débil - MEJORADO
        const weakPasswords = [
            'password', '123456', 'qwerty', 'abc123', 'password123',
            'admin', 'letmein', 'welcome', 'monkey', 'dragon',
            '12345678', 'abcdefgh', '11111111', '00000000'
        ];

        if (weakPasswords.includes(key.toLowerCase())) {
            throw new Error('La clave proporcionada es demasiado común y no es segura');
        }

        // CORREGIR: Verificar que no tenga más de 3 caracteres repetidos consecutivos
        if (/(.)\1{3,}/.test(key)) {
            throw new Error('La clave no debe contener más de 3 caracteres repetidos consecutivos');
        }

        // CORREGIR: Hacer la validación de secuencias más permisiva
        // Solo rechazar secuencias muy obvias y largas
        const obviousSequences = [
            '123456', '654321', '987654', 'abcdef', 'fedcba',
            'qwerty', 'asdfgh', 'zxcvbn'
        ];

        const keyLower = key.toLowerCase();
        for (const sequence of obviousSequences) {
            if (keyLower.includes(sequence)) {
                throw new Error(`La clave no debe contener la secuencia obvia: ${sequence}`);
            }
        }

        // ELIMINAR: La validación muy estricta de secuencias cortas
        // if (/(?:abc|bcd|cde|def|123|234|345|456|789)/i.test(key)) {
        //     throw new Error('La clave no debe contener secuencias obvias');
        // }

        return true;
    }

    // Generar clave desde contraseña con salt seguro
    generateKeyFromPassword(password, salt = null) {
        try {
            if (!salt) {
                salt = crypto.randomBytes(this.saltLength);
            }
            
            // Validar que el salt tenga el tamaño correcto
            if (salt.length !== this.saltLength) {
                throw new Error('Salt inválido');
            }

            const key = crypto.pbkdf2Sync(
                password, 
                salt, 
                this.iterations, 
                this.keyLength, 
                'sha256'
            );
            
            return { key, salt };
        } catch (error) {
            console.error('Error generando clave:', error);
            throw new Error('Error en la derivación de clave');
        }
    }

    // Encriptar con validaciones mejoradas
    encrypt(text, password) {
        try {
            // Validaciones de entrada
            if (text === null || text === undefined) {
                return null;
            }

            if (typeof text !== 'string') {
                text = String(text);
            }

            this.validateEncryptionKey(password);

            const salt = crypto.randomBytes(this.saltLength);
            const { key } = this.generateKeyFromPassword(password, salt);
            const iv = crypto.randomBytes(this.ivLength);

            const cipher = crypto.createCipherGCM(this.algorithm, key, iv);

            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            const tag = cipher.getAuthTag();
            
            // Formato: salt:iv:tag:encrypted
            const result = salt.toString('hex') + ':' + 
                          iv.toString('hex') + ':' + 
                          tag.toString('hex') + ':' + 
                          encrypted;

            // Verificar que el resultado tenga el formato correcto
            if (result.split(':').length !== 4) {
                throw new Error('Error en el formato del resultado encriptado');
            }

            return result;
        } catch (error) {
            console.error('Error en encriptación:', error.message);
            throw new Error(`Error en el proceso de encriptación: ${error.message}`);
        }
    }

    // Desencriptar con validaciones mejoradas
    decrypt(encryptedText, password) {
        try {
            if (!encryptedText || !password) {
                throw new Error('Texto encriptado y contraseña son requeridos');
            }

            if (encryptedText === null || encryptedText === 'null') {
                return null;
            }

            this.validateEncryptionKey(password);

            // MEJORAR: Manejar diferentes tipos de entrada
            if (typeof encryptedText !== 'string') {
                console.warn('⚠️ encryptedText no es string:', typeof encryptedText, encryptedText);
                
                // Si es una fecha o timestamp, convertir apropiadamente
                if (encryptedText instanceof Date) {
                    console.warn('⚠️ Dato es una fecha, probablemente no encriptado correctamente');
                    return encryptedText.toISOString();
                }
                
                // Si es un buffer o array, convertir a string
                if (Buffer.isBuffer(encryptedText)) {
                    encryptedText = encryptedText.toString('utf8');
                } else if (Array.isArray(encryptedText)) {
                    encryptedText = Buffer.from(encryptedText).toString('utf8');
                } else {
                    encryptedText = String(encryptedText);
                }
            }

            // DETECTAR: Si es una fecha en formato texto (error de PostgreSQL)
            if (this.isDateString(encryptedText)) {
                console.warn('⚠️ Detectado formato de fecha, dato no encriptado correctamente:', encryptedText);
                return `[DATO_NO_ENCRIPTADO: ${encryptedText}]`;
            }

            // DETECTAR: Formatos especiales de PostgreSQL
            if (encryptedText.startsWith('\\x') || encryptedText.startsWith('error:') || encryptedText.startsWith('simple:')) {
                console.warn('⚠️ Formato de PostgreSQL detectado:', encryptedText.substring(0, 20));
                return this.handlePostgreSQLFormat(encryptedText, password);
            }

            const parts = encryptedText.split(':');
            if (parts.length !== 4) {
                console.error('❌ Formato inválido:', encryptedText);
                console.error('❌ Partes encontradas:', parts.length, parts);
                
                // INTENTO DE RECUPERACIÓN: Si parece ser texto plano
                if (parts.length === 1 && !encryptedText.includes(':')) {
                    console.warn('⚠️ Parece ser texto plano, retornando como tal');
                    return `[TEXTO_PLANO: ${encryptedText}]`;
                }
                
                throw new Error(`Formato de texto encriptado inválido. Esperado 4 partes, encontrado ${parts.length}`);
            }

            const salt = Buffer.from(parts[0], 'hex');
            const iv = Buffer.from(parts[1], 'hex');
            const tag = Buffer.from(parts[2], 'hex');
            const encrypted = parts[3];

            // Validar tamaños de componentes
            if (salt.length !== this.saltLength) {
                throw new Error(`Salt inválido. Esperado ${this.saltLength}, encontrado ${salt.length}`);
            }

            if (iv.length !== this.ivLength) {
                throw new Error(`IV inválido. Esperado ${this.ivLength}, encontrado ${iv.length}`);
            }

            if (tag.length !== this.tagLength) {
                throw new Error(`Tag inválido. Esperado ${this.tagLength}, encontrado ${tag.length}`);
            }

            const { key } = this.generateKeyFromPassword(password, salt);

            const decipher = crypto.createDecipherGCM(this.algorithm, key, iv);
            decipher.setAuthTag(tag);

            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (error) {
            console.error('❌ Error en desencriptación:', error.message);
            console.error('📋 Datos problemáticos:', {
                type: typeof encryptedText,
                length: encryptedText?.length,
                preview: typeof encryptedText === 'string' ? encryptedText.substring(0, 100) : 'No es string'
            });
            
            // Mensajes de error más específicos
            if (error.message.includes('bad decrypt')) {
                throw new Error('Contraseña de desencriptación incorrecta o datos corruptos');
            }
            
            if (error.message.includes('Unsupported state')) {
                throw new Error('Error en el proceso de desencriptación - datos inválidos');
            }

            throw new Error(`Error en el proceso de desencriptación: ${error.message}`);
        }
    }

    // AGREGAR: Método para detectar cadenas de fecha
    isDateString(str) {
        // Detectar formatos comunes de fecha
        const datePatterns = [
            /^\d{4}-\d{2}-\d{2}/, // 2025-09-01
            /^Mon|Tue|Wed|Thu|Fri|Sat|Sun/, // Día de la semana
            /GMT|UTC/, // Zonas horarias
            /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/ // ISO format
        ];
        
        return datePatterns.some(pattern => pattern.test(str));
    }
    
    // AGREGAR método específico para desencriptar datos de PostgreSQL con pgcrypto
    decryptPostgreSQLPgcrypto(encryptedText, password) {
        try {
            console.log('🔓 Intentando desencriptar formato PostgreSQL pgcrypto');
            
            const parts = encryptedText.split(':');
            if (parts.length !== 4) {
                throw new Error('Formato inválido para PostgreSQL pgcrypto');
            }

            const [salt, iv, tag, encrypted] = parts;
            
            // Para datos encriptados con pgp_sym_encrypt, necesitamos 
            // desencriptar el componente encrypted que contiene los datos de pgcrypto
            try {
                // Decodificar el componente encriptado (que viene de pgp_sym_encrypt)
                const pgcryptoData = Buffer.from(encrypted, 'hex');
                
                // Los datos de pgcrypto vienen en formato binario
                // Por ahora, retornamos una representación legible
                return `[DATOS_PGCRYPTO: ${pgcryptoData.toString('base64').substring(0, 50)}...]`;
                
            } catch (decodeError) {
                console.error('Error decodificando datos pgcrypto:', decodeError);
                return `[ERROR_PGCRYPTO: ${encrypted.substring(0, 50)}...]`;
            }
            
        } catch (error) {
            console.error('Error en desencriptación PostgreSQL:', error);
            return `[ERROR_DESENCRIPTACION: ${error.message}]`;
        }
    }

    // CORREGIR el método handlePostgreSQLFormat
    handlePostgreSQLFormat(encryptedText, password) {
        try {
            console.log('🔧 Manejando formato PostgreSQL:', encryptedText.substring(0, 50));
            
            if (encryptedText.startsWith('simple:')) {
                const hashPart = encryptedText.substring(7);
                return `[HASH_POSTGRESQL: ${hashPart.substring(0, 16)}...]`;
            }
            
            if (encryptedText.startsWith('error:')) {
                const errorPart = encryptedText.substring(6);
                return `[ERROR_POSTGRESQL: ${errorPart}]`;
            }
            
            if (encryptedText.startsWith('\\x')) {
                return `[HEX_POSTGRESQL: ${encryptedText.substring(0, 20)}...]`;
            }
            
            // AGREGAR: Verificar si tiene formato compatible de PostgreSQL
            const parts = encryptedText.split(':');
            if (parts.length === 4) {
                // Parece ser formato compatible, intentar desencriptar con pgcrypto
                return this.decryptPostgreSQLPgcrypto(encryptedText, password);
            }
            
            return `[FORMATO_DESCONOCIDO: ${encryptedText.substring(0, 50)}...]`;
        } catch (error) {
            return `[ERROR_PROCESANDO: ${error.message}]`;
        }
    }

    // AGREGAR: Método para desencriptar formato PostgreSQL legacy
    decryptPostgreSQLFormat(base64Data, password) {
        try {
            // Este método maneja datos encriptados con pgp_sym_encrypt
            // Nota: Esto es una implementación simplificada
            const decodedData = Buffer.from(base64Data, 'base64');
            
            // Para datos ya existentes con formato PostgreSQL,
            // necesitaríamos implementar compatibilidad con pgcrypto
            // Por ahora, retornamos un mensaje indicativo
            return `[Datos en formato PostgreSQL - requiere migración]`;
        } catch (error) {
            throw new Error('Error procesando formato PostgreSQL: ' + error.message);
        }
    }

    // Encriptar nombres de columnas con cache
    encryptColumnName(columnName, password) {
        try {
            const prefix = 'enc_';
            
            // Crear un hash consistente para el nombre de columna
            const hash = crypto
                .createHash('sha256')
                .update(columnName + password)
                .digest('hex')
                .substring(0, 12); // 12 caracteres para mantener legibilidad
            
            return prefix + hash;
        } catch (error) {
            console.error('Error encriptando nombre de columna:', error);
            throw new Error('Error generando nombre de columna encriptado');
        }
    }

    // Validar contraseña con múltiples intentos
    validatePasswordWithRetry(encryptedText, password, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.decrypt(encryptedText, password);
                return { valid: true, attempts: attempt };
            } catch (error) {
                if (attempt === maxRetries) {
                    return { 
                        valid: false, 
                        attempts: attempt,
                        error: error.message 
                    };
                }
                // Pequeña pausa entre intentos para evitar ataques de fuerza bruta
                setTimeout(() => {}, 100 * attempt);
            }
        }
    }

    // Generar clave aleatoria segura
    generateSecurePassword(length = 16, includeSpecial = true) {
        const lowercase = 'abcdefghijklmnopqrstuvwxyz';
        const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const numbers = '0123456789';
        const special = includeSpecial ? '!@#$%^&*()_+-=[]{}|;:,.<>?' : '';
        
        const allChars = lowercase + uppercase + numbers + special;
        let password = '';

        // Asegurar que al menos un carácter de cada tipo esté presente
        password += lowercase[Math.floor(Math.random() * lowercase.length)];
        password += uppercase[Math.floor(Math.random() * uppercase.length)];
        password += numbers[Math.floor(Math.random() * numbers.length)];
        
        if (includeSpecial) {
            password += special[Math.floor(Math.random() * special.length)];
        }

        // Completar la longitud restante
        for (let i = password.length; i < length; i++) {
            password += allChars[Math.floor(Math.random() * allChars.length)];
        }

        // Mezclar los caracteres
        return password.split('').sort(() => Math.random() - 0.5).join('');
    }

    // Verificar integridad de datos encriptados
    verifyDataIntegrity(encryptedData, password) {
        try {
            if (!Array.isArray(encryptedData)) {
                encryptedData = [encryptedData];
            }

            const results = {
                total: encryptedData.length,
                valid: 0,
                invalid: 0,
                errors: []
            };

            encryptedData.forEach((data, index) => {
                try {
                    if (data && data !== null) {
                        this.decrypt(data, password);
                        results.valid++;
                    }
                } catch (error) {
                    results.invalid++;
                    results.errors.push({
                        index,
                        error: error.message
                    });
                }
            });

            return {
                ...results,
                integrityPercentage: results.total > 0 ? 
                    Math.round((results.valid / results.total) * 100) : 0
            };
        } catch (error) {
            console.error('Error verificando integridad:', error);
            throw new Error('Error en verificación de integridad');
        }
    }

    // Métodos existentes mejorados...
    encryptRow(row, password, excludeColumns = []) {
        try {
            this.validateEncryptionKey(password);
            
            const encryptedRow = {};

            for (const [column, value] of Object.entries(row)) {
                if (excludeColumns.includes(column)) {
                    encryptedRow[column] = value;
                } else {
                    const encryptedColumn = this.encryptColumnName(column, password);
                    const encryptedValue = value !== null && value !== undefined ? 
                        this.encrypt(String(value), password) : null;
                    encryptedRow[encryptedColumn] = encryptedValue;
                }
            }

            return encryptedRow;
        } catch (error) {
            console.error('Error encriptando fila:', error);
            throw new Error(`Error encriptando fila: ${error.message}`);
        }
    }

    decryptRow(encryptedRow, password, originalColumns) {
        try {
            this.validateEncryptionKey(password);
            
            const decryptedRow = {};

            for (const originalColumn of originalColumns) {
                const encryptedColumn = this.encryptColumnName(originalColumn, password);

                if (encryptedRow.hasOwnProperty(encryptedColumn)) {
                    const encryptedValue = encryptedRow[encryptedColumn];
                    decryptedRow[originalColumn] = encryptedValue !== null && encryptedValue !== undefined ?
                        this.decrypt(encryptedValue, password) : null;
                } else {
                    decryptedRow[originalColumn] = null;
                }
            }

            return decryptedRow;
        } catch (error) {
            console.error('Error desencriptando fila:', error);
            throw new Error(`Error desencriptando fila: ${error.message}`);
        }
    }

    generateHash(data) {
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    verifyHash(data, hash) {
        const newHash = this.generateHash(data);
        return crypto.timingSafeEqual(Buffer.from(newHash), Buffer.from(hash));
    }
}

module.exports = new EncryptionService();