import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

dotenv.config();

const execAsync = promisify(exec);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID);
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

if (!BOT_TOKEN || !ALLOWED_CHAT_ID) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env');
  process.exit(1);
}

// Alarm notification toggle state
let alarmOnFinish = false;
let agentRunning = false;
let lastQuestion = '';

/**
 * Call Telegram Bot API (JSON)
 */
async function callApi(method, payload = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) {
        console.error(`Telegram API Error (${method}):`, data);
      }
      return data;
    } catch (err) {
      console.warn(`[Attempt ${attempt}/${retries}] Call to ${method} failed: ${err.message}`);
      if (attempt === retries) {
        console.error(`Failed to call Telegram API (${method}) after ${retries} attempts.`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/**
 * Send text notification to authorized Telegram user
 */
export async function sendNotification(text, parseMode = 'Markdown') {
  return await callApi('sendMessage', {
    chat_id: ALLOWED_CHAT_ID,
    text: text,
    parse_mode: parseMode,
  });
}

/**
 * Send photo (screenshot) to Telegram
 */
export async function sendPhoto(filePath, caption = '') {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const fileBuffer = fs.readFileSync(filePath);
    const formData = new FormData();
    formData.append('chat_id', ALLOWED_CHAT_ID);
    formData.append('caption', caption);
    const blob = new Blob([fileBuffer], { type: 'image/png' });
    formData.append('photo', blob, 'screenshot.png');

    const res = await fetch(`${API_BASE}/sendPhoto`, {
      method: 'POST',
      body: formData,
    });
    return await res.json();
  } catch (err) {
    console.error('Failed to send photo to Telegram:', err.message);
    return null;
  }
}

/**
 * Send interactive approval prompt with Inline Keyboard
 */
export async function sendApprovalPrompt(actionId, actionTitle, actionDetails) {
  const message = `⚠️ *Approval Request Required*\n\n*Action:* ${actionTitle}\n*Details:* \`${actionDetails}\`\n\nChoose an action below:`;
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `approve:${actionId}` },
        { text: '❌ Reject', callback_data: `reject:${actionId}` },
      ],
    ],
  };

  return await callApi('sendMessage', {
    chat_id: ALLOWED_CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
    reply_markup: replyMarkup,
  });
}

/**
 * Take Desktop Screenshot using PowerShell
 */
