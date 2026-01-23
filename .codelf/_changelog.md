## 2025-02-14 11:20:00

### 1. 持久化管理密钥支持刷新登录

**Change Type**: fix

> **Purpose**: 未勾选记住密码时刷新仍保持登录
> **Detailed Description**: 调整持久化策略，始终保存 managementKey（加密存储），记住密码仅影响 UI 勾选状态。
> **Reason for Change**: 取消记住密码后刷新会回到登录页
> **Impact Scope**: web/src/stores/useAuthStore.ts
> **API Changes**: 无
> **Configuration Changes**: 无
> **Performance Impact**: 可忽略

   ```
   root
   - web/src/stores/useAuthStore.ts // fix 持久化 managementKey
   ```

## 2025-02-14 10:30:00

### 1. 修复刷新后登录态丢失

**Change Type**: fix

> **Purpose**: 刷新页面后保持登录态
> **Detailed Description**: 调整前端登录态恢复逻辑，避免依赖记住密码标记；只要本地存在 apiBase 与 managementKey 就尝试自动登录并恢复配置。
> **Reason for Change**: 之前刷新后进入登录页，影响使用体验
> **Impact Scope**: web/src/stores/useAuthStore.ts
> **API Changes**: 无
> **Configuration Changes**: 无
> **Performance Impact**: 可忽略

   ```
   root
   - web/src/stores/useAuthStore.ts // fix 恢复登录态逻辑
   ```
