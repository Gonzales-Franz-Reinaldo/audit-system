const fs = require('fs').promises;
const path = require('path');

class SystemAuditService {
    constructor() {
        this.logDir = path.join(__dirname, '../../logs');
        this.maxLogSize = 10 * 1024 * 1024; // 10MB
        this.maxLogFiles = 10;
        this.ensureLogDirectory();
    }

    async ensureLogDirectory() {
        try {
            await fs.mkdir(this.logDir, { recursive: true });
        } catch (error) {
            console.error('Error creando directorio de logs:', error);
        }
    }

    // Log de acciones del sistema
    async logSystemAction(action, user, details = {}, level = 'info') {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level.toUpperCase(),
            action,
            user: user || 'SYSTEM',
            details: {
                ...details,
                sessionId: details.sessionId || 'unknown',
                ip: details.ip || 'unknown',
                userAgent: details.userAgent || 'unknown'
            },
            traceId: this.generateTraceId()
        };

        // Log a consola con formato
        console.log(`[${logEntry.level}] ${logEntry.timestamp} - ${action} by ${logEntry.user}`);
        
        // Guardar en archivo
        await this.writeToLogFile('system.log', logEntry);

        return logEntry.traceId;
    }

    // Log de acceso a datos encriptados
    async logDataAccess(action, tableName, user, encryptionUsed, details = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'DATA_ACCESS',
            action,
            tableName,
            user: user || 'unknown',
            encryptionUsed,
            recordCount: details.recordCount || 0,
            success: details.success !== false,
            error: details.error || null,
            ip: details.ip || 'unknown',
            duration: details.duration || 0,
            traceId: this.generateTraceId()
        };

        console.log(`[DATA] ${logEntry.timestamp} - ${action} on ${tableName} by ${user}`);
        
        await this.writeToLogFile('data-access.log', logEntry);
        
        return logEntry.traceId;
    }

    // Log de configuración de auditoría
    async logAuditConfig(action, tableName, user, details = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'AUDIT_CONFIG',
            action,
            tableName,
            user: user || 'system',
            success: details.success !== false,
            error: details.error || null,
            encryptionKeyUsed: !!details.encryptionKey,
            triggersCreated: details.triggersCreated || false,
            traceId: this.generateTraceId()
        };

        console.log(`[AUDIT] ${logEntry.timestamp} - ${action} for ${tableName} by ${user}`);
        
        await this.writeToLogFile('audit-config.log', logEntry);
        
        return logEntry.traceId;
    }

    // Log de errores de seguridad
    async logSecurityEvent(event, user, details = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'SECURITY',
            event,
            user: user || 'unknown',
            severity: details.severity || 'medium',
            ip: details.ip || 'unknown',
            userAgent: details.userAgent || 'unknown',
            details: {
                ...details,
                blocked: details.blocked || false,
                attempts: details.attempts || 1
            },
            traceId: this.generateTraceId()
        };

        console.warn(`[SECURITY] ${logEntry.timestamp} - ${event} by ${user}`);
        
        await this.writeToLogFile('security.log', logEntry);
        
        // Si es crítico, también enviar alerta
        if (details.severity === 'critical') {
            await this.sendSecurityAlert(logEntry);
        }

        return logEntry.traceId;
    }

    // Log de rendimiento
    async logPerformance(operation, duration, details = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'PERFORMANCE',
            operation,
            duration: Math.round(duration),
            recordsProcessed: details.recordsProcessed || 0,
            memoryUsage: process.memoryUsage(),
            dbConnection: details.dbType || 'unknown',
            tableName: details.tableName || null,
            traceId: this.generateTraceId()
        };

        // Solo log si excede umbral
        if (duration > 1000) { // Más de 1 segundo
            console.log(`[PERF] ${logEntry.timestamp} - ${operation} took ${duration}ms`);
            await this.writeToLogFile('performance.log', logEntry);
        }

        return logEntry.traceId;
    }

    // Escribir a archivo de log con rotación
    async writeToLogFile(filename, logEntry) {
        try {
            const logFile = path.join(this.logDir, filename);
            const logLine = JSON.stringify(logEntry) + '\n';

            // Verificar tamaño del archivo
            try {
                const stats = await fs.stat(logFile);
                if (stats.size > this.maxLogSize) {
                    await this.rotateLogFile(logFile);
                }
            } catch (error) {
                // Archivo no existe, continuar
            }

            await fs.appendFile(logFile, logLine);
        } catch (error) {
            console.error('Error escribiendo log:', error);
        }
    }

    // Rotar archivos de log
    async rotateLogFile(logFile) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const rotatedFile = `${logFile}.${timestamp}`;
            
            await fs.rename(logFile, rotatedFile);
            
            // Limpiar archivos antiguos
            await this.cleanOldLogFiles(path.dirname(logFile), path.basename(logFile));
        } catch (error) {
            console.error('Error rotando log:', error);
        }
    }

    // Limpiar archivos de log antiguos
    async cleanOldLogFiles(logDir, baseFileName) {
        try {
            const files = await fs.readdir(logDir);
            const logFiles = files
                .filter(file => file.startsWith(baseFileName + '.'))
                .map(file => ({
                    name: file,
                    path: path.join(logDir, file)
                }));

            if (logFiles.length > this.maxLogFiles) {
                // Ordenar por fecha de modificación (más antiguos primero)
                const filesWithStats = await Promise.all(
                    logFiles.map(async file => ({
                        ...file,
                        stats: await fs.stat(file.path)
                    }))
                );

                filesWithStats
                    .sort((a, b) => a.stats.mtime - b.stats.mtime)
                    .slice(0, filesWithStats.length - this.maxLogFiles)
                    .forEach(async file => {
                        try {
                            await fs.unlink(file.path);
                            console.log(`Log file deleted: ${file.name}`);
                        } catch (error) {
                            console.error(`Error deleting log file ${file.name}:`, error);
                        }
                    });
            }
        } catch (error) {
            console.error('Error cleaning old log files:', error);
        }
    }

    // Generar ID único para trazabilidad
    generateTraceId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // Enviar alerta de seguridad (placeholder para integración futura)
    async sendSecurityAlert(logEntry) {
        // Aquí se puede integrar con servicios de notificación
        console.error(`🚨 SECURITY ALERT: ${logEntry.event} by ${logEntry.user}`);
        
        // Guardar en archivo especial de alertas
        await this.writeToLogFile('security-alerts.log', logEntry);
    }

    // Obtener logs recientes
    async getRecentLogs(filename, lines = 100) {
        try {
            const logFile = path.join(this.logDir, filename);
            const data = await fs.readFile(logFile, 'utf8');
            
            return data
                .trim()
                .split('\n')
                .slice(-lines)
                .map(line => {
                    try {
                        return JSON.parse(line);
                    } catch {
                        return { raw: line };
                    }
                });
        } catch (error) {
            console.error('Error reading logs:', error);
            return [];
        }
    }

    // Buscar logs por criterios
    async searchLogs(filename, criteria = {}) {
        try {
            const logs = await this.getRecentLogs(filename, 1000);
            
            return logs.filter(log => {
                if (criteria.user && log.user !== criteria.user) return false;
                if (criteria.action && log.action !== criteria.action) return false;
                if (criteria.level && log.level !== criteria.level) return false;
                if (criteria.dateFrom && new Date(log.timestamp) < new Date(criteria.dateFrom)) return false;
                if (criteria.dateTo && new Date(log.timestamp) > new Date(criteria.dateTo)) return false;
                
                return true;
            });
        } catch (error) {
            console.error('Error searching logs:', error);
            return [];
        }
    }

    // Obtener estadísticas de logs
    async getLogStatistics() {
        try {
            const files = await fs.readdir(this.logDir);
            const stats = {};

            for (const file of files) {
                if (file.endsWith('.log')) {
                    const filePath = path.join(this.logDir, file);
                    const fileStats = await fs.stat(filePath);
                    
                    stats[file] = {
                        size: fileStats.size,
                        modified: fileStats.mtime,
                        lines: await this.countLines(filePath)
                    };
                }
            }

            return stats;
        } catch (error) {
            console.error('Error getting log statistics:', error);
            return {};
        }
    }

    // Contar líneas en archivo
    async countLines(filePath) {
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return data.split('\n').length - 1;
        } catch (error) {
            return 0;
        }
    }
}

module.exports = new SystemAuditService();