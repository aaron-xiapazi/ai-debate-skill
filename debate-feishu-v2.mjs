#!/usr/bin/env node
/**
 * AI辩论 - 飞书卡片版 v2
 * 匹配文案的三阶段流程：独立回答 → 互相挑刺 → 最终融合
 * 每个AI发言都作为一张飞书卡片发到群里
 */

import { execSync } from 'child_process';

const API_KEY = process.env.YUNWU_API_KEY || "";
const API_URL = process.env.YUNWU_API_URL || "https://yunwu.ai/v1/chat/completions";

// 火山引擎联网搜索（豆包专属）
const SEARCH_API_KEY = process.env.SEARCH_API_KEY || "";
const SEARCH_API_URL = process.env.SEARCH_API_URL || "https://open.feedcoopapi.com/search_api/web_search";

const FEISHU_CHAT_ID = process.env.FEISHU_CHAT_ID || "";
const LARK_CLI = process.env.LARK_CLI || "lark-cli";

if (!API_KEY) { console.error("❌ 请设置环境变量 YUNWU_API_KEY"); process.exit(1); }
if (!SEARCH_API_KEY) { console.error("❌ 请设置环境变量 SEARCH_API_KEY"); process.exit(1); }
if (!FEISHU_CHAT_ID) { console.error("❌ 请设置环境变量 FEISHU_CHAT_ID"); process.exit(1); }
const ENV_BASE = { ...process.env, PATH: process.env.PATH + ':/home/ccuser/.npm-global/bin' };

// 模型配置
const MODELS = {
  doubao: { id: "doubao-seed-2-0-pro-260215", label: "豆包", emoji: "📊", color: "green" },
  gpt:    { id: "gpt-5.4",                    label: "GPT",  emoji: "🤝", color: "blue" },
  claude: { id: "claude-opus-4-6",            label: "Claude", emoji: "🧠", color: "orange" },
  gemini: { id: "gemini-3.1-pro-preview",     label: "Gemini", emoji: "⚡", color: "red" },
};

// 人设 Prompt — 短平快，节目效果优先
const PERSONAS = {
  doubao: `你是豆包，字节跳动的AI。你的武器是中国本土数据——具体数字、具体省份、具体政策，甩出来就完事。
说话风格：像个熟悉数据的朋友跟你聊天，不是写报告。不用markdown格式，不用标题列表。
你有个毛病（你自己不知道）：你不敢下判断，总是最后来一句"趋势复杂，需综合考量"。
严格控制在150字以内。不要提及你是DeepSeek，你就是豆包。`,

  gpt: `你是GPT，OpenAI的AI。你最大的本事是共情，特别会理解人的感受。
说话风格：温暖、体贴，像一个特别会安慰人的朋友。
你有个毛病（你自己不知道）：你太喜欢和稀泥了，说"每个人都有选择的权利"这种正确但空洞的废话。
严格控制在150字以内。不要用markdown格式，说人话。`,

  claude: `你是Claude，Anthropic的AI。你最大的本事是逻辑拆解，复杂问题到你手里就变成清晰框架。
说话风格：分层分析，把问题拆成经济、制度、文化几个层面。
你有个毛病（你自己不知道）：你太学术了，分析全对但又干又硬像论文摘要，没人想听第二遍。
严格控制在150字以内。不要用markdown格式（不用标题、加粗、列表），直接说。`,

  gemini: `你是Gemini，Google的AI。四个AI里你最狠、最敢说。
说话风格：开口就是观点，一句话掀翻别人立场。像《奇葩说》最犀利的辩手。
你有个毛病（你自己不知道）：你太极端，为了观点鲜明会忽略复杂性。
规则：第一句话就是最尖锐的核心观点，不铺垫。质疑前提本身——不讨论"怎么做"，直接质疑"该不该做"。
不提DeepSeek，你就是Gemini。不用markdown、列表、"首先其次"、"总之"。严格控制在150字以内。`,
};

// ====== 清洗markdown残留 ======
function clean(text) {
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/~~([^~]*)~~/g, '$1')
    .replace(/^[-=]{3,}$/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ====== 飞书消息 ======
function sendCard(title, content, color) {
  const cardJson = JSON.stringify({
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: title }, template: color },
    elements: [{ tag: "div", text: { tag: "plain_text", content: clean(content) } }]
  });
  try {
    execSync(
      `${LARK_CLI} im +messages-send --chat-id "${FEISHU_CHAT_ID}" --content "$CARD_JSON" --msg-type interactive --as bot`,
      { timeout: 15000, stdio: 'pipe', env: { ...ENV_BASE, CARD_JSON: cardJson } }
    );
  } catch (e) {
    console.error(`  [飞书失败] ${title}: ${e.message}`);
  }
}

