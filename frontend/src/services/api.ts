import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import {
    DatabaseType,
    DatabaseConfig,
    ConnectionInfo,
    TableInfo,
    AuditTable,
    AuditData,
    AuditStatistics,
    AuditSetupResult,
    BatchAuditSetupResult,
    PasswordValidation,
    IntegrityCheck,
    AuditSummary,
    ReportFilters,
    AuditReport,
    ApiResponse
} from '../types';

class ApiService {
    private baseURL: string;
    private axiosInstance: AxiosInstance;

    constructor() {
        // CORREGIR: Inicialización más robusta
        this.baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
        
        console.log('🔧 Inicializando ApiService con baseURL:', this.baseURL);

        try {
            this.axiosInstance = axios.create({
                baseURL: this.baseURL,
                timeout: 30000, // 30 segundos
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            console.log('✅ AxiosInstance creado correctamente');

            // Interceptor para manejar errores
            this.axiosInstance.interceptors.response.use(
                (response: AxiosResponse) => {
                    console.log('📨 Respuesta exitosa:', response.status, response.config.url);
                    return response;
                },
                (error: AxiosError) => {
                    console.error('❌ Error en petición:', error.response?.status, error.config?.url, error.message);
                    return Promise.reject(error);
                }
            );

            // Interceptor para requests
            this.axiosInstance.interceptors.request.use(
                (config) => {
                    console.log('🚀 Enviando petición:', config.method?.toUpperCase(), config.url);
                    return config;
                },
                (error) => {
                    console.error('❌ Error en configuración de petición:', error);
                    return Promise.reject(error);
                }
            );

        } catch (error) {
            console.error('💥 Error creando AxiosInstance:', error);
            throw new Error('Error inicializando servicio API');
        }
    }

    // Helper para verificar que la instancia está inicializada
    private ensureInitialized(): void {
        if (!this.axiosInstance) {
            console.error('💥 AxiosInstance no está inicializado');
            throw new Error('Servicio API no inicializado correctamente');
        }
    }

    // Helper para manejar respuestas - CORREGIDO
    private handleResponse<T>(response: AxiosResponse<ApiResponse<T> | any>): T {
        // Verificar si la respuesta tiene la estructura ApiResponse
        if (response.data && typeof response.data === 'object') {
            if ('success' in response.data) {
                if (response.data.success) {
                    return response.data.data as T || response.data as T;
                } else {
                    throw new Error(response.data.error || response.data.message || 'Error en la respuesta');
                }
            } else {
                // Si no tiene la estructura ApiResponse, devolver directamente los datos
                return response.data as T;
            }
        }
        
        throw new Error('Respuesta del servidor inválida');
    }

    // Helper para manejar errores - CORREGIDO
    private handleError(error: AxiosError): never {
        console.error('🔍 Manejando error:', error);
        
        if (error.response?.data) {
            const apiError = error.response.data as any;
            const errorMessage = apiError.error || apiError.message || 'Error de API';
            console.error('📋 Error del servidor:', errorMessage);
            throw new Error(errorMessage);
        }
        
        if (error.request) {
            console.error('📋 Error de red - no hay respuesta del servidor');
            throw new Error('Error de conexión - no se pudo contactar el servidor');
        }
        
        console.error('📋 Error de configuración:', error.message);
        throw new Error(error.message || 'Error de conexión');
    }

    // === MÉTODOS DE BASE DE DATOS ===

    // Probar conexión a base de datos - CORREGIDO
    async testConnection(type: DatabaseType, config: DatabaseConfig): Promise<any> {
        try {
            this.ensureInitialized();
            
            console.log(`🔍 Enviando petición de prueba: ${type}`, {
                host: config.host,
                database: config.database,
                user: config.user
            });

            const response = await this.axiosInstance.post('/database/test-connection', {
                type,
                config
            });

            console.log('✅ Respuesta recibida:', response.data);
            return response.data; // Retornar la respuesta completa
        } catch (error) {
            console.error('❌ Error en testConnection:', error);
            return this.handleError(error as AxiosError);
        }
    }

    // Obtener información de la base de datos
    async getDatabaseInfo(type: DatabaseType, config: DatabaseConfig): Promise<any> {
        try {
            this.ensureInitialized();
            const response = await this.axiosInstance.post('/database/info', {
                type,
                config
            });
            return this.handleResponse(response);
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }

    // === MÉTODOS DE TABLAS ===

    // Obtener lista de tablas
    async getTables(type: DatabaseType, config: DatabaseConfig): Promise<{
        data: TableInfo[];
        totalTables: number;
        tablesWithAudit: number;
    }> {
        try {
            this.ensureInitialized();
            const response = await this.axiosInstance.post('/tables/list', {
                type,
                config
            });
            return response.data; // El backend ya devuelve el formato correcto
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }

    // === MÉTODOS DE AUDITORÍA ===

    // Obtener lista de tablas de auditoría
    async getAuditTables(type: DatabaseType, config: DatabaseConfig): Promise<{
        auditTables: AuditTable[];
        total?: number;
    }> {
        try {
            this.ensureInitialized();
            const response = await this.axiosInstance.post('/audit/tables', {
                type,
                config
            });
            return response.data; // El backend ya devuelve el formato correcto
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }

    // Configurar auditoría para una tabla - COMPLETAMENTE CORREGIDO
    async setupTableAudit(
        type: DatabaseType,
        config: DatabaseConfig,
        tableName: string,
        encryptionKey: string
    ): Promise<AuditSetupResult> {
        try {
            // VERIFICAR que la instancia esté inicializada
            this.ensureInitialized();
            
            console.log(`🔧 Configurando auditoría API para: ${tableName}`);
            console.log(`📊 Datos a enviar:`, { 
                type, 
                config: { 
                    host: config.host, 
                    database: config.database,
                    user: config.user 
                }, 
                encryptionKey: `${encryptionKey.length} caracteres` 
            });

            // Validar en el frontend antes de enviar
            if (encryptionKey.length < 12) {
                throw new Error('La clave de encriptación debe tener al menos 12 caracteres');
            }

            // VERIFICAR que axiosInstance existe antes de usarlo
            if (!this.axiosInstance) {
                throw new Error('AxiosInstance no está disponible');
            }

            const response = await this.axiosInstance.post(`/audit/setup/${tableName}`, {
                type,
                config,
                encryptionKey
            });

            console.log(`✅ Respuesta de configuración:`, response.data);
            
            // Verificar que la respuesta tenga el formato esperado
            if (!response.data) {
                throw new Error('Respuesta vacía del servidor');
            }

            return response.data;
            
        } catch (error) {
            console.error(`❌ Error en setupTableAudit API:`, error);
            
            const axiosError = error as AxiosError;
            if (axiosError.response?.data) {
                const apiError = axiosError.response.data as any;
                
                // Manejar errores específicos
                if (apiError.error) {
                    if (apiError.error.includes('12 caracteres')) {
                        throw new Error('La clave debe tener al menos 12 caracteres. Usa el generador automático si necesitas ayuda.');
                    }
                    if (apiError.error.includes('complejidad')) {
                        throw new Error('La clave debe contener mayúsculas, minúsculas, números y símbolos especiales.');
                    }
                    throw new Error(apiError.error);
                }
                
                throw new Error(apiError.message || 'Error configurando auditoría');
            }
            
            throw new Error(axiosError.message || 'Error de conexión al configurar auditoría');
        }
    }
    // Configurar auditoría para todas las tablas
    async setupAllTablesAudit(
        type: DatabaseType,
        config: DatabaseConfig,
        tables: string[],
        encryptionKey: string
    ): Promise<BatchAuditSetupResult> {
        try {
            this.ensureInitialized();
            const response = await this.axiosInstance.post('/audit/setup-all', {
                type,
                config,
                tables,
                encryptionKey,
            });
            return response.data;
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }

    // Obtener datos de auditoría encriptados
    async getEncryptedAuditData(
        type: DatabaseType,
        config: DatabaseConfig,
        auditTableName: string,
        limit: number = 100,
        offset: number = 0
    ): Promise<AuditData> {
        try {
            this.ensureInitialized();
            
            console.log(`🔍 Obteniendo datos encriptados de: ${auditTableName}`);
            
            const response = await this.axiosInstance.post(`/audit/view-encrypted/${auditTableName}`, {
                type,
                config,
                limit,
                offset
            });

            console.log('✅ Datos encriptados obtenidos:', response.data);
            return response.data; // Retornar directamente los datos del backend
            
        } catch (error) {
            console.error(`❌ Error obteniendo datos encriptados:`, error);
            
            const axiosError = error as AxiosError;
            if (axiosError.response?.data) {
                const apiError = axiosError.response.data as any;
                throw new Error(apiError.error || apiError.message || 'Error obteniendo datos encriptados');
            }
            
            throw new Error(axiosError.message || 'Error de conexión al obtener datos encriptados');
        }
    }



    // Obtener datos de auditoría desencriptados
    async getDecryptedAuditData(
        type: DatabaseType,
        config: DatabaseConfig,
        auditTableName: string,
        encryptionKey: string,
        limit: number = 100,
        offset: number = 0
    ): Promise<AuditData> {
        try {
            this.ensureInitialized();
            
            console.log(`🔓 Desencriptando datos de: ${auditTableName}`);
            
            const response = await this.axiosInstance.post(`/audit/view-decrypted/${auditTableName}`, {
                type,
                config,
                encryptionKey,
                limit,
                offset
            });

            console.log('✅ Datos desencriptados obtenidos:', response.data);
            return response.data; // Retornar directamente los datos del backend
            
        } catch (error) {
            console.error(`❌ Error desencriptando datos:`, error);
            
            const axiosError = error as AxiosError;
            if (axiosError.response?.data) {
                const apiError = axiosError.response.data as any;
                throw new Error(apiError.error || apiError.message || 'Error desencriptando datos');
            }
            
            throw new Error(axiosError.message || 'Error de conexión al desencriptar datos');
        }
    }

    // Validar contraseña de encriptación
    async validateEncryptionPassword(
        type: DatabaseType,
        config: DatabaseConfig,
        auditTableName: string,
        encryptionKey: string
    ): Promise<PasswordValidation> {
        try {
            this.ensureInitialized();
            const response = await this.axiosInstance.post('/audit/validate-password', {
                type,
                config,
                auditTableName,
                encryptionKey,
            });
            return this.handleResponse(response);
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }

    // Obtener estadísticas de auditoría
    async getAuditStatistics(
        type: DatabaseType,
        config: DatabaseConfig,
        auditTableName: string
    ): Promise<AuditStatistics> {
        try {
            this.ensureInitialized();
            const response = await this.axiosInstance.post(`/audit/statistics/${auditTableName}`, {
                type,
                config
            });
            return this.handleResponse(response);
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }

    // Eliminar auditoría de una tabla
    async removeTableAudit(
        type: DatabaseType,
        config: DatabaseConfig,
        auditTableName: string
    ): Promise<{ message: string }> {
        try {
            this.ensureInitialized();
            const response = await this.axiosInstance.delete(`/audit/remove/${auditTableName}`, {
                data: {
                    type,
                    config
                }
            });
            return this.handleResponse(response);
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }

    // === MÉTODOS DE UTILIDAD ===

    // Verificar estado de salud de la API
    async checkHealth(): Promise<{ status: string; message: string; timestamp: string }> {
        try {
            this.ensureInitialized();
            const response = await this.axiosInstance.get('/health');
            return response.data;
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }

    // Obtener configuración del cliente
    getConfig() {
        return {
            baseURL: this.baseURL,
            timeout: 30000,
            initialized: !!this.axiosInstance
        };
    }

    // Método para verificar el estado del servicio
    isInitialized(): boolean {
        return !!this.axiosInstance;
    }

    // Método para reinicializar el servicio si es necesario
    reinitialize(): void {
        console.log('🔄 Reinicializando ApiService...');
        try {
            this.axiosInstance = axios.create({
                baseURL: this.baseURL,
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            console.log('✅ ApiService reinicializado correctamente');
        } catch (error) {
            console.error('💥 Error reinicializando ApiService:', error);
            throw new Error('Error reinicializando servicio API');
        }
    }
}

// CORREGIR: Crear y exportar la instancia con verificación
let apiServiceInstance: ApiService;

try {
    apiServiceInstance = new ApiService();
    console.log('✅ Instancia de ApiService creada correctamente');
} catch (error) {
    console.error('💥 Error creando instancia de ApiService:', error);
    // Crear una instancia de respaldo
    apiServiceInstance = new ApiService();
}

// Verificar que la instancia sea válida antes de exportar
if (!apiServiceInstance) {
    console.error('💥 No se pudo crear la instancia de ApiService');
    throw new Error('Error crítico: No se pudo inicializar el servicio API');
}

export default apiServiceInstance;