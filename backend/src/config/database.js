const mysql = require('mysql2/promise');
const { Pool } = require('pg');

class DatabaseManager {
    constructor() {
        this.connections = new Map();
    }

    async getMySQLConnection(config) {
        const key = `mysql_${config.host}_${config.database}`;

        if (this.connections.has(key)) {
            return this.connections.get(key);
        }

        try {
            const connection = await mysql.createConnection({
                host: config.host || 'localhost',
                user: config.user,
                password: config.password,
                database: config.database,
                port: config.port || 3306,
                multipleStatements: true
            });

            this.connections.set(key, connection);
            console.log(`✅ Conexión MySQL establecida: ${config.database}`);
            return connection;
        } catch (error) {
            console.error('❌ Error conectando a MySQL:', error.message);
            throw new Error(`Error de conexión MySQL: ${error.message}`);
        }
    }

    async getPostgreSQLConnection(config) {
        const key = `postgres_${config.host}_${config.database}`;

        if (this.connections.has(key)) {
            return this.connections.get(key);
        }

        try {
            const pool = new Pool({
                host: config.host || 'localhost',
                user: config.user,
                password: config.password,
                database: config.database,
                port: config.port || 5432,
                max: 10,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            });

            // Probar la conexión
            const client = await pool.connect();
            client.release();

            this.connections.set(key, pool);
            console.log(`✅ Conexión PostgreSQL establecida: ${config.database}`);
            return pool;
        } catch (error) {
            console.error('❌ Error conectando a PostgreSQL:', error.message);
            throw new Error(`Error de conexión PostgreSQL: ${error.message}`);
        }
    }

    async getConnection(type, config) {
        try {
            switch (type.toLowerCase()) {
                case 'mysql':
                    return await this.getMySQLConnection(config);
                case 'postgresql':
                case 'postgres':
                    return await this.getPostgreSQLConnection(config);
                default:
                    throw new Error(`Tipo de base de datos no soportado: ${type}`);
            }
        } catch (error) {
            console.error(`❌ Error de conexión ${type}:`, {
                host: config.host,
                database: config.database,
                error: error.message
            });
            throw error;
        }
    }

    async testConnection(type, config) {
        try {
            const connection = await this.getConnection(type, config);

            if (type.toLowerCase() === 'mysql') {
                await connection.execute('SELECT 1 as test');
            } else {
                const client = await connection.connect();
                await client.query('SELECT 1 as test');
                client.release();
            }

            return { success: true, message: 'Conexión exitosa' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async closeConnection(key) {
        if (this.connections.has(key)) {
            const connection = this.connections.get(key);

            if (connection.end) {
                await connection.end();
            } else if (connection.close) {
                await connection.close();
            }

            this.connections.delete(key);
            console.log(`🔌 Conexión cerrada: ${key}`);
        }
    }

    async closeAllConnections() {
        for (const [key, connection] of this.connections) {
            try {
                if (connection.end) {
                    await connection.end();
                } else if (connection.close) {
                    await connection.close();
                }
                console.log(`🔌 Conexión cerrada: ${key}`);
            } catch (error) {
                console.error(`❌ Error cerrando conexión ${key}:`, error.message);
            }
        }
        this.connections.clear();
    }
}

// Singleton
const databaseManager = new DatabaseManager();

// Cerrar conexiones al terminar el proceso
process.on('SIGINT', async () => {
    console.log('\n🔄 Cerrando conexiones de base de datos...');
    await databaseManager.closeAllConnections();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🔄 Cerrando conexiones de base de datos...');
    await databaseManager.closeAllConnections();
    process.exit(0);
});

module.exports = databaseManager;