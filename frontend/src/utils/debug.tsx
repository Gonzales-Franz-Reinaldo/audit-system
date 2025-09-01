import apiService from '../services/api';

export const debugApiService = () => {
    console.log('🔍 === DEBUG API SERVICE ===');
    
    try {
        console.log('- ApiService instance:', apiService);
        console.log('- ApiService type:', typeof apiService);
        console.log('- ApiService constructor:', apiService.constructor.name);
        console.log('- isInitialized method:', typeof apiService?.isInitialized);
        
        if (apiService && typeof apiService.isInitialized === 'function') {
            console.log('- Is initialized:', apiService.isInitialized());
        }
        
        if (apiService && typeof apiService.getConfig === 'function') {
            console.log('- Config:', apiService.getConfig());
        }
        
        // Verificar métodos principales
        const methods = ['testConnection', 'getTables', 'getAuditTables', 'setupTableAudit'] as const;
        methods.forEach(method => {
            console.log(`- ${method} method:`, typeof (apiService as any)[method]);
        });

        // Intentar reinicializar si no está funcionando
        if (apiService && !apiService.isInitialized() && typeof apiService.reinitialize === 'function') {
            console.log('🔄 Intentando reinicializar...');
            apiService.reinitialize();
        }
        
    } catch (error) {
        console.error('💥 Error en debug:', error);
    }
    
    console.log('🔍 === FIN DEBUG ===');
    return apiService;
};

// Para usar en la consola del navegador
(window as any).debugApiService = debugApiService;