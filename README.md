# dspro0819 — Graykeep · DSH 灰测会话保留工具集 / Gray-test session preservation toolkit

> **简介 / Intro**
>
> **中文**：一个纯本地、零依赖的一键工具，把你**自己**已命中的灰测（canary）会话身份固化进 DSH（DeepSeek Harness）的供应商配置，带上备份 / 回滚 / 文本级校验。只改 `settings.yaml` 里的一个 provider 块，不做别的。
>
> **English**：A zero-dependency, one-command local tool that pins **your own** already-assigned gray-test (canary) session identity into a DSH (DeepSeek Harness) provider configuration — with backup / rollback / round-trip verification. It only edits one provider block in `settings.yaml` and touches nothing else.

---

## ⚠️ 免责声明 / Disclaimer

> **中文**
>
> 本项目是**纯本地的实验性配置工具，仅供技术学习与个人使用**。它复用的是**你自己账号下已存在**的会话身份，不下载、不替换、不攻击任何模型或服务。但请注意：
>
> 1. 使用本项目**可能违反您所使用服务（含 DeepSeek）的服务条款**，可能带来账号风控、功能随时失效等后果；
> 2. 本项目**与 DeepSeek 及任何组织无关**，作者不对任何使用后果负责；
> 3. 请**勿**将其用于他人身份、账号冒用，或任何违反规则与法律的目的；
> 4. 使用前请同意：一切后果自担，建议仅在您自己的、低风险的环境中使用。
>
> **English**
>
> This project is an **experimental, local-only configuration utility for learning and personal use**. It reuses a session identity that **already exists under your own account**; it does not download, replace, circumvent, or attack any model or service. Please note:
>
> 1. Using this project **may violate the terms of service of the service you use (including DeepSeek)**, and may result in account risk or features silently breaking at any time;
> 2. This project is **not affiliated with DeepSeek or any organization**; the authors accept no responsibility for any consequences;
> 3. **Do not** use it with someone else's identity, with account impersonation, or for any purpose that violates rules or the law;
> 4. By using it you agree to bear all consequences yourself, and you should only use it in your own, low-risk environment.

---

## 背景 / Background

DSH（DeepSeek Harness）在调用 DeepSeek 官方接口时，会自动携带两个身份头（源码见 `@deepseek-ai/dsh-llm-deepseek`）：

```text
x-deepseek-harness-user-id:    <匿名用户 id>      // 通常 = ~/.dsh/.anonymous-user-id
x-deepseek-harness-session-id: session-<uuid>     // 每个会话一个
```

The serving-side grayscale router decides per-session (by identity / seed, with session stickiness) whether a conversation lands in the gray-test cluster. **If you were ever assigned a gray-test session**, `graypin` pins that session's `session-id` (plus your own `user-id`) as a provider that always carries those two headers, so follow-up requests keep riding the same gray-test identity. It only edits one config block in `settings.yaml`.

## 安装 / Install（零依赖，clone 即用 / zero-dependency, clone and run）

```bash
git clone https://github.com/teririza/deepseek-v4-pro0819-Graykeep.git
cd deepseek-v4-pro0819-Graykeep
```

**不需要 `npm install`** —— 运行时零依赖，只要 Node ≥ 18。
**No `npm install` needed** — zero runtime dependencies; you only need Node ≥ 18.

```bash
# Windows PowerShell
.\graykeep.ps1 pin
# macOS / Linux
./_graykeep.sh pin
# 或者装成全局命令后直接敲 graykeep（可选）
npm link      # -> 之后可全局使用：graykeep pin
```

> 下文 `graykeep` 一律表示 "启动器或全局命令"：Windows 用 `.\graykeep.ps1`，macOS/Linux 用 `./_graykeep.sh`，或 `npm link` 后的全局 `graykeep`。

## 一键固化 / One-command pin

```bash
graykeep pin
```

按提示粘贴你的会话种子（session-id），其余全部自动；等价命令行写法：`graykeep pin --session-id session-<uuid>`。
Paste your session seed (session-id) when prompted; everything else is automatic; the equivalent one-liner is `graykeep pin --session-id session-<uuid>`.

- 定位 `settings.yaml`（`DSH_HOME` → `~/.dsh`）/ locate `settings.yaml`
- 自动读你的 `user-id`（`.anonymous-user-id`）/ auto-read your `user-id`
- 备份 → 插入 provider 块 → 文本级 round-trip 校验 → 落盘 → 打印结果 / backup → insert provider block → round-trip verify → write → report

