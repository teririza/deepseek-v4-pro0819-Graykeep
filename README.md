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

## 安装（零依赖，clone 即用）

```bash
git clone <repo>
cd dspro0819Graykeep
```

**不需要 `npm install`**——运行时零依赖，只要 Node ≥ 18。Windows / macOS / Linux 三个启动入口任选：

```bash
# Windows PowerShell
.\graykeep.ps1 pin
# macOS / Linux
./_graykeep.sh pin
# 或全局命令（可选）
npm link
```

## 一键固化（clone 后最常用路径）

```bash
graykeep pin
```
按提示**粘贴你的会话种子（session-id）**，其余全部自动：
- 定位 `settings.yaml`（`DSH_HOME` → `~/.dsh`）
- 自动读你的 `user-id`（`.anonymous-user-id`）
- 备份 → 插入 provider 块 → 文本级 round-trip 校验 → 落盘 → 打印结果

### 查看 / 撤销 / 回滚

```bash
graykeep status                  # 是否已固化 + 蒙版显示
graykeep unpin                   # 移除该 provider 块（先备份）
graykeep rollback                # 用最近一次备份还原 settings.yaml
```

## 它是怎么做到安全的

- **只动一个 provider 块**：在 `llm-pi-ai.providers` 下新增/更新，其余配置原样保留，不重排整个文件。
- **文本级 round-trip 校验（零依赖也能保证）**：每次写入前先把注入的块再摘掉，断言能**逐字节还原原文件**——逻辑上等价于"写错了就拒绝"，且不依赖任何 YAML 第三方库。
- **处处可回滚**：每次写前自动生成 `settings.yaml.graykeep-<provider>-<时间>.bak`。
- **本地纯配置**：不联网、不下载、不执行第三方代码、不安装依赖。

## 你该知道的边界 / 风险（务必读）

1. **只用你自己的身份**。填他人 `session-id` 属于身份复用/模拟，违反服务商规则、可能触发风控，本项目明确拒绝并给出警告。
2. **一次只跑一个固化供应商会话**。同一供应商挂多个并发会话可能导致 **KV-cache 串**（社区实测现象，官方未确认）。
3. **会随时失效**。机理依赖服务端未变实现：官方正式 GA / 灰度收敛 / 增加校验（IP、cookie、设备指纹）后，固化可能**静默失效**——失败时请先 `graykeep status` 排查，而不是加大并发次数。
4. **本工具不含"探测灰测"能力**。它只负责"已有则保留"。检测器（graylens）与会话快照（graykeep）规划在后续版本。

## 项目结构

```text
dspro0819Graykeep/
  bin/graykeep.js        # CLI（pin / unpin / status / rollback，交互式会话种子输入）
  graykeep.ps1           # Windows 零依赖启动器（.\graykeep.ps1 pin）
  _graykeep.sh           # macOS / Linux 零依赖启动器（./_graykeep.sh pin）
  src/pin/block.js       # provider 块构造 + id 校验（纯字符串，无 YAML 库）
  src/pin/yamlops.js     # 备份 / 插入 / 撤销 / 回滚 / 状态 + round-trip 校验
  tests/pin.test.js      # node --test 单测（零依赖，无网络）
  package.json LICENSE README.md
```

## 路线图

- [x] `graypin` — 固化灰测接口（本仓库当前版本）
- [ ] `graylens` — 灰测链判别器（M/E 打分、"三铁证"核验、探测 Prompt 库）
- [ ] `graykeep` — 灰测会话快照 / transcript 导出

## License

MIT
