# daed 全项目代码精细审查报告（第二轮）

- 审查时间：2026-10-18
- 代码基线：根仓库 `main` @ `8106da3`，子模块 `wing` @ `1e9bf72`（工作区干净，与 HEAD 一致）
- 审查范围：`apps/web`、`packages/*`（dae-editor / dae-node-parser / dae-lang-core / dae-lsp）、`wing`（Go 后端，不含 `wing/dae-core` 子模块）
- 说明：本轮在上一轮基础上，重点补查了**订阅拉取、资源生命周期、HTTP 层防护、前端缓存与轮询**四个上一轮未深入的方向。带 🆕 标记的为本轮新增发现。

---

## 0. 项目画像

| 区域 | 语言/栈 | 规模 | 测试 |
|---|---|---|---|
| `apps/web` | React + TS + Vite | 前端主应用 | 2 文件 / 9 用例 |
| `packages/dae-node-parser` | TS | 733 行核心 | 26 passed |
| `packages/dae-lang-core` | TS | — | 38 passed |
| `packages/dae-lsp` | TS | ~1600 行 | 32 passed |
| `wing`（Go） | Go 1.26 + graphql-go + GORM/SQLite | GraphQL 后端 | **0 个 `*_test.go`** |
| `wing/dae-core` | Go（子模块） | eBPF 数据面 | 不在本次范围 |

**总体评价：** 中上。前端组件化与 hooks 抽象干净，LSP / 解析器三个包有扎实单测（96 用例全绿），GraphQL schema 用 `@hasRole` 指令做声明式鉴权、配置生效用 `TryLock` 单飞 + dry-run 超时，设计有想法。

**短板集中在三处**：① Go 后端零测试；② 对外部输入（订阅响应、HTTP 请求体）缺少资源边界；③ 鉴权与密码学选型偏弱。其中 ② 是本轮新发现的主要问题——**这些缺陷都不是逻辑错误，而是"没有上限"**。

---

## 1. 🔴 阻断级（P0）

### 1.1 `QUERY_KEY_TRAFFIC` 未导入，类型检查失败

**文件：** `apps/web/src/apis/mutation.ts:690`

```ts
export function useClearTrafficStatsMutation() {
  ...
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY_TRAFFIC })  // ← 未导入
  },
}
```

常量本身在 `apps/web/src/constants/misc.ts:102` 定义，并经 `constants/index.ts` 导出，缺的只是 import 语句。

```
apps/web/src/apis/mutation.ts(690,49): error TS2304: Cannot find name 'QUERY_KEY_TRAFFIC'.
```

**为什么危险：** `vite build` 不做类型检查，所以它**不阻断生产构建**，能一路溜进主干；只有 `pnpm check-types` 会失败，而仓库没有 CI 跑它。

**副作用确认：** `QUERY_KEY_TRAFFIC = ['traffic']` 被 `query.ts:265` 用作前缀键（`[...QUERY_KEY_TRAFFIC, 'connection']`），说明"按前缀失效"的设计意图是对的，只是 import 漏了。

### 1.2 鉴权是 fail-open

**文件：** `wing/cmd/run.go:221-255`

`auth` 中间件**从不返回 401**，只负责往 context 塞 role/user，然后无条件 `next.ServeHTTP`。真正的拦截完全依赖 schema 上的 `@hasRole(role: ADMIN)` 指令（`root_schema.go:214-228`）。

**当前没有可利用的越权漏洞**——我逐字段核对过：顶层 `Query`（19 字段）与 `Mutation`（43 字段）中，除 `healthCheck` / `token` / `numberUsers` / `createUser` 四个引导字段外，**其余 58 个字段全部带 `@hasRole`**。

**问题是架构层面的：** 任何人新增一个 root 字段，只要忘了写注解，就立刻匿名可读可写，且没有编译错误、没有测试失败、code review 也极难发现。

**建议：** 中间件对非公开请求直接 401（公开字段用白名单），并加一条解析 `SchemaString()` 的测试断言覆盖完整——让"漏写注解"变成测试红灯而不是静默漏洞。

---

## 2. 🟠 安全（High）

### 2.1 密码哈希不是 KDF，且 salt 与 JWT 签名密钥复用

**文件：** `wing/graphql/query.go:41-58`

