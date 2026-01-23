/**
 * 认证相关类型定义
 * 基于原项目 src/modules/login.js 和 src/core/connection.js
 */

// 登录凭据
export interface LoginCredentials {
  apiBase: string;
  managementKey: string;
  rememberPassword?: boolean;
}

// 认证状态
export interface AuthState {
  isAuthenticated: boolean;
  apiBase: string;
  managementKey: string;
  rememberPassword: boolean;
  /** 仅当 rememberPassword 为 true 时保存，用于登录页面预填充密码 */
  savedPasswordForLogin: string;
  serverVersion: string | null;
  serverBuildDate: string | null;
}

// 连接状态
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface ConnectionInfo {
  status: ConnectionStatus;
  lastCheck: Date | null;
  error: string | null;
}
