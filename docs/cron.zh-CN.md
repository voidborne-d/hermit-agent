# 定时任务(scheduled tasks)

Hermit Agent 给你**三层**定时方案。按"任务要活多久"+"需不需要会话上下文"选层。

| 层 | 重启后存活? | 有会话上下文? | 用它的时候 |
|---|---|---|---|
| `cron` skill(`CronCreate`) | ❌ 不存活,session 退出就死 | ✅ 有完整对话上下文 | 一次性提醒、临时探针、只在当前 session 有意义的事 |
| `HEARTBEAT.md` | ✅ 下次 session 醒来还活 | ✅ 有上下文 | 懒检查、memory 维护、需要 agent 基于最新状态"思考"一下 |
| LaunchAgent plist / `crontab` | ✅ OS 级,操作系统不挂就活 | ❌ 只是 shell 命令,没 agent 上下文 | 监控、日志采集、agent 睡死了也不能漏的事 |

常见组合:**两层叠**——LaunchAgent 把原始数据落到磁盘,`HEARTBEAT.md` 让 agent 下次醒来分析最新条目。

## 第 1 层: `cron` skill

**生命周期:** session-only。

内置 skill 封装 Claude Code 的 `CronCreate` harness。任务在 REPL idle 时触发,不打断正在跑的 turn,agent 一重启就死。

### 创建任务

在 Telegram 里告诉 agent:

> "每 30 分钟,扫一下 `memory/today.md`,标记看起来 urgent 的条目。"

Agent 会产生一个 CronCreate 调用,bootstrap prompt 里先读 persona 文件(`SOUL.md / IDENTITY.md / USER.md / AGENTS.md / TOOLS.md / MEMORY.md` + 今天的 `memory/`),然后执行任务,然后记录到当天 daily memory,最后通过 Telegram 汇报。

### 列出 / 删除任务

> "列出我当前的定时任务。"  
> "删掉 task `abc123`。"

### 限制

- `durable: true` 在当前 harness 是空操作——别指望它。
- 任务存内存里,不落盘。重启就丢。
- skill 会把分钟字段挑成 `:07, :23, :43` 之类 offset,避开 `:00 / :30` 流量高峰。

## 第 2 层: `HEARTBEAT.md`

**生命周期:** 重启后还活,在 heartbeat poll 触发时执行。

你配一个定时触发器(用 LaunchAgent 或系统 `crontab`)戳 agent 一下,agent 收到"heartbeat"提示时读 `HEARTBEAT.md` 决定做啥。适合**需要 Claude 推理但又必须跨重启**的任务。

模板里 `template/HEARTBEAT.md` 是起点,把你想在每次心跳跑的检查写进去。

典型接线:

1. LaunchAgent(第 3 层)每 N 分钟触发。
2. 这个 LaunchAgent 的命令是 `tmux send-keys -t claude-<agent> 'Heartbeat check.' Enter` —— 把提示注入到 agent 里。
3. Agent 收到 "Heartbeat check." 后读 `HEARTBEAT.md` 开始工作。

"做什么"在 agent 能编辑的 markdown 里,"什么时候"在 OS 层 —— 两边各管各的、都稳。

## 第 3 层: LaunchAgent plist(macOS 原生)

**生命周期:** 除非 Mac 挂了,否则都活着。

macOS 上真正靠谱的 durable scheduler 是 `~/Library/LaunchAgents/` 里的 plist。`crontab` 也能用,但 macOS 下第一次跑 `crontab -e` 可能会卡在等 Full Disk Access 弹窗(弹窗可能压根不出现)。LaunchAgent 绕过这个坑。

### 起步例子

模板里带 `launchd/cron-example.plist.tmpl`。拷 + 改 + 加载:

```bash
# 按 agent 名生成唯一 label
AGENT=$(basename "$PWD")          # 你的 agent 目录名
cp launchd/cron-example.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK_NAME>.plist

# 编辑:改 <TASK_NAME>、ProgramArguments 里的脚本路径、StartInterval
$EDITOR ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK_NAME>.plist

# 装载
launchctl load ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK_NAME>.plist
```

关键字段:

- **`Label`** —— 每个 task 唯一。约定:`com.hermit-agent.<agent>.<task>`。
- **`ProgramArguments`** —— 要跑的命令。第一项 binary(`/bin/bash`),后面是参数。
- **`StartInterval`** —— 间隔秒数。`600` = 10 分钟。
- **`RunAtLoad`** —— `true` 表示加载后立刻跑一次。默认 `false` 等第一个 interval。
- **`StandardOutPath` / `StandardErrorPath`** —— stdout/stderr 落盘位置。指到 `.claude/state/` 避免误 commit 进 git。
- **`WorkingDirectory`** —— 可选,但脚本里用相对路径时要配。

### 卸载 / 删除

```bash
launchctl unload ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK_NAME>.plist
rm ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK_NAME>.plist
```

### 确认在跑

```bash
launchctl list | grep hermit-agent
launchctl print gui/$(id -u)/com.hermit-agent.${AGENT}.<TASK_NAME> | grep -E 'state|runs|last exit'
```

### 系统 `crontab` 替代

偏好 `crontab -e` 的话:

```bash
# 每 10 分钟跑一次
*/10 * * * * /Users/you/claudeclaw/my-hub/scripts/some-task.sh >> /Users/you/claudeclaw/my-hub/.claude/state/some-task.log 2>&1
```

两个坑:
1. 第一次装 macOS 可能因为没授 Full Disk Access 悄悄卡住 `crontab -e`。卡超过几秒就取消,改 LaunchAgent。
2. 必须用绝对路径 —— crontab 跑在最小环境,没你的 shell alias 或 PATH。

## 从 cron 给 Telegram 发消息

任何 durable 任务想 ping 你,可以复用 hook 里那套 token + chat_id:

```bash
token=$(jq -r '.env.TELEGRAM_BOT_TOKEN // empty' "$HUB_DIR/.claude/settings.local.json")
chat_id=$(jq -r '.env.TELEGRAM_CHAT_ID // empty' "$HUB_DIR/.claude/settings.local.json")
curl -sS -m 10 -X POST "https://api.telegram.org/bot${token}/sendMessage" \
  -d "chat_id=${chat_id}" \
  --data-urlencode "text=定时任务触发: $(date)"
```

模板里 `scripts/multi-agent-status-report.sh` 就是这个模式的例子。

## 判断原则

- **只在 session 活着时需要** → `cron` skill。
- **agent heartbeat 醒来时要处理** → `HEARTBEAT.md`。
- **agent 死了也要跑** → LaunchAgent(或 `crontab`,实在不行才用)。

拿不准就用 LaunchAgent。磁盘便宜,漏告警贵。
