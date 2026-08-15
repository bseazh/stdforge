# 模块一：标准协同编制技术方案

## 1. 目标与范围

模块一解决标准化工程师从研发技术要求、参数表或技术方案，到可审查、可协同、可发布标准草案的转换问题。目标不是让大模型自动发布国家标准，而是将文件解析、模板约束、AI 候选生成、人工修订、飞书协同、审批反馈和知识检索组织为一条可追溯的编制链路。

| 编号 | 子能力 | 解决的问题 |
| --- | --- | --- |
| M1-1 | AI 辅助标准草案生成 | 将研发技术要求转化为标准草案、编制说明和预研报告。 |
| M1-2 | 模板抽取与参数映射 | 从参考标准 PDF 或企业模板抽取章节和字段，把输入参数回填为标准条款。 |
| M1-3 | 在线协同与规范性审核 | 支持多人围绕条款、意见和版本协同，并发现规范性问题。 |
| M1-4 | 中英文版本协同输出 | 使用术语库约束逐段翻译，保留中英文对齐和修订记录。 |
| M1-5 | 预审、意见反馈与发布 | 复用飞书文档、IM 和审批完成评审、修改、复核和归档。 |
| M1-6 | 标准知识库与 Agent RAG | 建立可更新索引，支持检索、差异分析、证据引用和审核建议。 |

## 2. 总体架构

    研发技术要求 DOCX / PDF / TXT
                |
                +-- DOCX、TXT 本地文本提取
                +-- PDF 经 MinerU 解析为 Markdown、表格和图片
                +-- 原件存证：来源、哈希、解析器版本、任务状态
                |
                v
    字段识别与缺口检查
                |
                +-- 产品范围、术语、功能和性能
                +-- 样品、环境、仪器、试验步骤和判定规则
                +-- 引用文件、法规线索和待确认事项
                |
                v
    模板 JSON + 参考标准结构 + LLM 条款映射
                |
                +-- 标准草案
                +-- 编制说明
                +-- 预研报告
                |
                v
    模块一编辑器 -> 飞书文档协同 -> 飞书审批 -> 已批准归档
                |
                v
    知识库索引 -> Agent RAG -> 检索、对比、引用证据和审核建议

### 2.1 设计原则

1. 原件不改：原始文件、来源链接、哈希和解析版本必须保留。
2. AI 不越权：AI 只能生成候选内容，不能自行补造标准编号、法规、起草单位或性能限值。
3. 待确认显式化：研发输入缺失的条件、阈值、抽样规则和引用文件必须保留为“待确认”。
4. 条款可追溯：生成内容应记录来源字段、模板版本、模型版本、人工修改和审批状态。
5. 飞书只做协作与流程：企业正式发布仍以受控归档库、标准管理系统或 OA 为准。

## 3. M1-1：AI 辅助标准草案生成

### 3.1 输入、处理和输出

| 输入 | 处理 | 输出 |
| --- | --- | --- |
| DOCX、PDF、TXT、Markdown、CSV | MinerU 或本地文本提取 | 可检索 Markdown 和结构化文本 |
| 产品范围、型号、场景、术语 | 字段识别与缺口检查 | 范围、术语和定义、分类与型号 |
| 性能、安全、可靠性指标 | 将指标拆为对象、条件、限值、单位、判定方式 | 技术要求候选条款 |
| 样品、环境、仪器、步骤、公式 | 建立指标与试验方法的关联 | 试验方法、检验规则、附录记录表 |
| 参考文件和待确认项 | 引用文件分类和风险标注 | 编制说明、预研报告、待确认清单 |

### 3.2 生成流程

1. 将输入文件统一为 Markdown 中间层。
2. 根据行业模板识别可用字段，未命中的字段进入缺口列表。
3. 以模板章节为约束，调用 LLM 生成三份 Markdown 文档。
4. 保存可编辑中间稿，再导出 DOCX 或 PDF。
5. 将人工修改保存为新版本，保留来源和模型生成记录。

标准草案至少包含前言、范围、规范性引用文件、术语和定义、分类、技术要求、试验方法、检验规则、标志包装和附录。编制说明包含目的意义、编制依据、主要技术内容和与现行标准关系。预研报告包含立项必要性、技术路线、风险和预期效益。

### 3.3 当前实现

