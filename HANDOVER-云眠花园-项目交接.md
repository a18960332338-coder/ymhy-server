# 云眠花园（CloudSleep Garden）项目交接文档

> 用途：本文件为「项目总交接」文档，供接手者快速了解项目全貌、启动方式、架构与坑点。
> 交接日期：2026-08-31
> 配套文档：`HANDOVER-HeroUI-迁移交接.md`（HeroUI 迁移专项，含组件 API 细节，建议一并阅读）
> ⚠️ 重要更正：旧交接文档称「ResultsLibrary 已迁移」不准确 —— 独立文件 `pages/ResultsLibrary.jsx` 实际是**死文件**（未被 App.jsx 引用），真正在用的图库组件是 `DesignStudio.jsx` 内部的同名组件。

---

## 一、项目是什么

**云眠花园（CloudSleep Garden）—— 电商 AI 图像 / 视频生成桌面工具。**

面向家纺电商运营的「AI 出图 → 套图 → 视频」工作流：把产品图 + 猫咪素材合成电商主图 / 套图 / 分镜视频，并配套图库管理、1688 链接批量导入、文案生成、批量任务与视频生成/复刻/导出。

业务链路：`上传素材 → 豆包整理需求 → 套图 Agent 生成（NanoBanana 出图）→ 图库管理 → 生成视频（ToAPIs 可灵）→ 导出`。

---

## 二、技术栈总览

| 层 | 技术 |
|---|---|
| 前端 | **Vite + React 19**（`web/app/`），JSX，无 TypeScript |
| UI 框架 | **HeroUI v3（3.2.4）** + **Tailwind CSS v4**（刻意**不启用 preflight**，保护历史 CSS）；残留少量 Semi UI（`@douyinfe/semi-ui`，仅登录层/Toast/死文件） |
| 后端 | **FastAPI**（`app.py`，单文件约 5000 行），端口 **:8000**，Python 3.14 |
| 生图引擎 | **NanoBanana**（`src/synthesizer.py`，账户并发上限 = 1） |
| 视频引擎 | **ToAPIs**（可灵 kling-v3，`https://toapis.cn/v1`） |
| LLM | **DeepSeek**（文案/意图）、**ARK 豆包**（需求整理/云眠AI 聊天，Agent Plan 端点） |
| 1688 爬虫 | Playwright（`src/` 下爬虫模块，带风控与 tmp_cache GC 线程） |
| 桌面打包 | Electron（`electron/` + `dist-electron/`），`electron-builder` |
| 构建/启动 | `npm run dev`（Vite 5174）/ `npm run build`；`start.command`（mac）/ `start.bat`（Win）一键启动 |

---

## 三、目录结构

```
项目根（TRAE SOLO 项目目录）
├── app.py                  # 后端全部逻辑（FastAPI，约 5000 行，无拆分）
├── main.py                 # 桌面版入口 / 备用启动
├── config.yaml             # 配置文件（含 API 密钥，勿外传）
├── requirements.txt        # Python 依赖
├── start.command / start.bat   # 一键启动脚本（mac / Win）
├── kb/platform_image_styles.md # 套图生成的关键词/风格知识库（LLM 提示词素材）
├── input/                  # 输入：产品链接、猫咪素材等
├── output/                 # 所有产出数据（按账号/品牌隔离，见第四节）
├── src/                    # 后端模块（synthesizer.py 生图、爬虫、worker 等）
├── web/app/                # 前端（Vite + React）
│   ├── package.json        # 前端依赖与脚本
│   ├── vite.config.js      # dev 端口 5174；/api 代理到 :8000；内置「启停后端」插件
│   └── src/
│       ├── main.jsx        # 入口（Semi ConfigProvider 暗色 + HeroUI 样式挂载）
│       ├── App.jsx         # 应用壳：侧边栏/顶栏/登录/品牌切换/页面路由（display 切换）
│       ├── api.js          # 全部后端 API 封装
│       ├── accountKeys.js  # 账号维度的 localStorage key 隔离
│       ├── pages/          # 页面组件（见第五节）
│       ├── components/     # Icon.jsx、ui/ 共享组件库
│       ├── components/ui/  # HeroSelect / HeroTabs / HeroCard / HeroCheckbox / HeroInput / HeroTextArea / HeroSlider
│       └── styles/         # App.css / heroui.css / mini-ui.css / tiktok-tokens.css（色彩 token）
└── HANDOVER-HeroUI-迁移交接.md  # HeroUI 迁移专项交接（2026-08-25）
```

