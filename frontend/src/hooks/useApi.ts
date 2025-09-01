import { useState, useCallback, useEffect } from 'react';
import { toast } from 'react-hot-toast';

interface UseApiState<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
}

interface UseApiReturn<T> extends UseApiState<T> {
    execute: (...args: any[]) => Promise<T | null>;
    reset: () => void;
}

// Hook personalizado para manejar llamadas a la API - CORREGIDO
export function useApi<T = any>(
    apiFunction: (...args: any[]) => Promise<T>,
    showToast = true
): UseApiReturn<T> {
    const [state, setState] = useState<UseApiState<T>>({
        data: null,
        loading: false,
        error: null,
    });

    const execute = useCallback(
        async (...args: any[]): Promise<T | null> => {
            // CORREGIR: Validar que apiFunction existe y es función
            if (!apiFunction || typeof apiFunction !== 'function') {
                const error = 'API function is not defined or not a function';
                console.error('❌ Error en useApi:', error);
                setState(prev => ({ ...prev, error, loading: false }));
                if (showToast) {
                    toast.error(error);
                }
                return null;
            }

            setState(prev => ({ ...prev, loading: true, error: null }));

            try {
                console.log('🔍 Ejecutando función API:', apiFunction.name || 'anonymous');
                console.log('📊 Argumentos:', args);
                
                // IMPORTANTE: Ejecutar la función manteniendo el contexto
                const result = await apiFunction(...args);
                
                console.log('✅ Resultado de API:', result);
                setState(prev => ({ ...prev, data: result, loading: false }));

                if (showToast) {
                    toast.success('Operación completada exitosamente');
                }

                return result;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
                console.error('❌ Error en API:', errorMessage, error);
                
                setState(prev => ({
                    ...prev,
                    error: errorMessage,
                    loading: false
                }));

                if (showToast) {
                    toast.error(errorMessage);
                }

                return null;
            }
        },
        [apiFunction, showToast]
    );

    const reset = useCallback(() => {
        setState({
            data: null,
            loading: false,
            error: null,
        });
    }, []);

    return {
        ...state,
        execute,
        reset,
    };
}

// Hook para manejar múltiples estados de loading
export function useLoadingStates() {
    const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});

    const setLoading = useCallback((key: string, loading: boolean) => {
        setLoadingStates(prev => ({ ...prev, [key]: loading }));
    }, []);

    const isLoading = useCallback((key: string) => {
        return loadingStates[key] || false;
    }, [loadingStates]);

    const isAnyLoading = useCallback(() => {
        return Object.values(loadingStates).some(loading => loading);
    }, [loadingStates]);

    return {
        setLoading,
        isLoading,
        isAnyLoading,
        loadingStates,
    };
}

// Hook para manejar formularios con validación
export function useFormValidation<T extends Record<string, any>>(
    initialValues: T,
    validationRules: Record<keyof T, (value: any) => string | null>
) {
    const [values, setValues] = useState<T>(initialValues);
    const [errors, setErrors] = useState<Record<keyof T, string>>({} as Record<keyof T, string>);
    const [touched, setTouched] = useState<Record<keyof T, boolean>>({} as Record<keyof T, boolean>);

    const validate = useCallback((fieldName?: keyof T) => {
        if (fieldName) {
            const error = validationRules[fieldName]?.(values[fieldName]);
            setErrors(prev => ({ ...prev, [fieldName]: error || '' }));
            return !error;
        } else {
            const newErrors = {} as Record<keyof T, string>;
            let isValid = true;

            Object.keys(validationRules).forEach(key => {
                const fieldKey = key as keyof T;
                const error = validationRules[fieldKey]?.(values[fieldKey]);
                if (error) {
                    newErrors[fieldKey] = error;
                    isValid = false;
                }
            });

            setErrors(newErrors);
            return isValid;
        }
    }, [values, validationRules]);

    const setValue = useCallback((fieldName: keyof T, value: any) => {
        setValues(prev => ({ ...prev, [fieldName]: value }));
        setTouched(prev => ({ ...prev, [fieldName]: true }));
    }, []);

    const setFieldError = useCallback((fieldName: keyof T, error: string) => {
        setErrors(prev => ({ ...prev, [fieldName]: error }));
    }, []);

    const resetForm = useCallback(() => {
        setValues(initialValues);
        setErrors({} as Record<keyof T, string>);
        setTouched({} as Record<keyof T, boolean>);
    }, [initialValues]);

    const hasErrors = Object.values(errors).some(error => error !== '');

    return {
        values,
        errors,
        touched,
        hasErrors,
        setValue,
        setFieldError,
        validate,
        resetForm,
    };
}

// Hook para manejar paginación
export function usePagination(
    initialPage = 1,
    initialPageSize = 10
) {
    const [currentPage, setCurrentPage] = useState(initialPage);
    const [pageSize, setPageSize] = useState(initialPageSize);
    const [total, setTotal] = useState(0);

    const totalPages = Math.ceil(total / pageSize);
    const hasNext = currentPage < totalPages;
    const hasPrev = currentPage > 1;

    const goToPage = useCallback((page: number) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    }, [totalPages]);

    const nextPage = useCallback(() => {
        if (hasNext) {
            setCurrentPage(prev => prev + 1);
        }
    }, [hasNext]);

    const prevPage = useCallback(() => {
        if (hasPrev) {
            setCurrentPage(prev => prev - 1);
        }
    }, [hasPrev]);

    const changePageSize = useCallback((newPageSize: number) => {
        setPageSize(newPageSize);
        setCurrentPage(1); // Reset to first page when changing page size
    }, []);

    const reset = useCallback(() => {
        setCurrentPage(initialPage);
        setPageSize(initialPageSize);
        setTotal(0);
    }, [initialPage, initialPageSize]);

    return {
        currentPage,
        pageSize,
        total,
        totalPages,
        hasNext,
        hasPrev,
        setTotal,
        goToPage,
        nextPage,
        prevPage,
        changePageSize,
        reset,
    };
}

// Hook para manejar estado local con localStorage
export function useLocalStorage<T>(
    key: string,
    initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error('Error reading from localStorage:', error);
            return initialValue;
        }
    });

    const setValue = useCallback((value: T | ((prev: T) => T)) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.error('Error writing to localStorage:', error);
        }
    }, [key, storedValue]);

    return [storedValue, setValue];
}

// Hook para debounce
export function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
}

// Hook para manejar estado de conexión
export function useConnectionStatus() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return isOnline;
}