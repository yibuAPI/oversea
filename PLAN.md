# new-fr · Vue 用户端前端 实施计划

> 目标：为当前后端（New API 分支，Go/Gin）构建一套全新的
> **用户端** 前端，技术栈 Vue 3。参考 infron.ai 的设计模式，视觉资产完全原创。

---

## 0. 范围与边界

### 做什么
- 完整的**用户端**（非管理端）前端：公开区 + 控制台。
- 对接后端现有 `/api` 接口，**不改后端**（若确需新增接口，单独提出）。
- 一套自有的设计系统（design tokens + 组件库）。

### 不做什么
- 管理端页面（渠道管理、系统设置、用户管理、日志审计等）继续用现有 React 前端。
- 不复制 infron.ai 的 logo、文案、插画、图标等品牌资产 —— 这些是他人的版权/商标资产。
  参考范围限定在**布局结构、信息层级、导航组织、配色策略、交互模式**。
- 不替换现有 `web/default`（React）和 `web/classic`，两者保持可用。

### 待你确认（阻塞设计阶段，不阻塞脚手架）
- **控制台内页视觉**：infron.ai 首页已分析（见 §1.5），但控制台在登录墙后，
  抓不到。若你有账号，给几张控制台截图；否则控制台布局由我按通用范式设计。
- **SVG 版 logo**：现有 PNG 1242px 短期够用，但高分屏放大会糊。有源文件请提供。

### 已确定
- **站点名**：`OneStepAPI`（作为回落默认值；运行时仍以 `/api/status` 的 `system_name` 为准）
- **Logo**：品牌渐变图标，已下载至 `public/logo.png`，见 §1.6
- **多语言**：启用 i18n（vue-i18n），中/英双语

### 关于「仿站工具」
用整站抓取工具扒 infron.ai 源码这条路**不采用**，两个原因：
1. 版权：抓下来的产物含对方 logo、文案、插画，是他人资产。
2. **技术上无价值**：该站由 **Framer** 生成（`--framer-*` 变量、`--token-<uuid>` 命名、
   绝对定位 canvas 体系）。产物无语义类名、无组件边界，扒下来改不动也维护不了，
   与 Vue 组件化开发完全不兼容。

---

## 1. 后端勘察结论（已核实）

| 项 | 结论 | 依据 |
|---|---|---|
| 框架 | Go + Gin | `main.go`, `router/` |
| API 前缀 | `/api`，中转 `/v1` | `router/api-router.go:15` |
| 会话鉴权 | `gin-contrib/sessions` Cookie，`SameSite=Strict` | `main.go:217` |
| 备用鉴权 | `Authorization` 头（access token）+ `New-Api-User` 头（用户 ID） | `middleware/auth.go:70,121` |
| **CORS** | **`/api` 组无全局 CORS**，仅 `usage`、`log/token` 两条挂了 | `router/api-router.go` |
| 静态托管 | Go `embed` 打包 `web/default/dist`，NoRoute 回落 index.html | `router/web-router.go:24-50` |
| 现有前端 | React 19 + Rsbuild + Tailwind，bun workspace（default/classic） | `web/package.json` |

### 关键推论
1. **开发必须用 dev proxy**（`/api`、`/v1` 转发到后端），不能跨端口直连 —— 无 CORS + Strict Cookie 会直接失败。
2. **生产必须同源部署**。推荐 nginx：`/` → Vue 静态产物，`/api` `/v1` → Go 服务。
   不建议塞进 Go 的 embed（embed 路径编译期固定，会与现有前端冲突）。
3. 登录态走 Cookie，前端 axios 必须 `withCredentials: true`。

---

## 1.5 infron.ai 设计观察（已抓取分析）

> 方法：curl 取首页 HTML，解析内联 CSS 变量与字体声明。仅提取**设计模式**
> （配色策略、字体搭配、产品定位），不使用其代码、文案、图形资产。

