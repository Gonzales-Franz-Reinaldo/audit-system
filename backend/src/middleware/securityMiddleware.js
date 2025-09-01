const systemAuditService = require('../services/systemAuditService');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

class SecurityMiddleware {
    // Rate limiting para endpoints sensibles
    static createRateLimit(windowMs = 15 * 60 * 1000, max = 100, message = 'Too many requests') {
        return rateLimit({
            windowMs,
            max,
            message: { error: message },
            standardHeaders: true,
            legacyHeaders: false,
            handler: async (req, res, next) => {
                await systemAuditService.logSecurityEvent(
                    'RATE_LIMIT_EXCEEDED',
                    req.ip,
                    {
                        ip: req.ip,
                        userAgent: req.get('User-Agent'),
                        endpoint: req.path,
                        method: req.method,
                        severity: 'medium'
                    }
                );
                res.status(429).json({ error: message });
            }
        });
    }

    // Rate limiting específico para endpoints de encriptación
    static encryptionRateLimit = SecurityMiddleware.createRateLimit(
        5 * 60 * 1000, // 5 minutos
        10, // máximo 10 intentos
        'Demasiados intentos de desencriptación. Intente más tarde.'
    );

    // Rate limiting para conexiones de base de datos
    static databaseConnectionRateLimit = SecurityMiddleware.createRateLimit(
        10 * 60 * 1000, // 10 minutos
        5, // máximo 5 conexiones
        'Demasiados intentos de conexión a base de datos.'
    );

    // Middleware para logging de acciones del sistema
    static systemActionLogger = async (req, res, next) => {
        const startTime = Date.now();

        // Interceptar el método res.json para loguear respuestas
        const originalJson = res.json;
        res.json = function (body) {
            const duration = Date.now() - startTime;

            // Log de la acción del sistema
            systemAuditService.logSystemAction(
                `${req.method} ${req.path}`,
                req.ip,
                {
                    ip: req.ip,
                    userAgent: req.get('User-Agent'),
                    method: req.method,
                    path: req.path,
                    statusCode: res.statusCode,
                    duration,
                    requestSize: req.get('Content-Length') || 0,
                    responseSize: JSON.stringify(body).length,
                    success: res.statusCode < 400
                },
                res.statusCode >= 400 ? 'error' : 'info'
            );

            // Log de rendimiento si es lento
            if (duration > 1000) {
                systemAuditService.logPerformance(
                    `${req.method} ${req.path}`,
                    duration,
                    {
                        method: req.method,
                        path: req.path,
                        statusCode: res.statusCode
                    }
                );
            }

            return originalJson.call(this, body);
        };

        next();
    };

    // Middleware para validación de claves de encriptación
    static validateEncryptionKey = async (req, res, next) => {
        try {
            const { encryptionKey } = req.body;

            if (!encryptionKey) {
                await systemAuditService.logSecurityEvent(
                    'MISSING_ENCRYPTION_KEY',
                    req.ip,
                    {
                        ip: req.ip,
                        userAgent: req.get('User-Agent'),
                        endpoint: req.path,
                        severity: 'medium'
                    }
                );
                return res.status(400).json({
                    success: false,
                    error: 'Clave de encriptación requerida'
                });
            }

            // Validar la clave usando el servicio de encriptación
            const encryptionService = require('../services/encryptionService');

            try {
                encryptionService.validateEncryptionKey(encryptionKey);
                next();
            } catch (validationError) {
                await systemAuditService.logSecurityEvent(
                    'INVALID_ENCRYPTION_KEY',
                    req.ip,
                    {
                        ip: req.ip,
                        userAgent: req.get('User-Agent'),
                        endpoint: req.path,
                        error: validationError.message,
                        severity: 'high'
                    }
                );

                return res.status(400).json({
                    success: false,
                    error: validationError.message
                });
            }
        } catch (error) {
            await systemAuditService.logSystemAction(
                'ENCRYPTION_VALIDATION_ERROR',
                req.ip,
                {
                    error: error.message,
                    ip: req.ip,
                    userAgent: req.get('User-Agent')
                },
                'error'
            );

            return res.status(500).json({
                success: false,
                error: 'Error validando clave de encriptación'
            });
        }
    };

