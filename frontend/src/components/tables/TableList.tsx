import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import {
    Table,
    Shield,
    ShieldCheck,
    Settings,
    RefreshCw,
    Search,
    Filter,
    ChevronRight,
    AlertTriangle,
    CheckCircle,
    Loader2,
    Lock,
    Database
} from 'lucide-react';

import { TableInfo, ConnectionInfo } from '../../types';
import { useApi } from '../../hooks/useApi';
import apiService from '../../services/api';
import TableAuditSetup from './TableAuditSetup';

interface TableListProps {
    tables: TableInfo[];
    loading: boolean;
    connectionInfo: ConnectionInfo;
    onRefresh: () => void;
    onAuditSetupComplete: () => void;
}

const TableList: React.FC<TableListProps> = ({
    tables,
    loading,
    connectionInfo,
    onRefresh,
    onAuditSetupComplete
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'with-audit' | 'without-audit'>('all');
    const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null);
    const [showSetupModal, setShowSetupModal] = useState(false);
    const [showBulkSetup, setShowBulkSetup] = useState(false);
    const [selectedTables, setSelectedTables] = useState<string[]>([]);

    // API hooks
    const { loading: bulkSetupLoading } = useApi(apiService.setupAllTablesAudit);

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
        setSelectedTables(tablesWithoutAudit.map(t => t.name));
        setShowBulkSetup(true);
    };

    // Completar configuración masiva
    const handleBulkSetupComplete = () => {
        setShowBulkSetup(false);
        setSelectedTables([]);
        onRefresh();
        onAuditSetupComplete();
    };

    // Toggle selección de tabla para configuración masiva
    const toggleTableSelection = (tableName: string) => {
        setSelectedTables(prev =>
            prev.includes(tableName)
                ? prev.filter(name => name !== tableName)
                : [...prev, tableName]
        );
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

                    {/* Acciones masivas */}
                    {stats.withoutAudit > 0 && (
                        <button
                            onClick={handleBulkSetup}
                            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                        >
                            <Shield className="w-4 h-4 mr-2" />
                            Configurar Todo
                        </button>
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
                                    <div className="flex items-center space-x-4">
                                        <div className={`
                      p-2 rounded-lg
                      ${table.hasAudit
                                                ? 'bg-green-100 text-green-600'
                                                : 'bg-gray-100 text-gray-600'
                                            }
                    `}>
                                            {table.hasAudit ? (
                                                <ShieldCheck className="w-5 h-5" />
                                            ) : (
                                                <Table className="w-5 h-5" />
                                            )}
                                        </div>

                                        <div>
                                            <h3 className="text-lg font-medium text-gray-900">
                                                {table.name}
                                            </h3>
                                            <div className="flex items-center space-x-4 text-sm text-gray-500">
                                                <span>
                                                    {table.recordCount !== undefined
                                                        ? `${table.recordCount.toLocaleString()} registros`
                                                        : 'Registros: N/A'
                                                    }
                                                </span>
                                                {table.hasAudit && table.auditTableName && (
                                                    <span className="flex items-center text-green-600">
                                                        <Lock className="w-3 h-3 mr-1" />
                                                        {table.auditTableName}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center space-x-2">
                                        {table.hasAudit ? (
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                <CheckCircle className="w-3 h-3 mr-1" />
                                                Auditado
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => handleSetupAudit(table)}
                                                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-indigo-600 bg-indigo-100 hover:bg-indigo-200"
                                            >
                                                <Shield className="w-4 h-4 mr-2" />
                                                Configurar Auditoría
                                            </button>
                                        )}

                                        <button className="p-2 text-gray-400 hover:text-gray-600" title="Ver detalles de la tabla">
                                            <ChevronRight className="w-4 h-4" />
                                        </button>
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
            {showBulkSetup && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

                        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
                            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                                <div className="flex items-start">
                                    <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-green-100 sm:mx-0 sm:h-10 sm:w-10">
                                        <Shield className="h-6 w-6 text-green-600" />
                                    </div>
                                    <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left flex-1">
                                        <h3 className="text-lg leading-6 font-medium text-gray-900">
                                            Configuración Masiva de Auditoría
                                        </h3>
                                        <div className="mt-4">
                                            <p className="text-sm text-gray-500 mb-4">
                                                Se configurará la auditoría encriptada para las siguientes tablas:
                                            </p>

                                            <div className="max-h-60 overflow-y-auto border rounded-lg">
                                                {tables.filter(t => !t.hasAudit).map((table) => (
                                                    <label
                                                        key={table.name}
                                                        className="flex items-center p-3 hover:bg-gray-50 cursor-pointer"
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedTables.includes(table.name)}
                                                            onChange={() => toggleTableSelection(table.name)}
                                                            className="mr-3 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                                        />
                                                        <div className="flex-1">
                                                            <span className="text-sm font-medium text-gray-900">
                                                                {table.name}
                                                            </span>
                                                            <span className="text-xs text-gray-500 ml-2">
                                                                ({table.recordCount?.toLocaleString() || 0} registros)
                                                            </span>
                                                        </div>
                                                    </label>
                                                ))}
                                            </div>

                                            <div className="mt-4 p-3 bg-yellow-50 rounded-lg">
                                                <p className="text-sm text-yellow-800">
                                                    <strong>Nota:</strong> Se seleccionaron {selectedTables.length} tablas.
                                                    La configuración puede tomar varios minutos dependiendo del número de tablas.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                                <button
                                    type="button"
                                    onClick={() => {
                                        // Aquí iría la lógica para configurar auditoría masiva
                                        handleBulkSetupComplete();
                                    }}
                                    disabled={selectedTables.length === 0 || bulkSetupLoading}
                                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-green-600 text-base font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                                >
                                    {bulkSetupLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Configurando...
                                        </>
                                    ) : (
                                        `Configurar ${selectedTables.length} Tablas`
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowBulkSetup(false)}
                                    disabled={bulkSetupLoading}
                                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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

export default TableList;