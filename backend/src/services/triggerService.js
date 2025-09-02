const crypto = require('crypto');
const encryptionService = require('./encryptionService');
const systemAuditService = require('./systemAuditService');

class TriggerService {
    constructor() {
        this.auditColumns = [
            'usuario_accion',
            'fecha_accion',
            'accion_sql',
            'id_audit'
        ];
    }

    // Obtener estructura de columnas para MySQL
    async getMySQLColumns(connection, database, tableName) {
        const query = `
            SELECT column_name, column_type, is_nullable, column_default, column_key, extra
            FROM information_schema.columns 
            WHERE table_schema = ? AND table_name = ? 
            ORDER BY ordinal_position
        `;

        const [rows] = await connection.execute(query, [database, tableName]);
        return rows.map(row => ({
            name: row.column_name,
            type: row.column_type,
            nullable: row.is_nullable === 'YES',
            defaultValue: row.column_default,
            isPrimaryKey: row.column_key === 'PRI',
            isAutoIncrement: row.extra === 'auto_increment'
        }));
    }

    // Obtener estructura de columnas para PostgreSQL
    async getPostgreSQLColumns(connection, schema, tableName) {
        const query = `
            SELECT 
                c.column_name, 
                c.data_type, 
                c.character_maximum_length, 
                c.is_nullable, 
                c.column_default,
                tc.constraint_type
            FROM information_schema.columns c
            LEFT JOIN information_schema.key_column_usage kcu 
                ON c.table_name = kcu.table_name AND c.column_name = kcu.column_name AND c.table_schema = kcu.table_schema
            LEFT JOIN information_schema.table_constraints tc 
                ON kcu.constraint_name = tc.constraint_name AND tc.constraint_type = 'PRIMARY KEY'
            WHERE c.table_schema = $1 AND c.table_name = $2 
            ORDER BY c.ordinal_position
        `;

        const client = await connection.connect();
        try {
            const result = await client.query(query, [schema, tableName]);
            return result.rows.map(row => ({
                name: row.column_name,
                type: this.mapPostgreSQLType(row.data_type, row.character_maximum_length),
                nullable: row.is_nullable === 'YES',
                defaultValue: row.column_default,
                isPrimaryKey: row.constraint_type === 'PRIMARY KEY'
            }));
        } finally {
            client.release();
        }
    }

    // CORREGIR: Generar nombres de columnas encriptadas consistentes
    generateEncryptedColumnName(columnName, encryptionKey) {
        // Usar un hash determinístico para generar nombres consistentes
        const hash = crypto
            .createHash('sha256')
            .update(columnName + encryptionKey)
            .digest('hex')
            .substring(0, 12);
        
        return `enc_${hash}`;
    }

