const crypto = require('crypto');
const encryptionService = require('./encryptionService');
const triggerService = require('./triggerService');
const systemAuditService = require('./systemAuditService');


class AuditService {
    constructor() {
        this.auditTablePrefix = 'aud_';
    }

    // Listar todas las tablas de auditoría
    async getAuditTables(dbType, connection, config) {
        try {
            let query;
            let params = [];

            if (dbType === 'mysql') {
                // Para MySQL mantener formato actual pero buscar tablas encriptadas también
                query = `
                    SELECT 
                        table_name,
                        table_rows as record_count,
                        CASE 
                            WHEN table_name LIKE 'aud_%' THEN SUBSTRING(table_name, 5)
                            WHEN table_name REGEXP '^t[0-9a-f]{32}$' THEN 'ENCRYPTED'
                            ELSE table_name
                        END as original_table_guess
                    FROM information_schema.tables 
                    WHERE table_schema = ? 
                    AND (table_name LIKE 'aud_%' OR table_name REGEXP '^t[0-9a-f]{32}$')
                    ORDER BY table_name
                `;
                params = [config.database];
            } else if (dbType === 'postgresql') {
                // ✅ CORREGIR: Query más simple que no dependa de tabla de mapeo que puede no existir
                query = `
                    SELECT 
                        t.tablename as table_name,
                        CASE 
                            WHEN t.tablename LIKE 'aud_%' THEN SUBSTRING(t.tablename, 5)
                            WHEN t.tablename ~ '^t[0-9a-f]{32}$' THEN 'ENCRYPTED_TABLE'
                            ELSE 'UNKNOWN'
                        END as original_table
                    FROM pg_tables t
                    WHERE t.schemaname = $1 
                    AND (
                        t.tablename LIKE 'aud_%' OR 
                        t.tablename ~ '^t[0-9a-f]{32}$'
                    )
                    ORDER BY t.tablename
                `;
                params = [config.schema || 'public'];
            }

            console.log('🔍 Query para obtener tablas de auditoría:', query);
            console.log('📊 Parámetros:', params);

            let result;
            if (dbType === 'mysql') {
                [result] = await connection.execute(query, params);
            } else {
                const client = await connection.connect();
                try {
                    const queryResult = await client.query(query, params);
                    result = queryResult.rows;

                    // Obtener conteo real para cada tabla
                    for (let i = 0; i < result.length; i++) {
                        try {
                            const countQuery = `SELECT COUNT(*) as count FROM "${config.schema || 'public'}"."${result[i].table_name}"`;
                            const countResult = await client.query(countQuery);
                            result[i].record_count = parseInt(countResult.rows[0].count) || 0;
                            console.log(`📊 Conteo para ${result[i].table_name}: ${result[i].record_count}`);
                        } catch (countError) {
                            console.warn(`⚠️ Error contando registros en ${result[i].table_name}:`, countError.message);
                            result[i].record_count = 0;
                        }
                    }
                } finally {
                    client.release();
                }
            }

            console.log('📋 Tablas de auditoría encontradas:', result.length);

            // ✅ CORREGIR: Mapeo debe identificar correctamente tablas encriptadas
            const auditTables = result.map(row => {
                const isEncryptedTable = row.table_name.match(/^t[0-9a-f]{32}$/);
                
                return {
                    tableName: row.table_name, // Nombre real (encriptado o aud_xxx)
                    originalTable: row.original_table || 'Desconocida', // Tabla original
                    hasEncryption: true,
                    recordCount: parseInt(row.record_count) || 0,
                    isEncrypted: isEncryptedTable ? true : false, // ✅ MARCAR CORRECTAMENTE
                    isEncryptedTable: isEncryptedTable ? true : false // ✅ NUEVA PROPIEDAD
                };
            });

            console.log('📋 Tablas de auditoría mapeadas:', auditTables);
            return auditTables;

        } catch (error) {
            console.error('💥 Error obteniendo tablas de auditoría:', error);
            throw new Error(`Error al obtener tablas de auditoría: ${error.message}`);
        }
    }


