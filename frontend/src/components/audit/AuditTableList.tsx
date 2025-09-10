import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import {
    Shield,
    Database,
    Search,
    RefreshCw,
    Eye,
    BarChart3,
    Trash2,
    Lock,
    Unlock,
    Activity,
    CheckCircle,
    AlertTriangle,
    Loader2,
    X
} from 'lucide-react';

import { useApi } from '../../hooks/useApi';
import apiService from '../../services/api';
import DecryptModal from './DecryptModal';
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
    const [showDecryptModal, setShowDecryptModal] = useState(false);
    const [encryptionKey, setEncryptionKey] = useState('');
    
    // Estados para eliminación masiva
    const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
    const [deleteAllStep, setDeleteAllStep] = useState<'confirm' | 'processing' | 'results'>('confirm');
    const [deleteAllResults, setDeleteAllResults] = useState<any[]>([]);

    // Estados para vista encriptada/desencriptada
    const [viewMode, setViewMode] = useState<'encrypted' | 'decrypted'>('encrypted');
    const [decryptedTables, setDecryptedTables] = useState<AuditTable[]>([]);

    // API hooks para eliminación
    const { execute: removeAudit, loading: removeLoading } = useApi(
        async (type: string, config: any, auditTableName: string) => {
            if (!apiService || typeof apiService.removeTableAudit !== 'function') {
                throw new Error('ApiService o removeTableAudit no está disponible');
            }
            return apiService.removeTableAudit(type, config, auditTableName);
        },
        false
    );

    const { execute: removeAllAudits, loading: removeAllLoading } = useApi(
        async (type: string, config: any) => {
            if (!apiService || typeof apiService.removeAllTablesAudit !== 'function') {
                throw new Error('ApiService o removeAllTablesAudit no está disponible');
            }
            return apiService.removeAllTablesAudit(type, config);
        },
        false
    );

    // Hooks para tablas encriptadas/desencriptadas
    const { execute: getEncryptedTables, loading: encryptedLoading } = useApi(
        async (type: string, config: any) => {
            if (!apiService || typeof apiService.getEncryptedAuditTables !== 'function') {
                throw new Error('ApiService o getEncryptedAuditTables no está disponible');
            }
            return apiService.getEncryptedAuditTables(type, config);
        },
        false
    );

    const { execute: getDecryptedTables, loading: decryptedLoading } = useApi(
        async (type: string, config: any, encryptionKey: string) => {
            if (!apiService || typeof apiService.getDecryptedAuditTables !== 'function') {
                throw new Error('ApiService o getDecryptedAuditTables no está disponible');
            }
            return apiService.getDecryptedAuditTables(type, config, encryptionKey);
        },
        false
    );

    const { execute: getStats, loading: statsLoading } = useApi(apiService.getAuditStatistics, false);

    // Determinar qué tablas mostrar
    const tablesToShow = viewMode === 'decrypted' ? decryptedTables : auditTables;

    // Filtrar tablas
    const filteredTables = tablesToShow.filter(table =>
        table.tableName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        table.originalTable.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Estadísticas generales
    const totalRecords = auditTables.reduce((sum, table) => sum + (table.recordCount || 0), 0);
    const avgRecordsPerTable = auditTables.length > 0 ? Math.round(totalRecords / auditTables.length) : 0;

    // Manejar eliminación individual
    const handleRemoveAudit = async () => {
        if (!selectedTable) return;

        try {
            console.log('🗑️ Eliminando auditoría:', selectedTable);
            
            const result = await removeAudit(
                connectionInfo.type,
                connectionInfo.config,
                selectedTable
            );

            if (result) {
                toast.success(`Auditoría eliminada: ${result.tableName || selectedTable}`);
                onRefresh();
                setShowDeleteModal(false);
                setSelectedTable(null);
            }
        } catch (error) {
            console.error('❌ Error eliminando auditoría:', error);
            toast.error('Error eliminando auditoría: ' + (error instanceof Error ? error.message : 'Error desconocido'));
        }
    };

    // Manejar eliminación masiva
    const handleRemoveAllAudits = async () => {
        try {
            setDeleteAllStep('processing');
            
            console.log('🗑️ Eliminando todas las auditorías...');
            
            const result = await removeAllAudits(
                connectionInfo.type,
                connectionInfo.config
            );

            if (result) {
                setDeleteAllResults(result.results || []);
                setDeleteAllStep('results');
                
                const successCount = result.summary?.successful || 0;
                const failedCount = result.summary?.failed || 0;
                
                if (successCount > 0 && failedCount === 0) {
                    toast.success(`🎉 Todas las auditorías eliminadas: ${successCount} tablas`);
                } else if (successCount > 0 && failedCount > 0) {
                    toast.success(`⚠️ Eliminación parcial: ${successCount} exitosas, ${failedCount} fallidas`, {
                        duration: 6000
                    });
                } else {
                    toast.error(`❌ No se pudo eliminar ninguna auditoría. ${failedCount} errores.`);
                }
                
                onRefresh();
            }
        } catch (error) {
            console.error('❌ Error en eliminación masiva:', error);
            toast.error('Error en eliminación masiva: ' + (error instanceof Error ? error.message : 'Error desconocido'));
            setDeleteAllStep('confirm');
        }
    };

    // Manejar desencriptación de vista
    const handleDecryptView = async (key: string) => {
        try {
            const result = await getDecryptedTables(
                connectionInfo.type,
                connectionInfo.config,
                key
            );

            if (result && result.data && result.data.auditTables) {
                setDecryptedTables(result.data.auditTables);
                setViewMode('decrypted');
                setEncryptionKey(key);
                setShowDecryptModal(false);
                toast.success('Vista desencriptada exitosamente');
            }
        } catch (error) {
            console.error('❌ Error desencriptando vista:', error);
            toast.error('Error desencriptando vista - Verifica tu clave');
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

    // Completar eliminación masiva
    const handleDeleteAllComplete = () => {
        setShowDeleteAllModal(false);
        setDeleteAllStep('confirm');
        setDeleteAllResults([]);
        onRefresh();
    };

    // Confirmar eliminación individual
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
                            {viewMode === 'encrypted' ? (
                                <span className="ml-2 text-sm bg-purple-100 text-purple-800 px-2 py-1 rounded">
                                    Vista Encriptada
                                </span>
                            ) : (
                                <span className="ml-2 text-sm bg-green-100 text-green-800 px-2 py-1 rounded">
                                    Vista Desencriptada
                                </span>
                            )}
                        </h2>
                        <p className="text-gray-600 mt-2">
                            {viewMode === 'encrypted' 
                                ? 'Los nombres de tabla están encriptados para máxima seguridad'
                                : 'Vista desencriptada - Nombres de tabla legibles'
                            }
                        </p>
                    </div>

                    <div className="flex items-center space-x-2">
                        {/* Botón de eliminación masiva */}
                        {auditTables.length > 0 && (
                            <button
                                onClick={() => setShowDeleteAllModal(true)}
                                className="flex items-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                                title="Eliminar todas las auditorías"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Eliminar Todo ({auditTables.length})
                            </button>
                        )}

                        {/* Toggle de vista encriptada/desencriptada */}
                        {viewMode === 'encrypted' ? (
                            <button
                                onClick={() => setShowDecryptModal(true)}
                                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                                title="Desencriptar vista de tablas"
                            >
                                <Unlock className="w-4 h-4 mr-2" />
                                Desencriptar Vista
                            </button>
                        ) : (
                            <button
                                onClick={() => {
                                    setViewMode('encrypted');
                                    setDecryptedTables([]);
                                    setEncryptionKey('');
                                }}
                                className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
                                title="Volver a vista encriptada"
                            >
                                <Lock className="w-4 h-4 mr-2" />
                                Encriptar Vista
                            </button>
                        )}

                        <button
                            onClick={onRefresh}
                            disabled={loading}
                            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                            Actualizar
                        </button>
                    </div>
                </div>

                {/* Estadísticas generales */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-green-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-green-600 text-sm font-medium">Tablas con Auditoría</p>
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
                                <p className="text-purple-600 text-sm font-medium">Promedio por Tabla</p>
                                <p className="text-2xl font-bold text-purple-900">{avgRecordsPerTable.toLocaleString()}</p>
                            </div>
                            <BarChart3 className="w-8 h-8 text-purple-500" />
                        </div>
                    </div>

                    <div className="bg-yellow-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-yellow-600 text-sm font-medium">Estado</p>
                                <p className="text-2xl font-bold text-yellow-900">Activo</p>
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
                    <div className="p-8 text-center">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-4" />
                        <p className="text-gray-600">Cargando tablas de auditoría...</p>
                    </div>
                ) : filteredTables.length === 0 ? (
                    <div className="p-8 text-center">
                        <Database className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                            No hay tablas de auditoría
                        </h3>
                        <p className="text-gray-500 mb-4">
                            No se encontraron tablas de auditoría en esta base de datos.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Tabla de Auditoría {viewMode === 'encrypted' ? '(Encriptada)' : '(Legible)'}
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Tabla Original
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Estado
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Registros
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Acciones
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {filteredTables.map((table) => (
                                    <tr key={table.tableName} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <div className="flex-shrink-0 w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                                    <Lock className="w-5 h-5 text-purple-600" />
                                                </div>
                                                <div className="ml-4">
                                                    <div className="text-sm font-medium text-gray-900 font-mono">
                                                        {table.tableName}
                                                    </div>
                                                    <div className="text-sm text-gray-500">
                                                        {viewMode === 'encrypted' ? 'Nombre encriptado' : 'Nombre legible'}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">
                                                {table.originalTable || 'Desconocida'}
                                            </div>
                                            <div className="text-sm text-gray-500">
                                                Tabla fuente
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                                                <Shield className="w-3 h-3 mr-1" />
                                                Encriptada
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            <div className="flex items-center">
                                                <BarChart3 className="w-4 h-4 text-gray-400 mr-2" />
                                                {table.recordCount?.toLocaleString() || '0'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                            <button
                                                onClick={() => onViewTable(table)}
                                                className="inline-flex items-center px-3 py-1 border border-transparent text-sm leading-4 font-medium rounded-md text-indigo-700 bg-indigo-100 hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                                                title="Ver datos de auditoría"
                                            >
                                                <Eye className="w-4 h-4 mr-1" />
                                                Ver Datos
                                            </button>
                                            
                                            <button
                                                onClick={() => handleViewStats(table)}
                                                disabled={statsLoading}
                                                className="inline-flex items-center px-3 py-1 border border-gray-300 text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                                                title="Ver estadísticas"
                                            >
                                                <BarChart3 className="w-4 h-4 mr-1" />
                                                Stats
                                            </button>

                                            <button
                                                onClick={() => confirmDelete(table.tableName)}
                                                className="inline-flex items-center px-3 py-1 border border-red-300 text-sm leading-4 font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                                                title="Eliminar auditoría"
                                            >
                                                <Trash2 className="w-4 h-4 mr-1" />
                                                Eliminar
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal de desencriptación de vista */}
            <DecryptModal
                isOpen={showDecryptModal}
                onClose={() => setShowDecryptModal(false)}
                onDecrypt={handleDecryptView}
                loading={decryptedLoading}
                tableName="todas las tablas"
            />

            {/* Modal de eliminación masiva */}
            {showDeleteAllModal && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

                        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
                            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                                <div className="flex items-start">
                                    <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                                        <Trash2 className="h-6 w-6 text-red-600" />
                                    </div>
                                    <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left flex-1">
                                        <h3 className="text-lg leading-6 font-medium text-gray-900">
                                            {deleteAllStep === 'confirm' && 'Eliminar Todas las Auditorías'}
                                            {deleteAllStep === 'processing' && 'Eliminando Auditorías...'}
                                            {deleteAllStep === 'results' && 'Resultados de Eliminación'}
                                        </h3>
                                        
                                        <div className="mt-4">
                                            {deleteAllStep === 'confirm' && (
                                                <div>
                                                    <p className="text-sm text-gray-500 mb-4">
                                                        ⚠️ <strong>¡ATENCIÓN!</strong> Esta acción eliminará TODAS las auditorías configuradas.
                                                        Se eliminarán:
                                                    </p>
                                                    <ul className="text-sm text-gray-700 space-y-1 mb-4">
                                                        <li>• {auditTables.length} tablas de auditoría</li>
                                                        <li>• Todos los triggers asociados</li>
                                                        <li>• Todas las funciones de encriptación</li>
                                                        <li>• Todos los datos de auditoría almacenados</li>
                                                    </ul>
                                                    <div className="bg-red-50 border border-red-200 rounded-md p-3">
                                                        <p className="text-sm text-red-800">
                                                            <strong>Esta acción NO se puede deshacer.</strong> Todos los registros de auditoría se perderán permanentemente.
                                                        </p>
                                                    </div>
                                                </div>
                                            )}

                                            {deleteAllStep === 'processing' && (
                                                <div className="text-center py-8">
                                                    <Loader2 className="w-12 h-12 animate-spin text-red-600 mx-auto mb-4" />
                                                    <p className="text-sm text-gray-600">
                                                        Eliminando auditorías secuencialmente...
                                                    </p>
                                                    <p className="text-xs text-gray-500 mt-2">
                                                        Por favor no cierres esta ventana
                                                    </p>
                                                </div>
                                            )}

                                            {deleteAllStep === 'results' && (
                                                <div className="max-h-96 overflow-y-auto">
                                                    <div className="space-y-2">
                                                        {deleteAllResults.map((result, index) => (
                                                            <div
                                                                key={index}
                                                                className={`p-3 rounded-md flex items-center justify-between ${
                                                                    result.success
                                                                        ? 'bg-green-50 border border-green-200'
                                                                        : 'bg-red-50 border border-red-200'
                                                                }`}
                                                            >
                                                                <div className="flex items-center">
                                                                    {result.success ? (
                                                                        <CheckCircle className="w-5 h-5 text-green-600 mr-3" />
                                                                    ) : (
                                                                        <AlertTriangle className="w-5 h-5 text-red-600 mr-3" />
                                                                    )}
                                                                    <div>
                                                                        <p className="font-medium text-sm">
                                                                            {result.tableName}
                                                                        </p>
                                                                        <p className="text-xs text-gray-600">
                                                                            {result.auditTableName}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                <div className="text-right">
                                                                    <p className={`text-sm ${result.success ? 'text-green-800' : 'text-red-800'}`}>
                                                                        {result.success ? 'Eliminada' : 'Error'}
                                                                    </p>
                                                                    {result.error && (
                                                                        <p className="text-xs text-red-600">{result.error}</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                                {deleteAllStep === 'confirm' && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={handleRemoveAllAudits}
                                            disabled={removeAllLoading}
                                            className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                                        >
                                            <Trash2 className="w-4 h-4 mr-2" />
                                            Eliminar Todo
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowDeleteAllModal(false)}
                                            disabled={removeAllLoading}
                                            className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                                        >
                                            Cancelar
                                        </button>
                                    </>
                                )}

                                {deleteAllStep === 'results' && (
                                    <button
                                        type="button"
                                        onClick={handleDeleteAllComplete}
                                        className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm"
                                    >
                                        <CheckCircle className="w-4 h-4 mr-2" />
                                        Finalizar
                                    </button>
                                )}

                                {deleteAllStep === 'processing' && (
                                    <div className="w-full text-center">
                                        <p className="text-sm text-gray-500">
                                            Procesando eliminaciones...
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de confirmación de eliminación individual */}
            {showDeleteModal && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

                        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
                            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                                <div className="flex items-start">
                                    <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                                        <Trash2 className="h-6 w-6 text-red-600" />
                                    </div>
                                    <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                                        <h3 className="text-lg leading-6 font-medium text-gray-900">
                                            Eliminar Auditoría
                                        </h3>
                                        <div className="mt-2">
                                            <p className="text-sm text-gray-500">
                                                ¿Estás seguro de que deseas eliminar la auditoría para <strong>{selectedTable}</strong>?
                                                Esta acción eliminará:
                                            </p>
                                            <ul className="text-sm text-gray-500 mt-2 list-disc list-inside">
                                                <li>La tabla de auditoría</li>
                                                <li>Todos los triggers asociados</li>
                                                <li>Las funciones de encriptación específicas</li>
                                                <li>Todos los datos de auditoría almacenados</li>
                                            </ul>
                                            <p className="text-sm text-red-600 mt-2 font-medium">
                                                Esta acción no se puede deshacer.
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