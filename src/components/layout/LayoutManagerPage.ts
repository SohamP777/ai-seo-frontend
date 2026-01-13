// src/modules/layout-manager/LayoutManagerPage.tsx
import React, { useState, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ResponsiveLayout, 
  DashboardGrid, 
  PanelResizer, 
  LayoutPresets, 
  LayoutStateManager,
  LayoutHeader
} from './components';
import { 
  saveUserLayout, 
  loadUserLayouts, 
  deleteUserLayout,
  type UserLayout,
  type LayoutWidget
} from './components/LayoutStateManager/layoutApi';

// Assume these global components exist
// import { ErrorBoundary, LoadingSpinner } from '../../components/global';

export const LayoutManagerPage: React.FC = () => {
  const { userProfile } = useSelector((state: any) => state.auth);
  const queryClient = useQueryClient();
  
  const [currentLayout, setCurrentLayout] = useState<UserLayout>({
    id: '',
    name: '',
    description: '',
    widgets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Query for user layouts
  const { 
    data: userLayouts = [], 
    isLoading: layoutsLoading, 
    error: layoutsError,
    refetch: refetchLayouts 
  } = useQuery({
    queryKey: ['userLayouts', userProfile?.id],
    queryFn: async (): Promise<UserLayout[]> => {
      if (!userProfile?.id) throw new Error('User not authenticated');
      return await loadUserLayouts(userProfile.id);
    },
    enabled: !!userProfile?.id,
    staleTime: 5 * 60 * 1000,
    retry: 3,
    onError: (error: Error) => {
      setError(`Failed to load layouts: ${error.message}`);
    }
  });

  // Save layout mutation
  const saveLayoutMutation = useMutation({
    mutationFn: async (layout: Omit<UserLayout, 'id' | 'createdAt' | 'updatedAt'>) => {
      if (!userProfile?.id) throw new Error('User not authenticated');
      return await saveUserLayout(userProfile.id, layout);
    },
    onSuccess: (savedLayout) => {
      queryClient.invalidateQueries({ queryKey: ['userLayouts', userProfile?.id] });
      setCurrentLayout(savedLayout);
      setIsEditing(false);
      setError(null);
    },
    onError: (error: Error) => {
      setError(`Failed to save layout: ${error.message}`);
    }
  });

  // Delete layout mutation
  const deleteLayoutMutation = useMutation({
    mutationFn: async (layoutId: string) => {
      if (!userProfile?.id) throw new Error('User not authenticated');
      await deleteUserLayout(userProfile.id, layoutId);
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['userLayouts', userProfile?.id] });
    },
    onError: (error: Error) => {
      setError(`Failed to delete layout: ${error.message}`);
    }
  });

  const handleWidgetsChange = useCallback((widgets: LayoutWidget[]) => {
    setCurrentLayout(prev => ({
      ...prev,
      widgets,
      updatedAt: new Date().toISOString()
    }));
  }, []);

  const handlePresetSelect = useCallback((preset: UserLayout) => {
    setCurrentLayout(preset);
    setIsEditing(true);
    setError(null);
  }, []);

  const handleSaveLayout = useCallback(() => {
    if (!currentLayout.name?.trim()) {
      setError('Layout name is required');
      return;
    }

    if (currentLayout.widgets.length === 0) {
      setError('Cannot save empty layout. Add at least one widget.');
      return;
    }

    saveLayoutMutation.mutate({
      name: currentLayout.name.trim(),
      description: currentLayout.description?.trim() || '',
      widgets: currentLayout.widgets,
      presetType: currentLayout.presetType
    });
  }, [currentLayout, saveLayoutMutation]);

  const handleResetLayout = useCallback(() => {
    setCurrentLayout({
      id: '',
      name: '',
      description: '',
      widgets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    setIsEditing(false);
    setError(null);
  }, []);

  const handleClearError = useCallback(() => {
    setError(null);
  }, []);

  const handleDeleteLayout = useCallback((layoutId: string) => {
    deleteLayoutMutation.mutate(layoutId);
  }, [deleteLayoutMutation]);

  const isLoading = useMemo(() => 
    layoutsLoading || saveLayoutMutation.isPending || deleteLayoutMutation.isPending,
    [layoutsLoading, saveLayoutMutation.isPending, deleteLayoutMutation.isPending]
  );

  const canSave = useMemo(() => 
    currentLayout.name?.trim() && currentLayout.widgets.length > 0,
    [currentLayout.name, currentLayout.widgets.length]
  );

  // Use global LoadingSpinner component
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading Layout Manager...</p>
        </div>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl mb-4">🔒</div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Authentication Required
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Please log in to access the layout manager.
          </p>
        </div>
      </div>
    );
  }

  return (
    // Global ErrorBoundary would wrap this in the parent component
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
      <LayoutHeader
        layout={currentLayout}
        isEditing={isEditing}
        onEditToggle={() => setIsEditing(!isEditing)}
        onSave={handleSaveLayout}
        onReset={handleResetLayout}
        isLoading={saveLayoutMutation.isPending}
        canSave={canSave}
      />
      
      <div className="container mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6"
            >
              <div className="flex items-center">
                <span className="text-red-600 dark:text-red-400 text-lg">⚠️</span>
                <p className="ml-3 text-red-700 dark:text-red-300 text-sm flex-1">
                  {error}
                </p>
                <button
                  onClick={handleClearError}
                  className="ml-4 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors duration-200"
                  aria-label="Dismiss error"
                >
                  <span className="sr-only">Dismiss</span>
                  ✕
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="xl:col-span-1 space-y-6">
            <LayoutPresets
              presets={userLayouts}
              onPresetSelect={handlePresetSelect}
              onDeletePreset={handleDeleteLayout}
              isLoading={deleteLayoutMutation.isPending}
            />
            
            <LayoutStateManager
              layouts={userLayouts}
              onLayoutSelect={handlePresetSelect}
              onLayoutDelete={handleDeleteLayout}
              currentLayoutId={currentLayout.id}
            />
          </div>

          {/* Main Content */}
          <div className="xl:col-span-3">
            <ResponsiveLayout>
              <DashboardGrid
                widgets={currentLayout.widgets}
                onWidgetsChange={handleWidgetsChange}
                isEditing={isEditing}
                isLoading={isLoading}
              />
              
              {currentLayout.widgets.length > 0 && (
                <div className="mt-6">
                  <PanelResizer
                    leftPanel={
                      <div className="p-4 bg-white dark:bg-gray-800 rounded-lg h-64">
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
                          Layout Preview
                        </h3>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {currentLayout.widgets.length} widgets configured
                        </div>
                      </div>
                    }
                    rightPanel={
                      <div className="p-4 bg-white dark:bg-gray-800 rounded-lg h-64">
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
                          Widget Properties
                        </h3>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          Select a widget to edit its properties
                        </div>
                      </div>
                    }
                    defaultLeftWidth={60}
                    minLeftWidth={30}
                    minRightWidth={30}
                  />
                </div>
              )}
            </ResponsiveLayout>
          </div>
        </div>
      </div>
    </div>
  );
};