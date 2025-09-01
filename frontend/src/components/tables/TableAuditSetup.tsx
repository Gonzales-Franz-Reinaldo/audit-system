import React, { useState, useEffect } from 'react';
import {
    Shield,
    Lock,
    Eye,
    EyeOff,
    CheckCircle,
    AlertTriangle,
    Loader2,
    X,
    Info
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { useApi } from '../../hooks/useApi';
import apiService from '../../services/api';
import { TableInfo, ConnectionInfo, ModalProps } from '../../types';

interface TableAuditSetupProps extends Omit<ModalProps, 'children'> {
    table: TableInfo;
    connectionInfo: ConnectionInfo;
    onComplete: () => void;
}

const TableAuditSetup: React.FC<TableAuditSetupProps> = ({
    isOpen,
    onClose,
    table,
    connectionInfo,
    onComplete
}) => {
    const [encryptionKey, setEncryptionKey] = useState('');
    const [confirmKey, setConfirmKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [step, setStep] = useState<'setup' | 'processing' | 'success' | 'error'>('setup');
    const [errorMessage, setErrorMessage] = useState('');

    // CORREGIR: Usar función flecha para mantener el contexto
    const { execute: setupAudit, loading } = useApi(
        async (type: string, config: any, tableName: string, encryptionKey: string) => {
            console.log('🚀 Ejecutando setupTableAudit con contexto correcto');
            console.log('📊 Parámetros:', { type, tableName, encryptionKey: !!encryptionKey });
            
            // CRUCIAL: Verificar que apiService esté disponible
            if (!apiService) {
                throw new Error('ApiService no está disponible');
            }
            
            if (typeof apiService.setupTableAudit !== 'function') {
                throw new Error('Método setupTableAudit no está disponible en apiService');
            }

            // Llamar al método con bind para asegurar el contexto
            return apiService.setupTableAudit.call(apiService, type, config, tableName, encryptionKey);
        },
        false // No mostrar toast automático
    );

    // Reset form when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setEncryptionKey('');
            setConfirmKey('');
            setStep('setup');
            setErrorMessage('');
            setShowKey(false);
        }
    }, [isOpen]);

    // Validations
    const isValidKey = encryptionKey.length >= 12;
    const keysMatch = encryptionKey === confirmKey;

    const checkKeyComplexity = (key: string) => {
        const checks = {
            length: key.length >= 12,
            hasUpper: /[A-Z]/.test(key),
            hasLower: /[a-z]/.test(key),
            hasNumber: /[0-9]/.test(key),
            hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(key)
        };
        
        const typesCount = [checks.hasUpper, checks.hasLower, checks.hasNumber, checks.hasSpecial]
            .filter(Boolean).length;
        
        return {
            ...checks,
            complexity: typesCount >= 2,
            isValid: checks.length && typesCount >= 2
        };
    };

    const keyComplexity = checkKeyComplexity(encryptionKey);
    const canProceed = keyComplexity.isValid && keysMatch && encryptionKey.length > 0;

    // Generate random key
    const generateRandomKey = () => {
        const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const lowercase = 'abcdefghijklmnopqrstuvwxyz';
        const numbers = '0123456789';
        const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
        
        let result = '';
        
        // Asegurar que tenga al menos 2 tipos diferentes
        result += uppercase[Math.floor(Math.random() * uppercase.length)];
        result += lowercase[Math.floor(Math.random() * lowercase.length)];
        result += numbers[Math.floor(Math.random() * numbers.length)];
        result += symbols[Math.floor(Math.random() * symbols.length)];
        
        // Completar hasta 16 caracteres con caracteres aleatorios
        const allChars = uppercase + lowercase + numbers + symbols;
        for (let i = result.length; i < 16; i++) {
            let char;
            do {
                char = allChars[Math.floor(Math.random() * allChars.length)];
                // Evitar más de 2 caracteres iguales consecutivos
            } while (result.length >= 2 && 
                    result[result.length - 1] === char && 
                    result[result.length - 2] === char);
            
            result += char;
        }
        
        // Mezclar los caracteres para evitar patrones
        result = result.split('').sort(() => Math.random() - 0.5).join('');
        
        setEncryptionKey(result);
        setConfirmKey(result);
    };

    // Handle setup - COMPLETAMENTE CORREGIDO
    const handleSetup = async () => {
        if (!canProceed) {
            console.warn('❌ No se puede proceder - validaciones fallaron');
            
            // Mostrar mensaje específico según el problema
            if (encryptionKey.length < 12) {
                toast.error('La clave debe tener al menos 12 caracteres');
            } else if (!keysMatch) {
                toast.error('Las claves no coinciden');
            }
            return;
        }

        console.log(`🔧 Iniciando configuración de auditoría para: ${table.name}`);
        console.log(`📊 Tipo: ${connectionInfo.type}`);
        console.log(`🔑 Clave longitud: ${encryptionKey.length} caracteres`);

        setStep('processing');

        try {
            // Log del intento
            console.log('🚀 Enviando petición de configuración...');
            console.log('🔍 ApiService disponible:', !!apiService);
            console.log('🔍 setupTableAudit disponible:', typeof apiService?.setupTableAudit);

            // IMPORTANTE: Verificar disponibilidad antes de ejecutar
            if (!apiService) {
                throw new Error('Servicio API no está disponible');
            }

            const result = await setupAudit(
                connectionInfo.type,
                connectionInfo.config,
                table.name,
                encryptionKey
            );

            console.log('📨 Resultado recibido:', result);

            // MEJORAR: Verificación más robusta del resultado
            if (result) {
                // Verificar diferentes estructuras de respuesta
                if (result.success === true) {
                    console.log('✅ Configuración exitosa (success: true)');
                    setStep('success');
                    toast.success('Auditoría configurada exitosamente');
                    
                    setTimeout(() => {
                        onComplete();
                        onClose();
                    }, 2000);
                    
                    return;
                } else if (result.success === false) {
                    console.error('❌ Configuración falló (success: false):', result);
                    throw new Error(result.error || result.message || 'Error en la configuración del servidor');
                } else if (!('success' in result)) {
                    // Si no tiene campo success, pero llegó aquí, asumir éxito
                    console.log('✅ Configuración exitosa (sin campo success)');
                    setStep('success');
                    toast.success('Auditoría configurada exitosamente');
                    
                    setTimeout(() => {
                        onComplete();
                        onClose();
                    }, 2000);
                    
                    return;
                }
            }

            // Si llegamos aquí, algo salió mal
            console.error('❌ Configuración falló - resultado inválido:', result);
            throw new Error('Respuesta inválida del servidor');

        } catch (error) {
            console.error('❌ Error en handleSetup:', error);

            let errorMessage = 'Error configurando auditoría';

            if (error instanceof Error) {
                errorMessage = error.message;
                
                // Manejar errores específicos de validación de clave
                if (errorMessage.includes('12 caracteres')) {
                    errorMessage = 'La clave debe tener al menos 12 caracteres. Usa el generador automático para crear una clave segura.';
                } else if (errorMessage.includes('complejidad')) {
                    errorMessage = 'La clave debe ser más compleja. Incluye mayúsculas, minúsculas, números y símbolos.';
                }
            } else if (typeof error === 'string') {
                errorMessage = error;
            } else if (error && typeof error === 'object') {
                if ('error' in error) {
                    errorMessage = (error as any).error;
                } else if ('message' in error) {
                    errorMessage = (error as any).message;
                }
            }

            console.error('📋 Error final:', errorMessage);

            setErrorMessage(errorMessage);
            setStep('error');
            toast.error(`Error: ${errorMessage}`);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                {/* Overlay */}
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

                {/* Modal */}
                <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
                    {/* Header */}
                    <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                        <div className="flex items-start justify-between">
                            <div className="flex items-start">
                                <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100 sm:mx-0 sm:h-10 sm:w-10">
                                    <Shield className="h-6 w-6 text-indigo-600" />
                                </div>
                                <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                                    <h3 className="text-lg leading-6 font-medium text-gray-900">
                                        Configurar Auditoría Encriptada
                                    </h3>
                                    <p className="text-sm text-gray-500 mt-1">
                                        Tabla: <span className="font-medium">{table.name}</span>
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={onClose}
                                disabled={step === 'processing'}
                                className="rounded-md text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                title="Cerrar modal"
                            >
                                <X className="h-6 w-6" />
                            </button>
                        </div>

                        {/* Content based on step */}
                        <div className="mt-6">
                            {step === 'setup' && (
                                <div className="space-y-6">
                                    {/* Information */}
                                    
                                    <div className="bg-blue-50 p-4 rounded-lg">
                                        <div className="flex">
                                            <Info className="h-5 w-5 text-blue-400 mt-0.5" />
                                            <div className="ml-3">
                                                <p className="text-sm text-blue-800">
                                                    <strong>¿Qué se creará?</strong> Se generará una tabla de auditoría 
                                                    <span className="font-mono">{`aud_${table.name}`}</span> con triggers automáticos 
                                                    que encriptan todos los cambios realizados en la tabla original.
                                                </p>
                                                <p className="text-xs text-blue-700 mt-2">
                                                    <strong>Requisitos de clave:</strong> Mínimo 12 caracteres con al menos 2 tipos: 
                                                    mayúsculas, minúsculas, números o símbolos especiales.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Encryption key setup */}
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                <Lock className="w-4 h-4 inline mr-2" />
                                                Clave de Encriptación
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type={showKey ? 'text' : 'password'}
                                                    value={encryptionKey}
                                                    onChange={(e) => setEncryptionKey(e.target.value)}
                                                    placeholder="Mínimo 12 caracteres"
                                                    className={`w-full px-3 py-2 pr-10 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                                        encryptionKey && !isValidKey ? 'border-red-500' : 'border-gray-300'
                                                    }`}
                                                    autoFocus
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowKey(!showKey)}
                                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                                                >
                                                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </button>
                                            </div>
                                            
                                            {/* Indicador de fortaleza de clave - NUEVO */}
                                            
                                            <div className="mt-2">
                                                <div className="flex items-center space-x-2 text-xs">
                                                    <span className={`px-2 py-1 rounded ${
                                                        keyComplexity.length ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                                    }`}>
                                                        Longitud: {encryptionKey.length}/12 {keyComplexity.length ? '✓' : '✗'}
                                                    </span>
                                                    <span className={`px-2 py-1 rounded ${
                                                        keyComplexity.hasUpper ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                                                    }`}>
                                                        Mayúsculas {keyComplexity.hasUpper ? '✓' : '○'}
                                                    </span>
                                                    <span className={`px-2 py-1 rounded ${
                                                        keyComplexity.hasLower ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                                                    }`}>
                                                        Minúsculas {keyComplexity.hasLower ? '✓' : '○'}
                                                    </span>
                                                    <span className={`px-2 py-1 rounded ${
                                                        keyComplexity.hasNumber ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                                                    }`}>
                                                        Números {keyComplexity.hasNumber ? '✓' : '○'}
                                                    </span>
                                                    <span className={`px-2 py-1 rounded ${
                                                        keyComplexity.hasSpecial ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                                                    }`}>
                                                        Símbolos {keyComplexity.hasSpecial ? '✓' : '○'}
                                                    </span>
                                                </div>
                                                
                                                <div className={`mt-1 text-xs ${
                                                    keyComplexity.complexity ? 'text-green-600' : 'text-orange-600'
                                                }`}>
                                                    {keyComplexity.complexity ? 
                                                        '✅ Complejidad suficiente (2+ tipos)' : 
                                                        '⚠️ Necesita al menos 2 tipos diferentes de caracteres'
                                                    }
                                                </div>
                                            </div>

                                            {encryptionKey && !keyComplexity.isValid && (
                                                <div className="text-red-600 text-xs mt-1 bg-red-50 p-2 rounded">
                                                    <AlertTriangle className="w-3 h-3 inline mr-1" />
                                                    {!keyComplexity.length && 'La clave debe tener al menos 12 caracteres. '}
                                                    {!keyComplexity.complexity && 'Debe incluir al menos 2 tipos: mayúsculas, minúsculas, números o símbolos.'}
                                                </div>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Confirmar Clave
                                            </label>
                                            <input
                                                type={showKey ? 'text' : 'password'}
                                                value={confirmKey}
                                                onChange={(e) => setConfirmKey(e.target.value)}
                                                placeholder="Confirma la clave de encriptación"
                                                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                                    confirmKey && !keysMatch ? 'border-red-500' : 'border-gray-300'
                                                }`}
                                            />
                                            {confirmKey && !keysMatch && (
                                                <p className="text-red-600 text-xs mt-1">
                                                    <AlertTriangle className="w-3 h-3 inline mr-1" />
                                                    Las claves no coinciden
                                                </p>
                                            )}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={generateRandomKey}
                                            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center"
                                        >
                                            🎲 Generar clave segura automáticamente (16 caracteres)
                                        </button>

                                        <div className="text-xs text-gray-500 mt-2">
                                            💡 <strong>Sugerencia:</strong> Usa frases como "MiHotel2024!" o genera una automáticamente.
                                            Evita secuencias obvias como "123456" o "abcdef".
                                        </div>
                                    </div>

                                    {/* Warning */}
                                    <div className="bg-yellow-50 p-4 rounded-lg">
                                        <div className="flex">
                                            <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5" />
                                            <div className="ml-3">
                                                <p className="text-sm text-yellow-800">
                                                    <strong>¡Importante!</strong> Guarda esta clave de forma segura. 
                                                    Sin ella no podrás desencriptar los datos de auditoría.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {step === 'processing' && (
                                <div className="text-center py-8">
                                    <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
                                    <h4 className="text-lg font-medium text-gray-900 mb-2">
                                        Configurando Auditoría...
                                    </h4>
                                    <p className="text-gray-500">
                                        Creando tabla de auditoría y triggers encriptados
                                    </p>
                                </div>
                            )}

                            {step === 'success' && (
                                <div className="text-center py-8">
                                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                                    <h4 className="text-lg font-medium text-gray-900 mb-2">
                                        ¡Auditoría Configurada!
                                    </h4>
                                    <p className="text-gray-500">
                                        La auditoría encriptada se configuró exitosamente para la tabla {table.name}
                                    </p>
                                </div>
                            )}

                            {step === 'error' && (
                                <div className="text-center py-8">
                                    <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                                    <h4 className="text-lg font-medium text-gray-900 mb-2">
                                        Error en Configuración
                                    </h4>
                                    <p className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
                                        {errorMessage}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                        {step === 'setup' && (
                            <>
                                <button
                                    type="button"
                                    onClick={handleSetup}
                                    disabled={!canProceed}
                                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Lock className="w-4 h-4 mr-2" />
                                    Configurar Auditoría
                                </button>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                >
                                    Cancelar
                                </button>
                            </>
                        )}

                        {step === 'error' && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setStep('setup')}
                                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm"
                                >
                                    Intentar de Nuevo
                                </button>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                >
                                    Cerrar
                                </button>
                            </>
                        )}

                        {step === 'processing' && (
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
    );
};

export default TableAuditSetup;