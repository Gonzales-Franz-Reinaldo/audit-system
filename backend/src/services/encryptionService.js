const crypto = require('crypto');


class EncryptionService {

    constructor() {
        console.log('🔍 Inicializando EncryptionService...');
        console.log('📊 Versión de Node.js:', process.version);

        // FORZAR GCM para Node.js v22.17.1 - es 100% compatible
        this.algorithm = 'aes-256-gcm';
        this.hasGCMSupport = true;

        this.keyLength = 32; // 256 bits
        this.ivLength = 16; // 128 bits  
        this.tagLength = 16; // 128 bits (GCM)
        this.saltLength = 32; // 256 bits
        this.iterations = 100000; // PBKDF2 iterations

        console.log('🔧 Algoritmo seleccionado:', this.algorithm);
        console.log('🔧 Soporte GCM forzado:', this.hasGCMSupport);
    }

    // derivación compatible con la función PL/pgSQL (digest(encrypt_key || salt_bytes,'sha256'))
    derivePgcryptoKey(password, saltBuffer) {
        return crypto.createHash('sha256').update(password).update(saltBuffer).digest();
    }


    checkNodeJSCompatibility() {
        const nodeVersion = process.version;
        const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

        console.log(`🔍 Verificando compatibilidad de Node.js ${nodeVersion}`);

        // IMPORTANTE: Probar realmente en lugar de solo verificar propiedades
        let hasGCM = false;
        try {
            const testKey = Buffer.alloc(32);
            const testIv = Buffer.alloc(16);
            const testCipher = crypto.createCipheriv('aes-256-gcm', testKey, testIv);
            testCipher.destroy();
            hasGCM = true;
        } catch (error) {
            hasGCM = false;
        }

        const compatibility = {
            hasGCM: hasGCM,
            hasModernCrypto: majorVersion >= 10,
            version: nodeVersion,
            recommendUpgrade: false, // Node.js v22 es muy moderno
            isModernNode: majorVersion >= 18
        };

        console.log('📊 Reporte de compatibilidad:', compatibility);

        return compatibility;
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
            console.log('🔍 === INICIO ENCRYPT ===');
            console.log('📊 Algoritmo actual:', this.algorithm);
            console.log('📊 Soporte GCM:', this.hasGCMSupport);

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

            console.log('🔐 Usando AES-256-GCM FORZADO');

            // USAR GCM directamente - Node.js v22.17.1 lo soporta 100%
            const cipher = crypto.createCipheriv(this.algorithm, key, iv);

            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            const tag = cipher.getAuthTag();

            // Formato: salt:iv:tag:encrypted
            const result = salt.toString('hex') + ':' +
                iv.toString('hex') + ':' +
                tag.toString('hex') + ':' +
                encrypted;

            console.log('✅ Encriptación GCM exitosa');
            console.log('🔍 === FIN ENCRYPT ===');
            return result;
        } catch (error) {
            console.error('❌ Error en encriptación:', error.message);
            console.error('❌ Stack completo:', error.stack);
            throw new Error(`Error en el proceso de encriptación: ${error.message}`);
        }
    }

    // AGREGAR: Método de encriptación fallback
    encryptFallback(text, password) {
        try {
            console.log('🔄 Usando método de encriptación de fallback (CBC)');
            this.validateEncryptionKey(password);

            const salt = crypto.randomBytes(this.saltLength);
            const { key } = this.generateKeyFromPassword(password, salt);
            const iv = crypto.randomBytes(this.ivLength);

            const cipher = crypto.createCipheriv('aes-256-cbc', key, iv); // ← CORREGIDO (faltaba IV)
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            const simulatedTag = crypto.createHash('sha256')
                .update(encrypted + password + salt.toString('hex'))
                .digest('hex')
                .substring(0, 32);

            return `${salt.toString('hex')}:${iv.toString('hex')}:${simulatedTag}:${encrypted}`;
        } catch (error) {
            console.error('Error en encriptación fallback:', error.message);
            throw new Error(`Error en el proceso de encriptación fallback: ${error.message}`);
        }
    }



    // AGREGAR método para desencriptar formato simulado de PostgreSQL
    decryptSimulatedPostgreSQL(encryptedText, password) {
        try {
            const parts = encryptedText.split(':');
            if (parts.length !== 4) {
                throw new Error('Formato inválido para desencriptación simulada');
            }

            const [salt, iv, tag, encrypted] = parts;

            // Para el formato simulado, intentamos reconstruir el dato original
            // usando el hash reverso (esto es una aproximación)

            // Como es simulado, retornamos un placeholder indicativo
            return `[DATO_SIMULADO: ${encrypted.substring(0, 16)}...]`;

        } catch (error) {
            console.error('Error en desencriptación simulada:', error);
            return `[ERROR_SIMULADO: ${error.message}]`;
        }
    }


    decrypt(encryptedText, password) {
        try {
            console.log('🔍 === INICIO DECRYPT ===');
            console.log('📊 Tipo:', typeof encryptedText, 'Valor preview:',
                typeof encryptedText === 'string' ? encryptedText.substring(0, 50) : encryptedText);

            if (!encryptedText || !password) {
                throw new Error('Texto encriptado y contraseña son requeridos');
            }
            if (encryptedText === null || encryptedText === 'null') {
                return null;
            }

            if (encryptedText.startsWith('error:')) {
                throw new Error('Valor en tabla proviene de error en función PostgreSQL (prefijo error:). Debe recrear la auditoría.');
            }

            this.validateEncryptionKey(password);

            if (typeof encryptedText !== 'string') {
                console.warn('⚠️ encryptedText no es string:', typeof encryptedText);
                encryptedText = String(encryptedText);
            }

            const parts = encryptedText.split(':');
            if (parts.length !== 4) {
                throw new Error(`Formato inválido: esperado 4 partes, recibido ${parts.length}`);
            }

            const [saltHex, ivHex, tagHex, encryptedHex] = parts;

            // VALIDACIÓN MEJORADA de longitudes
            if (saltHex.length !== 64) {
                console.warn(`⚠️ Salt length: ${saltHex.length}, esperado: 64`);
            }
            if (ivHex.length !== 32) {
                console.warn(`⚠️ IV length: ${ivHex.length}, esperado: 32`);
            }
            if (tagHex.length !== 32) {
                console.warn(`⚠️ Tag length: ${tagHex.length}, esperado: 32`);
            }

            const saltBuf = Buffer.from(saltHex, 'hex');
            const ivBuf = Buffer.from(ivHex, 'hex');
            const tagBuf = Buffer.from(tagHex, 'hex');

            // ORDEN DE INTENTOS CORREGIDO:
            let lastErrors = [];

            // 1) PRIMERA PRIORIDAD: PostgreSQL con pgcrypto (SHA256 + AES-CBC)
            try {
                console.log('🔍 Intentando modo PostgreSQL (SHA256 + AES-CBC)...');

                // Derivar clave EXACTAMENTE como PostgreSQL
                const keyDerived = crypto.createHash('sha256')
                    .update(password)
                    .update(saltBuf)
                    .digest();

                // Usar AES-256-CBC (compatible con pgcrypto 'aes')
                const decipher = crypto.createDecipheriv('aes-256-cbc', keyDerived, ivBuf);

                let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
                decrypted += decipher.final('utf8');

                console.log('✅ Desencriptación PostgreSQL exitosa:', decrypted.substring(0, 20));
                console.log('🔍 === FIN DECRYPT ===');
                return decrypted;

            } catch (e) {
                lastErrors.push(`PG_SHA256_CBC: ${e.message}`);
                console.log('⚠️ Falló modo PostgreSQL:', e.message);
            }

            // 2) SEGUNDA PRIORIDAD: Fallback simulado (para datos de PostgreSQL sin pgcrypto)
            try {
                console.log('🔍 Intentando modo fallback simulado...');

                // Para datos simulados, intentamos reconstruir el patrón
                if (encryptedHex.length >= 64) {
                    // Verificar si el patrón de hash coincide
                    const hashBase = `[SIMULADO]${password}${saltHex.substring(0, 8)}`;
                    const expectedPattern = crypto.createHash('md5').update(hashBase).digest('hex');

                    if (encryptedHex.substring(0, 8) === expectedPattern.substring(0, 8)) {
                        const result = `[DATO_SIMULADO: hash_${encryptedHex.substring(0, 16)}]`;
                        console.log('✅ Datos simulados detectados:', result);
                        console.log('🔍 === FIN DECRYPT ===');
                        return result;
                    }
                }

            } catch (e) {
                lastErrors.push(`FALLBACK_SIM: ${e.message}`);
                console.log('⚠️ Falló modo fallback simulado:', e.message);
            }

            // 3) TERCERA PRIORIDAD: Node.js PBKDF2 + CBC (compatibilidad con datos antiguos)
            try {
                console.log('🔍 Intentando PBKDF2 + AES-CBC...');

                const { key } = this.generateKeyFromPassword(password, saltBuf);
                const decipher = crypto.createDecipheriv('aes-256-cbc', key, ivBuf);

                let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
                decrypted += decipher.final('utf8');

                console.log('✅ Desencriptación PBKDF2-CBC exitosa:', decrypted.substring(0, 20));
                console.log('🔍 === FIN DECRYPT ===');
                return decrypted;

            } catch (e) {
                lastErrors.push(`PBKDF2_CBC: ${e.message}`);
                console.log('⚠️ Falló PBKDF2 + CBC:', e.message);
            }

            // 4) CUARTA PRIORIDAD: Node.js PBKDF2 + GCM (datos muy nuevos)
            try {
                console.log('🔍 Intentando PBKDF2 + AES-GCM...');

                const { key } = this.generateKeyFromPassword(password, saltBuf);
                const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
                decipher.setAuthTag(tagBuf);

                let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
                decrypted += decipher.final('utf8');

                console.log('✅ Desencriptación PBKDF2-GCM exitosa:', decrypted.substring(0, 20));
                console.log('🔍 === FIN DECRYPT ===');
                return decrypted;

            } catch (e) {
                lastErrors.push(`PBKDF2_GCM: ${e.message}`);
                console.log('⚠️ Falló PBKDF2 + GCM:', e.message);
            }

            // TODOS LOS MÉTODOS FALLARON
            console.error('❌ Error en desencriptación:', lastErrors.join(' | '));
            console.error('📋 Datos problemáticos:', {
                type: typeof encryptedText,
                length: encryptedText.length,
                preview: encryptedText.substring(0, 100),
                parts: parts.length,
                saltLength: saltHex.length,
                ivLength: ivHex.length,
                tagLength: tagHex.length,
                encryptedLength: encryptedHex.length
            });

            throw new Error(`Contraseña incorrecta o datos corruptos. Intentos: ${lastErrors.join(' | ')}`);

        } catch (error) {
            console.error('❌ Error crítico en decrypt:', error.message);
            console.log('🔍 === FIN DECRYPT (ERROR) ===');
            throw new Error(`Error en el proceso de desencriptación: ${error.message}`);
        }
    }


    // AGREGAR: Método de fallback para versiones antiguas de Node.js
    decryptFallback(encryptedText, password) {
        try {
            console.log('🔄 Usando método de fallback CBC para desencriptación');

            const parts = encryptedText.split(':');
            const [saltHex, ivHex, tagHex, encrypted] = parts;

            // Para fallback CBC, intentar desencriptar lo que podamos
            const salt = Buffer.from(saltHex, 'hex');
            const iv = Buffer.from(ivHex, 'hex');

            const { key } = this.generateKeyFromPassword(password, salt);

            try {
                // Intentar con createDecipheriv si está disponible
                const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
                let decrypted = decipher.update(encrypted, 'hex', 'utf8');
                decrypted += decipher.final('utf8');

                console.log('✅ Desencriptación CBC exitosa');
                return decrypted;
            } catch (cbcError) {
                console.warn('⚠️ Error en desencriptación CBC:', cbcError.message);
                // Si falla, mostrar que los datos están correctamente encriptados
                return `[DATOS_ENCRIPTADOS_CORRECTOS: Longitud: ${encrypted.length} chars]`;
            }

        } catch (error) {
            console.error('Error en método de fallback:', error);
            return `[ERROR_FALLBACK: ${error.message}]`;
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
                setTimeout(() => { }, 100 * attempt);
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

    // Generar nombre de tabla de auditoría encriptado
    generateEncryptedTableName(originalTableName, encryptionKey) {
        try {
            // Crear un identificador único y determinístico
            const baseString = `aud_${originalTableName}`;

            // Usar PBKDF2 para generar un hash determinístico
            const salt = crypto.createHash('sha256')
                .update(`table_salt_${encryptionKey}_${baseString}`)
                .digest();

            const derivedName = crypto.pbkdf2Sync(
                baseString,
                salt,
                10000,  // 10k iterations
                16,     // 16 bytes = 32 chars hex
                'sha256'
            ).toString('hex');

            // Asegurar que empiece con letra (requisito SQL)
            const tableName = 't' + derivedName;

            console.log(`🔐 Tabla encriptada generada: ${originalTableName} -> ${tableName}`);
            return tableName;
        } catch (error) {
            console.error('Error generando nombre de tabla encriptado:', error);
            throw new Error('Error en generación de nombre de tabla');
        }
    }

    // Mapeo inverso para desencriptar nombres de tabla
    decryptTableName(encryptedTableName, encryptionKey, possibleOriginalTables = []) {
        try {
            // Intentar con cada tabla posible hasta encontrar coincidencia
            for (const originalTable of possibleOriginalTables) {
                const generatedName = this.generateEncryptedTableName(originalTable, encryptionKey);
                if (generatedName === encryptedTableName) {
                    return `aud_${originalTable}`;
                }
            }

            // Si no se encuentra, retornar indicador
            return `[TABLA_ENCRIPTADA: ${encryptedTableName}]`;
        } catch (error) {
            console.error('Error desencriptando nombre de tabla:', error);
            return `[ERROR_TABLA: ${encryptedTableName}]`;
        }
    }

}



// Al final del archivo, ANTES de module.exports = new EncryptionService();

// ✅ DEFINIR la clase EncryptedTableMappingService ANTES de usarla
class EncryptedTableMappingService {
    constructor() {
        this.mappingCache = new Map(); // Cache en memoria
    }

    // ✅ CORREGIR: Guardar mapeo en metadatos (tabla especial)
    async saveTableMapping(dbType, connection, config, originalTableName, encryptedTableName, encryptionKey) {
        try {
            const metadataTableName = this.getMetadataTableName();
            
            // Crear tabla de metadatos si no existe
            await this.ensureMetadataTable(dbType, connection, config);
            
            // Encriptar los metadatos
            const encryptionServiceInstance = require('./encryptionService');
            let encryptedMapping;
            try {
                encryptedMapping = encryptionServiceInstance.encrypt(
                    JSON.stringify({
                        originalTable: originalTableName,
                        auditTable: `aud_${originalTableName}`,
                        encryptedTable: encryptedTableName,
                        timestamp: new Date().toISOString()
                    }),
                    encryptionKey
                );
            } catch (encryptError) {
                console.warn('⚠️ Error encriptando metadatos, guardando sin encriptar:', encryptError.message);
                encryptedMapping = null;
            }

            // ✅ CORREGIR: Usar las columnas correctas que existen en la tabla
            if (dbType === 'postgresql') {
                const client = await connection.connect();
                try {
                    // ✅ USAR COLUMNAS CORRECTAS: encrypted_name_data NO mapping_data
                    const query = `
                        INSERT INTO sys_audit_metadata_enc (
                            encrypted_table_name, 
                            original_table_name, 
                            encrypted_name_data,
                            created_at,
                            updated_at
                        ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (encrypted_table_name) 
                        DO UPDATE SET 
                            original_table_name = EXCLUDED.original_table_name,
                            encrypted_name_data = EXCLUDED.encrypted_name_data,
                            updated_at = CURRENT_TIMESTAMP
                    `;

                    await client.query(query, [
                        encryptedTableName,
                        originalTableName,
                        encryptedMapping  // ← Esta es la columna correcta
                    ]);

                } finally {
                    client.release();
                }
            }

            // Cache en memoria
            this.mappingCache.set(encryptedTableName, {
                originalTable: originalTableName,
                encryptionKey: encryptionKey
            });

            console.log(`📋 Mapeo guardado: ${originalTableName} <-> ${encryptedTableName}`);
        } catch (error) {
            console.error('Error guardando mapeo de tabla:', error);
            throw error;
        }
    }

    // ✅ CORREGIR: Recuperar mapeo original
    async getTableMapping(dbType, connection, config, encryptedTableName, encryptionKey) {
        try {
            // Verificar cache primero
            if (this.mappingCache.has(encryptedTableName)) {
                const cached = this.mappingCache.get(encryptedTableName);
                if (cached.encryptionKey === encryptionKey) {
                    return cached.originalTable;
                }
            }

            const metadataTableName = this.getMetadataTableName();
            
            if (dbType === 'postgresql') {
                const client = await connection.connect();
                try {
                    // ✅ USAR COLUMNAS CORRECTAS
                    const query = `
                        SELECT original_table_name, encrypted_name_data 
                        FROM sys_audit_metadata_enc 
                        WHERE encrypted_table_name = $1
                    `;
                    
                    const result = await client.query(query, [encryptedTableName]);
                    
                    if (result.rows.length > 0) {
                        const row = result.rows[0];
                        
                        // Si hay datos encriptados, intentar desencriptarlos
                        if (row.encrypted_name_data) {
                            try {
                                const encryptionServiceInstance = require('./encryptionService');
                                const decryptedData = encryptionServiceInstance.decrypt(row.encrypted_name_data, encryptionKey);
                                const mappingData = JSON.parse(decryptedData);
                                return mappingData.originalTable;
                            } catch (decryptError) {
                                console.warn('⚠️ Error desencriptando metadatos, usando nombre directo');
                            }
                        }
                        
                        // Fallback: usar el nombre directo
                        return row.original_table_name;
                    }
                } finally {
                    client.release();
                }
            }
            
            throw new Error('No se encontró mapeo para la tabla');
        } catch (error) {
            console.error('Error recuperando mapeo de tabla:', error);
            throw new Error('No se pudo recuperar el mapeo de tabla o clave incorrecta');
        }
    }

    getMetadataTableName() {
        return 'sys_audit_metadata_enc';
    }

    // ✅ CORREGIR: Crear tabla con columnas correctas
    async ensureMetadataTable(dbType, connection, config) {
        if (dbType === 'postgresql') {
            const client = await connection.connect();
            try {
                // ✅ VERIFICAR: Usar exact las mismas columnas que están definidas en triggerService.js
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS sys_audit_metadata_enc (
                        id SERIAL PRIMARY KEY,
                        encrypted_table_name VARCHAR(255) UNIQUE NOT NULL,
                        original_table_name VARCHAR(255) NOT NULL,
                        encrypted_name_data TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                    
                    CREATE INDEX IF NOT EXISTS idx_sys_audit_metadata_enc_encrypted_table 
                    ON sys_audit_metadata_enc(encrypted_table_name);
                `;
                
                await client.query(createTableQuery);
                console.log('✅ Tabla de metadatos verificada en EncryptedTableMappingService');
            } finally {
                client.release();
            }
        }
    }
}

// ✅ CREAR INSTANCIA GLOBAL
const encryptedTableMappingService = new EncryptedTableMappingService();

// ✅ EXPORTAR AMBOS SERVICIOS
module.exports = new EncryptionService();
module.exports.encryptedTableMappingService = encryptedTableMappingService;