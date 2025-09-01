import React from 'react';
import { BaseComponentProps } from '../../types';

interface LayoutProps extends BaseComponentProps {
    sidebar?: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children, className = '', sidebar }) => {
    return (
        <div className={`min-h-screen bg-gray-50 ${className}`}>
            <div className="flex">
                {sidebar && (
                    <aside className="hidden lg:flex lg:flex-shrink-0">
                        <div className="flex flex-col w-64 bg-white border-r border-gray-200">
                            {sidebar}
                        </div>
                    </aside>
                )}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default Layout;