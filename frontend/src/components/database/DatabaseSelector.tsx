import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import {
    Database,
    Server,
    Wifi,
    TestTube,
    CheckCircle,
    XCircle,
    AlertCircle,
    Loader2,
    Eye,
    EyeOff,
    Key,
    Globe
} from 'lucide-react';
import { useFormValidation } from '../../hooks/useApi';
import apiService from '../../services/api';
import { DatabaseType, DatabaseConfig } from '../../types';

interface DatabaseSelectorProps {
    onConnect: (type: DatabaseType, config: DatabaseConfig) => void;
    loading: boolean;
}

const DatabaseSelector: React.FC<DatabaseSelectorProps> = ({ onConnect, loading }) => {
    const [selectedType, setSelectedType] = useState<DatabaseType>('postgresql');
    const [testingConnection, setTestingConnection] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [testResult, setTestResult] = useState<{success: boolean; message: string} | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    // Configuración inicial del formulario
    const initialValues: DatabaseConfig = {
        host: 'localhost',
        user: 'postgres',
        password: '',
        database: '',
        port: selectedType === 'mysql' ? 3306 : 5432,
        schema: 'public' // Solo para PostgreSQL
    };

    // Reglas de validación
    const validationRules = {
        host: (value: string) => !value ? 'El host es requerido' : null,
        user: (value: string) => !value ? 'El usuario es requerido' : null,
        password: (value: string) => !value ? 'La contraseña es requerida' : null,
        database: (value: string) => !value ? 'La base de datos es requerida' : null,
        port: (value: number) => {
            if (!value) return 'El puerto es requerido';
            if (value < 1 || value > 65535) return 'Puerto debe estar entre 1 y 65535';
            return null;
        },
        schema: (value: string) => selectedType === 'postgresql' && !value ? 'El esquema es requerido' : null
    };

    const { values, errors, setValue, validate, hasErrors, resetForm } = useFormValidation(
        initialValues,
        validationRules
    );

    // Actualizar puerto cuando cambia el tipo
    useEffect(() => {
        setValue('port', selectedType === 'mysql' ? 3306 : 5432);
        if (selectedType === 'mysql') {
            setValue('user', 'root');
            setValue('schema', '');
        } else {
            setValue('user', 'postgres');
            setValue('schema', 'public');
        }
    }, [selectedType, setValue]);

    // Manejar cambio de tipo de base de datos
    const handleTypeChange = (type: DatabaseType) => {
        setSelectedType(type);
        setConnectionStatus('idle');
        setTestResult(null);
    };

    // Probar conexión - CORREGIDO
    const handleTestConnection = async () => {
        if (!validate()) {
            toast.error('Por favor corrige los errores en el formulario');
            return;
        }

        setTestingConnection(true);
        setConnectionStatus('idle');
        setTestResult(null);

        try {
            const config: DatabaseConfig = {
                host: values.host,
                user: values.user,
                password: values.password,
                database: values.database,
                port: values.port,
                ...(selectedType === 'postgresql' && { schema: values.schema })
            };

            console.log('🔍 Probando conexión con config:', config);

            // Usar apiService para probar conexión
            const result = await apiService.testConnection(selectedType, config);
            
            console.log('📨 Resultado de conexión:', result);
            
            // CORREGIR: El backend devuelve directamente la respuesta, no dentro de data
            if (result && result.success) {
                setConnectionStatus('success');
                setTestResult({ success: true, message: result.message });
                toast.success('Conexión exitosa');
            } else {
                setConnectionStatus('error');
                setTestResult({ success: false, message: result?.message || 'Error de conexión' });
                toast.error('Error de conexión: ' + (result?.message || 'Error desconocido'));
            }
        } catch (error) {
            console.error('❌ Error en handleTestConnection:', error);
            setConnectionStatus('error');
            const errorMessage = error instanceof Error ? error.message : 'Error de conexión';
            setTestResult({ success: false, message: errorMessage });
            toast.error('Error de conexión: ' + errorMessage);
        } finally {
            setTestingConnection(false);
        }
    };

    // Conectar - CORREGIDO
    const handleConnect = async () => {
        if (!validate()) {
            toast.error('Por favor corrige los errores en el formulario');
            return;
        }

        const config: DatabaseConfig = {
            host: values.host,
            user: values.user,
            password: values.password,
            database: values.database,
            port: values.port,
            ...(selectedType === 'postgresql' && { schema: values.schema })
        };

        // Probar conexión antes de conectar
        try {
            const result = await apiService.testConnection(selectedType, config);
            if (result && result.success) {
                onConnect(selectedType, config);
            } else {
                toast.error('Error de conexión: ' + (result?.message || 'No se pudo conectar'));
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Error de conexión';
            toast.error('Error de conexión: ' + errorMessage);
        }
    };

    // Tipos de base de datos disponibles
    const databaseTypes = [
        {
            type: 'postgresql' as DatabaseType,
            name: 'PostgreSQL',
            description: 'Base de datos PostgreSQL',
            icon: Database,
            defaultPort: 5432,
            color: 'bg-blue-500'
        },
        {
            type: 'mysql' as DatabaseType,
            name: 'MySQL',
            description: 'Base de datos MySQL/MariaDB',
            icon: Database,
            defaultPort: 3306,
            color: 'bg-orange-500'
        }
    ];

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div className="text-center">
                <Wifi className="w-12 h-12 text-indigo-600 mx-auto mb-4" />
                <h2 className="text-3xl font-bold text-gray-900 mb-2">
                    Conectar a Base de Datos
                </h2>
                <p className="text-gray-600">
                    Selecciona el tipo de base de datos y configura la conexión
                </p>
            </div>

            {/* Selector de tipo de base de datos */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {databaseTypes.map((dbType) => {
                    const Icon = dbType.icon;
                    const isSelected = selectedType === dbType.type;

                    return (
                        <div
                            key={dbType.type}
                            className={`relative p-6 border-2 rounded-lg cursor-pointer transition-all ${
                                isSelected
                                    ? 'border-indigo-500 bg-indigo-50'
                                    : 'border-gray-200 hover:border-gray-300'
                            } ${loading ? 'pointer-events-none opacity-50' : ''}`}
                            onClick={() => !loading && handleTypeChange(dbType.type)}
                        >
                            <div className="flex items-center space-x-3">
                                <div className={`p-2 rounded-lg ${
                                    isSelected ? 'bg-indigo-100' : 'bg-gray-100'
                                }`}>
                                    <Icon className={`w-6 h-6 ${
                                        isSelected ? 'text-indigo-600' : 'text-gray-600'
                                    }`} />
                                </div>
                                <div>
                                    <h4 className="font-semibold text-gray-800">{dbType.name}</h4>
                                    <p className="text-sm text-gray-600">{dbType.description}</p>
                                </div>
                            </div>

                            {isSelected && (
                                <div className="absolute top-2 right-2">
                                    <div className={`w-3 h-3 rounded-full ${dbType.color}`}></div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Formulario de configuración */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
                    <Server className="w-5 h-5 mr-2" />
                    Configuración de Conexión - {selectedType.toUpperCase()}
                </h3>

                <form className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Host */}
                    <div>
                        <label className="label">
                            <Globe className="w-4 h-4 inline mr-2" />
                            Host / Servidor
                        </label>
                        <input
                            type="text"
                            value={values.host}
                            onChange={(e) => setValue('host', e.target.value)}
                            disabled={loading}
                            className={`input ${errors.host ? 'input-error' : ''}`}
                            placeholder="localhost"
                        />
                        {errors.host && (
                            <p className="text-red-500 text-sm mt-1">{errors.host}</p>
                        )}
                    </div>

                    {/* Puerto */}
                    <div>
                        <label className="label">Puerto</label>
                        <input
                            type="number"
                            value={values.port}
                            onChange={(e) => setValue('port', parseInt(e.target.value) || 0)}
                            disabled={loading}
                            className={`input ${errors.port ? 'input-error' : ''}`}
                            placeholder={selectedType === 'mysql' ? '3306' : '5432'}
                        />
                        {errors.port && (
                            <p className="text-red-500 text-sm mt-1">{errors.port}</p>
                        )}
                    </div>

                    {/* Usuario */}
                    <div>
                        <label className="label">Usuario</label>
                        <input
                            type="text"
                            value={values.user}
                            onChange={(e) => setValue('user', e.target.value)}
                            disabled={loading}
                            className={`input ${errors.user ? 'input-error' : ''}`}
                            placeholder={selectedType === 'mysql' ? 'root' : 'postgres'}
                        />
                        {errors.user && (
                            <p className="text-red-500 text-sm mt-1">{errors.user}</p>
                        )}
                    </div>

                    {/* Contraseña */}
                    <div>
                        <label className="label">Contraseña</label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={values.password}
                                onChange={(e) => setValue('password', e.target.value)}
                                disabled={loading}
                                className={`input pr-10 ${errors.password ? 'input-error' : ''}`}
                                placeholder="••••••••"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                            >
                                {showPassword ? (
                                    <EyeOff className="h-4 w-4 text-gray-400" />
                                ) : (
                                    <Eye className="h-4 w-4 text-gray-400" />
                                )}
                            </button>
                        </div>
                        {errors.password && (
                            <p className="text-red-500 text-sm mt-1">{errors.password}</p>
                        )}
                    </div>

                    {/* Base de Datos */}
                    <div>
                        <label className="label">Nombre de la Base de Datos</label>
                        <input
                            type="text"
                            value={values.database}
                            onChange={(e) => setValue('database', e.target.value)}
                            disabled={loading}
                            className={`input ${errors.database ? 'input-error' : ''}`}
                            placeholder="mi_base_datos"
                        />
                        {errors.database && (
                            <p className="text-red-500 text-sm mt-1">{errors.database}</p>
                        )}
                    </div>

                    {/* Esquema (solo PostgreSQL) */}
                    {selectedType === 'postgresql' && (
                        <div>
                            <label className="label">
                                Esquema
                                <span className="text-xs text-gray-500 ml-2">(Opcional - por defecto: public)</span>
                            </label>
                            <input
                                type="text"
                                value={values.schema}
                                onChange={(e) => setValue('schema', e.target.value)}
                                disabled={loading}
                                className={`input ${errors.schema ? 'input-error' : ''}`}
                                placeholder="public"
                            />
                            {errors.schema && (
                                <p className="text-red-500 text-sm mt-1">{errors.schema}</p>
                            )}
                        </div>
                    )}
                </form>

                {/* Resultado de prueba */}
                {testResult && (
                    <div className={`mt-6 p-4 rounded-lg flex items-center gap-3 ${
                        testResult.success
                            ? 'bg-green-50 border border-green-200'
                            : 'bg-red-50 border border-red-200'
                    }`}>
                        {testResult.success ? (
                            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        ) : (
                            <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                        )}
                        <div>
                            <p className={`font-medium ${
                                testResult.success ? 'text-green-800' : 'text-red-800'
                            }`}>
                                {testResult.success ? '✅ ¡Conexión Exitosa!' : '❌ Error de Conexión'}
                            </p>
                            <p className={`text-sm ${
                                testResult.success ? 'text-green-700' : 'text-red-700'
                            }`}>
                                {testResult.message}
                            </p>
                        </div>
                    </div>
                )}

                {/* Botones de acción */}
                <div className="mt-6 flex flex-col sm:flex-row gap-4">
                    <button
                        onClick={handleTestConnection}
                        disabled={testingConnection || loading || hasErrors}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                        {testingConnection ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Probando...
                            </>
                        ) : (
                            <>
                                <TestTube className="w-4 h-4" />
                                Probar Conexión
                            </>
                        )}
                    </button>

                    <button
                        onClick={handleConnect}
                        disabled={loading || hasErrors || connectionStatus !== 'success'}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Conectando...
                            </>
                        ) : (
                            <>
                                <Wifi className="w-4 h-4" />
                                Conectar
                            </>
                        )}
                    </button>
                </div>

                {/* Información adicional sobre esquemas */}
                {selectedType === 'postgresql' && (
                    <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                        <h5 className="font-medium text-blue-800 mb-2">
                            <Key className="w-4 h-4 inline mr-2" />
                            Información sobre Esquemas en PostgreSQL:
                        </h5>
                        <ul className="text-sm text-blue-700 space-y-1">
                            <li>• <strong>public:</strong> Esquema por defecto en PostgreSQL</li>
                            <li>• Los esquemas organizan las tablas en grupos lógicos</li>
                            <li>• Si no estás seguro, deja "public"</li>
                            <li>• Puedes verificar esquemas disponibles después de conectar</li>
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DatabaseSelector;