const databaseManager = require('../config/database');
const queryBuilders = require('../utils/queryBuilders');

class TableController {
    // Obtener lista de todas las tablas - ARQUITECTURA CORREGIDA
    async getTables(req, res) {
        try {
            const { type, config } = req.body;

            console.log(`📊 Obteniendo tablas para ${type}: ${config.database}`);

            if (!type || !config) {
                return res.status(400).json({
                    success: false,
                    error: 'Tipo y configuración de base de datos requeridos'
                });
            }

            if (type.toLowerCase() === 'postgresql' && !config.schema) {
                config.schema = 'public';
            }

            const connection = await databaseManager.getConnection(type, config);

            try {
                let queryData;
                let useAdvancedQuery = true;

                if (type === 'mysql') {
                    queryData = queryBuilders.getMySQLTablesWithAuditInfoQuery(config.database);
                } else {
                    try {
                        const client = await connection.connect();
                        try {
                            await client.query(`SELECT 1 FROM sys_audit_metadata_enc LIMIT 1`);
                            console.log('✅ Tabla de metadatos encontrada, usando query avanzada');
                            queryData = queryBuilders.getPostgreSQLTablesWithAuditInfoQuery(config.schema || 'public');
                        } catch (metaError) {
                            console.log('⚠️ Tabla de metadatos no existe, usando query segura');
                            queryData = queryBuilders.getPostgreSQLTablesWithAuditInfoQuerySafe(config.schema || 'public');
                            useAdvancedQuery = false;
                        } finally {
                            client.release();
                        }
                    } catch (connectionError) {
                        console.log('⚠️ Error verificando metadatos, usando query segura');
                        queryData = queryBuilders.getPostgreSQLTablesWithAuditInfoQuerySafe(config.schema || 'public');
                        useAdvancedQuery = false;
                    }
                }

                console.log(`🔍 Ejecutando query principal para ${type} (avanzada: ${useAdvancedQuery})`);

                let result;
                if (type === 'mysql') {
                    [result] = await connection.execute(queryData.query, queryData.params);
                } else {
                    const client = await connection.connect();
                    try {
                        const queryResult = await client.query(queryData.query, queryData.params);
                        result = queryResult.rows;
                    } finally {
                        client.release();
                    }
                }

                console.log(`📋 Encontradas ${result.length} tablas (query principal)`);

                const tables = [];
                
                for (const row of result) {
                    const hasAudit = parseInt(row.has_audit) === 1;
                    
                    let finalHasAudit = hasAudit;
                    let finalAuditType = row.audit_type;
                    let finalAuditTableName = row.audit_table_name;
                    let auditRecordCount = 0;

                    if (!useAdvancedQuery) {
                        try {
                            const encryptedTableName = await this.checkForEncryptedAuditTable(type, connection, config, row.table_name);
                            if (encryptedTableName) {
                                finalHasAudit = true;
                                finalAuditType = 'encrypted';
                                finalAuditTableName = encryptedTableName;
                            }
                        } catch (encError) {
                            console.warn(`Error verificando auditoría encriptada para ${row.table_name}:`, encError.message);
                        }
                    }

                    if (finalHasAudit && finalAuditTableName) {
                        auditRecordCount = await TableController.getAuditRecordCount(
                            type, 
                            connection, 
                            config, 
                            finalAuditTableName,
                            finalAuditType || 'conventional'
                        );
                    }

                    const table = {
                        name: row.table_name,
                        recordCount: await TableController.parseRecordCount(row, type, connection, config),
                        size: TableController.formatTableSize(row, type),
                        comment: row.table_comment || null,
                        hasAudit: finalHasAudit,
                        auditTableName: finalHasAudit ? finalAuditTableName : null,
                        auditType: finalHasAudit ? finalAuditType : null,
                        auditRecordCount: auditRecordCount,
                        auditSize: finalHasAudit ? TableController.formatAuditSize(row, type) : null,
                        auditStatus: finalHasAudit 
                            ? (finalAuditType === 'encrypted' ? 'Auditoría Encriptada' : 'Auditoría Convencional')
                            : 'Sin Auditoría',
                        createdAt: row.create_time || null,
                        updatedAt: row.update_time || null
                    };

                    tables.push(table);
                }

                res.json({
                    success: true,
                    data: tables,
                    totalTables: tables.length,
                    tablesWithAudit: tables.filter(t => t.hasAudit).length,
                    auditStatistics: {
                        conventional: tables.filter(t => t.auditType === 'conventional').length,
                        encrypted: tables.filter(t => t.auditType === 'encrypted').length,
                        withoutAudit: tables.filter(t => !t.hasAudit).length
                    },
                    advancedQueryUsed: useAdvancedQuery
                });

            } catch (queryError) {
                console.error('❌ Error en query principal:', queryError);
                
                // FALLBACK: Query ultra-simple
                console.log('🔄 Usando query de fallback ultra-simple...');
                
                try {
                    let fallbackQuery;
                    if (type === 'mysql') {
                        fallbackQuery = queryBuilders.getMySQLTablesQuery(config.database);
                    } else {
                        fallbackQuery = queryBuilders.getPostgreSQLTablesQuery(config.schema || 'public');
                    }

                    let fallbackResult;
                    if (type === 'mysql') {
                        [fallbackResult] = await connection.execute(fallbackQuery.query, fallbackQuery.params);
                    } else {
                        const client = await connection.connect();
                        try {
                            const queryResult = await client.query(fallbackQuery.query, fallbackQuery.params);
                            fallbackResult = queryResult.rows;
                        } finally {
                            client.release();
                        }
                    }

                    const simpleTables = fallbackResult
                        .filter(row => 
                            !row.table_name.startsWith('aud_') &&
                            !row.table_name.match(/^t[0-9a-f]{32}$/) &&
                            row.table_name !== 'sys_audit_metadata_enc'
                        )
                        .map(row => ({
                            name: row.table_name,
                            recordCount: parseInt(row.table_rows) || 0,
                            size: type === 'mysql' ? `${row.size_mb || 0} MB` : (row.size_mb || 'N/A'),
                            comment: row.table_comment || null,
                            hasAudit: false, 
                            auditTableName: null,
                            auditType: null,
                            auditRecordCount: 0,
                            auditSize: null,
                            auditStatus: 'Desconocido',
                            createdAt: row.create_time || null,
                            updatedAt: row.update_time || null
                        }));

                    res.json({
                        success: true,
                        data: simpleTables,
                        totalTables: simpleTables.length,
                        tablesWithAudit: 0,
                        auditStatistics: {
                            conventional: 0,
                            encrypted: 0,
                            withoutAudit: simpleTables.length
                        },
                        fallbackMode: true
                    });

                } catch (fallbackError) {
                    console.error('❌ Error en query de fallback:', fallbackError);
                    res.status(500).json({
                        success: false,
                        error: 'Error obteniendo lista de tablas',
                        details: fallbackError.message
                    });
                }
            }

        } catch (error) {
            console.error('❌ Error obteniendo tablas:', error);
            res.status(500).json({
                success: false,
                error: 'Error obteniendo lista de tablas',
                details: error.message
            });
        }
    }

