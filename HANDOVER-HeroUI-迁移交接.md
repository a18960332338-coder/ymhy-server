# 云眠花园（CloudSleep Garden）HeroUI 全站迁移 · 交接文档

> 用途：本项目已完成「整页 HeroUI 规范」第一阶段改造，本文件供接手者继续收尾。
> 交接日期：2026-08-25
> 改造目标：整页（App Shell + 全部业务页）遵守 HeroUI v3 大规范；品牌 accent 仅用于「实心主行动按钮」与「高亮文案」，其余一律中性/语义色。

---

## 一、软件基本信息

| 项 | 内容 |
|---|---|
| 软件名 | 云眠花园（CloudSleep Garden）—— 电商 AI 图像/视频生成桌面工具 |
| 项目根路径 | `/Users/chenshiyi/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a745b7b54ccba0edba6c766/` |
| 后端 | `app.py`（FastAPI），运行在 `:8000`，Python 启动（另有 `main.py`/`start.command` 桌面启动脚本） |
| 前端 | `web/app/`（**Vite + React 19**），dev 端口 `5173` |
| UI 框架 | **HeroUI v3（3.2.4）+ Tailwind CSS v4**（刻意不引入 preflight，保护老 CSS） |
| 图标方案 | **morphicons**（v1.7.1）渲染引擎；图标数据来自 **lucide** 包导出的 `IconNode` 数组，经 `src/components/Icon.jsx` 的 MAP 映射 |
| 主题 | `web/app/index.html` 中 `<html data-theme="dark">` 暗色；Semi UI `ConfigProvider` 也设 `mode:'dark'`（见 `src/main.jsx`），否则登录层等 Semi 组件白底 |
| 多品牌 | `cloudsleepgarden`（红）/ `sofawithcat`（青）/ `lyrosdream`（紫）；品牌色写在 `.app-shell[data-brand=...]` 上，映射到 `--accent` 系列 |
| 主要模块（左侧导航） | 主图合成 / 图库 / 套图生成 / 模版合成 / 生成视频 / 复刻视频 / 视频库 / 云眠AI / 1688链接导入 / 猫咪素材 |

### 关键源码位置
- 入口： `web/app/index.html`、`web/app/src/main.jsx`
- 应用壳（已迁移）： `web/app/src/App.jsx`（侧边栏 + 顶栏 + 主区 + 登录层）
- 全局样式： `web/app/src/styles/heroui.css`（HeroUI 作用域 + 动效层）、`web/app/src/App.css`（老 `.tk-*` 样式，保留供未迁移页）、`web/app/src/tiktok-tokens.css`（老 token）
- 图标： `web/app/src/components/Icon.jsx`
- 业务页： `web/app/src/pages/*.jsx`

---

## 二、已完成（已构建通过 + agent-browser 验证无控制台报错）

| 文件 | 改造内容 |
|---|---|
| `src/App.jsx` | 整页 App Shell 迁移：删除 `TkButton`/`TkChip`/`BackendSwitch`，新增语义色 `StatusDot`（success/warning/danger/muted）；顶栏后端 pill + 积分 chips + 豆包状态整体改为 HeroUI（`Surface`/`Switch`/`Chip`/`Spinner`）；根节点 `<div className="app-shell app-hero" data-brand={brand}>`，主区/顶栏用 `Surface`，主内容 `<main className="tk-main-body ..."`；`LoginScreen` 重写为 HeroUI `Card`+`Button`+`Input`+`Surface`，带 `data-brand` 与 `app-hero` |
| `src/components/Icon.jsx` | MAP 增补 `arrowRight/arrowLeft`（修复登录页箭头图标占位圆）；图标统一走 morphicons（lucide 数组形态） |
| `src/main.jsx` | `<ConfigProvider mode='dark' ...>` 暗色 |
| `src/styles/heroui.css` | 新增 `.app-hero`/`.hero-page` 作用域还原 `.card` 系列；交互动效层（按压 `scale(.97)`、过渡、`hero-fade-in` 页面淡入、`prefers-reduced-motion` 降级）；**关键修复**：`.button--secondary` 前景强制改回中性 `--button-fg: var(--default-foreground)`；`.app-hero .switch` 开关用语义成功色 `--switch-control-bg-checked: var(--success)`；`studio-hero` 统一改名 `hero-page` |
| `src/pages/DesignStudio.jsx` | 主图合成 + 图库 `ResultsLibrary` 迁移：用 `Tabs` 五 tab（模版图/合成图/主图素材/猫咪素材/生成记录），卡片 `Card variant="secondary"`/`Chip`/`ProgressBar`/`Surface`/`Modal`；主题色回收（`TAG_COLOR_MAP` cyan/blue→default、`DZ_COLOR` cat→default、`BATCH_STATUS_META` pending_seedream→default、running→warning）；选中遮罩改中性 `var(--foreground)`；row 卡片加 `!flex-row !flex-nowrap` 等提升优先级 |