---

## 四、启动与运行

### 开发模式
```bash
# 1) 后端（:8000）
cd 项目根 && /Library/Frameworks/Python.framework/Versions/3.14/bin/python3 app.py
#    （依赖见 requirements.txt：fastapi / uvicorn / pydantic / httpx / Pillow / PyYAML ...）

# 2) 前端（:5174，/api 代理到 :8000）
cd web/app && npm run dev
```
浏览器打开 `http://localhost:5174/`。

### 一键启动
- macOS/Linux：`chmod +x start.command` 后双击；Windows：双击 `start.bat`。

### 桌面 / 生产
- `npm run electron:dev`（dev 调试）、`npm run electron:pack`（mac 打包）；后端会挂载 `web/app/dist`（若已 build）。

### 前端「连接/重启后端」按钮
- 由 `vite.config.js` 内置插件实现：Vite dev server（Node）`spawn('python3 -B app.py')` 起后端，`SIGKILL` 停。**仅 Vite dev 模式可用**，build 后无效。
- 注意：此机制 spawn 的后端进程随 Vite 退出而被回收（沙箱环境实测）。重启后端的最稳方式：界面「重启后端」按钮，或手动 `python3 app.py`（用后台常驻方式拉起）。

### 伪登录
- 登录态存 `localStorage['ydp.auth.v1']`（`{type, name}`），非真实鉴权。
- 创作者账号密码：**131418**（`App.jsx` 常量 `CREATOR_PWD`）；品牌账号一键进入。

---

## 五、配置与密钥（不贴明文，只讲位置）

| 配置 | 位置 | 说明 |
|---|---|---|
| 后端端口/主机 | `config.yaml` → `web`；环境变量 `APP_HOST` / `APP_PORT` | 默认 127.0.0.1:8000 |
| 1688 开放平台 | `config.yaml` → `alibaba` | 当前 `enabled: false` |
| 生图（lovart/NanoBanana） | `config.yaml` → `lovart`（含 access_key/secret_key，**含密钥**） | 项目名「云眠花园主图生成」 |
| NanoBanana 参数 | `config.yaml` → `nano_banana` | async 轮询、超时、重试 |
| ToAPIs 视频 | `config.yaml` → `toapis`（可选）+ 环境变量 `TOAPIS_BASE_URL` / `TOAPIS_API_KEY`；`app.py` 有默认常量 | 默认域名 `https://toapis.cn/v1` |
| DeepSeek | 环境变量 `DEEPSEEK_API_KEY`（`app.py` 有默认常量） | `https://api.deepseek.com` |
| ARK 豆包 | 环境变量 `ARK_API_KEY` / `ARK_AK` / `ARK_SK`（`app.py` 有默认常量） | Agent Plan 端点，**勿与标准 /api/v3 混用** |

> ⚠️ 交接提醒：`config.yaml` 与 `app.py` 顶部常量里**有真实 API 密钥明文**。接手后建议改走环境变量覆盖，且**不要把本仓库/配置文件外发**。

---

## 六、核心架构与数据模型

### 1. 账号隔离 + 品牌体系（关键）
- 数据目录布局：`output/<account>/<brand>/<bucket>/`
- **账号**：`creator`（创作者）、`ymhy`（云眠号）—— 同一设备可切换，所有记录按账号隔离（`accountKeys.js`）。
- **品牌**：`cloudsleepgarden` 云眠花园（红）/ `sofawithcat` 软居与猫（青）/ `lyrosdream` Lyros 弥梦（紫）；品牌色定义在 `.app-shell[data-brand=...]`，映射 `--accent` 系列。
- **bucket（用途）**：`synthesized`（合成图/套图）、`crawled`（1688 抓取）、`cats`（猫咪素材）、`templates` / `cross_templates`（模版）、`template_results`、`crops`、`videos` / `video_refs`（视频与参考）、`suite_refs`（套图参考图）、`tmp_cache_1688`（爬取缓存）。
- 前端查图库时「跨账号聚合」用 `all_accounts=true`（如套图 tab 查 `synthesized` 的 `suite_*` 文件，登录账号多为 ymhy，单账号查询为 0）。