    // Middleware de seguridad básica con Helmet
    static basicSecurity = [
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'"],
                    fontSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'self'"],
                    frameSrc: ["'none'"],
                }
            },
            crossOriginEmbedderPolicy: false
        })
    ];

    // Middleware para logging de acceso a datos encriptados
    static dataAccessLogger = (operation) => {
        return async (req, res, next) => {
            const originalJson = res.json;

            res.json = function (body) {
                const { tableName } = req.params || {};
                const { encryptionKey } = req.body || {};

                systemAuditService.logDataAccess(
                    operation,
                    tableName || 'unknown',
                    req.ip,
                    !!encryptionKey,
                    {
                        ip: req.ip,
                        userAgent: req.get('User-Agent'),
                        success: res.statusCode < 400,
                        recordCount: body.data ? (Array.isArray(body.data) ? body.data.length : 1) : 0,
                        error: res.statusCode >= 400 ? body.error : null
                    }
                );

                return originalJson.call(this, body);
            };

            next();
        };
    };


    // Middleware para validación de parámetros de auditoría - CORREGIDO
    static validateAuditParams = async (req, res, next) => {
        try {
            console.log('🔍 Validando parámetros de auditoría...');
            console.log('📨 Parámetros recibidos:', {
                params: req.params,
                body: {
                    type: req.body.type,
                    config: !!req.body.config,
                    encryptionKey: !!req.body.encryptionKey
                }
            });

            // CORREGIR: Obtener tableName de params Y permitir nombres de auditoría
            const { tableName, auditTableName } = req.params;
            const { type, config } = req.body;

            // Obtener el nombre de tabla correcto (puede venir en params como tableName o auditTableName)
            const tableNameToValidate = tableName || auditTableName;

            console.log('🔍 Validando tabla:', tableNameToValidate);

            // CORREGIR: Validar nombre de tabla - permitir prefijo aud_
            if (!tableNameToValidate) {
                console.error('❌ Nombre de tabla faltante');
                return res.status(400).json({
                    success: false,
                    error: 'Nombre de tabla requerido'
                });
            }

            // CORREGIR: Regex más permisiva que permite aud_ prefix
            if (!/^(aud_)?[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableNameToValidate)) {
                console.error('❌ Nombre de tabla inválido:', tableNameToValidate);

                await systemAuditService.logSecurityEvent(
                    'INVALID_TABLE_NAME',
                    req.ip,
                    {
                        tableName: tableNameToValidate,
                        ip: req.ip,
                        userAgent: req.get('User-Agent'),
                        severity: 'low'
                    }
                );

                return res.status(400).json({
                    success: false,
                    error: 'Nombre de tabla inválido'
                });
            }

            // Validar tipo de base de datos
            if (!type || !['mysql', 'postgresql'].includes(type.toLowerCase())) {
                console.error('❌ Tipo de DB inválido:', type);
                return res.status(400).json({
                    success: false,
                    error: 'Tipo de base de datos inválido'
                });
            }

            // Validar configuración de conexión
            if (!config || !config.host || !config.database) {
                console.error('❌ Configuración inválida:', !!config);
                return res.status(400).json({
                    success: false,
                    error: 'Configuración de conexión incompleta'
                });
            }

            console.log('✅ Validación de parámetros exitosa');
            next();
        } catch (error) {
            console.error('💥 Error en validateAuditParams:', error);
            await systemAuditService.logSystemAction(
                'AUDIT_PARAMS_VALIDATION_ERROR',
                req.ip,
                { error: error.message },
                'error'
            );

            return res.status(500).json({
                success: false,
                error: 'Error validando parámetros'
            });
        }
    };
}

module.exports = SecurityMiddleware;