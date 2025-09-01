const express = require('express');
const router = express.Router();
const tableController = require('../controllers/tableController');

// Obtener lista de tablas
router.post('/list', tableController.getTables);

// Obtener información detallada de una tabla
router.post('/:tableName/info', tableController.getTableInfo);

// Obtener triggers de una tabla
router.post('/:tableName/triggers', tableController.getTableTriggers);

// Validar existencia de tabla
router.post('/:tableName/validate', tableController.validateTable);

module.exports = router;