### 2. 生图链路（套图 Agent）
- `ImageGen / 套图生成 → 豆包整理需求（chatStream）→ 后端 SuiteSession 状态机`：
  `start → await_confirm → (auto)confirm → await_select → (auto)select → generating(带进度) → done`
- 出图引擎 NanoBanana，**账户并发上限 = 1** → 套图批量**串行**生成（`SUITE_MAX_WORKERS = 1`），避免 429 重试风暴。
- 套图关键词受 **三大禁令**约束（`kb/platform_image_styles.md` + `_suite_system_prompt`）：① 禁尺寸 ② 禁具体材质名 ③ 禁白底图、必须生活场景背景。
- 套图 prompt 一次性输出全部 N 张（避免逐张 LLM 往返），后端在 1 并发额度内顺序生成。

### 3. 视频链路（ToAPIs）
- `/api/video/toapis/models` 拉模型列表（5min 缓存 + 空列表回退 kling-v3，**2026-08-31 修了缓存污染 bug**）
- `/api/video/toapis/generate`（POST）生成 → 返回 task_id
- `/api/video/toapis/status?task_id=...` 轮询状态
- `/api/video/toapis/credits` 积分查询
- `/api/video/toapis/download` 把生成的视频下载到本地 `videos` 目录

### 4. LLM 链路
- **DeepSeek**：`/api/llm/deepseek/chat` —— 文案/意图分类（云眠AI 聊天用）
- **ARK 豆包**：`/api/chat` / `/api/chatStream` —— 需求整理、套图规划、对话
- 注意 ARK 走 Agent Plan 端点（专属 Key），**勿与标准 /api/v3 混用**

### 5. 1688 爬虫
- 启用开关：`config.yaml` → `alibaba.enabled`（当前 false）
- 启用后支持 `/api/1688/login`、`/api/1688/crawl`、`/api/1688/preview` 等接口
- 抓取结果缓存到 `output/<account>/<brand>/tmp_cache_1688/`，有独立 GC 线程清理过期条目
- 触发了验证码风控时会批量跳过剩余链接

### 6. 批量任务
- `output/batch_history.json` 持久化所有批量记录
- 后端 `_ensure_worker()` 拉起 worker 线程，`requestGenerate` 推进状态机
- 前端 `/api/batch/list?brand=&account=` 拉列表，每 2s 轮询进行中任务进度

### 7. 前端页面路由（display 切换，非真路由）
- `App.jsx` 根据 `activeTab` 切换 `display`（**不卸载**，所以切换品牌时组件 key 改为 `key={`xxx-${brand}`}` 强制重挂）
- 5 个常驻挂载页（套图/视频/复刻/视频库/云眠AI/图片生成）切换 tab 时不丢 state

---

## 七、前端架构

### 1. 活动模块（8 个，App.jsx 实际 import）
| 一级 tab | 文件 | 关键子组件 |
|---|---|---|
| 主图合成 | `DesignStudio.jsx` | 内部含 ResultsLibrary（图库）/ Import1688Page（1688 导入）/ 猫咪素材 |
| 图片生成 | `ImageGen.jsx` | 左侧会话 + 右侧聊天，豆包意图路由（chat/clarify/generate） |
| 套图生成 | `SuiteGenerator.jsx` | 生成区 + 图库选择器（真实比例 objectFit:contain） |
| 模版合成 | `TemplateStudio.jsx` | 模版编辑 + canvas 预览 |
| 生成视频 | `VideoBatchStudio.jsx` | 3 步向导：分镜 → 生图参数 → 视频参数（含 HeroSelect 模型/分辨率） |
| 复刻视频 | `VideoReplicate.jsx` | 视频链接复刻 |
| 视频库 | `VideoLibrary.jsx` | 已生成视频列表 + 播放弹窗 |
| 云眠AI | `AiChat.jsx` | 对话气泡 + 流式 + 中止（AbortController） |

