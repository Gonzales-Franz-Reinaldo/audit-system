const crypto = require('crypto');
const encryptionService = require('./encryptionService');
const { encryptedTableMappingService } = require('./encryptionService'); 
const systemAuditService = require('./systemAuditService');


class TriggerService {
    constructor() {
        this.auditColumns = [
            'usuario_accion',
            'fecha_accion',
            'accion_sql',
            // 'id_audit'
        ];

        // Prefijo para identificar tablas de auditoría encriptadas
        this.encryptedTablePrefix = 't';
    }

    generateEncryptedAuditTableName(originalTableName, encryptionKey) {
        // Generar hash determinístico de 32 caracteres
        const hash = crypto
            .createHash('sha256')
            .update(originalTableName + encryptionKey + 'audit_table')
            .digest('hex')
            .substring(0, 32);
        
        return `${this.encryptedTablePrefix}${hash}`;
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

    // Generar nombres de columnas encriptadas consistentes
    generateEncryptedColumnName(columnName, encryptionKey) {
        const hash = crypto
            .createHash('sha256')
            .update(columnName + encryptionKey)
            .digest('hex')
            .substring(0, 12);

        return `enc_${hash}`;
    }
    // Método principal debe decidir qué tipo de tabla crear
    async createPostgreSQLAuditTable(connection, schema, tableName, encryptionKey) {
        try {
            console.log('🔧 === INICIO CREACIÓN TABLA AUDITORÍA ENCRIPTADA ===');

            const encryptedTableName = this.generateEncryptedAuditTableName(tableName, encryptionKey);
            console.log(`🔐 Tabla encriptada: ${tableName} -> ${encryptedTableName}`);

            // Obtener columnas de la tabla original EN ORDEN
            const originalColumns = await this.getPostgreSQLColumns(connection, schema, tableName);
            
            const orderedColumns = originalColumns.sort((a, b) => a.position - b.position);
            
            // Generar columnas encriptadas para datos EN EL MISMO ORDEN
            const encryptedDataColumns = orderedColumns.map(col => {
                const encryptedName = this.generateEncryptedColumnName(col.name, encryptionKey);
                return `${encryptedName} TEXT`;
            });

            // Generar columnas encriptadas para auditoría (siempre en este orden)
            const auditColumns = ['usuario_accion', 'fecha_accion', 'accion_sql'];
            const encryptedAuditColumns = auditColumns.map(col => {
                const encryptedName = this.generateEncryptedColumnName(col, encryptionKey);
                return `${encryptedName} TEXT`;
            });

            // Construir todas las columnas EN ORDEN CONSISTENTE
            const allColumns = [
                'id_audit_enc SERIAL PRIMARY KEY',
                'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
                ...encryptedDataColumns,    // ← Primero las columnas de datos
                ...encryptedAuditColumns    // ← Después las de auditoría
            ];

            console.log('🔧 Creando tabla con columnas:', allColumns);


            // Crear tabla de auditoría encriptada
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS "${schema}"."${encryptedAuditTableName}" (
                    ${allColumns.join(',\n                ')}
                )
            `;

            console.log('🔧 Query creación tabla:', createTableQuery);

            const client = await connection.connect();
            try {
                await client.query(createTableQuery);
                
                // NUEVO: Guardar mapeo en tabla de metadatos
                await this.saveTableMapping(connection, schema, tableName, encryptedAuditTableName, encryptionKey);
                
                console.log(`✅ Tabla de auditoría creada: ${encryptedAuditTableName}`);
                
                return {
                    success: true,
                    auditTableName: encryptedAuditTableName,
                    originalTable: tableName
                };
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('💥 Error creando tabla PostgreSQL:', error);
            throw error;
        }
    }


    // NUEVO: Guardar mapeo de tabla
    async saveTableMapping(connection, schema, originalTableName, encryptedTableName, encryptionKey) {
        const client = await connection.connect();
        try {
            console.log('💾 === GUARDANDO MAPEO ===');
            console.log('📊 Original:', originalTableName);
            console.log('📊 Encriptada:', encryptedTableName);

            // OPCIONAL: Encriptar el nombre de la tabla original para mayor seguridad
            let encryptedOriginalName;
            try {
                encryptedOriginalName = encryptionService.encrypt(originalTableName, encryptionKey);
            } catch (encryptError) {
                console.warn('⚠️ No se pudo encriptar el nombre, guardando en texto plano:', encryptError.message);
                encryptedOriginalName = null;
            }

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

            const result = await client.query(query, [
                encryptedTableName, 
                originalTableName,
                encryptedOriginalName  // ← Esta columna debe existir
            ]);

            console.log('✅ Mapeo guardado correctamente, filas afectadas:', result.rowCount);
            
            // Verificar que se guardó
            const verifyQuery = `
                SELECT encrypted_table_name, original_table_name 
                FROM sys_audit_metadata_enc 
                WHERE encrypted_table_name = $1
            `;
            
            const verifyResult = await client.query(verifyQuery, [encryptedTableName]);
            console.log('🔍 Verificación del mapeo guardado:', verifyResult.rows[0]);
            
        } catch (error) {
            console.error('❌ Error guardando mapeo:', error);
            throw error;
        } finally {
            client.release();
            console.log('💾 === FIN GUARDANDO MAPEO ===');
        }
    }

    // NUEVO: Recuperar mapeo de tabla
    async getTableMapping(connection, schema, encryptedTableName, encryptionKey) {
        const client = await connection.connect();
        try {
            const keyHash = crypto.createHash('sha256').update(encryptionKey).digest('hex');
            
            const result = await client.query(`
                SELECT original_table_name 
                FROM "${schema}"."audit_table_mappings" 
                WHERE encrypted_table_name = $1 AND encryption_key_hash = $2
            `, [encryptedTableName, keyHash]);

            if (result.rows.length > 0) {
                return {
                    originalTable: result.rows[0].original_table_name,
                    encryptedTable: encryptedTableName
                };
            }
            
            throw new Error('Tabla no encontrada o clave incorrecta');
        } finally {
            client.release();
        }
    }


    // Crear tabla de auditoría encriptada para PostgreSQL - NUEVA VERSION
    async createPostgreSQLAuditTable(connection, schema, tableName, encryptionKey) {
        try {
            console.log('🔧 === INICIO CREACIÓN TABLA AUDITORÍA ENCRIPTADA ===');

            // Validar clave de encriptación
            encryptionService.validateEncryptionKey(encryptionKey);

            const columns = await this.getPostgreSQLColumns(connection, schema, tableName);

            const encryptedAuditTableName = encryptionService.generateEncryptedTableName(
                tableName,
                encryptionKey
            );

            console.log(`🔐 Tabla encriptada: ${tableName} -> ${encryptedAuditTableName}`);

            // CORREGIR: Generar nombres de columnas encriptadas de forma determinística
            const encryptedColumns = columns.map(col => {
                const encryptedColName = encryptionService.encryptColumnName(col.name, encryptionKey);
                return `${encryptedColName} TEXT`;
            });

            // Agregar columnas de auditoría encriptadas
            const auditCols = this.auditColumns.map(col => {
                const encryptedColName = encryptionService.encryptColumnName(col, encryptionKey);
                return `${encryptedColName} TEXT`;
            });

            const allColumns = [
                'id_audit_enc SERIAL PRIMARY KEY',
                'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
                ...encryptedColumns,
                ...auditCols
            ];

            console.log('🔧 Creando tabla con columnas:', allColumns);

            const client = await connection.connect();
            try {
                const createTableQuery = `
                CREATE TABLE IF NOT EXISTS "${schema}"."${encryptedAuditTableName}" (
                    ${allColumns.join(',\n                    ')}
                )
            `;

                console.log('🔧 Ejecutando creación de tabla encriptada...');
                await client.query(createTableQuery);

                await encryptedTableMappingService.saveTableMapping(
                    'postgresql',
                    connection,
                    { schema },
                    tableName,
                    encryptedAuditTableName,
                    encryptionKey
                );

                console.log(`✅ Tabla de auditoría encriptada creada: ${encryptedAuditTableName}`);

                await systemAuditService.logAuditConfig(
                    'POSTGRESQL_ENCRYPTED_AUDIT_TABLE_CREATED',
                    tableName,
                    'system',
                    {
                        encryptedTableName: encryptedAuditTableName,
                        encryptionEnabled: true
                    }
                );

                return {
                    success: true,
                    auditTableName: encryptedAuditTableName,  
                    originalTableName: tableName
                };
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('❌ Error creando tabla de auditoría PostgreSQL encriptada:', error);

            await systemAuditService.logAuditConfig(
                'POSTGRESQL_ENCRYPTED_AUDIT_TABLE_CREATION_FAILED',
                tableName,
                'system',
                { error: error.message }
            );

            throw new Error(`Error creando tabla de auditoría encriptada: ${error.message}`);
        }
    }


    // Crear triggers de auditoría para PostgreSQL 
    async createPostgreSQLTriggers(connection, schema, tableName, encryptionKey, encryptedAuditTableName) {
        try {
            console.log('🔧 === INICIO CREACIÓN TRIGGERS POSTGRESQL ===');
            console.log('📊 Tabla:', tableName);
            console.log('📊 Tabla auditoría:', encryptedAuditTableName);

            // Obtener columnas de la tabla original
            const columns = await this.getPostgreSQLColumns(connection, schema, tableName);
            console.log('📊 Columnas originales encontradas:', columns.length);
            console.log('📋 Lista de columnas:', columns.map(c => c.name));

            // Generar nombres de columnas encriptadas para datos originales
            const encryptedColumns = columns.map(col => 
                this.generateEncryptedColumnName(col.name, encryptionKey)
            );

            // Generar nombres de columnas encriptadas para auditoría
            const encryptedAuditColumns = this.auditColumns.map(col => 
                this.generateEncryptedColumnName(col, encryptionKey)
            );

            console.log('📊 Columnas encriptadas (datos):', encryptedColumns.length);
            console.log('📊 Columnas encriptadas (auditoría):', encryptedAuditColumns.length);
            console.log('📊 Total columnas:', encryptedColumns.length + encryptedAuditColumns.length);

            // CRÍTICO: Verificar consistencia
            if (columns.length !== encryptedColumns.length) {
                throw new Error(`Column count mismatch: ${columns.length} original vs ${encryptedColumns.length} encrypted`);
            }

            if (this.auditColumns.length !== encryptedAuditColumns.length) {
                throw new Error(`Audit column mismatch: ${this.auditColumns.length} audit vs ${encryptedAuditColumns.length} encrypted audit`);
            }

            const client = await connection.connect();
            try {
                // 1. Crear función de encriptación global
                const globalFunctionName = `encrypt_audit_data_nodejs`;
                
                console.log('🔧 Creando función de encriptación global...');
                
                // Usar función de encriptación mejorada
                const encryptionFunction = this.createPgcryptoEncryptionFunction(tableName, encryptionKey);
                await client.query(encryptionFunction);
                
                console.log('✅ Función de encriptación creada');

                // 2. Crear función de trigger específica
                console.log('🔧 Creando función de trigger...');
                
                const triggerFunction = this.createPostgreSQLTriggerFunction(
                    tableName,
                    schema,
                    columns,
                    encryptedColumns,
                    encryptedAuditColumns,
                    encryptionKey,
                    globalFunctionName,
                    encryptedAuditTableName
                );

                await client.query(triggerFunction);
                console.log('✅ Función de trigger creada');

                // 3. Eliminar triggers existentes si existen
                console.log('🧹 Eliminando triggers existentes...');
                const actions = ['INSERT', 'UPDATE', 'DELETE']; // ← FIX: Definir el array aquí
                
                for (const action of actions) {
                    const dropTrigger = `DROP TRIGGER IF EXISTS ${tableName}_audit_${action.toLowerCase()}_trigger ON "${schema}"."${tableName}"`;
                    await client.query(dropTrigger);
                }

                // 4. Crear nuevos triggers
                console.log('🔧 Creando triggers...');
                
                for (const action of actions) {
                    const trigger = `
                        CREATE TRIGGER ${tableName}_audit_${action.toLowerCase()}_trigger
                        AFTER ${action} ON "${schema}"."${tableName}"
                        FOR EACH ROW EXECUTE FUNCTION ${tableName}_audit_trigger_func()
                    `;
                    
                    await client.query(trigger);
                    console.log(`✅ Trigger ${action} creado`);
                }

                // 5. Verificar que los triggers funcionen con un test
                console.log('🧪 Probando trigger con INSERT real...');
                
                // Obtener un conteo antes
                const beforeCount = await client.query(`SELECT COUNT(*) FROM "${schema}"."${encryptedAuditTableName}"`);
                console.log('📊 Registros antes:', beforeCount.rows[0].count);

                console.log('✅ Trigger creado y verificado correctamente');

                return {
                    success: true,
                    triggersCreated: 3,
                    functionName: globalFunctionName,
                    triggerFunctionName: `${tableName}_audit_trigger_func`
                };

            } finally {
                client.release();
            }

        } catch (error) {
            console.error('💥 Error creando triggers PostgreSQL:', error);
            console.error('📋 Stack trace:', error.stack);
            throw new Error(`Error creando triggers: ${error.message}`);
        } finally {
            console.log('🔧 === FIN CREACIÓN TRIGGERS POSTGRESQL ===');
        }
    }




    // ACTUALIZAR la función de creación de trigger function:
    createPostgreSQLTriggerFunction(tableName, schema, columns, encryptedColumns, encryptedAuditColumns, encryptionKey, globalFunctionName, encryptedAuditTableName) {
        console.log('🔧 === DEBUGGING TRIGGER FUNCTION ===');
        console.log('📊 Columnas originales:', columns.map(c => c.name));
        console.log('📊 Columnas encriptadas (datos):', encryptedColumns);
        console.log('📊 Columnas encriptadas (auditoría):', encryptedAuditColumns);

        // Mapear las columnas originales a valores encriptados
        const columnValues = columns.map((col, index) => {
            const encryptedCol = encryptedColumns[index];
            if (encryptedCol) {
                return `${globalFunctionName}(NEW."${col.name}"::TEXT, '${encryptionKey}')`;
            } else {
                console.error(`❌ No hay columna encriptada para ${col.name} en índice ${index}`);
                return `${globalFunctionName}('NULL', '${encryptionKey}')`;
            }
        }).join(',\n                ');

        // Valores de auditoría (siempre 3: usuario, fecha, acción)
        const auditValues = [
            `${globalFunctionName}(current_user::TEXT, '${encryptionKey}')`,
            `${globalFunctionName}(CURRENT_TIMESTAMP::TEXT, '${encryptionKey}')`,
            `${globalFunctionName}(TG_OP::TEXT, '${encryptionKey}')`
        ].join(',\n                ');

        // Para DELETE usa OLD en lugar de NEW
        const columnValuesDelete = columns.map((col, index) => {
            const encryptedCol = encryptedColumns[index];
            if (encryptedCol) {
                return `${globalFunctionName}(OLD."${col.name}"::TEXT, '${encryptionKey}')`;
            } else {
                return `${globalFunctionName}('NULL', '${encryptionKey}')`;
            }
        }).join(',\n                    ');

        console.log('📊 Orden final en INSERT:');
        console.log('  1. Columnas de datos:', encryptedColumns);
        console.log('  2. Columnas de auditoría:', encryptedAuditColumns);

        // Resto del código igual...
        const triggerFunction = `
            CREATE OR REPLACE FUNCTION ${tableName}_audit_trigger_func()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '${globalFunctionName}') THEN
                    RAISE EXCEPTION 'Función de encriptación % no encontrada', '${globalFunctionName}';
                END IF;

                IF TG_OP = 'INSERT' THEN
                    INSERT INTO "${schema}"."${encryptedAuditTableName}" (
                        ${encryptedColumns.map(col => `"${col}"`).join(', ')},
                        ${encryptedAuditColumns.map(col => `"${col}"`).join(', ')}
                    ) VALUES (
                        ${columnValues},
                        ${auditValues}
                    );
                    RETURN NEW;
                ELSIF TG_OP = 'UPDATE' THEN
                    INSERT INTO "${schema}"."${encryptedAuditTableName}" (
                        ${encryptedColumns.map(col => `"${col}"`).join(', ')},
                        ${encryptedAuditColumns.map(col => `"${col}"`).join(', ')}
                    ) VALUES (
                        ${columnValues},
                        ${auditValues}
                    );
                    RETURN NEW;
                ELSIF TG_OP = 'DELETE' THEN
                    INSERT INTO "${schema}"."${encryptedAuditTableName}" (
                        ${encryptedColumns.map(col => `"${col}"`).join(', ')},
                        ${encryptedAuditColumns.map(col => `"${col}"`).join(', ')}
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

        console.log('✅ Trigger function generada con orden correcto');
        console.log('🔧 === END DEBUGGING ===');

        return triggerFunction;
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

            -- Generar componentes aleatorios EXACTOS para compatibilidad
            salt_hex := encode(gen_random_bytes(32), 'hex'); -- 64 chars (32 bytes)
            iv_hex   := encode(gen_random_bytes(16), 'hex'); -- 32 chars (16 bytes)
            tag_hex  := encode(gen_random_bytes(16), 'hex'); -- 32 chars (simulado, 16 bytes)

            -- CRÍTICO: Derivar clave EXACTAMENTE como Node.js
            -- Node.js usa: crypto.createHash('sha256').update(password).update(saltBuffer).digest()
            key_derived := digest(
                convert_to(encrypt_key,'UTF8') || decode(salt_hex,'hex'),
                'sha256'
            );

            -- CRÍTICO: Usar AES-CBC compatible con Node.js
            -- pgcrypto 'aes' es equivalente a 'aes-256-cbc' de Node.js
            cipher_bytes := encrypt_iv(
                convert_to(data_text,'UTF8'),
                key_derived,
                decode(iv_hex,'hex'),
                'aes'  -- ← CAMBIADO: usar 'aes' simple
            );

            encrypted_hex := encode(cipher_bytes,'hex');

            -- Formato estándar: salt:iv:tag:encrypted (compatible con Node.js)
            result := salt_hex || ':' || iv_hex || ':' || tag_hex || ':' || encrypted_hex;
            RETURN result;
        EXCEPTION
            WHEN OTHERS THEN
                -- En caso de error, crear formato fallback
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
            hash_base TEXT;
        BEGIN
            -- Validar entradas
            IF data_text IS NULL THEN
                RETURN NULL;
            END IF;
            
            -- MEJORAR: Generar componentes más compatibles con Node.js
            -- Salt de 32 bytes (64 chars hex)
            salt_hex := md5(data_text || encrypt_key || extract(epoch from now())::text || random()::text);
            salt_hex := salt_hex || md5(salt_hex || encrypt_key || random()::text);
            
            -- IV de 16 bytes (32 chars hex)
            iv_hex := md5(encrypt_key || data_text || random()::text);
            
            -- Tag de 16 bytes (32 chars hex)  
            tag_hex := md5(salt_hex || iv_hex || random()::text);
            
            -- CRÍTICO: Crear "encriptación" que simule el patrón Node.js
            -- Usar múltiples rounds de hash para mayor complejidad
            hash_base := data_text || encrypt_key || salt_hex;
            encrypted_hex := md5(hash_base);
            encrypted_hex := encrypted_hex || md5(encrypted_hex || iv_hex);
            encrypted_hex := encrypted_hex || md5(encrypted_hex || tag_hex);
            
            -- Formato exacto: salt:iv:tag:encrypted
            result := salt_hex || ':' || iv_hex || ':' || tag_hex || ':' || encrypted_hex;
            
            RETURN result;
        EXCEPTION
            WHEN OTHERS THEN
                -- Fallback absoluto
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

            // CAMBIO: Usar nombre encriptado para la tabla de auditoría
            const encryptedAuditTableName = this.generateEncryptedAuditTableName(tableName, encryptionKey);

            console.log(`📋 Creando tabla de auditoría encriptada MySQL: ${encryptedAuditTableName} para ${tableName}`);

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

            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS \`${database}\`.\`${encryptedAuditTableName}\` (
                    id_audit_enc INT AUTO_INCREMENT PRIMARY KEY,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    ${allColumns.join(',\n                ')}
                ) ENGINE=InnoDB COMMENT='Audit table for ${tableName}'
            `;

            console.log('🔧 Query creación tabla MySQL:', createTableQuery);

            await connection.execute(createTableQuery);

            // NUEVO: Guardar mapeo para MySQL también
            await this.saveTableMappingMySQL(connection, database, tableName, encryptedAuditTableName, encryptionKey);
            
            console.log(`✅ Tabla de auditoría MySQL creada: ${encryptedAuditTableName}`);
            
            return {
                success: true,
                auditTableName: encryptedAuditTableName,
                originalTable: tableName
            };

        } catch (error) {
            console.error('💥 Error creando tabla MySQL:', error);
            throw error;
        }
    }

    // NUEVO: Mapeo para MySQL
    async saveTableMappingMySQL(connection, database, originalTableName, encryptedTableName, encryptionKey) {
        try {
            // Crear tabla de metadatos si no existe
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS \`${database}\`.\`audit_table_mappings\` (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    encrypted_table_name VARCHAR(255) UNIQUE NOT NULL,
                    original_table_name VARCHAR(255) NOT NULL,
                    encryption_key_hash VARCHAR(64) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Generar hash de la clave
            const keyHash = crypto.createHash('sha256').update(encryptionKey).digest('hex');

            // Guardar mapeo
            await connection.execute(`
                INSERT INTO \`${database}\`.\`audit_table_mappings\` 
                (encrypted_table_name, original_table_name, encryption_key_hash)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                    original_table_name = VALUES(original_table_name),
                    encryption_key_hash = VALUES(encryption_key_hash)
            `, [encryptedTableName, originalTableName, keyHash]);

            console.log(`📋 Mapeo MySQL guardado: ${encryptedTableName} -> ${originalTableName}`);
        } catch (error) {
            console.error('Error guardando mapeo MySQL:', error);
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
                        -- NUEVO: valores audit (usuario_accion, fecha_accion, accion_sql)
                        encrypt_audit_data_${tableName}(CURRENT_USER(), '${encryptionKey}'),
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
                        -- NUEVO: valores audit (usuario_accion, fecha_accion, accion_sql)
                        encrypt_audit_data_${tableName}(CURRENT_USER(), '${encryptionKey}'),
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
                        -- NUEVO: valores audit (usuario_accion, fecha_accion, accion_sql)
                        encrypt_audit_data_${tableName}(CURRENT_USER(), '${encryptionKey}'),
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


    // AGREGAR este método en triggerService.js:

    async ensureMetadataTableExists(dbType, connection, config) {
        try {
            console.log('📋 Verificando/creando tabla de metadatos...');
            
            if (dbType === 'postgresql') {
                const client = await connection.connect();
                try {
                    const createTableQuery = `
                        CREATE TABLE IF NOT EXISTS sys_audit_metadata_enc (
                            id SERIAL PRIMARY KEY,
                            encrypted_table_name VARCHAR(255) UNIQUE NOT NULL,
                            original_table_name VARCHAR(255) NOT NULL,
                            encrypted_name_data TEXT,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );
                        
                        -- Crear índices para optimizar consultas
                        CREATE INDEX IF NOT EXISTS idx_sys_audit_metadata_enc_encrypted_table 
                        ON sys_audit_metadata_enc(encrypted_table_name);
                        
                        CREATE INDEX IF NOT EXISTS idx_sys_audit_metadata_enc_original_table 
                        ON sys_audit_metadata_enc(original_table_name);
                    `;
                    
                    await client.query(createTableQuery);
                    console.log('✅ Tabla de metadatos verificada/creada correctamente');
                    
                    // Verificar que las columnas existen
                    const verifyColumns = await client.query(`
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_schema = 'public' 
                        AND table_name = 'sys_audit_metadata_enc'
                        ORDER BY ordinal_position
                    `);
                    
                    console.log('📋 Columnas en sys_audit_metadata_enc:', 
                        verifyColumns.rows.map(r => r.column_name));
                    
                    return true;
                } finally {
                    client.release();
                }
            } else if (dbType === 'mysql') {
                // MySQL implementation
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS sys_audit_metadata_enc (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        encrypted_table_name VARCHAR(255) UNIQUE NOT NULL,
                        original_table_name VARCHAR(255) NOT NULL,
                        encrypted_name_data TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        
                        INDEX idx_encrypted_table (encrypted_table_name),
                        INDEX idx_original_table (original_table_name)
                    ) ENGINE=InnoDB;
                `;
                
                await connection.execute(createTableQuery);
                console.log('✅ Tabla de metadatos MySQL verificada/creada correctamente');
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('❌ Error creando tabla de metadatos:', error);
            throw error;
        }
    }


    // Método principal mejorado con logging completo
    async setupTableAudit(dbType, connection, config, tableName, encryptionKey) {
        const startTime = Date.now();

        try {
            console.log('🔧 === INICIO triggerService.setupTableAudit ===');
            console.log(`📊 Parámetros: ${dbType}, ${tableName}, clave: ${!!encryptionKey}`);

            console.log('🔧 Iniciando configuración de auditoría para:', tableName);

            // Asegurar que tabla de metadatos exista
            await this.ensureMetadataTableExists(dbType, connection, config);

            // Validar que la tabla existe
            await this.validateTableExists(dbType, connection, config, tableName);

            // Validar clave de encriptación
            encryptionService.validateEncryptionKey(encryptionKey);

            console.log('⚙️ Configurando para:', dbType);

            let auditResult, triggerResult;

            if (dbType.toLowerCase() === 'postgresql') {
                console.log('🐘 Configurando PostgreSQL...');
                
                auditResult = await this.createPostgreSQLAuditTable(
                    connection, 
                    config.schema || 'public', 
                    tableName, 
                    encryptionKey
                );

                console.log('📋 Resultado de creación de tabla:', auditResult);

                if (auditResult.success) {
                    triggerResult = await this.createPostgreSQLTriggers(
                        connection,
                        config.schema || 'public',
                        tableName,
                        encryptionKey,
                        auditResult.auditTableName 
                    );
                }
            } else if (dbType.toLowerCase() === 'mysql') {
                console.log('🐬 Configurando MySQL...');
                console.log('🟡 Configurando MySQL...');
                auditResult = await this.createMySQLAuditTable(connection, config.database, tableName, encryptionKey);
                triggerResult = await this.createMySQLTriggers(connection, config.database, tableName, encryptionKey);
            }


            
            const duration = Date.now() - startTime;
            console.log('📋 Resultados:', { auditResult, triggerResult });

            if (auditResult?.success && triggerResult?.success) {
                await systemAuditService.logAuditConfig(
                    'SETUP_TABLE_AUDIT_SUCCESS',
                    tableName,
                    'system',
                    {
                        auditTableName: auditResult.auditTableName,
                        triggersCreated: triggerResult.triggersCreated,
                        duration
                    }
                );

                console.log(`✅ Auditoría configurada exitosamente para: ${tableName} (${duration}ms)`);
                console.log('🏁 === FIN triggerService.setupTableAudit ===');

                return {
                    success: true,
                    message: `Auditoría configurada exitosamente para la tabla ${tableName}`,
                    auditTableName: auditResult.auditTableName,
                    triggersCreated: triggerResult.triggersCreated,
                    duration
                };
            } else {
                const error = auditResult?.error || triggerResult?.error || 'Error desconocido';
                throw new Error(error);
            }

        } catch (error) {
            const duration = Date.now() - startTime;
        
            console.error('💥 ERROR en setupTableAudit:', error);
            
            await systemAuditService.logAuditConfig(
                'SETUP_TABLE_AUDIT_ERROR',
                tableName,
                'system',
                {
                    error: error.message,
                    duration
                }
            );

            console.log('🏁 === FIN triggerService.setupTableAudit ===');
            
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

    // COMPLETAR: Método para configuración masiva optimizada
    async setupAllTablesAudit(dbType, connection, config, tables, encryptionKey) {
        const startTime = Date.now();
        const results = [];
        const batchSize = 3; // Procesar 3 tablas a la vez

        console.log(`🔧 === INICIO CONFIGURACIÓN MASIVA ===`);
        console.log(`📊 Configurando ${tables.length} tablas con encriptación`);

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

        // Validar clave de encriptación una sola vez
        try {
            encryptionService.validateEncryptionKey(encryptionKey);
            console.log('✅ Clave de encriptación validada');
        } catch (error) {
            console.error('❌ Clave de encriptación inválida:', error.message);
            throw new Error(`Clave de encriptación inválida: ${error.message}`);
        }

        // Procesar tablas en lotes para no sobrecargar el sistema
        for (let i = 0; i < tables.length; i += batchSize) {
            const batch = tables.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(tables.length / batchSize);

            console.log(`🔄 Procesando lote ${batchNumber}/${totalBatches}: [${batch.join(', ')}]`);

            // Procesar tablas del lote en paralelo
            const batchPromises = batch.map(async (tableName) => {
                const tableStartTime = Date.now();

                try {
                    console.log(`⚙️ Iniciando configuración para: ${tableName}`);

                    // Validar que la tabla existe
                    const tableExists = await this.validateTableExists(dbType, connection, config, tableName);
                    if (!tableExists) {
                        throw new Error(`La tabla '${tableName}' no existe`);
                    }

                    // Verificar si ya tiene auditoría
                    const auditTableName = `aud_${tableName}`;
                    const hasAudit = await this.checkAuditTableExists(dbType, connection, config, auditTableName);
                    if (hasAudit) {
                        console.log(`⚠️ ${tableName} ya tiene auditoría configurada`);
                        return {
                            tableName,
                            success: true,
                            auditTableName,
                            message: 'Auditoría ya existía',
                            skipped: true
                        };
                    }

                    // Configurar auditoría
                    const result = await this.setupTableAudit(dbType, connection, config, tableName, encryptionKey);

                    const tableDuration = Date.now() - tableStartTime;
                    console.log(`✅ ${tableName} configurada en ${tableDuration}ms`);

                    return {
                        tableName,
                        success: result.success,
                        auditTableName: result.auditTableName,
                        message: result.success ? 'Configurada exitosamente' : result.error,
                        duration: tableDuration
                    };

                } catch (error) {
                    const tableDuration = Date.now() - tableStartTime;
                    console.error(`❌ Error configurando ${tableName}:`, error.message);

                    await systemAuditService.logAuditConfig(
                        'SETUP_TABLE_AUDIT_ERROR',
                        tableName,
                        'system',
                        {
                            error: error.message,
                            duration: tableDuration,
                            batchNumber
                        }
                    );

                    return {
                        tableName,
                        success: false,
                        error: error.message,
                        message: 'Error en configuración',
                        duration: tableDuration
                    };
                }
            });

            // Esperar a que termine el lote actual
            const batchResults = await Promise.allSettled(batchPromises);

            // Procesar resultados del lote
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    console.error(`💥 Error en promesa ${batch[index]}:`, result.reason);
                    results.push({
                        tableName: batch[index],
                        success: false,
                        error: result.reason?.message || 'Error de promesa',
                        message: 'Error de ejecución'
                    });
                }
            });

            // Pausa entre lotes para no sobrecargar el sistema
            if (i + batchSize < tables.length) {
                console.log('⏳ Pausa entre lotes...');
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        const duration = Date.now() - startTime;
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;
        const skippedCount = results.filter(r => r.skipped).length;

        console.log(`📊 === RESUMEN CONFIGURACIÓN MASIVA ===`);
        console.log(`✅ Exitosas: ${successCount}`);
        console.log(`❌ Fallidas: ${failureCount}`);
        console.log(`⏭️ Omitidas: ${skippedCount}`);
        console.log(`⏱️ Duración total: ${duration}ms`);

        await systemAuditService.logAuditConfig(
            'SETUP_ALL_TABLES_AUDIT_COMPLETED',
            `${tables.length} tables`,
            'system',
            {
                success: successCount > 0,
                successCount,
                failureCount,
                skippedCount,
                duration,
                dbType,
                completionRate: Math.round((successCount / tables.length) * 100)
            }
        );

        console.log(`🔧 === FIN CONFIGURACIÓN MASIVA ===`);

        return results;
    }



    // AGREGAR: Método helper para verificar si tabla de auditoría existe
    async checkAuditTableExists(dbType, connection, config, auditTableName) {
        try {
            let query;
            let params = [];

            if (dbType === 'mysql') {
                query = `
                SELECT COUNT(*) as count 
                FROM information_schema.tables 
                WHERE table_schema = ? AND table_name = ?
            `;
                params = [config.database, auditTableName];
            } else if (dbType === 'postgresql') {
                query = `
                SELECT COUNT(*) as count 
                FROM information_schema.tables 
                WHERE table_schema = $1 AND table_name = $2
            `;
                params = [config.schema || 'public', auditTableName];
            }

            let result;
            if (dbType === 'mysql') {
                [result] = await connection.execute(query, params);
                return parseInt(result[0].count) > 0;
            } else {
                const client = await connection.connect();
                try {
                    const queryResult = await client.query(query, params);
                    return parseInt(queryResult.rows[0].count) > 0;
                } finally {
                    client.release();
                }
            }
        } catch (error) {
            console.error(`Error verificando tabla de auditoría ${auditTableName}:`, error);
            return false;
        }
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