- 模块一页面提供 4 份内置研发输入案例，支持预览、下载和选择。
- GET /api/demo-inputs 返回案例目录和默认 GB/T 1.1 常见章节结构。
- POST /api/drafts/generate 接收 sourceName、sourceText、templateName、templateText，返回 standardDraft、compilationNotes、preResearchReport。
- 已配置 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL 时调用 OpenAI 兼容接口；调用失败时退化为确定性演示映射，保留“待确认”标记。

| 代码位置 | 责任 |
| --- | --- |
| index.html、app.js、styles.css | 模块一输入库、模板上传、草案展示和下载 |
| pdf-parser/server.mjs | 演示输入目录、草案生成 API、LLM 调用和降级 |
| demo-inputs | 4 份研发输入、模板 JSON 和输入输出映射说明 |

### 3.4 验收标准

- 上传或选择一份技术要求后，30 秒内返回三类可编辑草案。
- 标准草案包含 GB/T 1.1 常见章节，且每条指标不脱离来源输入。
- 模型异常时页面明确显示降级，不伪造“AI 生成成功”。
- 演示指标、法规、引用文件和阈值中的未知内容必须保留“待确认”。

## 4. M1-2：模板 JSON 化与参数映射

### 4.1 模板来源

模板来源分为两类：

1. 参考标准 PDF。通过 MinerU 解析为 Markdown，提取章节标题、表格字段、术语、试验方法组织方式和附录结构。
2. 企业模板。管理员维护 JSON 或 Word 模板，直接配置章节、字段、必填项、规则和行业词表。

当前模块一支持上传 PDF，调用 POST /api/parse 创建 MinerU 任务；任务完成后将解析 Markdown 作为 templateText 提交给草案生成接口。未上传模板时使用内置 GB/T 1.1 常见结构。

### 4.2 建议模板结构

    {
      "templateId": "household-refrigeration-performance-v1",
      "name": "家电/制冷产品性能与试验方法模板",
      "version": "1.0.0",
      "sections": [
        {"id": "scope", "title": "范围", "sources": ["scope.inclusions"]},
        {"id": "terms", "title": "术语和定义", "sources": ["terms"]},
        {"id": "requirements", "title": "技术要求", "sources": ["performanceTargets"]},
        {"id": "testMethods", "title": "试验方法", "sources": ["verification"]}
      ]
    }

当前样例为 demo-inputs/household-refrigeration-standard-template.json。

### 4.3 参数映射规则

| 输入字段 | 目标条款 | 必要校验 |
| --- | --- | --- |
| 适用范围、排除范围 | 范围 | 对象、场景、边界完整 |
| 术语、部件定义 | 术语和定义 | 术语不重复、定义可区分 |
| 性能指标 | 技术要求 | 对象、条件、限值、单位、判定方式齐全 |
| 样品、环境、仪器、步骤 | 试验方法 | 每个指标可对应至少一种验证方法 |
| 抽样、复测、交付要求 | 检验规则 | 不合格判定和复测逻辑明确 |
| 参考标准、法规线索 | 规范性引用文件 | 现行有效性和适用性由人工确认 |

### 4.4 后续数据模型

    Template: id, name, industry, version, schemaJson, status, createdBy, createdAt
    TemplateSection: id, templateId, sectionId, title, order, mappingJson
    Draft: id, sourceDocumentId, templateId, modelVersion, status, createdAt
    DraftDocument: id, draftId, type, markdown, docxKey, pdfKey, version
    DraftFieldTrace: id, draftDocumentId, clauseId, sourceField, sourceExcerpt, confidence

## 5. M1-3：在线协同与规范性审核

### 5.1 协同模式

黑客松阶段采用“平台生成初稿 -> 推送飞书文档 -> 飞书在线编辑和评论 -> 回到平台查看流程状态”的轻量模式。正式阶段可选择平台原生编辑器加 Yjs/CRDT、ONLYOFFICE 或企业既有文档系统。

平台侧保存结构化条款和版本，飞书侧承担多人评论、@提醒和审批待办。模块一保留条款协同审核页签，用于展示结构化条款、审核问题和版本修改。

### 5.2 审核规则

| 审核层 | 示例 | 输出 |
| --- | --- | --- |
| 确定性规则 | 条款编号、标题层级、单位、附录引用 | 可定位问题 |
| 语义规则 | 应/宜/可混用、条件缺失、术语多写法 | 风险提示和证据片段 |
| LLM 辅助 | 长句规范化、补全候选、引用风险 | 候选修改，必须人工确认 |

