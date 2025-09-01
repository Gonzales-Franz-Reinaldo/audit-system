const databaseManager = require('../config/database');
const systemAuditService = require('../services/systemAuditService');

class DatabaseController {
    // Probar conexión a base de datos
    async testConnection(req, res) {
        const startTime = Date.now();
        
        try {
            const { type, config } = req.body;

            if (!type || !config) {
                return res.status(400).json({
                    success: false,
                    error: 'Tipo y configuración de base de datos requeridos'
                });
            }

            // Validar tipo de base de datos
            if (!['mysql', 'postgresql', 'postgres'].includes(type.toLowerCase())) {
                return res.status(400).json({
                    success: false,
                    error: 'Tipo de base de datos no soportado'
                });
            }

            // Validar configuración básica
            if (!config.host || !config.user || !config.password || !config.database) {
                return res.status(400).json({
                    success: false,
                    error: 'Configuración de conexión incompleta'
                });
            }

            console.log(`🔍 Probando conexión ${type}: ${config.host}/${config.database}`);

            // Log del intento de conexión
            await systemAuditService.logSystemAction(
                'TEST_DATABASE_CONNECTION',
                req.ip,
                {
                    dbType: type,
                    host: config.host,
                    database: config.database,
                    ip: req.ip,
                    userAgent: req.get('User-Agent')
                }
            );

            const result = await databaseManager.testConnection(type, config);
            const duration = Date.now() - startTime;

            if (result.success) {
                // Obtener información adicional de la conexión
                let connectionInfo = {
                    database: config.database,
                    version: null,
                    server: config.host
                };

                try {
                    const connection = await databaseManager.getConnection(type, config);
                    
                    if (type.toLowerCase() === 'mysql') {
                        const [versionResult] = await connection.execute('SELECT VERSION() as version');
                        connectionInfo.version = versionResult[0].version;
                    } else {
                        const client = await connection.connect();
                        try {
                            const versionResult = await client.query('SELECT version()');
                            connectionInfo.version = versionResult.rows[0].version;
                        } finally {
                            client.release();
                        }
                    }
                } catch (versionError) {
                    console.warn('No se pudo obtener versión de la base de datos:', versionError.message);
                }

                await systemAuditService.logSystemAction(
                    'DATABASE_CONNECTION_SUCCESS',
                    req.ip,
                    {
                        dbType: type,
                        host: config.host,
                        database: config.database,
                        duration,
                        version: connectionInfo.version
                    }
                );

                console.log(`✅ Conexión exitosa: ${type}`);

                res.json({
                    success: true,
                    message: 'Conexión exitosa',
                    connectionInfo: connectionInfo,
                    duration: duration
                });
            } else {
                await systemAuditService.logSystemAction(
                    'DATABASE_CONNECTION_FAILED',
                    req.ip,
                    {
                        dbType: type,
                        host: config.host,
                        database: config.database,
                        error: result.message,
                        duration
                    },
                    'error'
                );

                console.error(`❌ Error de conexión: ${result.message}`);

                res.status(500).json({
                    success: false,
                    error: result.message,
                    duration: duration
                });
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            
            await systemAuditService.logSystemAction(
                'DATABASE_CONNECTION_ERROR',
                req.ip,
                {
                    error: error.message,
                    duration
                },
                'error'
            );

            console.error('❌ Error en testConnection:', error);
            res.status(500).json({
                success: false,
                error: 'Error interno del servidor',
                details: error.message,
                duration: duration
            });
        }
    }

    // Obtener información de la base de datos
    async getDatabaseInfo(req, res) {
        try {
            const { type, config } = req.body;

            const connection = await databaseManager.getConnection(type, config);
            let databaseInfo = {};

            if (type.toLowerCase() === 'mysql') {
                // Información de MySQL
                const [schemaInfo] = await connection.execute(`
                    SELECT 
                        schema_name as database_name,
                        default_character_set_name as charset,
                        default_collation_name as collation
                    FROM information_schema.schemata 
                    WHERE schema_name = ?
                `, [config.database]);

                const [tableCount] = await connection.execute(`
                    SELECT COUNT(*) as table_count 
                    FROM information_schema.tables 
                    WHERE table_schema = ?
                `, [config.database]);

                const [size] = await connection.execute(`
                    SELECT 
                        ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
                    FROM information_schema.tables 
                    WHERE table_schema = ?
                `, [config.database]);

                databaseInfo = {
                    type: 'MySQL',
                    database: schemaInfo[0]?.database_name || config.database,
                    charset: schemaInfo[0]?.charset || 'unknown',
                    collation: schemaInfo[0]?.collation || 'unknown',
                    tableCount: tableCount[0].table_count,
                    size: `${size[0].size_mb || 0} MB`
                };
            } else {
                // Información de PostgreSQL
                const client = await connection.connect();
                try {
                    const schemaResult = await client.query(`
                        SELECT current_database() as database_name
                    `);

                    const tableCountResult = await client.query(`
                        SELECT COUNT(*) as table_count 
                        FROM information_schema.tables 
                        WHERE table_schema = $1
                    `, [config.schema || 'public']);

                    const sizeResult = await client.query(`
                        SELECT pg_size_pretty(pg_database_size($1)) as size
                    `, [config.database]);

                    databaseInfo = {
                        type: 'PostgreSQL',
                        database: schemaResult.rows[0].database_name,
                        schema: config.schema || 'public',
                        tableCount: parseInt(tableCountResult.rows[0].table_count),
                        size: sizeResult.rows[0].size
                    };
                } finally {
                    client.release();
                }
            }

            res.json({
                success: true,
                data: databaseInfo
            });
        } catch (error) {
            console.error('Error obteniendo información de base de datos:', error);
            res.status(500).json({
                success: false,
                error: 'Error obteniendo información de la base de datos',
                details: error.message
            });
        }
    }

    // Obtener esquemas (solo PostgreSQL)
    async getSchemas(req, res) {
        try {
            const { type, config } = req.body;

            if (type.toLowerCase() !== 'postgresql' && type.toLowerCase() !== 'postgres') {
                return res.status(400).json({
                    success: false,
                    error: 'Esta operación solo está disponible para PostgreSQL'
                });
            }

            const connection = await databaseManager.getConnection(type, config);
            const client = await connection.connect();
            
            try {
                const result = await client.query(`
                    SELECT 
                        schema_name,
                        schema_name = 'public' as is_default
                    FROM information_schema.schemata 
                    WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
                    ORDER BY is_default DESC, schema_name
                `);

                res.json({
                    success: true,
                    data: result.rows.map(row => ({
                        name: row.schema_name,
                        isDefault: row.is_default
                    }))
                });
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error obteniendo esquemas:', error);
            res.status(500).json({
                success: false,
                error: 'Error obteniendo esquemas de la base de datos',
                details: error.message
            });
        }
    }

    // Obtener estadísticas de la base de datos
    async getDatabaseStats(req, res) {
        try {
            const { type, config } = req.body;

            const connection = await databaseManager.getConnection(type, config);
            let stats = {};

            if (type.toLowerCase() === 'mysql') {
                const [generalStats] = await connection.execute(`
                    SELECT 
                        COUNT(*) as total_tables,
                        SUM(table_rows) as total_rows,
                        ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as total_size_mb
                    FROM information_schema.tables 
                    WHERE table_schema = ?
                `, [config.database]);

                const [auditStats] = await connection.execute(`
                    SELECT COUNT(*) as audit_tables
                    FROM information_schema.tables 
                    WHERE table_schema = ? AND table_name LIKE 'aud_%'
                `, [config.database]);

                stats = {
                    totalTables: generalStats[0].total_tables,
                    totalRows: generalStats[0].total_rows || 0,
                    totalSize: `${generalStats[0].total_size_mb} MB`,
                    auditTables: auditStats[0].audit_tables,
                    regularTables: generalStats[0].total_tables - auditStats[0].audit_tables
                };
            } else {
                const client = await connection.connect();
                try {
                    const generalStatsResult = await client.query(`
                        SELECT 
                            COUNT(*) as total_tables
                        FROM information_schema.tables 
                        WHERE table_schema = $1
                    `, [config.schema || 'public']);

                    const auditStatsResult = await client.query(`
                        SELECT COUNT(*) as audit_tables
                        FROM information_schema.tables 
                        WHERE table_schema = $1 AND table_name LIKE 'aud_%'
                    `, [config.schema || 'public']);

                    const sizeResult = await client.query(`
                        SELECT pg_size_pretty(pg_database_size($1)) as total_size
                    `, [config.database]);

                    stats = {
                        totalTables: parseInt(generalStatsResult.rows[0].total_tables),
                        totalSize: sizeResult.rows[0].total_size,
                        auditTables: parseInt(auditStatsResult.rows[0].audit_tables),
                        regularTables: parseInt(generalStatsResult.rows[0].total_tables) - parseInt(auditStatsResult.rows[0].audit_tables),
                        schema: config.schema || 'public'
                    };
                } finally {
                    client.release();
                }
            }

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            console.error('Error obteniendo estadísticas:', error);
            res.status(500).json({
                success: false,
                error: 'Error obteniendo estadísticas de la base de datos',
                details: error.message
            });
        }
    }

    // Validar configuración
    async validateConfig(req, res) {
        try {
            const { type, config } = req.body;

            const errors = [];

            // Validar tipo
            if (!type || !['mysql', 'postgresql', 'postgres'].includes(type.toLowerCase())) {
                errors.push('Tipo de base de datos no válido o no soportado');
            }

            // Validar configuración
            if (!config) {
                errors.push('Configuración de base de datos requerida');
            } else {
                if (!config.host) errors.push('Host requerido');
                if (!config.user) errors.push('Usuario requerido');
                if (!config.password) errors.push('Contraseña requerida');
                if (!config.database) errors.push('Nombre de base de datos requerido');
                
                // Validar puerto
                if (config.port && (config.port < 1 || config.port > 65535)) {
                    errors.push('Puerto debe estar entre 1 y 65535');
                }

                // Validaciones específicas por tipo
                if (type?.toLowerCase() === 'mysql') {
                    if (!config.port) config.port = 3306;
                } else if (type?.toLowerCase() === 'postgresql' || type?.toLowerCase() === 'postgres') {
                    if (!config.port) config.port = 5432;
                    if (!config.schema) config.schema = 'public';
                }
            }

            if (errors.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Configuración inválida',
                    details: errors
                });
            }

            res.json({
                success: true,
                message: 'Configuración válida',
                normalizedConfig: config
            });
        } catch (error) {
            console.error('Error validando configuración:', error);
            res.status(500).json({
                success: false,
                error: 'Error validando configuración',
                details: error.message
            });
        }
    }

    // Cerrar conexión específica
    async closeConnection(req, res) {
        try {
            const { type, config } = req.body;

            const key = `${type}_${config.host}_${config.database}`;
            await databaseManager.closeConnection(key);

            await systemAuditService.logSystemAction(
                'DATABASE_CONNECTION_CLOSED',
                req.ip,
                {
                    dbType: type,
                    host: config.host,
                    database: config.database
                }
            );

            res.json({
                success: true,
                message: 'Conexión cerrada exitosamente'
            });
        } catch (error) {
            console.error('Error cerrando conexión:', error);
            res.status(500).json({
                success: false,
                error: 'Error cerrando conexión',
                details: error.message
            });
        }
    }
}

module.exports = new DatabaseController();