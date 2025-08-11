import * as logic from './logic.js';
import { answerCallbackQuery } from './telegram-api.js';
import firestore from './firebase.js';

const ADMIN_ID = process.env.ADMIN_ID;
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE, 10) || 10;

/**
* يعالج الرسائل النصية والأوامر.
* @param {object} message - كائن الرسالة من تيليجرام.
*/
export async function handleMessage(message) {
const chatId = message.chat.id.toString();
const text = message.text;
const user = message.from;
const userState = await logic.getUserState(chatId);

if (text === "/start") {
await logic.checkAndNotifyNewUser(user);
await logic.clearUserState(chatId);
await logic.sendMainMenu(chatId);
return;
}

if (text === "/usercount" && chatId === ADMIN_ID) {
const count = await logic.getUserCount();
await logic.sendMessage(ADMIN_ID, `📊 العدد الكلي للمستخدمين هو: *${count}*`, null, "Markdown");
return;
}

if (text.startsWith("/getresults") && chatId === ADMIN_ID) {
const parts = text.split(' ');
if (parts.length < 2 || !parts[1]) {
await logic.sendMessage(ADMIN_ID, "⚠️ صيغة خاطئة. يرجى استخدام:\n`/getresults USER_ID`", null, "Markdown");
return;
}
const studentId = parts[1].trim();
const studentScores = await logic.getScoresForUser(studentId);
const replyText = logic.formatUserScores(studentScores);
await logic.sendMessage(ADMIN_ID, replyText, null, "Markdown");
return;
}

if (userState) {
// توجيه الرسالة بناءً على حالة المستخدم الحالية
if (userState.state === 'awaiting_category_name') { await logic.handleNewCategoryName(chatId, text); return; }
if (userState.state === 'awaiting_category_rename') { await logic.handleCategoryRename(chatId, text, userState); return; }
if (userState.state === 'awaiting_category_order') { await logic.handleCategoryReorder(chatId, text); return; }
if (userState.state === 'awaiting_questions') { await logic.addBulkQuestionsFromText(chatId, text, userState); }
else if (userState.state === 'awaiting_exam_name') { await logic.handleNewExamName(chatId, text, userState); }
else if (userState.state === 'awaiting_time_per_question') { await logic.handleNewExamTime(chatId, text, userState); }
else if (userState.state === 'editing_exam_name') { await logic.handleEditExamName(chatId, text, userState); }
else if (userState.state === 'editing_exam_time_value') { await logic.handleEditExamTime(chatId, text, userState); }
else if (userState.state === 'awaiting_replacement_question') { await logic.handleReplaceQuestion(chatId, text, userState); }
else if (userState.state === 'awaiting_next_question') { await logic.handleAddNewQuestion(chatId, text, userState); }
}
}