审核问题至少包含 clauseId、规则编号、严重程度、证据、建议、状态、处理人和处理时间。

### 5.3 飞书文档同步

现有服务在 PDF 解析完成后支持 POST /api/jobs/{jobId}/sync/feishu。服务端通过飞书应用凭据读取目标文档，再以追加模式写入 Markdown；重复同步具备幂等保护，不覆盖已有归档内容。实现位于 pdf-parser/feishu-mcp-client.mjs 和 pdf-parser/server.mjs。

模块一草案生成后应增加：

    POST /api/drafts/{draftId}/sync/feishu
    POST /api/drafts/{draftId}/pull-feishu-revision
    GET  /api/drafts/{draftId}/collaboration-status

同步时发送当前草案版本和来源信息。回写只允许将经人工确认的飞书版本保存为平台新版本，不能覆盖既有修订留痕。

## 6. M1-4：中英文版本协同输出

### 6.1 设计

中英文协同不是简单全文翻译，而是“术语库约束 + 段落一一对齐 + 双语言版本快照”：

    中文草案 Markdown
      -> 按标题和自然段切分为 segment
      -> 读取行业术语表
      -> LLM 返回相同 segmentId 的英文文本
      -> 保存中文版本、英文版本、术语版本和修订原因
      -> 导出中英对照、纯英文 Markdown、DOCX、PDF

翻译时不得改变条款号、数值、单位、公式、引用编号和列表结构；同一术语必须优先采用术语库译法。

### 6.2 可复用实现与接入任务

module3/source/server/bilingual-translation.mjs 已实现：

- 制冷和家电初始术语库；
- 术语新增、修改、删除；
- 按段落创建翻译任务和中文/英文版本快照；
- 修改译文并生成版本；
- 导出中英对照、中文和英文 Markdown；
- bilingual glossary 和 translations API 中间件。

该服务目前位于模块三 Vite 开发服务，尚未挂载到主部署服务。模块一接入时应抽为共享服务并关联 DraftDocument：

    Translation: id, draftDocumentId, sourceHash, mode, glossaryVersion, modelVersion
    TranslationSegment: id, translationId, clauseId, sourceZh, targetEn, status
    TranslationRevision: id, translationId, language, beforeText, afterText, author, reason
    GlossaryTerm: id, source, target, domain, notes, version, status

### 6.3 验收标准

- 术语库至少覆盖项目所属行业的关键术语。
- 中文每个可翻译段落都有对应英文 segmentId。
- 修改英文段落后可查看修改人、原因和版本。
- 导出中英对照时，条款编号、数值、单位和引用文件保持一致。

## 7. M1-5：预审、意见反馈与发布流程

### 7.1 流程定义

    起草 -> 预审 -> 专家评审 -> 意见修改 -> 复核 -> 发布确认 -> 已批准归档

黑客松演示可固定预审人、专家和发布管理员。生产版本采用 BPMN 或 JSON 流程定义，支持节点负责人、时限、必填字段和退回策略。

### 7.2 飞书审批复用

当前服务已实现：

    POST /api/jobs/{jobId}/approval/feishu
    GET  /api/jobs/{jobId}/approval/feishu

创建审批时传入标准名称或编号、飞书文档链接、解析任务 ID 和审查说明。查询状态时对 APPROVED、REJECTED、CANCELED 进行回写。实现位于 pdf-parser/feishu-approval-client.mjs。

模块一正式接入时，审批关联对象应由 jobId 升级为 draftId 和 draftVersion，避免将解析任务与审查版本混用。

### 7.3 意见处理表与发布

飞书评论、审批表单和外部 Word、Excel、PDF 意见统一转为：

    ReviewComment: id, draftId, clauseId, sourceType, sourceUrl, author,
                   originalText, proposedChange, decision, response,
                   owner, dueAt, status, createdAt

系统根据状态生成“意见汇总处理表”：意见编号、来源、涉及条款、意见内容、采纳情况、处理说明、责任人和完成时间。

发布前必须满足：

1. 审批状态为 APPROVED。
2. 所有必填意见已处理。
3. 文档版本、哈希和飞书归档链接已冻结。
4. 发布人具有对应权限。

黑客松版本生成发布公告和归档状态；生产版本通过 POST /api/publications 对接企业 OA 或标准管理系统。

## 8. M1-6：标准知识库与 Agent RAG

### 8.1 当前能力

现有 KDB 和 pdf-parser/kb-store.mjs 已支持：

