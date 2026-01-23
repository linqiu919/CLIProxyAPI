import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconBot, IconDownload, IconInfo, IconTrash2, IconX, IconSettings, IconEye, IconEyeOff, IconPower } from '@/components/ui/icons';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import { authFilesApi, usageApi } from '@/services/api';
import { apiClient } from '@/services/api/client';
import type { AuthFileItem, OAuthModelMappingEntry } from '@/types';
import {
  calculateStatusBarData,
  collectUsageDetails,
  normalizeUsageSourceId,
  type KeyStatBucket,
  type KeyStats,
  type UsageDetail,
} from '@/utils/usage';
import { formatFileSize } from '@/utils/format';
import { generateId } from '@/utils/helpers';
import styles from './AuthFilesPage.module.scss';

type ThemeColors = { bg: string; text: string; border?: string };
type TypeColorSet = { light: ThemeColors; dark?: ThemeColors };
type ResolvedTheme = 'light' | 'dark';

// 标签类型颜色配置（对齐重构前 styles.css 的 file-type-badge 颜色）
const TYPE_COLORS: Record<string, TypeColorSet> = {
  qwen: {
    light: { bg: '#e8f5e9', text: '#2e7d32' },
    dark: { bg: '#1b5e20', text: '#81c784' }
  },
  gemini: {
    light: { bg: '#e3f2fd', text: '#1565c0' },
    dark: { bg: '#0d47a1', text: '#64b5f6' }
  },
  'gemini-cli': {
    light: { bg: '#e7efff', text: '#1e4fa3' },
    dark: { bg: '#1c3f73', text: '#a8c7ff' }
  },
  aistudio: {
    light: { bg: '#f0f2f5', text: '#2f343c' },
    dark: { bg: '#373c42', text: '#cfd3db' }
  },
  claude: {
    light: { bg: '#fce4ec', text: '#c2185b' },
    dark: { bg: '#880e4f', text: '#f48fb1' }
  },
  codex: {
    light: { bg: '#fff3e0', text: '#ef6c00' },
    dark: { bg: '#e65100', text: '#ffb74d' }
  },
  antigravity: {
    light: { bg: '#e0f7fa', text: '#006064' },
    dark: { bg: '#004d40', text: '#80deea' }
  },
  iflow: {
    light: { bg: '#f3e5f5', text: '#7b1fa2' },
    dark: { bg: '#4a148c', text: '#ce93d8' }
  },
  empty: {
    light: { bg: '#f5f5f5', text: '#616161' },
    dark: { bg: '#424242', text: '#bdbdbd' }
  },
  unknown: {
    light: { bg: '#f0f0f0', text: '#666666', border: '1px dashed #999999' },
    dark: { bg: '#3a3a3a', text: '#aaaaaa', border: '1px dashed #666666' }
  }
};

const OAUTH_PROVIDER_PRESETS = [
  'gemini-cli',
  'vertex',
  'aistudio',
  'antigravity',
  'claude',
  'codex',
  'qwen',
  'iflow'
];

const OAUTH_PROVIDER_EXCLUDES = new Set(['all', 'unknown', 'empty']);
const MIN_CARD_PAGE_SIZE = 3;
const MAX_CARD_PAGE_SIZE = 30;
const MAX_AUTH_FILE_SIZE = 50 * 1024;

const clampCardPageSize = (value: number) =>
  Math.min(MAX_CARD_PAGE_SIZE, Math.max(MIN_CARD_PAGE_SIZE, Math.round(value)));

interface ExcludedFormState {
  provider: string;
  modelsText: string;
}

type OAuthModelMappingFormEntry = OAuthModelMappingEntry & { id: string };

interface ModelMappingsFormState {
  provider: string;
  mappings: OAuthModelMappingFormEntry[];
}

const buildEmptyMappingEntry = (): OAuthModelMappingFormEntry => ({
  id: generateId(),
  name: '',
  alias: '',
  fork: false
});
// 标准化 auth_index 值（与 usage.ts 中的 normalizeAuthIndex 保持一致）
function normalizeAuthIndexValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

function isRuntimeOnlyAuthFile(file: AuthFileItem): boolean {
  const raw = file['runtime_only'] ?? file.runtimeOnly;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
}

// 解析认证文件的统计数据
function resolveAuthFileStats(
  file: AuthFileItem,
  stats: KeyStats
): KeyStatBucket {
  const defaultStats: KeyStatBucket = { success: 0, failure: 0 };
  const rawFileName = file?.name || '';

  // 兼容 auth_index 和 authIndex 两种字段名（API 返回的是 auth_index）
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndexKey = normalizeAuthIndexValue(rawAuthIndex);

  // 尝试根据 authIndex 匹配
  if (authIndexKey && stats.byAuthIndex?.[authIndexKey]) {
    return stats.byAuthIndex[authIndexKey];
  }

  // 尝试根据 source (文件名) 匹配
  const fileNameId = rawFileName ? normalizeUsageSourceId(rawFileName) : '';
  if (fileNameId && stats.bySource?.[fileNameId]) {
    const fromName = stats.bySource[fileNameId];
    if (fromName.success > 0 || fromName.failure > 0) {
      return fromName;
    }
  }

  // 尝试去掉扩展名后匹配
  if (rawFileName) {
    const nameWithoutExt = rawFileName.replace(/\.[^/.]+$/, '');
    if (nameWithoutExt && nameWithoutExt !== rawFileName) {
      const nameWithoutExtId = normalizeUsageSourceId(nameWithoutExt);
      const fromNameWithoutExt = nameWithoutExtId ? stats.bySource?.[nameWithoutExtId] : undefined;
      if (fromNameWithoutExt && (fromNameWithoutExt.success > 0 || fromNameWithoutExt.failure > 0)) {
        return fromNameWithoutExt;
      }
    }
  }

  return defaultStats;
}

