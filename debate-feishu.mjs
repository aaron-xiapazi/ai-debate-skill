#!/usr/bin/env node
/**
 * AI辩论 - 奇葩说模式 v5
 * 站队 → 对吵 → 裁判判决
 */

import { execSync } from 'child_process';

const API_KEY = process.env.YUNWU_API_KEY || "";
const API_URL = process.env.YUNWU_API_URL || "https://yunwu.ai/v1/chat/completions";

const FEISHU_CHAT_ID = process.env.FEISHU_CHAT_ID || "";
const LARK_CLI = process.env.LARK_CLI || "lark-cli";

if (!API_KEY) { console.error("❌ 请设置环境变量 YUNWU_API_KEY"); process.exit(1); }
const ENV_BASE = { ...process.env, PATH: process.env.PATH + ':/home/ccuser/.npm-global/bin' };

// 正方 vs 反方
const TEAMS = {
  for: [
    { id: "doubao-seed-2-0-pro-260215", name: "豆包", emoji: "📊", color: "green" },
    { id: "gpt-5.4",                    name: "GPT",  emoji: "🤝", color: "blue" },
  ],
  against: [
    { id: "claude-opus-4-6",            name: "Claude", emoji: "🧠", color: "orange" },
    { id: "gemini-3.1-pro-preview",     name: "Gemini", emoji: "⚡", color: "red" },
  ],
};

const ALL_MODELS = [...TEAMS.for, ...TEAMS.against];

