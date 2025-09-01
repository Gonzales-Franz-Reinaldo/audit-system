import React, { useState, useEffect } from 'react';
import {
    ArrowLeft,
    Eye,
    EyeOff,
    RefreshCw,
    Lock,
    Unlock,
    Search,
    Filter,
    Activity,
    Calendar,
    Loader2,
    AlertTriangle,
    ChevronLeft,
    ChevronRight
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { useApi, usePagination } from '../../hooks/useApi';
import apiService from '../../services/api';
import DecryptModal from './DecryptModal';
import { AuditTable, ConnectionInfo, AuditData } from '../../types';

interface AuditTableViewerProps {
    auditTable: AuditTable;
    connectionInfo: ConnectionInfo;
    onBack: () => void;
}

const AuditTableViewer: React.FC<AuditTableViewerProps> = ({
    auditTable,
    connectionInfo,
    onBack
}) => {
    const [isEncrypted, setIsEncrypted] = useState(true);
    const [encryptionKey, setEncryptionKey] = useState('');
    const [showDecryptModal, setShowDecryptModal] = useState(false);
    const [auditData, setAuditData] = useState<AuditData | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [actionFilter, setActionFilter] = useState<'all' | 'INSERT' | 'UPDATE' | 'DELETE'>('all');

    // Paginación
    const {
        currentPage,
        pageSize,
        total,
        setTotal,
        goToPage,
        changePageSize
    } = usePagination(1, 50);

    // API hooks - CORREGIDOS con verificación robusta
    const { execute: getEncryptedData, loading: encryptedLoading } = useApi(
        async (...args: [string, any, string, number, number]) => {
            console.log('🔍 Llamando getEncryptedData con args:', args);
            
            // VERIFICAR que apiService esté disponible
            if (!apiService) {
                throw new Error('ApiService no está disponible');
            }
            
            if (typeof apiService.getEncryptedAuditData !== 'function') {
                throw new Error('Método getEncryptedAuditData no está disponible');
            }
            
            return apiService.getEncryptedAuditData(...args);
        }, 
        false
    );

    const { execute: getDecryptedData, loading: decryptedLoading } = useApi(
        async (...args: [string, any, string, string, number, number]) => {
            console.log('🔍 Llamando getDecryptedData con args:', args);
            
            if (!apiService || typeof apiService.getDecryptedAuditData !== 'function') {
                throw new Error('ApiService o getDecryptedAuditData no está disponible');
            }
            
            return apiService.getDecryptedAuditData(...args);
        }, 
        false
    );

    const { execute: validatePassword, loading: validateLoading } = useApi(
        async (...args: [string, any, string, string]) => {
            console.log('🔍 Llamando validatePassword con args:', args);
            
            if (!apiService || typeof apiService.validateEncryptionPassword !== 'function') {
                throw new Error('ApiService o validateEncryptionPassword no está disponible');
            }
            
            return apiService.validateEncryptionPassword(...args);
        }, 
        false
    );

    // Cargar datos iniciales (encriptados)
    useEffect(() => {
        loadEncryptedData();
    }, [currentPage, pageSize]);

    // Cargar datos encriptados
    const loadEncryptedData = async () => {
        try {
            console.log('📊 Cargando datos encriptados...');
            
            const data = await getEncryptedData(
                connectionInfo.type,
                connectionInfo.config,
                auditTable.tableName,
                pageSize,
                (currentPage - 1) * pageSize
            );

            console.log('📨 Datos encriptados recibidos (RAW):', data);
            console.log('📨 Tipo de data:', typeof data);
            console.log('📨 Es data.data un array?:', Array.isArray(data?.data));
            console.log('📨 Contenido de data.data:', data?.data);

            if (data) {
                setAuditData(data);
                setTotal(data.totalRecords);
                setIsEncrypted(true);
                console.log('✅ Datos encriptados cargados correctamente');
            }
        } catch (error) {
            console.error('❌ Error cargando datos encriptados:', error);
            toast.error('Error cargando datos encriptados');
        }
    };

    // Cargar datos desencriptados
    const loadDecryptedData = async (key: string) => {
        try {
            console.log('🔓 Cargando datos desencriptados...');
            
            const data = await getDecryptedData(
                connectionInfo.type,
                connectionInfo.config,
                auditTable.tableName,
                key,
                pageSize,
                (currentPage - 1) * pageSize
            );

            console.log('📨 Datos desencriptados recibidos:', data);

            if (data) {
                setAuditData(data);
                setTotal(data.totalRecords);
                setIsEncrypted(false);
                setEncryptionKey(key);
                setShowDecryptModal(false);
                toast.success('Datos desencriptados exitosamente');
                console.log('✅ Datos desencriptados cargados correctamente');
            }
        } catch (error) {
            console.error('❌ Error desencriptando datos:', error);
            toast.error('Error desencriptando datos - Verifica tu clave');
        }
    };

    // Manejar desencriptación
    const handleDecrypt = async (key: string) => {
        try {
            console.log('🔑 Validando contraseña...');
            
            // Validar contraseña primero
            const validation = await validatePassword(
                connectionInfo.type,
                connectionInfo.config,
                auditTable.tableName,
                key
            );

            console.log('📨 Resultado de validación:', validation);

            if (validation?.valid) {
                await loadDecryptedData(key);
            } else {
                toast.error('Clave de encriptación incorrecta');
            }
        } catch (error) {
            console.error('❌ Error en handleDecrypt:', error);
            toast.error('Error validando contraseña');
        }
    };

    // Volver a encriptar vista
    const handleEncrypt = () => {
        setEncryptionKey('');
        setIsEncrypted(true);
        loadEncryptedData();
    };

    // Filtrar datos
    // const filteredData = auditData?.data.filter(record => {
    //     if (!isEncrypted && searchTerm) {
    //         const searchLower = searchTerm.toLowerCase();
    //         return Object.values(record).some(value =>
    //             value?.toString().toLowerCase().includes(searchLower)
    //         );
    //     }
    //     if (!isEncrypted && actionFilter !== 'all') {
    //         return record.accion_sql === actionFilter;
    //     }
    //     return true;
    // }) || [];
    const filteredData = React.useMemo(() => {
        // CORREGIR: Verificar que auditData y auditData.data existen y es un array
        if (!auditData || !auditData.data || !Array.isArray(auditData.data)) {
            console.warn('⚠️ auditData.data no es un array válido:', auditData);
            return [];
        }

        return auditData.data.filter(record => {
            if (!isEncrypted && searchTerm) {
                const searchLower = searchTerm.toLowerCase();
                return Object.values(record).some(value =>
                    value?.toString().toLowerCase().includes(searchLower)
                );
            }
            if (!isEncrypted && actionFilter !== 'all') {
                return record.accion_sql === actionFilter;
            }
            return true;
        });
    }, [auditData, isEncrypted, searchTerm, actionFilter]);

    // CORREGIR: También agregar verificación en el conteo de total
    const safeTotal = auditData?.totalRecords || 0;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-4">
                        <button
                            onClick={onBack}
                            className="p-2 text-gray-400 hover:text-gray-600 rounded-md"
                            title="Volver a la lista de tablas"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>

                        <div>
                            <h2 className="text-2xl font-bold text-gray-900 flex items-center">
                                <Lock className="w-6 h-6 mr-3 text-red-600" />
                                {auditTable.tableName}
                            </h2>
                            <p className="text-gray-600">
                                Tabla original: <span className="font-medium">{auditTable.originalTable}</span> •
                                Estado: <span className={`font-medium ${isEncrypted ? 'text-red-600' : 'text-green-600'}`}>
                                    {isEncrypted ? 'Encriptado' : 'Desencriptado'}
                                </span>
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center space-x-2">
                        {isEncrypted ? (
                            <button
                                onClick={() => setShowDecryptModal(true)}
                                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                            >
                                <Eye className="w-4 h-4 mr-2" />
                                Desencriptar
                            </button>
                        ) : (
                            <button
                                onClick={handleEncrypt}
                                className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                            >
                                <EyeOff className="w-4 h-4 mr-2" />
                                Encriptar Vista
                            </button>
                        )}

                        <button
                            onClick={() => isEncrypted ? loadEncryptedData() : loadDecryptedData(encryptionKey)}
                            disabled={encryptedLoading || decryptedLoading}
                            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 mr-2 ${(encryptedLoading || decryptedLoading) ? 'animate-spin' : ''}`} />
                            Actualizar
                        </button>
                    </div>
                </div>

                {/* Estadísticas */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-blue-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-blue-600 text-sm font-medium">Total Registros</p>
                                <p className="text-2xl font-bold text-blue-900">{total}</p>
                            </div>
                            <Activity className="w-8 h-8 text-blue-500" />
                        </div>
                    </div>

                    <div className="bg-green-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-green-600 text-sm font-medium">Página Actual</p>
                                <p className="text-2xl font-bold text-green-900">{currentPage}</p>
                            </div>
                            <Calendar className="w-8 h-8 text-green-500" />
                        </div>
                    </div>

                    <div className="bg-purple-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-purple-600 text-sm font-medium">Por Página</p>
                                <p className="text-2xl font-bold text-purple-900">{pageSize}</p>
                            </div>
                            <Filter className="w-8 h-8 text-purple-500" />
                        </div>
                    </div>

                    <div className={`p-4 rounded-lg ${isEncrypted ? 'bg-red-50' : 'bg-green-50'}`}>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className={`text-sm font-medium ${isEncrypted ? 'text-red-600' : 'text-green-600'}`}>
                                    Encriptación
                                </p>
                                <p className={`text-2xl font-bold ${isEncrypted ? 'text-red-900' : 'text-green-900'}`}>
                                    {isEncrypted ? 'SÍ' : 'NO'}
                                </p>
                            </div>
                            {isEncrypted ? (
                                <Lock className="w-8 h-8 text-red-500" />
                            ) : (
                                <Unlock className="w-8 h-8 text-green-500" />
                            )}
                        </div>
                    </div>
                </div>

                {/* Controles */}
                {!isEncrypted && (
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <input
                                type="text"
                                placeholder="Buscar en los datos..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>

                        <select
                            value={actionFilter}
                            onChange={(e) => setActionFilter(e.target.value as any)}
                            className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="all">Todas las acciones</option>
                            <option value="INSERT">INSERT</option>
                            <option value="UPDATE">UPDATE</option>
                            <option value="DELETE">DELETE</option>
                        </select>

                        <select
                            value={pageSize}
                            onChange={(e) => changePageSize(parseInt(e.target.value))}
                            className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="25">25 por página</option>
                            <option value="50">50 por página</option>
                            <option value="100">100 por página</option>
                        </select>
                    </div>
                )}
            </div>

            {/* Tabla de datos */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
                
                {encryptedLoading || decryptedLoading ? (
                    <div className="flex justify-center items-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                        <span className="ml-2 text-gray-600">
                            Cargando {isEncrypted ? 'datos encriptados' : 'datos desencriptados'}...
                        </span>
                    </div>
                ) : !auditData || !Array.isArray(auditData.data) || filteredData.length === 0 ? (
                    <div className="text-center py-12">
                        <AlertTriangle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                            No hay datos disponibles
                        </h3>
                        <p className="text-gray-500">
                            {!auditData || !Array.isArray(auditData.data) 
                                ? 'Error en la estructura de datos recibidos'
                                : isEncrypted 
                                    ? 'Desencripta los datos para ver el contenido'
                                    : 'No se encontraron registros con los filtros aplicados'
                            }
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    {auditData.columns?.map((column, index) => (
                                        <th
                                            key={index}
                                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                        >
                                            {column.name}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {filteredData.map((row, index) => (
                                    <tr key={index} className="hover:bg-gray-50">
                                        {auditData.columns?.map((column, colIndex) => (
                                            <td
                                                key={colIndex}
                                                className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                                            >
                                                {row[column.name] || '-'}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Paginación */}
                {auditData && auditData.totalRecords > pageSize && (
                    <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
                        <div className="flex-1 flex justify-between sm:hidden">
                            <button
                                onClick={() => goToPage(currentPage - 1)}
                                disabled={currentPage === 1}
                                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                            >
                                Anterior
                            </button>
                            <button
                                onClick={() => goToPage(currentPage + 1)}
                                disabled={currentPage * pageSize >= total}
                                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                            >
                                Siguiente
                            </button>
                        </div>
                        <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm text-gray-700">
                                    Mostrando <span className="font-medium">{((currentPage - 1) * pageSize) + 1}</span> a{' '}
                                    <span className="font-medium">
                                        {Math.min(currentPage * pageSize, total)}
                                    </span> de{' '}
                                    <span className="font-medium">{total}</span> resultados
                                </p>
                            </div>
                            <div>
                                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                                    <button
                                        onClick={() => goToPage(currentPage - 1)}
                                        disabled={currentPage === 1}
                                        className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        <ChevronLeft className="h-5 w-5" />
                                    </button>
                                    
                                    <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                                        Página {currentPage} de {Math.ceil(total / pageSize)}
                                    </span>
                                    
                                    <button
                                        onClick={() => goToPage(currentPage + 1)}
                                        disabled={currentPage * pageSize >= total}
                                        className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        <ChevronRight className="h-5 w-5" />
                                    </button>
                                </nav>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Modal de desencriptación */}
            <DecryptModal
                isOpen={showDecryptModal}
                onClose={() => setShowDecryptModal(false)}
                onDecrypt={handleDecrypt}
                loading={validateLoading || decryptedLoading}
                tableName={auditTable.tableName}
            />
        </div>
    );
};

export default AuditTableViewer;