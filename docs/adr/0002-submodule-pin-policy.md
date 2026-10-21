# ADR 0002 — Submodule pin policy

- 状态：已采纳
- 日期：2026-10-21
- 相关：[`.github/dependabot.yml`](../../.github/dependabot.yml)、[`.gitmodules`](../../.gitmodules)、[`wing/.gitmodules`](../../wing/.gitmodules)

## 背景

本仓库通过两级 git submodule 引入后端与数据面：

```
daed
└── wing                     → https://github.com/1unns/dae-wing
     └── dae-core            → https://github.com/1unns/dae
```

两个子模块都指向个人 fork，而不是 `daeuniverse` 组织仓库。这意味着**一次子模块指针变更就等于把一段未在本仓库出现过的代码送进发布产物**：`wing` 提供 GraphQL API、鉴权与数据库层，`dae-core` 提供 eBPF 数据面。

此前的配置是对 `package-ecosystem: gitsubmodule` 设定 `interval: daily`，即每天自动开 PR 升级指针。产生了两个问题：

1. **审计不可区分**：提交历史中 `chore: bump wing...` 大量重复，人工升级与机器人升级无法分辨，在追溯"某段代码是什么时候进来的"时失去线索。
2. **评审疲劳**：高频、低信息量的 PR 会训练维护者对子模块 PR 直接点通过，指针变更事实上绕过了评审。

## 决策

1. 子模块升级 PR 改为**月度**，且 `open-pull-requests-limit: 1`，保证同一时刻只有一个待评审的指针变更。
2. 子模块 PR **禁止自动合并**，必须由人对 diff 负责。评审前必须能看到上游实际改动（见下方检查清单）。
3. 子模块 PR 统一使用 `chore(submodule)` 前缀并打 `needs-review` 标签，便于在历史中筛选。
4. `wing` 与 `dae-core` 的指针变更**不与功能改动混在同一个 PR**，避免"功能 PR 里顺手升级"导致 diff 不可读。

## 评审检查清单

在合并任何子模块指针变更前，逐项确认：

- [ ] 上游 diff 已通读：`git -C wing log --oneline <old>..<new>`
- [ ] 若涉及鉴权、密码学、外部输入处理（订阅拉取、HTTP 层、请求体边界），改动必须附带测试
- [ ] 若涉及 `.github/workflows` 或 `Makefile`，确认不会改变本仓库的构建出处
- [ ] `go.mod` 的 `go` 指令若有变化，`toolchain` CI job 通过（镜像基座、文档、workflow 全部对齐）
- [ ] 确认没有新增 `replace` 到非组织仓库的依赖；若有，先走 ADR 流程

## 后果

- 正面：指针变更从"后台自动发生"变为"显式决策"，审计时可以用 `needs-review` 标签回溯每一次变更；评审疲劳降低。
- 负面：安全修复进入本仓库的延迟从"最多 1 天"变为"最多约 30 天"。**这是有意接受的取舍**——本仓库不承担官方发布职责，安全修复的正规路径是先合入上游，再由上游发布。若出现需要立即跟进的严重漏洞，走紧急例外流程：手动提 PR 升级指针，在描述中注明原因与所取提交，并说明为何不能等待月度节奏（流程由本条定义；此前本条写作"ADR 0003 定义的流程"，但当时并不存在该文档）。
- 待办：`SECURITY.md` 中已声明本仓库的安全修复目标时效（严重问题 30 天），与该节奏一致。

## 未采纳的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 保持每日升级 + 自动合并 | 等于放弃对发布内容来源的控制，与本 ADR 的动因直接冲突 |
| 完全关闭 gitsubmodule 的 dependabot | 会让指针长期停留在旧版本，安全补丁无法被提示；月度提示优于零提示 |
| 改为 git subtree / vendor | 能消除指针不可见的问题，但会改变 `wing/dae-core` 的 eBPF 构建路径（`make ebpf` 依赖子模块布局），改动范围超出本 ADR |
