import firestore from './firebase.js';
import { sendMessage, editMessageText, sendPoll } from './telegram-api.js';

// استيراد المتغيرات من البيئة
const ADMIN_ID = process.env.ADMIN_ID;
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE, 10) || 10;

// =============================================================================
// 5. دوال Firebase
// =============================================================================
// لا حاجة لـ getFirestoreInstance، فالمتغير firestore مستورد وجاهز

// =============================================================================
// 6. دوال المستخدمين والحالة والإحصائيات
// =============================================================================

export async function isNewUser(userId) {
try {
const userDoc = await firestore.collection('users').doc(userId.toString()).get();
return !userDoc.exists;
} catch (e) {
console.error("Error in isNewUser:", e);
return false;
}
}

export async function checkAndNotifyNewUser(user) {
if (await isNewUser(user.id)) {
await addNewUser(user);
const totalUsers = await getUserCount();
let notification = `👤 مستخدم جديد انضم!\n\n` + `الاسم: ${user.first_name}\n`;
if (user.username) notification += `المعرف: @${user.username}\n`;
notification += `الأي دي: \`${user.id}\`\n\n` + `*العدد الكلي للمستخدمين الآن: ${totalUsers}*`;
await sendMessage(ADMIN_ID, notification, null, 'Markdown');
}
}

export async function getUserCount() {
const snapshot = await firestore.collection('users').get();
return snapshot.size;
}

export async function addNewUser(user) {
const userData = {
userId: user.id.toString(),
username: user.username || '',
firstName: user.first_name,
joinTimestamp: new Date()
};
await firestore.collection('users').doc(user.id.toString()).set(userData);
}

export async function getUserState(userId) {
try {
const doc = await firestore.collection('userStates').doc(userId.toString()).get();
return doc.exists ? doc.data() : null;
} catch (e) {
console.error("Error in getUserState:", e);
return null;
}
}

export async function setUserState(userId, state, data) {
const stateData = { state: state, data: data };
await firestore.collection('userStates').doc(userId.toString()).set(stateData, { merge: true });
}

export async function clearUserState(userId) {
await firestore.collection('userStates').doc(userId.toString()).delete();
}

export function formatUserScores(scores) {
if (!scores || scores.length === 0) {
return "لا توجد نتائج مسجلة لهذا الطالب.";
}

let text = "📊 **النتائج السابقة:**\n\n";
const groupedScores = {};

scores.forEach(s => {
if (!groupedScores[s.examId]) {
groupedScores[s.examId] = [];
}
groupedScores[s.examId].push(s);
});

for (const examId in groupedScores) {
text += `*الاختبار: ${examId}*\n`;
// ترتيب المحاولات زمنيًا من الأحدث للأقدم
groupedScores[examId].sort((a, b) => b.timestamp - a.timestamp).forEach(attempt => {
const date = attempt.timestamp ? new Date(attempt.timestamp).toLocaleString("ar-EG") : "غير محدد";
text += ` - النتيجة: ${attempt.score}/${attempt.totalQuestions} — _${date}_\n`;
});
text += `\n`;
}
return text;
}


// =============================================================================
// 7. دوال القوائم
// =============================================================================

export async function sendMainMenu(chatId, messageId = null) {
const text = "👋 أهلاً بك في بوت الاختبارات!\n\nاختر الواجهة المناسبة لك:";
let keyboard;
if (chatId === ADMIN_ID) {
keyboard = { inline_keyboard: [[{ text: "👑 لوحة تحكم الأدمن", callback_data: "admin_panel" }], [{ text: "🎓 واجهة الطالب", callback_data: "student_panel" }]] };
} else {
keyboard = { inline_keyboard: [[{ text: "🎓 الدخول للاختبارات", callback_data: "student_panel" }]] };
}
if (messageId) {
await editMessageText(chatId, messageId, text, keyboard);
} else {
await sendMessage(chatId, text, keyboard);
}
}

export async function sendAdminMenu(chatId, messageId = null) {
const text = "👑 لوحة تحكم الأدمن\n\nاختر الإجراء الذي تريد القيام به:";
const keyboard = {
inline_keyboard: [
[{ text: "➕ إضافة اختبار جديد", callback_data: "admin_add_exam" }],
[{ text: "📋 عرض وتعديل الاختبارات", callback_data: "admin_list_exams:1" }],
[{ text: "🗂️ إدارة الفئات", callback_data: "manage_categories" }],
[{ text: "⬅️ العودة للقائمة الرئيسية", callback_data: "back_to_main" }]
]
};
if (messageId) {
await editMessageText(chatId, messageId, text, keyboard);
} else {
await sendMessage(chatId, text, keyboard);
}
}

