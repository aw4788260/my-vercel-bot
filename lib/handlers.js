import * as logic from './logic.js';
import { answerCallbackQuery, sendMessage } from './telegram-api.js';

const PRIMARY_ADMIN_ID = "6659806372";

/**
 * Handles incoming text messages and commands.
 */
export async function handleMessage(message) {
    if (!message.text) return;
    const chatId = message.chat.id.toString();
    const text = message.text;
    const user = message.from;

    // Admin Management Commands (Primary Admin Only)
    if (text.startsWith("/addadmin") && chatId === PRIMARY_ADMIN_ID) {
        const parts = text.split(' ');
        if (parts.length < 2 || !/^\d+$/.test(parts[1])) {
            return await sendMessage(chatId, "⚠️ صيغة خاطئة. استخدم: `/addadmin USER_ID`");
        }
        await logic.addAdmin(parts[1]);
        return await sendMessage(chatId, `✅ تم إضافة ${parts[1]} كمشرف جديد.`);
    }
    if (text.startsWith("/deladmin") && chatId === PRIMARY_ADMIN_ID) {
        const parts = text.split(' ');
        if (parts.length < 2 || !/^\d+$/.test(parts[1])) {
            return await sendMessage(chatId, "⚠️ صيغة خاطئة. استخدم: `/deladmin USER_ID`");
        }
        await logic.deleteAdmin(parts[1]);
        return await sendMessage(chatId, `✅ تم حذف المشرف ${parts[1]}.`);
    }

    const isUserAdmin = await logic.isAdmin(chatId);
    const userState = await logic.getUserState(chatId);

    if (text === "/start") {
        await logic.checkAndNotifyNewUser(user);
        await logic.clearUserState(chatId);
        await logic.sendMainMenu(chatId);
        return;
    }

    // Admin-only text commands
    if (isUserAdmin) {
        if (text === "/usercount") {
            const count = await logic.getUserCount();
            return await sendMessage(chatId, `📊 العدد الكلي للمستخدمين هو: *${count}*`, null, "Markdown");
        }
        if (text.startsWith("/getresults")) {
            const parts = text.split(' ');
            if (parts.length < 2 || !parts[1]) {
                return await sendMessage(chatId, "⚠️ صيغة خاطئة. يرجى استخدام:\n`/getresults USER_ID`", null, "Markdown");
            }
            const studentId = parts[1].trim();
            const studentScores = await logic.getScoresForUser(studentId);
            const replyText = logic.formatUserScores(studentScores);
            return await sendMessage(chatId, replyText, null, "Markdown");
        }
    }

    // State-based handlers for admins
    if (userState && isUserAdmin) {
        switch(userState.state) {
            case 'awaiting_toplevel_category_name':
            case 'awaiting_subcategory_name': await logic.handleNewCategory(chatId, text, userState); break;
            case 'awaiting_category_rename': await logic.handleCategoryRename(chatId, text, userState); break;
            case 'awaiting_category_order': await logic.handleCategoryReorder(chatId, text); break;
            case 'awaiting_questions': await logic.addBulkQuestionsFromText(chatId, text, userState); break;
            case 'awaiting_exam_name': await logic.handleNewExamName(chatId, text); break;
            case 'editing_exam_time_value': await logic.handleEditExamTime(chatId, text, userState); break;
            case 'awaiting_replacement_question': await logic.handleReplaceQuestion(chatId, text, userState); break;
            case 'awaiting_next_question': await logic.handleAddNewQuestion(chatId, text, userState); break;
            case 'awaiting_question_after': await logic.handleAddNewQuestionAfter(chatId, text, userState); break;
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
    const [action, param1, param2, param3, param4] = data.split(':');
    
    await answerCallbackQuery(callbackQuery.id);
    const isUserAdmin = await logic.isAdmin(chatId);

    // Admin-only actions
    if (isUserAdmin) {
        switch (action) {
            case 'manage_categories': await logic.sendCategoryManagementMenu(chatId, messageId); return;
            case 'category_add_toplevel': await logic.promptForNewCategoryName(chatId, messageId, false); return;
            case 'category_add_subcategory': await logic.promptForParentCategory(chatId, messageId); return;
            case 'category_select_parent': await logic.promptForNewCategoryName(chatId, messageId, true, param1); return;
            case 'category_edit_list': await logic.listCategoriesForEditing(chatId, messageId, null); return;
            case 'admin_browse_categories': await logic.listCategoriesForEditing(chatId, messageId, param1); return;
            case 'category_edit': await logic.sendSingleCategoryEditMenu(chatId, param1, messageId); return;
            case 'category_rename': await logic.promptForCategoryRename(chatId, param1, messageId); return;
            case 'category_delete_confirm': await logic.confirmCategoryDelete(chatId, param1, messageId); return;
            case 'category_delete_execute': await logic.handleCategoryDelete(chatId, param1, messageId); return;
            case 'category_reorder': await logic.promptForCategoryReorder(chatId, messageId); return;
            case 'admin_select_exam_category': await logic.adminBrowseCategoriesForSelection(chatId, messageId, null, param1, param2); return;
            case 'admin_browse_cat_for_select': await logic.adminBrowseCategoriesForSelection(chatId, messageId, param1, param2, param3); return;
            case 'category_select_new': await logic.handleCategorySelectionForNewExam(chatId, param1, messageId); return;
            case 'category_select_existing': await logic.handleCategorySelectionForExistingExam(chatId, param1, param2, messageId); return;
            case 'change_exam_category': await logic.promptToChangeExamCategory(chatId, param1, messageId); return;
            case 'admin_panel': case 'back_to_admin_panel': await logic.sendAdminMenu(chatId, messageId); return;
            case 'admin_add_exam': await logic.startAddExamFlow(chatId, messageId); return;
            case 'finish_adding_questions': await logic.finishAddingQuestions(chatId); return;
            case 'admin_browse_exams': await logic.adminBrowseCategoriesForExams(chatId, messageId, param1 || null); return;
            case 'admin_exam_details': await logic.showExamDetails(chatId, param1, messageId); return;
            case 'admin_exam_stats': await logic.showExamStats(chatId, param1, messageId); return;
            case 'admin_edit_exam': await logic.sendEditExamMenu(chatId, param1, messageId); return;
            case 'edit_exam_retake': await logic.handleEditExamRetake(callbackQuery); return;
            case 'edit_exam_time': await logic.promptForNewExamTime(chatId, param1, messageId); return;
            case 'set_new_time': await logic.handleSetNewExamTime(chatId, param1, param2, messageId); return;
            case 'list_questions_edit': await logic.listQuestionsForEditing(chatId, param1, messageId); return;
            case 'q_replace': await logic.promptForReplacementQuestion(chatId, param1, param2, messageId); return;
            case 'q_add_next': await logic.promptForNextQuestion(chatId, param1); return;
            case 'q_add_after': await logic.promptForQuestionAfter(chatId, param1, param2); return;
            case 'q_delete': await logic.deleteQuestion(chatId, param1, param2, messageId); return;
            case 'admin_delete_exam': await logic.confirmDeleteExam(chatId, param1, messageId); return;
            case 'admin_delete_exam_confirm': await logic.deleteExam(chatId, param1, messageId); return;
        }
    }

    // Public actions for all users
    switch (action) {
        case 'student_panel': await logic.sendStudentMenu(chatId, messageId); break;
        case 'back_to_main': await logic.sendMainMenu(chatId, messageId); break;
        case 'student_browse_categories': await logic.studentBrowseCategories(chatId, messageId, param1 || null); break;
        case 'show_exam_confirm': await logic.showExamConfirmation(chatId, param1, messageId); break;
        case 'confirm_start_exam': await logic.startQuiz(callbackQuery); break;
        case 'student_stats': await logic.showStudentStats(chatId, messageId); break;
        case 'show_ranking': await logic.showStudentRanking(chatId, param1, callbackQuery.from.id, messageId); break;
        case 'noop': return;
        default: console.log(`Unknown or unauthorized callback action from user ${chatId}: ${action}`);
    }
}

/**
 * Handles poll answers from students.
 */
export async function handlePollAnswer(pollAnswer) {
    await logic.handlePollAnswer(pollAnswer);
}