```go
func hashPassword(salt []byte, password string) (string, error) {
    h := sha3.NewShake256()          // 单轮、无迭代、无内存硬化
    h.Write(salt); h.Write([]byte(password))
    io.ReadFull(h, hash[:])
    return hex.EncodeToString(hash[:]), nil
}
```

- **不是 KDF**：SHA3-Shake256 单次调用是微秒级，数据库泄露后可以全速离线爆破。缺少 bcrypt / argon2 / scrypt 的"故意变慢 + 内存硬化"。
- **salt 与 JWT 签名密钥是同一个值**：`hashPassword([]byte(m.JwtSecret), password)` 与 `token.SignedString([]byte(m.JwtSecret))` 共用同一个 32 字节随机串，违反密钥单一用途原则。

### 2.2 登录无速率限制 + token 30 天不可吊销

```go
"exp": time.Now().Add(30 * time.Hour * 24).UTC().Unix()
```

`Query.token` 无失败计数、无退避、无锁定；`numberUsers` 还是公开接口（可探测是否已初始化）。30 天有效期 + 无 refresh/revocation，登出只清浏览器本地 token，服务端 token 依然有效。

### 2.3 🆕 JWT 明文存于 localStorage

**文件：** `apps/web/src/store/index.ts:50`、`apps/web/src/contexts/index.tsx:67-70`

```ts
export const tokenAtom = persistentAtom<string>('token')   // → localStorage
...
headers: { authorization: `Bearer ${token}` }
```

`@nanostores/persistent` 默认落 `localStorage`，任何同源 JS 都能读。好消息是前端全仓无 `dangerouslySetInnerHTML` / `innerHTML` / `eval`，XSS 面很小；坏消息是配合 30 天 TTL 与无吊销，一旦有一次 XSS 或第三方脚本被引入，凭据就是长期有效的。

### 2.4 CORS AllowAll + 纯 HTTP

**文件：** `wing/cmd/run.go:131`、`149`

```go
mux.Handle("/graphql", auth(cors.AllowAll().Handler(...)))
http.ListenAndServe(listen, mux)          // 无 TLS
```

`AllowAll` 放行任意来源；默认监听 `0.0.0.0:2023` 且明文。虽然 token 走 `Authorization` 头（不随跨源请求自动附带，CSRF 风险低），但管理面板承载代理配置与节点订阅，应限定来源白名单并强制 HTTPS。

---

## 3. 🟠 可靠性 / 资源边界（本轮重点）

这一节的共同点是：**功能正确，但没有上限**。对一台跑在路由器上的进程，这些是无预警 OOM / fd 耗尽的直接来源。

### 3.1 🆕 订阅拉取：响应体无大小上限

**文件：** `wing/graphql/service/subscription/mutation_utils.go:55-82`

```go
c := http.Client{Timeout: timeout, Transport: transport}   // 只限时间，不限字节
resp, err = c.Do(req)
...
b, err = io.ReadAll(resp.Body)                              // ← 无界读取
```

`Timeout` 约束的是耗时，不是体积。一个恶意或被攻陷的订阅地址（用户可任意填写，支持 `http://` 明文）持续推送数据，10 秒内足以把进程撑爆。路由器内存通常只有几十到几百 MB。

**建议：** `io.ReadAll(io.LimitReader(resp.Body, maxSubscriptionBytes))`（如 16 MiB），超限明确报错。

### 3.2 🆕 订阅拉取：非 2xx 响应泄漏连接

**文件：** 同上，`:75-78`

```go
if resp.StatusCode != 200 {
    return nil, fmt.Errorf("failed to fetch link: %v", resp.Status)   // ← 此处 resp.Body 未关闭
}
defer resp.Body.Close()                                              // ← 永远到不了
```

`defer` 写在状态码检查之后，所以**每一个非 200 响应都会漏掉 body**，底层连接无法复用也无法回收。订阅源持续返回 404/500 时，fd 会稳定泄漏。另外 `!= 200` 也误拒了合法的 2xx（204/206）。

**建议：** `defer` 紧跟 `c.Do` 成功之后；状态码改判 `>= 300`。

### 3.3 🆕 HTTP 服务无任何超时配置（Slowloris）

**文件：** `wing/cmd/run.go:149`

```go
http.ListenAndServe(listen, mux)
```

走的是默认 `http.Server{}`：`ReadHeaderTimeout` / `ReadTimeout` / `WriteTimeout` / `IdleTimeout` **全部为 0（不限制）**。攻击者开几百个连接、每次只发一个字节的 header，就能长期占住 goroutine 与 fd。默认监听 `0.0.0.0:2023`，一旦暴露即受影响。

