require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`🚀 Servidor backend corriendo en puerto ${PORT}`);
    console.log(`📊 Sistema de Auditoría con Encriptación iniciado`);
    console.log(`🔗 URL de la aplicación: http://localhost:${PORT}`);
});