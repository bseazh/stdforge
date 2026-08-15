# StdForge Knowledge Database

`KDB/` 是文档知识库的持久化根目录。服务启动时会维护三个业务分区：

```text
KDB/
├── standard-drafting/  # 标准编写材料、草案与编制说明
├── standards/          # 标准文本、公告与规范性引用材料
├── policies/           # 法律法规、政策原文与解读依据
└── .system/catalog.json # 文档元数据、哈希与可检索文本分块索引
```

每次入库都会将可读取内容转换为 UTF-8 Markdown 文本，保留文件名、文本哈希、入库时间、来源类型和分区，并按段落切分为检索片段。相同分区内相同文本会复用已有索引。

## 文档进入知识库

- PDF：通过 `POST /api/parse?module=standards` 调用 MinerU。解析完成后会自动入库并更新索引。
- DOCX、TXT、Markdown、CSV：通过 `POST /api/kb/imports?module=...&filename=...` 直接提取文本并入库。
- 解析页可选择入库分区；非 PDF 文件会直接执行文本提取与索引。

## 检索与问答

- `POST /api/kb/search`：关键词检索，返回命中的文档、分区、片段编号和原文摘录。
- `POST /api/kb/ask`：先检索，再由可选 LLM 生成带片段编号的答案；未配置 LLM 时返回可核验的原文片段。
- `POST /api/kb/reindex`：在手动维护文本后重建全部分块索引。

LLM 使用 OpenAI Chat Completions 兼容接口，凭据仅通过环境变量注入：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。模型只会收到检索命中的片段，提示词要求回答标记对应引用；它不能替代标准和政策的人工审核。