    async checkForEncryptedAuditTable(type, connection, config, tableName) {
        try {
            if (type !== 'postgresql') return null;

            const client = await connection.connect();
            try {
                const result = await client.query(`
                    SELECT tablename 
                    FROM pg_tables 
                    WHERE schemaname = $1 
                    AND tablename ~ '^t[0-9a-f]{32}$'
                `, [config.schema || 'public']);

                if (result.rows.length > 0) {
                    return result.rows[0].tablename;
                }
                
                return null;
            } finally {
                client.release();
            }
        } catch (error) {
            console.warn('Error verificando auditoría encriptada:', error.message);
            return null;
        }
    }


    // CONVERTIR TODOS LOS MÉTODOS A ESTÁTICOS
    static async parseRecordCount(row, type, connection, config) {
        try {
            if (type === 'mysql') {
                return parseInt(row.table_rows) || 0;
            } else {
                // Para PostgreSQL, obtener conteo real
                const realCount = await TableController.getRealRecordCount(type, connection, config, row.table_name);
                return realCount;
            }
        } catch (error) {
            console.warn(`Error obteniendo conteo para ${row.table_name}:`, error.message);
            return 0;
        }
    }


    static async getAuditRecordCount(type, connection, config, auditTableName, auditType = 'conventional') {
        try {
            let query;
            let params = [];

            if (type === 'mysql') {
                if (auditType === 'encrypted') {
                    // Para tablas encriptadas, usar el nombre encriptado directamente
                    query = `SELECT COUNT(*) as count FROM \`${auditTableName}\``;
                } else {
                    // Para auditoría convencional
                    query = `SELECT COUNT(*) as count FROM \`${auditTableName}\``;
                }
            } else {
                if (auditType === 'encrypted') {
                    // Para tablas encriptadas en PostgreSQL
                    query = `SELECT COUNT(*) as count FROM "${config.schema || 'public'}"."${auditTableName}"`;
                } else {
                    // Para auditoría convencional
                    query = `SELECT COUNT(*) as count FROM "${config.schema || 'public'}"."${auditTableName}"`;
                }
            }

            let result;
            if (type === 'mysql') {
                [result] = await connection.execute(query, params);
                return parseInt(result[0].count) || 0;
            } else {
                const client = await connection.connect();
                try {
                    const queryResult = await client.query(query);
                    return parseInt(queryResult.rows[0].count) || 0;
                } finally {
                    client.release();
                }
            }
        } catch (error) {
            console.warn(`Error contando registros en ${auditTableName}:`, error.message);
            return 0;
        }
    }