### 2. 死文件（9 个，未被 App.jsx 引用，删了不影响构建）
`pages/Batch.jsx`、`pages/Cats.jsx`、`pages/CatsGallery.jsx`、`pages/Crawl.jsx`、`pages/Gallery.jsx`、`pages/Logs.jsx`、`pages/Overview.jsx`、`pages/ResultsLibrary.jsx`、`pages/Synthesize.jsx`
- 仍使用 Semi UI，**不渲染、不影响构建**，可删可留
- ⚠️ 修正：旧交接文档「ResultsLibrary 已迁移」不准确 —— 独立文件是死文件；真正在用的图库是 `DesignStudio.jsx` 内部的同名组件（导出时 line ~3198）

### 3. 共享组件库 `web/app/src/components/ui/`
7 个自研组件 + `index.js` 统一出口，用法 `import { HeroSelect } from '../components/ui'`：
- **HeroSelect**：fixed 定位下拉（**2026-08-31 已 portal 到 body**，解决祖先 transform 引起的 fixed 错位）
- **HeroTabs / HeroCard / HeroCheckbox / HeroInput / HeroTextArea / HeroSlider**：基于 `@heroui/react` 命名空间复合
- 注意：v3 复合组件**不支持 `classNames={{...}}` slot 对象**，样式只能逐个写子组件的 `className`（Select/Slider/Tabs/Switch 全踩过）

### 4. 适配器模式
- `DesignStudio.jsx` 内有大量本地适配器（`HeroButton` / `HeroModal` / `HeroSelect` 等），业务代码保持 Semi 风格 prop API，改动零侵入
- AiChat / ImageGen / VideoBatchStudio 等页直接用 `components/ui/` 共享组件

### 5. 图标方案
- `components/Icon.jsx` 用 **morphicons** 渲染引擎 + **lucide** 的 `IconNode` 数组
- **必须** 在 Icon.jsx 的 MAP 中注册才能用，否则渲染为占位灰圈
- 改图标名要同步：① lucide import ② MAP 键值对
- 新加图标坑：曾因 `template` / `layoutGrid` 未注册导致 Tab 显示空心圆（**2026-08-31 已补 layoutGrid**）

---

## 八、UI 规范纪律（重点：避免新人踩坑）

### 1. HeroUI v3 静默失效陷阱（build 绿但功能/样式坏的）
- **复合组件不支持 `classNames={{...}}` slot 对象** —— 样式只能逐个写子组件 className
- **复合组件只传文字当 children = 控件本体不渲染**（Checkbox/Radio 缺 Control+Indicator → 只剩可点的文字）
- **Button 非法 variant**（v2 的 `bordered`/`light`/`flat`）→ 落到基础 `.button`，即 `--button-bg:transparent` 且 hover 也是 transparent → 按钮变成"透明无反馈的文字"
- **Modal 的 `size` 在 Container 上**，`title` 要用 `Modal.Heading`；层级 `Root>[Backdrop, Container(Dialog)>...]`
- **Checkbox 没有 size prop**，回调是 `onChange(boolean)` 不是 `onSelectionChange`
- **Tabs 选中态高亮全靠 `Tabs.Indicator`**（`[data-selected]` 只改文字色），且 Indicator 要放在**每个 Tab 内部**

### 2. 验证手法（比翻文档快，优先用）
- 命名空间成员 → `node_modules/@heroui/react/dist/components/<c>/index.js` 末尾 `Object.assign(X,{...})`
- slot 名 / variant 合法值 → `node_modules/@heroui/styles/dist/components/<c>/<c>.styles.js` 的 `slots:` `variants:`
- 是否支持 classNames → 看 `dist/components/<c>/<c>.js` 里 Root 的形参解构（只解构 className 就不支持）
- 样式是否真生效 → `grep -oE '\.<c>--[a-z-]+' dist/assets/index-*.css | sort -u`，查不到的 class = 该 prop 值无效

### 3. 色彩体系（务必遵守）
- **两套暗色色温不一致是「新旧割裂」根因**：HeroUI v3 是中性灰（`oklch hue≈285.9, C≈.006`，背景 L=12%）；旧 tk 暗色是海军蓝（C≈.022~.026，HeroUI 的 4 倍）
- `styles/tiktok-tokens.css` `:root` 已把 tk 黑灰阶对齐 HeroUI（保持每级用途不变，只降彩度到 .006 + 表面级明度对齐）
- **禁止再写死深色**：不要出现 `#161823` / `rgba(22,24,35,*)` / `rgba(15,23,42,*)` / `#0B1220` / `#16161C` 等旧海军蓝

