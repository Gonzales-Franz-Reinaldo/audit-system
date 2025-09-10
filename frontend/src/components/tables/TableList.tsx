import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import {
    Table,
    Shield,
    ShieldCheck,
    AlertTriangle,
    Database,
    Search,
    RefreshCw,
    Loader2,
    Info,
    Eye,
    Trash2,
    CheckCircle,
    X,
    Clock,
    XCircle,
    Key
} from 'lucide-react';

import { TableInfo, ConnectionInfo, AuditTable } from '../../types';
import { useApi } from '../../hooks/useApi';
import apiService from '../../services/api';
import TableAuditSetup from './TableAuditSetup';

interface TableListProps {
    tables: TableInfo[];
    loading: boolean;
    connectionInfo: ConnectionInfo;
    onRefresh: () => void;
    onAuditSetupComplete: () => void;
    onViewAuditTable?: (auditTable: AuditTable) => void; // ✅ AGREGAR esta prop opcional
}

const TableList: React.FC<TableListProps> = ({
    tables,
    loading,
    connectionInfo,
    onRefresh,
    onAuditSetupComplete,
    onViewAuditTable // ✅ AGREGAR esta prop
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'with-audit' | 'without-audit'>('all');
    const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null);
    const [showSetupModal, setShowSetupModal] = useState(false);
    const [showBulkSetupModal, setShowBulkSetupModal] = useState(false);
    const [selectedTables, setSelectedTables] = useState<string[]>([]);
    const [selectedTablesForBulk, setSelectedTablesForBulk] = useState<string[]>([]);
    const [bulkEncryptionKey, setBulkEncryptionKey] = useState('');
    const [bulkSetupStep, setBulkSetupStep] = useState<'setup' | 'processing' | 'results'>('setup');
    const [bulkResults, setBulkResults] = useState<any[]>([]);

    // API hooks
    const { loading: bulkSetupLoading } = useApi(apiService.setupAllTablesAudit);
    const { execute: setupAllAudit } = useApi(
        async (type: string, config: any, encryptionKey: string, selectedTables: string[]) => {
            console.log('🚀 Ejecutando setupAllTablesAudit');

            if (!apiService || typeof apiService.setupAllTablesAudit !== 'function') {
                throw new Error('ApiService o setupAllTablesAudit no está disponible');
            }

            return apiService.setupAllTablesAudit(type, config, selectedTables, encryptionKey);
        },
        false
    );

    // Filtrar tablas
    const filteredTables = tables.filter(table => {
        const matchesSearch = table.name.toLowerCase().includes(searchTerm.toLowerCase());

        switch (filterType) {
            case 'with-audit':
                return matchesSearch && table.hasAudit;
            case 'without-audit':
                return matchesSearch && !table.hasAudit;
            default:
                return matchesSearch;
        }
    });

    // Estadísticas
    const stats = {
        total: tables.length,
        withAudit: tables.filter(t => t.hasAudit).length,
        withoutAudit: tables.filter(t => !t.hasAudit).length
    };

    // Manejar configuración de auditoría individual
    const handleSetupAudit = (table: TableInfo) => {
        setSelectedTable(table);
        setShowSetupModal(true);
    };

    // Completar configuración individual
    const handleSetupComplete = () => {
        setShowSetupModal(false);
        setSelectedTable(null);
        onRefresh();
        onAuditSetupComplete();
        toast.success('Auditoría configurada exitosamente');
    };

    // Manejar configuración masiva
    const handleBulkSetup = () => {
        const tablesWithoutAudit = tables.filter(t => !t.hasAudit);
        setSelectedTablesForBulk(tablesWithoutAudit.map(t => t.name));
        setShowBulkSetupModal(true);
        setBulkSetupStep('setup');
        setBulkEncryptionKey('');
        setBulkResults([]);
    };


    // ACTUALIZAR la función handleExecuteBulkSetup:
    const handleExecuteBulkSetup = async () => {
        if (!bulkEncryptionKey || selectedTablesForBulk.length === 0) {
            toast.error('Selecciona tablas y proporciona una clave de encriptación');
            return;
        }

        setBulkSetupStep('processing');

        try {
            console.log('🔧 Iniciando configuración masiva secuencial:', {
                tablas: selectedTablesForBulk.length,
                clave: !!bulkEncryptionKey
            });

            // ✅ MOSTRAR PROGRESO EN TIEMPO REAL
            toast.loading(`Configurando ${selectedTablesForBulk.length} tablas secuencialmente...`, {
                duration: 10000
            });

            const result = await setupAllAudit(
                connectionInfo.type,
                connectionInfo.config,
                bulkEncryptionKey,
                selectedTablesForBulk
            );

            console.log('📨 Resultado configuración masiva:', result);

            if (result && result.results) {
                setBulkResults(result.results);
                setBulkSetupStep('results');

                const successCount = result.summary?.successful || 0;
                const failedCount = result.summary?.failed || 0;

                // ✅ TOAST MÁS INFORMATIVO
                if (successCount > 0 && failedCount === 0) {
                    toast.success(`🎉 Todas las tablas configuradas exitosamente: ${successCount}/${selectedTablesForBulk.length}`);
                } else if (successCount > 0 && failedCount > 0) {
                    toast.success(`⚠️ Configuración parcial: ${successCount} exitosas, ${failedCount} fallidas`, {
                        duration: 6000
                    });
                } else {
                    toast.error(`❌ No se pudo configurar ninguna tabla. ${failedCount} errores.`);
                }

                onRefresh(); // Refrescar la lista de tablas
            } else {
                throw new Error('Respuesta inválida del servidor');
            }
        } catch (error) {
            console.error('❌ Error en configuración masiva:', error);
            toast.error(`Error: ${error instanceof Error ? error.message : 'Error desconocido'}`, {
                duration: 8000
            });
            setBulkSetupStep('setup');
        }
    };


    // Completar configuración masiva
    const handleBulkSetupComplete = () => {
        setShowBulkSetupModal(false);
        setSelectedTablesForBulk([]);
        setBulkEncryptionKey('');
        setBulkSetupStep('setup');
        setBulkResults([]);
        onRefresh();
        onAuditSetupComplete();
    };

    // Toggle selección de tabla para configuración masiva
    const toggleTableSelection = (tableName: string) => {
        setSelectedTablesForBulk(prev =>
            prev.includes(tableName)
                ? prev.filter(name => name !== tableName)
                : [...prev, tableName]
        );
    };

    // Seleccionar/Deseleccionar todas las tablas
    const handleSelectAllTables = () => {
        const tablesWithoutAudit = tables.filter(t => !t.hasAudit);
        if (selectedTablesForBulk.length === tablesWithoutAudit.length) {
            setSelectedTablesForBulk([]);
        } else {
            setSelectedTablesForBulk(tablesWithoutAudit.map(t => t.name));
        }
    };

    // ✅ AGREGAR: Nuevos handlers para las acciones
    const handleViewAudit = (table: TableInfo) => {
        // Navegar a la vista de auditoría para esta tabla
        if (table.auditTableName) {
            const auditTable: AuditTable = {
                tableName: table.auditTableName,
                originalTable: table.name,
                hasEncryption: table.auditType === 'encrypted',
                recordCount: table.auditRecordCount || 0, // ✅ CORREGIR: Manejar undefined
                isEncrypted: table.auditType === 'encrypted',
                isEncryptedTable: table.auditType === 'encrypted'
            };
            
            // Si hay un handler para navegar a auditoría, usarlo
            if (onViewAuditTable) {
                onViewAuditTable(auditTable);
            } else {
                toast.success(`Tabla de auditoría: ${table.auditTableName}`); // ✅ CORREGIR: usar success en lugar de info
            }
        }
    };

    const handleRemoveAudit = (table: TableInfo) => {
        if (window.confirm(`¿Estás seguro de que deseas eliminar la auditoría de la tabla "${table.name}"?`)) {
            // Aquí implementar la lógica de eliminación
            toast.loading('Funcionalidad de eliminación de auditoría pendiente de implementar'); // ✅ CORREGIR: usar loading
        }
    };

    const handleViewTableInfo = (table: TableInfo) => {
        // Mostrar modal con información detallada de la tabla
        toast.success(`Información de tabla: ${table.name} - ${table.recordCount} registros`); // ✅ CORREGIR: usar success
    };

    return (
        <div className="space-y-6">
            {/* Header con estadísticas */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center">
                            <Table className="w-6 h-6 mr-3" />
                            Gestión de Tablas
                        </h2>
                        <p className="text-gray-600 mt-2">
                            Administra la auditoría de las tablas de tu base de datos
                        </p>
                    </div>

                    <button
                        onClick={onRefresh}
                        disabled={loading}
                        className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Actualizar
                    </button>
                </div>

                {/* Estadísticas */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-blue-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-blue-600 text-sm font-medium">Total de Tablas</p>
                                <p className="text-2xl font-bold text-blue-900">{stats.total}</p>
                            </div>
                            <Database className="w-8 h-8 text-blue-500" />
                        </div>
                    </div>

                    <div className="bg-green-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-green-600 text-sm font-medium">Con Auditoría</p>
                                <p className="text-2xl font-bold text-green-900">{stats.withAudit}</p>
                            </div>
                            <ShieldCheck className="w-8 h-8 text-green-500" />
                        </div>
                    </div>

                    <div className="bg-yellow-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-yellow-600 text-sm font-medium">Sin Auditoría</p>
                                <p className="text-2xl font-bold text-yellow-900">{stats.withoutAudit}</p>
                            </div>
                            <AlertTriangle className="w-8 h-8 text-yellow-500" />
                        </div>
                    </div>

                    <div className="bg-purple-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-purple-600 text-sm font-medium">Cobertura</p>
                                <p className="text-2xl font-bold text-purple-900">
                                    {stats.total > 0 ? Math.round((stats.withAudit / stats.total) * 100) : 0}%
                                </p>
                            </div>
                            <Shield className="w-8 h-8 text-purple-500" />
                        </div>
                    </div>
                </div>

                {/* Controles */}
                <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                    <div className="flex flex-col sm:flex-row gap-4 flex-1">
                        {/* Búsqueda */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <input
                                type="text"
                                placeholder="Buscar tablas..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>

                        {/* Filtro */}
                        <label htmlFor="filterType" className="sr-only">
                            Filtrar tablas por auditoría
                        </label>
                        <select
                            id="filterType"
                            aria-label="Filtrar tablas por auditoría"
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value as any)}
                            className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="all">Todas las tablas</option>
                            <option value="with-audit">Con auditoría</option>
                            <option value="without-audit">Sin auditoría</option>
                        </select>
                    </div>

                    {/* Acciones masivas - CORREGIDO */}
                    {stats.withoutAudit > 0 && (
                        <div className="flex space-x-2">
                            <button
                                onClick={handleBulkSetup}
                                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                                title={`Configurar auditoría para ${stats.withoutAudit} tablas sin auditoría`}
                            >
                                <Shield className="w-4 h-4 mr-2" />
                                Configurar Todo ({stats.withoutAudit})
                            </button>

                            {/* Información adicional */}
                            <div className="flex items-center text-sm text-gray-600 bg-gray-100 px-3 py-2 rounded-md">
                                <Info className="w-4 h-4 mr-1" />
                                {stats.withoutAudit} tablas disponibles
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Lista de tablas */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
                {loading ? (
                    <div className="flex justify-center items-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                        <span className="ml-2 text-gray-600">Cargando tablas...</span>
                    </div>
                ) : filteredTables.length === 0 ? (
                    <div className="text-center py-12">
                        <Table className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                            {searchTerm || filterType !== 'all' ? 'No se encontraron tablas' : 'No hay tablas'}
                        </h3>
                        <p className="text-gray-500">
                            {searchTerm || filterType !== 'all'
                                ? 'Intenta cambiar los filtros de búsqueda'
                                : 'No se encontraron tablas en la base de datos'
                            }
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-200">
                        {filteredTables.map((table) => (
                            <div
                                key={table.name}
                                className="p-4 hover:bg-gray-50 transition-colors"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center space-x-3">
                                            {/* Icono de tabla */}
                                            <Table className="w-5 h-5 text-gray-500" />
                                            
                                            {/* Nombre y información básica */}
                                            <div>
                                                <h3 className="text-lg font-medium text-gray-900">
                                                    {table.name}
                                                </h3>
                                                <div className="flex items-center space-x-4 text-sm text-gray-500">
                                                    <span>{table.recordCount} registros</span>
                                                    {table.size && <span>{table.size}</span>}
                                                    {table.comment && (
                                                        <span className="italic">"{table.comment}"</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Estado de auditoría y acciones */}
                                    <div className="flex items-center space-x-4">
                                        {/* ✅ CORREGIR: Badge de estado de auditoría */}
                                        <div className="flex items-center space-x-2">
                                            {table.hasAudit ? (
                                                <div className="flex items-center space-x-2">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                        table.auditType === 'encrypted' 
                                                            ? 'bg-purple-100 text-purple-800' 
                                                            : 'bg-green-100 text-green-800'
                                                    }`}>
                                                        <ShieldCheck className="w-3 h-3 mr-1" />
                                                        {table.auditType === 'encrypted' ? 'Encriptada' : 'Convencional'}
                                                    </span>
                                                    
                                                    {/* Información adicional de auditoría */}
                                                    <div className="text-xs text-gray-500">
                                                        <div>{table.auditRecordCount || 0} reg. auditoría</div>
                                                        {table.auditSize && <div>{table.auditSize}</div>}
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                                                    <AlertTriangle className="w-3 h-3 mr-1" />
                                                    Sin Auditoría
                                                </span>
                                            )}
                                        </div>

                                        {/* Acciones */}
                                        <div className="flex items-center space-x-2">
                                            {/* ✅ CORREGIR: Solo mostrar botón si NO tiene auditoría */}
                                            {!table.hasAudit ? (
                                                <button
                                                    onClick={() => handleSetupAudit(table)}
                                                    className="flex items-center px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 transition-colors"
                                                    title="Configurar auditoría para esta tabla"
                                                >
                                                    <Shield className="w-4 h-4 mr-1" />
                                                    Configurar
                                                </button>
                                            ) : (
                                                <div className="flex items-center space-x-2">
                                                    {/* ✅ CORREGIR: Botón para ver auditoría */}
                                                    <button
                                                        onClick={() => handleViewAudit(table)}
                                                        className="flex items-center px-3 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 transition-colors"
                                                        title="Ver registros de auditoría"
                                                    >
                                                        <Eye className="w-4 h-4 mr-1" />
                                                        Ver Auditoría
                                                    </button>
                                                    
                                                    {/* ✅ CORREGIR: Botón para remover auditoría */}
                                                    <button
                                                        onClick={() => handleRemoveAudit(table)}
                                                        className="flex items-center px-3 py-1.5 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 transition-colors"
                                                        title="Eliminar auditoría"
                                                    >
                                                        <Trash2 className="w-4 h-4 mr-1" />
                                                        Eliminar
                                                    </button>
                                                </div>
                                            )}

                                            {/* Botón de información */}
                                            <button
                                                onClick={() => handleViewTableInfo(table)}
                                                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-md transition-colors"
                                                title="Ver información detallada"
                                            >
                                                <Info className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal de configuración individual */}
            {showSetupModal && selectedTable && (
                <TableAuditSetup
                    isOpen={showSetupModal}
                    onClose={() => setShowSetupModal(false)}
                    table={selectedTable}
                    connectionInfo={connectionInfo}
                    onComplete={handleSetupComplete}
                />
            )}

            {/* Modal de configuración masiva */}
            {showBulkSetupModal && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

                        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
                            {/* Header */}
                            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start">
                                        <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-green-100 sm:mx-0 sm:h-10 sm:w-10">
                                            <Shield className="h-6 w-6 text-green-600" />
                                        </div>
                                        <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                                            <h3 className="text-lg leading-6 font-medium text-gray-900">
                                                Configuración Masiva de Auditoría
                                            </h3>
                                            <p className="text-sm text-gray-500 mt-1">
                                                Configura auditoría encriptada para múltiples tablas
                                            </p>
                                        </div>
                                    </div>

                                    {bulkSetupStep !== 'processing' && (
                                        <button
                                            onClick={() => setShowBulkSetupModal(false)}
                                            className="rounded-md text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            aria-label="Cerrar modal"
                                        >
                                            <X className="h-6 w-6" />
                                        </button>
                                    )}
                                </div>

                                {/* Contenido del modal según el step */}
                                <div className="mt-6">
                                    {bulkSetupStep === 'setup' && (
                                        <div className="space-y-6">
                                            {/* Información */}
                                            <div className="bg-blue-50 p-4 rounded-lg">
                                                <div className="flex">
                                                    <Info className="h-5 w-5 text-blue-400 mt-0.5" />
                                                    <div className="ml-3">
                                                        <h4 className="text-blue-800 font-medium">
                                                            Configuración Masiva de Auditoría
                                                        </h4>
                                                        <p className="text-blue-700 text-sm mt-1">
                                                            Se configurará auditoría encriptada para las tablas seleccionadas.
                                                            Usa la misma clave para todas las tablas para facilitar la gestión.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Clave de encriptación */}
                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                                        <Key className="w-4 h-4 inline mr-2" />
                                                        Clave de Encriptación (para todas las tablas)
                                                    </label>
                                                    <div className="space-y-2">
                                                        <input
                                                            type="password"
                                                            value={bulkEncryptionKey}
                                                            onChange={(e) => setBulkEncryptionKey(e.target.value)}
                                                            placeholder="Mínimo 12 caracteres con mayús, minús, números y símbolos"
                                                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                // Generar clave automática
                                                                const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
                                                                let result = '';
                                                                for (let i = 0; i < 16; i++) {
                                                                    result += chars.charAt(Math.floor(Math.random() * chars.length));
                                                                }
                                                                setBulkEncryptionKey(result);
                                                            }}
                                                            className="text-sm text-indigo-600 hover:text-indigo-800"
                                                        >
                                                            🎲 Generar clave automática
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Selección de tablas */}
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-sm font-medium text-gray-700">
                                                        Seleccionar Tablas ({selectedTablesForBulk.length} de {tables.filter(t => !t.hasAudit).length})
                                                    </h4>
                                                    <button
                                                        onClick={handleSelectAllTables}
                                                        className="text-sm text-indigo-600 hover:text-indigo-800"
                                                    >
                                                        {selectedTablesForBulk.length === tables.filter(t => !t.hasAudit).length
                                                            ? 'Deseleccionar todas'
                                                            : 'Seleccionar todas'
                                                        }
                                                    </button>
                                                </div>

                                                <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-md">
                                                    <div className="divide-y divide-gray-200">
                                                        {tables.filter(t => !t.hasAudit).map((table) => (
                                                            <label
                                                                key={table.name}
                                                                className="flex items-center p-3 hover:bg-gray-50 cursor-pointer"
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selectedTablesForBulk.includes(table.name)}
                                                                    onChange={() => toggleTableSelection(table.name)}
                                                                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                                                />
                                                                <div className="ml-3 flex-1">
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-sm font-medium text-gray-900">
                                                                            {table.name}
                                                                        </span>
                                                                        <span className="text-xs text-gray-500">
                                                                            {table.recordCount?.toLocaleString()} registros
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Warning */}
                                            <div className="bg-yellow-50 p-4 rounded-lg">
                                                <div className="flex">
                                                    <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5" />
                                                    <div className="ml-3">
                                                        <h4 className="text-yellow-800 font-medium">Importante</h4>
                                                        <ul className="text-yellow-700 text-sm mt-1 space-y-1">
                                                            <li>• Guarda la clave de encriptación de forma segura</li>
                                                            <li>• Se creará una tabla de auditoría para cada tabla seleccionada</li>
                                                            <li>• El proceso puede tomar varios minutos para muchas tablas</li>
                                                            <li>• No cierres esta ventana durante el proceso</li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {bulkSetupStep === 'processing' && (
                                        <div className="text-center py-8 space-y-4">
                                            <Loader2 className="w-12 h-12 animate-spin text-green-600 mx-auto" />
                                            <h4 className="text-lg font-medium text-gray-900">
                                                Configurando Auditoría Masiva...
                                            </h4>
                                            <p className="text-gray-600">
                                                Procesando {selectedTablesForBulk.length} tablas. Esto puede tomar varios minutos.
                                            </p>
                                            <div className="bg-gray-100 rounded-full h-2 max-w-md mx-auto">
                                                <div className="bg-green-600 h-2 rounded-full animate-pulse" style={{ width: '60%' }}></div>
                                            </div>
                                        </div>
                                    )}

                                    {bulkSetupStep === 'results' && (
                                        <div className="space-y-6">
                                            {/* Resumen */}
                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="bg-green-50 p-4 rounded-lg text-center">
                                                    <div className="text-2xl font-bold text-green-900">
                                                        {bulkResults.filter(r => r.success).length}
                                                    </div>
                                                    <div className="text-sm text-green-600">Exitosas</div>
                                                </div>
                                                <div className="bg-red-50 p-4 rounded-lg text-center">
                                                    <div className="text-2xl font-bold text-red-900">
                                                        {bulkResults.filter(r => !r.success).length}
                                                    </div>
                                                    <div className="text-sm text-red-600">Fallidas</div>
                                                </div>
                                                <div className="bg-blue-50 p-4 rounded-lg text-center">
                                                    <div className="text-2xl font-bold text-blue-900">
                                                        {bulkResults.length}
                                                    </div>
                                                    <div className="text-sm text-blue-600">Total</div>
                                                </div>
                                            </div>

                                            {/* Detalles */}
                                            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-md">
                                                <div className="divide-y divide-gray-200">
                                                    {bulkResults.map((result, index) => (
                                                        <div key={index} className="p-3 flex items-center justify-between">
                                                            <div className="flex items-center space-x-2">
                                                                {result.success ? (
                                                                    <CheckCircle className="w-5 h-5 text-green-500" />
                                                                ) : (
                                                                    <XCircle className="w-5 h-5 text-red-500" />
                                                                )}
                                                                <span className="font-medium">{result.tableName}</span>
                                                            </div>
                                                            <div className="text-sm text-gray-600">
                                                                {result.success ? 'Configurada exitosamente' : result.error}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                                {bulkSetupStep === 'setup' && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={handleExecuteBulkSetup}
                                            disabled={!bulkEncryptionKey || selectedTablesForBulk.length === 0}
                                            className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-green-600 text-base font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Shield className="w-4 h-4 mr-2" />
                                            Configurar {selectedTablesForBulk.length} Tablas
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowBulkSetupModal(false)}
                                            className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                        >
                                            Cancelar
                                        </button>
                                    </>
                                )}

                                {bulkSetupStep === 'results' && (
                                    <button
                                        type="button"
                                        onClick={handleBulkSetupComplete}
                                        className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm"
                                    >
                                        <CheckCircle className="w-4 h-4 mr-2" />
                                        Finalizar
                                    </button>
                                )}

                                {bulkSetupStep === 'processing' && (
                                    <div className="w-full text-center">
                                        <p className="text-sm text-gray-500">
                                            Por favor espera, no cierres esta ventana...
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TableList;