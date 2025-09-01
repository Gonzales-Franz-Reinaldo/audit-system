import React, { useState } from 'react';
import {
    Key,
    Eye,
    EyeOff,
    Unlock,
    AlertTriangle,
    Loader2,
    X,
    Shield
} from 'lucide-react';

import { ModalProps } from '../../types';

interface DecryptModalProps extends Omit<ModalProps, 'children'> {
    onDecrypt: (key: string) => void;
    loading: boolean;
    tableName: string;
}

const DecryptModal: React.FC<DecryptModalProps> = ({
    isOpen,
    onClose,
    onDecrypt,
    loading,
    tableName
}) => {
    const [encryptionKey, setEncryptionKey] = useState('');
    const [showKey, setShowKey] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (encryptionKey.trim()) {
            onDecrypt(encryptionKey);
        }
    };

    const handleClose = () => {
        if (!loading) {
            setEncryptionKey('');
            setShowKey(false);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                {/* Overlay */}
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

                {/* Modal */}
                <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full">
                    {/* Header */}
                    <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                        <div className="flex items-start justify-between">
                            <div className="flex items-start">
                                <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-green-100 sm:mx-0 sm:h-10 sm:w-10">
                                    <Unlock className="h-6 w-6 text-green-600" />
                                </div>
                                <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                                    <h3 className="text-lg leading-6 font-medium text-gray-900">
                                        Desencriptar Datos
                                    </h3>
                                    <p className="text-sm text-gray-500 mt-1">
                                        Tabla: <span className="font-medium">{tableName}</span>
                                    </p>
                                </div>
                            </div>

                            {!loading && (
                                <button
                                    onClick={handleClose}
                                    className="rounded-md text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    title="Cerrar modal"
                                >
                                    <X className="h-6 w-6" />
                                </button>
                            )}
                        </div>

                        {/* Form */}
                        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    <Key className="w-4 h-4 inline mr-2" />
                                    Clave de Encriptación
                                </label>
                                <div className="relative">
                                    <input
                                        type={showKey ? 'text' : 'password'}
                                        value={encryptionKey}
                                        onChange={(e) => setEncryptionKey(e.target.value)}
                                        placeholder="Ingresa tu clave de encriptación"
                                        disabled={loading}
                                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 disabled:bg-gray-100"
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowKey(!showKey)}
                                        disabled={loading}
                                        className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                                    >
                                        {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                                {encryptionKey && encryptionKey.length < 8 && (
                                    <p className="text-yellow-600 text-xs mt-1">
                                        ⚠️ La clave parece corta. Las claves típicas tienen al menos 8 caracteres.
                                    </p>
                                )}
                            </div>

                            {/* Warning */}
                            <div className="bg-yellow-50 p-3 rounded-lg">
                                <div className="flex">
                                    <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5" />
                                    <div className="ml-3">
                                        <p className="text-sm text-yellow-800">
                                            <strong>Importante:</strong> Usa exactamente la misma clave que utilizaste
                                            al configurar la auditoría. Las claves son sensibles a mayúsculas y minúsculas.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Information */}
                            <div className="bg-blue-50 p-3 rounded-lg">
                                <div className="flex">
                                    <Shield className="h-5 w-5 text-blue-400 mt-0.5" />
                                    <div className="ml-3">
                                        <p className="text-sm text-blue-800">
                                            Los datos se desencriptarán temporalmente para esta sesión.
                                            La clave no se almacena por seguridad.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>

                    {/* Footer */}
                    <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                        <button
                            type="submit"
                            onClick={handleSubmit}
                            disabled={!encryptionKey.trim() || loading}
                            className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-green-600 text-base font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Desencriptando...
                                </>
                            ) : (
                                <>
                                    <Unlock className="w-4 h-4 mr-2" />
                                    Desencriptar
                                </>
                            )}
                        </button>

                        {!loading && (
                            <button
                                type="button"
                                onClick={handleClose}
                                className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                            >
                                Cancelar
                            </button>
                        )}
                    </div>

                    {/* Loading overlay */}
                    {loading && (
                        <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center">
                            <div className="text-center">
                                <Loader2 className="w-8 h-8 animate-spin text-green-600 mx-auto mb-2" />
                                <p className="text-sm text-gray-600">
                                    Validando clave y desencriptando datos...
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DecryptModal;