// ====== 清洗AI输出中的markdown残留 ======
function clean(text) {
  return text
    .replace(/^#{1,6}\s*/gm, '')          // ### 标题
    .replace(/\*\*([^*]*)\*\*/g, '$1')    // **加粗**
    .replace(/\*([^*]*)\*/g, '$1')        // *斜体*
    .replace(/~~([^~]*)~~/g, '$1')        // ~~删除线~~
    .replace(/^[-=]{3,}$/gm, '')          // --- 或 === 分隔线
    .replace(/^\s*[-*+]\s+/gm, '')        // - 列表项
    .replace(/^\s*\d+\.\s+/gm, '')        // 1. 编号列表
    .replace(/^>\s*/gm, '')               // > 引用
    .replace(/`([^`]*)`/g, '$1')          // `代码`
    .replace(/\n{3,}/g, '\n\n')           // 多余空行
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
    console.error(`  [飞书失败] ${title}`);
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

// ====== API ======
async function callAI(model, messages, maxTokens = 4096) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
        body: JSON.stringify({ model, messages, temperature: 0.85, max_tokens: maxTokens, stream: false })
      });
      const data = await resp.json();
      if (data.error) {
        console.error(`  [${model}] Error(${attempt}): ${data.error.message}`);
        if (attempt < 3) { await sleep(3000); continue; }
        return `[错误]`;
      }
      return data.choices[0]?.message?.content || "[空]";
    } catch (e) {
      if (attempt < 3) { await sleep(3000); continue; }
      return `[网络错误]`;
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ====== 主流程 ======
async function runDebate(topic, forSide, againstSide, rounds = 3) {
  console.log(`\n🎯 ${topic}\n正方（${forSide}）vs 反方（${againstSide}）\n${rounds}轮\n`);

  const histories = {};
  ALL_MODELS.forEach(m => { histories[m.name] = []; });

  // ====== 开场 ======
  sendCard(
    `🎯 ${topic}`,
    `正方（${forSide}）：${TEAMS.for.map(m => m.emoji + m.name).join(' ')}\n反方（${againstSide}）：${TEAMS.against.map(m => m.emoji + m.name).join(' ')}\n\n共${rounds}轮，开吵！`,
    "purple"
  );
  await sleep(1200);

  // ====== 第一轮：亮立场 ======
  sendText("── 第1轮：亮立场 ──");
  console.log("📌 第1轮：亮立场");

  // 正方
  const r1Results = {};
  const r1Promises = [
    ...TEAMS.for.map(async m => {
      const msg = `辩题：${topic}\n\n你是正方，你的立场是：${forSide}。\n\n请亮出你的核心论点和论据来支持这个立场。说人话，不用markdown格式，不用标题符号，不用加粗，不用列表编号。`;
      histories[m.name].push({ role: "user", content: msg });
      console.log(`  → ${m.emoji} ${m.name}(正)...`);
      const resp = await callAI(m.id, histories[m.name]);
      histories[m.name].push({ role: "assistant", content: resp });
      r1Results[m.name] = resp;
      console.log(`  ✓ ${m.name} (${resp.length}字)`);
      return { model: m, resp, side: "正方" };
    }),
    ...TEAMS.against.map(async m => {
      const msg = `辩题：${topic}\n\n你是反方，你的立场是：${againstSide}。\n\n请亮出你的核心论点和论据来支持这个立场。说人话，不用markdown格式，不用标题符号，不用加粗，不用列表编号。`;
      histories[m.name].push({ role: "user", content: msg });
      console.log(`  → ${m.emoji} ${m.name}(反)...`);
      const resp = await callAI(m.id, histories[m.name]);
      histories[m.name].push({ role: "assistant", content: resp });
      r1Results[m.name] = resp;
      console.log(`  ✓ ${m.name} (${resp.length}字)`);
      return { model: m, resp, side: "反方" };
    }),
  ];

  const r1All = await Promise.all(r1Promises);

  // 按正方→反方顺序发到飞书
  for (const { model: m, resp, side } of r1All) {
    sendCard(`${m.emoji} ${m.name}【${side}】`, resp, m.color);
    await sleep(600);
  }

  // ====== 对吵轮 ======
  for (let round = 2; round <= rounds; round++) {
    await sleep(1500);
    sendText(`── 第${round}轮${round === rounds ? "（最后一轮）" : ""} ──`);
    console.log(`\n📌 第${round}轮`);

    const roundPromises = ALL_MODELS.map(async m => {
      const isFor = TEAMS.for.includes(m);
      const opponents = isFor ? TEAMS.against : TEAMS.for;
      const teammates = (isFor ? TEAMS.for : TEAMS.against).filter(t => t !== m);
      const mySide = isFor ? forSide : againstSide;

      // 对方全部历史发言
      const opponentText = opponents
        .map(o => {
          const allMsgs = histories[o.name]
            .filter(msg => msg.role === 'assistant')
            .map((msg, idx) => `第${idx + 1}轮：${msg.content}`)
            .join('\n\n');
          return `${o.name}（${isFor ? "反方" : "正方"}）的完整发言：\n${allMsgs}`;
        })
        .join('\n\n────\n\n');

      const prompt = `你的立场是：${mySide}\n\n以下是对方到目前为止的所有发言：\n\n${opponentText}\n\n骂回去。对方说的哪里有问题？逻辑哪里不通？数据哪里站不住？前后矛盾的地方在哪？直接拆穿，别客气，别给面子。你就是觉得对方在胡说八道，用事实和逻辑证明他错了。说人话，不用markdown格式，不用标题符号，不用加粗，不用列表编号。`;

      console.log(`  → ${m.emoji} ${m.name}...`);
      histories[m.name].push({ role: "user", content: prompt });
      const resp = await callAI(m.id, histories[m.name]);
      histories[m.name].push({ role: "assistant", content: resp });
      console.log(`  ✓ ${m.name} (${resp.length}字)`);
      return { model: m, resp, side: isFor ? "正方" : "反方" };
    });

    const roundResults = await Promise.all(roundPromises);

    for (const { model: m, resp, side } of roundResults) {
      sendCard(`${m.emoji} ${m.name}【${side}】`, resp, m.color);
      await sleep(600);
    }
  }

  // ====== 最终结论 ======
  await sleep(1500);
  sendText("── 最终结论 ──");
  console.log("\n📌 最终结论");

  const fullRecord = ALL_MODELS.map(m => {
    const isFor = TEAMS.for.includes(m);
    const msgs = histories[m.name]
      .filter(msg => msg.role === "assistant")
      .map(msg => msg.content)
      .join("\n\n");
    return `【${m.name}（${isFor ? "正方" : "反方"}）的完整发言】\n${msgs}`;
  }).join("\n\n======\n\n");

  const verdict = await callAI("claude-opus-4-6", [
    { role: "user", content: `问题：${topic}

四个AI刚刚围绕这个问题激烈辩论了${rounds}轮。以下是完整记录：

${fullRecord}

现在，你要基于这场辩论的全部内容，给出这个问题的最终深度结论。

关键要求：
1. 你不是在评价谁说得好谁说得差。你是在回答这个问题本身。
2. 你要带入各个模型的真实贡献——比如"豆包给出的攀枝花数据表明..."、"Gemini提出了一个关键质疑..."。让读者感受到这个结论是从多方碰撞中提炼出来的，不是一个人能想到的。
3. 你要把问题打透。不是浅尝辄止地说"有用但有限"，而是深入到一个让人恍然大悟的程度——那个Aha Moment，那个"原来如此"的瞬间。
4. 第一句话就是你的核心结论，一句话说清楚这个问题的答案。
5. 后面展开时，要一层一层往深处挖，每一层都比上一层更接近本质。

格式：不用markdown，不用标题符号，不用加粗，不用列表。纯文字段落。说人话。` }
  ], 1500);

  console.log(`  ✓ 最终结论 (${verdict.length}字)`);
  sendCard("🎯 最终结论", verdict, "purple");

  console.log("\n✅ 完成！");
}

// ====== 执行 ======
const topic = process.argv[2] || "催生政策到底有没有用？";
const forSide = process.argv[3] || "有用，关键是怎么催";
const againstSide = process.argv[4] || "没用，根本方向就错了";
const rounds = parseInt(process.argv[5]) || 3;

runDebate(topic, forSide, againstSide, rounds).catch(console.error);
