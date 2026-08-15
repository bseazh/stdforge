# StdForge PDF Parser

独立的 PDF 上传、MinerU 解析、文本预览和结果下载页面，不依赖 StdForge 主页面。

## 启动

要求 Node.js 20+、系统命令 `/usr/bin/unzip` 和有效的 MinerU API Token。

```bash
cd stdforge
PORT=4174 MINERU_TOKEN='<your-token>' node pdf-parser/server.mjs
```

浏览器访问 `http://127.0.0.1:4174`。

## 输入输出

输入：单个 PDF 文件，演示限制为 30 MB。

输出：

- 右侧 Markdown 阅读视图和源码视图；
- 用户上传的原始 PDF；
- MinerU 生成的 Markdown；
- 包含内容列表、版面 JSON、模型 JSON、图片和 Markdown 的完整 ZIP。

令牌只从 `MINERU_TOKEN` 环境变量读取。上传文件和解析结果保存在 `pdf-parser/.runtime/`，该目录被 Git 忽略。
