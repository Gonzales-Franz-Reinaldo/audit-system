import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import {
    DatabaseType,
    DatabaseConfig,
    TableInfo,
    AuditTable,
    AuditSetupResult,
    BatchAuditSetupResult,
    AuditData,
    PasswordValidation,
    AuditStatistics,
    ApiResponse
} from '../types';

class ApiService {
    private baseURL: string;
    private axiosInstance: AxiosInstance | null = null;
    private initialized: boolean = false;

    constructor() {
        // CORREGIR: Inicialización más robusta
        this.baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

        console.log('🔧 Inicializando ApiService con baseURL:', this.baseURL);

        try {
            this.initializeAxios();
            this.initialized = true;
            console.log('✅ ApiService inicializado correctamente');
        } catch (error) {
            console.error('💥 Error inicializando ApiService:', error);
            this.initialized = false;
        }
    }

    private initializeAxios(): void {
        this.axiosInstance = axios.create({
            baseURL: this.baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        console.log('✅ AxiosInstance creado correctamente');

        // Interceptor para manejar errores
        this.axiosInstance.interceptors.response.use(
            (response: AxiosResponse) => {
                console.log('📨 Respuesta exitosa:', response.data);
                return response;
            },
            (error: AxiosError) => {
                console.error('📨 Error en respuesta:', error);
                return Promise.reject(error);
            }
        );

        // Interceptor para requests
        this.axiosInstance.interceptors.request.use(
            (config) => {
                console.log('📤 Enviando petición:', config.method?.toUpperCase(), config.url);
                return config;
            },
            (error) => {
                console.error('📤 Error en petición:', error);
                return Promise.reject(error);
            }
        );
    }

    // Helper para verificar que la instancia está inicializada
    private ensureInitialized(): void {
        if (!this.initialized || !this.axiosInstance) {
            console.error('💥 AxiosInstance no está inicializado');
            console.log('🔄 Intentando reinicializar...');
            try {
                this.initializeAxios();
                this.initialized = true;
            } catch (error) {
                throw new Error('Servicio API no inicializado correctamente');
            }
        }
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

    // Probar conexión a base de datos
    async testConnection(type: DatabaseType, config: DatabaseConfig): Promise<any> {
        try {
            this.ensureInitialized();

            console.log(`🔍 Enviando petición de prueba: ${type}`, {
                host: config.host,
                database: config.database,
                user: config.user
            });

            const response = await this.axiosInstance!.post('/database/test-connection', {
                type,
                config
            });

            console.log('✅ Respuesta recibida:', response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Error en testConnection:', error);
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
            const response = await this.axiosInstance!.post('/tables/list', {
                type,
                config
            });
            return response.data;
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

            console.log('🔍 Obteniendo tablas de auditoría...');

            const response = await this.axiosInstance!.post('/audit/tables', {
                type,
                config
            });

            console.log('📨 Respuesta bruta del backend:', response.data);

            // CORREGIR: Manejar diferentes estructuras de respuesta
            if (response.data && response.data.success) {
                const data = response.data.data;

                // Verificar si data tiene auditTables
                if (data && data.auditTables) {
                    console.log('✅ Estructura correcta con auditTables:', data.auditTables);
                    return {
                        auditTables: data.auditTables,
                        total: data.total || data.auditTables.length
                    };
                }

                // Fallback: si data es directamente el array
                if (Array.isArray(data)) {
                    console.log('✅ Data es array directo:', data);
                    return {
                        auditTables: data,
                        total: data.length
                    };
                }

                // Fallback: si no hay estructura esperada
                console.warn('⚠️ Estructura de respuesta inesperada:', data);
                return {
                    auditTables: [],
                    total: 0
                };
            }

            console.error('❌ Respuesta sin success:', response.data);
            return {
                auditTables: [],
                total: 0
            };
        } catch (error) {
            console.error('❌ Error en getAuditTables:', error);
            return this.handleError(error as AxiosError);
        }
    }



    // Obtener tablas de auditoría encriptadas sin clave
    async getEncryptedAuditTables(
        type: DatabaseType,
        config: DatabaseConfig
    ): Promise<{
        success: boolean;
        data: {
            auditTables: Array<{
                tableName: string;
                originalTable: string;
                hasEncryption: boolean;
                recordCount: number;
                isEncryptedTable: boolean;
            }>;
            total: number;
        };
    }> {
        try {
            this.ensureInitialized();

            // AGREGAR verificación explícita de axiosInstance
            if (!this.axiosInstance) {
                throw new Error('AxiosInstance no está inicializado');
            }

            const response = await this.axiosInstance.post('/audit/encrypted-tables', {
                type,
                config
            });

            return response.data;
        } catch (error) {
            console.error('❌ Error obteniendo tablas encriptadas:', error);
            return this.handleError(error as AxiosError);
        }
    }

    // Obtener tablas de auditoría desencriptadas con clave
    async getDecryptedAuditTables(
        type: DatabaseType,
        config: DatabaseConfig,
        encryptionKey: string
    ): Promise<{
        success: boolean;
        data: {
            auditTables: Array<{
                tableName: string;
                originalTable: string;
                displayName: string;
                hasEncryption: boolean;
                recordCount: number;
                isEncryptedTable: boolean;
                isDecrypted: boolean;
            }>;
            total: number;
        };
    }> {
        try {
            this.ensureInitialized();

            // AGREGAR verificación explícita
            if (!this.axiosInstance) {
                throw new Error('AxiosInstance no está inicializado');
            }

            const response = await this.axiosInstance.post('/audit/decrypted-tables', {
                type,
                config,
                encryptionKey
            });

            return response.data;
        } catch (error) {
            console.error('❌ Error obteniendo tablas desencriptadas:', error);
            return this.handleError(error as AxiosError);
        }
    }


    // Configurar auditoría para una tabla
    async setupTableAudit(
        type: DatabaseType,
        config: DatabaseConfig,
        tableName: string,
        encryptionKey: string
    ): Promise<AuditSetupResult> {
        try {
            this.ensureInitialized();

            console.log(`🔧 Configurando auditoría API para: ${tableName}`);

            if (encryptionKey.length < 12) {
                throw new Error('La clave de encriptación debe tener al menos 12 caracteres');
            }

            if (!this.axiosInstance) {
                throw new Error('Servicio API no disponible');
            }

            const response = await this.axiosInstance.post(`/audit/setup/${tableName}`, {
                type,
                config,
                encryptionKey
            });

            console.log(`✅ Respuesta de configuración:`, response.data);

            if (!response.data) {
                throw new Error('Respuesta vacía del servidor');
            }

            return response.data;

        } catch (error) {
            console.error(`❌ Error en setupTableAudit API:`, error);

            const axiosError = error as AxiosError;
            if (axiosError.response?.data) {
                const errorData = axiosError.response.data as any;
                throw new Error(errorData.error || errorData.message || 'Error del servidor');
            }

            throw new Error(axiosError.message || 'Error de conexión al configurar auditoría');
        }
    }

    // Obtener datos de auditoría encriptados - CORREGIDO COMPLETAMENTE
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

            if (!this.axiosInstance) {
                throw new Error('Servicio API no está disponible');
            }

            const response = await this.axiosInstance.post(`/audit/view-encrypted/${auditTableName}`, {
                type,
                config,
                limit,
                offset
            });

            console.log('📨 Respuesta completa del backend:', response.data);

            // CORREGIR: Manejar la estructura de respuesta correcta
            if (response.data && response.data.success) {
                // El backend ahora devuelve: { success: true, data: [...], columns: [...], totalRecords: n, isEncrypted: true }
                const result: AuditData = {
                    data: response.data.data || [],
                    columns: response.data.columns || [],
                    totalRecords: response.data.totalRecords || 0,
                    isEncrypted: response.data.isEncrypted || true
                };

                console.log('✅ Datos encriptados procesados:', result);
                return result;
            }

            console.error('❌ Respuesta sin success o estructura incorrecta:', response.data);
            throw new Error('Estructura de respuesta inválida del servidor');

        } catch (error) {
            console.error(`❌ Error obteniendo datos encriptados:`, error);

            const axiosError = error as AxiosError;
            if (axiosError.response?.data) {
                const errorData = axiosError.response.data as any;
                throw new Error(errorData.error || errorData.message || 'Error del servidor');
            }

            throw new Error(axiosError.message || 'Error de conexión al obtener datos encriptados');
        }
    }


    // Obtener datos de auditoría desencriptados - CORREGIDO
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

            if (!this.axiosInstance) {
                throw new Error('Servicio API no está disponible');
            }

            const response = await this.axiosInstance.post(`/audit/view-decrypted/${auditTableName}`, {
                type,
                config,
                encryptionKey,
                limit,
                offset
            });

            console.log('📨 Respuesta completa del backend (desencriptado):', response.data);

            // CORREGIR: Manejar la estructura de respuesta correcta
            if (response.data && response.data.success) {
                const result: AuditData = {
                    data: response.data.data || [],
                    columns: response.data.columns || [],
                    originalColumns: response.data.originalColumns || [],
                    totalRecords: response.data.totalRecords || 0,
                    isEncrypted: response.data.isEncrypted || false
                };

                console.log('✅ Datos desencriptados procesados:', result);
                return result;
            }

            console.error('❌ Respuesta sin success o estructura incorrecta:', response.data);
            throw new Error('Estructura de respuesta inválida del servidor');

        } catch (error) {
            console.error(`❌ Error desencriptando datos:`, error);

            const axiosError = error as AxiosError;
            if (axiosError.response?.data) {
                const errorData = axiosError.response.data as any;
                throw new Error(errorData.error || errorData.message || 'Error del servidor');
            }

            throw new Error(axiosError.message || 'Error de conexión al desencriptar datos');
        }
    }

