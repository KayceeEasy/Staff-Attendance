import dotenv from 'dotenv';
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID);
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

if (!BOT_TOKEN || !ALLOWED_CHAT_ID) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env');
  process.exit(1);
}

/**
 * Call Telegram Bot API
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
 * Process single incoming message/callback update from Telegram
 */
async function handleUpdate(update) {
  // Handle text messages
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
    console.log(`[Telegram] Received command: "${text}" from Chat ID: ${chatId}`);

    if (text === '/start' || text === '/help') {
      await sendNotification(
        `🤖 *Antigravity Telegram Control Online*\n\nAvailable Commands:\n• \`/status\` - Check system & agent status\n• \`/ping\` - Test latency\n• \`/help\` - View this menu`
      );
    } else if (text === '/status') {
      const uptimeSec = Math.floor(process.uptime());
      await sendNotification(
        `📊 *System Status*\n\n• *Bridge Status:* Online 🟢\n• *Uptime:* ${uptimeSec}s\n• *PC Node Version:* ${process.version}\n• *Time:* ${new Date().toLocaleString()}`
      );
    } else if (text === '/ping') {
      await sendNotification(`🏓 *Pong!* Telegram remote bridge is active and connected to your PC.`);
    } else {
      await sendNotification(`Received: "${text}"\nType \`/help\` for available commands.`);
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

    // Acknowledge button click
    await callApi('answerCallbackQuery', {
      callback_query_id: query.id,
      text: `Processed: ${action.toUpperCase()}`,
    });

    // Update message text
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
  console.log('🚀 Starting Telegram Bot Long-Polling...');
  let offset = 0;

  // Authenticate with Telegram API (retry loop for server stability)
  let me = null;
  while (!me || !me.ok) {
    me = await callApi('getMe');
    if (me && me.ok) {
      console.log(`✅ Connected to Bot: @${me.result.username}`);
      await sendNotification(
        `🔔 *Antigravity Telegram Control Initialized*\n\nConnected to @${me.result.username}.\nYou will receive agent notifications and approval requests right here!`
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