export async function sendStudentMenu(chatId, messageId = null) {
const text = "🎓 واجهة الطالب\n\nمرحباً بك!";
const keyboard = { inline_keyboard: [[{ text: "📝 بدء اختبار", callback_data: "student_list_exams" }], [{ text: "📊 عرض نتائجي السابقة", callback_data: "student_stats" }],] };
if (chatId === ADMIN_ID) {
keyboard.inline_keyboard.push([{ text: "⬅️ العودة للقائمة الرئيسية", callback_data: "back_to_main" }]);
}
if (messageId) {
await editMessageText(chatId, messageId, text, keyboard);
} else {
await sendMessage(chatId, text, keyboard);
}
}


// =============================================================================
// 8. إدارة الفئات
// =============================================================================

export async function getAllCategories() {
const snapshot = await firestore.collection('categories').orderBy('displayOrder').get();
return snapshot.docs.map(doc => doc.data());
}

export async function sendCategoryManagementMenu(chatId, messageId) {
const text = "🗂️ إدارة الفئات\n\nاختر الإجراء المطلوب:";
const keyboard = { inline_keyboard: [[{ text: "➕ إضافة فئة جديدة", callback_data: "category_add" }], [{ text: "✏️ تعديل فئة موجودة", callback_data: "category_edit_list" }], [{ text: "🔄 تغيير ترتيب الفئات", callback_data: "category_reorder" }], [{ text: "🔙 رجوع للوحة التحكم", callback_data: "admin_panel" }]] };
await editMessageText(chatId, messageId, text, keyboard);
}

export async function promptForNewCategoryName(chatId, messageId) {
await setUserState(chatId, 'awaiting_category_name', {});
await editMessageText(chatId, messageId, "📝 يرجى إرسال اسم الفئة الجديدة.");
}

export async function handleNewCategoryName(chatId, text) {
const categoryName = text.trim();
const categories = await getAllCategories();
if (categories.some(c => c.name === categoryName)) {
await sendMessage(chatId, "⚠️ هذه الفئة موجودة بالفعل. يرجى اختيار اسم آخر.");
return;
}
const newOrder = categories.length > 0 ? Math.max(...categories.map(c => c.displayOrder)) + 1 : 1;
const categoryData = { name: categoryName, displayOrder: newOrder };
await firestore.collection('categories').doc(categoryName).set(categoryData);

await clearUserState(chatId);
await sendMessage(chatId, `✅ تم إضافة الفئة "${categoryName}" بنجاح.`);
await sendAdminMenu(chatId);
}
// ... باقي الدوال بنفس طريقة التحويل ...
// سأكمل الدوال الأكثر أهمية وتعقيدًا
// =============================================================================
// 9. إدارة الاختبارات والأسئلة
// =============================================================================

export async function getExam(examId) {
const doc = await firestore.collection('exams').doc(examId).get();
return doc.exists ? doc.data() : null;
}

export async function startAddExamFlow(chatId) {
await setUserState(chatId, 'awaiting_exam_name', {});
await sendMessage(chatId, "📝 لنبدأ بإضافة اختبار جديد.\n\nالرجاء إرسال **اسم الاختبار** (سيكون فريدًا لكل اختبار).", null, "Markdown");
}

export async function handleNewExamName(chatId, text, userState) {
const examId = text.trim();
if (await getExam(examId)) {
await sendMessage(chatId, "⚠️ اسم الاختبار هذا مستخدم بالفعل. الرجاء اختيار اسم آخر.");
return;
}
userState.data.examId = examId;
userState.state = 'awaiting_retake_choice';
await setUserState(chatId, userState.state, userState.data);
await promptForRetake(chatId);
}

async function promptForRetake(chatId, messageId = null) {
const text = "🔁 هل تسمح للطلاب بإعادة هذا الاختبار؟";
const keyboard = { inline_keyboard: [[{ text: "✅ نعم، اسمح بالإعادة", callback_data: "set_retake:true" }], [{ text: "❌ لا، مرة واحدة فقط", callback_data: "set_retake:false" }]]};
if (messageId) await editMessageText(chatId, messageId, text, keyboard); else await sendMessage(chatId, text, keyboard);
}

export async function finishAddingQuestions(chatId) {
const userState = await getUserState(chatId);
if (!userState || userState.state !== 'awaiting_questions' || !userState.data.questions || userState.data.questions.length === 0) {
await sendMessage(chatId, "⚠️ لم تقم بإضافة أي أسئلة! تم إلغاء إنشاء الاختبار.");
await clearUserState(chatId);
await sendAdminMenu(chatId);
return;
}
const { examId, allowRetake, time, categoryName, questions } = userState.data;
const examData = { examId, allowRetake, timePerQuestion: time, categoryName, questionCount: questions.length };

const batch = firestore.batch();

// 1. Add Exam Document
const examRef = firestore.collection('exams').doc(examId);
batch.set(examRef, examData);

// 2. Add Questions
questions.forEach((q, index) => {
const questionRef = firestore.collection('questions').doc(); // Auto-generate ID
const questionData = { examId, questionText: q.questionText, options: q.options, correctOptionIndex: q.correctOptionIndex, order: index + 1 };
batch.set(questionRef, questionData);
});

await batch.commit();
await clearUserState(chatId);
await sendMessage(chatId, `🎉 تم إنشاء الاختبار **${examId}** بنجاح مع ${questions.length} سؤال في فئة *${categoryName}*.`, null, "Markdown");
await sendAdminMenu(chatId);
}