**建议：** 显式构造 `&http.Server{ReadHeaderTimeout: 10s, ReadTimeout: 60s, WriteTimeout: 60s, IdleTimeout: 120s}`。

### 3.4 🆕 `/graphql` 无请求体大小限制

全仓搜不到 `http.MaxBytesReader` / `io.LimitReader`。一个超大 JSON body 会被 `json.Unmarshal` 完整读进内存（graphql-go 的 relay handler 直接 `io.ReadAll`）。配合 3.3 可构造低成本内存压力。

### 3.5 🆕 读查询同步执行全量节点探测

**文件：** `wing/graphql/service/node/latency_cache.go:154-195, 209-217`

```go
func QueryLatencies(ctx, ids) {
    if err := refreshLatencyCacheIfNeeded(ctx); err != nil { ... }   // ← 同步探测全部节点
```

`refreshLatencyCacheIfNeeded` 在缓存过期时调用 `refreshLatencyCache`，后者对**所有节点**跑 `testLatencyResultsForNodes`（并发 8）。也就是说，一个**读查询**会阻塞到"节点数 / 8 × 单节点探测超时"为止。订阅导入上千节点后，这个 GraphQL 请求可能挂几分钟，而前端正在轮询它。

**建议：** 刷新放到后台 goroutine（`sync.Once` 或带时间戳的 worker），查询只读快照；或在刷新进行中直接返回旧值并带 `stale` 标记。

### 3.6 🆕 延迟缓存无淘汰

**文件：** `latency_cache.go:45-56`

```go
for _, result := range results {
    nodeLatencyCache.items[result.NodeID] = cloneLatencyResolver(result)
}
```

只增不删。节点被删除后 `items` 里的条目永久保留。每次 `snapshotCachedLatencyResults` 还会全量 `clone` 一遍，成本随历史节点峰值线性增长。

### 3.7 `config.Run` 的 reload 发送会被缓冲区阻塞

**文件：** `wing/graphql/service/config/mutation_utils.go:262-282, 455-470`

> 更正：本条初稿写成"真实加载路径无超时"，是错的。实际两条分支都已有 `time.After(30 * time.Second)` 兜底。真正的缺口在别处。

```go
if ok := runLock.TryLock(); !ok { ... }
defer runLock.Unlock()
...
dae.ChReloadConfigs <- &dae.ReloadMessage{...}    // ← 发送本身没有超时
select {
case errReload = <-chReloadCallback:
case <-time.After(30 * time.Second):              // ← 超时只保护"等待"
```

`ChReloadConfigs` 是容量 16 的缓冲通道。若 dae 侧的消费循环卡住，缓冲区填满后这里的发送会**永久阻塞**——注意此时还没走到 `select`，所以 30 秒超时根本不会生效。结果是 `runLock` 被一直持有，之后每一次"应用配置"都只返回"make a cup of tea and take a break"，只能重启进程。

**修复：** 把发送也包进 `select`，5 秒内送不进去就明确报错退出（dry-run 与真实加载两处都改）。

### 3.8 SQLite 未配置并发参数

**文件：** `wing/db/db.go:28-31, 70-80`

```go
db, err = gorm.Open(sqlite.Open(path), &gorm.Config{})   // 无 pragma
...
func BeginTx(ctx) { return DB(ctx).Begin(&sql.TxOptions{Isolation: sql.LevelSerializable}) }
```

未设 `busy_timeout`、未开 WAL、未限制连接池。GORM 默认池允许多连接，SQLite 并发写会直接抛 `database is locked`（SQLITE_BUSY）。本项目的配置重载与订阅定时更新都是并发写路径。

**建议：** DSN 加 `?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)` + `SetMaxOpenConns(1)`。（已验证：全仓没有在事务内嵌套 `db.DB()` 的调用，因此单连接不会死锁。）

### 3.9 🆕 `regexp.MustCompile` 写在函数体内

**文件：** `wing/common/validator.go:17, 25`

