const databaseManager = require('../config/database');
const auditService = require('../services/auditService');
const triggerService = require('../services/triggerService');
const systemAuditService = require('../services/systemAuditService');
const QueryBuilders = require('../utils/queryBuilders');

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

    // Configurar auditoría para todas las tablas
    async setupAllTablesAudit(req, res) {
        const startTime = Date.now();
        let traceId;

        try {
            const { type, config, encryptionKey, tables } = req.body;

            traceId = await systemAuditService.logAuditConfig(
                'SETUP_ALL_TABLES_AUDIT_START',
                `${tables?.length || 0} tables`,
                req.ip,
                {
                    encryptionKeyUsed: !!encryptionKey,
                    tableCount: tables?.length || 0
                }
            );

            console.log(`🔧 Configurando auditoría para todas las tablas (${tables?.length || 0})`);

            const connection = await databaseManager.getConnection(type, config);

            const results = await triggerService.setupAllTablesAudit(
                type,
                connection,
                config,
                tables,
                encryptionKey
            );

            const duration = Date.now() - startTime;
            const successCount = results.filter(r => r.success).length;
            const failureCount = results.filter(r => !r.success).length;

            await systemAuditService.logAuditConfig(
                'SETUP_ALL_TABLES_AUDIT_COMPLETED',
                `${tables?.length || 0} tables`,
                req.ip,
                {
                    success: successCount > 0,
                    successCount,
                    failureCount,
                    duration,
                    traceId
                }
            );

            await systemAuditService.logPerformance(
                'SETUP_ALL_TABLES_AUDIT',
                duration,
                {
                    tableCount: tables?.length || 0,
                    successCount,
                    failureCount,
                    dbType: type,
                    traceId
                }
            );

            res.json({
                success: true,
                results,
                summary: {
                    total: results.length,
                    successful: successCount,
                    failed: failureCount
                },
                traceId
            });
        } catch (error) {
            const duration = Date.now() - startTime;

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

            console.error('❌ Error configurando auditoría masiva:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                traceId
            });
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

    // Desencriptar y ver datos de auditoría
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
                { limit, offset, encryptionUsed: true }
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

            await systemAuditService.logDataAccess(
                'VIEW_DECRYPTED_AUDIT_DATA_SUCCESS',
                auditTableName,
                req.ip,
                true,
                {
                    recordCount: auditData.data.length,
                    duration,
                    traceId,
                    encryptionUsed: true
                }
            );

            console.log('📋 Datos desencriptados obtenidos:', auditData.data.length, 'registros');
            console.log('🔓 === FIN VER DATOS DESENCRIPTADOS ===');

            // CORREGIR: No anidar auditData dentro de otra propiedad data
            res.json({
                success: true,
                ...auditData,  // Esto expande: data, columns, totalRecords, isEncrypted
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
                    traceId,
                    encryptionUsed: true
                }
            );

            res.status(500).json({
                success: false,
                error: 'Error obteniendo datos de auditoría desencriptados',
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
            const { auditTableName } = req.params;
            const { type, config } = req.body;

            traceId = await systemAuditService.logAuditConfig(
                'REMOVE_TABLE_AUDIT_START',
                auditTableName,
                req.ip
            );

            const connection = await databaseManager.getConnection(type, config);
            const result = await auditService.removeAuditTable(type, connection, config, auditTableName);

            const duration = Date.now() - startTime;

            await systemAuditService.logAuditConfig(
                result.success ? 'REMOVE_TABLE_AUDIT_SUCCESS' : 'REMOVE_TABLE_AUDIT_FAILED',
                auditTableName,
                req.ip,
                {
                    success: result.success,
                    error: result.error,
                    duration,
                    traceId
                }
            );

            if (result.success) {
                res.json({
                    success: true,
                    message: result.message,
                    traceId
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: result.error,
                    traceId
                });
            }
        } catch (error) {
            await systemAuditService.logAuditConfig(
                'REMOVE_TABLE_AUDIT_ERROR',
                req.params.auditTableName || 'unknown',
                req.ip,
                {
                    success: false,
                    error: error.message,
                    traceId
                }
            );

            console.error('❌ Error eliminando auditoría:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                traceId
            });
        }
    }

    async getAuditStatistics(req, res) {
        const startTime = Date.now();

        try {
            const { auditTableName } = req.params;
            const { type, config } = req.body;

            const connection = await databaseManager.getConnection(type, config);
            const result = await auditService.getAuditStatistics(type, connection, config, auditTableName);

            await systemAuditService.logPerformance(
                'GET_AUDIT_STATISTICS',
                Date.now() - startTime,
                {
                    tableName: auditTableName,
                    totalRecords: result.totalRecords,
                    dbType: type
                }
            );

            res.json({
                success: true,
                statistics: result
            });
        } catch (error) {
            console.error('❌ Error obteniendo estadísticas:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

module.exports = new AuditController();