import * as logic from './logic.js';
import { answerCallbackQuery } from './telegram-api.js';

const ADMIN_ID = process.env.ADMIN_ID;

/**
 * Handles incoming text messages and commands.
 */
export async function handleMessage(message) {
    if (!message.text) return;
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
        switch(userState.state) {
            case 'awaiting_category_name': await logic.handleNewCategoryName(chatId, text); break;
            case 'awaiting_category_rename': await logic.handleCategoryRename(chatId, text, userState); break;
            case 'awaiting_category_order': await logic.handleCategoryReorder(chatId, text); break;
            case 'awaiting_questions': await logic.addBulkQuestionsFromText(chatId, text, userState); break;
            case 'awaiting_exam_name': await logic.handleNewExamName(chatId, text, userState); break;
            case 'awaiting_time_per_question': await logic.handleNewExamTime(chatId, text, userState); break;
            case 'editing_exam_time_value': await logic.handleEditExamTime(chatId, text, userState); break;
            case 'awaiting_replacement_question': await logic.handleReplaceQuestion(chatId, text, userState); break;
            case 'awaiting_next_question': await logic.handleAddNewQuestion(chatId, text, userState); break;
        }
    }
}

/**
 * Handles button clicks (Callback Queries).
 */
export async function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.from.id.toString();
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    const [action, param1, param2] = data.split(':');
    
    await answerCallbackQuery(callbackQuery.id);

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
        case 'edit_exam_retake': await logic.handleEditExamRetake(callbackQuery); break;
        case 'edit_exam_time': await logic.promptForNewExamTime(chatId, param1, messageId); break;
        case 'set_new_time': await logic.handleSetNewExamTime(chatId, param1, param2, messageId); break;
        case 'list_questions_edit': await logic.listQuestionsForEditing(chatId, param1, messageId); break;
        case 'q_replace': await logic.promptForReplacementQuestion(chatId, param1, param2, messageId); break;
        case 'q_add_next': await logic.promptForNextQuestion(chatId, param1); break;
        case 'q_delete': await logic.deleteQuestion(chatId, param1, param2, messageId); break;
        case 'admin_delete_exam': await logic.confirmDeleteExam(chatId, param1, messageId); break;
        case 'admin_delete_exam_confirm': await logic.deleteExam(chatId, param1, messageId); break;
        case 'student_list_exams': await logic.listExamsForStudent(chatId, messageId); break;
        case 'list_exams_in_category': await logic.listExamsInCategory(chatId, param1, messageId, parseInt(param2 || '1')); break;
        case 'show_exam_confirm': await logic.showExamConfirmation(chatId, param1, messageId); break;
        case 'confirm_start_exam': await logic.startQuiz(callbackQuery); break;
        case 'student_stats': await logic.showStudentStats(chatId, messageId); break;
        case 'show_ranking': await logic.showStudentRanking(chatId, param1, callbackQuery.from.id, messageId); break;
        case 'noop': return; // No operation
        default: console.log(`Unknown callback action: ${action}`);
    }
}

/**
 * Handles poll answers from students.
 */
export async function handlePollAnswer(pollAnswer) {
    await logic.handlePollAnswer(pollAnswer);
}