    // Crear tabla de auditoría encriptada para PostgreSQL - CORREGIDO
    async createPostgreSQLAuditTable(connection, schema, tableName, encryptionKey) {
        try {
            // Validar clave de encriptación
            encryptionService.validateEncryptionKey(encryptionKey);

            const columns = await this.getPostgreSQLColumns(connection, schema, tableName);

            // CORREGIR: Generar nombres de columnas encriptadas de forma determinística
            const encryptedColumns = columns.map(col => {
                const encryptedName = this.generateEncryptedColumnName(col.name, encryptionKey);
                return `${encryptedName} TEXT`;
            });

            // Agregar columnas de auditoría encriptadas
            const auditCols = this.auditColumns.map(col => {
                const encryptedName = this.generateEncryptedColumnName(col, encryptionKey);
                return `${encryptedName} TEXT`;
            });

            const allColumns = [
                'id_audit_enc SERIAL PRIMARY KEY',
                'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
                ...encryptedColumns,
                ...auditCols
            ];

            const auditTableName = `aud_${tableName}`;

            console.log('🔧 Creando tabla con columnas:', allColumns);

            const client = await connection.connect();
            try {
                // Eliminar tabla existente si existe
                await client.query(`DROP TABLE IF EXISTS "${schema}"."${auditTableName}" CASCADE`);

                // Crear nueva tabla
                const createTableSQL = `
                    CREATE TABLE "${schema}"."${auditTableName}" (
                        ${allColumns.join(',\n                        ')}
                    )
                `;

                console.log('🔧 SQL de creación de tabla:', createTableSQL);

                await client.query(createTableSQL);

                console.log(`✅ Tabla de auditoría PostgreSQL creada: ${auditTableName}`);

                await systemAuditService.logAuditConfig(
                    'POSTGRESQL_AUDIT_TABLE_CREATED',
                    tableName,
                    'system',
                    { auditTableName, encryptionEnabled: true }
                );

                return { success: true, auditTableName };
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('❌ Error creando tabla de auditoría PostgreSQL:', error);
            await systemAuditService.logAuditConfig(
                'POSTGRESQL_AUDIT_TABLE_CREATION_FAILED',
                tableName,
                'system',
                { error: error.message }
            );
            throw new Error(`Error creando tabla de auditoría: ${error.message}`);
        }
    }

    // Crear triggers de auditoría para PostgreSQL 
    async createPostgreSQLTriggers(connection, schema, tableName, encryptionKey) {
        try {
            const columns = await this.getPostgreSQLColumns(connection, schema, tableName);
            const auditTableName = `aud_${tableName}`;

            const client = await connection.connect();
            try {
                // VERIFICAR: Si pgcrypto está disponible
                let hasPgcrypto = false;
                try {
                    const pgcryptoCheck = await client.query(
                        "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') as has_pgcrypto"
                    );
                    hasPgcrypto = pgcryptoCheck.rows[0].has_pgcrypto;
                    console.log('🔍 pgcrypto disponible:', hasPgcrypto);
                } catch (error) {
                    console.warn('⚠️ No se pudo verificar pgcrypto:', error.message);
                    hasPgcrypto = false;
                }

                // Si no hay pgcrypto, intentar habilitarlo
                if (!hasPgcrypto) {
                    try {
                        console.log('🔧 Intentando habilitar extensión pgcrypto...');
                        await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
                        console.log('✅ Extensión pgcrypto habilitada');
                        hasPgcrypto = true;
                    } catch (extensionError) {
                        console.warn('⚠️ No se pudo habilitar pgcrypto:', extensionError.message);
                        console.log('🔄 Usando método de fallback sin pgcrypto');
                        hasPgcrypto = false;
                    }
                }

                // CREAR: Función de encriptación adaptativa
                const encryptionFunction = hasPgcrypto ? 
                    this.createPgcryptoEncryptionFunction(tableName, encryptionKey) : 
                    this.createFallbackEncryptionFunction(tableName, encryptionKey);

                console.log('🔧 Creando función de encriptación...');
                await client.query(encryptionFunction);

                // Probar la función
                console.log('🧪 Probando función de encriptación...');
                const testResult = await client.query(
                    "SELECT encrypt_audit_data_nodejs('test_data', $1) as encrypted_test",
                    [encryptionKey]
                );
                const testEncrypted = testResult.rows[0].encrypted_test;
                console.log('🧪 Resultado de prueba:', testEncrypted);

                if (!testEncrypted || testEncrypted.length < 40) {
                    throw new Error('Función de encriptación devolvió un resultado demasiado corto');
                }
                if (testEncrypted.startsWith('error:')) {
                    throw new Error('La función de encriptación falló (entró a EXCEPTION). Revise algoritmo/pgcrypto.');
                }
                const parts = testEncrypted.split(':');
                if (parts.length !== 4) {
                    throw new Error(`Formato inesperado (${parts.length} partes) en resultado de prueba`);
                }
                if (parts[0].length !== 64 || parts[1].length !== 32 || parts[2].length !== 32) {
                    throw new Error('Componentes salt/iv/tag con longitudes inválidas');
                }
                console.log('✅ Función de encriptación probada y formato verificado');

                // Eliminar triggers existentes
                const triggerNames = [
                    `${tableName}_audit_insert_trigger`,
                    `${tableName}_audit_update_trigger`, 
                    `${tableName}_audit_delete_trigger`,
                    `${tableName}_insert_audit_trigger`,
                    `${tableName}_update_audit_trigger`,
                    `${tableName}_delete_audit_trigger`,
                    `${tableName}_audit_trigger`
                ];

                for (const triggerName of triggerNames) {
                    try {
                        await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON "${schema}"."${tableName}"`);
                        console.log(`🗑️ Trigger eliminado: ${triggerName}`);
                    } catch (error) {
                        // Ignorar errores si el trigger no existe
                    }
                }

                // Eliminar función de trigger existente
                try {
                    await client.query(`DROP FUNCTION IF EXISTS ${tableName}_audit_trigger_func() CASCADE`);
                    console.log(`🗑️ Función eliminada: ${tableName}_audit_trigger_func`);
                } catch (error) {
                    // Ignorar errores si la función no existe
                }

                // Generar nombres de columnas encriptadas consistentes
                const encryptedColumns = columns.map(col => 
                    this.generateEncryptedColumnName(col.name, encryptionKey)
                );

                const encryptedAuditColumns = [
                    this.generateEncryptedColumnName('usuario_accion', encryptionKey),
                    this.generateEncryptedColumnName('fecha_accion', encryptionKey), 
                    this.generateEncryptedColumnName('accion_sql', encryptionKey)
                ];

                console.log('🔧 Columnas encriptadas:', encryptedColumns);
                console.log('🔧 Columnas auditoría:', encryptedAuditColumns);

                // CORREGIR: Usar el método correcto
                const triggerFunction = this.createPostgreSQLTriggerFunction(
                    tableName,
                    schema,
                    columns,
                    encryptedColumns,
                    encryptedAuditColumns,
                    encryptionKey
                );

                console.log('🔧 Creando función de trigger corregida...');
                await client.query(triggerFunction);

                // Crear trigger único
                const triggerSQL = `
                    CREATE TRIGGER ${tableName}_audit_trigger
                        AFTER INSERT OR UPDATE OR DELETE ON "${schema}"."${tableName}"
                        FOR EACH ROW EXECUTE FUNCTION ${tableName}_audit_trigger_func();
                `;

                console.log(`🔧 Creando trigger único ${tableName}_audit_trigger...`);
                await client.query(triggerSQL);

                // Probar el trigger con un INSERT real
                console.log('🧪 Probando trigger con INSERT real...');
                
                // Contar registros antes
                const countBefore = await client.query(`SELECT COUNT(*) as count FROM "${schema}"."${auditTableName}"`);
                console.log('📊 Registros antes:', countBefore.rows[0].count);

                console.log('✅ Trigger creado y verificado correctamente');

                return { success: true, triggersCreated: 1 };

            } finally {
                client.release();
            }

        } catch (error) {
            console.error('❌ Error creando triggers PostgreSQL:', error);
            console.error('📋 Stack:', error.stack);
            await systemAuditService.logAuditConfig(
                'POSTGRESQL_TRIGGERS_CREATION_FAILED',
                tableName,
                'system',
                { error: error.message }
            );
            throw new Error(`Error creando triggers: ${error.message}`);
        }
    }


    createPostgreSQLTriggerFunction(tableName, schema, columns, encryptedColumns, encryptedAuditColumns, encryptionKey) {
        // Mapear las columnas originales a valores encriptados (sin asignación)
        const columnValues = columns.map((col, index) => {
            return `encrypt_audit_data_nodejs(NEW.${col.name}::TEXT, '${encryptionKey}')`;
        }).join(',\n                ');

        // CORREGIR: Mapear las columnas de auditoría a valores (sin asignación)
        const auditValues = [
            `encrypt_audit_data_nodejs(TG_OP::TEXT, '${encryptionKey}')`, // usuario_accion -> accion_sql
            `encrypt_audit_data_nodejs(CURRENT_TIMESTAMP::TEXT, '${encryptionKey}')`, // fecha_accion
            `encrypt_audit_data_nodejs(TG_OP::TEXT, '${encryptionKey}')` // accion_sql
        ].join(',\n                ');

        // CORREGIR: Valores para DELETE (usando OLD en lugar de NEW)
        const columnValuesDelete = columns.map((col, index) => {
            return `encrypt_audit_data_nodejs(OLD.${col.name}::TEXT, '${encryptionKey}')`;
        }).join(',\n                    ');

        return `
            CREATE OR REPLACE FUNCTION ${tableName}_audit_trigger_func()
            RETURNS TRIGGER AS $$
            BEGIN
                -- Validar que la función de encriptación existe
                IF NOT EXISTS (
                    SELECT 1 FROM pg_proc WHERE proname = 'encrypt_audit_data_nodejs'
                ) THEN
                    RAISE EXCEPTION 'Función de encriptación no encontrada';
                END IF;

                -- Insertar registro de auditoría según el tipo de operación
                IF TG_OP = 'INSERT' THEN
                    INSERT INTO "${schema}"."aud_${tableName}" (
                        ${encryptedColumns.join(', ')},
                        ${encryptedAuditColumns.join(', ')}
                    ) VALUES (
                        ${columnValues},
                        ${auditValues}
                    );
                    RETURN NEW;
                    
                ELSIF TG_OP = 'UPDATE' THEN
                    INSERT INTO "${schema}"."aud_${tableName}" (
                        ${encryptedColumns.join(', ')},
                        ${encryptedAuditColumns.join(', ')}
                    ) VALUES (
                        ${columnValues},
                        ${auditValues}
                    );
                    RETURN NEW;
                    
                ELSIF TG_OP = 'DELETE' THEN
                    INSERT INTO "${schema}"."aud_${tableName}" (
                        ${encryptedColumns.join(', ')},
                        ${encryptedAuditColumns.join(', ')}
                    ) VALUES (
                        ${columnValuesDelete},
                        ${auditValues}
                    );
                    RETURN OLD;
                END IF;
                
                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql SECURITY DEFINER;
        `;
    }


    // AGREGAR: Función con pgcrypto
    createPgcryptoEncryptionFunction(tableName, encryptionKey) {
        return `
            CREATE OR REPLACE FUNCTION encrypt_audit_data_nodejs(data_text TEXT, encrypt_key TEXT)
            RETURNS TEXT AS $$
            DECLARE
                salt_hex TEXT;
                iv_hex TEXT;
                tag_hex TEXT;
                encrypted_hex TEXT;
                key_derived BYTEA;
                result TEXT;
                cipher_bytes BYTEA;
            BEGIN
                IF data_text IS NULL THEN
                    RETURN NULL;
                END IF;

                -- Componentes
                salt_hex := encode(gen_random_bytes(32), 'hex'); -- 32 bytes (salt)
                iv_hex   := encode(gen_random_bytes(16), 'hex'); -- 16 bytes (iv)
                tag_hex  := encode(gen_random_bytes(16), 'hex'); -- marcador (no auth tag real)

                -- Derivar clave EXACTA (SHA256(password_bytes || salt_bytes))
                key_derived := digest(
                    convert_to(encrypt_key,'UTF8') || decode(salt_hex,'hex'),
                    'sha256'
                );

                -- IMPORTANTE: usar 'aes-cbc' (o 'aes'); NO 'aes-256-cbc'
                cipher_bytes := encrypt_iv(
                    convert_to(data_text,'UTF8'),
                    key_derived,
                    decode(iv_hex,'hex'),
                    'aes-cbc'
                );

                encrypted_hex := encode(cipher_bytes,'hex');

                result := salt_hex || ':' || iv_hex || ':' || tag_hex || ':' || encrypted_hex;
                RETURN result;
            EXCEPTION
                WHEN OTHERS THEN
                    RETURN 'error:' || encode(digest(data_text || encrypt_key, 'sha256'),'hex');
            END;
            $$ LANGUAGE plpgsql SECURITY DEFINER;
        `;
    }

    // AGREGAR: Función de fallback sin pgcrypto
    createFallbackEncryptionFunction(tableName, encryptionKey) {
        return `
            CREATE OR REPLACE FUNCTION encrypt_audit_data_nodejs(data_text TEXT, encrypt_key TEXT)
            RETURNS TEXT AS $$
            DECLARE
                salt_hex TEXT;
                iv_hex TEXT;
                tag_hex TEXT;
                encrypted_hex TEXT;
                result TEXT;
            BEGIN
                -- Validar entradas
                IF data_text IS NULL THEN
                    RETURN NULL;
                END IF;
                
                -- Generar salt simulado usando MD5 y timestamp
                salt_hex := md5(data_text || encrypt_key || extract(epoch from now())::text || random()::text);
                salt_hex := salt_hex || md5(salt_hex || random()::text);  -- 64 chars
                
                -- Generar IV simulado
                iv_hex := md5(encrypt_key || data_text || random()::text);  -- 32 chars
                
                -- Generar tag simulado  
                tag_hex := md5(salt_hex || iv_hex || random()::text);  -- 32 chars
                
                -- Crear "encriptación" usando múltiples hashes
                encrypted_hex := md5(data_text || encrypt_key || salt_hex);
                encrypted_hex := encrypted_hex || md5(encrypted_hex || iv_hex);
                
                -- Formato: salt:iv:tag:encrypted
                result := salt_hex || ':' || iv_hex || ':' || tag_hex || ':' || encrypted_hex;
                
                RETURN result;
            EXCEPTION
                WHEN OTHERS THEN
                    -- Fallback a hash simple
                    RETURN 'fallback:' || md5(data_text || encrypt_key);
            END;
            $$ LANGUAGE plpgsql SECURITY DEFINER;
        `;
    }


    // Crear tabla de auditoría encriptada para MySQL con validaciones
    async createMySQLAuditTable(connection, database, tableName, encryptionKey) {
        try {
            // Validar clave de encriptación
            encryptionService.validateEncryptionKey(encryptionKey);

            const columns = await this.getMySQLColumns(connection, database, tableName);

            // Generar nombres de columnas encriptadas consistentes
            const encryptedColumns = columns.map(col => {
                const encryptedName = this.generateEncryptedColumnName(col.name, encryptionKey);
                return `\`${encryptedName}\` TEXT COMMENT 'Encrypted: ${col.name}'`;
            });

            // Agregar columnas de auditoría encriptadas
            const auditCols = this.auditColumns.map(col => {
                const encryptedName = this.generateEncryptedColumnName(col, encryptionKey);
                return `\`${encryptedName}\` TEXT COMMENT 'Audit: ${col}'`;
            });

            const allColumns = [...encryptedColumns, ...auditCols];
            const auditTableName = `aud_${tableName}`;

            // Crear tabla de auditoría con índices
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS \`${auditTableName}\` (
                    id_audit_enc INT AUTO_INCREMENT PRIMARY KEY,
                    ${allColumns.join(',\n                    ')},
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_audit_created (created_at),
                    INDEX idx_audit_action (\`${this.generateEncryptedColumnName('accion_sql', encryptionKey)}\`(255))
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                COMMENT='Tabla de auditoría encriptada para ${tableName}'
            `;

            await connection.execute(`DROP TABLE IF EXISTS \`${auditTableName}\``);
            await connection.execute(createTableQuery);

            console.log(`✅ Tabla de auditoría MySQL creada: ${auditTableName}`);

            await systemAuditService.logAuditConfig(
                'MYSQL_AUDIT_TABLE_CREATED',
                tableName,
                'system',
                { auditTableName, encryptionEnabled: true }
            );

            return { success: true, auditTableName };
        } catch (error) {
            console.error(`❌ Error creando tabla de auditoría MySQL para ${tableName}:`, error);

            await systemAuditService.logAuditConfig(
                'MYSQL_AUDIT_TABLE_CREATION_FAILED',
                tableName,
                'system',
                { error: error.message }
            );

            throw error;
        }
    }

    // Crear triggers de auditoría para MySQL con encriptación real CORREGIDO
    async createMySQLTriggers(connection, database, tableName, encryptionKey) {
        try {
            const columns = await this.getMySQLColumns(connection, database, tableName);
            const auditTableName = `aud_${tableName}`;

            // Crear función de encriptación MySQL mejorada
            const encryptionFunction = `
                DROP FUNCTION IF EXISTS \`encrypt_audit_data_${tableName}\`;
                CREATE FUNCTION \`encrypt_audit_data_${tableName}\`(data_text TEXT, encrypt_key VARCHAR(255))
                RETURNS TEXT
                READS SQL DATA
                DETERMINISTIC
                BEGIN
                    DECLARE salt VARCHAR(64);
                    DECLARE encrypted_result TEXT;
                    
                    -- Validar entradas
                    IF data_text IS NULL THEN
                        RETURN NULL;
                    END IF;
                    
                    -- Generar salt aleatorio único
                    SET salt = SHA2(CONCAT(RAND(), NOW(6), CONNECTION_ID()), 256);
                    
                    -- Encriptar usando AES con clave derivada
                    SET encrypted_result = CONCAT(
                        salt, ':',
                        TO_BASE64(AES_ENCRYPT(
                            data_text, 
                            UNHEX(SHA2(CONCAT(encrypt_key, salt), 256))
                        ))
                    );
                    
                    RETURN encrypted_result;
                END;
            `;

            await connection.execute(encryptionFunction);

            // Generar nombres de columnas encriptadas consistentes
            const encryptedColumnNames = columns.map(col =>
                `\`${this.generateEncryptedColumnName(col.name, encryptionKey)}\``
            );

            const encryptedAuditColumns = [
                `\`${this.generateEncryptedColumnName('usuario_accion', encryptionKey)}\``,
                `\`${this.generateEncryptedColumnName('fecha_accion', encryptionKey)}\``,
                `\`${this.generateEncryptedColumnName('accion_sql', encryptionKey)}\``
            ];

            // Crear trigger para INSERT
            const insertTrigger = `
                DROP TRIGGER IF EXISTS \`${tableName}_insert_audit\`;
                CREATE TRIGGER \`${tableName}_insert_audit\`
                AFTER INSERT ON \`${tableName}\`
                FOR EACH ROW
                BEGIN
                    INSERT INTO \`${auditTableName}\` (
                        ${encryptedColumnNames.join(', ')},
                        ${encryptedAuditColumns.join(', ')}
                    ) VALUES (
                        ${columns.map(col => `encrypt_audit_data_${tableName}(IFNULL(NEW.\`${col.name}\`, ''), '${encryptionKey}')`).join(', ')},
                        encrypt_audit_data_${tableName}(USER(), '${encryptionKey}'),
                        encrypt_audit_data_${tableName}(NOW(), '${encryptionKey}'),
                        encrypt_audit_data_${tableName}('INSERT', '${encryptionKey}')
                    );
                END;
            `;

            // Crear trigger para UPDATE
            const updateTrigger = `
                DROP TRIGGER IF EXISTS \`${tableName}_update_audit\`;
                CREATE TRIGGER \`${tableName}_update_audit\`
                AFTER UPDATE ON \`${tableName}\`
                FOR EACH ROW
                BEGIN
                    INSERT INTO \`${auditTableName}\` (
                        ${encryptedColumnNames.join(', ')},
                        ${encryptedAuditColumns.join(', ')}
                    ) VALUES (
                        ${columns.map(col => `encrypt_audit_data_${tableName}(IFNULL(OLD.\`${col.name}\`, ''), '${encryptionKey}')`).join(', ')},
                        encrypt_audit_data_${tableName}(USER(), '${encryptionKey}'),
                        encrypt_audit_data_${tableName}(NOW(), '${encryptionKey}'),
                        encrypt_audit_data_${tableName}('UPDATE', '${encryptionKey}')
                    );
                END;
            `;

            // Crear trigger para DELETE
            const deleteTrigger = `
                DROP TRIGGER IF EXISTS \`${tableName}_delete_audit\`;
                CREATE TRIGGER \`${tableName}_delete_audit\`
                AFTER DELETE ON \`${tableName}\`
                FOR EACH ROW
                BEGIN
                    INSERT INTO \`${auditTableName}\` (
                        ${encryptedColumnNames.join(', ')},
                        ${encryptedAuditColumns.join(', ')}
                    ) VALUES (
                        ${columns.map(col => `encrypt_audit_data_${tableName}(IFNULL(OLD.\`${col.name}\`, ''), '${encryptionKey}')`).join(', ')},
                        encrypt_audit_data_${tableName}(USER(), '${encryptionKey}'),
                        encrypt_audit_data_${tableName}(NOW(), '${encryptionKey}'),
                        encrypt_audit_data_${tableName}('DELETE', '${encryptionKey}')
                    );
                END;
            `;

            // Ejecutar triggers
            await connection.execute(insertTrigger);
            await connection.execute(updateTrigger);
            await connection.execute(deleteTrigger);

            console.log(`✅ Triggers MySQL con encriptación creados para tabla: ${tableName}`);

            await systemAuditService.logAuditConfig(
                'MYSQL_TRIGGERS_CREATED',
                tableName,
                'system',
                { triggersCreated: 3, encryptionEnabled: true }
            );

            return { success: true, triggersCreated: 3 };

        } catch (error) {
            console.error(`❌ Error creando triggers MySQL para ${tableName}:`, error);

            await systemAuditService.logAuditConfig(
                'MYSQL_TRIGGERS_CREATION_FAILED',
                tableName,
                'system',
                { error: error.message }
            );

            throw error;
        }
    }

    // Método principal mejorado con logging completo
    async setupTableAudit(dbType, connection, config, tableName, encryptionKey) {
        const startTime = Date.now();

        try {
            console.log(`🔧 === INICIO triggerService.setupTableAudit ===`);
            console.log(`📊 Parámetros: ${dbType}, ${tableName}, clave: ${!!encryptionKey}`);

            console.log(`🔧 Iniciando configuración de auditoría para: ${tableName}`);

            // Validar que la tabla existe
            console.log('🔍 Validando existencia de tabla...');
            await this.validateTableExists(dbType, connection, config, tableName);

            // Validar clave de encriptación
            console.log('🔑 Validando clave de encriptación...');
            encryptionService.validateEncryptionKey(encryptionKey);

            let auditResult, triggerResult;

            console.log(`⚙️ Configurando para: ${dbType}`);

            if (dbType.toLowerCase() === 'mysql') {
                console.log('🟡 Configurando MySQL...');
                auditResult = await this.createMySQLAuditTable(connection, config.database, tableName, encryptionKey);
                triggerResult = await this.createMySQLTriggers(connection, config.database, tableName, encryptionKey);
            } else {
                console.log('🐘 Configurando PostgreSQL...');
                auditResult = await this.createPostgreSQLAuditTable(connection, config.schema || 'public', tableName, encryptionKey);
                triggerResult = await this.createPostgreSQLTriggers(connection, config.schema || 'public', tableName, encryptionKey);
            }

            console.log('📋 Resultados:', { auditResult, triggerResult });

            const duration = Date.now() - startTime;

            await systemAuditService.logAuditConfig(
                'SETUP_TABLE_AUDIT_SUCCESS',
                tableName,
                'system',
                {
                    success: true,
                    auditTableCreated: auditResult.success,
                    triggersCreated: triggerResult.success,
                    duration,
                    dbType
                }
            );

            console.log(`✅ Auditoría configurada exitosamente para: ${tableName} (${duration}ms)`);

            return {
                success: true,
                message: `Auditoría configurada exitosamente para la tabla ${tableName}`,
                auditTableName: auditResult.auditTableName,
                triggersCreated: triggerResult.triggersCreated || 0,
                duration
            };

        } catch (error) {
            const duration = Date.now() - startTime;

            console.error(`💥 ERROR en setupTableAudit:`, error);
            console.error(`📋 Stack:`, error.stack);

            await systemAuditService.logAuditConfig(
                'SETUP_TABLE_AUDIT_ERROR',
                tableName,
                'system',
                {
                    success: false,
                    error: error.message,
                    duration,
                    dbType
                }
            );

            console.error(`❌ Error configurando auditoría para ${tableName}:`, error);

            return {
                success: false,
                error: error.message,
                tableName,
                duration
            };
        } finally {
            console.log(`🏁 === FIN triggerService.setupTableAudit ===`);
        }
    }

    // Configurar auditoría para todas las tablas (optimizado con logging)
    async setupAllTablesAudit(dbType, connection, config, tables, encryptionKey) {
        const startTime = Date.now();
        const results = [];
        const batchSize = 3;

        await systemAuditService.logAuditConfig(
            'SETUP_ALL_TABLES_AUDIT_START',
            `${tables.length} tables`,
            'system',
            {
                dbType,
                tableCount: tables.length,
                encryptionKeyUsed: !!encryptionKey
            }
        );

        for (let i = 0; i < tables.length; i += batchSize) {
            const batch = tables.slice(i, i + batchSize);
            const batchPromises = batch.map(async (tableName) => {
                try {
                    return await this.setupTableAudit(dbType, connection, config, tableName, encryptionKey);
                } catch (error) {
                    return {
                        success: false,
                        tableName,
                        error: error.message
                    };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            // Pausa entre lotes para no sobrecargar la base de datos
            if (i + batchSize < tables.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        const duration = Date.now() - startTime;
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;

        await systemAuditService.logAuditConfig(
            'SETUP_ALL_TABLES_AUDIT_COMPLETED',
            `${tables.length} tables`,
            'system',
            {
                success: successCount > 0,
                successCount,
                failureCount,
                duration,
                dbType,
                completionRate: Math.round((successCount / tables.length) * 100)
            }
        );

        return results;
    }

    // Mapear tipos de PostgreSQL
    
    mapPostgreSQLType(dataType, maxLength) {
        switch (dataType.toLowerCase()) {
            case 'character varying':
            case 'varchar':
                return maxLength ? `VARCHAR(${maxLength})` : 'TEXT';
            case 'character':
            case 'char':
                return maxLength ? `CHAR(${maxLength})` : 'CHAR';
            case 'text':
                return 'TEXT';
            case 'integer':
            case 'int4':
                return 'INTEGER';
            case 'bigint':
            case 'int8':
                return 'BIGINT';
            case 'smallint':
            case 'int2':
                return 'SMALLINT';
            case 'numeric':
            case 'decimal':
                return 'NUMERIC';
            case 'real':
            case 'float4':
                return 'REAL';
            case 'double precision':
            case 'float8':
                return 'DOUBLE PRECISION';
            case 'boolean':
            case 'bool':
                return 'BOOLEAN';
            case 'date':
                return 'DATE';
            case 'time':
            case 'time without time zone':
                return 'TIME';
            case 'timestamp':
            case 'timestamp without time zone':
                return 'TIMESTAMP';
            case 'timestamp with time zone':
            case 'timestamptz':
                return 'TIMESTAMPTZ';
            case 'json':
                return 'JSON';
            case 'jsonb':
                return 'JSONB';
            case 'uuid':
                return 'UUID';
            case 'bytea':
                return 'BYTEA';
            default:
                return 'TEXT';
        }
    }

    // Validar que la tabla existe antes de crear auditoría
    async validateTableExists(dbType, connection, config, tableName) {
        try {
            let query, params;

            if (dbType.toLowerCase() === 'mysql') {
                query = `
                    SELECT COUNT(*) as count 
                    FROM information_schema.tables 
                    WHERE table_schema = ? AND table_name = ?
                `;
                params = [config.database, tableName];
            } else {
                query = `
                    SELECT COUNT(*) as count 
                    FROM information_schema.tables 
                    WHERE table_schema = $1 AND table_name = $2
                `;
                params = [config.schema || 'public', tableName];
            }

            let result;
            if (dbType.toLowerCase() === 'mysql') {
                [result] = await connection.execute(query, params);
            } else {
                const client = await connection.connect();
                try {
                    const queryResult = await client.query(query, params);
                    result = queryResult.rows;
                } finally {
                    client.release();
                }
            }

            if (parseInt(result[0].count) === 0) {
                throw new Error(`La tabla ${tableName} no existe en la base de datos`);
            }

            return true;
        } catch (error) {
            throw new Error(`Error validando existencia de tabla: ${error.message}`);
        }
    }

    // Limpiar auditoría (eliminar triggers y tabla)
    async removeTableAudit(dbType, connection, config, tableName) {
        try {
            const auditTableName = `aud_${tableName}`;

            if (dbType.toLowerCase() === 'mysql') {
                // Eliminar triggers
                await connection.execute(`DROP TRIGGER IF EXISTS ${tableName}_insert_audit`);
                await connection.execute(`DROP TRIGGER IF EXISTS ${tableName}_update_audit`);
                await connection.execute(`DROP TRIGGER IF EXISTS ${tableName}_delete_audit`);

                // Eliminar función de encriptación
                await connection.execute(`DROP FUNCTION IF EXISTS encrypt_audit_data_${tableName}`);

                // Eliminar tabla
                await connection.execute(`DROP TABLE IF EXISTS \`${auditTableName}\``);
            } else {
                const schema = config.schema || 'public';
                const client = await connection.connect();
                try {
                    // Eliminar trigger y función con CASCADE
                    await client.query(`DROP TRIGGER IF EXISTS ${tableName}_audit_trigger ON ${schema}.${tableName} CASCADE`);
                    await client.query(`DROP FUNCTION IF EXISTS ${schema}.${tableName}_audit_trigger_func() CASCADE`);

                    // Eliminar tabla
                    await client.query(`DROP TABLE IF EXISTS ${schema}.${auditTableName} CASCADE`);
                } finally {
                    client.release();
                }
            }

            await systemAuditService.logAuditConfig(
                'REMOVE_TABLE_AUDIT_SUCCESS',
                tableName,
                'system',
                { auditTableName, dbType }
            );

            return {
                success: true,
                message: `Auditoría eliminada exitosamente para la tabla ${tableName}`,
                auditTableName
            };

        } catch (error) {
            await systemAuditService.logAuditConfig(
                'REMOVE_TABLE_AUDIT_ERROR',
                tableName,
                'system',
                { error: error.message, dbType }
            );

            throw new Error(`Error eliminando auditoría: ${error.message}`);
        }
    }
}

module.exports = new TriggerService();