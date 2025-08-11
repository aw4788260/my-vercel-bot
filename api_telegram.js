import { handleMessage, handleCallbackQuery, handlePollAnswer } from '../lib/handlers.js';
import { sendMessage } from '../lib/telegram-api.js';

export default async function handler(request, response) {
try {
const contents = request.body;

if (contents.callback_query) {
await handleCallbackQuery(contents.callback_query);
} else if (contents.message) {
await handleMessage(contents.message);
} else if (contents.poll_answer) {
await handlePollAnswer(contents.poll_answer);
}
} catch (error) {
console.error(error.toString());
// إرسال رسالة خطأ للأدمن
await sendMessage(process.env.ADMIN_ID, "🚨 حدث خطأ في البوت:\n" + error.toString());
} finally {
// إرسال استجابة 200 OK فورًا لإعلام تيليجرام باستلام الطلب بنجاح
response.status(200).send("OK");
}
}