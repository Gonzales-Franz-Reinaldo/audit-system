import React, { useState } from 'react';
import {
    Shield,
    Eye,
    Trash2,
    BarChart3,
    Search,
    RefreshCw,
    Database,
    Calendar,
    Users,
    Activity,
    Loader2,
    AlertTriangle,
    Lock
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useApi } from '../../hooks/useApi';
import apiService from '../../services/api';
import { AuditTable, ConnectionInfo } from '../../types';

interface AuditTableListProps {
    auditTables: AuditTable[];
    loading: boolean;
    connectionInfo: ConnectionInfo;
    onRefresh: () => void;
    onViewTable: (auditTable: AuditTable) => void;
}

const AuditTableList: React.FC<AuditTableListProps> = ({
    auditTables,
    loading,
    connectionInfo,
    onRefresh,
    onViewTable
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    // API hooks
    const { execute: removeAudit, loading: removeLoading } = useApi(apiService.removeTableAudit);
    const { execute: getStats, loading: statsLoading } = useApi(apiService.getAuditStatistics, false);

    // Filtrar tablas
    const filteredTables = auditTables.filter(table =>
        table.tableName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        table.originalTable.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Estadísticas generales
    const totalRecords = auditTables.reduce((sum, table) => sum + (table.recordCount || 0), 0);
    const avgRecordsPerTable = auditTables.length > 0 ? Math.round(totalRecords / auditTables.length) : 0;

    // Manejar eliminación de auditoría
    const handleRemoveAudit = async () => {
        if (!selectedTable) return;

        try {
            await removeAudit(connectionInfo.type, connectionInfo.config, selectedTable);
            toast.success('Auditoría eliminada exitosamente');
            onRefresh();
            setShowDeleteModal(false);
            setSelectedTable(null);
        } catch (error) {
            toast.error('Error eliminando auditoría');
        }
    };

    // Obtener estadísticas de una tabla
    const handleViewStats = async (auditTable: AuditTable) => {
        try {
            const stats = await getStats(connectionInfo.type, connectionInfo.config, auditTable.tableName);
            if (stats) {
                toast.success(`Total de registros: ${stats.totalRecords}`);
            }
        } catch (error) {
            toast.error('Error obteniendo estadísticas');
        }
    };

    // Confirmar eliminación
    const confirmDelete = (tableName: string) => {
        setSelectedTable(tableName);
        setShowDeleteModal(true);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center">
                            <Shield className="w-6 h-6 mr-3 text-green-600" />
                            Tablas de Auditoría
                        </h2>
                        <p className="text-gray-600 mt-2">
                            Gestiona y visualiza las tablas con auditoría encriptada
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

                {/* Estadísticas generales */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-green-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-green-600 text-sm font-medium">Tablas Auditadas</p>
                                <p className="text-2xl font-bold text-green-900">{auditTables.length}</p>
                            </div>
                            <Shield className="w-8 h-8 text-green-500" />
                        </div>
                    </div>

                    <div className="bg-blue-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-blue-600 text-sm font-medium">Total Registros</p>
                                <p className="text-2xl font-bold text-blue-900">{totalRecords.toLocaleString()}</p>
                            </div>
                            <Database className="w-8 h-8 text-blue-500" />
                        </div>
                    </div>

                    <div className="bg-purple-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-purple-600 text-sm font-medium">Promedio/Tabla</p>
                                <p className="text-2xl font-bold text-purple-900">{avgRecordsPerTable.toLocaleString()}</p>
                            </div>
                            <BarChart3 className="w-8 h-8 text-purple-500" />
                        </div>
                    </div>

                    <div className="bg-yellow-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-yellow-600 text-sm font-medium">Encriptación</p>
                                <p className="text-2xl font-bold text-yellow-900">100%</p>
                            </div>
                            <Activity className="w-8 h-8 text-yellow-500" />
                        </div>
                    </div>
                </div>

                {/* Búsqueda */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                        type="text"
                        placeholder="Buscar tablas de auditoría..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                </div>
            </div>

            {/* Lista de tablas de auditoría */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
                {loading ? (
                    <div className="flex justify-center items-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                        <span className="ml-2 text-gray-600">Cargando tablas de auditoría...</span>
                    </div>
                ) : filteredTables.length === 0 ? (
                    <div className="text-center py-12">
                        <Shield className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                            {searchTerm ? 'No se encontraron tablas de auditoría' : 'No hay tablas de auditoría'}
                        </h3>
                        <p className="text-gray-500">
                            {searchTerm
                                ? 'Intenta cambiar el término de búsqueda'
                                : 'Configura la auditoría para algunas tablas primero'
                            }
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-200">
                        {filteredTables.map((auditTable) => (
                            <div
                                key={auditTable.tableName}
                                className="p-6 hover:bg-gray-50 transition-colors"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-start space-x-4">
                                        <div className="p-3 bg-green-100 rounded-lg">
                                            <Shield className="w-6 h-6 text-green-600" />
                                        </div>

                                        <div className="flex-1">
                                            <div className="flex items-center space-x-2 mb-2">
                                                <h3 className="text-lg font-semibold text-gray-900">
                                                    {auditTable.tableName}
                                                </h3>
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                    <Lock className="w-3 h-3 mr-1" />
                                                    Encriptada
                                                </span>
                                            </div>

                                            <div className="space-y-1">
                                                <p className="text-sm text-gray-600">
                                                    <span className="font-medium">Tabla original:</span> {auditTable.originalTable}
                                                </p>
                                                <p className="text-sm text-gray-600">
                                                    <span className="font-medium">Registros:</span> {(auditTable.recordCount || 0).toLocaleString()}
                                                </p>
                                                {auditTable.lastUpdated && (
                                                    <p className="text-sm text-gray-600">
                                                        <span className="font-medium">Última actualización:</span> {new Date(auditTable.lastUpdated).toLocaleString()}
                                                    </p>
                                                )}
                                                {auditTable.error && (
                                                    <p className="text-sm text-red-600">
                                                        <AlertTriangle className="w-4 h-4 inline mr-1" />
                                                        {auditTable.error}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center space-x-2">
                                        <button
                                            onClick={() => handleViewStats(auditTable)}
                                            disabled={statsLoading}
                                            className="flex items-center px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 disabled:opacity-50"
                                            title="Ver estadísticas"
                                        >
                                            <BarChart3 className="w-4 h-4 mr-1" />
                                            Stats
                                        </button>

                                        <button
                                            onClick={() => onViewTable(auditTable)}
                                            className="flex items-center px-3 py-2 text-sm bg-indigo-100 text-indigo-700 rounded-md hover:bg-indigo-200"
                                            title="Ver datos de auditoría"
                                        >
                                            <Eye className="w-4 h-4 mr-1" />
                                            Ver Datos
                                        </button>

                                        <button
                                            onClick={() => confirmDelete(auditTable.tableName)}
                                            className="flex items-center px-3 py-2 text-sm bg-red-100 text-red-700 rounded-md hover:bg-red-200"
                                            title="Eliminar auditoría"
                                        >
                                            <Trash2 className="w-4 h-4 mr-1" />
                                            Eliminar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal de confirmación de eliminación */}
            {showDeleteModal && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

                        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
                            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                                <div className="flex items-start">
                                    <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                                        <AlertTriangle className="h-6 w-6 text-red-600" />
                                    </div>
                                    <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                                        <h3 className="text-lg leading-6 font-medium text-gray-900">
                                            Eliminar Auditoría
                                        </h3>
                                        <div className="mt-2">
                                            <p className="text-sm text-gray-500">
                                                ¿Estás seguro de que quieres eliminar la auditoría de la tabla{' '}
                                                <span className="font-medium">{selectedTable}</span>?{' '}
                                                Esta acción no se puede deshacer y se perderán todos los datos de auditoría.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                                <button
                                    type="button"
                                    onClick={handleRemoveAudit}
                                    disabled={removeLoading}
                                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                                >
                                    {removeLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Eliminando...
                                        </>
                                    ) : (
                                        <>
                                            <Trash2 className="w-4 h-4 mr-2" />
                                            Eliminar
                                        </>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowDeleteModal(false)}
                                    disabled={removeLoading}
                                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AuditTableList;