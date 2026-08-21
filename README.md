# dspro0819 — Graykeep · DSH 灰测会话保留工具集

一套围绕 **DeepSeek 灰测（canary）会话** 的本地工具集。当前开源的是第一块：**`graypin` — 固化灰测接口**（把自有灰测会话的身份固化进 DSH 供应商配置，带备份 / 回滚 / 断言校验）。

> 定位：**自有会话的身份保留工具**，不是"凭空获取灰测"的破解器，也不下载/替换任何模型文件。机理是复用**你自己**已命中灰测的会话标识；没有灰测会话时本工具无法凭空生效。

---

## 背景：为什么会有这么个流程

DSH（DeepSeek Harness）在调用 DeepSeek 官方接口时，会自动携带两个身份头（源码见 `@deepseek-ai/dsh-llm-deepseek`）：

```text
x-deepseek-harness-user-id:    <匿名用户 id>      // 通常 = ~/.dsh/.anonymous-user-id
x-deepseek-harness-session-id: session-<uuid>     // 每个会话一个
```

灰度服务端按身份/种子加权抽样决定该会话进入灰测集群，并在会话内保持粘性。**如果你某天"抽中"了一条灰测会话**，把它的 `session-id`（连同你自己的 `user-id`）固化成一个固定携带这两个头的供应商，后续请求就能稳定沿用该灰测身份——这就是 `graypin` 做的事。它只改你 `settings.yaml` 里的一个配置块，不碰别的东西。

## 安装

```bash
git clone <repo>
cd dspro0819Graykeep
npm install
npm link          # 可选：获得全局 graykeep 命令
```

要求 Node ≥ 18。

## 用法

### 固化（pin）
先获取你自己的值：
- `user-id`：`~/.dsh/.anonymous-user-id`（命令会自动读取）
- `session-id`：你那条灰测会话的 id（格式 `session-<uuid>`，即会话目录名 / 抓包得到的 `x-deepseek-harness-session-id` 值）

```bash
# 自动读 .anonymous-user-id，只填 session-id
graykeep pin --session-id session-2213a0f3-5f34-4b65-b83e-89878fe65361

# 先看改动，不落盘
graykeep pin --session-id session-... --dry-run

# 自定义供应商名 / 模型清单
graykeep pin --session-id session-... --provider deepseek --models deepseek-v4-pro,deepseek-v4-flash
```

写入前会自动：**备份 → 插入/更新 provider 块 → 重新解析 YAML 校验头值 → 才落盘**。

### 查看 / 撤销 / 回滚

```bash
graykeep status                  # 是否已固化 + 蒙版显示
graykeep unpin                   # 移除该 provider 块（先备份）
graykeep rollback                # 用最近一次备份还原 settings.yaml
```

## 它是怎么做到安全的

- **只动一个 provider 块**：在 `llm-pi-ai.providers` 下新增/更新，其余配置原样保留，不重排整个文件。
- **写前校验**：每次写入都先 `yaml.parse` 重解析，校验 provider 存在且头的 `session-id` 完整存活，否则拒绝写入。
- **处处可回滚**：每次写前自动生成 `settings.yaml.graykeep-<provider>-<时间>.bak`。
- **本地纯配置**：不联网、不下载、不执行第三方代码，唯一依赖是 `yaml` 解析库。

## 你该知道的边界 / 风险（务必读）

1. **只用你自己的身份**。填他人 `session-id` 属于身份复用/模拟，违反服务商规则、可能触发风控，本项目明确拒绝并给出警告。
2. **一次只跑一个固化供应商会话**。同一供应商挂多个并发会话可能导致 **KV-cache 串**（社区实测现象，官方未确认）。
3. **会随时失效**。机理依赖服务端未变实现：官方正式 GA / 灰度收敛 / 增加校验（IP、cookie、设备指纹）后，固化可能**静默失效**——失败时请先 `graykeep status` 排查，而不是加大并发次数。
4. **本工具不含"探测灰测"能力**。它只负责"已有则保留"。检测器（graylens）与会话快照（graykeep）规划在后续版本。

## 项目结构

```text
dspro0819Graykeep/
  bin/graykeep.js        # CLI
  src/pin/block.js       # provider 块构造 + id 校验
  src/pin/yamlops.js     # 备份 / 插入 / 撤销 / 回滚 / 状态
  tests/pin.test.js      # node --test 单测（无网络）
  package.json LICENSE README.md
```

## 路线图

- [x] `graypin` — 固化灰测接口（本仓库当前版本）
- [ ] `graylens` — 灰测链判别器（M/E 打分、"三铁证"核验、探测 Prompt 库）
- [ ] `graykeep` — 灰测会话快照 / transcript 导出

## License

MIT