**站点技术栈**：Framer 生成的静态站（Vite 打包）。变量名为 `--token-<uuid>` 形式，
无语义化类名 —— 这是其源码不可复用的技术原因。

**产品定位**（meta description）：面向成长型企业的 AI 模型/Agent 平台，
主打统一 API、统一计费、分钟级接入、专属吞吐与 SLA。与本服务定位一致，
故其信息架构值得参考。

**配色策略**（提取自 CSS 变量，作为我们自有 tokens 的**方向参考**，非直接照搬）：

| 角色 | 观察到的取值 | 我们的对应 token |
|---|---|---|
| 主 accent | `#0a8dff`（亮蓝） | `--color-accent` |
| 强主色 | `#005eff`（深蓝） | `--color-accent-hover` |
| 点缀亮蓝 | `#4cf` | 图表/高亮 |
| accent 弱化底 | `#0a8dff26`、`#edf7ff`、`#d1f5ff` | `--color-accent-bg` |
| 背景分层 | `#fbfbfb` `#fafafa` `#f8f9fa` `#f2f2f2` `#f0f1f2` | `bg` / `bg-subtle` / `bg-elevated` |
| 边框 | `#e5e5e8`、`#d6d6d6` | `--color-border` / `border-strong` |
| 正文 | `#262626`（非纯黑） | `--color-fg` |
| 次级文字 | `#38383d`、`#706f6b` | `--color-fg-muted` |
| 弱化文字 | `#919191` | `--color-fg-subtle` |
| 暖强调 | `#ff5c30`（橙） | CTA / 高亮徽章 |
| 紫蓝 | `#3f3ad4` | 图表辅助色 |
| 深色区块 | `#050503`、`#121212` | 深色 section / 暗色主题基底 |

**风格总结**：浅色为主、**冷调中性背景多层递进**、蓝色 accent、正文用深灰而非纯黑、
大面积留白。属当下 SaaS 控制台主流范式，克制干净。

**字体搭配**：Inter 为主，辅以 Onest、General Sans；等宽用 Fragment Mono。
Inter 本身开源可直接用；另两者用等观感开源字体替代
（如 Onest 本身开源，等宽可用 JetBrains Mono / IBM Plex Mono）。

**我们的做法**：仅参考其**结构性范式**（背景分层、深灰正文、大留白、克制边框）。
配色**不采用**其蓝色体系 —— 改用本服务自有品牌色，见 §1.6。

---

## 1.6 品牌资产（已确定）

### Logo
来源：`public/logo.png`（品牌渐变图标，已下载至仓库）。
已下载至 `public/logo.png` —— 1242×1242 PNG，RGBA 透明底。

图形：圆角方形，**水平线性渐变**（蓝紫→天蓝→青绿）铺满，
其上为白色手写体字标。

> 注意：常见截图中 logo 外围的深色圆角边框**是页面背景，非 logo 组成部分**。
> 原图为透明底，可直接置于浅色或深色背景。

### 品牌渐变（像素级取样，水平中线）

| 位置 | 色值 | 用途 |
|---|---|---|
| 0%（左端） | `#4854FF` 蓝紫 | 渐变起点 |
| 20% | `#3F6AFF` | — |
| 60% | `#3BCAF5` 天蓝 | **主 accent 取此段** |
| 70% | `#56D7EA` | — |
| 80% | `#71E5E0` | — |
| 100%（右端） | `#86EFD7` 青绿 | 渐变终点 |

角点取样（TL `#4854FF` / TR `#86EFD7` / BL `#4853FF` / BR `#85EED7`）
确认渐变为**纯水平方向**，无垂直分量。

CSS 还原：
```css
--brand-gradient: linear-gradient(90deg, #4854FF 0%, #3BCAF5 55%, #86EFD7 100%);
```