    // NUEVO: Método para obtener tabla original desde nombre encriptado
    async getOriginalTableName(dbType, connection, config, encryptedTableName, encryptionKey) {
        try {
            console.log('🔍 === INICIO getOriginalTableName MEJORADO ===');
            console.log('📊 Tabla encriptada:', encryptedTableName);

            // ESTRATEGIA 1: Buscar en metadatos CON VERIFICACIÓN DE COLUMNAS
            if (dbType === 'postgresql') {
                const client = await connection.connect();
                try {
                    // Primero verificar que la tabla y columnas existen
                    const checkTable = await client.query(`
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_schema = 'public' 
                        AND table_name = 'sys_audit_metadata_enc'
                        ORDER BY column_name
                    `);
                    
                    console.log('📋 Columnas disponibles en metadatos:', 
                        checkTable.rows.map(r => r.column_name));
                    
                    if (checkTable.rows.length > 0) {
                        // Verificar si existe la columna original_table_name
                        const hasOriginalColumn = checkTable.rows.some(
                            row => row.column_name === 'original_table_name'
                        );
                        
                        if (hasOriginalColumn) {
                            const result = await client.query(`
                                SELECT original_table_name, encrypted_name_data
                                FROM sys_audit_metadata_enc 
                                WHERE encrypted_table_name = $1
                            `, [encryptedTableName]);

                            if (result.rows.length > 0) {
                                const row = result.rows[0];
                                console.log('📋 Datos de metadatos encontrados:', row);
                                
                                // Intentar desencriptar el nombre si está encriptado
                                if (row.encrypted_name_data) {
                                    try {
                                        const decryptedName = encryptionService.decrypt(row.encrypted_name_data, encryptionKey);
                                        console.log('✅ Nombre desencriptado desde metadatos:', decryptedName);
                                        return decryptedName;
                                    } catch (decryptError) {
                                        console.warn('⚠️ Error desencriptando desde metadatos, usando nombre directo');
                                    }
                                }
                                
                                return row.original_table_name;
                            }
                        } else {
                            console.warn('⚠️ La tabla sys_audit_metadata_enc no tiene la columna original_table_name');
                        }
                    } else {
                        console.warn('⚠️ La tabla sys_audit_metadata_enc no existe o está vacía');
                    }
                } finally {
                    client.release();
                }
            }

            // ESTRATEGIA 2: Generar nombres posibles basados en el hash
            console.log('🔄 Probando estrategia de nombres comunes...');
            const commonTableNames = ['usuarios', 'personas', 'ambientes', 'clientes', 'productos'];
            
            for (const tableName of commonTableNames) {
                try {
                    // Generar el hash que debería corresponder a esta tabla
                    const expectedHash = crypto
                        .createHash('sha256')
                        .update(tableName + encryptionKey + 'audit_table')
                        .digest('hex')
                        .substring(0, 32);
                    
                    const expectedTableName = `t${expectedHash}`;
                    
                    if (expectedTableName === encryptedTableName) {
                        console.log(`✅ Tabla original encontrada por hash: ${tableName}`);
                        return tableName;
                    }
                } catch (hashError) {
                    console.warn(`⚠️ Error generando hash para ${tableName}:`, hashError.message);
                }
            }

            // ESTRATEGIA 3: Buscar en todas las tablas existentes
            console.log('🔄 Probando con todas las tablas existentes...');
            try {
                const client = await connection.connect();
                try {
                    const tablesResult = await client.query(`
                        SELECT tablename 
                        FROM pg_tables 
                        WHERE schemaname = $1 
                        AND tablename NOT LIKE 'aud_%' 
                        AND tablename NOT LIKE 't%'
                        AND tablename != 'sys_audit_metadata_enc'
                        ORDER BY tablename
                    `, [config.schema || 'public']);

                    console.log(`🔍 Probando con ${tablesResult.rows.length} tablas existentes...`);

                    for (const tableRow of tablesResult.rows) {
                        const tableName = tableRow.tablename;
                        try {
                            const expectedHash = crypto
                                .createHash('sha256')
                                .update(tableName + encryptionKey + 'audit_table')
                                .digest('hex')
                                .substring(0, 32);
                            
                            const expectedTableName = `t${expectedHash}`;
                            
                            if (expectedTableName === encryptedTableName) {
                                console.log(`✅ Tabla original encontrada: ${tableName}`);
                                
                                // Guardar en metadatos para futuras consultas
                                try {
                                    await this.saveTableMappingForRecovery(
                                        dbType, connection, config, tableName, encryptedTableName, encryptionKey
                                    );
                                } catch (saveError) {
                                    console.warn('⚠️ No se pudo guardar mapeo de recuperación:', saveError.message);
                                }
                                
                                return tableName;
                            }
                        } catch (error) {
                            // Continuar con la siguiente tabla
                        }
                    }
                } finally {
                    client.release();
                }
            } catch (dbError) {
                console.error('❌ Error consultando tablas:', dbError.message);
            }

            console.error('❌ No se pudo determinar la tabla original');
            return null;

        } catch (error) {
            console.error('💥 Error en getOriginalTableName:', error);
            return null;
        } finally {
            console.log('🔍 === FIN getOriginalTableName MEJORADO ===');
        }
    }

    // AGREGAR método helper para guardar mapeo de recuperación:
    async saveTableMappingForRecovery(dbType, connection, config, originalTableName, encryptedTableName, encryptionKey) {
        try {
            if (dbType === 'postgresql') {
                const client = await connection.connect();
                try {
                    // Asegurar que la tabla de metadatos existe
                    await triggerService.ensureMetadataTableExists(dbType, connection, config);
                    
                    // Guardar el mapeo
                    await triggerService.saveTableMapping(
                        connection, config.schema || 'public', 
                        originalTableName, encryptedTableName, encryptionKey
                    );
                    
                    console.log('✅ Mapeo de recuperación guardado exitosamente');
                } finally {
                    client.release();
                }
            }
        } catch (error) {
            console.error('❌ Error guardando mapeo de recuperación:', error);
        }
    }





