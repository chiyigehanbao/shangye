# FlowDesk 面试速览（30 分钟版）

> 目标：先建立“我能讲清楚”的掌控感。不要从 25 个 Python 文件开始读，按下面的顺序走。

---

## 0. 一句话记住项目

**FlowDesk 是一个面向小团队的 AI 办公自动化工作台：把 Excel 清洗、合同字段抽取、报价单、销售看板收进同一个多租户 SaaS，带账号、套餐、配额、计费、审计和可降级的 AI。**

面试时不要一上来报技术栈，先说这句话。

---

## 1. 先跑起来（5 分钟）

```powershell
cd D:\XiangMu\shangye\saas
python -m uvicorn app.main:app --host 127.0.0.1 --port 8077
```

打开：

- 落地页：`http://127.0.0.1:8077/`
- 登录：`http://127.0.0.1:8077/login`
- 工作台：`http://127.0.0.1:8077/app#/dashboard`

账号：

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 演示 owner | `demo@flowdesk.dev` | `Demo@12345` |
| 平台管理员 | `admin@flowdesk.dev` | `Admin@12345` |
| 普通成员 | `member@flowdesk.dev` | `Member@12345` |

先登录演示账号，把侧边栏四个模块各点开一次。**先建立产品感，再读代码。**

---

## 2. 你只需要亲手做这 5 件事

1. **登录**：看工作区、角色、套餐、AI 状态。
2. **Dashboard**：看 KPI、用量曲线、最近活动。
3. **Excel**：上传 `samples/excel-sales.xlsx` → 去空行/重复 → 按门店汇总金额 → 导出。
4. **文档**：上传 `samples/contract-demo.txt` → 字段填 `甲方,乙方,合同金额,签订日期,联系电话` → 看结果；再试批量队列。
5. **销售看板**：上传 `samples/sales-dashboard.csv` → 生成看板 → 生成 AI 洞察。

这 5 个动作能覆盖 80% 的面试演示。

---

## 3. 技术栈（背这一张表）

| 层 | 用什么 | 为什么 |
| --- | --- | --- |
| 前端 | 原生 HTML / CSS / JS + 本地 Chart.js | 零构建、部署简单、现场启动快 |
| 后端 | Python 3.13 + FastAPI 0.115 | 类型清晰、自带 OpenAPI、异步生态好 |
| 数据 | SQLite + WAL | 单机低并发、备份简单、2C2G 友好 |
| 数据处理 | pandas / openpyxl / pypdf / python-docx | Excel、PDF、Word 解析 |
| 认证 | PBKDF2-SHA256 + 数据库 opaque session | 可撤销、重启不掉登录 |
| 部署 | 单进程 uvicorn + Nginx + Docker Compose | 一个应用容器 + 一个网关 |
| AI | 云 API → Ollama → 规则引擎 | 任何一层失败都不阻塞业务 |
| 测试 | pytest + FastAPI TestClient | 临时库、规则 AI、不依赖网络 |

**一句话版本：**

> 前端原生 JS，后端 FastAPI，数据 SQLite WAL，AI 三层降级，Nginx + Docker Compose 单机部署，pytest 覆盖 10 条主链路。

---

## 4. 架构与代码地图

```text
浏览器
  ↓
Nginx（静态资源 / TLS / 20MB 上传限制）
  ↓
FastAPI 单进程
  ├─ routers/      HTTP 参数、权限、状态码
  ├─ services/     业务算法
  ├─ security.py   密码、会话、RBAC
  ├─ quota.py      套餐、配额、计量
  ├─ ai.py         云 API / Ollama / 规则
  ├─ workers.py    文档批量任务线程
  └─ database.py   SQLite schema / 查询
  ↓
SQLite WAL + data/uploads + data/backups
```

需要认识的 8 个文件：

| 文件 | 作用 |
| --- | --- |
| `app/main.py` | 应用入口、中间件、页面路由、生命周期 |
| `app/routers/` | 9 组 API：auth、workspace、dashboard、excel、docs、quotes、analytics、billing、admin |
| `app/services/` | Excel、文档、报价、分析的业务逻辑 |
| `app/security.py` | 登录、会话、角色守卫 |
| `app/quota.py` | Free / Pro / Team 限额与用量 |
| `app/ai.py` | 三层降级与 provider 标注 |
| `app/workers.py` | SQLite 文档任务队列 |
| `static/assets/app.js` | 工作台 SPA 全部交互 |

其余文件是 seed、审计、测试、部署配置。**面试不需要背每个文件。**

---

## 5. 四个模块，一句话一个

- **Excel 清洗**：上传表格 → 去空行/重复 → 按维度聚合 → 导出 XLSX → 历史可回看。
- **文档抽取**：PDF/Word/TXT → 指定字段 → 即时抽取；多文件进 SQLite 队列，支持重试/取消。
- **报价单**：条目、数量、单价、税率、折扣、多币种 → 服务端重算 → 打印；AI 根据需求生成条目。
- **销售看板**：上传销售明细 → 自动识别日期/分类/金额 → KPI、趋势、占比、AI 洞察、导出。