### 配色策略
- **主 accent**：取渐变中段天蓝 `#3BCAF5`，但需**压暗以满足 WCAG AA**
  （原色在白底上对比度不足，不能直接用于文字/小图标）。
  实施时生成 50–950 完整色阶，交互态取 600/700 档。
- **辅助色**：蓝紫 `#4854FF`（次要操作、链接）、青绿 `#86EFD7`（成功态、正向指标）
- **图表配色**：以渐变三色为锚点扩展成 8 色序列，明暗两态分别校验对比度
- **渐变使用克制**：仅用于 logo、hero 标题、少量强调徽章与图表填充。
  **界面主体（按钮、卡片、表格）一律纯色**，避免廉价感
- **中性色**：沿用 §1.5 的冷调多层递进范式，与青蓝主色同为冷调，天然协调

### 站点名 —— 必须运行时读取，不可写死
后端 `common.SystemName = "New API"`（`common/constants.go:17`）、
`common.Logo = ""`（同文件 :19）**均仅为默认值**，实际值存数据库 `option` 表，
经 `GET /api/status` 以 `system_name` / `logo` 返回（`controller/misc.go:67-68`）。

现有 React 前端处理方式（`hooks/use-system-config.ts:96-97`）：
后端有值则用后端值，否则回落 `'New API'` / `'/logo.png'`。

**Vue 版照此实现**：`stores/site.ts` 在 app 挂载前拉 `/api/status`，
站名与 logo 全部走 store，组件不得硬编码，写死的仅为回落默认值。
本项目回落默认值定为 **`OneStepAPI`** / `/logo.png`。
如此管理员在后台改站名、换 logo 即刻生效，无需重新构建。

### 待补
- **SVG 版 logo**：PNG 在高分屏放大会糊，且无法随主题变色。
  建议向设计方索取 SVG 源文件；暂无则先用 PNG（1242px 足够大，短期无碍）。
- **favicon**：需从 logo 生成 16/32/180px 多尺寸。

---

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Vue 3.5 + `<script setup>` + TypeScript | 你指定 Vue |
| 构建 | Vite 7 | Vue 生态默认，dev proxy 开箱即用 |
| 路由 | Vue Router 4 | — |
| 状态 | Pinia | 用户态、站点配置、主题 |
| 数据请求 | TanStack Query (Vue) + axios | 列表缓存/失效/轮询，省掉大量手写 loading 态 |
| 样式 | Tailwind CSS 4 + CSS 变量 tokens | 与设计系统直接对应 |
| 组件 | Reka UI（无样式 headless）+ 自研样式层 | 可访问性有保障，视觉完全自控 |
| 图表 | ECharts (vue-echarts) | 用量趋势/分布图 |
| 图标 | Lucide (`lucide-vue-next`) | MIT，可商用 |
| 表格 | TanStack Table (Vue) | 日志/密钥列表的排序分页筛选 |
| 表单 | VeeValidate + Zod | — |
| i18n | vue-i18n | 若确认需要多语言 |
| 通知 | vue-sonner | — |

---

## 3. 目录结构

```
new-fr/
├─ PLAN.md
├─ index.html
├─ vite.config.ts            # dev proxy: /api /v1 → localhost:3000
├─ tailwind.config.ts
├─ tsconfig.json
├─ .env.example              # VITE_API_BASE, VITE_BACKEND_ORIGIN
└─ src/
   ├─ main.ts
   ├─ App.vue
   ├─ router/
   │  ├─ index.ts
   │  └─ guards.ts           # 登录态守卫、setup 未完成重定向
   ├─ api/                   # 每个后端模块一个文件，只放请求，不放业务
   │  ├─ client.ts           # axios 实例：withCredentials、错误归一化、401 处理
   │  ├─ types.ts            # 后端响应体类型（{success,message,data}）
   │  ├─ auth.ts  user.ts  token.ts  log.ts  data.ts
   │  ├─ billing.ts  subscription.ts  pricing.ts
   │  ├─ model.ts  status.ts  checkin.ts  sub-account.ts
   ├─ stores/
   │  ├─ user.ts             # 当前用户、余额、分组
   │  ├─ site.ts             # /api/status 站点配置：开关、公告、支付方式
   │  └─ theme.ts            # 明暗主题
   ├─ styles/
   │  ├─ tokens.css          # 设计变量（色彩/字号/间距/圆角/阴影/动效）
   │  └─ index.css
   ├─ components/
   │  ├─ ui/                 # 基础件：Button Input Select Dialog Table Badge...
   │  ├─ layout/             # AppShell Sidebar Topbar Footer PublicHeader
   │  └─ charts/             # UsageLineChart ModelPieChart StatTile
   ├─ features/              # 按页面组织的业务组件
   └─ pages/                 # 路由页面
```