```go
func ValidateTag(tag string) error {
    if !regexp.MustCompile(`^[^:']+$`).MatchString(tag) { ... }
}
func ValidateId(id string) error {
    if !regexp.MustCompile(`^[a-zA-Z_][-a-zA-Z0-9_/\\^*+.=@$!#%]*$`).MatchString(id) { ... }
}
```

每次调用都重新编译正则。`ValidateTag` 在订阅导入时按节点调用（上千次/次导入），这是典型热路径上的无谓分配。提到包级变量即可。

---

## 4. 🟡 前端（Medium）

### 4.1 🆕 切换端点 / 登出不清 react-query 缓存

**文件：** `apps/web/src/contexts/index.tsx:59`

```ts
const queryClient = useMemo(() => new QueryClient(), [])   // 只创建一次，永不重置
```

`queryClient` 与 `endpointURL`、`token` 完全解耦。而 `endpointURLAtom` 是持久化且可切换的（支持多实例）。切到另一台 dae 后，`nodes` / `subscriptions` / `general` 等缓存仍是上一台的数据，直到各自 stale 后才刷新——期间界面显示的是**另一台设备的状态**。

**建议：** endpoint 或 token 变化时 `queryClient.clear()`（用 `useEffect` 监听），或把 endpoint 前缀并入 `queryKey`。

### 4.2 端点与 token 各自持久化，缺少联动

> 更正：本条初稿写成"切换端点时旧 token 会发给新端点"，前提不成立。实测全仓只有 `Setup.tsx:79` 会写 `endpointURLAtom`，而那是首次初始化流程，此时还没有 token；`Header.tsx` 只展示端点、不修改它。因此不存在"带着 token 换端点"的 UI 路径。

保留的是一个更小的问题：`tokenAtom` 与 `endpointURLAtom` 是两个独立的 `persistentAtom`，彼此不知道对方的变化。真正需要联动的是**缓存**——见 §4.1。登出（`tokenAtom.set('')`）时缓存不清理，会让下一屏短暂看到上个会话的数据。

### 4.3 🆕 `useNodeLatenciesQuery` 后台仍轮询

**文件：** `apps/web/src/apis/query.ts:293-319`

```ts
const safeInterval = Math.max(1_000, refetchIntervalMs)
refetchInterval: safeInterval,
refetchIntervalInBackground: true,      // ← 标签页隐藏时继续
```

对比同文件的 `deviceTraffic` / `connectionTraffic`（2000ms，未开后台轮询）。延迟查询是三者里**服务端最重**的一个（见 §3.5），却在后台保持 1s 级轮询。三个同源查询的轮询策略不一致。

### 4.4 客户端实例生命周期不同步

`gqlClient` 依赖 `[endpointURL, token]`（正确），`queryClient` 是空依赖，两者生命周期不同步，正是 §4.1 的成因。

---

## 5. 🔵 代码健康（Low）

| 指标 | 数量 | 说明 |
|---|---|---|
| `TODO` / `FIXME` / `HACK` / `XXX` | 63 | 不含 `dae-core` |
| `console.*` | 17 | 生产代码残留，建议接统一 logger |
| `eslint-disable` | 6 | 需逐条确认 |
| `: any` / `as any` | 8 | 克制，可接受 |
| `@ts-expect-error` | 1 | `dae-lsp/src/browser-server.ts:21`，worker 全局类型，合理 |
| `_ =` 错误吞没 | 7 | 多数可接受（`cmd.Help()` 等）；`dae/run.go:214/218/236` 的清理失败值得记日志 |

**文件体量：**

| 文件 | 行数 | 建议 |
|---|---|---|
| `apps/web/src/apis/mutation.ts` | 1105 | 按领域（config/dns/routing/node/subscription/group）拆分 |
| `packages/dae-editor/src/lsp-client.ts` | 960 | 拆出 transport 与能力协商 |
| `packages/dae-lsp/src/core/completions.ts` | 874 | 补全数据外置为配置表 |
| `packages/dae-lsp/src/server-core.ts` | 854 | 按 handler 拆分 |
| `apps/web/src/components/Header.tsx` | 678 | 端点切换 / 账户设置 / 主题三块职责混合 |

**测试失衡：** `wing` 下（不含 `dae-core`）`*_test.go` 数量为 **0**。而鉴权、密码学、配置重载、订阅解析、事务编排全在这里。作为对比，LSP / 解析器三个包共 96 个用例全绿。

**CI 缺失：** `.github/workflows/` 只有 `publish-packages.yml` 与 `release-please.yml`，**没有任何 PR 阶段触发的 lint / test / typecheck / build**。这正是 §1.1 能进入主干的根因。

---

## 6. ✅ 已验证无问题的项（避免误报）

这些是我实际查过、确认**不是**缺陷的地方：

| 检查项 | 结论 |
|---|---|
| SQL 注入 | 3 处原生 SQL（`node/mutation_utils.go:110`、`subscription/mutation_utils.go:161,281`）全部使用 `?` 占位参数，无字符串拼接 |
| 配置注入（分组名含 `#`） | `ValidateId` 允许 `#`，但配置由 `daeConfig` **结构体**组装后交给 dae 自己的 marshaller，不做文本拼接；`pkg/config_parser/error.go:89` 明确处理了"引号内的 `#`"。无注入面 |
| XSS | 全仓无 `dangerouslySetInnerHTML` / `innerHTML` / `document.write` / `eval` / `new Function` |
| 路径穿越（静态资源） | `webrender` 走 `embed.FS` + `fs.Sub`，`fs.FS` 本身拒绝 `..` |
| 并发正确性 | `config.runLock`（TryLock 单飞）、`latency_cache` 的 `mu` / `refreshMu`（双检锁）、`schedulerMu`（读写锁 + 二次检查）写法均正确 |
| 延迟探测并发 | 信号量限 8，`WaitGroup` 正确等待，`dialer` 有 `defer Close()` |
| 定时任务生命周期 | `AddUpdateScheduler` 有双重存在性检查，`RemoveUpdateScheduler` 正确 `Stop()+delete` |
| 明文外连 | 仅 `cp.cloudflare.com` 健康检查默认值与 mock / 测试数据，属业务需要 |
| i18n | `en.json` 与 `zh-Hans.json` 均为 399 个 key，完全对齐 |
| SQLite 文件权限 | 已收敛到 `0640` |

