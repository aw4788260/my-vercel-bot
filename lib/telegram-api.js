import axios from 'axios';

const TOKEN = process.env.TELEGRAM_TOKEN;
const TG_API_URL = `https://api.telegram.org/bot${TOKEN}`;

async function apiRequest(method, params) {
  try {
    const response = await axios.post(`${TG_API_URL}/${method}`, params);
    return response.data.result;
  } catch (error) {
    console.error(`Error in Telegram API request [${method}]:`, error.response?.data || error.message);
    return null;
  }
}

export async function sendMessage(chatId, text, keyboard = null, parseMode = '') {
  const params = { chat_id: chatId, text };
  if (keyboard) params.reply_markup = keyboard;
  if (parseMode) params.parse_mode = parseMode;
  return apiRequest('sendMessage', params);
}

export async function editMessageText(chatId, messageId, text, keyboard = null, parseMode = '') {
  const params = { chat_id: chatId, message_id: messageId, text };
  if (keyboard) params.reply_markup = keyboard;
  if (parseMode) params.parse_mode = parseMode;
  return apiRequest('editMessageText', params);
}

export async function answerCallbackQuery(callbackQueryId, text = null, showAlert = false) {
    const params = { callback_query_id: callbackQueryId };
    if (text) params.text = text;
    if (showAlert) params.show_alert = showAlert;
    return apiRequest('answerCallbackQuery', params);
}

export async function sendPoll(chatId, question, options, type, correctOptionIndex, openPeriod) {
    const params = {
        chat_id: chatId,
        question: question,
        options: options,
        type: type,
        is_anonymous: false
    };
    if (type === 'quiz') {
        params.correct_option_id = correctOptionIndex;
        if (openPeriod > 0) {
            params.open_period = openPeriod;
        }
    }
    return apiRequest('sendPoll', params);
}

export async function stopPoll(chatId, messageId) {
    const params = {
        chat_id: chatId,
        message_id: messageId,
    };
    return apiRequest('stopPoll', params);
}

export async function deleteMessage(chatId, messageId) {
    const params = {
        chat_id: chatId,
        message_id: messageId,
    };
    return apiRequest('deleteMessage', params);
}
