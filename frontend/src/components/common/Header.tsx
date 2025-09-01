import React from 'react';
import {
    Shield,
    Database,
    CheckCircle,
    AlertCircle,
    Settings,
    Info,
    Bell,
    User,
    LogOut
} from 'lucide-react';

import { ConnectionInfo } from '../../types';

interface HeaderProps {
    connectionInfo?: ConnectionInfo | null;
    onDisconnect?: () => void;
    className?: string;
}

const Header: React.FC<HeaderProps> = ({
    connectionInfo,
    onDisconnect,
    className = ''
}) => {
    return (
        <header className={`bg-white shadow-sm border-b ${className}`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center py-4">
                    {/* Logo y título */}
                    <div className="flex items-center space-x-3">
                        <div className="flex items-center justify-center w-10 h-10 bg-indigo-600 rounded-lg">
                            <Shield className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">
                                Sistema de Auditoría
                            </h1>
                            <p className="text-xs text-gray-500">
                                Encriptación a nivel de base de datos
                            </p>
                        </div>
                    </div>

                    {/* Centro - Información de conexión */}
                    <div className="hidden md:flex items-center space-x-6">
                        {connectionInfo?.isConnected ? (
                            <div className="flex items-center space-x-3">
                                <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                    <span className="text-sm font-medium text-gray-700">
                                        Conectado
                                    </span>
                                </div>

                                <div className="text-sm text-gray-600">
                                    <div className="flex items-center space-x-1">
                                        <Database className="w-4 h-4" />
                                        <span className="font-medium">
                                            {connectionInfo.type.toUpperCase()}
                                        </span>
                                        <span className="text-gray-400">•</span>
                                        <span>{connectionInfo.currentDatabase}</span>
                                    </div>
                                    <div className="text-xs text-gray-500 text-center">
                                        {connectionInfo.config.host}:{connectionInfo.config.port}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center space-x-2 text-gray-500">
                                <AlertCircle className="w-4 h-4" />
                                <span className="text-sm">No conectado</span>
                            </div>
                        )}
                    </div>

                    {/* Acciones del lado derecho */}
                    <div className="flex items-center space-x-2">
                        {/* Notificaciones */}
                        <button className="relative p-2 text-gray-400 hover:text-gray-600 rounded-md transition-colors">
                            <Bell className="w-5 h-5" />
                            {/* Badge de notificación (opcional) */}
                            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                        </button>

                        {/* Información del sistema */}
                        <button className="p-2 text-gray-400 hover:text-gray-600 rounded-md transition-colors" title="Información del sistema">
                            <Info className="w-5 h-5" />
                        </button>

                        {/* Configuración */}
                        <button className="p-2 text-gray-400 hover:text-gray-600 rounded-md transition-colors" title="Configuración">
                            <Settings className="w-5 h-5" />
                        </button>

                        {/* Usuario/Desconectar */}
                        {connectionInfo?.isConnected ? (
                            <div className="flex items-center space-x-2">
                                <div className="hidden sm:block text-right text-sm">
                                    <div className="font-medium text-gray-900">
                                        {connectionInfo.config.user}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        Administrador
                                    </div>
                                </div>

                                <div className="flex items-center space-x-1">
                                    <button className="p-2 text-gray-400 hover:text-gray-600 rounded-md transition-colors" title="Usuario">
                                        <User className="w-5 h-5" />
                                    </button>

                                    {onDisconnect && (
                                        <button
                                            onClick={onDisconnect}
                                            className="flex items-center px-3 py-2 text-sm bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors"
                                            title="Desconectar"
                                        >
                                            <LogOut className="w-4 h-4 mr-1" />
                                            <span className="hidden sm:block">Desconectar</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center space-x-2 px-3 py-2 bg-gray-100 rounded-md">
                                <User className="w-4 h-4 text-gray-500" />
                                <span className="text-sm text-gray-500">Sin sesión</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Barra de estado móvil */}
                <div className="md:hidden pb-3">
                    {connectionInfo?.isConnected ? (
                        <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                            <div className="flex items-center space-x-2">
                                <CheckCircle className="w-4 h-4 text-green-500" />
                                <div className="text-sm">
                                    <div className="font-medium text-green-900">
                                        {connectionInfo.type.toUpperCase()} - {connectionInfo.currentDatabase}
                                    </div>
                                    <div className="text-xs text-green-700">
                                        {connectionInfo.config.host}:{connectionInfo.config.port}
                                    </div>
                                </div>
                            </div>
                            {onDisconnect && (
                                <button
                                    onClick={onDisconnect}
                                    className="p-2 text-green-600 hover:text-green-800"
                                    title="Desconectar"
                                >
                                    <LogOut className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center p-3 bg-gray-50 rounded-lg">
                            <AlertCircle className="w-4 h-4 text-gray-400 mr-2" />
                            <span className="text-sm text-gray-600">
                                Conecta a una base de datos para comenzar
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Indicador de estado global (opcional) */}
            {connectionInfo?.isConnected && (
                <div className="bg-green-500 h-1 w-full"></div>
            )}
        </header>
    );
};

export default Header;