    // Validar contraseña de encriptación - CORREGIDO
    async validateEncryptionPassword(
        type: DatabaseType,
        config: DatabaseConfig,
        auditTableName: string,
        encryptionKey: string
    ): Promise<PasswordValidation> {
        try {
            this.ensureInitialized();

            if (!this.axiosInstance) {
                throw new Error('Servicio API no está disponible');
            }

            const response = await this.axiosInstance.post('/audit/validate-password', {
                type,
                config,
                auditTableName,
                encryptionKey,
            });

            return response.data;
        } catch (error) {
            console.error('❌ Error validando contraseña:', error);
            return this.handleError(error as AxiosError);
        }
    }

    // AGREGAR: Método para configuración masiva de auditoría
    async setupAllTablesAudit(
        type: DatabaseType,
        config: DatabaseConfig,
        tables: string[],
        encryptionKey: string
    ): Promise<BatchAuditSetupResult> {
        try {
            this.ensureInitialized();

            console.log(`🔧 Configurando auditoría masiva para ${tables.length} tablas`);

            if (encryptionKey.length < 12) {
                throw new Error('La clave de encriptación debe tener al menos 12 caracteres');
            }

            if (!tables || tables.length === 0) {
                throw new Error('Debe seleccionar al menos una tabla');
            }

            if (!this.axiosInstance) {
                throw new Error('Servicio API no disponible');
            }

            const response = await this.axiosInstance.post('/audit/setup-all', {
                type,
                config,
                selectedTables: tables, // Enviar como selectedTables
                encryptionKey
            });

            console.log(`✅ Respuesta de configuración masiva:`, response.data);

            if (!response.data) {
                throw new Error('Respuesta vacía del servidor');
            }

            return response.data;

        } catch (error) {
            console.error(`❌ Error en setupAllTablesAudit:`, error);

            const axiosError = error as AxiosError;
            if (axiosError.response?.data) {
                const errorData = axiosError.response.data as any;
                throw new Error(errorData.error || errorData.message || 'Error del servidor');
            }

            throw new Error(axiosError.message || 'Error de conexión en configuración masiva');
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

            if (!this.axiosInstance) {
                throw new Error('Servicio API no está disponible');
            }

            const response = await this.axiosInstance.post(`/audit/statistics/${auditTableName}`, {
                type,
                config
            });
            return response.data;
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }


    // === MÉTODOS DE UTILIDAD ===

    // Verificar estado de salud de la API
    async checkHealth(): Promise<{ status: string; message: string; timestamp: string }> {
        try {
            this.ensureInitialized();

            if (!this.axiosInstance) {
                throw new Error('Servicio API no está disponible');
            }

            const response = await this.axiosInstance.get('/health');
            return response.data;
        } catch (error) {
            return this.handleError(error as AxiosError);
        }
    }


    // Eliminar auditoría de una tabla - CORREGIDO
    // Eliminar auditoría de una tabla - CORREGIDO
    async removeTableAudit(
        type: DatabaseType,
        config: DatabaseConfig,
        auditTableName: string
    ): Promise<{ message: string; tableName: string }> {
        try {
            this.ensureInitialized();

            console.log(`🗑️ Eliminando auditoría: ${auditTableName}`);

            if (!this.axiosInstance) {
                throw new Error('AxiosInstance no inicializado');
            }

            const response = await this.axiosInstance.delete(`/audit/remove/${auditTableName}`, {
                data: {
                    type,
                    config
                }
            });

            console.log('✅ Auditoría eliminada exitosamente:', response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Error eliminando auditoría:', error);
            return this.handleError(error as AxiosError);
        }
    }

    // AGREGAR: Método para eliminación masiva
    // Método para eliminación masiva
    async removeAllTablesAudit(
        type: DatabaseType,
        config: DatabaseConfig
    ): Promise<{
        success: boolean;
        message: string;
        results: Array<{
            tableName: string;
            auditTableName: string;
            success: boolean;
            message?: string;
            error?: string;
        }>;
        summary: {
            total: number;
            successful: number;
            failed: number;
            duration: number;
        };
    }> {
        try {
            this.ensureInitialized();

            console.log('🗑️ Eliminando todas las auditorías...');

            if (!this.axiosInstance) {
                throw new Error('AxiosInstance no inicializado');
            }

            const response = await this.axiosInstance.delete('/audit/remove-all', {
                data: {
                    type,
                    config
                }
            });

            console.log('✅ Eliminación masiva completada:', response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Error en eliminación masiva:', error);
            return this.handleError(error as AxiosError);
        }
    }

    // Obtener configuración del cliente
    getConfig() {
        return {
            baseURL: this.baseURL,
            timeout: 30000,
            initialized: this.initialized
        };
    }

    // Método para verificar el estado del servicio
    isInitialized(): boolean {
        return this.initialized && !!this.axiosInstance;
    }

    // Método para reinicializar el servicio si es necesario
    reinitialize(): void {
        console.log('🔄 Reinicializando ApiService...');
        try {
            this.initializeAxios();
            this.initialized = true;
            console.log('✅ ApiService reinicializado correctamente');
        } catch (error) {
            console.error('💥 Error reinicializando ApiService:', error);
            this.initialized = false;
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