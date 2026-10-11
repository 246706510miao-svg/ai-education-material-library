---
description: "AxisVerse 学习记录：题目卡片、知识点搜索、待复习标记、标题修改与可撤销的移除。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace

[English](README.md) | 中文

## 概述

用户可以回顾题目、搜索标题与知识点提示、标记待复习、修改标题，并移除或撤销移除记录。学习记录不显示工作区名称、目录路径、空白会话或委派会话。需要选择 Workspace 的组合仍可使用会话选择器。

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

从顶部导航打开**学习记录**。卡片展示已保存的题目标题、根据标题推断的知识点提示、最近一次用户活动时间和待复习标记。点击题目会打开原对话并关闭抽屉。记录按待复习、今天、最近 7 天、更早分组，组内按时间倒序排列；待复习记录只显示在自己的分组中。

**全部**与**待复习**用于筛选卡片。搜索匹配标题及本地化知识点文字，忽略大小写和首尾空白，不搜索消息正文或工作区名称。空白和已归档 Session 不会出现。

星标切换保存在当前浏览器来源中的待复习标记。标记在刷新后保留，但不属于账号同步的学习评估。修改标题通过 Session 服务写入；写入失败时保留可重试的对话框，只显示面向学生的提示。**删除记录**确认后会归档 Session，不清空正文。抽屉中可以撤销最近一次移除；已归档会话设置也保留恢复操作。

组合目录流提供方后，会话 Workspace 选择器可以接纳目录。它保留 Host 所拥有的 Workspace 与 Session 导航行为。

会话启动操作接受可选准备回调，在导航前针对已确定的空白 Session 执行。操作返回导航完成结果，失败时拒绝；被后续导航取代时不会执行回调。

-----

`ctx.uiWorkspace.openSession(target)` 会同步替换其拥有的 `mainView` reference，并让主区域返回 Conversation，而不等待 `reference.ready`，因此历史加载会显示在已经选中的 Session 视图内。目标可以是已知 Session id，也可以是持久的直接父子 subagent 地址；显式地址不要求预先加载 parent catalog。`openWorkspace(id, beforeOpen?)` 和 `forkSession(id)` 仅在请求未被后续导航替代时打开结果；新会话使用 `openWorkspace`。可选的同步准备回调在目标被 retain 后执行，并且仅对仍有效的 Workspace 请求执行，因此过期请求不会搬移 composer 草稿。后续导航或 owner 释放会阻止晚到的 UI 提交，但不取消底层 Session 创建。归档主 Session 会释放其 reference 并清除主选择。选择失败时保留当前全局面板。Session 行读取 `usePanelInfo`，在全局面板活跃时不显示 Session 选中样式；仅把焦点移到搜索框或目录选择器不会离开该面板。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

`StudyHistory` 使用框架提供的 Session 与归档快照填充 `sidebar.workspaces`。注册的 store 仅持有 `axisverse.study-history.v1` 下的浏览器本地待复习标记；对话标题和归档成员关系仍由 Host 管理。知识点提示来自确定性的标题匹配，不是检索到的教材元数据或模型判断的掌握程度。时间分组使用浏览器时区，每分钟更新一次。

`WorkspacePicker` 填充 `conversation.hero.workspace` 并声明自己的目录流子槽位。学生学习记录不声明目录选择器。Slot 注入跟随拥有方的声明生命周期。通用 Workspace 浏览器辅助组件保留在包内部，不挂载到学生学习记录中。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖侧边栏宿主、主视觉区界面与选取后端。

- [ui-sidebar](../ui-sidebar/README.zh.md)——承载 `sidebar.workspaces` 子 slot 的侧边栏外壳。
- [ui-conversation](../ui-conversation/README.zh.md)——承载 Session Intent 主视觉区选择器子 slot 的聊天界面。
- [directory-picker-native](../../host/directory-picker-native/README.zh.md)——填充目录流子 slot 的 OS 选择器后端。
- [Workspace Controller](../../api/workspace-controller/README.zh.md)——负责 Workspace、成员关系与 Workspace 分组顺序的 Host 变更和框架无关 Client 投影。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 待复习标记仅保存在当前浏览器与来源中，清除网站数据会移除标记。每条记录对应一段对话，而非多问题对话中的每一道题。知识点提示依赖标题，可能不完整。学生作答、已核对的资料引用、账号同步和学生主动确认的已掌握状态尚未接入。移除记录会归档对话，不会永久删除正文。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。这是一个纯消费方插件，只向两个由宿主声明的 slot 注册展示组件，并注册自身的 locale dictionaries；inject face 由无状态 RPC 包装层和一次 create-and-open 调用组成；本插件不发出 Cordis 事件，也不持有跨插件可变状态。
