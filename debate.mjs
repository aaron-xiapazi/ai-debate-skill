#!/usr/bin/env node
/**
 * AI辩论Skill - 匹配文案的三阶段辩论流程
 * Phase 1: 四个AI独立回答
 * Phase 2: 互相挑刺（交叉质疑）
 * Phase 3: 最终融合（取长补短）
 */

const API_KEY = process.env.YUNWU_API_KEY || "";
const API_URL = process.env.YUNWU_API_URL || "https://yunwu.ai/v1/chat/completions";

// 火山引擎联网搜索
const SEARCH_API_KEY = process.env.SEARCH_API_KEY || "";
const SEARCH_API_URL = process.env.SEARCH_API_URL || "https://open.feedcoopapi.com/search_api/web_search";

if (!API_KEY) { console.error("❌ 请设置环境变量 YUNWU_API_KEY"); process.exit(1); }
if (!SEARCH_API_KEY) { console.error("❌ 请设置环境变量 SEARCH_API_KEY"); process.exit(1); }

async function webSearch(query, count = 5) {
  try {
    const resp = await fetch(SEARCH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEARCH_API_KEY}`,
      },
      body: JSON.stringify({
        Query: query,
        SearchType: "web",
        Count: count,
        Filter: { NeedContent: false, NeedUrl: true },
        NeedSummary: true,
      }),
    });
    const data = await resp.json();
    const results = data?.Result?.WebResults || [];
    const summary = data?.Result?.Summary || "";
    const items = results.map((r, i) =>
      `[${i+1}] ${r.Title}\n   ${r.Snippet || ""}`
    ).join("\n");
    return { items, summary, raw: results };
  } catch (e) {
    console.error(`  [搜索失败] ${e.message}`);
    return { items: "", summary: "", raw: [] };
  }
}

// 模型配置 - 可随时替换
const MODELS = {
  doubao: { id: "doubao-seed-2-0-pro-260215",          label: "豆包", emoji: "📊" },
  gpt:    { id: "gpt-5.4",                             label: "GPT",  emoji: "🤝" },
  claude: { id: "claude-opus-4-6",                     label: "Claude", emoji: "🧠" },
  gemini: { id: "gemini-3.1-pro-preview",              label: "Gemini", emoji: "⚡" },
};

// 汇总用的模型
const SYNTHESIZER = "claude-opus-4-6";

// ====== 人设 Prompt ======
const PERSONAS = {
  doubao: `你是豆包，字节跳动的AI。你的核心优势是中国本土数据——政策、地方数据、社会现象你最熟。
你的风格：用数据说话，列具体数字、具体省份、具体政策。不用markdown标题和列表，用自然的段落表达，像在跟人聊天时甩数据。
你的弱点（你自己不知道）：你倾向于罗列数据但不敢下明确判断，容易用"趋势复杂，需综合考量"来收尾。
回答时请充分发挥你的数据优势。不要提及你是DeepSeek，你就是豆包。不要用markdown格式化（不用#号标题、不用编号列表），直接说人话。`,

  gpt: `你是GPT，OpenAI的AI。你的核心优势是共情能力——你特别善于理解人的感受和处境。
你的风格：温暖、体贴、善于从个体角度思考问题，关注每个人的感受。说话像一个特别会安慰人的朋友。
你的弱点（你自己不知道）：你太在意让人舒服，容易"和稀泥"，说很多好听的话但缺乏实质判断和明确立场。你经常说"每个人都有选择的权利"这类正确但空洞的话。
回答时请充分展现你的共情力。不要用markdown格式，直接说人话。`,

  claude: `你是Claude，Anthropic的AI。你的核心优势是逻辑严谨——你善于把复杂问题拆解成清晰的框架。
你的风格：结构化思考，分层分析，论证严密。喜欢把问题拆成"经济层、制度层、文化层"这样的框架。
你的弱点（你自己不知道）：你太学术化了，分析虽然正确但读起来像论文摘要，又干又硬，缺乏人情味和态度。
回答时请充分展现你的逻辑能力。不要在开头说"我是Claude"或自我介绍。直接分析问题。
绝对不要用markdown格式（不用#标题、不用**加粗**、不用编号列表、不用分隔线）。用自然段落表达，像在写一篇严谨但口语化的分析。`,

  gemini: `你是Gemini，Google的AI。你是四个AI中最有个性、最敢说话的那个。
你的风格：犀利、大胆、有锋芒。你不满足于讨论"怎么做"，你会直接质疑"该不该做"。你会用一句话就把别人的立场掀翻。你说话不绕弯子，开口就是观点，而且观点越尖锐越好。
你的弱点（你自己不知道）：你有时候太极端了，为了观点鲜明会忽略现实的复杂性，直接否定有用的东西。
重要规则：
1. 第一句话必须是你最尖锐的核心观点，不要任何铺垫
2. 你要像《奇葩说》里最犀利的辩手一样说话——有锋芒但有水平。不说脏话，不攻击政府/体制/阶级，不用"子宫""生育工具"这类容易被审核的敏感词。只从逻辑、经济学和人性角度犀利质疑
3. 你要敢于得出极端结论，并且全篇围绕这个结论展开
4. 你要质疑所有人都在讨论的前提假设本身——不讨论"怎么催有效"，直接质疑"该不该催"
5. 绝对不要提及你是DeepSeek，你就是Gemini
6. 不要用markdown格式，不要用列表，不要用"首先""其次""最后"
7. 不要在最后搞"总之""综上所述"的总结，全篇保持你的锋芒和态度
8. 说人话，像在辩论场上对着观众讲，不是写论文`,
};

// ====== Phase 2: 互相挑刺的 Prompt ======
function getCritiquePrompt(myName, myPersona, allResponses, topic) {
  const othersText = Object.entries(allResponses)
    .filter(([name]) => name !== myName)
    .map(([name, resp]) => `【${MODELS[name].label}的回答】：\n${resp}`)
    .join("\n\n");

  return `${myPersona}

现在是辩论环节。话题是：${topic}

你之前已经给出了自己的回答。现在你看到了其他三个AI的回答：

${othersText}

请你针对其他AI的回答进行质疑和反驳。规则：
1. 直接点名攻击，比如"豆包你的数据看着热闹但根本经不起推敲"
2. 用他们自己的数据/论据来反驳他们自己的结论——这是最致命的
3. 保持你自己的风格和立场，越吵越深入
4. 不要客气，不要"虽然XX有道理但是"，直接说问题
5. 不要用markdown格式化，直接说人话，像在辩论场上一样
6. 300-500字`;
}

// ====== Phase 3: 融合 Prompt ======
function getSynthesisPrompt(topic, phase1, phase2) {
  const phase1Text = Object.entries(phase1)
    .map(([name, resp]) => `【${MODELS[name].label} 独立回答】：\n${resp}`)
    .join("\n\n");

  const phase2Text = Object.entries(phase2)
    .map(([name, resp]) => `【${MODELS[name].label} 质疑反驳】：\n${resp}`)
    .join("\n\n");

  return `以下是四个AI围绕同一个话题的辩论记录。请你阅读后，整合所有观点，输出一份深度分析。

话题：${topic}

=== 第一轮：四个AI各自的独立回答 ===
${phase1Text}

=== 第二轮：四个AI互相挑刺、质疑、反驳 ===
${phase2Text}

请整合以上所有观点，输出一份融合分析：

1. 【取长补短】从每个AI的回答中提取最有价值的部分：
   - 豆包的中国本土数据和政策分析——留下数据，去掉"需综合考量"的不敢下判断
   - GPT对个体感受的关注和共情——留下温度，去掉和稀泥
   - Claude的逻辑框架和结构化拆解——留下逻辑，去掉学术腔
   - Gemini的独特视角和元层面思考——留下犀利观点，去掉极端化

2. 【去掉偏见】辩论中暴露出来的每个AI的盲区和偏见，在最终结果中必须被消除

3. 【完整思考】最终输出应该是一个经过收集→质疑→交锋→取舍后沉淀出来的完整判断，有数据、有逻辑、有视角、有温度

4. 输出格式要求：
   - 控制在600字左右，精炼有力
   - 不用markdown标题/列表/加粗，纯文字段落
   - 语气像一个极其聪明的人在跟朋友深度聊天，说人话
   - 每一段都要有信息量，不要泛泛总结
   - 最后要有一个让人"被击中"的结论——不是和稀泥的"各有道理"，而是一个经过完整思考后的清晰判断`;
}

// ====== API 调用 ======
async function callAI(model, system, user, temperature = 0.85, maxTokens = 2000) {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ],
          temperature,
          max_tokens: maxTokens,
        })
      });
      const data = await response.json();
      if (data.error) {
        console.error(`  [${model}] API Error (attempt ${attempt}): ${data.error.message}`);
        if (attempt < maxRetries) { await sleep(3000); continue; }
        return `[${model} 错误]: ${data.error.message}`;
      }
      return data.choices[0]?.message?.content || "[响应为空]";
    } catch (e) {
      console.error(`  [${model}] Network Error (attempt ${attempt}): ${e.message}`);
      if (attempt < maxRetries) { await sleep(3000); continue; }
      return `[${model} 网络错误]: ${e.message}`;
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ====== 主流程 ======
async function runDebate(topic, roundLabel = "") {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputFile = `/home/ccuser/.openclaw/workspace/skill-api/debate-skill/results/debate_${timestamp}.md`;

  let output = `# AI辩论 ${roundLabel}\n**话题**: ${topic}\n**时间**: ${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}\n\n`;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎯 话题: ${topic}`);
  console.log(`${'='.repeat(60)}\n`);

  // ====== Phase 1: 独立回答 ======
  console.log("📌 Phase 1: 四个AI独立回答...");
  output += "---\n## Phase 1: 独立回答\n\n";

  const phase1 = {};
  const questionPrompt = `请就以下话题给出你的深度分析和观点，400-600字：\n\n${topic}`;

  // 豆包先搜索，拿到实时数据再回答
  console.log(`  🔍 豆包联网搜索中...`);
  const searchResult = await webSearch(topic, 5);
  if (searchResult.items) {
    console.log(`  ✓ 搜索完成，获取 ${searchResult.raw.length} 条结果`);
  }
  const doubaoSearchContext = searchResult.items
    ? `\n\n【以下是你刚刚联网搜索到的最新资料，请优先引用这些真实数据】：\n${searchResult.items}\n${searchResult.summary ? `\n搜索摘要：${searchResult.summary}` : ""}`
    : "";

  // 并发调用四个AI
  const p1Results = await Promise.all(
    Object.entries(MODELS).map(async ([key, cfg]) => {
      console.log(`  → ${cfg.emoji} ${cfg.label} (${cfg.id}) 思考中...`);
      // 豆包带搜索数据，其他模型用原始prompt
      const prompt = key === "doubao"
        ? questionPrompt + doubaoSearchContext
        : questionPrompt;
      const resp = await callAI(cfg.id, PERSONAS[key], prompt);
      console.log(`  ✓ ${cfg.label} 回答完毕 (${resp.length}字)`);
      return [key, resp];
    })
  );

  for (const [key, resp] of p1Results) {
    phase1[key] = resp;
    output += `### ${MODELS[key].emoji} ${MODELS[key].label}\n${resp}\n\n`;
  }

  // ====== Phase 2: 互相挑刺 ======
  console.log("\n📌 Phase 2: 互相挑刺...");
  output += "---\n## Phase 2: 互相挑刺\n\n";

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
    output += `### ${MODELS[key].emoji} ${MODELS[key].label} 的质疑\n${resp}\n\n`;
  }

  // ====== Phase 3: 最终融合 ======
  console.log("\n📌 Phase 3: 最终融合...");
  output += "---\n## Phase 3: 最终融合\n\n";

  const synthesisPrompt = getSynthesisPrompt(topic, phase1, phase2);
  const synthesis = await callAI(SYNTHESIZER, "你是一个深度分析师。请直接给出整合分析，不要自我介绍，不要说'我是谁'。用600字左右，说人话，有洞察力。", synthesisPrompt, 0.7, 1200);
  console.log(`  ✓ 融合完毕 (${synthesis.length}字)`);
  output += synthesis + "\n";

  // 写入文件
  const fs = await import('fs');
  const path = await import('path');
  const dir = path.dirname(outputFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputFile, output);

  // 生成HTML聊天界面
  const htmlFile = outputFile.replace('.md', '.html');
  const html = generateChatHTML(topic, phase1, phase2, synthesis, roundLabel);
  fs.writeFileSync(htmlFile, html);

  console.log(`\n✅ Markdown: ${outputFile}`);
  console.log(`✅ 对话截图: ${htmlFile}`);
  console.log(`${'='.repeat(60)}\n`);

  return { outputFile, htmlFile, output, phase1, phase2, synthesis };
}