---

## 4. 设计系统

先落 `tokens.css`，所有组件只消费变量，不写死颜色 —— 换肤/换主色改一处。

### Token 分层
```
--color-bg / bg-subtle / bg-elevated      背景三层
--color-fg / fg-muted / fg-subtle         文字三层
--color-border / border-strong
--color-accent / accent-fg / accent-hover 主色
--color-success / warning / danger / info 语义色（各带 -bg 弱化底）
--radius-sm/md/lg/xl                      圆角
--shadow-sm/md/lg                         阴影
--font-sans / --font-mono                 字体
```

- **明暗双主题**：同一套变量名，`:root` 与 `.dark` 两套取值，`next-themes` 同类逻辑用 Pinia 实现。
- **图表配色**：单独一组 `--chart-1..8`，保证明暗两态下对比度均达 WCAG AA，不复用语义色。
- **字体**：正文用可变字体（Inter / Public Sans 一类开源字体），代码与数字用等宽，
  金额/token 数一律 `font-variant-numeric: tabular-nums` 防跳动。

### 组件清单（`components/ui/`）
Button、IconButton、Input、Textarea、Select、Combobox、Checkbox、Switch、Radio、
Dialog、Drawer、Popover、Tooltip、DropdownMenu、Tabs、Table、Pagination、Badge、
Alert、Card、Skeleton、EmptyState、ErrorState、CopyButton、MaskedValue（密钥脱敏显示）、
DateRangePicker、Toast。

每个组件配一个 `*.stories` 式的预览页挂在 `/dev/ui`（仅开发环境），方便统一校对视觉。

---

## 5. 页面清单与接口映射

> 接口标注：✅ = 已在 `router/api-router.go` 中核实；⚠️ = 需实施时二次确认。

### 5.1 公开区（未登录可访问）

| 页面 | 路由 | 接口 |
|---|---|---|
| 首页 | `/` | ✅ `GET /api/status`、`GET /api/home_page_content`、`GET /api/notice` |
| 定价 / 模型价格 | `/pricing` | ✅ `GET /api/pricing`、`GET /api/ratio_config` |
| 模型排行 | `/rankings` | ✅ `GET /api/rankings` |
| 性能指标 | `/status` | ✅ `GET /api/perf-metrics/summary`、`GET /api/perf-metrics`、`GET /api/uptime/status` |
| 关于 | `/about` | ✅ `GET /api/about` |
| 用户协议 / 隐私政策 | `/user-agreement` `/privacy-policy` | ✅ 对应两个 GET |
| 登录 | `/login` | ✅ `POST /api/user/login`、`POST /api/user/login/2fa`、passkey begin/finish |
| 注册 | `/register` | ✅ `POST /api/user/register`、`GET /api/verification` |
| 忘记密码 / 重置 | `/forgot` `/reset` | ✅ `GET /api/reset_password`、`POST /api/user/reset` |
| OAuth 回调 | `/oauth/:provider` | ✅ `GET /api/oauth/state`、`GET /api/oauth/:provider`（GitHub/Discord/OIDC/LinuxDO）、wechat / telegram 独立路由 |
| 初始化引导 | `/setup` | ✅ `GET /api/setup`、`POST /api/setup` |

