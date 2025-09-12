import React, { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { debugApiService } from './utils/debug';
import {
    Shield,
    Database,
    Settings,
    Eye,
    CheckCircle,
    AlertCircle,
    Loader2
} from 'lucide-react';

// Importar hooks y servicios - CORREGIDO
import { useApi, useLocalStorage } from './hooks/useApi';
import apiService from './services/api';

// Importar tipos
import {
    DatabaseType,
    DatabaseConfig,
    ConnectionInfo,
    TableInfo,
    AuditTable
} from './types';

// Importar componentes
import Layout from './components/common/Layout';
import Header from './components/common/Header';
import DatabaseSelector from './components/database/DatabaseSelector';
import TableList from './components/tables/TableList';
import AuditTableList from './components/audit/AuditTableList';
import AuditTableViewer from './components/audit/AuditTableViewer';

function App() {
    // Al inicio del componente, agregar debug
    React.useEffect(() => {
        debugApiService();
    }, []);

    // Al inicio del componente App, ANTES de usar useApi
    React.useEffect(() => {
        console.log('🔍 Verificando ApiService en App...');
        const debug = debugApiService();

        // Verificar que está inicializado
        if (!debug || !debug.isInitialized()) {
            console.error('💥 ApiService no está inicializado correctamente');
            try {
                debug?.reinitialize();
            } catch (error) {
                console.error('💥 Error reinicializando:', error);
            }
        }
    }, []);

    // Estados principales
    const [activeTab, setActiveTab] = useState<'database' | 'tables' | 'audit' | 'viewer'>('database');
    const [connectionInfo, setConnectionInfo] = useLocalStorage<ConnectionInfo | null>('connectionInfo', null);
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [selectedAuditTable, setSelectedAuditTable] = useState<AuditTable | null>(null);

    // Estados de datos
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [auditTables, setAuditTables] = useState<AuditTable[]>([]);

    // API hooks - CORREGIDOS con verificación más robusta
    const { execute: testConnection, loading: connectionLoading } = useApi(
        (...args: [DatabaseType, DatabaseConfig]) => {
            console.log('🔍 Llamando a apiService.testConnection');
            if (!apiService || !apiService.isInitialized()) {
                console.error('💥 ApiService no está disponible o no está inicializado');
                throw new Error('Servicio API no disponible');
            }
            if (typeof apiService.testConnection !== 'function') {
                throw new Error('Método testConnection no está disponible');
            }
            return apiService.testConnection(...args);
        }
    );

    const { execute: getTables, loading: tablesLoading } = useApi(
        (type: DatabaseType, config: DatabaseConfig) => {
            if (!apiService || !apiService.getTables) {
                throw new Error('ApiService o getTables no está disponible');
            }
            return apiService.getTables(type, config);
        },
        false
    );

    const { execute: getAuditTables, loading: auditTablesLoading } = useApi(
        (...args: [DatabaseType, DatabaseConfig]) => {
            if (!apiService || !apiService.getAuditTables) {
                throw new Error('ApiService o getAuditTables no está disponible');
            }
            return apiService.getAuditTables(...args);
        },
        false
    );

    // Manejar conexión a base de datos - CORREGIDO
    const handleConnect = async (type: DatabaseType, config: DatabaseConfig) => {
        console.log('🔗 Iniciando conexión:', { type, config });
        console.log('🔍 ApiService disponible:', !!apiService);
        console.log('🔍 testConnection disponible:', !!apiService?.testConnection);

        try {
            const result = await testConnection(type, config);
            console.log('📨 Resultado de testConnection:', result);

            if (result && result.success) {
                const newConnectionInfo: ConnectionInfo = {
                    type,
                    config,
                    isConnected: true,
                    version: result.connectionInfo?.version,
                    currentDatabase: result.connectionInfo?.database || config.database
                };

                console.log('✅ Configurando connectionInfo:', newConnectionInfo);
                setConnectionInfo(newConnectionInfo);
                setActiveTab('tables');

                // Cargar datos iniciales
                await loadInitialData(type, config);
            } else {
                console.error('❌ Conexión falló:', result);
            }
        } catch (error) {
            console.error('❌ Error en handleConnect:', error);
        }
    };

    // Cargar datos iniciales - CORREGIDO
    const loadInitialData = async (type: DatabaseType, config: DatabaseConfig) => {
        try {
            console.log('📊 Cargando datos iniciales...');

            // Cargar tablas
            const tablesResult = await getTables(type, config);
            console.log('📋 Resultado de getTables:', tablesResult);

            if (tablesResult && tablesResult.data) {
                setTables(tablesResult.data);
            }

            // Cargar tablas de auditoría - CON MÁS LOGGING
            console.log('🔒 Cargando tablas de auditoría...');
            const auditResult = await getAuditTables(type, config);
            console.log('🔒 Resultado COMPLETO de getAuditTables:', auditResult);

            if (auditResult) {
                console.log('🔒 auditTables en resultado:', auditResult.auditTables);
                console.log('🔒 Longitud de auditTables:', auditResult.auditTables?.length);

                if (auditResult.auditTables && Array.isArray(auditResult.auditTables)) {
                    setAuditTables(auditResult.auditTables);
                    console.log('✅ auditTables establecidas:', auditResult.auditTables);
                } else {
                    console.warn('⚠️ auditTables no es un array válido:', auditResult.auditTables);
                    setAuditTables([]);
                }
            } else {
                console.warn('⚠️ auditResult es null/undefined');
                setAuditTables([]);
            }
        } catch (error) {
            console.error('❌ Error cargando datos iniciales:', error);
            setAuditTables([]); // Asegurar que se inicialice
        }
    };

    // Desconectar
    const handleDisconnect = () => {
        setConnectionInfo(null);
        setTables([]);
        setAuditTables([]);
        setSelectedTable(null);
        setSelectedAuditTable(null);
        setActiveTab('database');
    };

    // Refrescar datos
    const refreshData = () => {
        if (connectionInfo?.isConnected) {
            loadInitialData(connectionInfo.type, connectionInfo.config);
        }
    };

    // Manejar actualización después de configurar auditoría
    const handleAuditSetupComplete = () => {
        refreshData();
        setActiveTab('audit');
    };

    // Manejar selección de tabla de auditoría para visualizar
    const handleViewAuditTable = (auditTable: AuditTable) => {
        setSelectedAuditTable(auditTable);
        setActiveTab('viewer');
    };

    // Renderizar contenido de la pestaña activa
    const renderActiveTab = () => {
        if (!connectionInfo?.isConnected) {
            return (
                <DatabaseSelector
                    onConnect={handleConnect}
                    loading={connectionLoading}
                />
            );
        }

        switch (activeTab) {
            case 'tables':
                return (
                    <TableList
                        tables={tables}
                        loading={tablesLoading}
                        connectionInfo={connectionInfo}
                        onRefresh={refreshData}
                        onAuditSetupComplete={handleAuditSetupComplete}
                        onViewAuditTable={handleViewAuditTable}
                    />
                );

            case 'audit':
                return (
                    <AuditTableList
                        auditTables={auditTables}
                        loading={auditTablesLoading}
                        connectionInfo={connectionInfo}
                        onRefresh={refreshData}
                        onViewTable={handleViewAuditTable}
                    />
                );

            case 'viewer':
                return selectedAuditTable ? (
                    <AuditTableViewer
                        auditTable={selectedAuditTable}
                        connectionInfo={connectionInfo}
                        onBack={() => setActiveTab('audit')}
                    />
                ) : (
                    <div className="text-center text-gray-500 py-8">
                        Seleccione una tabla de auditoría para visualizar
                    </div>
                );


            default:
                return (
                    <DatabaseSelector
                        onConnect={handleConnect}
                        loading={connectionLoading}
                    />
                );
        }
    };

    // Tabs de navegación
    const navigationTabs = [
        {
            id: 'database' as const,
            name: 'Base de Datos',
            icon: Database,
            disabled: false,
        },
        {
            id: 'tables' as const,
            name: 'Tablas',
            icon: Settings,
            disabled: !connectionInfo?.isConnected,
        },
        {
            id: 'audit' as const,
            name: 'Auditoría',
            icon: Shield,
            disabled: !connectionInfo?.isConnected,
        },
        {
            id: 'viewer' as const,
            name: 'Visualizador',
            icon: Eye,
            disabled: !connectionInfo?.isConnected || !selectedAuditTable,
        },
    ];

    return (
        <Layout>
            <Header
                connectionInfo={connectionInfo}
                onDisconnect={handleDisconnect}
            />
            <div className="min-h-screen bg-gray-50">
                {/* Header */}
                <header className="bg-white shadow-sm border-b">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="flex justify-between items-center py-4">
                            <div className="flex items-center space-x-3">
                                <Shield className="w-8 h-8 text-indigo-600" />
                                <div>
                                    <h1 className="text-2xl font-bold text-gray-900">
                                        Sistema de Auditoría Encriptada
                                    </h1>
                                    <p className="text-sm text-gray-500">
                                        Gestión de auditoría con encriptación a nivel de base de datos
                                    </p>
                                </div>
                            </div>

                            {/* Estado de conexión */}
                            <div className="flex items-center space-x-4">
                                {connectionInfo?.isConnected ? (
                                    <div className="flex items-center space-x-3 text-sm">
                                        <div className="flex items-center space-x-1">
                                            <CheckCircle className="w-4 h-4 text-green-500" />
                                            <span className="font-medium text-gray-700">Conectado</span>
                                        </div>
                                        <div className="text-gray-500">
                                            {connectionInfo.type.toUpperCase()} • {connectionInfo.currentDatabase}
                                        </div>
                                        <button
                                            onClick={handleDisconnect}
                                            className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded-md hover:bg-red-200"
                                        >
                                            Desconectar
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center space-x-2 text-sm text-gray-500">
                                        <AlertCircle className="w-4 h-4" />
                                        <span>No conectado</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Navegación por pestañas */}
                        <nav className="flex space-x-8 -mb-px">
                            {navigationTabs.map((tab) => {
                                const Icon = tab.icon;
                                const isActive = activeTab === tab.id;
                                const isDisabled = tab.disabled;

                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => !isDisabled && setActiveTab(tab.id)}
                                        disabled={isDisabled}
                                        className={`
                                            flex items-center px-4 py-3 text-sm font-medium border-b-2 transition-colors
                                            ${isActive
                                                ? 'border-indigo-500 text-indigo-600 bg-indigo-50'
                                                : isDisabled
                                                    ? 'border-transparent text-gray-400 cursor-not-allowed'
                                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                            }
                                        `}
                                    >
                                        <Icon className="w-4 h-4 mr-2" />
                                        {tab.name}
                                        {tab.id === 'audit' && auditTables.length > 0 && (
                                            <span className="bg-indigo-100 text-indigo-600 text-xs px-2 py-1 rounded-full ml-2">
                                                {auditTables.length}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </nav>
                    </div>
                </header>

                {/* Contenido principal */}
                <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    {renderActiveTab()}
                </main>

                {/* Footer */}
                <footer className="bg-white border-t mt-16">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                        <div className="flex justify-between items-center text-sm text-gray-500">
                            <div>
                                Sistema de Auditoría v1.0.0 - Encriptación a nivel de base de datos
                            </div>
                            <div className="flex items-center space-x-4">
                                {connectionInfo?.isConnected && (
                                    <div className="text-green-600">
                                        ● {connectionInfo.type.toUpperCase()} conectado
                                    </div>
                                )}
                                <div>
                                    Soporte: MySQL, PostgreSQL
                                </div>
                            </div>
                        </div>
                    </div>
                </footer>

                {/* Notificaciones Toast */}
                <Toaster
                    position="top-right"
                    toastOptions={{
                        duration: 4000,
                        style: {
                            background: '#363636',
                            color: '#fff',
                        },
                        success: {
                            duration: 3000,
                            iconTheme: {
                                primary: '#10b981',
                                secondary: '#fff',
                            },
                        },
                        error: {
                            duration: 5000,
                            iconTheme: {
                                primary: '#ef4444',
                                secondary: '#fff',
                            },
                        },
                    }}
                />
            </div>
        </Layout>
    );
}

export default App;