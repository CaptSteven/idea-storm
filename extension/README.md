# SOPFlow Recorder

`extension/` 是 SOPFlow 的 Chrome MV3 主产品。版本 `0.2.0` 使用 Session v2 数据结构、IndexedDB 会话库和本地 AI 后端。

## 记录内容

- 点击、输入/选择、表单提交和 SPA 页面跳转
- 清洗后的页面 URL、元素名称、步骤时间和检查标准
- 可选的当前可视区域截图
- 每个标签页一个活动会话，每个会话最多 80 步

文本输入只记录“已输入”或“已脱敏”，不会写入原始值。URL 会移除查询参数、hash 和凭据。

## 安装

Chrome 打开 `chrome://extensions/`，启用开发者模式并加载：

```text
/Users/wasabi/projects/Android_Project/idea风暴/extension
```

若使用打包产物，先在项目根目录运行：

```bash
npm run package
```

产物为 `dist/sopflow-extension.zip`。不要把 PEM、KEY 或 CRX 文件放进 `extension/`。

## 使用

1. 打开要记录的普通网页。
2. 点击工具栏中的 SOPFlow，按需关闭截图或自动脱敏。
3. 点击“开始记录”并执行流程。
4. 再次打开 SOPFlow，停止记录。
5. 在工作台编辑步骤、调整顺序、删除截图或创建副本。
6. 启动本地 AI 后端后执行 AI 优化。
7. 校对并导出 Markdown、独立 HTML、JSON 或打印为 PDF。

## AI 后端

Mock 模式：

```bash
npm run ai-server:mock
```

真实模式：

```bash
OPENAI_API_KEY=your_key npm run ai-server
```

工作台默认连接 `http://127.0.0.1:8787`，并只允许本机 HTTP 地址。截图不会发送到后端。

## 本地数据

- IndexedDB `sopflow/sessions`：Session v2 元数据和步骤
- IndexedDB `sopflow/screenshots`：JPEG Blob 截图
- `chrome.storage.local`：设置、活动标签映射和旧数据迁移标记

旧版 `chrome.storage.local` 会话会在安装或启动时迁移到 IndexedDB，迁移完成后删除旧会话对象。

## 截图脱敏

内容脚本扫描可见的输入、选择和可编辑字段。字段类型、`autocomplete`、名称、ID、无障碍标签或占位文字命中敏感规则时，对应区域会在保存前模糊。若当前浏览器无法执行画布脱敏，该截图不会保存。

自动脱敏不能替代人工检查。复杂组件、跨域 iframe、Canvas、图片中的文字以及未被规则识别的自定义字段可能无法自动处理。

## 边界

- 不支持浏览器管理页和扩展商店页面
- 不捕获完整视频、网络请求或键盘内容
- 页面快速关闭时最后一张异步截图可能来不及保存
- 截图和历史记录没有跨设备同步
- 本地存储超过 250 MiB 时工作台会提示清理