> 首页/定价/排行都受 `HeaderNavModuleAuth` 控制，站点可关闭对应模块 —— 导航需按
> `/api/status` 返回的开关动态渲染，不能硬编码。

### 5.2 控制台（需登录，`/console` 下）

| 页面 | 路由 | 接口 |
|---|---|---|
| 总览仪表盘 | `/console` | ✅ `GET /api/user/self`、`GET /api/data/self`、`GET /api/data/flow/self`、`GET /api/log/self/stat` |
| API 密钥 | `/console/keys` | ✅ `GET/POST/PUT /api/token/`、`DELETE /api/token/:id`、`POST /api/token/batch`、`POST /api/token/:id/key`、`GET /api/token/search` |
| 用量日志 | `/console/logs` | ✅ `GET /api/log/self`、`GET /api/log/self/search` |
| 用量统计 | `/console/usage` | ✅ `GET /api/data/self`、`GET /api/data/flow/self` |
| 钱包 / 充值 | `/console/wallet` | ✅ `GET /api/user/topup/info`、`GET /api/user/topup/self`、`POST /api/user/amount`、`POST /api/user/pay`；各渠道：`stripe/pay`、`creem/pay`、`usdt/pay`+`usdt/status`、`waffo/pay`、`waffo-pancake/pay` |
| 兑换码 | `/console/redeem` | ✅ `POST /api/user/topup`（兑换码充值） |
| 订阅套餐 | `/console/subscription` | ✅ `GET /api/subscription/plans`、`GET /api/subscription/self`、`PUT /api/subscription/self/preference`、`POST /api/subscription/{balance,epay,stripe,creem,waffo-pancake}/pay` |
| 可用模型 | `/console/models` | ✅ `GET /api/user/models`、`GET /api/models`（DashboardListModels） |
| 个人设置 | `/console/profile` | ✅ `GET/PUT /api/user/self`、`PUT /api/user/setting`、`GET /api/user/token`（access token）、`DELETE /api/user/self` |
| 安全设置 | `/console/security` | ✅ 2FA：`/api/user/2fa/{status,setup,enable,disable,backup_codes}`；Passkey：`/api/user/passkey*`；绑定：`/api/user/oauth/bindings`、`POST /api/oauth/email/bind` |
| 邀请返利 | `/console/affiliate` | ✅ `GET /api/user/aff`、`POST /api/user/aff_transfer` |
| 每日签到 | `/console/checkin` | ✅ `GET/POST /api/user/checkin` |
| 子账号 | `/console/sub-accounts` | ✅ `/api/sub-account/*`（列表、分组、批量导入、配额调整、统计） |
| 异步任务 | `/console/tasks` | ✅ `GET /api/task/self`、`GET /api/task/self/stat`、`GET /api/mj/self` |
| 价格监控 | `/console/price-monitor` | ✅ `GET /api/price-monitor/data` |
| Playground | `/console/playground` | ⚠️ 需确认 `controller.Playground` 挂载路径与请求体格式 |

**说明**：Playground/Chat 依赖 SSE 流式与模型能力探测，复杂度高，放在最后阶段；
若你不需要，可直接砍掉，前面所有页面不受影响。

---

## 6. 鉴权与请求层

### axios 实例（`api/client.ts`）
```ts
withCredentials: true          // session cookie 必需
baseURL: import.meta.env.VITE_API_BASE ?? '/api'
```
- **响应归一化**：后端统一 `{ success, message, data }`。拦截器把 `success:false`
  转成 reject，业务层只处理 `data`，不再各自判断 `success`。