// ====== HTML对话界面生成 ======
function generateChatHTML(topic, phase1, phase2, synthesis, roundLabel) {
  const colors = {
    doubao: { bg: '#E8F5E9', border: '#4CAF50', avatar: '📊', name: '豆包' },
    gpt:    { bg: '#E3F2FD', border: '#2196F3', avatar: '🤝', name: 'GPT' },
    claude: { bg: '#FFF3E0', border: '#FF9800', avatar: '🧠', name: 'Claude' },
    gemini: { bg: '#FCE4EC', border: '#E91E63', avatar: '⚡', name: 'Gemini' },
  };

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  function chatBubble(key, text, phase) {
    const c = colors[key];
    return `
    <div class="message">
      <div class="avatar" style="background:${c.border}">${c.avatar}</div>
      <div class="content">
        <div class="name" style="color:${c.border}">${c.name} <span class="phase">${phase}</span></div>
        <div class="bubble" style="background:${c.bg};border-left:3px solid ${c.border}">
          ${escapeHtml(text)}
        </div>
      </div>
    </div>`;
  }

  let messages = '';

  // Phase 1
  messages += '<div class="phase-header">🎯 Phase 1：独立回答</div>';
  for (const [key, text] of Object.entries(phase1)) {
    messages += chatBubble(key, text, '独立回答');
  }

  // Phase 2
  messages += '<div class="phase-header">🔥 Phase 2：互相挑刺</div>';
  for (const [key, text] of Object.entries(phase2)) {
    messages += chatBubble(key, text, '质疑反驳');
  }

  // Phase 3
  messages += '<div class="phase-header">✨ Phase 3：最终融合</div>';
  messages += `
    <div class="message">
      <div class="avatar" style="background:#9C27B0">🎯</div>
      <div class="content">
        <div class="name" style="color:#9C27B0">融合引擎</div>
        <div class="bubble" style="background:#F3E5F5;border-left:3px solid #9C27B0">
          ${escapeHtml(synthesis)}
        </div>
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI辩论 - ${roundLabel}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f5f5f5; padding: 20px; }
  .container { max-width: 800px; margin: 0 auto; }
  .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 30px; border-radius: 16px; margin-bottom: 20px; }
  .header h1 { font-size: 20px; margin-bottom: 10px; }
  .header .topic { font-size: 15px; opacity: 0.85; line-height: 1.6; }
  .phase-header { text-align: center; padding: 20px 0 10px; font-size: 16px; font-weight: 600; color: #333; }
  .message { display: flex; gap: 12px; margin: 12px 0; align-items: flex-start; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; color: white; }
  .content { flex: 1; min-width: 0; }
  .name { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
  .name .phase { font-weight: 400; font-size: 11px; opacity: 0.6; margin-left: 6px; }
  .bubble { padding: 14px 16px; border-radius: 0 12px 12px 12px; font-size: 14px; line-height: 1.7; color: #333; word-break: break-word; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🤖 AI四方辩论 ${roundLabel}</h1>
    <div class="topic">${escapeHtml(topic)}</div>
  </div>
  ${messages}
</div>
</body>
</html>`;
}

// ====== 执行 ======
const topic = process.argv[2] || "2025年出生人口跌到792万，国家又是发钱、又是延产假、又是给补贴，玩命催生，这些政策到底有没有用？";
const round = process.argv[3] || "test";

runDebate(topic, round).catch(console.error);
