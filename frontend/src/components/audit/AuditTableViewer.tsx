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
    ChevronRight,
    Database,
    BarChart3
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


    // ✅ NUEVO: Estado para información de tabla actualizada
    const [currentTableInfo, setCurrentTableInfo] = useState<AuditTable>(auditTable);


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
            console.log('📋 originalTableName en respuesta:', data?.originalTableName);

            if (data) {
                setAuditData(data);
                setTotal(data.totalRecords);
                setIsEncrypted(false);
                setEncryptionKey(key);
                setShowDecryptModal(false);

                // ✅ CRÍTICO: Actualizar información de tabla con nombre original
                if (data.originalTableName) {
                    console.log('🔄 Actualizando información de tabla con:', data.originalTableName);

                    setCurrentTableInfo(prev => ({
                        ...prev,
                        originalTable: data.originalTableName!, // ✅ USAR el operador !
                        displayName: data.originalTableName,
                        isDecrypted: true
                    }));

                    console.log('✅ Tabla original actualizada a:', data.originalTableName);
                } else {
                    console.warn('⚠️ No se recibió originalTableName en la respuesta');
                    
                    // ✅ FALLBACK: Intentar obtener desde los logs o usar nombre por defecto
                    setCurrentTableInfo(prev => ({
                        ...prev,
                        originalTable: 'Tabla Desencriptada',
                        displayName: 'Tabla Desencriptada',
                        isDecrypted: true
                    }));
                }

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
            const validation = await validatePassword(
                connectionInfo.type,
                connectionInfo.config,
                auditTable.tableName,
                key
            );
            console.log('📨 Resultado de validación:', validation);

            // Aceptar ambas estructuras: {valid,...} o {data:{valid,...}}
            const isValid = (validation && (validation as any).valid) ||
                (validation && (validation as any).data && (validation as any).data.valid);

            if (isValid) {
                await loadDecryptedData(key);
            } else {
                toast.error('Clave de encriptación incorrecta');
            }
        } catch (error) {
            console.error('❌ Error en handleDecrypt:', error);
            toast.error('Error validando contraseña');
        }
    };

   
    // ✅ TAMBIÉN CORREGIR: Función para volver a vista encriptada
    const handleEncrypt = () => {
        setEncryptionKey('');
        setIsEncrypted(true);
        setCurrentTableInfo(auditTable); // Restaurar información original
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
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-4">
                        <button
                            onClick={onBack}
                            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Volver
                        </button>

                        <div>
                            <h2 className="text-2xl font-bold text-gray-900">
                                Auditoría: {auditTable.tableName}
                            </h2>
                            <div className="flex items-center space-x-4 mt-2">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isEncrypted
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-green-100 text-green-800'
                                    }`}>
                                    <Lock className="w-3 h-3 mr-1" />
                                    {isEncrypted ? 'Encriptado' : 'Desencriptado'}
                                </span>

                                {/* ✅ CORREGIR: Mostrar tabla original correcta */}
                                <span className="text-sm text-gray-600">
                                    Tabla Origen: <span className="font-medium text-indigo-600">
                                        {!isEncrypted && currentTableInfo.originalTable && currentTableInfo.originalTable !== 'ENCRYPTED_TABLE'
                                            ? currentTableInfo.originalTable
                                            : isEncrypted
                                                ? 'Tabla Encriptada'
                                                : 'Desconocida'
                                        }
                                    </span>
                                </span>

                                <span className="text-sm text-gray-600">
                                    Registros: <span className="font-medium">{safeTotal}</span>
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center space-x-3">
                        {/* Botón de desencriptar/encriptar */}
                        {isEncrypted ? (
                            <button
                                onClick={() => setShowDecryptModal(true)}
                                disabled={encryptedLoading}
                                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                            >
                                <Unlock className="w-4 h-4 mr-2" />
                                Desencriptar
                            </button>
                        ) : (
                            <button
                                onClick={handleEncrypt}
                                className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                            >
                                <Lock className="w-4 h-4 mr-2" />
                                Encriptar Vista
                            </button>
                        )}
                    </div>
                </div>

                {/* Información adicional */}
                <div className="bg-gray-50 rounded-lg p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div>
                            <span className="font-medium text-gray-700">Tipo de Vista:</span>
                            <span className={`ml-2 ${isEncrypted ? 'text-purple-600' : 'text-green-600'}`}>
                                {isEncrypted ? 'Datos Encriptados' : 'Datos Legibles'}
                            </span>
                        </div>
                        <div>
                            <span className="font-medium text-gray-700">Tabla Origen:</span>
                            <span className="ml-2 text-gray-900 font-medium">
                                {!isEncrypted && currentTableInfo.originalTable && currentTableInfo.originalTable !== 'ENCRYPTED_TABLE'
                                    ? currentTableInfo.originalTable
                                    : currentTableInfo.originalTable === 'ENCRYPTED_TABLE'
                                        ? 'Tabla Encriptada'
                                        : currentTableInfo.originalTable || 'Desconocida'
                                }
                            </span>
                        </div>
                        <div>
                            <span className="font-medium text-gray-700">Identificador:</span>
                            <span className="ml-2 font-mono text-gray-600">
                                {auditTable.tableName}
                            </span>
                        </div>
                    </div>
                </div>
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
                                        title="Página Anterior"
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
                                        title="Página Siguiente"
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