> 构建验证：`npm run build` 通过（6597 modules，CSS ~532KB）。agent-browser 走查：登录页 / 主图合成 / 图库五 tab / 生成记录 / 模型下拉(Popover) 均正常，无报错。

---

## 三、未完成任务（待接手，按优先级排序）

### P0 — 主题色纪律收尾（纯搜索替换，风险低，直接满足"主题色纪律"）
品牌 accent 仅允许出现在：① 实心主行动按钮（`Button variant="primary"`，即 `.button--primary`）；② 高亮文案（个别强调文字）。其余（chip、边框、badge、选中态、进度、图标、hover、步骤条、拖拽区、推荐角标）一律改中性/语义色（default / success / warning / danger）。

- **`src/pages/VideoReplicate.jsx`** — 复刻视频：**20 处 `var(--tk-primary)`**（选中边框、拖拽区、推荐角标、步骤条、提交按钮等）。提交主按钮保留 accent，其余改语义色。
- **`src/pages/TemplateStudio.jsx`** — 模版合成：**26 处 `var(--tk-primary)` + 29 处 `className=.*tk-`**（步骤条、画廊 tab 选中、复选框、计数器高亮等）。粉色标签/角标已改中性，但 `--tk-primary` 未清理。

### P1 — 其余业务页迁移到 HeroUI（参照已完成 `ResultsLibrary` 写法）
未迁移页均使用 `.tk-*` 类 + `--tk-*` 变量，套 `.hero-page`/`.app-hero` 作用域即可。实际文件映射（已用 grep 核实）：

| 模块 | 文件 | 老样式残留（grep 计数） | 状态 |
|---|---|---|---|
| 主图合成 | `DesignStudio.jsx` | 17 处 tk- | 部分迁移（主区+图库已 hero，含残留 adapter 壳） |
| 图库 | `ResultsLibrary.jsx` | 6 处 tk- | 已迁移（少量残留） |
| 套图生成 | `SuiteGenerator.jsx` | 未查（`.tk-` 待核） | 未迁移 |
| 模版合成 | `TemplateStudio.jsx` | 29 tk- + 26 tk-primary | 未迁移（含 P0） |
| 生成视频 | `VideoBatchStudio.jsx` | 2 tk-（另 `.bak`/`.bak2` 备份各 10，忽略） | 未迁移 |
| 复刻视频 | `VideoReplicate.jsx` | 20 tk-primary | 未迁移（含 P0） |
| 视频库 | `VideoLibrary.jsx` | 8 tk- | 未迁移 |
| 云眠AI | `AiChat.jsx` | 1 tk- | 基本未迁移 |
| 1688导入 | `Crawl.jsx`（疑似 `Import1688Page`） | 待核 | 未迁移 |
| 猫咪素材 | `CatsGallery.jsx` | 6 tk- | 未迁移 |
| 其它子组件 | `Batch.jsx` / `Cats.jsx` / `Gallery.jsx` / `Logs.jsx` / `Overview.jsx` | 待核 | 待确认归属 |

