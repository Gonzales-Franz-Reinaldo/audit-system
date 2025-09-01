const express = require('express');
const router = express.Router();
const databaseController = require('../controllers/databaseController');

// Probar conexión a base de datos
router.post('/test-connection', databaseController.testConnection);

// Obtener información de la base de datos
router.post('/info', databaseController.getDatabaseInfo);

// Obtener esquemas (solo PostgreSQL)
router.post('/schemas', databaseController.getSchemas);

// Obtener estadísticas de la base de datos
router.post('/stats', databaseController.getDatabaseStats);

// Validar configuración
router.post('/validate-config', databaseController.validateConfig);

// Cerrar conexión específica
router.post('/close-connection', databaseController.closeConnection);

module.exports = router;