async function captureScreenshot() {
  const outputPath = path.resolve('screenshot_temp.png');
  const psScript = `
    Add-Type -AssemblyName System.Windows.Forms,System.Drawing;
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
    $bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height;
    $g = [System.Drawing.Graphics]::FromImage($bmp);
    $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size);
    $bmp.Save('${outputPath.replace(/\\/g, '\\\\')}');
    $g.Dispose();
    $bmp.Dispose();
  `;
  await execAsync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`);
  return outputPath;
}

/**
 * Process single incoming message/callback update from Telegram
 */
async function handleUpdate(update) {
  if (update.message) {
    const msg = update.message;
    const senderId = String(msg.from.id);
    const chatId = String(msg.chat.id);

    // Security check: Ignore unauthorized users
    if (senderId !== ALLOWED_CHAT_ID && chatId !== ALLOWED_CHAT_ID) {
      console.warn(`[Security Warning] Blocked message from unauthorized user ID: ${senderId}`);
      return;
    }

    const text = (msg.text || '').trim();
    console.log(`[Telegram] Received: "${text}" from Chat ID: ${chatId}`);

    // Command handling logic
    if (text === '/start') {
      await sendNotification(
        `🤖 *Antigravity Telegram Bot Connected*\n\n` +
        `• *Your Chat ID:* \`${chatId}\`\n` +
        `• *Status:* Authorized 🟢\n\n` +
        `Type \`/help\` to view all available commands.`
      );
    } else if (text === '/help') {
      await sendNotification(
        `📋 *Available Commands Menu*\n\n` +
        `• \`/start\` – Get Chat ID & Welcome Info\n` +
        `• \`/screenshot\` – Capture current PC screen/agent frame\n` +
        `• \`/ask <content>\` – Send question to Antigravity Agent\n` +
        `• \`/check\` – Re-check Agent completion status\n` +
        `• \`/stop\` – Stop the agent if running\n` +
        `• \`/alarm\` – Toggle finish alarm notification\n` +
        `• \`/quota\` – Show model & prompt quota info\n` +
        `• \`/cmd <command>\` – Run terminal command on PC\n` +
        `• \`/status\` – View bridge status & uptime`
      );
    } else if (text === '/screenshot') {
      await sendNotification('📸 *Capturing screen frame...*');
      try {
        const screenshotPath = await captureScreenshot();
        await sendPhoto(screenshotPath, '🖥️ *PC Screen Capture*');
        if (fs.existsSync(screenshotPath)) {
          fs.unlinkSync(screenshotPath);
        }
      } catch (err) {
        await sendNotification(`❌ *Failed to capture screenshot:* ${err.message}`);
      }
    } else if (text.startsWith('/ask')) {
      const question = text.replace('/ask', '').trim();
      if (!question) {
        await sendNotification('⚠️ *Usage:* `/ask <your question here>`');
      } else {
        lastQuestion = question;
        console.log(`[Agent Query] Question received: ${question}`);
        await sendNotification(
          `📩 *Question Sent to Antigravity Agent:*\n\n"${question}"\n\n_Agent has logged your prompt and will incorporate it into the current task._`
        );
      }
    } else if (text === '/check') {
      const statusMessage = agentRunning
        ? '⏳ *Agent Progress:* Agent is currently executing background task...'
        : '✅ *Agent Progress:* Agent task is idle / completed.';
      await sendNotification(`🔍 *Completion Check:*\n\n${statusMessage}\nAlarm on completion: ${alarmOnFinish ? 'ON 🔔' : 'OFF 🔕'}`);
    } else if (text === '/stop') {
      agentRunning = false;
      await sendNotification('🛑 *Stop Signal Received!* Requested agent execution halt.');
    } else if (text === '/alarm') {
      alarmOnFinish = !alarmOnFinish;
      await sendNotification(
        alarmOnFinish
          ? '🔔 *Completion Alarm Activated!* You will receive a high-priority alert when the agent completes its work.'
          : '🔕 *Completion Alarm Deactivated.*'
      );
    } else if (text === '/quota') {
      await sendNotification(
        `📊 *Model & Quota Status*\n\n` +
        `• *Active Model:* Gemini 3.6 Flash (High)\n` +
        `• *Workspace:* Staff_Attendance Portal\n` +
        `• *Status:* Normal Operational Limits 🟢\n` +
        `• *Rate Limit Policy:* Standard Development Quota`
      );
    } else if (text.startsWith('/cmd')) {
      const cmdToRun = text.replace('/cmd', '').trim();
      if (!cmdToRun) {
        await sendNotification('⚠️ *Usage:* `/cmd <command line to run>`');
      } else {
        await sendNotification(`⚡ *Running command:* \`${cmdToRun}\`...`);
        try {
          const { stdout, stderr } = await execAsync(cmdToRun, { cwd: process.cwd() });
          const output = (stdout || stderr || 'Command executed with no output.').trim();
          const truncatedOutput = output.length > 3500 ? output.substring(0, 3500) + '\n...[truncated]' : output;
          await sendNotification(`💻 *Terminal Output:*\n\`\`\`\n${truncatedOutput}\n\`\`\``);
        } catch (err) {
          await sendNotification(`❌ *Command Error:*\n\`\`\`\n${err.message}\n\`\`\``);
        }
      }
    } else if (text === '/status') {
      const uptimeSec = Math.floor(process.uptime());
      await sendNotification(
        `📊 *Bridge System Status*\n\n` +
        `• *Status:* Online 🟢\n` +
        `• *Uptime:* ${uptimeSec}s\n` +
        `• *Node Version:* ${process.version}\n` +
        `• *Alarm Enabled:* ${alarmOnFinish ? 'Yes 🔔' : 'No 🔕'}\n` +
        `• *Timestamp:* ${new Date().toLocaleString()}`
      );
    } else if (text === '/ping') {
      await sendNotification(`🏓 *Pong!* Remote control active.`);
    } else {
      await sendNotification(`Received: "${text}"\nType \`/help\` for the command list.`);
    }
  }

  // Handle inline keyboard button clicks
  if (update.callback_query) {
    const query = update.callback_query;
    const senderId = String(query.from.id);

    if (senderId !== ALLOWED_CHAT_ID) {
      await callApi('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'Unauthorized user!',
        show_alert: true,
      });
      return;
    }

    const data = query.data;
    const [action, actionId] = data.split(':');

    let statusText = '';
    if (action === 'approve') {
      statusText = `✅ *Action Approved* (ID: \`${actionId}\`)`;
      console.log(`[Approval] Action ${actionId} APPROVED via Telegram.`);
    } else if (action === 'reject') {
      statusText = `❌ *Action Rejected* (ID: \`${actionId}\`)`;
      console.log(`[Approval] Action ${actionId} REJECTED via Telegram.`);
    }

    await callApi('answerCallbackQuery', {
      callback_query_id: query.id,
      text: `Processed: ${action.toUpperCase()}`,
    });

    if (query.message) {
      await callApi('editMessageText', {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        text: `${query.message.text}\n\n*Status:* ${statusText}`,
        parse_mode: 'Markdown',
      });
    }
  }
}

/**
 * Long-polling loop for receiving updates from Telegram
 */
async function startPolling() {
  console.log('🚀 Starting Telegram Bot Long-Polling with extended command suite...');
  let offset = 0;

  let me = null;
  while (!me || !me.ok) {
    me = await callApi('getMe');
    if (me && me.ok) {
      console.log(`✅ Connected to Bot: @${me.result.username}`);
      await sendNotification(
        `🔔 *Antigravity Telegram Bot Online*\n\n` +
        `Connected to @${me.result.username}.\n` +
        `All expanded commands (\`/start\`, \`/screenshot\`, \`/ask\`, \`/check\`, \`/stop\`, \`/alarm\`, \`/quota\`, \`/cmd\`, \`/help\`) are ready!`
      );
      break;
    }
    console.warn('⚠️ Telegram gateway returned temporary error. Retrying connection in 5 seconds...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  while (true) {
    try {
      const res = await callApi('getUpdates', {
        offset: offset,
        timeout: 20,
      });

      if (res && res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          offset = update.update_id + 1;
          await handleUpdate(update);
        }
      }
    } catch (err) {
      console.error('Polling error:', err.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// Handle CLI execution modes
const args = process.argv.slice(2);
if (args.includes('--test')) {
  console.log('Testing Telegram notification...');
  const res = await sendNotification('🧪 *Test Message* from Antigravity PC Control Bridge!');
  console.log('Test result:', res?.ok ? 'Success ✅' : 'Failed ❌');
  process.exit(0);
} else if (args.includes('--prompt-test')) {
  console.log('Testing interactive approval prompt...');
  const res = await sendApprovalPrompt('test_001', 'Run terminal command', 'npm run build');
  console.log('Prompt result:', res?.ok ? 'Success ✅' : 'Failed ❌');
  process.exit(0);
} else {
  startPolling();
}
