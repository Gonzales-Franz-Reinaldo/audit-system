const express = require('express');
const cors = require('cors');

// Importar rutas
const databaseRoutes = require('./routes/database');
const tableRoutes = require('./routes/tables');
const auditRoutes = require('./routes/audit');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Rutas
app.use('/api/database', databaseRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/audit', auditRoutes);

// Ruta de salud
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Sistema de Auditoría funcionando correctamente',
        timestamp: new Date().toISOString()
    });
});

// Manejo de errores
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Error interno del servidor',
        message: err.message,
        timestamp: new Date().toISOString()
    });
});

// Ruta no encontrada
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        path: req.originalUrl,
        timestamp: new Date().toISOString()
    });
});

module.exports = app;