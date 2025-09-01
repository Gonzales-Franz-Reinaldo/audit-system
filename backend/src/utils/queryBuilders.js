class QueryBuilders {
    // Query optimizada para verificar tablas de auditoría en lote con performance
    static batchCheckAuditTablesQuery(dbType, database, tableNames) {
        if (dbType === 'mysql') {
            const placeholders = tableNames.map(() => '?').join(',');
            return {
                query: `
                    SELECT 
                        t.table_name,
                        t.table_rows,
                        ROUND(((t.data_length + t.index_length) / 1024 / 1024), 2) AS size_mb,
                        t.create_time,
                        t.update_time,
                        CASE 
                            WHEN t.table_name LIKE 'aud_%' THEN 'audit'
                            ELSE 'regular'
                        END as table_type
                    FROM information_schema.tables t
                    WHERE t.table_schema = ? 
                    AND t.table_name IN (${placeholders})
                    ORDER BY t.table_type, t.table_name
                `,
                params: [database, ...tableNames.map(name => `aud_${name}`)]
            };
        } else {
            const placeholders = tableNames.map((_, index) => `$${index + 2}`).join(',');
            return {
                query: `
                    SELECT 
                        t.tablename as table_name,
                        COALESCE(s.n_tup_ins + s.n_tup_upd + s.n_tup_del, 0) as total_changes,
                        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
                        obj_description(c.oid) as table_comment,
                        CASE 
                            WHEN t.tablename LIKE 'aud_%' THEN 'audit'
                            ELSE 'regular'
                        END as table_type
                    FROM pg_tables t
                    LEFT JOIN pg_stat_user_tables s ON t.tablename = s.relname
                    LEFT JOIN pg_class c ON c.relname = t.tablename
                    WHERE t.schemaname = $1 
                    AND t.tablename IN (${placeholders})
                    ORDER BY table_type, t.tablename
                `,
                params: [database, ...tableNames.map(name => `aud_${name}`)]
            };
        }
    }

    // Query para análisis de rendimiento de auditoría
    static getAuditPerformanceAnalysisQuery(dbType, schema, auditTableName, days = 7) {
        if (dbType === 'mysql') {
            return {
                query: `
                    SELECT 
                        DATE(created_at) as audit_date,
                        COUNT(*) as total_records,
                        COUNT(DISTINCT HOUR(created_at)) as active_hours,
                        AVG(CHAR_LENGTH(CONCAT_WS('', *))) as avg_record_size,
                        MIN(created_at) as first_record,
                        MAX(created_at) as last_record,
                        ROUND(COUNT(*) / 24, 2) as avg_records_per_hour
                    FROM ${auditTableName}
                    WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                    GROUP BY DATE(created_at)
                    ORDER BY audit_date DESC
                `,
                params: [days]
            };
        } else {
            return {
                query: `
                    SELECT 
                        DATE(created_at) as audit_date,
                        COUNT(*) as total_records,
                        COUNT(DISTINCT EXTRACT(HOUR FROM created_at)) as active_hours,
                        pg_size_pretty(pg_total_relation_size($2)) as current_table_size,
                        MIN(created_at) as first_record,
                        MAX(created_at) as last_record,
                        ROUND(COUNT(*) / 24.0, 2) as avg_records_per_hour
                    FROM ${schema}.${auditTableName}
                    WHERE created_at >= NOW() - INTERVAL '$1 days'
                    GROUP BY DATE(created_at)
                    ORDER BY audit_date DESC
                `,
                params: [days, `${schema}.${auditTableName}`]
            };
        }
    }

    // Query optimizada para búsqueda rápida en auditoría con índices
    static buildOptimizedAuditSearchQuery(dbType, schema, auditTableName, searchParams = {}) {
        let whereClause = 'WHERE 1=1';
        let params = [];
        let paramIndex = 1;

        // Construir filtros dinámicos con índices optimizados
        if (searchParams.dateFrom) {
            whereClause += dbType === 'mysql' ? ' AND created_at >= ?' : ` AND created_at >= $${paramIndex}`;
            params.push(searchParams.dateFrom);
            paramIndex++;
        }

        if (searchParams.dateTo) {
            whereClause += dbType === 'mysql' ? ' AND created_at <= ?' : ` AND created_at <= $${paramIndex}`;
            params.push(searchParams.dateTo);
            paramIndex++;
        }

        if (searchParams.action) {
            const actionColumn = searchParams.encryptedActionColumn || 'accion_sql';
            whereClause += dbType === 'mysql' ? ` AND ${actionColumn} LIKE ?` : ` AND ${actionColumn} LIKE $${paramIndex}`;
            params.push(`%${searchParams.action}%`);
            paramIndex++;
        }

        if (dbType === 'mysql') {
            return {
                query: `
                    SELECT SQL_CALC_FOUND_ROWS *
                    FROM ${auditTableName} 
                    ${whereClause}
                    ORDER BY id_audit_enc DESC 
                    LIMIT ? OFFSET ?
                `,
                countQuery: 'SELECT FOUND_ROWS() as total',
                params: [...params, searchParams.limit || 50, searchParams.offset || 0]
            };
        } else {
            return {
                query: `
                    SELECT * FROM ${schema}.${auditTableName} 
                    ${whereClause}
                    ORDER BY id_audit_enc DESC 
                    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
                `,
                countQuery: `
                    SELECT COUNT(*) as total FROM ${schema}.${auditTableName} 
                    ${whereClause}
                `,
                params: [...params, searchParams.limit || 50, searchParams.offset || 0]
            };
        }
    }

    // Query para optimización de índices en tablas de auditoría
    static getIndexOptimizationQuery(dbType, database, tableName) {
        if (dbType === 'mysql') {
            return {
                query: `
                    SELECT 
                        s.table_name,
                        s.index_name,
                        s.column_name,
                        s.cardinality,
                        s.non_unique,
                        ROUND((s.cardinality / t.table_rows) * 100, 2) as selectivity_percent,
                        CASE 
                            WHEN s.cardinality < (t.table_rows * 0.1) THEN 'Low Selectivity'
                            WHEN s.cardinality > (t.table_rows * 0.8) THEN 'High Selectivity'
                            ELSE 'Good Selectivity'
                        END as index_quality,
                        t.table_rows
                    FROM information_schema.statistics s
                    JOIN information_schema.tables t 
                        ON s.table_schema = t.table_schema AND s.table_name = t.table_name
                    WHERE s.table_schema = ? 
                    AND s.table_name = ?
                    AND t.table_rows > 1000  -- Solo tablas con datos significativos
                    ORDER BY selectivity_percent DESC
                `,
                params: [database, tableName]
            };
        } else {
            return {
                query: `
                    SELECT 
                        schemaname,
                        tablename,
                        indexname,
                        num_scans,
                        tuples_read,
                        tuples_fetched,
                        CASE 
                            WHEN num_scans = 0 THEN 'Unused'
                            WHEN num_scans < 10 THEN 'Rarely Used'
                            WHEN num_scans > 1000 THEN 'Frequently Used'
                            ELSE 'Moderately Used'
                        END as usage_level,
                        pg_size_pretty(pg_relation_size(indexrelid)) as index_size
                    FROM pg_stat_user_indexes 
                    WHERE schemaname = $1 
                    AND tablename = $2
                    ORDER BY num_scans DESC
                `,
                params: [database, tableName]
            };
        }
    }

    // Query para mantenimiento automático de tablas de auditoría
    static getMaintenanceTasksQuery(dbType, schema, auditTableName, maintenanceType) {
        const queries = {
            mysql: {
                analyze: `ANALYZE TABLE ${auditTableName}`,
                optimize: `OPTIMIZE TABLE ${auditTableName}`,
                check: `CHECK TABLE ${auditTableName}`,
                repair: `REPAIR TABLE ${auditTableName}`,
                reindex: `ALTER TABLE ${auditTableName} ENGINE=InnoDB`,
                vacuum: null // No disponible en MySQL
            },
            postgresql: {
                analyze: `ANALYZE ${schema}.${auditTableName}`,
                vacuum: `VACUUM ANALYZE ${schema}.${auditTableName}`,
                reindex: `REINDEX TABLE ${schema}.${auditTableName}`,
                cluster: `CLUSTER ${schema}.${auditTableName}`,
                full_vacuum: `VACUUM FULL ${schema}.${auditTableName}`
            }
        };

        return queries[dbType] ? queries[dbType][maintenanceType] : null;
    }

    // Query para estadísticas avanzadas de encriptación
    static getEncryptionStatsQuery(dbType, schema, auditTableName) {
        if (dbType === 'mysql') {
            return {
                query: `
                    SELECT 
                        COUNT(*) as total_records,
                        COUNT(DISTINCT DATE(created_at)) as days_with_data,
                        AVG(CHAR_LENGTH(CONCAT_WS('', *))) as avg_encrypted_size,
                        MIN(created_at) as oldest_record,
                        MAX(created_at) as newest_record,
                        ROUND(COUNT(*) / NULLIF(DATEDIFF(MAX(created_at), MIN(created_at)), 0), 2) as avg_records_per_day
                    FROM ${auditTableName}
                    WHERE created_at IS NOT NULL
                `,
                params: []
            };
        } else {
            return {
                query: `
                    SELECT 
                        COUNT(*) as total_records,
                        COUNT(DISTINCT DATE(created_at)) as days_with_data,
                        pg_size_pretty(pg_total_relation_size($1)) as total_table_size,
                        pg_size_pretty(pg_relation_size($1)) as data_size,
                        pg_size_pretty(pg_total_relation_size($1) - pg_relation_size($1)) as index_size,
                        MIN(created_at) as oldest_record,
                        MAX(created_at) as newest_record,
                        ROUND(COUNT(*) / GREATEST(EXTRACT(days FROM (MAX(created_at) - MIN(created_at))), 1), 2) as avg_records_per_day
                    FROM ${schema}.${auditTableName}
                    WHERE created_at IS NOT NULL
                `,
                params: [`${schema}.${auditTableName}`]
            };
        }
    }

    // Query para detección de anomalías en patrones de auditoría
    static getAnomalyDetectionQuery(dbType, schema, auditTableName, threshold = 2) {
        if (dbType === 'mysql') {
            return {
                query: `
                    WITH hourly_stats AS (
                        SELECT 
                            DATE(created_at) as audit_date,
                            HOUR(created_at) as audit_hour,
                            COUNT(*) as record_count
                        FROM ${auditTableName}
                        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                        GROUP BY DATE(created_at), HOUR(created_at)
                    ),
                    avg_stats AS (
                        SELECT 
                            audit_hour,
                            AVG(record_count) as avg_count,
                            STDDEV(record_count) as std_count
                        FROM hourly_stats
                        GROUP BY audit_hour
                    )
                    SELECT 
                        h.audit_date,
                        h.audit_hour,
                        h.record_count,
                        a.avg_count,
                        a.std_count,
                        ABS(h.record_count - a.avg_count) / NULLIF(a.std_count, 0) as z_score,
                        CASE 
                            WHEN ABS(h.record_count - a.avg_count) / NULLIF(a.std_count, 0) > ? THEN 'ANOMALY'
                            ELSE 'NORMAL'
                        END as status
                    FROM hourly_stats h
                    JOIN avg_stats a ON h.audit_hour = a.audit_hour
                    WHERE ABS(h.record_count - a.avg_count) / NULLIF(a.std_count, 0) > ?
                    ORDER BY h.audit_date DESC, h.audit_hour DESC
                `,
                params: [threshold, threshold]
            };
        } else {
            return {
                query: `
                    WITH hourly_stats AS (
                        SELECT 
                            DATE(created_at) as audit_date,
                            EXTRACT(HOUR FROM created_at) as audit_hour,
                            COUNT(*) as record_count
                        FROM ${schema}.${auditTableName}
                        WHERE created_at >= NOW() - INTERVAL '30 days'
                        GROUP BY DATE(created_at), EXTRACT(HOUR FROM created_at)
                    ),
                    avg_stats AS (
                        SELECT 
                            audit_hour,
                            AVG(record_count) as avg_count,
                            STDDEV(record_count) as std_count
                        FROM hourly_stats
                        GROUP BY audit_hour
                    )
                    SELECT 
                        h.audit_date,
                        h.audit_hour,
                        h.record_count,
                        a.avg_count,
                        a.std_count,
                        ABS(h.record_count - a.avg_count) / NULLIF(a.std_count, 0) as z_score,
                        CASE 
                            WHEN ABS(h.record_count - a.avg_count) / NULLIF(a.std_count, 0) > $1 THEN 'ANOMALY'
                            ELSE 'NORMAL'
                        END as status
                    FROM hourly_stats h
                    JOIN avg_stats a ON h.audit_hour = a.audit_hour
                    WHERE ABS(h.record_count - a.avg_count) / NULLIF(a.std_count, 0) > $2
                    ORDER BY h.audit_date DESC, h.audit_hour DESC
                `,
                params: [threshold, threshold]
            };
        }
    }

    // Resto de métodos existentes mejorados...
    static getMySQLTablesWithAuditInfoQuery(database) {
        return {
            query: `
                SELECT 
                    t.table_name,
                    t.table_rows,
                    ROUND(((t.data_length + t.index_length) / 1024 / 1024), 2) AS size_mb,
                    t.table_comment,
                    t.create_time,
                    t.update_time,
                    CASE 
                        WHEN audit_t.table_name IS NOT NULL THEN 1 
                        ELSE 0 
                    END as has_audit,
                    COALESCE(audit_t.table_rows, 0) as audit_records,
                    CASE 
                        WHEN audit_t.table_name IS NOT NULL THEN 
                            ROUND(((audit_t.data_length + audit_t.index_length) / 1024 / 1024), 2)
                        ELSE 0
                    END AS audit_size_mb
                FROM information_schema.tables t
                LEFT JOIN information_schema.tables audit_t 
                    ON audit_t.table_schema = t.table_schema 
                    AND audit_t.table_name = CONCAT('aud_', t.table_name)
                WHERE t.table_schema = ? 
                AND t.table_type = 'BASE TABLE'
                AND t.table_name NOT LIKE 'aud_%'
                ORDER BY t.table_name
            `,
            params: [database]
        };
    }

    
    static getPostgreSQLTablesWithAuditInfoQuery(schema = 'public') {
        return {
            query: `
                SELECT 
                    t.tablename as table_name,
                    COALESCE(s.n_tup_ins + s.n_tup_upd + s.n_tup_del, 0) as total_changes,
                    pg_size_pretty(pg_total_relation_size(
                        quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)
                    )) as size,
                    obj_description(c.oid) as table_comment,
                    CASE 
                        WHEN audit_t.tablename IS NOT NULL THEN 1 
                        ELSE 0 
                    END as has_audit,
                    -- SIMPLIFICAR: Usar 0 por defecto y calcular después
                    0 as audit_records,
                    CASE 
                        WHEN audit_t.tablename IS NOT NULL THEN 
                            pg_size_pretty(pg_total_relation_size(
                                quote_ident(audit_t.schemaname) || '.' || quote_ident(audit_t.tablename)
                            ))
                        ELSE 'N/A'
                    END as audit_size
                FROM pg_tables t
                LEFT JOIN pg_stat_user_tables s ON t.tablename = s.relname AND t.schemaname = s.schemaname
                LEFT JOIN pg_class c ON c.relname = t.tablename AND c.relnamespace = (
                    SELECT oid FROM pg_namespace WHERE nspname = t.schemaname
                )
                LEFT JOIN pg_tables audit_t 
                    ON audit_t.schemaname = t.schemaname 
                    AND audit_t.tablename = ('aud_' || t.tablename)
                WHERE t.schemaname = $1 
                AND t.tablename NOT LIKE 'aud_%'
                ORDER BY t.tablename
            `,
            params: [schema]
        };
    }

    // Query para validación de integridad de encriptación
    static getEncryptionIntegrityCheckQuery(dbType, schema, auditTableName, sampleSize = 100) {
        if (dbType === 'mysql') {
            return {
                query: `
                    SELECT 
                        id_audit_enc,
                        created_at,
                        (SELECT COUNT(*) FROM information_schema.columns 
                         WHERE table_schema = DATABASE() 
                         AND table_name = '${auditTableName}'
                         AND column_name LIKE 'enc_%') as encrypted_columns_count
                    FROM ${auditTableName}
                    ORDER BY RAND()
                    LIMIT ?
                `,
                params: [sampleSize]
            };
        } else {
            return {
                query: `
                    SELECT 
                        id_audit_enc,
                        created_at,
                        (SELECT COUNT(*) FROM information_schema.columns 
                         WHERE table_schema = $2
                         AND table_name = $3
                         AND column_name LIKE 'enc_%') as encrypted_columns_count
                    FROM ${schema}.${auditTableName}
                    ORDER BY RANDOM()
                    LIMIT $1
                `,
                params: [sampleSize, schema, auditTableName]
            };
        }
    }


    static getMySQLTablesQuery(database) {
        return {
            query: `
                SELECT 
                    table_name,
                    table_rows,
                    ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb,
                    table_comment,
                    create_time,
                    update_time
                FROM information_schema.tables 
                WHERE table_schema = ? 
                AND table_type = 'BASE TABLE'
                AND table_name NOT LIKE 'aud_%'
                ORDER BY table_name
            `,
            params: [database]
        };
    }

    static getPostgreSQLTablesQuery(schema = 'public') {
        return {
            query: `
                SELECT 
                    t.tablename as table_name,
                    COALESCE(s.n_tup_ins + s.n_tup_upd + s.n_tup_del, 0) as table_rows,
                    pg_size_pretty(pg_total_relation_size(t.schemaname||'.'||t.tablename)) as size_mb,
                    obj_description(c.oid) as table_comment
                FROM pg_tables t
                LEFT JOIN pg_stat_user_tables s ON t.tablename = s.relname AND t.schemaname = s.schemaname
                LEFT JOIN pg_class c ON c.relname = t.tablename
                WHERE t.schemaname = $1 
                AND t.tablename NOT LIKE 'aud_%'
                ORDER BY t.tablename
            `,
            params: [schema]
        };
    }

    static getPostgreSQLColumnsQuery(schema, tableName) {
        return {
            query: `
                SELECT 
                    column_name,
                    data_type as column_type,
                    is_nullable,
                    column_default,
                    ordinal_position
                FROM information_schema.columns 
                WHERE table_schema = $1 AND table_name = $2 
                ORDER BY ordinal_position
            `,
            params: [schema, tableName]
        };
    }

    static getMySQLColumnsQuery(database, tableName) {
        return {
            query: `
                SELECT 
                    column_name, 
                    column_type, 
                    is_nullable, 
                    column_default, 
                    column_key, 
                    extra,
                    ordinal_position
                FROM information_schema.columns 
                WHERE table_schema = ? AND table_name = ? 
                ORDER BY ordinal_position
            `,
            params: [database, tableName]
        };
    }

    static getMySQLIndexesQuery(database, tableName) {
        return {
            query: `
                SELECT 
                    index_name,
                    column_name,
                    non_unique
                FROM information_schema.statistics 
                WHERE table_schema = ? AND table_name = ?
                ORDER BY index_name, seq_in_index
            `,
            params: [database, tableName]
        };
    }

    static getPostgreSQLIndexesQuery(schema, tableName) {
        return {
            query: `
                SELECT 
                    i.relname as index_name,
                    a.attname as column_name,
                    ix.indisunique as is_unique
                FROM pg_class t
                JOIN pg_index ix ON t.oid = ix.indrelid
                JOIN pg_class i ON i.oid = ix.indexrelid
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
                WHERE t.relname = $2 AND t.relnamespace = (
                    SELECT oid FROM pg_namespace WHERE nspname = $1
                )
                ORDER BY i.relname, a.attnum
            `,
            params: [schema, tableName]
        };
    }

    static getSampleDataQuery(dbType, schema, tableName, limit = 5) {
        if (dbType === 'mysql') {
            return {
                query: `SELECT * FROM \`${tableName}\` LIMIT ?`,
                params: [limit]
            };
        } else {
            return {
                query: `SELECT * FROM "${schema}"."${tableName}" LIMIT $1`,
                params: [limit]
            };
        }
    }

    static getRecordCountQuery(dbType, schema, tableName) {
        if (dbType === 'mysql') {
            return {
                query: `SELECT COUNT(*) as count FROM \`${tableName}\``,
                params: []
            };
        } else {
            return {
                query: `SELECT COUNT(*) as count FROM "${schema}"."${tableName}"`,
                params: []
            };
        }
    }



    static getMySQLTableSizeQuery(database, tableName) {
        return {
            query: `
                SELECT 
                    table_rows,
                    data_length,
                    index_length,
                    (data_length + index_length) as total_size
                FROM information_schema.tables 
                WHERE table_schema = ? AND table_name = ?
            `,
            params: [database, tableName]
        };
    }

    static checkMySQLAuditTableQuery(database, auditTableName) {
        return {
            query: `
                SELECT COUNT(*) as count 
                FROM information_schema.tables 
                WHERE table_schema = ? AND table_name = ?
            `,
            params: [database, auditTableName]
        };
    }

    static checkPostgreSQLAuditTableQuery(schema, auditTableName) {
        return {
            query: `
                SELECT COUNT(*) as count 
                FROM information_schema.tables 
                WHERE table_schema = $1 AND table_name = $2
            `,
            params: [schema, auditTableName]
        };
    }

    static getMySQLTriggersQuery(database, tableName) {
        return {
            query: `
                SELECT 
                    trigger_name,
                    event_manipulation,
                    action_timing
                FROM information_schema.triggers 
                WHERE trigger_schema = ? AND event_object_table = ?
            `,
            params: [database, tableName]
        };
    }

    static getPostgreSQLTriggersQuery(schema, tableName) {
        return {
            query: `
                SELECT 
                    trigger_name,
                    event_manipulation,
                    action_timing
                FROM information_schema.triggers 
                WHERE trigger_schema = $1 AND event_object_table = $2
            `,
            params: [schema, tableName]
        };
    }
}

module.exports = QueryBuilders;