    // Obtener registros de auditoría encriptados
    async getEncryptedAuditData(dbType, connection, config, auditTableName, limit = 100, offset = 0) {
        try {
            let query;
            let params = [];

            if (dbType === 'mysql') {
                query = `SELECT * FROM ${auditTableName} ORDER BY id_audit_enc DESC LIMIT ? OFFSET ?`;
                params = [limit, offset];
            } else if (dbType === 'postgresql') {
                const schema = config.schema || 'public';
                query = `SELECT * FROM ${schema}.${auditTableName} ORDER BY id_audit_enc DESC LIMIT $1 OFFSET $2`;
                params = [limit, offset];
            }

            let result;
            if (dbType === 'mysql') {
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

            // Obtener información de columnas
            const columns = await this.getAuditTableColumns(dbType, connection, config, auditTableName);

            return {
                data: result,
                columns: columns,
                totalRecords: result.length,
                isEncrypted: true
            };
        } catch (error) {
            console.error('Error obteniendo datos de auditoría encriptados:', error);
            throw new Error(`Error al obtener datos encriptados: ${error.message}`);
        }
    }



    // ✅ NUEVO: Obtener tablas de auditoría encriptadas
    async getEncryptedAuditTables(dbType, connection, config) {
        try {
            console.log('🔍 Obteniendo tablas de auditoría encriptadas...');
            
            let query;
            let params = [];

            if (dbType === 'postgresql') {
                // Buscar todas las tablas que no sean el metadata y no empiecen con 'aud_'
                query = `
                    SELECT 
                        tablename as table_name
                    FROM pg_tables 
                    WHERE schemaname = $1 
                    AND tablename != 'sys_audit_metadata_enc'
                    AND tablename NOT LIKE 'aud_%'
                    AND tablename ~ '^t[0-9a-f]{32}$'  -- Patrón de tabla encriptada
                    ORDER BY tablename
                `;
                params = [config.schema || 'public'];
            }

            const client = await connection.connect();
            try {
                const queryResult = await client.query(query, params);
                const encryptedTables = queryResult.rows;

                console.log(`📋 Encontradas ${encryptedTables.length} tablas encriptadas`);

                // Para cada tabla encriptada, obtener conteo
                for (let table of encryptedTables) {
                    try {
                        const countQuery = `SELECT COUNT(*) as count FROM "${config.schema || 'public'}"."${table.table_name}"`;
                        const countResult = await client.query(countQuery);
                        table.record_count = parseInt(countResult.rows[0].count) || 0;
                    } catch (countError) {
                        console.warn(`⚠️ Error contando registros en ${table.table_name}:`, countError.message);
                        table.record_count = 0;
                    }
                }

                // Mapear resultado para compatibilidad
                const auditTables = encryptedTables.map(row => ({
                    tableName: row.table_name,  // Nombre encriptado
                    originalTable: '[ENCRIPTADO]',  // No se puede conocer sin clave
                    hasEncryption: true,
                    recordCount: parseInt(row.record_count) || 0,
                    isEncryptedTable: true  // ✅ NUEVA PROPIEDAD
                }));

                return auditTables;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('💥 Error obteniendo tablas encriptadas:', error);
            throw new Error(`Error al obtener tablas encriptadas: ${error.message}`);
        }
    }

    // ✅ NUEVO: Obtener tablas desencriptadas con clave
    async getDecryptedAuditTables(dbType, connection, config, encryptionKey) {
        try {
            console.log('🔓 Obteniendo tablas de auditoría desencriptadas...');
            
            // Primero obtener tablas encriptadas
            const encryptedTables = await this.getEncryptedAuditTables(dbType, connection, config);
            
            const decryptedTables = [];

            // Para cada tabla encriptada, intentar obtener su mapeo
            for (const encTable of encryptedTables) {
                try {
                    const mapping = await encryptedTableMappingService.getTableMapping(
                        dbType,
                        connection,
                        config,
                        encTable.tableName,
                        encryptionKey
                    );

                    decryptedTables.push({
                        tableName: encTable.tableName,  // Nombre encriptado (para queries)
                        originalTable: mapping.originalTable,  // Nombre original desencriptado
                        displayName: mapping.auditTable,  // Nombre para mostrar (aud_xxx)
                        hasEncryption: true,
                        recordCount: encTable.recordCount,
                        isEncryptedTable: true,
                        isDecrypted: true  // ✅ MARCA COMO DESENCRIPTADO
                    });
                } catch (mappingError) {
                    console.warn(`⚠️ No se pudo desencriptar tabla ${encTable.tableName}:`, mappingError.message);
                    
                    // Mantener como encriptada si no se puede desencriptar
                    decryptedTables.push({
                        ...encTable,
                        originalTable: '[CLAVE_INCORRECTA]',
                        displayName: '[TABLA_ENCRIPTADA]',
                        isDecrypted: false
                    });
                }
            }

            console.log(`🔓 Desencriptadas: ${decryptedTables.filter(t => t.isDecrypted).length}/${encryptedTables.length}`);

            return decryptedTables;
        } catch (error) {
            console.error('💥 Error desencriptando tablas:', error);
            throw new Error(`Error al desencriptar tablas: ${error.message}`);
        }
    }



    // CORREGIR el método getDecryptedAuditData para usar mapeo consistente:
    async getDecryptedAuditData(dbType, connection, config, auditTableName, encryptionKey, limit = 100, offset = 0) {
        try {
            // console.log('🔓 === INICIO getDecryptedAuditData ===');
            // console.log('📋 Tabla de auditoría:', auditTableName);

            // // Primero obtener los datos encriptados
            // const encryptedData = await this.getEncryptedAuditData(dbType, connection, config, auditTableName, limit, offset);

            // // Obtener la tabla original usando el mapeo
            // const originalTableName = await this.getOriginalTableName(dbType, connection, config, auditTableName, encryptionKey);
            
            // if (!originalTableName) {
            //     throw new Error('No se pudo determinar la tabla original. Verifique la clave de encriptación.');
            // }

            // // ✅ CORREGIR: Extraer el nombre de tabla si viene en formato JSON
            // let cleanOriginalTableName = originalTableName;
            // if (typeof originalTableName === 'string' && originalTableName.startsWith('{')) {
            //     try {
            //         const parsed = JSON.parse(originalTableName);
            //         cleanOriginalTableName = parsed.originalTable || originalTableName;
            //     } catch (e) {
            //         console.warn('⚠️ No se pudo parsear JSON del nombre de tabla, usando como está');
            //     }
            // }

            console.log('🔓 === INICIO getDecryptedAuditData ===');
            console.log('📋 Tabla de auditoría:', auditTableName);

            // Primero obtener los datos encriptados
            const encryptedData = await this.getEncryptedAuditData(dbType, connection, config, auditTableName, limit, offset);

            // Obtener la tabla original usando el mapeo
            const originalTableName = await this.getOriginalTableName(dbType, connection, config, auditTableName, encryptionKey);
            
            if (!originalTableName) {
                throw new Error('No se pudo determinar la tabla original. Verifique la clave de encriptación.');
            }

            // ✅ CORREGIR: Extraer el nombre de tabla si viene en formato JSON
            let cleanOriginalTableName = originalTableName;
            if (typeof originalTableName === 'string' && originalTableName.startsWith('{')) {
                try {
                    const parsed = JSON.parse(originalTableName);
                    cleanOriginalTableName = parsed.originalTable || originalTableName;
                    console.log('📋 Nombre de tabla extraído del JSON:', cleanOriginalTableName);
                } catch (e) {
                    console.warn('⚠️ No se pudo parsear JSON del nombre de tabla, usando como está');
                }
            }

            console.log('📋 Tabla original determinada:', cleanOriginalTableName);

            // ✅ CRÍTICO: Obtener TODAS las columnas EN EL MISMO ORDEN que se crearon
            const originalColumns = await this.getOriginalTableColumns(dbType, connection, config, cleanOriginalTableName);
            const auditColumns = ['usuario_accion', 'fecha_accion', 'accion_sql'];
            
            // ✅ CAMBIO PRINCIPAL: Combinar TODAS las columnas EN EL ORDEN CORRECTO
            const allOriginalColumns = [
                ...originalColumns.map(col => col.name), // ← TODAS las columnas de la tabla original
                ...auditColumns                          // ← Más las columnas de auditoría
            ];

            console.log('📋 Columnas de la tabla original:', originalColumns.map(col => col.name));
            console.log('📋 Columnas de auditoría:', auditColumns);
            console.log('📋 TOTAL de columnas a desencriptar:', allOriginalColumns);

            // ✅ CREAR MAPEO CONSISTENTE: columna encriptada -> columna original
            const columnMapping = await this.createConsistentColumnMapping(
                dbType, connection, config, cleanOriginalTableName, allOriginalColumns, encryptionKey
            );

            console.log('📋 Mapeo de columnas creado:', columnMapping);

            // Verificar datos encriptados
            if (encryptedData.data.length === 0) {
                return {
                    data: [],
                    columns: [
                        { name: 'id_audit_enc', type: 'int' },
                        { name: 'created_at', type: 'timestamp' },
                        ...originalColumns.map(col => ({ name: col.name, type: col.type })),
                        ...auditColumns.map(col => ({ name: col, type: 'text' }))
                    ],
                    originalColumns: allOriginalColumns,
                    originalTableName: cleanOriginalTableName,
                    totalRecords: 0,
                    isEncrypted: false
                };
            }

            // ✅ DESENCRIPTAR usando el mapeo consistente
            const decryptedData = [];

            for (const encryptedRow of encryptedData.data) {
                const decryptedRow = {
                    id_audit_enc: encryptedRow.id_audit_enc,
                    created_at: encryptedRow.created_at
                };

                // ✅ USAR MAPEO CONSISTENTE para desencriptar
                for (const originalColumnName of allOriginalColumns) {
                    const encryptedColumnName = columnMapping[originalColumnName];
                    
                    if (encryptedColumnName && encryptedRow[encryptedColumnName] !== undefined) {
                        const encryptedValue = encryptedRow[encryptedColumnName];
                        
                        console.log(`🔍 Desencriptando ${originalColumnName} desde ${encryptedColumnName}`);

                        if (encryptedValue && encryptedValue !== null) {
                            try {
                                const decryptedValue = encryptionService.decrypt(encryptedValue, encryptionKey);
                                decryptedRow[originalColumnName] = decryptedValue;
                                console.log(`✅ ${originalColumnName}: ${decryptedValue}`);
                            } catch (decryptError) {
                                console.warn(`⚠️ Error desencriptando ${originalColumnName}:`, decryptError.message);
                                decryptedRow[originalColumnName] = `[ERROR: ${decryptError.message}]`;
                            }
                        } else {
                            decryptedRow[originalColumnName] = null;
                        }
                    } else {
                        console.warn(`⚠️ No hay mapeo para columna ${originalColumnName}`);
                        decryptedRow[originalColumnName] = '[NO_MAPPING]';
                    }
                }

                decryptedData.push(decryptedRow);
            }

            console.log('✅ Filas desencriptadas:', decryptedData.length);
            console.log('📋 Ejemplo de fila desencriptada:', decryptedData[0]);
            console.log('🔓 === FIN getDecryptedAuditData ===');

            return {
                data: decryptedData,
                columns: [
                    { name: 'id_audit_enc', type: 'int' },
                    { name: 'created_at', type: 'timestamp' },
                    ...originalColumns.map(col => ({ name: col.name, type: col.type })),
                    ...auditColumns.map(col => ({ name: col, type: 'text' }))
                ],
                originalColumns: allOriginalColumns,
                originalTableName: cleanOriginalTableName,
                totalRecords: decryptedData.length,
                isEncrypted: false
            };

        } catch (error) {
            console.error('💥 Error desencriptando datos de auditoría:', error);

            if (error.message.includes('desencriptación') || error.message.includes('bad decrypt')) {
                throw new Error('Error en la desencriptación. Verifique la clave de encriptación.');
            }

            throw new Error(`Error al desencriptar datos: ${error.message}`);
        }
    }

    // ✅ AGREGAR: Método para crear mapeo consistente de columnas
    async createConsistentColumnMapping(dbType, connection, config, tableName, allColumns, encryptionKey) {
        const mapping = {};
        
        try {
            // ✅ GENERAR nombres encriptados EN EL MISMO ORDEN que en triggerService
            for (let i = 0; i < allColumns.length; i++) {
                const columnName = allColumns[i];
                
                // Usar el MISMO algoritmo que en triggerService para generar nombres encriptados
                const hash = crypto
                    .createHash('sha256')
                    .update(columnName + encryptionKey)
                    .digest('hex')
                    .substring(0, 12);
                
                const encryptedColumnName = `enc_${hash}`;
                mapping[columnName] = encryptedColumnName;
                
                console.log(`📋 Mapeo: ${columnName} -> ${encryptedColumnName}`);
            }
            
            return mapping;
        } catch (error) {
            console.error('❌ Error creando mapeo de columnas:', error);
            throw new Error('Error creando mapeo de columnas');
        }
    }


    // Obtener columnas de tabla de auditoría
    async getAuditTableColumns(dbType, connection, config, auditTableName) {
        try {
            let query;
            let params = [];

            if (dbType === 'mysql') {
                query = `
          SELECT column_name, column_type 
          FROM information_schema.columns 
          WHERE table_schema = ? AND table_name = ?
          ORDER BY ordinal_position
        `;
                params = [config.database, auditTableName];
            } else if (dbType === 'postgresql') {
                query = `
          SELECT column_name, data_type as column_type
          FROM information_schema.columns 
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position
        `;
                params = [config.schema || 'public', auditTableName];
            }

            let result;
            if (dbType === 'mysql') {
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

            return result.map(row => ({
                name: row.column_name,
                type: row.column_type
            }));
        } catch (error) {
            console.error('Error obteniendo columnas de auditoría:', error);
            throw new Error(`Error al obtener estructura de auditoría: ${error.message}`);
        }
    }

    // Obtener columnas de tabla original
    async getOriginalTableColumns(dbType, connection, config, tableName) {
        try {
            let query;
            let params = [];

            if (dbType === 'mysql') {
                query = `
          SELECT column_name, column_type 
          FROM information_schema.columns 
          WHERE table_schema = ? AND table_name = ?
          ORDER BY ordinal_position
        `;
                params = [config.database, tableName];
            } else if (dbType === 'postgresql') {
                query = `
          SELECT column_name, data_type as column_type
          FROM information_schema.columns 
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position
        `;
                params = [config.schema || 'public', tableName];
            }

            let result;
            if (dbType === 'mysql') {
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

            return result.map(row => ({
                name: row.column_name,
                type: row.column_type
            }));
        } catch (error) {
            console.error('Error obteniendo columnas originales:', error);
            throw new Error(`Error al obtener estructura original: ${error.message}`);
        }
    }

    // Validar contraseña de encriptación
    async validateEncryptionPassword(dbType, connection, config, auditTableName, encryptionKey) {
        try {
            console.log('🔍 === INICIO validateEncryptionPassword ===');
            console.log('📊 Tabla:', auditTableName, 'Clave:', !!encryptionKey);

            // Obtener una muestra pequeña de datos
            const encryptedData = await this.getEncryptedAuditData(dbType, connection, config, auditTableName, 1, 0);

            if (encryptedData.data.length === 0) {
                console.log('⚠️ No hay datos para validar');
                return { valid: true, message: 'No hay datos para validar' };
            }

            const firstRow = encryptedData.data[0];
            console.log('📋 Primera fila keys:', Object.keys(firstRow));

            // CORREGIR: Filtrar SOLO las columnas encriptadas (que empiezan con 'enc_')
            const encryptedColumns = Object.keys(firstRow).filter(col =>
                col.startsWith('enc_') &&
                firstRow[col] !== null &&
                firstRow[col] !== undefined &&
                typeof firstRow[col] === 'string'
            );

            console.log('🔐 Columnas encriptadas encontradas:', encryptedColumns);

            if (encryptedColumns.length === 0) {
                console.log('⚠️ No se encontraron columnas encriptadas válidas');
                return { valid: false, message: 'No se encontraron columnas encriptadas' };
            }

            // Probar desencriptar la primera columna encriptada
            const testColumn = encryptedColumns[0];
            const testValue = firstRow[testColumn];

            console.log('🧪 Probando desencriptar columna:', testColumn);
            console.log('🧪 Valor a probar:', typeof testValue, testValue?.substring(0, 50));

            try {
                const result = encryptionService.decrypt(testValue, encryptionKey);
                console.log('✅ Desencriptación exitosa:', result?.substring(0, 20));
                return { valid: true, message: 'Contraseña válida' };
            } catch (decryptError) {
                console.error('❌ Error en desencriptación:', decryptError.message);
                return { valid: false, message: 'Contraseña incorrecta' };
            }

        } catch (error) {
            console.error('💥 Error validando contraseña:', error);
            return { valid: false, message: 'Error en validación' };
        } finally {
            console.log('🔍 === FIN validateEncryptionPassword ===');
        }
    }

    // Obtener estadísticas de auditoría
    async getAuditStatistics(dbType, connection, config, auditTableName) {
        try {
            let countQuery;
            let actionQuery;
            let params = [];

            if (dbType === 'mysql') {
                countQuery = `SELECT COUNT(*) as total FROM ${auditTableName}`;
                actionQuery = `
          SELECT 'UPDATE' as action, COUNT(*) as count FROM ${auditTableName}
          UNION ALL
          SELECT 'DELETE' as action, COUNT(*) as count FROM ${auditTableName}
        `;
            } else if (dbType === 'postgresql') {
                const schema = config.schema || 'public';
                countQuery = `SELECT COUNT(*) as total FROM ${schema}.${auditTableName}`;
                actionQuery = `
          SELECT 'UPDATE' as action, COUNT(*) as count FROM ${schema}.${auditTableName}
          UNION ALL
          SELECT 'DELETE' as action, COUNT(*) as count FROM ${schema}.${auditTableName}
        `;
            }

            let totalResult, actionResult;

            if (dbType === 'mysql') {
                [totalResult] = await connection.execute(countQuery);
                [actionResult] = await connection.execute(actionQuery);
            } else {
                const client = await connection.connect();
                try {
                    const totalQueryResult = await client.query(countQuery);
                    const actionQueryResult = await client.query(actionQuery);
                    totalResult = totalQueryResult.rows;
                    actionResult = actionQueryResult.rows;
                } finally {
                    client.release();
                }
            }

            return {
                totalRecords: totalResult[0].total,
                actionCounts: actionResult,
                tableName: auditTableName,
                isEncrypted: true
            };
        } catch (error) {
            console.error('Error obteniendo estadísticas:', error);
            throw new Error(`Error al obtener estadísticas: ${error.message}`);
        }
    }

    // Eliminar tabla de auditoría
    // VERIFICAR que este método esté completo en auditService.js:
    async removeAuditTable(dbType, connection, config, auditTableName) {
        try {
            console.log('🗑️ === INICIO ELIMINACIÓN AUDITORÍA ===');
            console.log('📊 Eliminando auditoría:', auditTableName);
            
            const originalTableName = auditTableName.replace(this.auditTablePrefix, '');
            console.log('📋 Tabla original:', originalTableName);

            if (dbType === 'mysql') {
                // Eliminar triggers MySQL
                await connection.execute(`DROP TRIGGER IF EXISTS ${originalTableName}_audit_insert`);
                await connection.execute(`DROP TRIGGER IF EXISTS ${originalTableName}_audit_update`);
                await connection.execute(`DROP TRIGGER IF EXISTS ${originalTableName}_audit_delete`);
                await connection.execute(`DROP TRIGGER IF EXISTS ${originalTableName}_insert_audit`);
                await connection.execute(`DROP TRIGGER IF EXISTS ${originalTableName}_update_audit`);
                await connection.execute(`DROP TRIGGER IF EXISTS ${originalTableName}_delete_audit`);
                
                // Eliminar tabla de auditoría
                await connection.execute(`DROP TABLE IF EXISTS ${auditTableName}`);
                
                console.log('✅ Auditoría MySQL eliminada exitosamente');
            } else if (dbType === 'postgresql') {
                const schema = config.schema || 'public';
                const client = await connection.connect();
                
                try {
                    console.log('🔄 Eliminando componentes PostgreSQL...');
                    
                    // 1. Eliminar triggers (todas las variantes posibles)
                    const triggerVariants = [
                        `${originalTableName}_audit_trigger`,
                        `${originalTableName}_audit_insert_trigger`,
                        `${originalTableName}_audit_update_trigger`,
                        `${originalTableName}_audit_delete_trigger`,
                        `${originalTableName}_insert_audit_trigger`,
                        `${originalTableName}_update_audit_trigger`,
                        `${originalTableName}_delete_audit_trigger`
                    ];

                    for (const triggerName of triggerVariants) {
                        try {
                            await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON "${schema}"."${originalTableName}" CASCADE`);
                            console.log(`🗑️ Trigger eliminado: ${triggerName}`);
                        } catch (triggerError) {
                            console.log(`ℹ️ Trigger ${triggerName} no existe o ya fue eliminado`);
                        }
                    }

                    // 2. Eliminar función específica de trigger
                    try {
                        await client.query(`DROP FUNCTION IF EXISTS ${originalTableName}_audit_trigger_func() CASCADE`);
                        console.log(`🗑️ Función específica eliminada: ${originalTableName}_audit_trigger_func`);
                    } catch (funcError) {
                        console.log(`ℹ️ Función ${originalTableName}_audit_trigger_func no existe`);
                    }

                    // 3. Eliminar tabla de auditoría
                    await client.query(`DROP TABLE IF EXISTS "${schema}"."${auditTableName}" CASCADE`);
                    console.log(`🗑️ Tabla eliminada: ${auditTableName}`);

                    console.log('✅ Auditoría PostgreSQL eliminada exitosamente');
                } finally {
                    client.release();
                }
            }

            await systemAuditService.logAuditConfig(
                'REMOVE_TABLE_AUDIT_SUCCESS',
                originalTableName,
                'system',
                { auditTableName }
            );

            console.log('🗑️ === FIN ELIMINACIÓN AUDITORÍA ===');
            
            return {
                success: true,
                message: `Auditoría eliminada exitosamente para ${originalTableName}`,
                tableName: originalTableName,
                auditTableName
            };
        } catch (error) {
            console.error('💥 Error eliminando auditoría:', error);
            
            await systemAuditService.logAuditConfig(
                'REMOVE_TABLE_AUDIT_ERROR',
                auditTableName,
                'system',
                { error: error.message }
            );
            
            return {
                success: false,
                error: error.message,
                tableName: auditTableName
            };
        }
    }


    // CORREGIR para manejar tablas encriptadas:
    async removeAuditTable(dbType, connection, config, auditTableName) {
        try {
            console.log('🗑️ === INICIO ELIMINACIÓN AUDITORÍA ===');
            console.log('📊 Eliminando auditoría:', auditTableName);
            
            let originalTableName;
            
            // ✅ NUEVO: Detectar si es tabla encriptada o normal
            const isEncryptedTable = auditTableName.match(/^t[0-9a-f]{32}$/);
            
            if (isEncryptedTable) {
                console.log('🔐 Detectada tabla encriptada');
                // Para tablas encriptadas, necesitamos obtener el nombre original desde el mapeo
                originalTableName = await this.getOriginalTableName(dbType, connection, config, auditTableName, null);
                if (!originalTableName) {
                    // Si no podemos obtener el nombre original, intentaremos eliminar con el nombre encriptado
                    originalTableName = auditTableName.replace(/^t/, ''); // Fallback
                }
            } else {
                // Tabla normal con prefijo aud_
                originalTableName = auditTableName.replace(this.auditTablePrefix, '');
            }
            
            console.log('📋 Tabla original determinada:', originalTableName);

            if (dbType === 'mysql') {
                // Eliminar triggers MySQL (intentar todas las variantes)
                const triggerVariants = [
                    `${originalTableName}_audit_insert`,
                    `${originalTableName}_audit_update`, 
                    `${originalTableName}_audit_delete`,
                    `${originalTableName}_insert_audit`,
                    `${originalTableName}_update_audit`,
                    `${originalTableName}_delete_audit`,
                    `${originalTableName}_audit_trigger`
                ];

                for (const triggerName of triggerVariants) {
                    try {
                        await connection.execute(`DROP TRIGGER IF EXISTS ${triggerName}`);
                        console.log(`🗑️ Trigger MySQL eliminado: ${triggerName}`);
                    } catch (triggerError) {
                        console.log(`ℹ️ Trigger ${triggerName} no existe`);
                    }
                }
                
                // Eliminar tabla de auditoría
                await connection.execute(`DROP TABLE IF EXISTS \`${auditTableName}\``);
                
                console.log('✅ Auditoría MySQL eliminada exitosamente');
            } else if (dbType === 'postgresql') {
                const schema = config.schema || 'public';
                const client = await connection.connect();
                
                try {
                    console.log('🔄 Eliminando componentes PostgreSQL...');
                    
                    // 1. Eliminar triggers (todas las variantes posibles)
                    const triggerVariants = [
                        `${originalTableName}_audit_trigger`,
                        `${originalTableName}_audit_insert_trigger`,
                        `${originalTableName}_audit_update_trigger`,
                        `${originalTableName}_audit_delete_trigger`,
                        `${originalTableName}_insert_audit_trigger`,
                        `${originalTableName}_update_audit_trigger`,
                        `${originalTableName}_delete_audit_trigger`
                    ];

                    for (const triggerName of triggerVariants) {
                        try {
                            await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON "${schema}"."${originalTableName}" CASCADE`);
                            console.log(`🗑️ Trigger eliminado: ${triggerName}`);
                        } catch (triggerError) {
                            console.log(`ℹ️ Trigger ${triggerName} no existe o ya fue eliminado`);
                        }
                    }

                    // 2. Eliminar función específica de trigger
                    try {
                        await client.query(`DROP FUNCTION IF EXISTS ${originalTableName}_audit_trigger_func() CASCADE`);
                        console.log(`🗑️ Función específica eliminada: ${originalTableName}_audit_trigger_func`);
                    } catch (funcError) {
                        console.log(`ℹ️ Función ${originalTableName}_audit_trigger_func no existe`);
                    }

                    // 3. Eliminar tabla de auditoría (usar nombre real encriptado o normal)
                    await client.query(`DROP TABLE IF EXISTS "${schema}"."${auditTableName}" CASCADE`);
                    console.log(`🗑️ Tabla eliminada: ${auditTableName}`);

                    // 4. ✅ NUEVO: Si es tabla encriptada, eliminar también el mapeo
                    if (isEncryptedTable) {
                        try {
                            await client.query(`DELETE FROM "${schema}"."audit_table_mappings" WHERE encrypted_table_name = $1`, [auditTableName]);
                            console.log(`🗑️ Mapeo eliminado para tabla encriptada: ${auditTableName}`);
                        } catch (mappingError) {
                            console.log(`ℹ️ No se pudo eliminar mapeo: ${mappingError.message}`);
                        }
                    }

                    console.log('✅ Auditoría PostgreSQL eliminada exitosamente');
                } finally {
                    client.release();
                }
            }

            await systemAuditService.logAuditConfig(
                'REMOVE_TABLE_AUDIT_SUCCESS',
                originalTableName,
                'system',
                { auditTableName, isEncryptedTable }
            );

            console.log('🗑️ === FIN ELIMINACIÓN AUDITORÍA ===');
            
            return {
                success: true,
                message: `Auditoría eliminada exitosamente para ${originalTableName}`,
                tableName: originalTableName,
                auditTableName
            };
        } catch (error) {
            console.error('💥 Error eliminando auditoría:', error);
            
            await systemAuditService.logAuditConfig(
                'REMOVE_TABLE_AUDIT_ERROR',
                auditTableName,
                'system',
                { error: error.message }
            );
            
            return {
                success: false,
                error: error.message,
                tableName: auditTableName
            };
        }
    }


    // AGREGAR: Método para eliminación masiva
    async removeAllAuditTables(dbType, connection, config) {
        try {
            console.log('🗑️ === INICIO ELIMINACIÓN MASIVA DE AUDITORÍAS ===');

            // Obtener todas las tablas de auditoría
            const auditTables = await this.getAuditTables(dbType, connection, config);
            console.log(`📊 Encontradas ${auditTables.length} tablas de auditoría para eliminar`);

            if (auditTables.length === 0) {
                return {
                    success: true,
                    message: 'No hay tablas de auditoría para eliminar',
                    results: [],
                    summary: { total: 0, successful: 0, failed: 0 }
                };
            }

            const results = [];

            // Procesar eliminaciones secuencialmente para evitar conflictos
            for (const auditTable of auditTables) {
                console.log(`🗑️ Eliminando: ${auditTable.tableName}`);

                try {
                    const result = await this.removeAuditTable(
                        dbType,
                        connection,
                        config,
                        auditTable.tableName
                    );

                    results.push({
                        tableName: auditTable.originalTable,
                        auditTableName: auditTable.tableName,
                        success: result.success,
                        message: result.message,
                        error: result.success ? null : result.error
                    });

                    if (result.success) {
                        console.log(`✅ ${auditTable.tableName}: Eliminada exitosamente`);
                    } else {
                        console.error(`❌ ${auditTable.tableName}: ${result.error}`);
                    }
                } catch (error) {
                    console.error(`💥 Error eliminando ${auditTable.tableName}:`, error);
                    results.push({
                        tableName: auditTable.originalTable,
                        auditTableName: auditTable.tableName,
                        success: false,
                        error: error.message,
                        message: 'Error en eliminación'
                    });
                }
            }

            // ELIMINACIÓN ESPECIAL: Función global de encriptación (solo una vez al final)
            if (dbType === 'postgresql') {
                console.log('🗑️ Eliminando función global de encriptación...');
                const client = await connection.connect();
                try {
                    await client.query(`DROP FUNCTION IF EXISTS encrypt_audit_data_nodejs(text, text) CASCADE`);
                    console.log('🗑️ Función global eliminada: encrypt_audit_data_nodejs');
                } catch (globalFuncError) {
                    console.log('ℹ️ Función global ya fue eliminada o no existe');
                } finally {
                    client.release();
                }
            }

            const successCount = results.filter(r => r.success).length;
            const failureCount = results.filter(r => !r.success).length;

            await systemAuditService.logAuditConfig(
                'REMOVE_ALL_AUDIT_TABLES_COMPLETED',
                `${auditTables.length} tables`,
                'system',
                {
                    total: auditTables.length,
                    successful: successCount,
                    failed: failureCount
                }
            );

            console.log('📊 === RESUMEN ELIMINACIÓN MASIVA ===');
            console.log(`✅ Eliminadas: ${successCount}`);
            console.log(`❌ Fallidas: ${failureCount}`);
            console.log('🗑️ === FIN ELIMINACIÓN MASIVA ===');

            return {
                success: successCount > 0,
                message: `Eliminación masiva completada: ${successCount} exitosas, ${failureCount} fallidas`,
                results,
                summary: {
                    total: auditTables.length,
                    successful: successCount,
                    failed: failureCount
                }
            };
        } catch (error) {
            console.error('💥 Error en eliminación masiva:', error);

            await systemAuditService.logAuditConfig(
                'REMOVE_ALL_AUDIT_TABLES_ERROR',
                'multiple tables',
                'system',
                { error: error.message }
            );

            throw new Error(`Error en eliminación masiva: ${error.message}`);
        }
    }
}

module.exports = new AuditService();