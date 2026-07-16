# SOPFlow

SOPFlow 是一个“网页操作转 SOP”的本地 MVP。

## 目录

- `index.html` / `app.js` / `styles.css`：静态 Web 原型
- `extension/`：Chrome MV3 插件
- `server.js`：本地 AI 后端

## 启动 AI 后端

真实模型：

```bash
OPENAI_API_KEY=你的_key npm run ai-server
```

mock 验证：

```bash
npm run ai-server:mock
```

接口：

- `GET /health`
- `POST /api/generate-sop`

后端兼容 OpenAI 风格的 `/v1/chat/completions`。可通过环境变量替换：

```bash
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
PORT=8787
```

## 插件加载

Chrome 打开 `chrome://extensions/`，启用开发者模式，加载目录：

```text
/Users/wasabi/项目/idea风暴/extension
```
