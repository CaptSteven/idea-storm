# SOPFlow

> 本地优先的浏览器操作记录器：将网页步骤整理为可编辑、可导出的 SOP。

**技术栈：** Chrome Manifest V3 · JavaScript · Node.js · IndexedDB

**使用边界：** 步骤文本在启用真实模型时会发送至配置的服务；截图导出前仍需人工检查。

---

SOPFlow 是一个本地优先的 Chrome MV3 网页操作记录器。扩展把点击、输入、选择、提交和页面跳转整理为 Session v2 记录，再在本地工作台中编辑、优化和导出 SOP。

## 项目组成

- `extension/`：主产品，Chrome MV3 扩展
- `server.js`：仅监听本机的 AI 适配服务
- `index.html`：可直接体验的 Session v2 示例工作台
- `assets/`：示例步骤使用的业务页面截图
- `scripts/`：演示服务器、语法检查、素材生成和安全打包脚本
- `tests/`：隐私规则、服务端接口、扩展 E2E 和响应式页面验证

## 环境要求

- Node.js 22 或更高版本
- Chrome 109 或更高版本
- `zip` 和 `unzip`，仅打包扩展时需要

安装依赖：

```bash
npm install
```

## 示例工作台

```bash
npm start
```

打开 `http://127.0.0.1:4173`。页面内置两份 Session v2 示例，可编辑元数据和步骤、调整顺序、移除截图、应用示例优化，并导出 Markdown、HTML 或 JSON。修改保存在浏览器 `localStorage` 中。

## 加载 Chrome 扩展

1. 打开 `chrome://extensions/`。
2. 启用“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择：

```text
<仓库根目录>/extension
```

扩展会把会话和截图保存在扩展自己的 IndexedDB 中；设置和活动标签映射保存在 `chrome.storage.local` 中。

## 本地 AI 后端

复制 `.env.example` 中需要的值到当前 shell 或本地 `.env` 管理工具。项目不会自动读取 `.env` 文件。

无 API Key 的完整链路验证：

```bash
npm run ai-server:mock
```

真实模型：

```bash
OPENAI_API_KEY=your_key npm run ai-server
```

默认地址是 `http://127.0.0.1:8787`。扩展只接受 `localhost`、`127.0.0.1` 或 `::1` 的 HTTP 后端地址。服务端可通过 `AI_BASE_URL` 和 `AI_MODEL` 连接兼容 OpenAI Chat Completions 的模型服务。

## 隐私模型

- 不记录文本框、文本域或可编辑区域的原始输入值
- 密码、验证码、邮箱、电话、账号、证件和银行卡等字段只记录为“已脱敏”
- URL 自动移除用户名、密码、查询参数和 hash
- 截图可完全关闭
- 开启自动脱敏时，敏感字段可视区域会被模糊；无法执行脱敏时该截图会被取消
- 截图只保存在本地 IndexedDB，不会发送给 AI 后端
- AI 后端只接收经过清洗的步骤文本和 URL；真实模式下这些文本会转发给配置的模型提供方
- 单个会话最多保留 80 个步骤，避免无限增长

截图脱敏是降低误泄漏风险的辅助措施，导出前仍应人工检查图片和步骤说明。

## 常用命令

```bash
npm run check          # JavaScript 语法、隐私规则和服务端接口测试
npm run test:e2e       # Chrome 扩展录制、编辑、mock AI 和导出流程
npm run test:demo      # 示例工作台桌面/移动端浏览器验证
npm run assets:generate # 重新生成示例业务截图
npm run package        # 生成 dist/sopflow-extension.zip
```

打包脚本只归档 `extension/`，并在打包前后拒绝 `.pem`、`.key` 和 `.crx` 文件。ZIP 根目录直接包含 `manifest.json`。

## 签名材料

签名密钥不属于源码，也不会进入 Git 或扩展 ZIP；签名和分发前应自行确认密钥用途与格式。

## 已知限制

- 不支持 `chrome://`、Chrome Web Store 等浏览器受保护页面
- 当前记录的是关键网页操作和可选截图，不是完整视频
- 每个标签页同时只维护一个活动录制会话
- 页面卸载过快时，最后一个尚未完成的异步截图可能被取消
- SPA 路由只覆盖 `pushState`、`replaceState` 和 `popstate`
- 没有云同步、账号系统或团队协作能力
- HTML 导出包含截图，JSON 导出可能较大

<!-- 更新备注：YANG KAISEN，2026-11-11；改写与核对依据见工作区变更记录。 -->
