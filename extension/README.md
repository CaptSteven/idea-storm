# SOPFlow Recorder Chrome Extension

本目录是 SOPFlow 的 Chrome MV3 插件版。

## 当前能力

- 在当前网页注入记录器
- 记录点击、输入、选择等关键操作
- 为每个步骤截取当前页面截图
- 停止记录后打开 SOP 文档页
- 在文档页编辑步骤名称、操作说明、检查标准
- 调用本地 AI 后端优化 SOP 文案、风险提示、检查项
- 导出 Markdown、HTML、JSON

## 启动 AI 后端

真实模型调用：

```bash
OPENAI_API_KEY=你的_key npm run ai-server
```

可选环境变量：

```bash
AI_MODEL=gpt-4.1-mini
AI_BASE_URL=https://api.openai.com/v1
PORT=8787
```

无 API key 时可以启动 mock 后端验证插件链路：

```bash
npm run ai-server:mock
```

默认后端地址是：

```text
http://127.0.0.1:8787
```

## 本地加载

1. 打开 Chrome。
2. 进入 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择这个目录：

   `/Users/wasabi/项目/idea风暴/extension`

## 使用流程

1. 打开需要记录的业务网页。
2. 点击 Chrome 工具栏里的 SOPFlow。
3. 点击“开始记录”。
4. 正常执行操作流程。
5. 再次点击 SOPFlow，点击“停止并生成”。
6. 在打开的 SOP 页面点击“AI 优化 SOP”。
7. 校对 AI 生成结果并导出文档。

## 已知边界

- 当前版本记录网页操作和页面截图，不做完整视频录制。
- 不支持 `chrome://`、Chrome Web Store 等浏览器受保护页面。
- 不建议在含密码、身份证、银行卡等敏感信息的页面开启记录。
- 同一个 tab 内页面跳转后会尝试自动恢复记录状态；浏览器受保护页面仍无法记录。
- 导航点击会先保存步骤再补截图，避免跳转太快导致步骤丢失。
- 支持常见单页应用的 `pushState` / `replaceState` 路由变化记录。
- AI 后端只接收步骤文本、目标元素、URL 和时间点；当前版本不会把截图传给 AI。
