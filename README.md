# AI四方辩论 Skill

让 4 个 AI（豆包、GPT、Claude、Gemini）围绕同一话题进行三阶段辩论：

1. **独立回答** — 四个AI各自分析，展现不同风格
2. **互相挑刺** — 交叉质疑，暴露各自盲区
3. **最终融合** — 取长补短，输出深度分析

## 为什么要这样做？

单个AI有自己的"偏见"：
- 豆包爱甩数据但不敢下判断
- GPT太温柔容易和稀泥
- Claude逻辑强但像读论文
- Gemini够犀利但容易极端

让它们互怼，就能互相补盲区，**4个70分的AI合在一起能输出90分的内容**。

## 快速开始

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env 填入你的 API Key

# 2. 加载环境变量
source .env && export YUNWU_API_KEY SEARCH_API_KEY

# 3. 运行
node debate.mjs "你想讨论的话题" "标签"
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `debate.mjs` | 核心版 — 终端输出 + Markdown/HTML 保存 |
| `debate-feishu.mjs` | 飞书版 v1 — 奇葩说模式（正反方对吵） |
| `debate-feishu-v2.mjs` | 飞书版 v2 — 三阶段流程，每个AI发言独立卡片 |
| `.env.example` | 环境变量配置模板 |
| `REPORT.md` | 测试报告 |

## 模型配置

默认通过云物AI中转调用，支持替换为任意 OpenAI 兼容 API。在代码中修改 `MODELS` 对象即可替换模型。

## License

MIT
