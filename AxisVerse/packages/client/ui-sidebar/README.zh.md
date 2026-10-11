---
description: "AxisVerse 顶部导航：品牌、新建提问、学习记录抽屉及课程资料。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar

[English](README.md) | 中文

## 概述

用户可以从顶部导航启动新会话、浏览学习记录，以及查看或下载已上传的课程 PDF。题目卡片显示在按需打开的抽屉中，不占用持久的左侧栏。New Session 优先使用显式选择的 Workspace，其次使用当前 Session 所属的 Workspace，再其次使用最近活跃的 Workspace；如果都不存在，则打开空白的 New Session 页面。品牌标识和名称可通过独立的槽位替换。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

顶部导航展示品牌、新建提问、学习记录及课程资料。资料面板从需认证的 `/api/axisverse/materials` 后端读取元数据；远程 PDF 和已保存的本地原文件均通过该后端下载。卡片操作按“根据资料提问、资料总结、下载、删除”排序；提问使用蓝底按钮，其余使用描边按钮。蓝色 `Processing…` 和实际完成页数表示仍在处理。处理过程中或索引失败后，原文件仍可下载；正文可检索前禁用提问和总结，不显示未知页数。删除需要确认，只从本次安装的资料库移除条目，保留 PDF；完成提示提供撤销操作。移除或恢复失败时可重试。上传凭据和本地存储授权文档，而不是列出共享库的全部文档。读取失败时提供重试；关闭面板会取消读取并恢复焦点。设置槽位仍为管理端组合保留声明，但不在学生导航中渲染。

### 品牌与 New Session

每份已上传资料提供资料提问和分节总结入口。资料提问回到主页并显示可移除的资料标识。总结选择通过经过身份验证的目录入口读取原文小标题，再创建针对所选标题的总结对话。“全选”和“全部取消”作用于整个小标题列表；没有选中标题时禁用生成总结。读取失败可重试，缺失的小标题不会被编造。新建提问会清除所选空白会话的资料关联。

品牌行通过独立的 `sidebar.brand.mark` 和 `sidebar.brand.name` single slot 渲染标识与名称。没有占用方时，默认显示书页星光标识与 AxisVerse · 一纸宇宙。品牌按钮和新建提问按钮均调用同一个会话启动操作。

### 学习记录与全局面板

学习记录抽屉展示可搜索的题目卡片与待复习标记，不显示工作区名称或目录操作。关闭按钮、背景遮罩与 Escape 均可关闭抽屉；Escape 将焦点移回学习记录入口。打开新会话也会关闭抽屉。关闭时，抽屉内容保持挂载。

插件在 root 作用域的 `sidebar.panellist` list 注册带标签的条目。相同的 id 寻址 `main` keyed slot 中的面板；选择不存在的面板会抛错并保留当前选中态。学生导航不显示插件等全局面板按钮；面板注册仍可供管理集成使用。本包不改变面板或会话的数据存储。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

外壳是纯组合：`SidebarRootComponentProps` 组合布局 owner share、全局 `useSessions` 与 `useWorkspaces` 钩子、已声明的品牌、`sidebar.workspaces` 与 `sidebar.settings` 子 slot，以及注入的导航回调。面板入口及其可选标题使用相同的组合方式。面板元数据由列表注册和 locale 变化派生；选中态属于布局存储。

### slot 纪律

声明感知的 `slots.inject()` 允许替换包在导航包之前或之后激活。`AxisNavigation` 以 `wide: true` 渲染工作区席位，以 `wide: false` 渲染页脚操作席位。`/client` 导出插件入口及约定类型；呈现组件保留在包内。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖填充外壳席位的各个界面与组合模型。

- [ui-workspace](../ui-workspace/README.zh.md)——渲染到 `sidebar.workspaces` 的 Workspace 与 Session 浏览器。
- [ui-settings](../ui-settings/README.zh.md)——在 `sidebar.settings` 注册触发行与设置面板的设置领域底座。
- [ui-layout](../ui-layout/README.zh.md)——承载顶部导航及主内容的布局。
- [ui-theme](../ui-theme/README.zh.md)——导航使用的颜色与阴影 token。
- [slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)——席位背后的组合模型。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义外壳拥有什么、其占位方拥有什么；它们是当前包约束。

- **Session 状态点渲染由 ui-workspace 持有**：本外壳没有可用的 done/error 通知数据源。
- **Workspace 浏览行为由组合持有**：分组、排序、搜索与行状态都属于 ui-workspace，不属于此外壳。
- **「New task completed」未读标记是本地查看状态**：完成时间 > 上次查看时间这一事实永远不会到达宿主。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。面板元数据是 Slot 注册表与 locale 的只读呈现投影，没有独立写入 API。注册表负责条目身份与资源释放；本包的装配测试在注册和 locale 通知完成后断言该投影。外壳没有需要与这些来源协调的独立导航状态。

分段教材显示为一张原文件名卡片，并展示完整 PDF 页数。全部分段可检索后才启用提问和总结；下载返回完整原文件。目录页码对应原 PDF。