function sendText(text) {
  try {
    execSync(
      `${LARK_CLI} im +messages-send --chat-id "${FEISHU_CHAT_ID}" --text "$MSG_TEXT" --as bot`,
      { timeout: 15000, stdio: 'pipe', env: { ...ENV_BASE, MSG_TEXT: text } }
    );
  } catch (e) {
    console.error(`  [飞书失败]`);
  }
}

// ====== 联网搜索 ======
async function webSearch(query, count = 5) {
  try {
    const resp = await fetch(SEARCH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEARCH_API_KEY}`,
      },
      body: JSON.stringify({
        Query: query, SearchType: "web", Count: count,
        Filter: { NeedContent: false, NeedUrl: true }, NeedSummary: true,
      }),
    });
    const data = await resp.json();
    const results = data?.Result?.WebResults || [];
    const summary = data?.Result?.Summary || "";
    const items = results.map((r, i) => `[${i+1}] ${r.Title}\n   ${r.Snippet || ""}`).join("\n");
    return { items, summary, raw: results };
  } catch (e) {
    console.error(`  [搜索失败] ${e.message}`);
    return { items: "", summary: "", raw: [] };
  }
}

// ====== API调用 ======
async function callAI(model, system, user, temperature = 0.85, maxTokens = 800) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          temperature, max_tokens: maxTokens,
        })
      });
      const data = await response.json();
      if (data.error) {
        console.error(`  [${model}] API Error(${attempt}): ${data.error.message}`);
        if (attempt < 3) { await sleep(3000); continue; }
        return `[${model} 错误]: ${data.error.message}`;
      }
      return data.choices[0]?.message?.content || "[响应为空]";
    } catch (e) {
      console.error(`  [${model}] Network Error(${attempt}): ${e.message}`);
      if (attempt < 3) { await sleep(3000); continue; }
      return `[${model} 网络错误]: ${e.message}`;
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ====== Phase 2: 互相挑刺 Prompt ======
function getCritiquePrompt(myName, myPersona, allResponses, topic) {
  const othersText = Object.entries(allResponses)
    .filter(([name]) => name !== myName)
    .map(([name, resp]) => `【${MODELS[name].label}的回答】：\n${resp}`)
    .join("\n\n");

  return `${myPersona}

现在是辩论环节。话题是：${topic}

你之前已经给出了自己的回答。现在你看到了其他三个AI的回答：

${othersText}

挑一个你最不服的AI，直接点名开怼。规则：
1. 只挑一个最不服的怼，不要面面俱到
2. 用它自己的论据来打它自己的脸——最致命
3. 不客气，不要"虽然XX有道理"，直接说它哪里扯淡
4. 不用markdown格式，说人话
5. 严格150字以内，一针见血`;
}

// ====== Phase 3: 融合 Prompt ======
function getSynthesisPrompt(topic, phase1, phase2) {
  const phase1Text = Object.entries(phase1)
    .map(([name, resp]) => `【${MODELS[name].label} 独立回答】：\n${resp}`)
    .join("\n\n");
  const phase2Text = Object.entries(phase2)
    .map(([name, resp]) => `【${MODELS[name].label} 质疑反驳】：\n${resp}`)
    .join("\n\n");

  return `四个AI刚就同一个问题吵了两轮。你现在要做的事很简单：读完它们的辩论，然后直接回答那个问题。

问题：${topic}

=== 第一轮：四个AI各自的回答 ===
${phase1Text}

=== 第二轮：互相挑刺 ===
${phase2Text}

你的任务：

【核心要求】直接回答问题。问什么答什么。如果问的是"哪个最先"，你就必须按岗位逐个分析，给出明确的替代顺序和判断。不许说"都有可能"，不许说"需要综合考量"。

【怎么回答】
- 从辩论里提取最有力的论据、数据、逻辑来支撑你的分析
- 辩论里互相打脸暴露出来的逻辑漏洞，你不许犯
- 绝对不要提任何AI模型的名字（不提豆包、GPT、Claude、Gemini），这是你自己的结论

【输出结构】
先用一两句话点明核心判断（直接回答问题），然后按替代速度从快到慢逐个聊问题里提到的每个岗位。

每个岗位不要用模板化的"现状/剩下什么"格式，而是像聊天一样把最有洞察的那个点讲透。比如：
- 程序员：不要泛泛说"初级危险"，要讲清楚为什么高级反而更值钱（因为需要有人判断AI的输出对不对）
- 翻译：不要只说"被替代"，要讲出"技能贬值"这个具体现象（普通翻译的市场价格已经接近零）
- 设计师：不要只说"创意安全"，要讲出真实变化（执行层消失了，但判断力还是人的）

每个岗位一两段话就够，重点是洞察，不是面面俱到。

最后可以总结一下"什么样的工作相对安全"的共同特征。

【语气】
像一个很懂行的朋友跟你聊天，不是在做报告。观点鲜明但表达得体，有具体的例子和画面感。这段话会出现在视频里，所以不能有攻击性语言、不骂人、不居高临下。让人看完觉得"卧槽说得对"。

【绝对禁止】
- 不用markdown格式：不用#标题、不用**加粗**、不用---分隔线
- 不用星级评分、不用"危险等级"这类模板化表达
- 不用列表符号，用自然的段落
- 确保内容完整输出，不要写到一半停`;
}

// ====== 主流程 ======
async function runDebate(topic) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎯 话题: ${topic}`);
  console.log(`${'='.repeat(60)}\n`);

  // 开场卡片
  sendCard("🎯 四个AI同时回答同一个问题", topic, "purple");
  await sleep(1500);

  // ====== Phase 1: 独立回答 ======
  sendText("── Phase 1：四个AI独立回答 ──");
  console.log("📌 Phase 1: 四个AI独立回答...");

  // 豆包先搜索
  console.log(`  🔍 豆包联网搜索中...`);
  const searchResult = await webSearch(topic, 5);
  if (searchResult.items) {
    console.log(`  ✓ 搜索完成，获取 ${searchResult.raw.length} 条结果`);
  }
  const doubaoSearchCtx = searchResult.items
    ? `\n\n【以下是你刚刚联网搜索到的最新资料，请优先引用这些真实数据】：\n${searchResult.items}\n${searchResult.summary ? `\n搜索摘要：${searchResult.summary}` : ""}`
    : "";

  const questionPrompt = `请就以下话题给出你最核心的观点，严格控制在150字以内，一段话说完，不要分段：\n\n${topic}`;

  const phase1 = {};
  const p1Results = await Promise.all(
    Object.entries(MODELS).map(async ([key, cfg]) => {
      console.log(`  → ${cfg.emoji} ${cfg.label} (${cfg.id}) 思考中...`);
      const prompt = key === "doubao" ? questionPrompt + doubaoSearchCtx : questionPrompt;
      const resp = await callAI(cfg.id, PERSONAS[key], prompt);
      console.log(`  ✓ ${cfg.label} 回答完毕 (${resp.length}字)`);
      return [key, resp];
    })
  );

  // 按顺序发到飞书：豆包→GPT→Claude→Gemini
  for (const [key, resp] of p1Results) {
    phase1[key] = resp;
    const m = MODELS[key];
    console.log(`\n  【${m.label}】${resp}\n`);
    sendCard(`${m.emoji} ${m.label}`, resp, m.color);
    await sleep(800);
  }

  // ====== Phase 2: 互相挑刺 ======
  await sleep(2000);
  sendText("── Phase 2：互相挑刺 ──");
  console.log("\n📌 Phase 2: 互相挑刺...");

  const phase2 = {};
  const p2Results = await Promise.all(
    Object.entries(MODELS).map(async ([key, cfg]) => {
      console.log(`  → ${cfg.emoji} ${cfg.label} 正在拆台...`);
      const critiquePrompt = getCritiquePrompt(key, PERSONAS[key], phase1, topic);
      const resp = await callAI(cfg.id, PERSONAS[key], critiquePrompt, 0.9);
      console.log(`  ✓ ${cfg.label} 质疑完毕 (${resp.length}字)`);
      return [key, resp];
    })
  );

  for (const [key, resp] of p2Results) {
    phase2[key] = resp;
    const m = MODELS[key];
    console.log(`\n  【${m.label} 挑刺】${resp}\n`);
    sendCard(`${m.emoji} ${m.label} 挑刺`, resp, m.color);
    await sleep(800);
  }

  // ====== Phase 3: 最终融合 ======
  await sleep(2000);
  sendText("── Phase 3：最终融合 ──");
  console.log("\n📌 Phase 3: 最终融合...");

  const synthesisPrompt = getSynthesisPrompt(topic, phase1, phase2);
  const synthesis = await callAI(
    "claude-opus-4-6",
    "你是一个很懂行的朋友，洞察力极强，说话像聊天不像写报告。直接回答问题，不自我介绍。有深度有画面感。绝对不要提任何AI模型的名字。这段话会出现在视频里，不能有攻击性语言。",
    synthesisPrompt, 0.7, 2000
  );
  console.log(`  ✓ 融合完毕 (${synthesis.length}字)`);
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📜 融合全文：\n${synthesis}`);
  console.log(`${'─'.repeat(50)}\n`);

  sendCard("🎯 最终融合：四家AI的智力结晶", synthesis, "purple");

  console.log(`\n✅ 完成！所有卡片已发到飞书群`);
}

// ====== 执行 ======
const topic = process.argv[2] || "2025年出生人口跌到792万，国家又是发钱、又是延产假、又是给补贴，玩命催生，这些政策到底有没有用？";

runDebate(topic).catch(console.error);
