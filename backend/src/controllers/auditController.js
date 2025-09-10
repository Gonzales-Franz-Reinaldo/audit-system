const databaseManager = require('../config/database');
const auditService = require('../services/auditService');
const triggerService = require('../services/triggerService');
const systemAuditService = require('../services/systemAuditService');
const QueryBuilders = require('../utils/queryBuilders');

const { encryptedTableMappingService } = require('../services/encryptionService');

class AuditController {
    // Configurar auditoría para una tabla con logging completo
    async setupTableAudit(req, res) {
        const startTime = Date.now();
        let traceId;

        try {
            console.log('🎯 === INICIO CONFIGURACIÓN AUDITORÍA ===');
            console.log('📨 Datos recibidos:', {
                params: req.params,
                body: {
                    type: req.body.type,
                    config: req.body.config ? 'presente' : 'ausente',
                    encryptionKey: req.body.encryptionKey ? 'presente' : 'ausente'
                }
            });

            const { tableName } = req.params;
            const { type, config, encryptionKey } = req.body;

            console.log(`🔧 Configurando auditoría para tabla: ${tableName}`);
            console.log(`📊 Tipo de DB: ${type}`);
            console.log(`🔑 Clave proporcionada: ${!!encryptionKey}`);

            // Validar parámetros con logging detallado
            if (!tableName) {
                console.error('❌ Validación falló: tableName faltante');
                return res.status(400).json({
                    success: false,
                    error: 'Nombre de tabla requerido'
                });
            }

            if (!type || !config) {
                console.error('❌ Validación falló: type o config faltante', { type: !!type, config: !!config });
                return res.status(400).json({
                    success: false,
                    error: 'Tipo y configuración de base de datos requeridos'
                });
            }

            if (!encryptionKey) {
                console.error('❌ Validación falló: encryptionKey faltante');
                return res.status(400).json({
                    success: false,
                    error: 'Clave de encriptación requerida'
                });
            }

            console.log('✅ Validaciones pasadas, iniciando configuración...');

            traceId = await systemAuditService.logAuditConfig(
                'SETUP_TABLE_AUDIT_START',
                tableName,
                req.ip,
                { encryptionKeyUsed: !!encryptionKey }
            );

            console.log(`🔗 TraceId generado: ${traceId}`);

            const connection = await databaseManager.getConnection(type, config);
            console.log('🔌 Conexión a base de datos obtenida');

            console.log('⚙️ Llamando a triggerService.setupTableAudit...');
            const result = await triggerService.setupTableAudit(
                type,
                connection,
                config,
                tableName,
                encryptionKey
            );

            console.log('📋 Resultado de triggerService:', result);

            const duration = Date.now() - startTime;

            if (result && result.success) {
                await systemAuditService.logAuditConfig(
                    'SETUP_TABLE_AUDIT_SUCCESS',
                    tableName,
                    req.ip,
                    {
                        success: true,
                        auditTableCreated: true,
                        duration,
                        traceId
                    }
                );

                console.log(`✅ Auditoría configurada exitosamente: ${tableName}`);

                res.json({
                    success: true,
                    message: result.message || `Auditoría configurada exitosamente para la tabla ${tableName}`,
                    auditTableName: result.auditTableName,
                    tableName: tableName,
                    traceId
                });
            } else {
                await systemAuditService.logAuditConfig(
                    'SETUP_TABLE_AUDIT_FAILED',
                    tableName,
                    req.ip,
                    {
                        success: false,
                        error: result?.error || 'Error desconocido',
                        duration,
                        traceId
                    }
                );

                console.error(`❌ Error configurando auditoría: ${result?.error || 'Error desconocido'}`);

                res.status(500).json({
                    success: false,
                    error: result?.error || 'Error configurando auditoría',
                    tableName: tableName,
                    traceId
                });
            }
        } catch (error) {
            const duration = Date.now() - startTime;

            console.error('💥 EXCEPCIÓN en setupTableAudit:', error);
            console.error('📋 Stack trace:', error.stack);

            await systemAuditService.logAuditConfig(
                'SETUP_TABLE_AUDIT_ERROR',
                req.params.tableName || 'unknown',
                req.ip,
                {
                    success: false,
                    error: error.message,
                    duration,
                    traceId
                }
            );

            console.error('❌ Error configurando auditoría:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Error interno del servidor',
                tableName: req.params.tableName,
                traceId
            });
        } finally {
            console.log('🏁 === FIN CONFIGURACIÓN AUDITORÍA ===');
        }
    }



    // Obtener tablas de auditoría encriptadas (sin clave)
    async getEncryptedAuditTables(req, res) {
        try {
            const { type, config } = req.body;
            const connection = await databaseManager.getConnection(type, config);

            const auditTables = await auditService.getEncryptedAuditTables(type, connection, config);

            res.json({
                success: true,
                data: {
                    auditTables: auditTables,
                    total: auditTables.length
                }
            });
        } catch (error) {
            console.error('💥 Error obteniendo tablas encriptadas:', error);
            res.status(500).json({
                success: false,
                error: 'Error obteniendo tablas de auditoría encriptadas',
                details: error.message
            });
        }
    }

    // Obtener tablas de auditoría desencriptadas (con clave)
    async getDecryptedAuditTables(req, res) {
        try {
            const { type, config, encryptionKey } = req.body;

            if (!encryptionKey) {
                return res.status(400).json({
                    success: false,
                    error: 'Clave de encriptación requerida'
                });
            }

            const connection = await databaseManager.getConnection(type, config);

            const auditTables = await auditService.getDecryptedAuditTables(
                type,
                connection,
                config,
                encryptionKey
            );

            res.json({
                success: true,
                data: {
                    auditTables: auditTables,
                    total: auditTables.length
                }
            });
        } catch (error) {
            console.error('💥 Error desencriptando tablas:', error);
            res.status(500).json({
                success: false,
                error: 'Error desencriptando tablas de auditoría',
                details: error.message
            });
        }
    }

    // Configurar auditoría para todas las tablas
    async setupAllTablesAudit(req, res) {
        const startTime = Date.now();
        let traceId;

        try {
            console.log('🔧 === INICIO CONFIGURACIÓN MASIVA CORREGIDA ===');
            const { type, config, encryptionKey, tables, selectedTables } = req.body;

            console.log('📨 Datos recibidos:', {
                type,
                config: !!config,
                encryptionKey: !!encryptionKey,
                tables: tables?.length || 0,
                selectedTables: selectedTables?.length || 0
            });

            // Validar parámetros
            if (!type || !config || !encryptionKey) {
                return res.status(400).json({
                    success: false,
                    error: 'Tipo, configuración y clave de encriptación requeridos'
                });
            }

            // Determinar qué tablas procesar
            let tablesToProcess = [];

            if (selectedTables && selectedTables.length > 0) {
                tablesToProcess = selectedTables;
                console.log(`📋 Procesando ${selectedTables.length} tablas seleccionadas`);
            } else if (tables && tables.length > 0) {
                tablesToProcess = tables;
                console.log(`📋 Procesando todas las ${tables.length} tablas`);
            } else {
                const connection = await databaseManager.getConnection(type, config);
                const allTables = await this.getTablesWithoutAudit(type, connection, config);
                tablesToProcess = allTables.map(t => t.name);
                console.log(`📋 Encontradas ${tablesToProcess.length} tablas sin auditoría`);
            }

            if (tablesToProcess.length === 0) {
                return res.json({
                    success: true,
                    message: 'No hay tablas para procesar',
                    results: [],
                    summary: { total: 0, successful: 0, failed: 0 }
                });
            }

            traceId = await systemAuditService.logAuditConfig(
                'SETUP_ALL_TABLES_AUDIT_START',
                `${tablesToProcess.length} tables`,
                req.ip,
                {
                    encryptionKeyUsed: !!encryptionKey,
                    tableCount: tablesToProcess.length,
                    selectedMode: !!selectedTables
                }
            );

            const connection = await databaseManager.getConnection(type, config);

            // ✅ SOLUCIÓN: PROCESAMIENTO COMPLETAMENTE SECUENCIAL
            const results = [];
            let processedCount = 0;

            console.log(`🔄 Procesando ${tablesToProcess.length} tablas SECUENCIALMENTE para evitar conflictos...`);

            for (const tableName of tablesToProcess) {
                processedCount++;
                console.log(`⚙️ [${processedCount}/${tablesToProcess.length}] Configurando: ${tableName}`);

                try {
                    // ✅ AGREGAR: Pausa entre tablas para evitar conflictos de concurrencia
                    if (processedCount > 1) {
                        console.log('⏳ Pausa anti-conflicto...');
                        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 segundos
                    }

                    console.log(`🔧 Iniciando configuración para: ${tableName}`);

                    const result = await triggerService.setupTableAudit(
                        type,
                        connection,
                        config,
                        tableName,
                        encryptionKey
                    );

                    if (result && result.success) {
                        console.log(`✅ ${tableName}: Configurado exitosamente`);
                        results.push({
                            tableName,
                            success: true,
                            auditTableName: result.auditTableName,
                            message: 'Auditoría configurada exitosamente'
                        });
                    } else {
                        console.error(`❌ ${tableName}: ${result?.error || 'Error desconocido'}`);
                        results.push({
                            tableName,
                            success: false,
                            error: result?.error || 'Error desconocido',
                            message: 'Error en la configuración'
                        });
                    }
                } catch (error) {
                    console.error(`💥 Excepción en ${tableName}:`, error.message);
                    results.push({
                        tableName,
                        success: false,
                        error: error.message,
                        message: 'Error de excepción'
                    });
                }

                // ✅ MOSTRAR PROGRESO
                const successCount = results.filter(r => r.success).length;
                const failureCount = results.filter(r => !r.success).length;
                console.log(`📊 Progreso: ${processedCount}/${tablesToProcess.length} | ✅ ${successCount} | ❌ ${failureCount}`);
            }

            const duration = Date.now() - startTime;
            const successCount = results.filter(r => r.success).length;
            const failureCount = results.filter(r => !r.success).length;

            await systemAuditService.logAuditConfig(
                'SETUP_ALL_TABLES_AUDIT_COMPLETED',
                `${tablesToProcess.length} tables`,
                req.ip,
                {
                    success: successCount > 0,
                    successCount,
                    failureCount,
                    duration,
                    traceId,
                    completionRate: Math.round((successCount / tablesToProcess.length) * 100)
                }
            );

            console.log('📊 === RESUMEN CONFIGURACIÓN MASIVA CORREGIDA ===');
            console.log(`✅ Exitosas: ${successCount}`);
            console.log(`❌ Fallidas: ${failureCount}`);
            console.log(`⏱️ Duración total: ${duration}ms`);
            console.log('🔧 === FIN CONFIGURACIÓN MASIVA CORREGIDA ===');

            res.json({
                success: successCount > 0,
                message: `Configuración completada: ${successCount} exitosas, ${failureCount} fallidas`,
                results,
                summary: {
                    total: results.length,
                    successful: successCount,
                    failed: failureCount,
                    completionRate: Math.round((successCount / results.length) * 100),
                    duration
                },
                traceId
            });

        } catch (error) {
            const duration = Date.now() - startTime;

            console.error('💥 Error en configuración masiva:', error);

            await systemAuditService.logAuditConfig(
                'SETUP_ALL_TABLES_AUDIT_ERROR',
                'multiple tables',
                req.ip,
                {
                    success: false,
                    error: error.message,
                    duration,
                    traceId
                }
            );

            res.status(500).json({
                success: false,
                error: 'Error en configuración masiva de auditoría',
                details: error.message,
                traceId
            });
        }
    }


    // AGREGAR: Método helper para obtener tablas sin auditoría
    async getTablesWithoutAudit(type, connection, config) {
        try {
            let query;
            let params = [];

            if (type === 'postgresql') {
                query = `
                SELECT 
                    t.tablename as name,
                    CASE 
                        WHEN audit_t.tablename IS NOT NULL THEN true 
                        ELSE false 
                    END as has_audit
                FROM pg_tables t
                LEFT JOIN pg_tables audit_t 
                    ON audit_t.schemaname = t.schemaname 
                    AND audit_t.tablename = ('aud_' || t.tablename)
                WHERE t.schemaname = $1 
                AND t.tablename NOT LIKE 'aud_%'
                ORDER BY t.tablename
            `;
                params = [config.schema || 'public'];
            }

            const client = await connection.connect();
            try {
                const result = await client.query(query, params);
                return result.rows.filter(row => !row.has_audit);
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error obteniendo tablas sin auditoría:', error);
            return [];
        }
    }


    // Validar contraseña de encriptación - MÉTODO FALTANTE
    async validateEncryptionPassword(req, res) {
        const startTime = Date.now();
        let traceId;

        try {
            console.log('🔑 === INICIO VALIDACIÓN CONTRASEÑA ===');
            const { type, config, auditTableName, encryptionKey } = req.body;

            console.log('📨 Datos recibidos:', {
                type,
                auditTableName,
                config: !!config,
                encryptionKey: !!encryptionKey
            });

            traceId = await systemAuditService.logDataAccess(
                'VALIDATE_ENCRYPTION_PASSWORD',
                auditTableName,
                req.ip,
                true,
                { startValidation: true }
            );

            const connection = await databaseManager.getConnection(type, config);

            const validation = await auditService.validateEncryptionPassword(
                type,
                connection,
                config,
                auditTableName,
                encryptionKey
            );

            const duration = Date.now() - startTime;

            await systemAuditService.logDataAccess(
                'VALIDATE_ENCRYPTION_PASSWORD_RESULT',
                auditTableName,
                req.ip,
                true,
                {
                    success: validation.valid,
                    duration,
                    traceId
                }
            );

            console.log('📋 Resultado de validación:', validation);
            console.log('🔑 === FIN VALIDACIÓN CONTRASEÑA ===');

            res.json({
                success: true,
                data: validation,
                traceId
            });
        } catch (error) {
            const duration = Date.now() - startTime;

            console.error('💥 Error validando contraseña:', error);

            await systemAuditService.logDataAccess(
                'VALIDATE_ENCRYPTION_PASSWORD_ERROR',
                req.body.auditTableName || 'unknown',
                req.ip,
                true,
                {
                    success: false,
                    error: error.message,
                    duration,
                    traceId
                }
            );

            res.status(500).json({
                success: false,
                error: 'Error validando contraseña de encriptación',
                details: error.message,
                traceId
            });
        }
    }

    // Ver datos de auditoría encriptados
    async viewEncryptedAuditData(req, res) {
        const startTime = Date.now();
        let traceId;

        try {
            console.log('🔍 === INICIO VER DATOS ENCRIPTADOS ===');
            const { auditTableName } = req.params;
            const { type, config, limit = 100, offset = 0 } = req.body;

            console.log('📨 Datos recibidos:', {
                auditTableName,
                type,
                config: !!config,
                limit,
                offset
            });

            traceId = await systemAuditService.logDataAccess(
                'VIEW_ENCRYPTED_AUDIT_DATA',
                auditTableName,
                req.ip,
                true,
                { limit, offset }
            );

            const connection = await databaseManager.getConnection(type, config);

            const auditData = await auditService.getEncryptedAuditData(
                type,
                connection,
                config,
                auditTableName,
                limit,
                offset
            );

            const duration = Date.now() - startTime;

            await systemAuditService.logDataAccess(
                'VIEW_ENCRYPTED_AUDIT_DATA_SUCCESS',
                auditTableName,
                req.ip,
                true,
                {
                    recordCount: auditData.data.length,
                    duration,
                    traceId
                }
            );

            console.log('📋 Datos encriptados obtenidos:', auditData.data.length, 'registros');
            console.log('🔍 === FIN VER DATOS ENCRIPTADOS ===');

            // CORREGIR: No anidar auditData dentro de otra propiedad data
            res.json({
                success: true,
                ...auditData,  // Esto expande: data, columns, totalRecords, isEncrypted
                traceId
            });
        } catch (error) {
            const duration = Date.now() - startTime;

            console.error('💥 Error obteniendo datos encriptados:', error);

            await systemAuditService.logDataAccess(
                'VIEW_ENCRYPTED_AUDIT_DATA_ERROR',
                req.params.auditTableName || 'unknown',
                req.ip,
                true,
                {
                    success: false,
                    error: error.message,
                    duration,
                    traceId
                }
            );

            res.status(500).json({
                success: false,
                error: 'Error obteniendo datos de auditoría encriptados',
                details: error.message,
                traceId
            });
        }
    }


    async viewDecryptedAuditData(req, res) {
        const startTime = Date.now();
        let traceId;

        try {
            console.log('🔓 === INICIO VER DATOS DESENCRIPTADOS ===');
            const { auditTableName } = req.params;
            const { type, config, encryptionKey, limit = 100, offset = 0 } = req.body;

            console.log('📨 Datos recibidos:', {
                auditTableName,
                type,
                config: !!config,
                encryptionKey: !!encryptionKey,
                limit,
                offset
            });

            traceId = await systemAuditService.logDataAccess(
                'VIEW_DECRYPTED_AUDIT_DATA',
                auditTableName,
                req.ip,
                true,
                { limit, offset }
            );

            const connection = await databaseManager.getConnection(type, config);

            const auditData = await auditService.getDecryptedAuditData(
                type,
                connection,
                config,
                auditTableName,
                encryptionKey,
                limit,
                offset
            );

            const duration = Date.now() - startTime;

            // ✅ AGREGAR: Log del nombre de tabla original para debug
            console.log('📋 Datos desencriptados obtenidos:', auditData.data.length);
            console.log('📋 Nombre de tabla original:', auditData.originalTableName);
            console.log('📋 Estructura de respuesta:', {
                dataLength: auditData.data?.length,
                columnsLength: auditData.columns?.length,
                originalTableName: auditData.originalTableName,
                isEncrypted: auditData.isEncrypted
            });

            await systemAuditService.logDataAccess(
                'VIEW_DECRYPTED_AUDIT_DATA_SUCCESS',
                auditTableName,
                req.ip,
                true,
                {
                    recordCount: auditData.data.length,
                    originalTableName: auditData.originalTableName, // ✅ AGREGAR para log
                    duration,
                    traceId
                }
            );

            console.log('🔓 === FIN VER DATOS DESENCRIPTADOS ===');

            // ✅ CRÍTICO: ASEGURAR que originalTableName se incluya en la respuesta
            res.json({
                success: true,
                data: auditData.data,
                columns: auditData.columns,
                originalColumns: auditData.originalColumns,
                originalTableName: auditData.originalTableName, // ✅ AGREGAR EXPLÍCITAMENTE
                totalRecords: auditData.totalRecords,
                isEncrypted: auditData.isEncrypted,
                traceId
            });
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error('💥 Error obteniendo datos desencriptados:', error);

            await systemAuditService.logDataAccess(
                'VIEW_DECRYPTED_AUDIT_DATA_ERROR',
                req.params.auditTableName || 'unknown',
                req.ip,
                true,
                {
                    success: false,
                    error: error.message,
                    duration,
                    traceId
                }
            );

            res.status(500).json({
                success: false,
                error: 'Error obteniendo datos desencriptados',
                details: error.message,
                traceId
            });
        }
    }


    // Resto de métodos con logging similar...
    async getAuditTables(req, res) {
        const startTime = Date.now();

        try {
            console.log('📋 === INICIO OBTENER TABLAS AUDITORÍA ===');
            const { type, config } = req.body;

            console.log('📨 Datos recibidos:', {
                type,
                config: !!config
            });

            const connection = await databaseManager.getConnection(type, config);

            const auditTables = await auditService.getAuditTables(type, connection, config);

            const duration = Date.now() - startTime;

            await systemAuditService.logSystemAction(
                'GET_AUDIT_TABLES_SUCCESS',
                req.ip,
                {
                    tableCount: auditTables.length,
                    duration,
                    dbType: type
                }
            );

            console.log('📋 Tablas de auditoría obtenidas:', auditTables.length);
            console.log('📋 === FIN OBTENER TABLAS AUDITORÍA ===');

            // CORREGIR: Asegurarse de que la respuesta tenga la estructura correcta
            res.json({
                success: true,
                data: {
                    auditTables: auditTables,  // ← IMPORTANTE: usar "auditTables"
                    total: auditTables.length
                }
            });
        } catch (error) {
            const duration = Date.now() - startTime;

            console.error('💥 Error obteniendo tablas de auditoría:', error);

            await systemAuditService.logSystemAction(
                'GET_AUDIT_TABLES_ERROR',
                req.ip,
                {
                    error: error.message,
                    duration
                },
                'error'
            );

            res.status(500).json({
                success: false,
                error: 'Error obteniendo tablas de auditoría',
                details: error.message
            });
        }
    }


    async removeTableAudit(req, res) {
        const startTime = Date.now();
        let traceId;

        try {
            console.log('🗑️ === INICIO ELIMINACIÓN DE AUDITORÍA (CONTROLLER) ===');
            const { auditTableName } = req.params;
            const { type, config } = req.body;

            console.log('📨 Datos recibidos:', {
                auditTableName,
                type,
                config: !!config
            });

            if (!auditTableName) {
                return res.status(400).json({
                    success: false,
                    error: 'Nombre de tabla de auditoría requerido'
                });
            }

            if (!type || !config) {
                return res.status(400).json({
                    success: false,
                    error: 'Tipo y configuración de base de datos requeridos'
                });
            }

            traceId = await systemAuditService.logAuditConfig(
                'REMOVE_TABLE_AUDIT_START',
                auditTableName,
                req.ip,
                { userAgent: req.get('User-Agent') }
            );

            const connection = await databaseManager.getConnection(type, config);

            const result = await auditService.removeAuditTable(
                type,
                connection,
                config,
                auditTableName
            );

            const duration = Date.now() - startTime;

            if (result.success) {
                await systemAuditService.logAuditConfig(
                    'REMOVE_TABLE_AUDIT_SUCCESS',
                    result.tableName,
                    req.ip,
                    {
                        auditTableName,
                        duration,
                        traceId
                    }
                );

                console.log('✅ Auditoría eliminada exitosamente');
                console.log('🗑️ === FIN ELIMINACIÓN DE AUDITORÍA (CONTROLLER) ===');

                res.json({
                    success: true,
                    message: result.message,
                    tableName: result.tableName,
                    auditTableName: result.auditTableName,
                    traceId
                });
            } else {
                await systemAuditService.logAuditConfig(
                    'REMOVE_TABLE_AUDIT_FAILED',
                    auditTableName,
                    req.ip,
                    {
                        error: result.error,
                        duration,
                        traceId
                    }
                );

                res.status(500).json({
                    success: false,
                    error: result.error,
                    tableName: auditTableName,
                    traceId
                });
            }
        } catch (error) {
            const duration = Date.now() - startTime;

            console.error('💥 Error en removeTableAudit controller:', error);

            await systemAuditService.logAuditConfig(
                'REMOVE_TABLE_AUDIT_ERROR',
                req.params.auditTableName || 'unknown',
                req.ip,
                {
                    error: error.message,
                    duration,
                    traceId
                }
            );

            res.status(500).json({
                success: false,
                error: 'Error eliminando auditoría',
                details: error.message,
                traceId
            });
        }
    }

    // AGREGAR: Método para eliminación masiva
    // COMPLETAR el método removeAllTablesAudit que estaba incompleto:
    async removeAllTablesAudit(req, res) {
        const startTime = Date.now();
        let traceId;

        try {
            console.log('🗑️ === INICIO ELIMINACIÓN MASIVA (CONTROLLER) ===');
            const { type, config } = req.body;

            console.log('📨 Datos recibidos:', {
                type,
                config: !!config
            });

            if (!type || !config) {
                return res.status(400).json({
                    success: false,
                    error: 'Tipo y configuración de base de datos requeridos'
                });
            }

            traceId = await systemAuditService.logAuditConfig(
                'REMOVE_ALL_AUDIT_TABLES_START',
                'all tables',
                req.ip,
                { userAgent: req.get('User-Agent') }
            );

            const connection = await databaseManager.getConnection(type, config);

            const result = await auditService.removeAllAuditTables(
                type,
                connection,
                config
            );

            const duration = Date.now() - startTime;

            await systemAuditService.logAuditConfig(
                result.success ? 'REMOVE_ALL_AUDIT_TABLES_SUCCESS' : 'REMOVE_ALL_AUDIT_TABLES_PARTIAL',
                'all tables',
                req.ip,
                {
                    ...result.summary,
                    duration,
                    traceId
                }
            );

            console.log('📊 Eliminación masiva completada');
            console.log('🗑️ === FIN ELIMINACIÓN MASIVA (CONTROLLER) ===');

            res.json({
                success: result.success,
                message: result.message,
                results: result.results,
                summary: {
                    ...result.summary,
                    duration
                },
                traceId
            });

        } catch (error) {
            const duration = Date.now() - startTime;

            console.error('💥 Error en removeAllTablesAudit controller:', error);

            await systemAuditService.logAuditConfig(
                'REMOVE_ALL_AUDIT_TABLES_ERROR',
                'all tables',
                req.ip,
                {
                    error: error.message,
                    duration,
                    traceId
                }
            );

            res.status(500).json({
                success: false,
                error: 'Error en eliminación masiva de auditoría',
                details: error.message,
                traceId
            });
        }
    }


    // COMPLETAR el método getAuditStatistics:
    async getAuditStatistics(req, res) {
        const startTime = Date.now();

        try {
            console.log('📊 === INICIO OBTENER ESTADÍSTICAS ===');
            const { auditTableName } = req.params;
            const { type, config } = req.body;

            console.log('📨 Datos recibidos:', {
                auditTableName,
                type,
                config: !!config
            });

            if (!auditTableName || !type || !config) {
                return res.status(400).json({
                    success: false,
                    error: 'Parámetros requeridos: auditTableName, type, config'
                });
            }

            const connection = await databaseManager.getConnection(type, config);

            const statistics = await auditService.getAuditStatistics(
                type,
                connection,
                config,
                auditTableName
            );

            const duration = Date.now() - startTime;

            await systemAuditService.logSystemAction(
                'GET_AUDIT_STATISTICS_SUCCESS',
                req.ip,
                {
                    auditTableName,
                    totalRecords: statistics.totalRecords,
                    duration,
                    dbType: type
                }
            );

            console.log('📊 Estadísticas obtenidas:', statistics);
            console.log('📊 === FIN OBTENER ESTADÍSTICAS ===');

            res.json({
                success: true,
                data: statistics
            });

        } catch (error) {
            const duration = Date.now() - startTime;

            console.error('💥 Error obteniendo estadísticas:', error);

            await systemAuditService.logSystemAction(
                'GET_AUDIT_STATISTICS_ERROR',
                req.ip,
                {
                    error: error.message,
                    duration,
                    auditTableName: req.params.auditTableName
                },
                'error'
            );

            res.status(500).json({
                success: false,
                error: 'Error obteniendo estadísticas de auditoría',
                details: error.message
            });
        }
    }
}

module.exports = new AuditController();