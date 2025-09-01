const databaseManager = require('../config/database');
const queryBuilders = require('../utils/queryBuilders');

class TableController {
    // Obtener lista de todas las tablas - ARQUITECTURA CORREGIDA
    async getTables(req, res) {
        try {
            const { type, config } = req.body;

            console.log(`📊 Obteniendo tablas para ${type}: ${config.database}`);

            // Validar configuración
            if (!type || !config) {
                return res.status(400).json({
                    success: false,
                    error: 'Tipo y configuración de base de datos requeridos'
                });
            }

            if (type.toLowerCase() === 'postgresql' && !config.schema) {
                config.schema = 'public';
                console.log(`📝 Usando esquema por defecto: public`);
            }

            const connection = await databaseManager.getConnection(type, config);

            try {
                // PRIMERA TENTATIVA: Query completo
                let queryData;
                if (type === 'mysql') {
                    queryData = queryBuilders.getMySQLTablesWithAuditInfoQuery(config.database);
                } else {
                    queryData = queryBuilders.getPostgreSQLTablesWithAuditInfoQuery(config.schema || 'public');
                }

                console.log(`🔍 Ejecutando query principal para ${type}`);

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

                // SOLUCIÓN: Usar funciones estáticas en lugar de métodos de instancia
                const tables = [];
                
                for (const row of result) {
                    try {
                        const table = {
                            name: row.table_name,
                            recordCount: await TableController.parseRecordCount(row, type, connection, config),
                            size: TableController.formatTableSize(row, type),
                            comment: row.table_comment || '',
                            hasAudit: parseInt(row.has_audit) === 1,
                            auditRecords: 0,
                            auditSize: 'N/A'
                        };

                        // Si tiene auditoría, obtener conteo real
                        if (table.hasAudit) {
                            try {
                                const auditCount = await TableController.getAuditRecordCount(type, connection, config, `aud_${row.table_name}`);
                                table.auditRecords = auditCount;
                                table.auditSize = TableController.formatAuditSize(row, type);
                            } catch (auditError) {
                                console.warn(`Error obteniendo conteo de auditoría para ${row.table_name}:`, auditError.message);
                                table.auditRecords = 0;
                            }
                        }

                        tables.push(table);
                    } catch (rowError) {
                        console.warn(`Error procesando tabla ${row.table_name}:`, rowError.message);
                        // Agregar tabla con información básica
                        tables.push({
                            name: row.table_name,
                            recordCount: 0,
                            size: 'N/A',
                            comment: '',
                            hasAudit: false,
                            auditRecords: 0,
                            auditSize: 'N/A'
                        });
                    }
                }

                res.json({
                    success: true,
                    data: tables,
                    totalTables: tables.length,
                    tablesWithAudit: tables.filter(t => t.hasAudit).length
                });

            } catch (queryError) {
                console.error('❌ Error en query principal:', queryError);
                
                // FALLBACK: Query ultra-simple
                console.log('🔄 Usando query de fallback ultra-simple...');
                
                try {
                    let query;
                    let params = [];

                    if (type === 'mysql') {
                        query = `
                            SELECT 
                                table_name,
                                '' as table_comment
                            FROM information_schema.tables 
                            WHERE table_schema = ? 
                            AND table_type = 'BASE TABLE'
                            AND table_name NOT LIKE 'aud_%'
                            ORDER BY table_name
                        `;
                        params = [config.database];
                    } else {
                        query = `
                            SELECT 
                                tablename as table_name,
                                '' as table_comment
                            FROM pg_tables 
                            WHERE schemaname = $1 
                            AND tablename NOT LIKE 'aud_%'
                            ORDER BY tablename
                        `;
                        params = [config.schema || 'public'];
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

                    // USAR FUNCIONES ESTÁTICAS en fallback también
                    const tables = [];
                    for (const row of result) {
                        const hasAudit = await TableController.checkAuditTableExists(type, connection, config, `aud_${row.table_name}`);
                        const realCount = await TableController.getRealRecordCount(type, connection, config, row.table_name);
                        
                        tables.push({
                            name: row.table_name,
                            recordCount: realCount,
                            size: 'N/A',
                            comment: row.table_comment || '',
                            hasAudit: hasAudit,
                            auditRecords: hasAudit ? await TableController.getAuditRecordCount(type, connection, config, `aud_${row.table_name}`) : 0,
                            auditSize: 'N/A'
                        });
                    }

                    console.log(`📋 Encontradas ${tables.length} tablas (fallback)`);

                    res.json({
                        success: true,
                        data: tables,
                        totalTables: tables.length,
                        tablesWithAudit: tables.filter(t => t.hasAudit).length,
                        warning: 'Usando query simplificada debido a errores en query completa'
                    });

                } catch (fallbackError) {
                    console.error('❌ Error en query de fallback:', fallbackError);
                    res.status(500).json({
                        success: false,
                        error: 'Error obteniendo lista de tablas (query de fallback)',
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

    static async getAuditRecordCount(type, connection, config, auditTableName) {
        try {
            let query;
            let params = [];

            if (type === 'mysql') {
                query = `SELECT COUNT(*) as count FROM \`${auditTableName}\``;
            } else {
                query = `SELECT COUNT(*) as count FROM "${config.schema || 'public'}"."${auditTableName}"`;
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