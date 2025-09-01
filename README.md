# Sistema de Auditoría con Encriptación

Sistema completo de auditoría con encriptación a nivel de base de datos para MySQL y PostgreSQL.

## 🚀 Características

- ✅ **Auditoría Completa**: Seguimiento automático de operaciones INSERT, UPDATE y DELETE
- 🔒 **Encriptación a Nivel de DB**: Todos los datos de auditoría se almacenan encriptados
- 🎛️ **Interfaz Web Intuitiva**: Gestión completa desde una interfaz moderna
- 🔑 **Gestión Segura de Claves**: Solo con la clave correcta se pueden desencriptar los datos
- 📊 **Soporte Dual**: Compatible con MySQL y PostgreSQL
- ⚡ **Triggers Automáticos**: Configuración automática de triggers de base de datos
- 📈 **Reportes y Estadísticas**: Visualización completa de la actividad de auditoría

## 📁 Estructura del Proyecto

```
audit-system/
├── backend/                 # Servidor Node.js + Express
│   ├── src/
│   │   ├── config/          # Configuración de base de datos
│   │   ├── controllers/     # Controladores de API
│   │   ├── services/        # Lógica de negocio
│   │   ├── routes/          # Rutas de la API
│   │   └── utils/           # Utilidades
│   └── package.json
├── frontend/                # Aplicación React + TypeScript
│   ├── src/
│   │   ├── components/      # Componentes React
│   │   ├── services/        # Servicios de API
│   │   ├── types/           # Definiciones TypeScript
│   │   └── hooks/           # Custom hooks
│   └── package.json
└── README.md
```

## 🛠️ Instalación y Configuración

### Prerrequisitos

- Node.js 16+ 
- MySQL 5.7+ o PostgreSQL 12+
- npm o yarn

### Backend

```bash
cd backend
npm install

# Configurar variables de entorno
cp .env.example .env

# Iniciar servidor de desarrollo
npm run dev
```

### Frontend

```bash
cd frontend
npm install

# Iniciar aplicación React
npm start
```

# Sistema de Auditoría con Encriptación

Sistema completo de auditoría con encriptación a nivel de base de datos para MySQL y PostgreSQL.

## 🚀 Características

- ✅ **Auditoría Completa**: Seguimiento automático de operaciones INSERT, UPDATE y DELETE
- 🔒 **Encriptación a Nivel de DB**: Todos los datos de auditoría se almacenan encriptados
- 🎛️ **Interfaz Web Intuitiva**: Gestión completa desde una interfaz moderna
- 🔑 **Gestión Segura de Claves**: Solo con la clave correcta se pueden desencriptar los datos
- 📊 **Soporte Dual**: Compatible con MySQL y PostgreSQL
- ⚡ **Triggers Automáticos**: Configuración automática de triggers de base de datos
- 📈 **Reportes y Estadísticas**: Visualización completa de la actividad de auditoría

## 📁 Estructura del Proyecto

```
audit-system/
├── backend/                 # Servidor Node.js + Express
│   ├── src/
│   │   ├── config/          # Configuración de base de datos
│   │   ├── controllers/     # Controladores de API
│   │   ├── services/        # Lógica de negocio
│   │   ├── routes/          # Rutas de la API
│   │   └── utils/           # Utilidades
│   └── package.json
├── frontend/                # Aplicación React + TypeScript
│   ├── src/
│   │   ├── components/      # Componentes React
│   │   ├── services/        # Servicios de API
│   │   ├── types/           # Definiciones TypeScript
│   │   └── hooks/           # Custom hooks
│   └── package.json
└── README.md
```

## 🛠️ Instalación y Configuración

### Prerrequisitos

- Node.js 16+ 
- MySQL 5.7+ o PostgreSQL 12+
- npm o yarn

### Backend

```bash
cd backend
npm install

# Configurar variables de entorno (opcional)
PORT=3001
NODE_ENV=development

# Iniciar servidor de desarrollo
npm run dev

# Producción
npm start
```