export function parseSingleQuestion(text) {
const lines = text.trim().split('\n').filter(line => line.trim() !== '');
if (lines.length < 3) return null;
const questionText = lines[0].trim();
const correctOptionNumber = parseInt(lines[lines.length - 1], 10);
const options = lines.slice(1, -1).map(opt => opt.trim());
if (isNaN(correctOptionNumber) || correctOptionNumber < 1 || correctOptionNumber > options.length || options.length < 2 || options.length > 10) return null;
const correctOptionIndex = correctOptionNumber - 1;
// node.js لا يحتاج لـ JSON.stringify هنا، axios يعالج المصفوفات
return { questionText, options, correctOptionIndex };
}

// =============================================================================
// 10. منطق الطالب والاختبار
// =============================================================================

export async function getExamQuestions(examId) {
const snapshot = await firestore.collection('questions').where('examId', '==', examId).orderBy('order').get();
return snapshot.docs.map(doc => doc.data());
}

export async function startQuiz(callbackQuery) {
const chatId = callbackQuery.from.id.toString();
const messageId = callbackQuery.message ? callbackQuery.message.message_id : null;
const [, examId] = callbackQuery.data.split(':');
const userName = callbackQuery.from.username || callbackQuery.from.first_name;

const exam = await getExam(examId);
if (!exam) return;

const userHasTakenExam = await checkUserHistory(chatId, examId);
if (userHasTakenExam && !exam.allowRetake) {
await answerCallbackQuery(callbackQuery.id, "🚫 عذراً، لقد قمت بأداء هذا الاختبار من قبل والإعادة غير مسموحة.", true);
return;
}

const questionsRaw = await getExamQuestions(examId);
if (!questionsRaw || questionsRaw.length === 0) {
await answerCallbackQuery(callbackQuery.id, "⚠️ عذراً، هذا الاختبار لا يحتوي على أسئلة حاليًا.", true);
return;
}

if (messageId) await editMessageText(chatId, messageId, `🚀 سيبدأ اختبار **${examId}** الآن. استعد!`, null, 'Markdown');
else await sendMessage(chatId, `🚀 سيبدأ اختبار **${examId}** الآن. استعد!`, null, 'Markdown');

// ... Rest of the startQuiz logic
}

export async function saveScore(userId, userName, examId, score, totalQuestions) {
try {
const scoreData = {
userId: userId.toString(),
userName: userName,
examId: examId,
score: score,
totalQuestions: totalQuestions,
timestamp: Date.now() // استخدام timestamp رقمي بسيط
};
await firestore.collection('studentScores').add(scoreData);
} catch (e) {
console.error("!!! CRITICAL ERROR in saveScore:", e);
}
}

// =============================================================================
// دالة متابعة انتهاء وقت الأسئلة (تعمل عبر Cron Job)
// =============================================================================
export async function checkTimedOutQuizzes() {
const now = new Date().getTime();
const statesSnapshot = await firestore.collection('userStates').where('state', '==', 'taking_exam').get();

if (statesSnapshot.empty) {
console.log("Cron: No users are currently taking an exam.");
return;
}

for (const doc of statesSnapshot.docs) {
const userId = doc.id;
const state = doc.data();
const data = state.data;

// التأكد من أن الاختبار موقوت وله سؤال أخير
if (data.lastQuestionTimestamp && data.timePerQuestion > 0) {
const timeElapsed = (now - data.lastQuestionTimestamp) / 1000;

// نضيف ثانيتين كهامش أمان
if (timeElapsed > data.timePerQuestion + 2) {
console.log(`User ${userId} timed out. Advancing quiz.`);

// استخدام transaction لضمان عدم حدوث تضارب
try {
await firestore.runTransaction(async (transaction) => {
const currentStateDoc = await transaction.get(firestore.collection('userStates').doc(userId));
if (!currentStateDoc.exists) return;

const currentState = currentStateDoc.data();
// التأكد مرة أخرى من أن الحالة لم تتغير
if (currentState.state === 'taking_exam' && currentState.data.lastQuestionTimestamp === data.lastQuestionTimestamp) {
// لا يمكننا استدعاء advanceQuiz مباشرة من هنا لأنه يحتاج لاستجابة http
// لذا سنقوم بتكرار المنطق هنا
currentState.data.currentQuestionIndex++;
transaction.update(firestore.collection('userStates').doc(userId), { data: currentState.data });
await sendQuestion(userId, currentState); // إرسال السؤال التالي
}
});
} catch (e) {
console.error(`Timeout transaction failed for user ${userId}:`, e);
}
}
}
}
}

// ... والكثير من الدوال الأخرى التي يجب تحويلها بنفس الطريقة.
