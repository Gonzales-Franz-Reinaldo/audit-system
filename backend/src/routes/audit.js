const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const SecurityMiddleware = require('../middleware/securityMiddleware');

// Aplicar middleware de seguridad básica
router.use(SecurityMiddleware.basicSecurity);
router.use(SecurityMiddleware.systemActionLogger);

// TEMPORAL: Agregar logging detallado
router.use('/setup/:tableName', (req, res, next) => {
    console.log('🎯 === MIDDLEWARE AUDIT SETUP ===');
    console.log('📨 Method:', req.method);
    console.log('📨 URL:', req.url);
    console.log('📨 Params:', req.params);
    console.log('📨 Body:', {
        type: req.body?.type,
        config: !!req.body?.config,
        encryptionKey: !!req.body?.encryptionKey
    });
    console.log('🎯 === FIN MIDDLEWARE ===');
    next();
});

// Rutas para obtener información de auditoría (rate limit básico)
router.post('/tables', 
    SecurityMiddleware.createRateLimit(60000, 50), // 50 requests por minuto
    auditController.getAuditTables
);

router.post('/statistics/:auditTableName',
    SecurityMiddleware.createRateLimit(60000, 30),
    SecurityMiddleware.validateAuditParams,
    auditController.getAuditStatistics
);

// Rutas para configuración de auditoría (rate limit estricto)
router.post('/setup/:tableName',
    SecurityMiddleware.databaseConnectionRateLimit,
    SecurityMiddleware.validateAuditParams,
    SecurityMiddleware.validateEncryptionKey,
    SecurityMiddleware.dataAccessLogger('SETUP_AUDIT'),
    auditController.setupTableAudit
);

router.post('/setup-all',
    SecurityMiddleware.databaseConnectionRateLimit,
    SecurityMiddleware.validateEncryptionKey,
    SecurityMiddleware.dataAccessLogger('SETUP_ALL_AUDIT'),
    auditController.setupAllTablesAudit
);

// Rutas para visualización de datos (rate limit de encriptación)
router.post('/view-encrypted/:auditTableName',
    SecurityMiddleware.createRateLimit(60000, 20),
    SecurityMiddleware.validateAuditParams,
    SecurityMiddleware.dataAccessLogger('VIEW_ENCRYPTED'),
    auditController.viewEncryptedAuditData
);

router.post('/view-decrypted/:auditTableName',
    SecurityMiddleware.encryptionRateLimit,
    SecurityMiddleware.validateAuditParams,
    SecurityMiddleware.validateEncryptionKey,
    SecurityMiddleware.dataAccessLogger('VIEW_DECRYPTED'),
    auditController.viewDecryptedAuditData
);

// AGREGAR: Ruta para validar contraseña - FALTABA ESTA RUTA
router.post('/validate-password',
    SecurityMiddleware.encryptionRateLimit,
    SecurityMiddleware.validateEncryptionKey,
    SecurityMiddleware.dataAccessLogger('VALIDATE_PASSWORD'),
    auditController.validateEncryptionPassword
);

// Rutas para eliminación (rate limit muy estricto)
router.delete('/remove/:auditTableName',
    SecurityMiddleware.createRateLimit(60000, 5), // Solo 5 eliminaciones por minuto
    SecurityMiddleware.validateAuditParams,
    SecurityMiddleware.dataAccessLogger('REMOVE_AUDIT'),
    auditController.removeTableAudit
);

module.exports = router;