### Frontend

```bash
cd frontend
npm install

# Configurar API URL (opcional)
echo "REACT_APP_API_URL=http://localhost:3001/api" > .env

# Iniciar aplicación React
npm start
```

## ⚙️ Configuración de Base de Datos

### MySQL

```sql
-- Crear base de datos de ejemplo
CREATE DATABASE audit_test;

-- Crear usuario con permisos
CREATE USER 'audit_user'@'localhost' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON audit_test.* TO 'audit_user'@'localhost';
FLUSH PRIVILEGES;

-- Tabla de ejemplo
USE audit_test;
CREATE TABLE productos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100),
    precio DECIMAL(10,2),
    descripcion TEXT,
    vendido BOOLEAN DEFAULT FALSE
);
```

### PostgreSQL

```sql
-- Crear base de datos de ejemplo
CREATE DATABASE audit_test;

-- Crear usuario con permisos
CREATE USER audit_user WITH PASSWORD 'password';
GRANT ALL PRIVILEGES ON DATABASE audit_test TO audit_user;

-- Conectar a la base de datos y crear tabla de ejemplo
\c audit_test;
CREATE TABLE productos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100),
    precio DECIMAL(10,2),
    descripcion TEXT,
    vendido BOOLEAN DEFAULT FALSE
);

-- Dar permisos al usuario
GRANT ALL PRIVILEGES ON TABLE productos TO audit_user;
GRANT ALL PRIVILEGES ON SEQUENCE productos_id_seq TO audit_user;
```

## 📋 Uso del Sistema

### 1. Conectar a Base de Datos

1. Abrir la aplicación web en `http://localhost:3000`
2. Seleccionar tipo de base de datos (MySQL/PostgreSQL)
3. Ingresar credenciales de conexión
4. Probar y conectar

### 2. Configurar Auditoría

**Para una tabla específica:**
1. Ir a la pestaña "Tablas"
2. Seleccionar tabla y hacer clic en "Configurar Auditoría"
3. Establecer clave de encriptación segura
4. Confirmar configuración

**Para todas las tablas:**
1. En la pestaña "Tablas", hacer clic en "Configurar Todo"
2. Seleccionar tablas a auditar
3. Establecer clave de encriptación única
4. Confirmar configuración masiva

### 3. Visualizar Datos de Auditoría

1. Ir a la pestaña "Auditoría"
2. Seleccionar tabla de auditoría
3. Hacer clic en "Ver Datos"
4. Los datos aparecerán encriptados por defecto
5. Ingresar clave de encriptación para desencriptar

## 🔐 Sistema de Encriptación

### Funcionamiento

- **Algoritmo**: AES-256-GCM con PBKDF2
- **Encriptación**: A nivel de base de datos, tanto columnas como datos
- **Clave**: Generada por el usuario, no almacenada en el sistema
- **Triggers**: Automáticos para INSERT, UPDATE, DELETE

### Ejemplo de Datos Encriptados

```
Tabla Original: productos
| id | nombre  | precio | descripcion    |
|----|---------|--------|----------------|
| 1  | Laptop  | 2500   | Marca HP       |
| 2  | Mouse   | 25     | Inalámbrico    |

Tabla Auditoría Encriptada: aud_productos
| enc_a1b2c3 | enc_d4e5f6        | enc_g7h8i9     | enc_j1k2l3    |
|------------|-------------------|----------------|---------------|
| 9cv8bn2m.. | kj4hg7fd9s1a2b.. | qw3er5ty8ui.. | as2df4gh...   |
```

## 🔧 API Endpoints

### Base de Datos
- `POST /api/database/test-connection` - Probar conexión
- `POST /api/database/info` - Información de BD
- `POST /api/database/stats` - Estadísticas

### Tablas
- `POST /api/tables/list` - Listar tablas
- `POST /api/tables/:table/info` - Información de tabla
- `POST /api/tables/:table/triggers` - Triggers de tabla