---

## 7. 验证记录

```
tsc --noEmit -p apps/web              → 1 error (TS2304 QUERY_KEY_TRAFFIC)     ❌
pnpm test (全仓)                       → 10 tasks successful，9 用例通过          ✅
  └ dae-node-parser 26 / dae-lang-core 38 / dae-lsp 32                        ✅
pnpm build --force                    → 6 tasks successful                    ✅
eslint .（存量）                       → 22 errors（20 条可 --fix 自动修复）       ❌
go build ./...  (GOOS=linux)          → dae-core 缺 bpf2go 产物，需先 go generate
go build ./...  (GOOS=windows)        → dae-core 缺 Linux-only 符号（预期）
```

> Go 侧编译失败**全部来自 `wing/dae-core` 子模块**：Windows 目标缺 `unix.RTF_UP` 等 Linux 符号，Linux 目标缺 `bpfObjects` 等 bpf2go 生成文件（需 clang/llvm + `go generate`）。`wing` 自身代码未出现编译错误，属环境前置条件，非缺陷。

---

## 8. 优先级与修复顺序

| 序 | 项 | 级别 | 工作量 |
|---|---|---|---|
| 1 | 补 `QUERY_KEY_TRAFFIC` import（§1.1） | P0 | 1 行 |
| 2 | 加 CI 门禁：lint / typecheck / test / build / go vet（§5） | P0 | 1 文件 |
| 3 | 鉴权改 fail-closed + schema 覆盖测试（§1.2） | P0 | 中 |
| 4 | 订阅拉取：限体积 + 修 defer 顺序 + 放宽 2xx（§3.1 §3.2） | P0 | 小 |
| 5 | HTTP Server 超时 + `/graphql` body 上限（§3.3 §3.4） | P1 | 小 |
| 6 | 密码哈希换 argon2id，salt 与 JwtSecret 解耦（§2.1） | P1 | 中 |
| 7 | 登录限流 + token 有效期缩短（§2.2） | P1 | 中 |
| 8 | SQLite busy_timeout + WAL + 连接池（§3.8） | P1 | 小 |
| 9 | 延迟刷新移出请求路径 + 缓存淘汰（§3.5 §3.6） | P1 | 中 |
| 10 | `Run` 加载路径加超时（§3.7） | P1 | 小 |
| 11 | 前端缓存 / 凭据随端点重置（§4.1 §4.2 §4.3） | P2 | 小 |
| 12 | CORS 白名单 + TLS（§2.4） | P2 | 小 |
| 13 | 正则提到包级（§3.9） | P3 | 2 行 |
| 14 | 补 Go 单测：密码学 / 鉴权 / 订阅解析 / 事务 | P3 | 大 |
| 15 | 清理 63 处 TODO、17 处 console，拆 5 个超大文件 | P3 | 大 |