/**
* يعالج الضغط على الأزرار (Callback Queries).
* @param {object} callbackQuery - كائن الرد من تيليجرام.
*/
export async function handleCallbackQuery(callbackQuery) {
const chatId = callbackQuery.from.id.toString();
const messageId = callbackQuery.message.message_id;
const data = callbackQuery.data;
const [action, param1, param2] = data.split(':');

// الرد الفوري على تيليجرام لإخفاء علامة التحميل من الزر
await answerCallbackQuery(callbackQuery.id);

// توجيه الطلب بناءً على بيانات الزر
switch (action) {
case 'manage_categories': await logic.sendCategoryManagementMenu(chatId, messageId); break;
case 'category_add': await logic.promptForNewCategoryName(chatId, messageId); break;
case 'category_edit_list': await logic.listCategoriesForEditing(chatId, messageId); break;
case 'category_edit': await logic.sendSingleCategoryEditMenu(chatId, param1, messageId); break;
case 'category_rename': await logic.promptForCategoryRename(chatId, param1, messageId); break;
case 'category_delete_confirm': await logic.confirmCategoryDelete(chatId, param1, messageId); break;
case 'category_delete_execute': await logic.handleCategoryDelete(chatId, param1, messageId); break;
case 'category_reorder': await logic.promptForCategoryReorder(chatId, messageId); break;
case 'category_select_new': await logic.handleCategorySelectionForNewExam(chatId, param1, messageId); break;
case 'category_select_existing': await logic.handleCategorySelectionForExistingExam(chatId, param1, param2, messageId); break;
case 'finish_exam': await logic.handleFinishExam(callbackQuery); break;
case 'next_batch': await logic.handleNextBatch(callbackQuery); break;
case 'change_exam_category': await logic.promptToChangeExamCategory(chatId, param1, messageId); break;
case 'admin_panel':
case 'back_to_admin_panel': await logic.sendAdminMenu(chatId, messageId); break;
case 'student_panel': await logic.sendStudentMenu(chatId, messageId); break;
case 'back_to_main': await logic.sendMainMenu(chatId, messageId); break;
case 'admin_add_exam': await logic.startAddExamFlow(chatId); break;
case 'set_retake': await logic.handleSetRetake(chatId, param1, messageId); break;
case 'set_time': await logic.handleSetTime(chatId, param1, messageId); break;
case 'finish_adding_questions': await logic.finishAddingQuestions(chatId); break;
case 'admin_list_exams': await logic.listExamsForAdmin(chatId, messageId, parseInt(param1 || '1')); break;
case 'admin_exam_details': await logic.showExamDetails(chatId, param1, messageId); break;
case 'admin_exam_stats': await logic.showExamStats(chatId, param1, messageId); break;
case 'admin_edit_exam': await logic.sendEditExamMenu(chatId, param1, messageId); break;
case 'edit_exam_name': await logic.promptForNewExamName(chatId, param1, messageId); break;
case 'edit_exam_retake': await logic.handleEditExamRetake(callbackQuery); break;
case 'edit_exam_time': await logic.promptForNewExamTime(chatId, param1, messageId); break;
case 'set_new_time': await logic.handleSetNewExamTime(chatId, param1, param2, messageId); break;
case 'list_questions_edit': await logic.listQuestionsForEditing(chatId, param1, messageId); break;
case 'q_replace': await logic.promptForReplacementQuestion(chatId, param1, param2, messageId); break;
case 'q_add_next': await logic.promptForNextQuestion(chatId, param1, messageId); break;
case 'q_delete': await logic.deleteQuestion(chatId, param1, param2, messageId); break;
case 'admin_delete_exam': await logic.confirmDeleteExam(chatId, param1, messageId); break;
case 'admin_delete_exam_confirm': await logic.deleteExam(chatId, param1, messageId); break;
case 'student_list_exams': await logic.listExamsForStudent(chatId, messageId); break;
case 'list_exams_in_category': await logic.listExamsInCategory(chatId, param1, messageId, parseInt(param2 || '1')); break;
case 'show_exam_confirm': await logic.showExamConfirmation(chatId, param1, messageId); break;
case 'confirm_start_exam': await logic.startQuiz(callbackQuery); break;
case 'student_stats': await logic.showStudentStats(chatId, messageId); break;
case 'show_ranking': await logic.showStudentRanking(chatId, param1, callbackQuery.from.id, messageId); break;
case 'noop': return; // لا تفعل شيئًا
default: console.log(`Unknown callback action: ${action}`);
}
}

/**
* يعالج إجابات الطلاب على الاستطلاعات (الأسئلة).
* يستخدم Firestore Transactions كبديل آمن لـ LockService.
* @param {object} pollAnswer - كائن إجابة الاستطلاع من تيليجرام.
*/
export async function handlePollAnswer(pollAnswer) {
const pollId = pollAnswer.poll_id;
const userId = pollAnswer.user.id.toString();

// استخدام transaction لضمان تحديث البيانات بشكل آمن ومتزامن
try {
await firestore.runTransaction(async (transaction) => {
const userStateRef = firestore.collection('userStates').doc(userId);
const userStateDoc = await transaction.get(userStateRef);

if (!userStateDoc.exists) return;
let userState = userStateDoc.data();

if (!userState || userState.state !== 'taking_exam') return;

// الاختبارات غير الموقوتة
if (userState.data.timePerQuestion === 0) {
let data = userState.data;
const qIndex = data.pollMap[pollId];

if (qIndex !== undefined) {
const selected = Array.isArray(pollAnswer.option_ids) ? pollAnswer.option_ids[0] : undefined;
data.answers = data.answers || {};
data.answers[qIndex] = selected;
// تحديث الحالة داخل الـ transaction
transaction.update(userStateRef, { data: data });
}
}
// الاختبارات الموقوتة (يتم التعامل معها عبر cron job)
// لكن سنضيف منطق التسجيل هنا أيضًا
else {
const pollDocRef = firestore.collection('botData').doc(pollId);
const pollDoc = await transaction.get(pollDocRef);

if (!pollDoc.exists || pollDoc.data().userId !== userId) return;

const correctIndex = pollDoc.data().correctOptionIndex;
const selectedOptionIndex = Array.isArray(pollAnswer.option_ids) ? pollAnswer.option_ids[0] : undefined;

if (selectedOptionIndex !== undefined && selectedOptionIndex == correctIndex) {
userState.data.score = (userState.data.score || 0) + 1;
}

// نحدث حالة المستخدم ونحذف الاستطلاع
transaction.update(userStateRef, { data: userState.data });
transaction.delete(pollDocRef);

// استدعاء الدالة لتقديم السؤال التالي
// ملاحظة: هذا سيحدث خارج الـ transaction، لكن تحديث الحالة تم بالفعل
await logic.advanceQuiz(userId, userState);
}
});
} catch (e) {
console.error('Poll Answer Transaction failure:', e);
}
}
