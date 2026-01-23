# Changelog

## [Unreleased]

### Added - Deno 代理相关功能增强

**修改文件：**
- `web/src/pages/AuthFilesPage.tsx`
- `web/src/pages/AuthFilesPage.module.scss`
- `internal/runtime/executor/antigravity_executor.go`
- `internal/api/handlers/management/auth_files.go` - 在 `buildAuthFileEntry` 中返回 `deno_proxy_host` 字段

**新增功能：**

1. **Deno 代理配置标识：**
   - 在认证文件卡片上显示 "Deno" 徽章，表示该文件已配置 Deno 代理
   - 通过检查 `deno_proxy_host` 或 `denoProxyHost` 字段判断是否配置

2. **批量选择配置 Deno 代理：**
   - Antigravity 类型的文件显示 checkbox，支持多选
   - 选中文件后显示批量操作栏，包含"全选 Antigravity"、"取消选择"、"批量配置 Deno 代理"按钮
   - 批量配置弹窗支持为多个文件统一设置或删除 Deno 代理配置

3. **文件名模糊化眼睛图标：**
   - 在刷新按钮左侧新增眼睛图标按钮
   - 点击后切换文件名的模糊化显示状态
   - 悬停时模糊效果减弱

4. **Deno 代理转发日志记录：**
   - 在 `applyDenoProxy` 函数中添加日志，记录转发前地址和转发后地址
   - 在 HTTP 请求执行后记录转发结果（成功/失败，状态码/错误信息）
   - 日志格式：`deno proxy: forwarding [auth=xxx] from xxx -> xxx`

---

### Changed - 移除登录页面连接地址相关功能

**原因：** 前后端已合并，不再需要显示或自定义 API 连接地址。

**修改文件：**
- `web/src/pages/LoginPage.tsx`

**移除内容：**
- 移除 `apiBase` 状态和 `showCustomBase` 状态
- 移除"当前连接地址"显示区域
- 移除自定义连接地址的 checkbox 和输入框 UI
- 移除 `useMemo` 导入（不再需要）
- `apiBase` 直接在登录时调用 `detectApiBaseFromLocation()` 获取

---

### Fixed - 修复"记住密码"功能行为

**修改文件：**
- `web/src/types/auth.ts`
- `web/src/stores/useAuthStore.ts`
- `web/src/pages/LoginPage.tsx`

**问题描述：**
原来的"记住密码"功能逻辑错误，控制的是刷新页面后是否保持登录状态，而不是标准的"记住密码"行为。

**修改内容：**

1. **分离两个独立功能：**
   - **登录状态保持**：无论是否勾选"记住密码"，只要用户成功登录，刷新页面都应该保持登录状态
   - **记住密码**：仅控制是否在登录页面预填充密码

2. **新增 `savedPasswordForLogin` 字段：**
   - 类型定义：`AuthState` 新增 `savedPasswordForLogin: string`
   - 仅当 `rememberPassword` 为 true 时保存密码
   - 用于登录页面的密码预填充

3. **修改 `login` 方法：**
   - 始终保存 `managementKey` 用于会话保持
   - 根据 `rememberPassword` 决定是否保存 `savedPasswordForLogin`

4. **修改 `logout` 方法：**
   - 清除 `managementKey`（结束会话）
   - 保留 `apiBase`（方便下次登录）
   - 保留 `savedPasswordForLogin` 和 `rememberPassword`（用户偏好设置）

5. **修改 `restoreSession` 方法：**
   - 始终使用 `managementKey` 尝试恢复登录（无论 `rememberPassword` 值）

6. **修改 `LoginPage.tsx` 密码预填充逻辑：**
   - 如果 `rememberPassword` 为 true：预填充 `savedPasswordForLogin`
   - 如果 `rememberPassword` 为 false：不预填充密码

