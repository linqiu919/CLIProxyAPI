# Changelog

## [Unreleased]

### Changed - 前端路由改造为多路由访问（/panel/ 前缀）

**原因：** 将前端从单页面 Hash 路由模式改为服务端支持的多路由访问，支持直接访问子路由路径。由于 AMP 模块占用了 `/settings` 等根级路由，前端使用 `/panel/` 前缀避免冲突。

**修改文件：**
- `internal/api/server.go` - 添加 `/panel/` 前缀的前端路由支持
- `web/src/App.tsx` - 将 `HashRouter` 改为 `BrowserRouter`，动态设置 `basename`
- `web/vite.config.ts` - 根据 mode 动态设置 `base`（开发 `/`，生产 `/panel/`）
- `config.example.yaml` - 移除 `panel-github-repository` 配置项（前端已嵌入）

**变更内容：**

1. **后端路由支持：**
   - 移除 `/management.html` 路由
   - 新增 `/panel/` 前缀的前端路由映射：
     - `/panel`, `/panel/`, `/panel/login`, `/panel/dashboard`, `/panel/settings`
     - `/panel/api-keys`, `/panel/ai-providers`, `/panel/auth-files`, `/panel/oauth`
     - `/panel/quota`, `/panel/usage`, `/panel/config`, `/panel/logs`, `/panel/system`
   - 静态资源路由：`/panel/assets/*filepath`
   - 保留 `/` 路径的 JSON 响应

2. **前端路由模式：**
   - 从 `HashRouter`（URL 格式：`/management.html#/dashboard`）
   - 改为 `BrowserRouter`（URL 格式：`/panel/dashboard`）
   - 开发模式：`basename='/'`，生产模式：`basename='/panel'`

3. **Vite 配置动态化：**
   - 开发模式：`base: '/'`（直接访问 Vite 开发服务器）
   - 生产模式：`base: '/panel/'`（嵌入后端的静态资源）

4. **访问入口变更：**
   - 旧入口：`/management.html`
   - 新入口：`/panel/` 或 `/panel/login`

5. **gzip 压缩范围：**
   - 仅应用于前端静态资源（`/panel/*` 路由和 `/panel/assets/*`）
   - 不影响后端 API 路由（`/v0/*`, `/v1/*`, `/v1beta/*` 等）

6. **配置精简：**
   - 从 `config.example.yaml` 移除 `panel-github-repository` 配置项
   - 前端已嵌入二进制，不再需要从 GitHub 下载

---

### Fixed - 前端资源加载性能优化

**原因：** 前端 JS 文件约 1.4MB，未压缩传输导致页面加载需要 30+ 秒。

**修改文件：**
- `internal/api/server.go` - 添加 gzip 中间件和缓存头
- `go.mod` / `go.sum` - 添加 `github.com/gin-contrib/gzip` 依赖
- `web/src/components/ui/Modal.tsx` - 修复 TypeScript 类型错误

**变更内容：**

1. **gzip 压缩：**
   - 使用 `gin-contrib/gzip` 中间件自动压缩响应
   - JS 文件从 1.4MB 压缩到约 500KB

2. **缓存头优化：**
   - 为静态资源（`/assets/*`）添加 `Cache-Control: public, max-age=31536000, immutable`
   - 利用 Vite 的哈希文件名实现长期缓存

---

### Changed - 前端资源嵌入方式改造

**原因：** 解决 single-file 方式构建时页面加载 pending 的问题，改用更灵活的 embed.FS 嵌入整个 dist 目录。

**修改文件：**
- `web/vite.config.ts` - 移除 `vite-plugin-singlefile` 插件
- `web/package.json` - 移除 `copy-to-embed` 脚本和 `vite-plugin-singlefile` 依赖
- `internal/managementasset/embed.go` - 改用 `embed.FS` 嵌入整个 dist 目录
- `internal/api/server.go` - 新增 `serveManagementAssets` 方法服务静态资源
- `Dockerfile` - 复制整个 dist 目录而非单个 HTML 文件

**变更内容：**

1. **前端构建方式：**
   - 移除 single-file 插件，改用 Vite 标准多文件输出
   - 输出结构：`dist/index.html` + `dist/assets/*.js` + `dist/assets/*.css`

2. **后端嵌入方式：**
   - 使用 `embed.FS` 嵌入整个 `dist` 目录
   - 提供 `DistFS()` 函数返回嵌入的文件系统
   - 保留 `EmbeddedHTML()` 函数用于兼容

3. **静态资源服务：**
   - 新增 `/assets/*filepath` 路由服务 JS/CSS 等静态资源
   - 根据文件后缀自动设置 Content-Type

4. **目录结构变更：**
   - 移除 `internal/managementasset/static/` 目录
   - 新增 `internal/managementasset/dist/` 目录（含占位文件）

---

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