平台层是这四个模块共享的：**账号、工作区、角色、套餐、配额、计费、审计、AI 通道。**

---

## 6. 必须能讲的 3 个取舍

### 取舍一：为什么是单体，不是微服务？

2C2G 上启动 7–15 个服务会先被内存拖死，还要重复做鉴权、网关、数据库、日志。现在把模块边界放在 `routers/` 和 `services/` 里，部署收成一个进程。将来按模块拆出去即可。

### 取舍二：为什么 SQLite，不是 PostgreSQL？

小团队、低并发、单机部署。WAL 解决主要读写问题，备份只是一个文件。数据层集中在 `database.py`，迁移 PostgreSQL 时业务代码基本不动。

### 取舍三：为什么数据库 Session，不是 JWT？

JWT 无法立即撤销，还要维护黑名单。opaque token 存数据库，登出、禁用用户、切换工作区立即生效，服务重启也不掉登录。代价是每次请求多一次索引查询，这个量级可以接受。

> 面试官更想听“你为什么这样选”，不是“你用了什么”。

---

## 7. 3 分钟口述稿（背下来）

> FlowDesk 是一个面向小团队的 AI 办公自动化工作台，把 Excel 清洗、合同字段抽取、报价单和销售看板收进同一个多租户 SaaS。
>
> 技术上是一个 FastAPI 单体，SQLite WAL 做数据层，前端原生 JS + 本地 Chart.js，Nginx 反向代理，Docker Compose 部署，目标是一台 2 核 2G 的服务器。
>
> 平台层有用户、工作区、角色、套餐、配额、用量、发票和审计；四个业务模块共享这套能力，而不是四个独立 Demo。
>
> AI 走三层降级：云 API、本地 Ollama、规则引擎。最差也有确定性结果，并且每条结果都会标注 provider，不会因为网络问题让演示冷场。
>
> 文档批量任务用 SQLite 队列 + 单 worker，支持失败重试、取消和断点续跑。测试覆盖认证、四个模块、计费、租户隔离和平台后台，共 10 条主链路。
>
> 这个项目的核心取舍是：先用单体、SQLite、单进程把“能部署、能演示、能维护”做好；未来用户量上来，再拆 PostgreSQL、独立 worker 和对象存储。

练习到不看稿能说完，再展开细节。

---

## 8. 高频 10 问（先记短答案）

1. **为什么单体？** 2C2G 成本 + 模块边界已在代码层，先保证能部署。
2. **为什么 SQLite？** 低并发、单机、WAL、备份简单；迁移路径明确。
3. **多租户怎么隔离？** 所有业务表带 `workspace_id`，会话绑定工作区，角色来自 `memberships`；有隔离测试。
4. **配额怎么不超卖？** 执行前 `quota.check`，成功后 `quota.consume` 写用量流水；套餐定义只有一份。
5. **AI 挂了怎么办？** 云 API → Ollama → 规则，结果带 provider；失败不阻塞主流程。
6. **文档任务可靠吗？** SQLite 状态机 + `BEGIN IMMEDIATE` 领取 + 重试/取消 + 重启回收 processing。
7. **为什么不用 JWT？** 数据库 Session 可立即撤销，重启不掉登录。
8. **2C2G 怎么跑 pandas？** 单 worker、15MB 上传限制、2 万行分析上限、Nginx 直出静态。
9. **商业闭环是什么？** Free → Pro/Team（沙箱）→ 发票 → 配额变化 → 平台后台看 MRR/任务/AI 调用。
10. **用户涨 100 倍先改什么？** PostgreSQL、独立 worker、对象存储，然后才是拆服务。

完整版见 [`INTERVIEW.md`](INTERVIEW.md)。

---

## 9. 面试前 30 分钟 checklist

- [ ] 服务能启动，`/api/health` 返回 200。
- [ ] 演示账号能登录，侧边栏四个模块都能打开。
- [ ] 能独立完成一次 Excel 上传 → 清洗 → 导出。
- [ ] 能说出四个模块各一句话。
- [ ] 能画出“浏览器 → Nginx → FastAPI → SQLite”的图。
- [ ] 能讲 3 个取舍：单体、SQLite、Session。
- [ ] 能讲 AI 三层降级。
- [ ] 能主动说 3 个不足：沙箱计费、单进程限制、SQLite 并发上限。

---

## 10. 不要做的事

- 不要说“这是微服务”。
- 不要说“接了真实支付”——它是明确标注的沙箱。
- 不要说“生产级高可用”——它是 2C2G 单机方案。
- 不要逐行解释代码；讲清一条主链路和三个取舍。
- 不要背 25 个文件；记住 `routers → services → database` 三层即可。

---

## 11. 如果只有 10 分钟

1. 跑起来，登录演示账号（2 分钟）。
2. 打开 Dashboard 和 Excel 各看一眼（3 分钟）。
3. 读第 7 节“3 分钟口述稿”（3 分钟）。
4. 大声说一遍（2 分钟）。

先能讲，再求深。项目已经足够支撑面试，缺的是你对它的熟悉度，不是更多功能。