### 固化之后：在 DSH 里启用并验证 / After pinning: enable & verify in DSH
1. 在 DSH **新建一个会话**，供应商/模型选 **`Test DeepSeek` + `deepseek-v4-pro`**（或 `deepseek-v4-flash`）。/ Create a **new conversation** in DSH and pick provider **`Test DeepSeek`** with model `deepseek-v4-pro` (or `flash`).
2. 发一条长任务，核对"满血链/灰测"三铁证：成串成串的思考输出、段落尾部停顿、V4-Pro 约 25 tok/s。/ Send a long task and check the three "full-chain" signs: notably long chained reasoning, pauses at paragraph boundaries, and ~25 tok/s throughput on V4-Pro.
3. 该供应商**同时只跑一个会话**，避免 KV-cache 串；换任务请在当前会话内继续。/ Run **one** session on this provider at a time to avoid KV-cache cross-talk; keep working in the same conversation.

### 查看 / 撤销 / 回滚 · Inspect / undo / rollback

```bash
graykeep status                  # 是否已固化 + 蒙版显示 / pinned? (masked values)
graykeep unpin                   # 移除该 provider 块（先备份）/ remove block (backed up)
graykeep rollback                # 用最近一次备份还原 settings.yaml / restore from latest backup
```

## 安全设计 / Safety design

- **只动一个 provider 块**：在 `llm-pi-ai.providers` 下新增/更新，其余配置原样保留，不重排整个文件。
  Only one provider block is touched under `llm-pi-ai.providers`; the rest of the file is left byte-for-byte intact.
- **文本级 round-trip 校验（零依赖也能保证）**：写入前先把注入的块摘掉，断言结果与"未 pin 前的文件摘块后"逐字节一致——逻辑上等价于"任何多余改动都拒绝写入"，不依赖任何 YAML 第三方库。
  A text-level round-trip check (no third-party YAML lib): before writing, the injected block is removed again and must exactly reproduce the unpinned file — i.e. the block is the only sanctioned diff.
- **处处可回滚**：每次写前自动生成 `settings.yaml.graykeep-<provider>-<时间>.bak`。
  Every write is preceded by an automatic backup (`*.graykeep-*.bak`).
- **本地纯配置**：不联网、不下载、不执行第三方代码、不安装依赖。
  Pure local config: no network, no downloads, no third-party code, no dependency install.

## 边界与风险 / Boundaries & risks

1. **只用你自己的身份**。填他人 `session-id` 属于身份复用/模拟，违反服务商规则、可能触发风控，本项目拒绝并告警。
   **Use only your own identity.** Filling in someone else's `session-id` is identity reuse/impersonation, violates service rules, and may trigger risk control — the tool validates and warns.
2. **一次只跑一个固化供应商会话**。同一供应商挂多个并发会话可能导致 **KV-cache 串**（社区实测现象，官方未确认）。
   Run **one** pinned-provider session at a time. Multiple concurrent sessions on the same provider may **cross KV caches** (community-reported; unconfirmed by the vendor).
3. **会随时失效**。机理依赖服务端未变实现：正式 GA、灰度收敛、增加 IP/cookie/设备校验后，固化可能**静默失效**——请先 `graykeep status` 排查，而不是加大并发。
   It can silently stop working when the vendor changes the implementation (full GA, grayscale convergence, added IP/cookie/device checks). Diagnose with `graykeep status`; do not crank up concurrency.
4. **本工具不含"探测灰测"能力**。它只负责"已有则保留"。检测器（`graylens`）与会话快照（`graykeep`）规划在后续版本。
   This tool does **not** probe for gray-test access; it only preserves what you already have. The detector (`graylens`) and session snapshot (`graykeep`) are planned for later versions.

## 项目结构 / Layout

```text
dspro0819Graykeep/
  bin/graykeep.js        # CLI（pin / unpin / status / rollback，交互式会话种子输入）
  graykeep.ps1           # Windows 零依赖启动器 / zero-dep launcher (Windows)
  _graykeep.sh           # macOS / Linux 零依赖启动器 / zero-dep launcher (POSIX)
  src/pin/block.js       # provider 块构造 + id 校验（纯字符串，无 YAML 库）
  src/pin/yamlops.js     # 备份 / 插入 / 撤销 / 回滚 / 状态 + round-trip 校验
  tests/pin.test.js      # node --test 单测（零依赖，无网络）/ tests (zero-dep, offline)
  package.json LICENSE README.md
```

## 路线图 / Roadmap

- [x] `graypin` — 固化灰测接口 / pin the gray-test provider (current release)
- [ ] `graylens` — 灰测链判别器（M/E 打分、"三铁证"核验、探测 Prompt 库）/ gray-chain discriminator (M/E scoring, "three-proof" checks, probe prompt bank)
- [ ] `graykeep` — 灰测会话快照 / transcript 导出 / gray-test session snapshot & transcript export

## License

MIT