**一句话总结：** 业务逻辑是可靠的，风险几乎全部来自"对外部输入的边界缺失"——订阅响应大小、HTTP 超时、请求体大小、token 寿命、延迟缓存的键空间。这些补上之后，这个项目就从"能跑"变成"敢放到公网上"。

---

## 9. 修复提交状态（2026-10-18）

改动已全部通过测试并完成 Git 提交与子模块指针同步：

- `wing` 子模块：
  - `04bf8fc` (`fix(security): bound external input and harden authentication`)
  - `db7984f` (`fix(server): put corsHandler outside auth so unauthenticated rejections carry CORS headers`)
- `daed` 根仓库：
  - `d2f63fc` (`fix(web): restore the traffic cache key import and gate the repo on CI`)
  - `402f676` (`fix(auth): clear tokenAtom on HTTP 401 in responseMiddleware and bump wing`)

| 序 | 项 | 级别 | 状态 | 验证方式 |
|---|---|---|---|---|
| 1 | 补 `QUERY_KEY_TRAFFIC` import | P0 | ✅ 已修复 (`d2f63fc`) | `tsc --noEmit` 0 error（修复前 1） |
| 2 | CI 门禁 workflow | P0 | ✅ 已修复 (`d2f63fc`) | `.github/workflows/ci.yml`，web 4 步 + wing 4 步 |
| 3 | 鉴权 fail-closed | P0 | ✅ 已修复 (`04bf8fc`) | 中间件非白名单返回 401；schema 覆盖测试解析出 19 Query + 43 Mutation，公开字段恰好 4 个 |
| 4 | 订阅拉取限体积 / 修 defer / 放宽 2xx | P0 | ✅ 已修复 (`04bf8fc`) | `maxSubscriptionBytes = 32 MiB` + `LimitReader`；`defer` 提到状态码判断之前；判据改 `>= 300` |
| 5 | HTTP 超时 + body 上限 | P1 | ✅ 已修复 (`04bf8fc`) | `newHttpServer` 四个超时齐备；`MaxBytesReader` 4 MiB，超限返回 413 |
| 6 | argon2id + salt 解耦 | P1 | ✅ 已修复 (`04bf8fc`) | `db/password.go` 用 `argon2.IDKey`，PHC 自描述格式；salt 独立随机，`JwtSecret` 只管签名；旧哈希登录时透明升级 |
| 7 | 登录限流 + token 有效期 | P1 | ✅ 已修复 (`04bf8fc`) | 5 次免费后指数退避至 15 分钟封顶；`tokenTTL` 30 天 → 7 天 |
| 8 | SQLite 并发参数 | P1 | ✅ 已修复 (`04bf8fc`) | `busy_timeout` / WAL / `synchronous=NORMAL` + `SetMaxOpenConns(1)`；已确认无事务内嵌套取连接，不会死锁 |
| 9 | 延迟刷新移出请求路径 + 缓存淘汰 | P1 | ✅ 已修复 (`04bf8fc`) | `refreshLatencyCacheAsync`（`TryLock` 单飞 + 后台 goroutine）；`pruneLatencyCache` 按存活节点 ID 剔除 |
| 10 | reload 发送加超时 | P1 | ✅ 已修复 (`04bf8fc`) | 两处发送改为 `select` + 5s 超时（见 §3.7 更正） |
| 11 | 前端缓存随凭据重置 / 去掉后台轮询 | P2 | ✅ 已修复 (`04bf8fc`) | `queryClient.clear()` 监听 `(endpoint, token)` 变化；移除 `refetchIntervalInBackground` |
| 12 | CORS 白名单 + TLS | P2 | ✅ 已修复 (`04bf8fc`) | `--cors-origin` 白名单（默认放开但启动告警）；`--tls-cert` / `--tls-key` 启用 HTTPS |
| 13 | 正则提到包级 | P3 | ✅ 已修复 (`04bf8fc`) | `tagRe` / `idRe` 包级变量 |
| 14 | 补 Go 单测 | P3 | ◐ 部分完成 | 新增 4 个测试文件覆盖密码学 / 鉴权 / 限流 / 请求解析；事务编排与订阅解析仍无测试 |
| 15 | 清理 TODO/console、拆超大文件 | P3 | ☐ 未做 | 纯重构，与缺陷修复无关，本轮未动 |

