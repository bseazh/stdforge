# StdForge 第一版 PRD

## 1. 产品定位

StdForge 是面向标准化工程师、政策研究人员和评审专家的标准全生命周期协同平台。第一版目标是跑通一份标准从外部信息采集或文件导入，到结构化解析、规范性审核、人工协同修订、关联公告/政策展示和版本归档的闭环。

示范数据：GB/T 46274-2025《二手家用电器产品品质鉴定规范 洗衣机》。公开信息页：`https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=0FFB449583B5D16BDDA3FABEF160D8EF`。

## 2. 目标与非目标

### 目标

1. 将公开网页元数据和用户合法上传的 PDF/DOCX 统一入库并保留来源。
2. 将标准拆成章节、条款、引用文件、术语、表格、附录等结构单元。
3. 对规范性用语、条款完整性、术语一致性、引用文件和格式规则给出可定位的审核问题。
4. 支持条款级修改、评论、评审、采纳/驳回和制修订留痕。
5. 展示与标准主题相关的公告和政策，并且让政策解读可回链原文依据。

### 非目标

- 不承诺自动生成可直接发布的国家标准。
- 不绕过来源网站登录、反爬或下载限制。
- 不允许 AI 自动发布政策解读或修改正式标准。
- 第一版不做真正的技术委员会发布系统对接。

## 3. 用户与核心场景

| 用户 | 目标 | 核心操作 |
| --- | --- | --- |
| 标准化工程师 | 编制、修订和审核标准 | 导入文件、编辑条款、处理审核问题、导出草案 |
| 政策研究人员 | 跟踪外部变化和解释政策 | 配置来源/关键词、查看关联标准、审核解读草稿 |
| 评审专家 | 线上提出并闭环意见 | 查看指定条款、评论、给出采纳意见 |
| 管理员 | 维护数据和流程 | 配置来源、审核规则、角色与推送策略 |

## 4. 版本一范围

### 模块一：标准协同编制与审核

- 导入 PDF/DOCX；记录文件哈希、来源 URL、导入人、导入时间。
- 解析为条款树，支持范围、引用文件、术语、技术要求、试验方法、附录等类型。
- 条款编辑、批注、版本快照、差异比较、采纳/关闭审核问题。
- 发起评审时向服务端预配置的评审邮箱发送通知；浏览器不得指定收件人或邮件正文。
- 规则审核：规范性用语、缺少可验证条件、单位/范围、术语不一致、引用文件版本。
- AI 仅生成候选条款或修改建议，必须展示依据和人工确认操作。

### 模块二：公告与组织追踪

- 配置来源站点、关键词和采集频率。
- 采集公开元数据：标准号、名称、状态、发布日期、实施日期、ICS/CCS、发布单位、来源 URL。
- 对标准号做去重和版本状态更新；展示与当前标准的关联度。
- 第一版的起草单位、技术委员会和企业关联采用人工维护的小型数据集。

### 模块三：政策收集与解读

- 录入来源、关键词、地区与产业分类。
- 保存原文链接、正文摘要、采集时间、分类与有效状态。
- AI 生成“适用对象、核心变化、建议动作、风险提示”草稿。
- 每个结论至少关联一段原文证据；未经审核不得推送。

## 5. 主流程

```text
1. 采集公开元数据 / 合法上传文件
2. 保存原件、来源链接、哈希和采集时间
3. 解析为条款树，人工校正解析结果
4. 运行规则审核与 AI 辅助审核
5. 在条款级编辑、评论、评审和处理问题
6. 生成版本快照、制修订说明与待发布文件
7. 关联公告、政策与企业信息，按角色推送
```

## 6. 核心数据模型

```text
Standard: id, standardNo, titleZh, titleEn, status, sourceUrl, sourceHash
DocumentFile: id, standardId, type, storageKey, hash, importedAt, parserVersion
Clause: id, standardId, parentId, clauseNo, title, clauseType, content, order
Reference: id, standardId, standardNo, title, datedReference, version, status
ReviewIssue: id, clauseId, ruleId, severity, evidence, suggestion, status
Revision: id, clauseId, beforeContent, afterContent, reason, author, createdAt
Comment: id, clauseId, author, content, decision, createdAt
NotificationEvent: id, type, standardId, recipients, status, sentAt, providerMessageId
SourceRecord: id, sourceName, sourceUrl, fetchedAt, rawHash, accessStatus
Policy: id, title, authority, publishedAt, sourceUrl, category, status
PolicyEvidence: id, policyId, excerpt, location, interpretationId
```

## 7. API 契约（可由现有服务替代）

| 接口 | 用途 | 可复用/替代方案 |
| --- | --- | --- |
| `POST /api/imports` | 创建文件导入任务 | 对接对象存储和异步任务服务 |
| `POST /api/parses` | 解析 PDF/DOCX | 封装 Docling 或 MinerU 服务 |
| `GET /api/standards/{id}` | 查询标准与条款树 | MyBatis / JPA 查询服务 |
| `POST /api/audits` | 运行规则审核 | 规则引擎 + LLM API |
| `POST /api/clauses/{id}/revisions` | 保存条款修订 | 数据库事务 + diff-match-patch |
| `POST /api/notifications/review` | 向预配置评审组发送通知 | SMTP 服务端适配器，频率限制 |
| `POST /api/sources/{id}/collect` | 采集来源公开元数据 | Scrapy 服务或内部数据 API |
| `POST /api/policies/{id}/interpretations` | 生成政策草稿 | RAG + LLM API，强制人工审核 |

## 8. 验收标准

1. 导入一份标准后，页面可展示不少于 8 个章节/附录节点和原始文件来源。
2. 至少识别 3 类审核问题，并能够定位到条款、给出依据与建议。
3. 修改任一条款后可显示修改前后内容、修改人和时间。
4. 至少展示 3 条关联标准公告、1 条政策解读及其原文依据。
5. 演示时可在 5 分钟内完整演示“导入 -> 审核 -> 修订 -> 评审 -> 关联信息”流程。
6. 发起评审后，服务端可向预配置邮箱发送通知；未配置 SMTP 时清晰提示，不允许浏览器指定任意收件人。

## 9. 后续迭代

- 接入真实标准来源的授权 API 或合规采集任务。
- 添加 GB/T 1.1 审核规则包和企业术语库。
- 对接 ONLYOFFICE 或 Yjs，实现生产级协同编辑。
- 加入向量检索、标准对比、企业关系图谱和消息推送。