export function AuthFilesPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(9);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [keyStats, setKeyStats] = useState<KeyStats>({ bySource: {}, byAuthIndex: {} });
  const [usageDetails, setUsageDetails] = useState<UsageDetail[]>([]);

  // 详情弹窗相关
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<AuthFileItem | null>(null);

  // 模型列表弹窗相关
  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsList, setModelsList] = useState<{ id: string; display_name?: string; type?: string }[]>([]);
  const [modelsFileName, setModelsFileName] = useState('');
  const [modelsFileType, setModelsFileType] = useState('');
  const [modelsError, setModelsError] = useState<'unsupported' | null>(null);

  // OAuth 排除模型相关
  const [excluded, setExcluded] = useState<Record<string, string[]>>({});
  const [excludedError, setExcludedError] = useState<'unsupported' | null>(null);
  const [excludedModalOpen, setExcludedModalOpen] = useState(false);
  const [excludedForm, setExcludedForm] = useState<ExcludedFormState>({ provider: '', modelsText: '' });
  const [savingExcluded, setSavingExcluded] = useState(false);

  // OAuth 模型映射相关
  const [modelMappings, setModelMappings] = useState<Record<string, OAuthModelMappingEntry[]>>({});
  const [modelMappingsError, setModelMappingsError] = useState<'unsupported' | null>(null);
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [mappingForm, setMappingForm] = useState<ModelMappingsFormState>({
    provider: '',
    mappings: [buildEmptyMappingEntry()]
  });
  const [savingMappings, setSavingMappings] = useState(false);

  // Deno 代理配置相关
  const [denoProxyModalOpen, setDenoProxyModalOpen] = useState(false);
  const [denoProxyFile, setDenoProxyFile] = useState<AuthFileItem | null>(null);
  const [denoProxyForm, setDenoProxyForm] = useState({ denoHost: '' });
  const [savingDenoProxy, setSavingDenoProxy] = useState(false);

  // 批量选择相关
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [batchDenoProxyModalOpen, setBatchDenoProxyModalOpen] = useState(false);
  const [batchDenoProxyForm, setBatchDenoProxyForm] = useState({ denoHost: '' });
  const [savingBatchDenoProxy, setSavingBatchDenoProxy] = useState(false);

  // 文件名模糊化
  const [fileNameBlurred, setFileNameBlurred] = useState(false);

  // 正在切换状态的文件
  const [togglingStatus, setTogglingStatus] = useState<string | null>(null);

  // 确认禁用/启用弹窗
  const [toggleConfirmModalOpen, setToggleConfirmModalOpen] = useState(false);
  const [toggleConfirmTarget, setToggleConfirmTarget] = useState<{ name: string; currentDisabled: boolean } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadingKeyStatsRef = useRef(false);
  const excludedUnsupportedRef = useRef(false);
  const mappingsUnsupportedRef = useRef(false);

  const disableControls = connectionStatus !== 'connected';

  const normalizeProviderKey = (value: string) => value.trim().toLowerCase();

  const handlePageSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.valueAsNumber;
    if (!Number.isFinite(value)) return;
    setPageSize(clampCardPageSize(value));
    setPage(1);
  };

  // 格式化修改时间
  const formatModified = (item: AuthFileItem): string => {
    const raw = item['modtime'] ?? item.modified;
    if (!raw) return '-';
    const asNumber = Number(raw);
    const date =
      Number.isFinite(asNumber) && !Number.isNaN(asNumber)
        ? new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber)
        : new Date(String(raw));
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
  };

  // 加载文件列表
  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 加载 key 统计和 usage 明细（API 层已有60秒超时）
  const loadKeyStats = useCallback(async () => {
    // 防止重复请求
    if (loadingKeyStatsRef.current) return;
    loadingKeyStatsRef.current = true;
    try {
      const usageResponse = await usageApi.getUsage();
      const usageData = usageResponse?.usage ?? usageResponse;
      const stats = await usageApi.getKeyStats(usageData);
      setKeyStats(stats);
      // 收集 usage 明细用于状态栏
      const details = collectUsageDetails(usageData);
      setUsageDetails(details);
    } catch {
      // 静默失败
    } finally {
      loadingKeyStatsRef.current = false;
    }
  }, []);

  // 加载 OAuth 排除列表
  const loadExcluded = useCallback(async () => {
    try {
      const res = await authFilesApi.getOauthExcludedModels();
      excludedUnsupportedRef.current = false;
      setExcluded(res || {});
      setExcludedError(null);
    } catch (err: unknown) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;

      if (status === 404) {
        setExcluded({});
        setExcludedError('unsupported');
        if (!excludedUnsupportedRef.current) {
          excludedUnsupportedRef.current = true;
          showNotification(t('oauth_excluded.upgrade_required'), 'warning');
        }
        return;
      }
      // 静默失败
    }
  }, [showNotification, t]);

  // 加载 OAuth 模型映射
  const loadModelMappings = useCallback(async () => {
    try {
      const res = await authFilesApi.getOauthModelMappings();
      mappingsUnsupportedRef.current = false;
      setModelMappings(res || {});
      setModelMappingsError(null);
    } catch (err: unknown) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;

      if (status === 404) {
        setModelMappings({});
        setModelMappingsError('unsupported');
        if (!mappingsUnsupportedRef.current) {
          mappingsUnsupportedRef.current = true;
          showNotification(t('oauth_model_mappings.upgrade_required'), 'warning');
        }
        return;
      }
      // 静默失败
    }
  }, [showNotification, t]);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadFiles(), loadKeyStats(), loadExcluded(), loadModelMappings()]);
  }, [loadFiles, loadKeyStats, loadExcluded, loadModelMappings]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    loadFiles();
    loadKeyStats();
    loadExcluded();
    loadModelMappings();
  }, [loadFiles, loadKeyStats, loadExcluded, loadModelMappings]);

  // 定时刷新状态数据（每240秒）
  useInterval(loadKeyStats, 240_000);

  // 提取所有存在的类型
  const existingTypes = useMemo(() => {
    const types = new Set<string>(['all']);
    files.forEach((file) => {
      if (file.type) {
        types.add(file.type);
      }
    });
    return Array.from(types);
  }, [files]);


  const excludedProviderLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    Object.keys(excluded).forEach((provider) => {
      const key = provider.trim().toLowerCase();
      if (key && !lookup.has(key)) {
        lookup.set(key, provider);
      }
    });
    return lookup;
  }, [excluded]);

  const mappingProviderLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    Object.keys(modelMappings).forEach((provider) => {
      const key = provider.trim().toLowerCase();
      if (key && !lookup.has(key)) {
        lookup.set(key, provider);
      }
    });
    return lookup;
  }, [modelMappings]);

  const providerOptions = useMemo(() => {
    const extraProviders = new Set<string>();

    Object.keys(excluded).forEach((provider) => {
      extraProviders.add(provider);
    });
    Object.keys(modelMappings).forEach((provider) => {
      extraProviders.add(provider);
    });
    files.forEach((file) => {
      if (typeof file.type === 'string') {
        extraProviders.add(file.type);
      }
      if (typeof file.provider === 'string') {
        extraProviders.add(file.provider);
      }
    });

    const normalizedExtras = Array.from(extraProviders)
      .map((value) => value.trim())
      .filter((value) => value && !OAUTH_PROVIDER_EXCLUDES.has(value.toLowerCase()));

    const baseSet = new Set(OAUTH_PROVIDER_PRESETS.map((value) => value.toLowerCase()));
    const extraList = normalizedExtras
      .filter((value) => !baseSet.has(value.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));

    return [...OAUTH_PROVIDER_PRESETS, ...extraList];
  }, [excluded, files, modelMappings]);

  // 过滤和搜索
  const filtered = useMemo(() => {
    return files.filter((item) => {
      const matchType = filter === 'all' || item.type === filter;
      const term = search.trim().toLowerCase();
      const matchSearch =
        !term ||
        item.name.toLowerCase().includes(term) ||
        (item.type || '').toString().toLowerCase().includes(term) ||
        (item.provider || '').toString().toLowerCase().includes(term);
      return matchType && matchSearch;
    });
  }, [files, filter, search]);

  // 分页计算
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  // 点击上传
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // 处理文件上传（支持多选）
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const filesToUpload = Array.from(fileList);
    const validFiles: File[] = [];
    const invalidFiles: string[] = [];
    const oversizedFiles: string[] = [];

    filesToUpload.forEach((file) => {
      if (!file.name.endsWith('.json')) {
        invalidFiles.push(file.name);
        return;
      }
      if (file.size > MAX_AUTH_FILE_SIZE) {
        oversizedFiles.push(file.name);
        return;
      }
      validFiles.push(file);
    });

    if (invalidFiles.length > 0) {
      showNotification(t('auth_files.upload_error_json'), 'error');
    }
    if (oversizedFiles.length > 0) {
      showNotification(
        t('auth_files.upload_error_size', { maxSize: formatFileSize(MAX_AUTH_FILE_SIZE) }),
        'error'
      );
    }

    if (validFiles.length === 0) {
      event.target.value = '';
      return;
    }

    setUploading(true);
    let successCount = 0;
    const failed: { name: string; message: string }[] = [];

    for (const file of validFiles) {
      try {
        await authFilesApi.upload(file);
        successCount++;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        failed.push({ name: file.name, message: errorMessage });
      }
    }

    if (successCount > 0) {
      const suffix = validFiles.length > 1 ? ` (${successCount}/${validFiles.length})` : '';
      showNotification(`${t('auth_files.upload_success')}${suffix}`, failed.length ? 'warning' : 'success');
      await loadFiles();
      await loadKeyStats();
    }

    if (failed.length > 0) {
      const details = failed.map((item) => `${item.name}: ${item.message}`).join('; ');
      showNotification(`${t('notification.upload_failed')}: ${details}`, 'error');
    }

    setUploading(false);
    event.target.value = '';
  };

  // 删除单个文件
  const handleDelete = async (name: string) => {
    if (!window.confirm(`${t('auth_files.delete_confirm')} "${name}" ?`)) return;
    setDeleting(name);
    try {
      await authFilesApi.deleteFile(name);
      showNotification(t('auth_files.delete_success'), 'success');
      setFiles((prev) => prev.filter((item) => item.name !== name));
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
    } finally {
      setDeleting(null);
    }
  };

  // 打开确认禁用/启用弹窗
  const openToggleConfirmModal = (name: string, currentDisabled: boolean) => {
    setToggleConfirmTarget({ name, currentDisabled });
    setToggleConfirmModalOpen(true);
  };

  // 确认切换认证文件启用/禁用状态
  const confirmToggleStatus = async () => {
    if (!toggleConfirmTarget) return;
    const { name, currentDisabled } = toggleConfirmTarget;
    const newDisabled = !currentDisabled;

    setToggleConfirmModalOpen(false);
    setTogglingStatus(name);
    try {
      await authFilesApi.patchAuthFileStatus(name, newDisabled);
      showNotification(
        newDisabled
          ? t('auth_files.disabled_success', { defaultValue: '已禁用认证文件' })
          : t('auth_files.enabled_success', { defaultValue: '已启用认证文件' }),
        'success'
      );
      // 更新本地状态
      setFiles((prev) =>
        prev.map((item) =>
          item.name === name ? { ...item, disabled: newDisabled } : item
        )
      );
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(
        `${t('auth_files.toggle_status_failed', { defaultValue: '切换状态失败' })}: ${errorMessage}`,
        'error'
      );
    } finally {
      setTogglingStatus(null);
      setToggleConfirmTarget(null);
    }
  };

  // 删除全部（根据筛选类型）
  const handleDeleteAll = async () => {
    const isFiltered = filter !== 'all';
    const typeLabel = isFiltered ? getTypeLabel(filter) : t('auth_files.filter_all');
    const confirmMessage = isFiltered
      ? t('auth_files.delete_filtered_confirm', { type: typeLabel })
      : t('auth_files.delete_all_confirm');

    if (!window.confirm(confirmMessage)) return;

    setDeletingAll(true);
    try {
      if (!isFiltered) {
        // 删除全部
        await authFilesApi.deleteAll();
        showNotification(t('auth_files.delete_all_success'), 'success');
        setFiles((prev) => prev.filter((file) => isRuntimeOnlyAuthFile(file)));
      } else {
        // 删除筛选类型的文件
        const filesToDelete = files.filter(
          (f) => f.type === filter && !isRuntimeOnlyAuthFile(f)
        );

        if (filesToDelete.length === 0) {
          showNotification(t('auth_files.delete_filtered_none', { type: typeLabel }), 'info');
          setDeletingAll(false);
          return;
        }

        let success = 0;
        let failed = 0;
        const deletedNames: string[] = [];

        for (const file of filesToDelete) {
          try {
            await authFilesApi.deleteFile(file.name);
            success++;
            deletedNames.push(file.name);
          } catch {
            failed++;
          }
        }

        setFiles((prev) => prev.filter((f) => !deletedNames.includes(f.name)));

        if (failed === 0) {
          showNotification(
            t('auth_files.delete_filtered_success', { count: success, type: typeLabel }),
            'success'
          );
        } else {
          showNotification(
            t('auth_files.delete_filtered_partial', { success, failed, type: typeLabel }),
            'warning'
          );
        }
        setFilter('all');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
    } finally {
      setDeletingAll(false);
    }
  };

  // 下载文件
  const handleDownload = async (name: string) => {
    try {
      const response = await apiClient.getRaw(`/auth-files/download?name=${encodeURIComponent(name)}`, {
        responseType: 'blob'
      });
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      window.URL.revokeObjectURL(url);
      showNotification(t('auth_files.download_success'), 'success');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error');
    }
  };

  // 显示详情弹窗
  const showDetails = (file: AuthFileItem) => {
    setSelectedFile(file);
    setDetailModalOpen(true);
  };

  // 显示模型列表
  const showModels = async (item: AuthFileItem) => {
    setModelsFileName(item.name);
    setModelsFileType(item.type || '');
    setModelsList([]);
    setModelsError(null);
    setModelsModalOpen(true);
    setModelsLoading(true);
    try {
      const models = await authFilesApi.getModelsForAuthFile(item.name);
      setModelsList(models);
    } catch (err) {
      // 检测是否是 API 不支持的错误 (404 或特定错误消息)
      const errorMessage = err instanceof Error ? err.message : '';
      if (errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('Not Found')) {
        setModelsError('unsupported');
      } else {
        showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
      }
    } finally {
      setModelsLoading(false);
    }
  };

  // 检查模型是否被 OAuth 排除
  const isModelExcluded = (modelId: string, providerType: string): boolean => {
    const providerKey = normalizeProviderKey(providerType);
    const excludedModels = excluded[providerKey] || excluded[providerType] || [];
    return excludedModels.some(pattern => {
      if (pattern.includes('*')) {
        // 支持通配符匹配
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
        return regex.test(modelId);
      }
      return pattern.toLowerCase() === modelId.toLowerCase();
    });
  };

  // 获取类型标签显示文本
  const getTypeLabel = (type: string): string => {
    const key = `auth_files.filter_${type}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (type.toLowerCase() === 'iflow') return 'iFlow';
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  // 获取类型颜色
  const getTypeColor = (type: string): ThemeColors => {
    const set = TYPE_COLORS[type] || TYPE_COLORS.unknown;
    return resolvedTheme === 'dark' && set.dark ? set.dark : set.light;
  };

  // OAuth 排除相关方法
  const openExcludedModal = (provider?: string) => {
    const normalizedProvider = normalizeProviderKey(provider || '');
    const fallbackProvider =
      normalizedProvider || (filter !== 'all' ? normalizeProviderKey(String(filter)) : '');
    const lookupKey = fallbackProvider ? excludedProviderLookup.get(fallbackProvider) : undefined;
    const models = lookupKey ? excluded[lookupKey] : [];
    setExcludedForm({
      provider: lookupKey || fallbackProvider,
      modelsText: Array.isArray(models) ? models.join('\n') : ''
    });
    setExcludedModalOpen(true);
  };

  const saveExcludedModels = async () => {
    const provider = normalizeProviderKey(excludedForm.provider);
    if (!provider) {
      showNotification(t('oauth_excluded.provider_required'), 'error');
      return;
    }
    const models = excludedForm.modelsText
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    setSavingExcluded(true);
    try {
      if (models.length) {
        await authFilesApi.saveOauthExcludedModels(provider, models);
      } else {
        await authFilesApi.deleteOauthExcludedEntry(provider);
      }
      await loadExcluded();
      showNotification(t('oauth_excluded.save_success'), 'success');
      setExcludedModalOpen(false);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('oauth_excluded.save_failed')}: ${errorMessage}`, 'error');
    } finally {
      setSavingExcluded(false);
    }
  };

  const deleteExcluded = async (provider: string) => {
    const providerLabel = provider.trim() || provider;
    if (!window.confirm(t('oauth_excluded.delete_confirm', { provider: providerLabel }))) return;
    const providerKey = normalizeProviderKey(provider);
    if (!providerKey) {
      showNotification(t('oauth_excluded.provider_required'), 'error');
      return;
    }
    try {
      await authFilesApi.deleteOauthExcludedEntry(providerKey);
      await loadExcluded();
      showNotification(t('oauth_excluded.delete_success'), 'success');
    } catch (err: unknown) {
      try {
        const current = await authFilesApi.getOauthExcludedModels();
        const next: Record<string, string[]> = {};
        Object.entries(current).forEach(([key, models]) => {
          if (normalizeProviderKey(key) === providerKey) return;
          next[key] = models;
        });
        await authFilesApi.replaceOauthExcludedModels(next);
        await loadExcluded();
        showNotification(t('oauth_excluded.delete_success'), 'success');
      } catch (fallbackErr: unknown) {
        const errorMessage = fallbackErr instanceof Error ? fallbackErr.message : err instanceof Error ? err.message : '';
        showNotification(`${t('oauth_excluded.delete_failed')}: ${errorMessage}`, 'error');
      }
    }
  };

  // OAuth 模型映射相关方法
  const normalizeMappingEntries = (entries?: OAuthModelMappingEntry[]): OAuthModelMappingFormEntry[] => {
    if (!Array.isArray(entries) || entries.length === 0) {
      return [buildEmptyMappingEntry()];
    }
    return entries.map((entry) => ({
      id: generateId(),
      name: entry.name ?? '',
      alias: entry.alias ?? '',
      fork: Boolean(entry.fork),
    }));
  };

  const openMappingsModal = (provider?: string) => {
    const normalizedProvider = (provider || '').trim();
    const fallbackProvider = normalizedProvider || (filter !== 'all' ? String(filter) : '');
    const lookupKey = fallbackProvider
      ? mappingProviderLookup.get(fallbackProvider.toLowerCase())
      : undefined;
    const mappings = lookupKey ? modelMappings[lookupKey] : [];
    setMappingForm({
      provider: lookupKey || fallbackProvider,
      mappings: normalizeMappingEntries(mappings),
    });
    setMappingModalOpen(true);
  };

  const updateMappingEntry = (index: number, field: keyof OAuthModelMappingEntry, value: string | boolean) => {
    setMappingForm((prev) => ({
      ...prev,
      mappings: prev.mappings.map((entry, idx) =>
        idx === index ? { ...entry, [field]: value } : entry
      ),
    }));
  };

  const addMappingEntry = () => {
    setMappingForm((prev) => ({
      ...prev,
      mappings: [...prev.mappings, buildEmptyMappingEntry()],
    }));
  };

  const removeMappingEntry = (index: number) => {
    setMappingForm((prev) => {
      const next = prev.mappings.filter((_, idx) => idx !== index);
      return {
        ...prev,
        mappings: next.length ? next : [buildEmptyMappingEntry()],
      };
    });
  };

  const saveModelMappings = async () => {
    const provider = mappingForm.provider.trim();
    if (!provider) {
      showNotification(t('oauth_model_mappings.provider_required'), 'error');
      return;
    }

    const seen = new Set<string>();
    const mappings = mappingForm.mappings
      .map((entry) => {
        const name = String(entry.name ?? '').trim();
        const alias = String(entry.alias ?? '').trim();
        if (!name || !alias) return null;
        const key = `${name.toLowerCase()}::${alias.toLowerCase()}::${entry.fork ? '1' : '0'}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return entry.fork ? { name, alias, fork: true } : { name, alias };
      })
      .filter(Boolean) as OAuthModelMappingEntry[];

    setSavingMappings(true);
    try {
      if (mappings.length) {
        await authFilesApi.saveOauthModelMappings(provider, mappings);
      } else {
        await authFilesApi.deleteOauthModelMappings(provider);
      }
      await loadModelMappings();
      showNotification(t('oauth_model_mappings.save_success'), 'success');
      setMappingModalOpen(false);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('oauth_model_mappings.save_failed')}: ${errorMessage}`, 'error');
    } finally {
      setSavingMappings(false);
    }
  };

  const deleteModelMappings = async (provider: string) => {
    if (!window.confirm(t('oauth_model_mappings.delete_confirm', { provider }))) return;
    try {
      await authFilesApi.deleteOauthModelMappings(provider);
      await loadModelMappings();
      showNotification(t('oauth_model_mappings.delete_success'), 'success');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('oauth_model_mappings.delete_failed')}: ${errorMessage}`, 'error');
    }
  };

  // Deno 代理配置相关函数
  const openDenoProxyModal = async (file: AuthFileItem) => {
    setDenoProxyFile(file);
    // 加载现有配置
    try {
      const config = await authFilesApi.getDenoProxyConfig(file.id || file.name);
      setDenoProxyForm({
        denoHost: config.deno_host || ''
      });
    } catch {
      setDenoProxyForm({ denoHost: '' });
    }
    setDenoProxyModalOpen(true);
  };

  const saveDenoProxyConfig = async () => {
    if (!denoProxyFile) return;
    const denoHost = denoProxyForm.denoHost.trim();

    setSavingDenoProxy(true);
    try {
      if (denoHost) {
        await authFilesApi.setDenoProxyConfig(
          [denoProxyFile.id || denoProxyFile.name],
          denoHost
        );
        showNotification(t('deno_proxy.save_success', { defaultValue: 'Deno 代理配置已保存' }), 'success');
      } else {
        await authFilesApi.deleteDenoProxyConfig([denoProxyFile.id || denoProxyFile.name]);
        showNotification(t('deno_proxy.delete_success', { defaultValue: 'Deno 代理配置已删除' }), 'success');
      }
      setDenoProxyModalOpen(false);
      await loadFiles(); // 刷新文件列表以更新标识
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('deno_proxy.save_failed', { defaultValue: '保存失败' })}: ${errorMessage}`, 'error');
    } finally {
      setSavingDenoProxy(false);
    }
  };

  // 检查认证文件是否配置了 deno 代理
  const hasDenoProxyConfig = (item: AuthFileItem): boolean => {
    // 检查 deno_proxy_host 字段
    const denoHost = item['deno_proxy_host'] || item['denoProxyHost'];
    return Boolean(denoHost && String(denoHost).trim());
  };

  // 批量选择相关函数
  const toggleFileSelection = (fileName: string) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileName)) {
        newSet.delete(fileName);
      } else {
        newSet.add(fileName);
      }
      return newSet;
    });
  };

  const selectAllAntigravityFiles = () => {
    const antigravityFiles = files.filter(f => (f.type || '').toLowerCase() === 'antigravity');
    setSelectedFiles(new Set(antigravityFiles.map(f => f.name)));
  };

  const clearSelection = () => {
    setSelectedFiles(new Set());
  };

  const openBatchDenoProxyModal = () => {
    setBatchDenoProxyForm({ denoHost: '' });
    setBatchDenoProxyModalOpen(true);
  };

  const saveBatchDenoProxyConfig = async () => {
    if (selectedFiles.size === 0) return;
    const denoHost = batchDenoProxyForm.denoHost.trim();

    setSavingBatchDenoProxy(true);
    try {
      const ids = Array.from(selectedFiles);
      if (denoHost) {
        await authFilesApi.setDenoProxyConfig(ids, denoHost);
        showNotification(
          t('deno_proxy.batch_save_success', {
            defaultValue: '已为 {{count}} 个认证文件配置 Deno 代理',
            count: ids.length
          }),
          'success'
        );
      } else {
        await authFilesApi.deleteDenoProxyConfig(ids);
        showNotification(
          t('deno_proxy.batch_delete_success', {
            defaultValue: '已删除 {{count}} 个认证文件的 Deno 代理配置',
            count: ids.length
          }),
          'success'
        );
      }
      setBatchDenoProxyModalOpen(false);
      clearSelection();
      await loadFiles(); // 刷新文件列表以更新标识
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('deno_proxy.save_failed', { defaultValue: '保存失败' })}: ${errorMessage}`, 'error');
    } finally {
      setSavingBatchDenoProxy(false);
    }
  };

  // 渲染标签筛选器
  const renderFilterTags = () => (
    <div className={styles.filterTags}>
      {existingTypes.map((type) => {
        const isActive = filter === type;
        const color = type === 'all' ? { bg: 'var(--bg-tertiary)', text: 'var(--text-primary)' } : getTypeColor(type);
        const activeTextColor = resolvedTheme === 'dark' ? '#111827' : '#fff';
        return (
          <button
            key={type}
            className={`${styles.filterTag} ${isActive ? styles.filterTagActive : ''}`}
            style={{
              backgroundColor: isActive ? color.text : color.bg,
              color: isActive ? activeTextColor : color.text,
              borderColor: color.text
            }}
            onClick={() => {
              setFilter(type);
              setPage(1);
            }}
          >
            {getTypeLabel(type)}
          </button>
        );
      })}
    </div>
  );

  // 预计算所有认证文件的状态栏数据（避免每次渲染重复计算）
  const statusBarCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof calculateStatusBarData>>();

    files.forEach((file) => {
      const rawAuthIndex = file['auth_index'] ?? file.authIndex;
      const authIndexKey = normalizeAuthIndexValue(rawAuthIndex);

      if (authIndexKey) {
        // 过滤出属于该认证文件的 usage 明细
        const filteredDetails = usageDetails.filter((detail) => {
          const detailAuthIndex = normalizeAuthIndexValue(detail.auth_index);
          return detailAuthIndex !== null && detailAuthIndex === authIndexKey;
        });
        cache.set(authIndexKey, calculateStatusBarData(filteredDetails));
      }
    });

    return cache;
  }, [usageDetails, files]);

  // 渲染状态监测栏
  const renderStatusBar = (item: AuthFileItem) => {
    // 认证文件使用 authIndex 来匹配 usage 数据
    const rawAuthIndex = item['auth_index'] ?? item.authIndex;
    const authIndexKey = normalizeAuthIndexValue(rawAuthIndex);

    const statusData = (authIndexKey && statusBarCache.get(authIndexKey)) || calculateStatusBarData([]);
    const hasData = statusData.totalSuccess + statusData.totalFailure > 0;
    const rateClass = !hasData
      ? ''
      : statusData.successRate >= 90
        ? styles.statusRateHigh
        : statusData.successRate >= 50
          ? styles.statusRateMedium
          : styles.statusRateLow;

    return (
      <div className={styles.statusBar}>
        <div className={styles.statusBlocks}>
          {statusData.blocks.map((state, idx) => {
            const blockClass =
              state === 'success'
                ? styles.statusBlockSuccess
                : state === 'failure'
                  ? styles.statusBlockFailure
                  : state === 'mixed'
                    ? styles.statusBlockMixed
                    : styles.statusBlockIdle;
            return <div key={idx} className={`${styles.statusBlock} ${blockClass}`} />;
          })}
        </div>
        <span className={`${styles.statusRate} ${rateClass}`}>
          {hasData ? `${statusData.successRate.toFixed(1)}%` : '--'}
        </span>
      </div>
    );
  };

  // 渲染单个认证文件卡片
  const renderFileCard = (item: AuthFileItem) => {
    const fileStats = resolveAuthFileStats(item, keyStats);
    const isRuntimeOnly = isRuntimeOnlyAuthFile(item);
    const isAistudio = (item.type || '').toLowerCase() === 'aistudio';
    const isAntigravity = (item.type || '').toLowerCase() === 'antigravity';
    const showModelsButton = !isRuntimeOnly || isAistudio;
    const typeColor = getTypeColor(item.type || 'unknown');
    const hasDenoProxy = hasDenoProxyConfig(item);
    const isSelected = selectedFiles.has(item.name);
    const isDisabled = item.disabled === true;

    return (
      <div key={item.name} className={`${styles.fileCard} ${isDisabled ? styles.fileCardDisabled : ''}`}>
        <div className={styles.cardHeader}>
          {/* Antigravity 文件显示批量选择 checkbox */}
          {isAntigravity && (
            <input
              type="checkbox"
              className={styles.selectCheckbox}
              checked={isSelected}
              onChange={() => toggleFileSelection(item.name)}
              title={t('auth_files.select_file', { defaultValue: '选择此文件' })}
            />
          )}
          <span
            className={styles.typeBadge}
            style={{
              backgroundColor: typeColor.bg,
              color: typeColor.text,
              ...(typeColor.border ? { border: typeColor.border } : {})
            }}
          >
            {getTypeLabel(item.type || 'unknown')}
          </span>
          <span className={`${styles.fileName} ${fileNameBlurred ? styles.fileNameBlurred : ''}`}>
            {item.name}
          </span>
          {/* Deno 代理配置标识 */}
          {hasDenoProxy && (
            <span
              className={styles.denoProxyBadge}
              title={t('deno_proxy.configured_hint', { defaultValue: '已配置 Deno 代理' })}
            >
              Deno
            </span>
          )}
          {/* 禁用标识 */}
          {isDisabled && (
            <span
              className={styles.disabledBadge}
              title={t('auth_files.disabled_hint', { defaultValue: '已禁用' })}
            >
              {t('auth_files.disabled_label', { defaultValue: '已禁用' })}
            </span>
          )}
        </div>

        <div className={styles.cardMeta}>
          <span>{t('auth_files.file_size')}: {item.size ? formatFileSize(item.size) : '-'}</span>
          <span>{t('auth_files.file_modified')}: {formatModified(item)}</span>
        </div>

        <div className={styles.cardStats}>
          <span className={`${styles.statPill} ${styles.statSuccess}`}>
            {t('stats.success')}: {fileStats.success}
          </span>
          <span className={`${styles.statPill} ${styles.statFailure}`}>
            {t('stats.failure')}: {fileStats.failure}
          </span>
        </div>

        {/* 状态监测栏 */}
        {renderStatusBar(item)}

        <div className={styles.cardActions}>
          {showModelsButton && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => showModels(item)}
              className={styles.iconButton}
              title={t('auth_files.models_button', { defaultValue: '模型' })}
              disabled={disableControls}
            >
              <IconBot className={styles.actionIcon} size={16} />
            </Button>
          )}
          {isAntigravity && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openDenoProxyModal(item)}
              className={styles.iconButton}
              title={t('deno_proxy.config_button', { defaultValue: 'Deno 代理配置' })}
              disabled={disableControls}
            >
              <IconSettings className={styles.actionIcon} size={16} />
            </Button>
          )}
          {!isRuntimeOnly && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => showDetails(item)}
                className={styles.iconButton}
                title={t('common.info', { defaultValue: '关于' })}
                disabled={disableControls}
              >
                <IconInfo className={styles.actionIcon} size={16} />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleDownload(item.name)}
                className={styles.iconButton}
                title={t('auth_files.download_button')}
                disabled={disableControls}
              >
                <IconDownload className={styles.actionIcon} size={16} />
              </Button>
              {/* 启用/禁用按钮 - 放在下载按钮右边 */}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openToggleConfirmModal(item.name, isDisabled)}
                className={`${styles.iconButton} ${styles.toggleStatusButton}`}
                title={isDisabled
                  ? t('auth_files.enable_button', { defaultValue: '启用' })
                  : t('auth_files.disable_button', { defaultValue: '禁用' })}
                disabled={disableControls || togglingStatus === item.name}
              >
                {togglingStatus === item.name ? (
                  <LoadingSpinner size={14} />
                ) : (
                  <IconPower className={styles.actionIcon} size={16} />
                )}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleDelete(item.name)}
                className={styles.iconButton}
                title={t('auth_files.delete_button')}
                disabled={disableControls || deleting === item.name}
              >
                {deleting === item.name ? (
                  <LoadingSpinner size={14} />
                ) : (
                  <IconTrash2 className={styles.actionIcon} size={16} />
                )}
              </Button>
            </>
          )}
          {isRuntimeOnly && (
            <div className={styles.virtualBadge}>{t('auth_files.type_virtual') || '虚拟认证文件'}</div>
          )}
        </div>
      </div>
    );
  };

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t('auth_files.title_section')}</span>
      {files.length > 0 && <span className={styles.countBadge}>{files.length}</span>}
    </div>
  );

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('auth_files.title')}</h1>
        <p className={styles.description}>{t('auth_files.description')}</p>
      </div>

      <Card
        title={titleNode}
        extra={
          <div className={styles.headerActions}>
            {/* 眼睛图标 - 文件名模糊化切换 */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFileNameBlurred(!fileNameBlurred)}
              className={styles.eyeButton}
              title={fileNameBlurred
                ? t('auth_files.show_filenames', { defaultValue: '显示文件名' })
                : t('auth_files.hide_filenames', { defaultValue: '隐藏文件名' })}
            >
              {fileNameBlurred ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleHeaderRefresh}
              disabled={loading}
            >
              {t('common.refresh')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDeleteAll}
              disabled={disableControls || loading || deletingAll}
              loading={deletingAll}
            >
              {filter === 'all' ? t('auth_files.delete_all_button') : `${t('common.delete')} ${getTypeLabel(filter)}`}
            </Button>
            <Button size="sm" onClick={handleUploadClick} disabled={disableControls || uploading} loading={uploading}>
              {t('auth_files.upload_button')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        }
      >
        {error && <div className={styles.errorBox}>{error}</div>}

        {/* 筛选区域 */}
        <div className={styles.filterSection}>
          {renderFilterTags()}

          <div className={styles.filterControls}>
            <div className={styles.filterItem}>
              <label>{t('auth_files.search_label')}</label>
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={t('auth_files.search_placeholder')}
              />
            </div>
            <div className={styles.filterItem}>
              <label>{t('auth_files.page_size_label')}</label>
              <input
                className={styles.pageSizeSelect}
                type="number"
                min={MIN_CARD_PAGE_SIZE}
                max={MAX_CARD_PAGE_SIZE}
                step={1}
                value={pageSize}
                onChange={handlePageSizeChange}
              />
            </div>
          </div>
        </div>

        {/* 批量操作栏 - 当有 Antigravity 文件被选中时显示 */}
        {selectedFiles.size > 0 && (
          <div className={styles.batchActionsBar}>
            <span className={styles.batchActionsInfo}>
              {t('auth_files.batch_selected', {
                defaultValue: '已选择 {{count}} 个文件',
                count: selectedFiles.size
              })}
            </span>
            <div className={styles.batchActionsButtons}>
              <Button
                variant="secondary"
                size="sm"
                onClick={selectAllAntigravityFiles}
              >
                {t('auth_files.select_all_antigravity', { defaultValue: '全选 Antigravity' })}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={clearSelection}
              >
                {t('auth_files.clear_selection', { defaultValue: '取消选择' })}
              </Button>
              <Button
                size="sm"
                onClick={openBatchDenoProxyModal}
              >
                {t('deno_proxy.batch_config', { defaultValue: '批量配置 Deno 代理' })}
              </Button>
            </div>
          </div>
        )}

        {/* 卡片网格 */}
        {loading ? (
          <div className={styles.hint}>{t('common.loading')}</div>
        ) : pageItems.length === 0 ? (
          <EmptyState title={t('auth_files.search_empty_title')} description={t('auth_files.search_empty_desc')} />
        ) : (
          <div className={styles.fileGrid}>
            {pageItems.map(renderFileCard)}
          </div>
        )}

        {/* 分页 */}
        {!loading && filtered.length > pageSize && (
          <div className={styles.pagination}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              {t('auth_files.pagination_prev')}
            </Button>
            <div className={styles.pageInfo}>
              {t('auth_files.pagination_info', {
                current: currentPage,
                total: totalPages,
                count: filtered.length
              })}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
            >
              {t('auth_files.pagination_next')}
            </Button>
          </div>
        )}
      </Card>

      {/* OAuth 排除列表卡片 */}
      <Card
        title={t('oauth_excluded.title')}
        extra={
          <Button
            size="sm"
            onClick={() => openExcludedModal()}
            disabled={disableControls || excludedError === 'unsupported'}
          >
            {t('oauth_excluded.add')}
          </Button>
        }
      >
        {excludedError === 'unsupported' ? (
          <EmptyState
            title={t('oauth_excluded.upgrade_required_title')}
            description={t('oauth_excluded.upgrade_required_desc')}
          />
        ) : Object.keys(excluded).length === 0 ? (
          <EmptyState title={t('oauth_excluded.list_empty_all')} />
        ) : (
          <div className={styles.excludedList}>
            {Object.entries(excluded).map(([provider, models]) => (
              <div key={provider} className={styles.excludedItem}>
                <div className={styles.excludedInfo}>
                  <div className={styles.excludedProvider}>{provider}</div>
                  <div className={styles.excludedModels}>
                    {models?.length
                      ? t('oauth_excluded.model_count', { count: models.length })
                      : t('oauth_excluded.no_models')}
                  </div>
                </div>
                <div className={styles.excludedActions}>
                  <Button variant="secondary" size="sm" onClick={() => openExcludedModal(provider)}>
                    {t('common.edit')}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => deleteExcluded(provider)}>
                    {t('oauth_excluded.delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* OAuth 模型映射卡片 */}
      <Card
        title={t('oauth_model_mappings.title')}
        extra={
          <Button
            size="sm"
            onClick={() => openMappingsModal()}
            disabled={disableControls || modelMappingsError === 'unsupported'}
          >
            {t('oauth_model_mappings.add')}
          </Button>
        }
      >
        {modelMappingsError === 'unsupported' ? (
          <EmptyState
            title={t('oauth_model_mappings.upgrade_required_title')}
            description={t('oauth_model_mappings.upgrade_required_desc')}
          />
        ) : Object.keys(modelMappings).length === 0 ? (
          <EmptyState title={t('oauth_model_mappings.list_empty_all')} />
        ) : (
          <div className={styles.excludedList}>
            {Object.entries(modelMappings).map(([provider, mappings]) => (
              <div key={provider} className={styles.excludedItem}>
                <div className={styles.excludedInfo}>
                  <div className={styles.excludedProvider}>{provider}</div>
                  <div className={styles.excludedModels}>
                    {mappings?.length
                      ? t('oauth_model_mappings.model_count', { count: mappings.length })
                      : t('oauth_model_mappings.no_models')}
                  </div>
                </div>
                <div className={styles.excludedActions}>
                  <Button variant="secondary" size="sm" onClick={() => openMappingsModal(provider)}>
                    {t('common.edit')}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => deleteModelMappings(provider)}>
                    {t('oauth_model_mappings.delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 确认禁用/启用弹窗 */}
      <Modal
        open={toggleConfirmModalOpen}
        onClose={() => {
          setToggleConfirmModalOpen(false);
          setToggleConfirmTarget(null);
        }}
        title={
          toggleConfirmTarget?.currentDisabled
            ? t('auth_files.enable_confirm_title', { defaultValue: '确认启用' })
            : t('auth_files.disable_confirm_title', { defaultValue: '确认禁用' })
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setToggleConfirmModalOpen(false);
                setToggleConfirmTarget(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={confirmToggleStatus}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className={styles.toggleConfirmContent}>
          <p className={styles.toggleConfirmMessage}>
            {toggleConfirmTarget?.currentDisabled
              ? t('auth_files.enable_confirm_message', { defaultValue: '确定要启用此认证文件吗？' })
              : t('auth_files.disable_confirm_message', { defaultValue: '确定要禁用此认证文件吗？' })}
          </p>
          <div className={styles.toggleConfirmFileName}>
            {toggleConfirmTarget?.name || ''}
          </div>
          {!toggleConfirmTarget?.currentDisabled && (
            <p className={styles.toggleConfirmHint}>
              {t('auth_files.disable_confirm_hint', { defaultValue: '禁用后该文件将不会被使用' })}
            </p>
          )}
        </div>
      </Modal>

      {/* 详情弹窗 */}
      <Modal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={selectedFile?.name || t('auth_files.title_section')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDetailModalOpen(false)}>
              {t('common.close')}
            </Button>
            <Button
              onClick={() => {
                if (selectedFile) {
                  const text = JSON.stringify(selectedFile, null, 2);
                  navigator.clipboard.writeText(text).then(() => {
                    showNotification(t('notification.link_copied'), 'success');
                  });
                }
              }}
            >
              {t('common.copy')}
            </Button>
          </>
        }
      >
        {selectedFile && (
          <div className={styles.detailContent}>
            <pre className={styles.jsonContent}>{JSON.stringify(selectedFile, null, 2)}</pre>
          </div>
        )}
      </Modal>

      {/* 模型列表弹窗 */}
      <Modal
        open={modelsModalOpen}
        onClose={() => setModelsModalOpen(false)}
        title={t('auth_files.models_title', { defaultValue: '支持的模型' }) + ` - ${modelsFileName}`}
        footer={
          <Button variant="secondary" onClick={() => setModelsModalOpen(false)}>
            {t('common.close')}
          </Button>
        }
      >
        {modelsLoading ? (
          <div className={styles.hint}>{t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}</div>
        ) : modelsError === 'unsupported' ? (
          <EmptyState
            title={t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
            description={t('auth_files.models_unsupported_desc', { defaultValue: '请更新 CLI Proxy API 到最新版本后重试' })}
          />
        ) : modelsList.length === 0 ? (
          <EmptyState
            title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
            description={t('auth_files.models_empty_desc', { defaultValue: '该认证凭证可能尚未被服务器加载或没有绑定任何模型' })}
          />
        ) : (
          <div className={styles.modelsList}>
            {modelsList.map((model) => {
              const isExcluded = isModelExcluded(model.id, modelsFileType);
              return (
                <div
                  key={model.id}
                  className={`${styles.modelItem} ${isExcluded ? styles.modelItemExcluded : ''}`}
                  onClick={() => {
                    navigator.clipboard.writeText(model.id);
                    showNotification(t('notification.link_copied', { defaultValue: '已复制到剪贴板' }), 'success');
                  }}
                  title={isExcluded ? t('auth_files.models_excluded_hint', { defaultValue: '此模型已被 OAuth 排除' }) : t('common.copy', { defaultValue: '点击复制' })}
                >
                  <span className={styles.modelId}>{model.id}</span>
                  {model.display_name && model.display_name !== model.id && (
                    <span className={styles.modelDisplayName}>{model.display_name}</span>
                  )}
                  {model.type && (
                    <span className={styles.modelType}>{model.type}</span>
                  )}
                  {isExcluded && (
                    <span className={styles.modelExcludedBadge}>{t('auth_files.models_excluded_badge', { defaultValue: '已排除' })}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* OAuth 排除弹窗 */}
      <Modal
        open={excludedModalOpen}
        onClose={() => setExcludedModalOpen(false)}
        title={t('oauth_excluded.add_title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setExcludedModalOpen(false)} disabled={savingExcluded}>
              {t('common.cancel')}
            </Button>
            <Button onClick={saveExcludedModels} loading={savingExcluded}>
              {t('oauth_excluded.save')}
            </Button>
          </>
        }
      >
        <div className={styles.providerField}>
          <Input
            id="oauth-excluded-provider"
            list="oauth-excluded-provider-options"
            label={t('oauth_excluded.provider_label')}
            hint={t('oauth_excluded.provider_hint')}
            placeholder={t('oauth_excluded.provider_placeholder')}
            value={excludedForm.provider}
            onChange={(e) => setExcludedForm((prev) => ({ ...prev, provider: e.target.value }))}
          />
          <datalist id="oauth-excluded-provider-options">
            {providerOptions.map((provider) => (
              <option key={provider} value={provider} />
            ))}
          </datalist>
          {providerOptions.length > 0 && (
            <div className={styles.providerTagList}>
              {providerOptions.map((provider) => {
                const isActive =
                  excludedForm.provider.trim().toLowerCase() === provider.toLowerCase();
                return (
                  <button
                    key={provider}
                    type="button"
                    className={`${styles.providerTag} ${isActive ? styles.providerTagActive : ''}`}
                    onClick={() => setExcludedForm((prev) => ({ ...prev, provider }))}
                    disabled={savingExcluded}
                  >
                    {getTypeLabel(provider)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className={styles.formGroup}>
          <label>{t('oauth_excluded.models_label')}</label>
          <textarea
            className={styles.textarea}
            rows={4}
            placeholder={t('oauth_excluded.models_placeholder')}
            value={excludedForm.modelsText}
            onChange={(e) => setExcludedForm((prev) => ({ ...prev, modelsText: e.target.value }))}
          />
          <div className={styles.hint}>{t('oauth_excluded.models_hint')}</div>
        </div>
      </Modal>

      {/* OAuth 模型映射弹窗 */}
      <Modal
        open={mappingModalOpen}
        onClose={() => setMappingModalOpen(false)}
        title={t('oauth_model_mappings.add_title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMappingModalOpen(false)} disabled={savingMappings}>
              {t('common.cancel')}
            </Button>
            <Button onClick={saveModelMappings} loading={savingMappings}>
              {t('oauth_model_mappings.save')}
            </Button>
          </>
        }
      >
        <div className={styles.providerField}>
          <Input
            id="oauth-model-alias-provider"
            list="oauth-model-alias-provider-options"
            label={t('oauth_model_mappings.provider_label')}
            hint={t('oauth_model_mappings.provider_hint')}
            placeholder={t('oauth_model_mappings.provider_placeholder')}
            value={mappingForm.provider}
            onChange={(e) => setMappingForm((prev) => ({ ...prev, provider: e.target.value }))}
          />
          <datalist id="oauth-model-alias-provider-options">
            {providerOptions.map((provider) => (
              <option key={provider} value={provider} />
            ))}
          </datalist>
          {providerOptions.length > 0 && (
            <div className={styles.providerTagList}>
              {providerOptions.map((provider) => {
                const isActive =
                  mappingForm.provider.trim().toLowerCase() === provider.toLowerCase();
                return (
                  <button
                    key={provider}
                    type="button"
                    className={`${styles.providerTag} ${isActive ? styles.providerTagActive : ''}`}
                    onClick={() => setMappingForm((prev) => ({ ...prev, provider }))}
                    disabled={savingMappings}
                  >
                    {getTypeLabel(provider)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className={styles.formGroup}>
          <label>{t('oauth_model_mappings.mappings_label')}</label>
          <div className="header-input-list">
            {(mappingForm.mappings.length ? mappingForm.mappings : [buildEmptyMappingEntry()]).map(
              (entry, index) => (
                <div key={entry.id} className={styles.mappingRow}>
                  <input
                    className="input"
                    placeholder={t('oauth_model_mappings.mapping_name_placeholder')}
                    value={entry.name}
                    onChange={(e) => updateMappingEntry(index, 'name', e.target.value)}
                    disabled={savingMappings}
                  />
                  <span className={styles.mappingSeparator}>→</span>
                  <input
                    className="input"
                    placeholder={t('oauth_model_mappings.mapping_alias_placeholder')}
                    value={entry.alias}
                    onChange={(e) => updateMappingEntry(index, 'alias', e.target.value)}
                    disabled={savingMappings}
                  />
                  <div className={styles.mappingFork}>
                    <ToggleSwitch
                      label={t('oauth_model_mappings.mapping_fork_label')}
                      labelPosition="left"
                      checked={Boolean(entry.fork)}
                      onChange={(value) => updateMappingEntry(index, 'fork', value)}
                      disabled={savingMappings}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeMappingEntry(index)}
                    disabled={savingMappings || mappingForm.mappings.length <= 1}
                    title={t('common.delete')}
                    aria-label={t('common.delete')}
                  >
                    <IconX size={14} />
                  </Button>
                </div>
              )
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={addMappingEntry}
              disabled={savingMappings}
              className="align-start"
            >
              {t('oauth_model_mappings.add_mapping')}
            </Button>
          </div>
          <div className={styles.hint}>{t('oauth_model_mappings.mappings_hint')}</div>
        </div>
      </Modal>

      {/* Deno 代理配置弹窗 */}
      <Modal
        open={denoProxyModalOpen}
        onClose={() => setDenoProxyModalOpen(false)}
        title={t('deno_proxy.modal_title', { defaultValue: 'Deno 代理配置' }) + ` - ${denoProxyFile?.name || ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDenoProxyModalOpen(false)} disabled={savingDenoProxy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={saveDenoProxyConfig} loading={savingDenoProxy}>
              {t('common.save', { defaultValue: '保存' })}
            </Button>
          </>
        }
      >
        <div className={styles.formGroup}>
          <Input
            label={t('deno_proxy.host_label', { defaultValue: 'Deno 代理地址' })}
            hint={t('deno_proxy.host_hint', { defaultValue: '例如: https://xxxxx.deno.dev（留空则禁用代理，系统会根据请求自动选择 sandbox/daily/prod 路径）' })}
            placeholder="https://xxxxx.deno.dev"
            value={denoProxyForm.denoHost}
            onChange={(e) => setDenoProxyForm((prev) => ({ ...prev, denoHost: e.target.value }))}
            disabled={savingDenoProxy}
          />
        </div>
      </Modal>

      {/* 批量配置 Deno 代理弹窗 */}
      <Modal
        open={batchDenoProxyModalOpen}
        onClose={() => setBatchDenoProxyModalOpen(false)}
        title={t('deno_proxy.batch_modal_title', {
          defaultValue: '批量配置 Deno 代理 ({{count}} 个文件)',
          count: selectedFiles.size
        })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBatchDenoProxyModalOpen(false)} disabled={savingBatchDenoProxy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={saveBatchDenoProxyConfig} loading={savingBatchDenoProxy}>
              {t('common.save', { defaultValue: '保存' })}
            </Button>
          </>
        }
      >
        <div className={styles.formGroup}>
          <Input
            label={t('deno_proxy.host_label', { defaultValue: 'Deno 代理地址' })}
            hint={t('deno_proxy.batch_host_hint', { defaultValue: '所有选中的文件将使用相同的代理地址。留空则删除选中文件的代理配置。' })}
            placeholder="https://xxxxx.deno.dev"
            value={batchDenoProxyForm.denoHost}
            onChange={(e) => setBatchDenoProxyForm((prev) => ({ ...prev, denoHost: e.target.value }))}
            disabled={savingBatchDenoProxy}
          />
        </div>
      </Modal>
    </div>
  );
}
