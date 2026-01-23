/**
 * 认证状态管理
 * 从原项目 src/modules/login.js 和 src/core/connection.js 迁移
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthState, LoginCredentials, ConnectionStatus } from '@/types';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { secureStorage } from '@/services/storage/secureStorage';
import { apiClient } from '@/services/api/client';
import { useConfigStore } from './useConfigStore';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';

interface AuthStoreState extends AuthState {
  connectionStatus: ConnectionStatus;
  connectionError: string | null;

  // 操作
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
  updateServerVersion: (version: string | null, buildDate?: string | null) => void;
  updateConnectionStatus: (status: ConnectionStatus, error?: string | null) => void;
}

let restoreSessionPromise: Promise<boolean> | null = null;

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set, get) => ({
      // 初始状态
      isAuthenticated: false,
      apiBase: '',
      managementKey: '',
      rememberPassword: false,
      savedPasswordForLogin: '',
      serverVersion: null,
      serverBuildDate: null,
      connectionStatus: 'disconnected',
      connectionError: null,

      // 恢复会话并自动登录
      restoreSession: () => {
        if (restoreSessionPromise) return restoreSessionPromise;

        restoreSessionPromise = (async () => {
          secureStorage.migratePlaintextKeys(['apiBase', 'apiUrl', 'managementKey']);

          const legacyBase =
            secureStorage.getItem<string>('apiBase') ||
            secureStorage.getItem<string>('apiUrl', { encrypt: true });
          const legacyKey = secureStorage.getItem<string>('managementKey');

          const { apiBase, managementKey, rememberPassword, savedPasswordForLogin } = get();
          const resolvedBase = normalizeApiBase(apiBase || legacyBase || detectApiBaseFromLocation());
          // 使用 managementKey 来恢复登录状态（无论 rememberPassword 是什么值）
          const resolvedKey = managementKey || legacyKey || '';

          // 如果有旧版 legacyKey，需要迁移到新的 savedPasswordForLogin
          const resolvedRememberPassword = rememberPassword || Boolean(legacyKey);
          const resolvedSavedPassword = savedPasswordForLogin || (resolvedRememberPassword ? legacyKey : '') || '';

          set({
            apiBase: resolvedBase,
            managementKey: resolvedKey,
            rememberPassword: resolvedRememberPassword,
            savedPasswordForLogin: resolvedSavedPassword
          });
          apiClient.setConfig({ apiBase: resolvedBase, managementKey: resolvedKey });

          // 只要有 managementKey 就尝试恢复登录
          if (resolvedBase && resolvedKey) {
            try {
              await get().login({
                apiBase: resolvedBase,
                managementKey: resolvedKey,
                rememberPassword: resolvedRememberPassword
              });
              return true;
            } catch (error) {
              console.warn('Auto login failed:', error);
              return false;
            }
          }

          return false;
        })();

        return restoreSessionPromise;
      },

      // 登录
      login: async (credentials) => {
        const apiBase = normalizeApiBase(credentials.apiBase);
        const managementKey = credentials.managementKey.trim();
        const rememberPassword = credentials.rememberPassword ?? get().rememberPassword ?? false;

        try {
          set({ connectionStatus: 'connecting' });

          // 配置 API 客户端
          apiClient.setConfig({
            apiBase,
            managementKey
          });

          // 测试连接 - 获取配置
          await useConfigStore.getState().fetchConfig(undefined, true);

          // 登录成功 - 始终保存 managementKey 用于会话保持
          // savedPasswordForLogin 仅当 rememberPassword 为 true 时保存，用于登录页预填充
          set({
            isAuthenticated: true,
            apiBase,
            managementKey,
            rememberPassword,
            savedPasswordForLogin: rememberPassword ? managementKey : '',
            connectionStatus: 'connected',
            connectionError: null
          });
        } catch (error: any) {
          set({
            connectionStatus: 'error',
            connectionError: error.message || 'Connection failed'
          });
          throw error;
        }
      },

      // 登出
      logout: () => {
        restoreSessionPromise = null;
        useConfigStore.getState().clearCache();
        // 保留 apiBase 方便下次登录
        // 保留 savedPasswordForLogin 和 rememberPassword（用户偏好设置）
        // 清除 managementKey 以结束会话
        const { apiBase, savedPasswordForLogin, rememberPassword } = get();
        set({
          isAuthenticated: false,
          apiBase, // 保留 apiBase
          managementKey: '', // 清除登录凭据
          savedPasswordForLogin, // 保留记住的密码
          rememberPassword, // 保留用户偏好
          serverVersion: null,
          serverBuildDate: null,
          connectionStatus: 'disconnected',
          connectionError: null
        });
      },

      // 检查认证状态
      checkAuth: async () => {
        const { managementKey, apiBase } = get();

        if (!managementKey || !apiBase) {
          return false;
        }

        try {
          // 重新配置客户端
          apiClient.setConfig({ apiBase, managementKey });

          // 验证连接
          await useConfigStore.getState().fetchConfig();

          set({
            isAuthenticated: true,
            connectionStatus: 'connected'
          });

          return true;
        } catch (error) {
          set({
            isAuthenticated: false,
            connectionStatus: 'error'
          });
          return false;
        }
      },

      // 更新服务器版本
      updateServerVersion: (version, buildDate) => {
        set({ serverVersion: version || null, serverBuildDate: buildDate || null });
      },

      // 更新连接状态
      updateConnectionStatus: (status, error = null) => {
        set({
          connectionStatus: status,
          connectionError: error
        });
      }
    }),
    {
      name: STORAGE_KEY_AUTH,
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          const data = secureStorage.getItem<AuthStoreState>(name);
          return data ? JSON.stringify(data) : null;
        },
        setItem: (name, value) => {
          secureStorage.setItem(name, JSON.parse(value));
        },
        removeItem: (name) => {
          secureStorage.removeItem(name);
        }
      })),
      partialize: (state) => ({
        apiBase: state.apiBase,
        managementKey: state.managementKey,
        rememberPassword: state.rememberPassword,
        savedPasswordForLogin: state.savedPasswordForLogin,
        serverVersion: state.serverVersion,
        serverBuildDate: state.serverBuildDate
      })
    }
  )
);

// Browser-only initialization
if (typeof window !== 'undefined') {
  // 监听全局未授权事件
  window.addEventListener('unauthorized', () => {
    useAuthStore.getState().logout();
  });

  window.addEventListener(
    'server-version-update',
    ((e: CustomEvent) => {
      const detail = e.detail || {};
      useAuthStore.getState().updateServerVersion(detail.version || null, detail.buildDate || null);
    }) as EventListener
  );
}
