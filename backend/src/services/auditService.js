const encryptionService = require('./encryptionService');
const triggerService = require('./triggerService');

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
                query = `
                SELECT 
                    table_name,
                    table_rows as record_count
                FROM information_schema.tables 
                WHERE table_schema = ? 
                AND table_name LIKE 'aud_%'
                ORDER BY table_name
            `;
                params = [config.database];
            } else if (dbType === 'postgresql') {
                // CORREGIR: Query simplificado y funcional para PostgreSQL
                query = `
                SELECT 
                    tablename as table_name
                FROM pg_tables 
                WHERE schemaname = $1 
                AND tablename LIKE 'aud_%'
                ORDER BY tablename
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

                    console.log('📋 Resultado bruto de PostgreSQL:', result);

                    // MEJORAR: Obtener conteo real por separado para cada tabla
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
            console.log('📋 Datos de tablas:', result);

            // CORREGIR: Mapear correctamente los resultados
            const auditTables = result.map(row => {
                const originalTable = row.table_name.replace('aud_', '');
                return {
                    tableName: row.table_name,
                    originalTable: originalTable,
                    hasEncryption: true,
                    recordCount: parseInt(row.record_count) || 0
                };
            });

            console.log('📋 Tablas de auditoría mapeadas:', auditTables);

            return auditTables;
        } catch (error) {
            console.error('💥 Error obteniendo tablas de auditoría:', error);
            console.error('📋 Stack:', error.stack);
            throw new Error(`Error al obtener tablas de auditoría: ${error.message}`);
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

    // Desencriptar datos de auditoría
    async getDecryptedAuditData(dbType, connection, config, auditTableName, encryptionKey, limit = 100, offset = 0) {
        try {
            // Primero obtener los datos encriptados
            const encryptedData = await this.getEncryptedAuditData(dbType, connection, config, auditTableName, limit, offset);

            // Obtener la tabla original
            const originalTableName = auditTableName.replace(this.auditTablePrefix, '');
            const originalColumns = await this.getOriginalTableColumns(dbType, connection, config, originalTableName);

            // Agregar columnas de auditoría
            const auditColumns = ['usuario_accion', 'fecha_accion', 'accion_sql'];
            const allOriginalColumns = [...originalColumns.map(col => col.name), ...auditColumns];

            // Desencriptar cada fila
            const decryptedData = [];

            for (const encryptedRow of encryptedData.data) {
                try {
                    const decryptedRow = { id_audit_enc: encryptedRow.id_audit_enc };

                    // Desencriptar cada columna
                    for (const originalColumn of allOriginalColumns) {
                        const encryptedColumnName = encryptionService.encryptColumnName(originalColumn, encryptionKey);

                        if (encryptedRow[encryptedColumnName] !== undefined && encryptedRow[encryptedColumnName] !== null) {
                            try {
                                decryptedRow[originalColumn] = encryptionService.decrypt(
                                    encryptedRow[encryptedColumnName],
                                    encryptionKey
                                );
                            } catch (decryptError) {
                                decryptedRow[originalColumn] = '[ERROR_DESENCRIPTACION]';
                            }
                        } else {
                            decryptedRow[originalColumn] = null;
                        }
                    }

                    decryptedData.push(decryptedRow);
                } catch (rowError) {
                    console.error('Error desencriptando fila:', rowError);
                    // Mantener la fila con datos de error
                    decryptedData.push({
                        id_audit_enc: encryptedRow.id_audit_enc,
                        error: 'Error en desencriptación de fila'
                    });
                }
            }

            return {
                data: decryptedData,
                columns: [
                    { name: 'id_audit_enc', type: 'int' },
                    ...allOriginalColumns.map(col => ({ name: col, type: 'text' }))
                ],
                originalColumns: allOriginalColumns,
                totalRecords: decryptedData.length,
                isEncrypted: false
            };
        } catch (error) {
            console.error('Error desencriptando datos de auditoría:', error);

            // Si hay error en la desencriptación, probablemente sea contraseña incorrecta
            if (error.message.includes('desencriptación')) {
                throw new Error('Contraseña de desencriptación incorrecta');
            }

            throw new Error(`Error al desencriptar datos: ${error.message}`);
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
            // Obtener una muestra pequeña de datos
            const encryptedData = await this.getEncryptedAuditData(dbType, connection, config, auditTableName, 1, 0);

            if (encryptedData.data.length === 0) {
                return { valid: true, message: 'No hay datos para validar' };
            }

            // Intentar desencriptar el primer registro
            const firstRow = encryptedData.data[0];
            const encryptedColumns = Object.keys(firstRow).filter(col => col !== 'id_audit_enc');

            if (encryptedColumns.length === 0) {
                return { valid: false, message: 'No se encontraron columnas encriptadas' };
            }

            // Probar desencriptar la primera columna encriptada con valor no nulo
            let testColumn = null;
            for (const col of encryptedColumns) {
                if (firstRow[col] !== null && firstRow[col] !== undefined) {
                    testColumn = col;
                    break;
                }
            }

            if (!testColumn) {
                return { valid: true, message: 'No hay valores para validar' };
            }

            try {
                encryptionService.decrypt(firstRow[testColumn], encryptionKey);
                return { valid: true, message: 'Contraseña válida' };
            } catch (decryptError) {
                return { valid: false, message: 'Contraseña incorrecta' };
            }
        } catch (error) {
            console.error('Error validando contraseña:', error);
            return { valid: false, message: 'Error en validación' };
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
    async removeAuditTable(dbType, connection, config, auditTableName) {
        try {
            const originalTableName = auditTableName.replace(this.auditTablePrefix, '');

            if (dbType === 'mysql') {
                // Eliminar triggers
                await connection.execute(`DROP TRIGGER IF EXISTS ${originalTableName}_update_audit`);
                await connection.execute(`DROP TRIGGER IF EXISTS ${originalTableName}_delete_audit`);

                // Eliminar tabla
                await connection.execute(`DROP TABLE IF EXISTS ${auditTableName}`);
            } else if (dbType === 'postgresql') {
                const schema = config.schema || 'public';

                const client = await connection.connect();
                try {
                    // Eliminar trigger y función
                    await client.query(`DROP TRIGGER IF EXISTS ${originalTableName}_audit_trigger ON ${schema}.${originalTableName}`);
                    await client.query(`DROP FUNCTION IF EXISTS ${schema}.${originalTableName}_audit_function()`);

                    // Eliminar tabla
                    await client.query(`DROP TABLE IF EXISTS ${schema}.${auditTableName}`);
                } finally {
                    client.release();
                }
            }

            return {
                success: true,
                message: `Auditoría eliminada exitosamente para ${originalTableName}`
            };
        } catch (error) {
            console.error('Error eliminando auditoría:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new AuditService();