### 4. 品牌色纪律
- 品牌 accent（`--tk-primary`）**只用于**：① 实心主行动按钮 ② 个别强调文案
- 其余选中态/边框/徽标/步骤条/进度条/勾选/拖拽区/推荐角标一律改为中性或语义色（`--surface-bg-2` / `--border-strong` / `--success` / `--foreground`）

### 5. 视觉校验脚本（可复用）
- 写 Python 把 hex/rgb 转 OKLab，筛 `L<0.40 且 C>0.020` = 「深色但明显带色偏」，精准捞出为旧配色写死的颜色

---

## 九、后端关键实现

### 1. NanoBanana 并发
- 账户并发上限 = 1（`429 Too many concurrent API requests ... "limit":1`）
- 套图/批量任务必须**串行**（`SUITE_MAX_WORKERS = 1`）
- 4 路并行立刻触发 429 + 30~50s 重试风暴，反而巨慢

### 2. ToAPIs 模型列表缓存
- 5min 缓存（`_TOAPIS_MODELS_TTL = 300`）
- **2026-08-31 修复**：原代码先缓存空列表再回退，导致后续请求读到 `[]`；修复后回退值也写进缓存
- 异常分支补 `return [fallback]`，不再返回 None

### 3. 1688 tmp_cache GC 线程
- 后端启动时 `_ensure_gc_thread()` 拉起
- 定期扫描 `tmp_cache_1688/` 清理过期条目

### 4. 状态机（套图）
- `start → await_confirm → confirm → await_select → select → generating → done`
- `generating` 阶段带进度（百分比 + 当前张数 + 耗时），前端通过 `/api/frame/progress` 轮询

### 5. worker 与批量
- `_ensure_worker()` 拉起后台 worker 处理批量任务
- 进度通过内存态（`batch_history.json` + 内存状态）暴露给前端

---

## 十、已知问题 / 运维坑

### 1. 项目无 git！改前**必须**备份
- 没有 `git checkout` 救命，所有改动需谨慎
- 修改前 `cp` 一份原文件，或用 `tmp_work/` 目录

### 2. WorkBuddy 沙箱回收
- 用 `nohup ... &` 启动的后端进程会**在该 Bash 工具调用结束后被回收**
- 后台服务必须用 `run_in_background: true` 拉起
- `ps` / `kill` 受限（`kill -9` 也杀不掉 root 进程）；重启后端用界面「重启后端」按钮

### 3. 缓存污染类 bug
- 任何「回退前先写缓存」的模式都是坑 —— 写完空缓存再回退没用，后续请求仍读 `[]`
- 修复模式：回退值也写缓存，或先回退再写缓存

### 4. `.catch(() => setState([]))` 这类"失败就清空"
- 会把**任何**上游抛错（含 sort/map 里的同步异常）静默吞成空列表
- 排错时优先怀疑 catch，临时改成 `.catch(e => console.error(e) || setState([]))` 看堆栈

### 5. sort 比较器
- `.sort((a, b) => b.localeCompare(a))` 假设元素是字符串；如果元素是对象就会抛 `TypeError: b.localeCompare is not a function`
- 必须作用在**字符串字段**上：`a.name.localeCompare(b.name)`

### 6. 流式更新 + 持久化
- 任何「进行中」的 UI 状态（thinking/generating/streaming）被持久化 = 刷新后必然卡死
- **流式更新优先用独立 state**，不要用会触发持久化 effect 的 setter
- 必须在加载时 sanitize（把 thinking/generating 的孤儿消息转为 error）

### 7. agent-browser / 浏览器验证
- 当前模型**不可读图**，截图仅能本地留存
- 验证 UI 改动的可靠方法：agent-browser `eval` 读 DOM 几何（`getBoundingClientRect`）、`document.querySelector` 内容、文本快照
- CLI：`agent-browser open / snapshot -i / click / eval / screenshot / close`

### 8. CSS containing-block 陷阱
- `position: fixed` 元素的定位基准会被祖先的 `transform`/`filter`/`perspective`/`will-change`/`contain` 改变
- 即使是恒等变换 `matrix(1,0,0,1,0,0)` 也会建立新 containing block
- 修复：下拉类组件用 `createPortal` 渲染到 `document.body`，脱离祖先变换上下文