### Auditoría
- `POST /api/audit/tables` - Tablas de auditoría
- `POST /api/audit/setup/table` - Configurar auditoría individual
- `POST /api/audit/setup/all` - Configurar auditoría masiva
- `POST /api/audit/data/encrypted` - Datos encriptados
- `POST /api/audit/data/decrypted` - Datos desencriptados
- `POST /api/audit/validate-password` - Validar clave
- `POST /api/audit/report` - Generar reporte

## 🚦 Estados del Sistema

### Conexión a Base de Datos
- ✅ **Conectado**: Sistema operacional
- ❌ **Desconectado**: Verificar credenciales
- ⚠️ **Error**: Problema de conexión

### Estado de Auditoría por Tabla
- ✅ **Con Auditoría**: Tabla auditada y encriptada
- ❌ **Sin Auditoría**: Tabla sin configurar
- ⚙️ **Configurando**: Proceso en curso

## 📊 Funcionalidades Avanzadas

### Reportes de Auditoría
- Filtros por fecha, usuario y tipo de acción
- Estadísticas de operaciones
- Exportación de datos (cuando estén desencriptados)

### Verificación de Integridad
- Validación de datos encriptados
- Detección de corrupción
- Estadísticas de salud del sistema

### Gestión de Claves
- Generación automática de claves seguras
- Validación de fortaleza de contraseña
- Sin almacenamiento de claves (seguridad máxima)

## 🛡️ Seguridad

### Mejores Prácticas
1. **Claves Fuertes**: Mínimo 8 caracteres, combinar letras, números y símbolos
2. **Backup de Claves**: Guardar claves en lugar seguro y separado
3. **Acceso Limitado**: Solo usuarios autorizados deben tener acceso
4. **Rotación**: Cambiar claves periódicamente en producción

### Consideraciones
- Las claves no se almacenan en el sistema por seguridad
- Sin la clave correcta, los datos no se pueden recuperar
- Los triggers funcionan automáticamente una vez configurados
- La encriptación impacta el rendimiento según el volumen de datos

## 🐛 Troubleshooting

### Problemas Comunes

**Error de Conexión:**
```
Error: getaddrinfo ENOTFOUND localhost
```
- Solución: Verificar que el servidor de BD esté ejecutándose
- Verificar host, puerto y credenciales

**Error de Permisos:**
```
Error: Access denied for user
```
- Solución: Otorgar permisos CREATE TABLE, CREATE TRIGGER al usuario

**Error de Desencriptación:**
```
Error: Contraseña de desencriptación incorrecta
```
- Solución: Verificar que la clave sea exactamente la misma usada al configurar

**Triggers No Funcionan:**
- Verificar permisos de trigger en la BD
- Revisar logs del servidor para errores específicos

### Logs del Sistema
```bash
# Backend logs
cd backend
npm run dev

# Frontend logs
cd frontend
npm start
```

## 📝 Ejemplo Completo

```javascript
// 1. Conectar a MySQL
const connection = {
  type: 'mysql',
  config: {
    host: 'localhost',
    user: 'audit_user',
    password: 'password',
    database: 'audit_test',
    port: 3306
  }
};

// 2. Configurar auditoría
const auditConfig = {
  tableName: 'productos',
  encryptionKey: 'MiClaveSegura2024!'
};

// 3. Los triggers se crean automáticamente
// INSERT INTO productos VALUES ('Laptop', 2500, 'HP');
// -> Se crea registro encriptado en aud_productos

// 4. Para ver los datos de auditoría
// Usar la interfaz web con la clave 'MiClaveSegura2024!'
```

## 🤝 Contribución

1. Fork del repositorio
2. Crear rama feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Crear Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para detalles.

## 🆘 Soporte

Para soporte técnico o preguntas:
- Crear issue en GitHub
- Revisar documentación de troubleshooting
- Verificar logs del sistema

---

**Desarrollado con ❤️ usando Node.js, Express, React y TypeScript**