- **401 处理**：清 Pinia 用户态 → 跳 `/login?redirect=<当前路径>`。
- **429**：读 `Retry-After`，toast 提示而非静默失败（后端多处有 `CriticalRateLimit`）。
- **敏感操作**：部分接口走 `POST /api/verify`（UniversalVerify）二次校验，
  封装成 `withVerification(fn)` 高阶函数复用。

### 路由守卫
1. `GET /api/setup` 未完成 → 强制跳 `/setup`。
2. 进入 `/console/*` 前确保 `GET /api/user/self` 成功，否则跳登录。
3. 站点配置 `GET /api/status` 在 app 挂载前拉取一次，存 Pinia，
   驱动导航项显隐、支付方式显隐、注册开关等。

### Vite dev proxy（必需）
```ts
server: { proxy: {
  '/api': { target: 'http://localhost:3000', changeOrigin: false },
  '/v1':  { target: 'http://localhost:3000', changeOrigin: false },
}}
```
`changeOrigin: false` 保留原始 Host，避免 session cookie 的 domain 校验问题。

---

## 7. 分阶段实施

| 阶段 | 内容 | 产出验收 |
|---|---|---|
| **P0 脚手架** | Vite+Vue+TS 初始化、Tailwind、路由、Pinia、axios client、dev proxy 打通 | 本地能跑起来，`/api/status` 拉取成功 |
| **P1 设计系统** | tokens.css、明暗主题、`components/ui/` 全量基础件、`/dev/ui` 预览页 | 预览页所有组件明暗两态视觉一致 |
| **P2 骨架与鉴权** | AppShell（侧栏+顶栏）、公开区 Header/Footer、登录/注册/重置/OAuth、路由守卫 | 能真实登录进控制台并保持会话 |
| **P3 核心控制台** | 仪表盘、API 密钥、用量日志、用量统计 | 四个页面数据真实、增删改可用 |
| **P4 计费** | 钱包充值（多支付渠道）、兑换码、订阅套餐、邀请返利、签到 | 支付流程可跑通（沙箱） |
| **P5 其余** | 个人设置、安全设置（2FA/Passkey/绑定）、可用模型、子账号、任务、价格监控 | — |
| **P6 公开区** | 首页、定价、排行、性能状态、关于、协议页 | — |
| **P7 收尾** | 响应式适配、i18n（若需）、空态/错误态统一、构建优化、部署文档 | 生产构建产物 + nginx 配置样例 |

**建议节奏**：P0–P2 一次性交付给你验收视觉方向，方向对了再往下推 —— 
避免设计系统定错之后大面积返工。

---

## 8. 部署方案

```nginx
server {
  listen 80;
  root /var/www/new-fr/dist;
  location / { try_files $uri $uri/ /index.html; }   # SPA 回落
  location /api { proxy_pass http://127.0.0.1:3000; }
  location /v1  { proxy_pass http://127.0.0.1:3000; }
}
```
同源部署，绕开 CORS 与 SameSite=Strict 的全部问题。Go 服务保持原样运行，
现有 React 前端仍可通过直连端口访问（管理端继续用它）。

---

## 9. 风险与注意事项

| 风险 | 应对 |
|---|---|
| infron.ai 控制台内页在登录墙后 | 首页已分析（§1.5）；控制台需你提供截图，否则按通用范式设计 |
| 后端接口字段未逐一核实 | 每个页面实施前先用 curl 打一次真实响应，按实际字段建类型，不臆测 |
| Playground/Chat 复杂度高 | 独立排期，可裁剪 |
| 支付渠道多且依赖站点配置 | 严格按 `/api/user/topup/info` 返回的可用渠道渲染，不硬编码 |
| 现有 React 前端仍是管理端唯一入口 | 新前端不覆盖 `web/`，两套并存 |

---

## 10. 下一步

1. 你确认第 0 节的三个待定项（设计素材、品牌、语言）。
2. 我执行 P0 脚手架，打通与本地后端的连接。
3. P1 设计系统交付预览页，你验收视觉方向。
