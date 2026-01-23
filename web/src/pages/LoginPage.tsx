import React, { useEffect, useState, useCallback } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconEye, IconEyeOff, IconAlertCircle } from '@/components/ui/icons';
import { useAuthStore, useLanguageStore, useNotificationStore } from '@/stores';
import { detectApiBaseFromLocation } from '@/utils/connection';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import styles from './Login/Login.module.scss';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotificationStore();
  const language = useLanguageStore((state) => state.language);
  const toggleLanguage = useLanguageStore((state) => state.toggleLanguage);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const login = useAuthStore((state) => state.login);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const storedRememberPassword = useAuthStore((state) => state.rememberPassword);
  const savedPasswordForLogin = useAuthStore((state) => state.savedPasswordForLogin);

  const [managementKey, setManagementKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(true);
  const [error, setError] = useState('');

  const nextLanguageLabel = language === 'zh-CN' ? t('language.english') : t('language.chinese');

  useEffect(() => {
    const init = async () => {
      try {
        const autoLoggedIn = await restoreSession();
        if (!autoLoggedIn) {
          // 仅当 rememberPassword 为 true 时才预填充密码
          setManagementKey(storedRememberPassword ? savedPasswordForLogin : '');
          setRememberPassword(storedRememberPassword);
        }
      } finally {
        setAutoLoading(false);
      }
    };

    init();
  }, [restoreSession, storedRememberPassword, savedPasswordForLogin]);

  const handleSubmit = async () => {
    if (!managementKey.trim()) {
      setError(t('login.error_required'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      await login({
        apiBase: detectApiBaseFromLocation(),
        managementKey: managementKey.trim(),
        rememberPassword
      });
      showNotification(t('common.connected_status'), 'success');
      navigate('/', { replace: true });
    } catch (err: any) {
      const message = err?.message || t('login.error_invalid');
      setError(message);
      showNotification(`${t('notification.login_failed')}: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && !loading) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [loading, handleSubmit]
  );

  if (isAuthenticated) {
    const redirect = (location.state as any)?.from?.pathname || '/';
    return <Navigate to={redirect} replace />;
  }

  return (
    <div className={styles.container}>
      <div className={styles.loginCard}>
        {/* 顶部装饰条 */}
        <div className={styles.cardHeader} />

        <div className={styles.cardBody}>
          {/* 头部区域 */}
          <div className={styles.header}>
            {/* Logo */}
            <div className={styles.logoWrapper}>
              <img src={INLINE_LOGO_JPEG} alt="Logo" className={styles.logo} />
            </div>

            {/* 标题和语言切换 */}
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{t('title.login')}</h1>
              <button
                type="button"
                className={styles.langBtn}
                onClick={toggleLanguage}
                title={t('language.switch')}
                aria-label={t('language.switch')}
              >
                {nextLanguageLabel}
              </button>
            </div>

            <p className={styles.subtitle}>{t('login.subtitle')}</p>
          </div>

          {/* 表单 */}
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            {/* Management Key 输入 */}
            <div className={styles.inputGroup}>
              <label htmlFor="management-key" className={styles.inputLabel}>
                {t('login.management_key_label')}
              </label>
              <div className={styles.inputWrapper}>
                <input
                  id="management-key"
                  type={showKey ? 'text' : 'password'}
                  className={styles.input}
                  placeholder={t('login.management_key_placeholder')}
                  value={managementKey}
                  onChange={(e) => setManagementKey(e.target.value)}
                  onKeyDown={handleSubmitKeyDown}
                  autoFocus
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className={styles.toggleBtn}
                  onClick={() => setShowKey((prev) => !prev)}
                  aria-label={
                    showKey
                      ? t('login.hide_key', { defaultValue: '隐藏密钥' })
                      : t('login.show_key', { defaultValue: '显示密钥' })
                  }
                  title={
                    showKey
                      ? t('login.hide_key', { defaultValue: '隐藏密钥' })
                      : t('login.show_key', { defaultValue: '显示密钥' })
                  }
                >
                  {showKey ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                </button>
              </div>
            </div>

            {/* 记住密码 */}
            <div className={styles.optionsRow}>
              <label htmlFor="remember-password" className={styles.checkboxLabel}>
                <input
                  id="remember-password"
                  type="checkbox"
                  className={styles.checkbox}
                  checked={rememberPassword}
                  onChange={(e) => setRememberPassword(e.target.checked)}
                />
                <span>{t('login.remember_password_label')}</span>
              </label>
            </div>

            {/* 登录按钮 */}
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              <span className={styles.btnContent}>
                {loading && <span className={styles.spinner} />}
                <span>{loading ? t('login.submitting') : t('login.submit_button')}</span>
              </span>
            </button>

            {/* 错误提示 */}
            {error && (
              <div className={styles.errorBox}>
                <IconAlertCircle size={18} className={styles.errorIcon} />
                <span>{error}</span>
              </div>
            )}

            {/* 自动登录提示 */}
            {autoLoading && (
              <div className={styles.autoLoginBox}>
                <span className={styles.autoLoginSpinner} />
                <div className={styles.autoLoginText}>
                  <strong>{t('auto_login.title')}</strong>
                  <span>{t('auto_login.message')}</span>
                </div>
              </div>
            )}
          </form>

          {/* 底部版本信息 */}
          <div className={styles.footer}>
            <p className={styles.version}>CLI Proxy API Management</p>
          </div>
        </div>
      </div>
    </div>
  );
}