### 9. key 自动加 npm install / npm run dev 经常被回收
- 沙箱里别依赖 `nohup &`，必须 `run_in_background`
- 后端 cold start 30~60s（ML 引擎导入），等够再测

---

## 十一、最近修复记录（2026-08-29 ~ 08-31）

| Task | 内容 | 关键文件 |
|---|---|---|
| 64 | 套图关键词三大禁令 + 提速（并发=1） | `kb/platform_image_styles.md`, `app.py _suite_*` |
| 65 | 套图预览真实比例（不裁切） | `SuiteGenerator.jsx` |
| 66 | 图库「套图生成」tab 显示 0 张 | `DesignStudio.jsx refreshSuiteImages`（sort localeCompare 抛错被 catch 吞） |
| 67 | VBS 下拉错位 + 视频模型无匹配项 | `HeroSelect.jsx`（portal 修复）+ `app.py _toapis_fetch_video_models`（缓存污染） |
| **今** | 套图生成 Tab 无 icon + 上传面板调整 | `Icon.jsx`（+LayoutGrid）+ `DesignStudio.jsx`（删 Chip + 收窄 dropzone） |
| **今** | **套图生成参考图不生效（生成图与参考图完全不同）** | `app.py _suite_generate_one`（ref 归一化）+ `SuiteGenerator.jsx`（图库选图改传相对路径） |

> 参考图问题根因（重要，防止回退）：图库选参考图时前端把**前端 origin 的绝对 URL**（如 `http://localhost:5174/api/image/...`）当作 `ref_image` 发给后端，套图生成路径原来把该 URL **原样丢给引擎走网络回拉**（`requests.get`），一旦 vite 代理/系统代理/localhost 解析环境变化就失败，引擎**静默退化为纯文生图** → 生成图与参考图完全无关。修复：`_suite_generate_one` 在调用引擎前用 `_local_image_ref_to_data_url(ref, brand, account)` 把 `/api/image/*` 相对路径 / localhost URL 解析成**本地文件 data URL**（零网络依赖）；`_local_image_ref_to_data_url` 增加 `account` 参数（后台线程用）。验证：单元测试三种 ref 格式均正确解析；端到端生成成功且输出与参考图相似度 91.7 vs 对照组 65.9。

---

## 十二、接手 checklist

接手后建议按顺序做以下 8 步验证（每步 5 分钟内能跑完）：

1. **装依赖**：`pip install -r requirements.txt` + `cd web/app && npm install`
2. **启动后端**：`python3 app.py` → 等 30~60s 冷启动 → `curl /api/health` 应返回 200
3. **启动前端**：`cd web/app && npm run dev` → 浏览器打开 `http://localhost:5174/`
4. **登录**：用创作者账号密码 **131418** 登录
5. **看图片**：进入「主图合成」→ 「套图生成」tab，应能看到历史套图（若之前生成过）
6. **看视频**：进入「视频库」，应能看到已生成的视频缩略图
7. **跑一次套图生成**：进入「套图生成」→ 填提示词 → 生成 → 验证流程跑通
8. **跑一次视频生成**：进入「生成视频」→ 完成 3 步向导 → 启动生成

如果某步失败，按第十节的"已知坑"对照排查；还不行就**看后端 `server.log`** + 浏览器 F12 console。

---

## 十三、有用入口速查

| 用途 | 地址 |
|---|---|
| 前端 dev | http://localhost:5174/ |
| 后端 health | http://localhost:8000/api/health |
| 后端 models | http://localhost:8000/api/models |
| 后端 ToAPIs models | http://localhost:8000/api/video/toapis/models |
| 后端 1688 登录 | http://localhost:8000/api/1688/login（需 alibaba.enabled=true） |
| 项目知识库 | `kb/platform_image_styles.md` |
| 配置文件 | `config.yaml`（含密钥，勿外传） |
| 启动脚本 | `start.command`（mac）/ `start.bat`（Win） |
| 后端日志 | `server.log`（项目根） |
| HeroUI 迁移专项交接 | `HANDOVER-HeroUI-迁移交接.md` |
| 本文档 | `HANDOVER-云眠花园-项目交接.md` |
