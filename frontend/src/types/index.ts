// Tipos de base de datos
export type DatabaseType = 'mysql' | 'postgresql';

// Configuración de conexión a base de datos
export interface DatabaseConfig {
    host: string;
    user: string;
    password: string;
    database: string;
    port?: number;
    schema?: string; // Solo para PostgreSQL
}

// Información de conexión
export interface ConnectionInfo {
    type: DatabaseType;
    config: DatabaseConfig;
    isConnected: boolean;
    version?: string;
    currentDatabase?: string;
}


export interface TableInfo {
    name: string;
    recordCount: number;
    size?: string;
    comment?: string;
    hasAudit: boolean;
    auditTableName?: string;
    auditType?: 'conventional' | 'encrypted' | null;
    auditRecordCount?: number;
    auditSize?: string;
    auditStatus?: string;
    createdAt?: string;
    updatedAt?: string;
    // Propiedades existentes
    columns?: ColumnInfo[];
    indexes?: IndexInfo[];
    statistics?: TableStatistics;
}

export interface AuditStatistics {
    conventional: number;
    encrypted: number;
    withoutAudit: number;
}

export interface TablesResponse {
    success: boolean;
    data: TableInfo[];
    totalTables: number;
    tablesWithAudit: number;
    auditStatistics?: AuditStatistics;
    fallbackMode?: boolean;
}

// Información de columna
export interface ColumnInfo {
    name: string;
    type: string;
    nullable: boolean;
    default?: string;
    key?: string;
    extra?: string;
    position: number;
}

// Información de índice
export interface IndexInfo {
    name: string;
    columns: string[];
    unique: boolean;
}

// Estadísticas de tabla
export interface TableStatistics {
    totalRecords: number;
    tableRows?: number;
    dataSize?: number;
    indexSize?: number;
    totalSize?: number | string;
    tableSize?: string;
}

// Tabla de auditoría
export interface AuditTable {
    tableName: string;
    originalTable: string;
    hasEncryption: boolean;
    recordCount: number;
    lastUpdated?: string;
    error?: string;
    // NUEVAS PROPIEDADES para tablas encriptadas
    isEncrypted?: boolean;
    isEncryptedTable?: boolean;
    displayName?: string;
    isDecrypted?: boolean;
}

export interface EncryptedAuditTable extends AuditTable {
    isEncryptedTable: true;
    encryptedTableName: string;
    canDecrypt: boolean;
}

export interface EncryptedTablesResponse {
    success: boolean;
    data: {
        auditTables: EncryptedAuditTable[];
        total: number;
    };
}


export interface AuditData {
    data: any[];
    columns: ColumnInfo[];
    originalColumns?: string[];
    originalTableName?: string;
    totalRecords: number;
    isEncrypted: boolean;
    pagination?: {
        limit: number;
        offset: number;
    };
}

// Estadísticas de auditoría
export interface AuditStatistics {
    totalRecords: number;
    actionCounts: Array<{ action: string; count: number }>;
    tableName: string;
    isEncrypted: boolean;
}

// Filtros para reporte
export interface ReportFilters {
    dateFrom?: string;
    dateTo?: string;
    action?: string;
    user?: string;
}

// Reporte de auditoría
export interface AuditReport {
    records: any[];
    statistics: {
        totalRecords: number;
        actionBreakdown: Record<string, number>;
        userBreakdown: Record<string, number>;
        dateRange: {
            from: string | null;
            to: string | null;
        };
    };
    metadata: {
        auditTableName: string;
        originalTable: string;
        generatedAt: string;
        filters: ReportFilters;
    };
}

// Resultado de configuración de auditoría
export interface AuditSetupResult {
    success: boolean;
    message?: string;
    auditTableName?: string;
    tableName?: string;
    error?: string;
}

// Resultado de configuración masiva
export interface BatchAuditSetupResult {
    success: boolean;
    message: string;
    results: Array<AuditSetupResult & { tableName: string }>;
    summary: {
        total: number;
        successful: number;
        failed: number;
    };
}

// Validación de contraseña
export interface PasswordValidation {
    valid: boolean;
    message: string;
}

// Verificación de integridad
export interface IntegrityCheck {
    totalChecked: number;
    validRecords: number;
    invalidRecords: number;
    errors: Array<{
        recordId: string | number;
        error: string;
    }>;
    integrityPercentage: number;
    isHealthy: boolean;
    checkedAt: string;
}

// Resumen de auditoría
export interface AuditSummary {
    totalAuditTables: number;
    totalRecords: number;
    tablesSummary: Array<{
        tableName: string;
        originalTable: string;
        recordCount: number;
        isEncrypted: boolean;
        error?: string;
    }>;
    lastUpdated: string;
}

// Respuesta de API genérica
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    details?: string;
    message?: string;
}

// Estados de carga
export interface LoadingState {
    [key: string]: boolean;
}

// Estados de formulario
export interface FormState {
    isSubmitting: boolean;
    errors: Record<string, string>;
    values: Record<string, any>;
}

// Notificación
export interface Notification {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message?: string;
    duration?: number;
}

// Configuración de la aplicación
export interface AppConfig {
    apiBaseUrl: string;
    defaultPageSize: number;
    maxRecordsPerPage: number;
    encryptionKeyMinLength: number;
}

// Estados de conexión
export enum ConnectionStatus {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    ERROR = 'error'
}

// Tipos de acciones de auditoría
export enum AuditAction {
    INSERT = 'INSERT',
    UPDATE = 'UPDATE',
    DELETE = 'DELETE'
}

// Configuración de paginación
export interface PaginationConfig {
    page: number;
    pageSize: number;
    total: number;
    showSizeChanger?: boolean;
    showQuickJumper?: boolean;
}

// Props comunes para componentes
export interface BaseComponentProps {
    className?: string;
    children?: React.ReactNode;
}

// Props para modales
export interface ModalProps extends BaseComponentProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

// Props para tablas
export interface TableProps<T = any> extends BaseComponentProps {
    data: T[];
    columns: Array<{
        key: string;
        title: string;
        render?: (value: any, record: T, index: number) => React.ReactNode;
        sortable?: boolean;
        width?: string | number;
    }>;
    loading?: boolean;
    pagination?: PaginationConfig;
    onPageChange?: (page: number, pageSize: number) => void;
    rowKey?: string | ((record: T) => string);
    emptyText?: string;
}

// Error de validación
export interface ValidationError {
    field: string;
    message: string;
    code?: string;
}