    static formatTableSize(row, type) {
        if (type === 'mysql') {
            return row.size_mb ? `${row.size_mb} MB` : 'N/A';
        } else {
            return row.size || 'N/A';
        }
    }

    static parseAuditRecords(row, type) {
        return parseInt(row.audit_records) || 0;
    }

    static formatAuditSize(row, type) {
        if (type === 'mysql') {
            return row.audit_size_mb ? `${row.audit_size_mb} MB` : 'N/A';
        } else {
            return row.audit_size || 'N/A';
        }
    }

    static async checkAuditTableExists(type, connection, config, auditTableName) {
        try {
            let query;
            let params = [];

            if (type === 'mysql') {
                query = `
                    SELECT COUNT(*) as count 
                    FROM information_schema.tables 
                    WHERE table_schema = ? AND table_name = ?
                `;
                params = [config.database, auditTableName];
            } else {
                query = `
                    SELECT COUNT(*) as count 
                    FROM information_schema.tables 
                    WHERE table_schema = $1 AND table_name = $2
                `;
                params = [config.schema || 'public', auditTableName];
            }

            let result;
            if (type === 'mysql') {
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

    static async getRealRecordCount(type, connection, config, tableName) {
        try {
            let query;
            let params = [];

            if (type === 'mysql') {
                query = `SELECT COUNT(*) as count FROM \`${tableName}\``;
            } else {
                query = `SELECT COUNT(*) as count FROM "${config.schema || 'public'}"."${tableName}"`;
            }

            let result;
            if (type === 'mysql') {
                [result] = await connection.execute(query, params);
                return parseInt(result[0].count) || 0;
            } else {
                const client = await connection.connect();
                try {
                    const queryResult = await client.query(query, params);
                    return parseInt(queryResult.rows[0].count) || 0;
                } finally {
                    client.release();
                }
            }
        } catch (error) {
            console.error(`Error obteniendo conteo real para ${tableName}:`, error);
            return 0;
        }
    }

    // MANTENER MÉTODOS DE INSTANCIA PARA OTROS ENDPOINTS
    async getTableInfo(req, res) {
        try {
            const { type, config } = req.body;
            const { tableName } = req.params;

            if (!tableName) {
                return res.status(400).json({
                    success: false,
                    error: 'Nombre de tabla requerido'
                });
            }

            const connection = await databaseManager.getConnection(type, config);

            // Obtener columnas
            const columns = await this.getTableColumns(type, connection, config, tableName);

            // Obtener índices
            const indexes = await this.getTableIndexes(type, connection, config, tableName);

            // Obtener muestra de datos
            const sampleData = await this.getSampleData(type, connection, config, tableName);

            // Obtener estadísticas
            const stats = await this.getTableStats(type, connection, config, tableName);

            // Verificar si tiene auditoría
            const auditTableName = `aud_${tableName}`;
            const hasAudit = await TableController.checkAuditTableExists(type, connection, config, auditTableName);

            res.json({
                success: true,
                data: {
                    name: tableName,
                    columns: columns,
                    indexes: indexes,
                    sampleData: sampleData,
                    statistics: stats,
                    audit: {
                        hasAudit: hasAudit,
                        auditTableName: hasAudit ? auditTableName : null
                    }
                }
            });
        } catch (error) {
            console.error(`Error obteniendo información de tabla ${req.params.tableName}:`, error);
            res.status(500).json({
                success: false,
                error: 'Error obteniendo información de la tabla',
                details: error.message
            });
        }
    }

    // Resto de métodos de instancia sin cambios (solo para otros endpoints)
    async getTableColumns(type, connection, config, tableName) {
        let queryData;

        if (type === 'mysql') {
            queryData = queryBuilders.getMySQLColumnsQuery(config.database, tableName);
        } else {
            queryData = queryBuilders.getPostgreSQLColumnsQuery(config.schema || 'public', tableName);
        }

        let result;
        if (type === 'mysql') {
            [result] = await connection.execute(queryData.query, queryData.params);
        } else {
            const client = await connection.connect();
            try {
                const queryResult = await client.query(queryData.query, queryData.params);
                result = queryResult.rows;
            } finally {
                client.release();
            }
        }

        return result.map(col => ({
            name: col.column_name,
            type: col.column_type,
            nullable: col.is_nullable === 'YES',
            default: col.column_default,
            key: col.column_key || null,
            extra: col.extra || null,
            position: col.ordinal_position
        }));
    }

    async getTableIndexes(type, connection, config, tableName) {
        let queryData;

        if (type === 'mysql') {
            queryData = queryBuilders.getMySQLIndexesQuery(config.database, tableName);
        } else {
            queryData = queryBuilders.getPostgreSQLIndexesQuery(config.schema || 'public', tableName);
        }

        let result;
        if (type === 'mysql') {
            [result] = await connection.execute(queryData.query, queryData.params);
        } else {
            const client = await connection.connect();
            try {
                const queryResult = await client.query(queryData.query, queryData.params);
                result = queryResult.rows;
            } finally {
                client.release();
            }
        }

        // Agrupar índices por nombre
        const indexMap = new Map();

        result.forEach(row => {
            const indexName = row.index_name;
            if (!indexMap.has(indexName)) {
                indexMap.set(indexName, {
                    name: indexName,
                    unique: type === 'mysql' ? row.non_unique === 0 : row.is_unique,
                    columns: []
                });
            }
            indexMap.get(indexName).columns.push(row.column_name);
        });

        return Array.from(indexMap.values());
    }

    async getSampleData(type, connection, config, tableName, limit = 5) {
        const schema = config.schema || 'public';
        const queryData = queryBuilders.getSampleDataQuery(type, schema, tableName, limit);

        let result;
        if (type === 'mysql') {
            [result] = await connection.execute(queryData.query, queryData.params);
        } else {
            const client = await connection.connect();
            try {
                const queryResult = await client.query(queryData.query, queryData.params);
                result = queryResult.rows;
            } finally {
                client.release();
            }
        }

        return result;
    }

    async getTableStats(type, connection, config, tableName) {
        try {
            // Usar método estático
            const realCount = await TableController.getRealRecordCount(type, connection, config, tableName);

            if (type === 'mysql') {
                const queryData = queryBuilders.getMySQLTableSizeQuery(config.database, tableName);
                const [result] = await connection.execute(queryData.query, queryData.params);
                
                return {
                    totalRecords: realCount,
                    tableRows: parseInt(result[0]?.table_rows) || 0,
                    dataSize: parseInt(result[0]?.data_length) || 0,
                    indexSize: parseInt(result[0]?.index_length) || 0,
                    totalSize: parseInt(result[0]?.total_size) || 0
                };
            } else {
                return {
                    totalRecords: realCount,
                    totalSize: 'N/A',
                    tableSize: 'N/A'
                };
            }
        } catch (error) {
            console.error(`Error obteniendo estadísticas para ${tableName}:`, error);
            return {
                totalRecords: 0,
                totalSize: 'N/A',
                tableSize: 'N/A'
            };
        }
    }

    async getTableTriggers(req, res) {
        try {
            const { type, config } = req.body;
            const { tableName } = req.params;

            const connection = await databaseManager.getConnection(type, config);
            let queryData;

            if (type === 'mysql') {
                queryData = queryBuilders.getMySQLTriggersQuery(config.database, tableName);
            } else {
                queryData = queryBuilders.getPostgreSQLTriggersQuery(config.schema || 'public', tableName);
            }

            let result;
            if (type === 'mysql') {
                [result] = await connection.execute(queryData.query, queryData.params);
            } else {
                const client = await connection.connect();
                try {
                    const queryResult = await client.query(queryData.query, queryData.params);
                    result = queryResult.rows;
                } finally {
                    client.release();
                }
            }

            res.json({
                success: true,
                data: result.map(trigger => ({
                    name: trigger.trigger_name,
                    event: trigger.event_manipulation,
                    timing: trigger.action_timing
                }))
            });
        } catch (error) {
            console.error('Error obteniendo triggers:', error);
            res.status(500).json({
                success: false,
                error: 'Error obteniendo triggers de la tabla',
                details: error.message
            });
        }
    }

    async validateTable(req, res) {
        try {
            const { type, config } = req.body;
            const { tableName } = req.params;

            const connection = await databaseManager.getConnection(type, config);

            let query;
            let params;

            if (type === 'mysql') {
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
            if (type === 'mysql') {
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

            const exists = parseInt(result[0].count) > 0;

            res.json({
                success: true,
                data: {
                    exists: exists,
                    tableName: tableName
                }
            });
        } catch (error) {
            console.error('Error validando tabla:', error);
            res.status(500).json({
                success: false,
                error: 'Error validando existencia de tabla',
                details: error.message
            });
        }
    }
}

module.exports = new TableController();