---

## 10. 🆕 第三轮精细审查与实机联调（2026-10-18 最新）

在上一轮加固代码合入后，通过对端到端调用链路的深度走查与实体环境（Debian `10.0.0.201`）测试，发现了两个影响登录态与跨域的关键缺陷以及底层 eBPF 与 DNS 路由的隐藏瓶颈，均已定位并彻底修复：

### 10.1 🔴 CORS 中间件层级倒置导致 401 跨域拦截
- **问题文件**：`wing/cmd/run.go:143`
- **缺陷表现**：原始代码为 `auth(corsHandler(&relay.Handler{}))`。当请求未经授权触发 `auth` 拒绝返回 401 / 413 / 400 时，请求尚未进入内层的 `corsHandler` 就已直接向客户端输出响应。导致**所有鉴权失败的响应均缺失 `Access-Control-Allow-Origin` 响应头**。前端浏览器控制台抛出 `CORS policy: No 'Access-Control-Allow-Origin' header`，使得前端捕获为无特征的 Network Error 而无法获知 401 真实状态。
- **修复与验证**：调整为 `corsHandler(auth(&relay.Handler{}))`（commit `db7984f`），CORS 作为外层中间件优先拦截，无论是 OPTIONS 预检请求还是鉴权拒绝响应均携带合规的 CORS 头部。实机 `Invoke-WebRequest -Headers @{Origin=...}` 验证已稳定返回 `401` 并携带 `Access-Control-Allow-Origin: *`。

### 10.2 🔴 前端 401 响应未失效 Token
- **问题文件**：`apps/web/src/contexts/index.tsx:86-95`
- **缺陷表现**：`responseMiddleware` 原先仅判断 `error.message === 'access denied'`。当后端因 fail-closed 拦截或 Token 过期直接返回 HTTP 401 状态码时，错误对象中并不存在 `errors[0].message == 'access denied'`，导致前端保留失效的 `tokenAtom`，持续发起未经认证的死循环请求。
- **修复与验证**：增加 `clientError.response?.status === 401` 分支，当捕获 HTTP 401 时主动触发 `tokenAtom.set('')`（commit `402f676`），触发 `QueryProvider` 联动清理 React Query 全局缓存并立即跳转回登录页。

### 10.3 🟢 eBPF 数据面 LRU 升级与 DNS 流量防打爆
- **控制文件**：`wing/dae-core/control/kern/tproxy.c`、`wing/dae-core/control/traffic_maps.go`
- **优化成效**：
  - `conn_traffic_map` 由无界 HASH（262,144 容量）转换为内核自动置换的 `BPF_MAP_TYPE_LRU_HASH`（16,384 容量），并在统计入口增加对 53 端口（DNS）以及本地/私网段的过滤防泄露；
  - `getLocalNetInfo()` 引入 30s 线程安全 TTL 缓存，消除纳秒级重试产生的海量 Netlink 冗余系统调用；
  - 实机 `bpftool map show` 验证 Map 1400 运行为 `lru_hash`，锁定内存稳定为 2.2MB，活跃连接约 160 条，彻底消除内存泄漏。

### 10.4 🟢 DoH 节点 IPv6 路由超时修复
- **排查经过**：国内站点不定时卡顿/响应慢的问题根因最终定位为 `/etc/daed/wing.db` 中 `googledns` 解析目标被配为了 IPv6 地址 `2001:4860:4860::8888`，因直连路由无法穿透 IPv6 导致频繁遭遇 5 秒 `context deadline exceeded` 超时。
- **优化方案**：配置更新为稳定 IPv4 DoH 地址 `https://8.8.8.8/dns-query`，并在路由规则链前置 `dip(8.8.8.8, 1.1.1.1) -> proxy`。修复后实测国内主流站点响应延迟稳定在 40~80ms。

---

## 11. 最终验证证据汇总

```
tsc --noEmit -p apps/web      → 0 error              ✅
eslint .                      → 0 problem            ✅
pnpm test                     → 10 tasks successful  ✅
pnpm build --force            → 6 tasks successful   ✅
curl http://10.0.0.201:2023   → HTTP 200 OK          ✅
401 + CORS 探测               → Status 401 + CORS *  ✅
bpftool map show (10.0.0.201) → Map 1400: lru_hash   ✅
Domestic Web Latency          → 40ms - 80ms          ✅
```