> 说明：原总结称 `DesignStudio.jsx` 内含 `CatsGallery`/`LibraryGallery`/`Import1688Page` 子页，但实测这些为独立文件（`CatsGallery.jsx`、`Crawl.jsx` 等）。接手时以实际文件名 + grep `tk-`/`tk-primary` 为准。

### P2 — 局部 adapter 包装器清理
`DesignStudio.jsx` 顶部仍保留本地 HeroUI 适配壳：`Button/Input/TextArea/InputNumber/Checkbox/RadioGroup/RadioV2/Tag/Select/Spin/Modal/Tooltip` 等（为兼容其余未迁移 tab）。待全部 tab 迁移完后评估删除，避免双套 API 混乱。

### P3 — morphicons 状态动效（增强项）
当前仅 CSS 按压/过渡；未实现 morphicons 受控模式（`from`/`to`/`progress`）的图标形变，如「菜单↔X」「播放↔暂停」。属体验增强，非阻塞。

### P4 — 全站暗色 + 品牌一致性终检
逐页在浏览器走查：确认 `data-brand` 下 accent 仅出现在主按钮/高亮文案；所有 Card 在圆角（`--radius-xl`）/间距/背景视觉统一。建议用 agent-browser 逐 tab 截图核对。

---

## 四、关键坑位（必读，避免重复踩雷）

1. **`.card` 未分层规则陷阱（最致命）**：`App.css` 里 `.card{...}` 是未分层规则，优先级高于任何 `@layer`（含 Tailwind utilities），会盖掉 HeroUI Card 变体背景/圆角/边框，也会让写在 Card 上的 Tailwind 工具类（`flex-row` 等）失效。解法：用 `.app-hero`/`.hero-page` 作用域在 `heroui.css` 里重新声明；row 布局卡片加 `!flex-row !flex-nowrap` 等 `!` 提升。
2. **`.button--secondary` 文字变品牌色**：HeroUI 默认把 `--button-fg` 设成 `accent-soft-foreground`。已修：`.app-hero/.hero-page .button--secondary { --button-fg: var(--default-foreground) }`。新增次按钮时务必确认文字是中性色。
3. **Semi 登录层白底**：`main.jsx` 的 `<ConfigProvider mode='dark'>` 必须保留。
4. **TabPanel 懒挂载**：react-aria `TabPanel` 非选中时不渲染 DOM，切换才加载（图库「生成记录」即此机制），调试时注意。
5. **morphicons 数据形态**：`Icon` 的 `icon` prop 收 lucide 导出的数组（不是组件），新增图标须在 `Icon.jsx` 的 MAP 补映射，否则渲染成占位圆。
6. **品牌色变量**：`[data-brand]` 写在 `.app-shell` 上，`.app-hero` 作用域读取 `--accent` 系列。

---

## 五、建议接手顺序

1. **先做 P0**：`VideoReplicate.jsx` 与 `TemplateStudio.jsx` 的 `var(--tk-primary)` 回收（搜索替换 + 语义色替换，风险低，直接满足主题色纪律）。
2. **再做 P1**：迁移 `CatsGallery`/`VideoLibrary`/`SuiteGenerator`/`VideoBatchStudio`/`VideoReplicate`/`TemplateStudio`/`AiChat`/`Crawl` 等到 HeroUI（参照 `ResultsLibrary` 写法，套 `.hero-page`/`.app-hero`）。
3. **最后 P2→P3→P4**：清理 adapter 壳 → morphicons 状态动效 → 全站暗色/品牌一致性走查。

---

## 六、验证方式
- 构建： `cd web/app && npm run build`（确认 0 error）。
- 运行： `npm run dev`（5173）+ 后端 `:8000`；用 agent-browser 逐模块截图核对无控制台报错、主题色无滥用。