- DOCX、TXT、Markdown、CSV 提取；
- PDF 经 MinerU 后写入知识库；
- 文件哈希去重、同名替换和持久化 Markdown；
- 约 900 字符分块、120 字符重叠；
- 中文双字词和英文 token 检索；
- LLM 基于命中片段作答并返回引用片段。

这属于“可审计检索 + LLM 归纳”的基础 RAG，不应称为完整 Agent RAG。

### 8.2 目标 Agent RAG

| 技能 | 输入 | 输出 |
| --- | --- | --- |
| standard-search | 标准号、主题、术语 | 带来源和版本的条款片段 |
| standard-diff | 两个文档或版本 | 章节、条款、指标与引用变化 |
| template-extract | 参考标准 PDF | 章节结构、表格字段、模板 JSON 候选 |
| term-check | 草案和术语库 | 术语不一致、未定义术语、译法冲突 |
| citation-check | 草案和引用文件索引 | 引用存在性、版本和适用性待确认项 |
| review-summary | 评论、审批、外部意见 | 意见汇总处理表和待办 |

Agent 只能读取受控索引和原文片段。输出必须带 documentId、chunkId、sourceHash 和引用位置。涉及数值、法规和试验结论时，必须回到原文或标记待确认。

### 8.3 索引更新策略

    原始文件哈希变化
      -> 解析任务
      -> 生成 Markdown 和结构化块
      -> 保留历史版本并替换当前索引
      -> 写入新块、关键词和向量索引
      -> 更新引用关系和差异索引

采用增量索引：只有原文件哈希、模板版本、术语库版本或解析器版本改变时才重新处理。向量索引是后续增强，当前分块与词法检索仍保留为可解释的召回层。

## 9. 当前接口与后续接口

| 能力 | 当前接口或代码 | 模块一后续接口 |
| --- | --- | --- |
| 演示输入 | GET /api/demo-inputs | GET /api/drafts/sources |
| PDF 解析 | POST /api/parse、GET /api/jobs/{id} | POST /api/templates/extract |
| 草案生成 | POST /api/drafts/generate | POST /api/drafts、PATCH /api/drafts/{id} |
| 飞书同步 | POST /api/jobs/{id}/sync/feishu | POST /api/drafts/{id}/sync/feishu |
| 飞书审批 | jobs approval feishu 接口 | drafts approval feishu 接口 |
| 知识库 | kb imports、search、ask 接口 | agent-rag query、standards diff 接口 |
| 双语翻译 | bilingual-translation.mjs | 主服务挂载 bilingual API |

## 10. 安全、合规与边界

- MinerU、LLM、飞书凭据只通过服务端环境变量或部署 Secret 注入，禁止进入前端或 Git。
- 文档同步采用追加和幂等策略，不删除飞书归档内容。
- 仅处理用户授权上传或公开可访问且合规使用的文件；不绕过登录、反爬和版权限制。
- AI 输出必须有 draft、in_review、approved、archived 状态；只有人工批准后才能发布。
- 人员、意见和文档链接属于企业数据，应按组织权限和审计要求保存。

## 11. 黑客松验收清单

1. 在模块一选择 1 份内置 DOCX，预览并下载。
2. 选择默认模板或上传参考标准 PDF，完成模板解析。
3. 生成标准草案、编制说明和预研报告，展示“演示目标，待确认”保护。
4. 切换条款协同审核，展示至少 3 类规范性问题和 AI 修改候选。
5. 将已确认草案同步到飞书文档，跳转飞书进行在线编辑和评论。
6. 发起飞书审批并显示审批链接，审批完成后回写状态。
7. 对草案执行术语检查、知识库检索或版本对比，展示可追溯证据。

## 12. 实施优先级

| 阶段 | 必须完成 | 可后置 |
| --- | --- | --- |
| P0：当前演示 | 输入库、模板解析、三类草案、模块一展示、飞书文档跳转 | 正式 DOCX/PDF 出版、多人冲突合并 |
| P1：可协作 | 草案持久化、版本、飞书草案同步、审批关联 draftVersion、意见汇总表 | 自定义 BPMN、企业 OA 发布 |
| P2：可运营 | 角色权限、对象存储、术语库、双语接口主服务化、差异比对 | 全量行业知识图谱 |
| P3：生产化 | Agent RAG、向量索引、审计、企业流程配置、发布适配器 | 高级自动化建议 |
