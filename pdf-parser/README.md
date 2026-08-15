# StdForge PDF Parser

独立的 PDF 上传、MinerU 解析、文本预览和结果下载页面，不依赖 StdForge 主页面。

## 启动

要求 Node.js 20+、系统命令 `/usr/bin/unzip` 和有效的 MinerU API Token。

```bash
cd stdforge
PORT=4174 MINERU_TOKEN='<your-token>' node pdf-parser/server.mjs
```

浏览器访问 `http://127.0.0.1:4174`。

线上部署时，解析服务需要同时满足以下条件：

- 解析服务以 `HOST=0.0.0.0 PORT=4175 node pdf-parser/server.mjs` 运行；
- 网关将 `/api/*` 反向代理到该服务；
- `MINERU_TOKEN`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET` 只以部署平台的 Secret 注入，绝不提交到 Git。

## 输入输出

输入：单个 PDF 文件，演示限制为 30 MB。

输出：

- 右侧 Markdown 阅读视图和源码视图；
- 用户上传的原始 PDF；
- MinerU 生成的 Markdown；
- 包含内容列表、版面 JSON、模型 JSON、图片和 Markdown 的完整 ZIP。

MinerU 返回 `done` 后，结果 ZIP 会从其 CDN 下载。网络中断或 CDN 短暂重置时，服务会自动重试 3 次（1 秒、2 秒退避）；三次都失败会返回“MinerU 已完成解析，但下载结果失败，可重试”，而不会误报为 PDF 解析失败。

令牌只从 `MINERU_TOKEN` 环境变量读取。上传文件和解析结果保存在 `pdf-parser/.runtime/`，该目录被 Git 忽略。

## 飞书在线文档同步

在仓库根目录 `.env.local` 配置 `FEISHU_APP_ID` 与 `FEISHU_APP_SECRET` 后，解析完成页面会显示“同步到飞书在线文档”。粘贴一个应用已被授予编辑权限的飞书文档或知识库文档链接，即可将本次 Markdown 以 `append` 模式追加到文末。

服务端会先通过 `fetch-doc` 验证目标可访问，再调用飞书远程 MCP 的 `update-doc`。它不会覆盖现有文档；同一个解析任务再次同步到同一链接时会防止重复写入。
