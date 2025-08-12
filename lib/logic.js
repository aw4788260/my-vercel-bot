import { Firestore, FieldValue } from '@google-cloud/firestore';
import { sendMessage, editMessageText, sendPoll, answerCallbackQuery, stopPoll } from './telegram-api.js';

// Initialize Firestore
const firestore = new Firestore({
  projectId: process.env.GCP_PROJECT_ID,
  credentials: {
    client_email: process.env.GCP_CLIENT_EMAIL,
    private_key: process.env.GCP_PRIVATE_KEY.replace(/@@/g, '\n'),
  },
});

// Environment Variables
const PRIMARY_ADMIN_ID = "6659806372";
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE, 10) || 10;

// =============================================================================
//                             INTERNAL HELPER FUNCTIONS
// =============================================================================

function parseSingleQuestion(line) {
    try {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length < 4) return null;
        const questionText = parts[0];
        const answerNumber = parseInt(parts[parts.length - 1], 10);
        const options = parts.slice(1, -1);
        if (!questionText || options.some(opt => !opt) || isNaN(answerNumber)) return null;
        if (answerNumber < 1 || answerNumber > options.length) return null;
        const correctOptionIndex = answerNumber - 1;
        return { questionText, options, correctOptionIndex };
    } catch (e) {
        console.error("Error parsing line:", line, e);
        return null;
    }
}

function escapeMarkdown(text) {
  if (!text) return "";
  return text.replace(/_/g, "\\_").replace(/\*/g, "\\*").replace(/\[/g, "\\[").replace(/`/g, "\\`");
}

async function promptForCategorySelection(chatId, messageId, mode, examId = '') {
    const categories = await getAllCategories();
    if (categories.length === 0) {
        await sendMessage(chatId, "لا توجد فئات. يجب عليك إضافة فئة أولاً من قائمة 'إدارة الفئات'. تم إلغاء العملية.");
        return await sendAdminMenu(chatId, messageId);
    }
    const text = "🗂️ يرجى اختيار فئة لهذا الاختبار:";
    const callbackPrefix = mode === 'new' ? 'category_select_new' : `category_select_existing:${examId}`;
    const keyboard = { inline_keyboard: categories.map(cat => ([{ text: cat.name, callback_data: `${callbackPrefix}:${cat.name}` }]))};
    if (messageId) {
        await editMessageText(chatId, messageId, text, keyboard);
    } else {
        await sendMessage(chatId, text, keyboard);
    }
}

async function promptForQuestions(chatId, examId, messageId = null) {
  const text = `👍 تم حفظ إعدادات الاختبار: **${examId}**.\n\nالآن قم بإضافة الأسئلة. **أرسل كل سؤال في سطر منفصل**.\n\nاستخدم الصيغة التالية (قيم مفصولة بفاصلة):\n` +
  "`السؤال,الخيار الأول,الخيار الثاني,الخيار الثالث,رقم الإجابة الصحيحة`\n\n" +
  "**مثال:**\n`ما هي عاصمة مصر؟,القاهرة,الجيزة,الإسكندرية,1`\n`كم عدد ألوان قوس قزح؟,5,6,7,8,3`\n\n" +
  "عندما تنتهي، اضغط على الزر أدناه.";
  const keyboard = { inline_keyboard: [[{ text: "✅ تم، إنهاء إضافة الأسئلة", callback_data: "finish_adding_questions" }]] };
  if (messageId) await editMessageText(chatId, messageId, text, keyboard, 'Markdown'); else await sendMessage(chatId, text, keyboard, 'Markdown');
}

// =============================================================================
//                             STATE & USER MANAGEMENT & ADMIN
// =============================================================================
export async function getUserState(userId) {
    const doc = await firestore.collection('userStates').doc(userId.toString()).get();
    return doc.exists ? doc.data() : null;
}
export async function setUserState(userId, state, data = {}) {
    await firestore.collection('userStates').doc(userId.toString()).set({ state, data }, { merge: true });
}
export async function clearUserState(userId) {
    await firestore.collection('userStates').doc(userId.toString()).delete();
}
export async function isNewUser(userId) {
    const userDoc = await firestore.collection('users').doc(userId.toString()).get();
    return !userDoc.exists;
}
export async function addNewUser(user) {
    const userData = { userId: user.id.toString(), username: user.username || '', firstName: user.first_name, joinTimestamp: new Date() };
    await firestore.collection('users').doc(user.id.toString()).set(userData);
}
export async function checkAndNotifyNewUser(user) {
    if (await isNewUser(user.id)) {
        await addNewUser(user);
        const totalUsers = await getUserCount();
        let notification = `👤 مستخدم جديد انضم!\n\n` + `الاسم: ${user.first_name}\n`;
        if (user.username) notification += `المعرف: @${user.username}\n`;
        notification += `الأي دي: \`${user.id}\`\n\n` + `*العدد الكلي للمستخدمين الآن: ${totalUsers}*`;
        if (PRIMARY_ADMIN_ID) await sendMessage(PRIMARY_ADMIN_ID, notification, null, 'Markdown');
    }
}
export async function getUserCount() {
    const snapshot = await firestore.collection('users').get();
    return snapshot.size;
}
export async function isAdmin(userId) {
    if (userId.toString() === PRIMARY_ADMIN_ID) return true;
    const adminDoc = await firestore.collection('botAdmins').doc(userId.toString()).get();
    return adminDoc.exists;
}
export async function addAdmin(targetId) {
    await firestore.collection('botAdmins').doc(targetId.toString()).set({ addedAt: new Date() });
}
export async function deleteAdmin(targetId) {
    await firestore.collection('botAdmins').doc(targetId.toString()).delete();
}

// =============================================================================
//                             MENU FUNCTIONS
// =============================================================================
export async function sendMainMenu(chatId, messageId = null) {
    const text = "👋 أهلاً بك في بوت الاختبارات!\n\nاختر الواجهة المناسبة لك:";
    let keyboard;
    if (await isAdmin(chatId)) {
        keyboard = { inline_keyboard: [[{ text: "👑 لوحة تحكم الأدمن", callback_data: "admin_panel" }], [{ text: "🎓 واجهة الطالب", callback_data: "student_panel" }]] };
    } else {
        keyboard = { inline_keyboard: [[{ text: "🎓 الدخول للاختبارات", callback_data: "student_panel" }]] };
    }
    if (messageId) await editMessageText(chatId, messageId, text, keyboard); else await sendMessage(chatId, text, keyboard);
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
    if (messageId) await editMessageText(chatId, messageId, text, keyboard); else await sendMessage(chatId, text, keyboard);
}
export async function sendStudentMenu(chatId, messageId = null) {
    const text = "🎓 واجهة الطالب\n\nمرحباً بك!";
    const keyboard = { 
        inline_keyboard: [
            [{ text: "📝 بدء اختبار", callback_data: "student_list_exams" }], 
            [{ text: "📊 عرض نتائجي السابقة", callback_data: "student_stats" }],
            [{ text: "🏠 القائمة الرئيسية", callback_data: "back_to_main" }]
        ]
    };
    if (messageId) await editMessageText(chatId, messageId, text, keyboard); else await sendMessage(chatId, text, keyboard);
}

// =============================================================================
//                             CATEGORY MANAGEMENT
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
    await setUserState(chatId, 'awaiting_category_name');
    await editMessageText(chatId, messageId, "📝 يرجى إرسال اسم الفئة الجديدة.");
}
export async function handleNewCategoryName(chatId, text) {
    const categoryName = text.trim();
    if (!categoryName) return;
    const categories = await getAllCategories();
    if (categories.some(c => c.name === categoryName)) {
        return await sendMessage(chatId, "⚠️ هذه الفئة موجودة بالفعل. يرجى اختيار اسم آخر.");
    }
    const newOrder = categories.length > 0 ? Math.max(...categories.map(c => c.displayOrder || 0)) + 1 : 1;
    await firestore.collection('categories').doc(categoryName).set({ name: categoryName, displayOrder: newOrder });
    await clearUserState(chatId);
    await sendMessage(chatId, `✅ تم إضافة الفئة "${categoryName}" بنجاح.`);
    await sendAdminMenu(chatId);
}
export async function listCategoriesForEditing(chatId, messageId) {
    const categories = await getAllCategories();
    if (categories.length === 0) {
        return await editMessageText(chatId, messageId, "لا توجد فئات لعرضها.", { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "manage_categories" }]] });
    }
    const text = "اختر الفئة التي تريد تعديلها أو حذفها:";
    const keyboard = { inline_keyboard: categories.map(cat => ([{ text: cat.name, callback_data: `category_edit:${cat.name}` }]))};
    keyboard.inline_keyboard.push([{ text: "🔙 رجوع", callback_data: "manage_categories" }]);
    await editMessageText(chatId, messageId, text, keyboard);
}
export async function sendSingleCategoryEditMenu(chatId, categoryName, messageId) {
    const text = `ماذا تريد أن تفعل بالفئة: *${categoryName}*؟`;
    const keyboard = { inline_keyboard: [[{ text: "📝 إعادة تسمية", callback_data: `category_rename:${categoryName}` }], [{ text: "🗑️ حذف", callback_data: `category_delete_confirm:${categoryName}` }], [{ text: "🔙 رجوع لقائمة الفئات", callback_data: "category_edit_list" }]] };
    await editMessageText(chatId, messageId, text, keyboard, "Markdown");
}
export async function promptForCategoryRename(chatId, oldName, messageId) {
    await setUserState(chatId, 'awaiting_category_rename', { oldName });
    await editMessageText(chatId, messageId, `أرسل الاسم الجديد للفئة "${oldName}":`);
}
export async function handleCategoryRename(chatId, newName, userState) {
    const { oldName } = userState.data;
    const newNameTrimmed = newName.trim();
    if (!newNameTrimmed || oldName === newNameTrimmed) {
        await clearUserState(chatId);
        return await sendMessage(chatId, "تم إلغاء العملية.");
    }
    const batch = firestore.batch();
    const oldDocRef = firestore.collection('categories').doc(oldName);
    const newDocRef = firestore.collection('categories').doc(newNameTrimmed);
    const examsToUpdateQuery = firestore.collection('exams').where('categoryName', '==', oldName);
    const examsSnapshot = await examsToUpdateQuery.get();
    examsSnapshot.forEach(doc => {
        batch.update(doc.ref, { categoryName: newNameTrimmed });
    });
    const oldDoc = await oldDocRef.get();
    if (oldDoc.exists) {
        batch.set(newDocRef, { ...oldDoc.data(), name: newNameTrimmed });
        batch.delete(oldDocRef);
    }
    await batch.commit();
    await clearUserState(chatId);
    await sendMessage(chatId, `✅ تم تغيير اسم الفئة من "${oldName}" إلى "${newNameTrimmed}" وتم تحديث ${examsSnapshot.size} اختبار.`);
    await sendAdminMenu(chatId);
}
export async function confirmCategoryDelete(chatId, categoryName, messageId) {
    const text = `🚨 *تحذير!* هل أنت متأكد من حذف الفئة "*${categoryName}*؟"`;
    const keyboard = { inline_keyboard: [[{ text: "🗑️ نعم، احذف الفئة", callback_data: `category_delete_execute:${categoryName}` }], [{ text: "❌ تراجع", callback_data: `category_edit:${categoryName}` }]] };
    await editMessageText(chatId, messageId, text, keyboard, "Markdown");
}
export async function handleCategoryDelete(chatId, categoryName, messageId) {
    await firestore.collection('categories').doc(categoryName).delete();
    await editMessageText(chatId, messageId, `✅ تم حذف الفئة "*${categoryName}*" بنجاح.`, { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "manage_categories" }]] }, "Markdown");
}
export async function promptForCategoryReorder(chatId, messageId) {
    const categories = (await getAllCategories()).map(c => c.name).join("\n");
    const text = "🔄 *تغيير ترتيب الفئات*\n\nالترتيب الحالي هو:\n" + categories + "\n\nللتغيير، أرسل قائمة بالأسماء مفصولة بفاصلة (,) بالترتيب الجديد الذي تريده.\n\n*مثال:*\n`فئة ب,فئة أ,فئة ج`";
    await setUserState(chatId, 'awaiting_category_order');
    await editMessageText(chatId, messageId, text, { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "manage_categories" }]] }, "Markdown");
}
export async function handleCategoryReorder(chatId, text) {
    const newOrderNames = text.split(',').map(name => name.trim());
    const batch = firestore.batch();
    newOrderNames.forEach((name, index) => {
        if (name) {
            const docRef = firestore.collection('categories').doc(name);
            batch.update(docRef, { displayOrder: index + 1 });
        }
    });
    await batch.commit();
    await clearUserState(chatId);
    await sendMessage(chatId, "✅ تم تحديث ترتيب الفئات بنجاح.");
    await sendAdminMenu(chatId);
}
export async function getExam(examId) {
    const doc = await firestore.collection('exams').doc(examId).get();
    return doc.exists ? doc.data() : null;
}
export async function getAllExams() {
    const snapshot = await firestore.collection('exams').get();
    return snapshot.docs.map(doc => doc.data());
}
export async function getExamQuestions(examId) {
    const snapshot = await firestore.collection('questions').where('examId', '==', examId).orderBy('order').get();
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}
export async function startAddExamFlow(chatId) {
    await setUserState(chatId, 'awaiting_exam_name');
    await sendMessage(chatId, "📝 لنبدأ بإضافة اختبار جديد.\n\nالرجاء إرسال **اسم الاختبار** (سيكون فريدًا لكل اختبار).", null, "Markdown");
}
export async function handleNewExamName(chatId, text) {
    const examId = text.trim();
    if (!examId) return;
    if (await getExam(examId)) {
        return await sendMessage(chatId, "⚠️ اسم الاختبار هذا مستخدم بالفعل. الرجاء اختيار اسم آخر.");
    }
    const examData = { examId, allowRetake: true, timePerQuestion: 0 };
    await setUserState(chatId, 'selecting_category', examData);
    await promptForCategorySelection(chatId, null, 'new', examId);
}
export async function handleCategorySelectionForNewExam(chatId, categoryName, messageId) {
    const userState = await getUserState(chatId);
    if (!userState || userState.state !== 'selecting_category') return;
    userState.data.categoryName = categoryName;
    await setUserState(chatId, 'awaiting_questions', userState.data);
    await promptForQuestions(chatId, userState.data.examId, messageId);
}
export async function addBulkQuestionsFromText(chatId, text, userState) {
    const lines = text.trim().split('\n');
    let successCount = 0;
    let failCount = 0;
    if (!userState.data.questions) userState.data.questions = [];
    for (const line of lines) {
        if (line.trim() === '') continue;
        const parsedQuestion = parseSingleQuestion(line);
        if (parsedQuestion) {
            userState.data.questions.push(parsedQuestion);
            successCount++;
        } else {
            failCount++;
        }
    }
    await setUserState(chatId, 'awaiting_questions', userState.data);
    let summaryMessage = `تمت معالجة الأسئلة:\n`;
    if (successCount > 0) summaryMessage += `✅ نجح إضافة: ${successCount} سؤال.\n`;
    if (failCount > 0) summaryMessage += `⚠️ فشل إضافة: ${failCount} سؤال (تأكد من الصيغة الصحيحة).\n`;
    summaryMessage += `إجمالي الأسئلة الآن: ${userState.data.questions.length}.\nأرسل المزيد أو اضغط إنهاء.`;
    const keyboard = { inline_keyboard: [[{ text: "✅ تم، إنهاء إضافة الأسئلة", callback_data: "finish_adding_questions" }]] };
    await sendMessage(chatId, summaryMessage, keyboard);
}
export async function finishAddingQuestions(chatId) {
    const userState = await getUserState(chatId);
    if (!userState || userState.state !== 'awaiting_questions' || !userState.data.questions || userState.data.questions.length === 0) {
        await sendMessage(chatId, "⚠️ لم تقم بإضافة أي أسئلة! تم إلغاء إنشاء الاختبار.");
        return await sendAdminMenu(chatId);
    }
    const { examId, allowRetake, timePerQuestion, categoryName, questions } = userState.data;
    const examData = { examId, allowRetake, timePerQuestion, categoryName, questionCount: questions.length };
    const batch = firestore.batch();
    const examRef = firestore.collection('exams').doc(examId);
    batch.set(examRef, examData);
    questions.forEach((q, index) => {
        const questionRef = firestore.collection('questions').doc();
        const questionData = { examId, questionText: q.questionText, options: q.options, correctOptionIndex: q.correctOptionIndex, order: index + 1 };
        batch.set(questionRef, questionData);
    });
    await batch.commit();
    await clearUserState(chatId);
    await sendMessage(chatId, `🎉 تم إنشاء الاختبار **${examId}** بنجاح مع ${questions.length} سؤال في فئة *${categoryName}*.`, null, "Markdown");
    await sendAdminMenu(chatId);
}
export async function listExamsForAdmin(chatId, messageId, page = 1) {
    const allExams = await getAllExams();
    if (allExams.length === 0) {
      return await editMessageText(chatId, messageId, "لا توجد أي اختبارات حاليًا.", { inline_keyboard: [[{ text: "⬅️ رجوع", callback_data: "admin_panel" }]]});
    }
    const totalPages = Math.ceil(allExams.length / PAGE_SIZE);
    const examsToShow = allExams.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const text = "📋 اختر اختبارًا لعرض تفاصيله وتعديله:";
    const keyboard = { inline_keyboard: examsToShow.map(exam => ([{ text: `${exam.examId} (${exam.questionCount} سؤال)`, callback_data: `admin_exam_details:${exam.examId}` }]))};
    const navRow = [];
    if (page > 1) navRow.push({ text: "◀️ السابق", callback_data: `admin_list_exams:${page - 1}` });
    navRow.push({ text: `صفحة ${page}/${totalPages}`, callback_data: "noop" });
    if (page < totalPages) navRow.push({ text: "التالي ▶️", callback_data: `admin_list_exams:${page + 1}` });
    if (navRow.length > 0) keyboard.inline_keyboard.push(navRow);
    keyboard.inline_keyboard.push([{ text: "⬅️ رجوع للقائمة", callback_data: "admin_panel" }]);
    await editMessageText(chatId, messageId, text, keyboard, 'Markdown');
}
export async function showExamDetails(chatId, examId, messageId) {
    const exam = await getExam(examId);
    if (!exam) { return await editMessageText(chatId, messageId, "⚠️ لم يتم العثور على الاختبار."); }
    let text = `*تفاصيل اختبار: ${exam.examId}*\n\n`;
    text += `*الفئة:* ${exam.categoryName || 'غير محدد'}\n`;
    text += `*السماح بالإعادة:* ${exam.allowRetake ? '✅ نعم' : '❌ لا'}\n`;
    text += `*الوقت لكل سؤال:* ${exam.timePerQuestion > 0 ? exam.timePerQuestion + ' ثانية' : '♾️ مفتوح'}\n`;
    text += `*عدد الأسئلة:* ${exam.questionCount || 0}\n`;
    const keyboard = {
        inline_keyboard: [
            [{ text: "📊 عرض الإحصائيات", callback_data: `admin_exam_stats:${examId}` }],
            [{ text: "⚙️ تعديل الإعدادات", callback_data: `admin_edit_exam:${examId}` }],
            [{ text: "✏️ عرض وتعديل الأسئلة", callback_data: `list_questions_edit:${examId}` }],
            [{ text: "🗑️ حذف الاختبار", callback_data: `admin_delete_exam:${examId}` }],
            [{ text: "⬅️ رجوع لقائمة الاختبارات", callback_data: "admin_list_exams:1" }]
        ]
    };
    await editMessageText(chatId, messageId, text, keyboard, 'Markdown');
}
export async function showExamStats(chatId, examId, messageId) {
    const scores = await getScoresForExam(examId);
    if (scores.length === 0) {
        return await editMessageText(chatId, messageId, `📊 لا توجد إحصائيات متاحة لاختبار *${examId}* لأنه لم يقم بأدائه أي طالب بعد.`, { inline_keyboard: [[{ text: "⬅️ رجوع للتفاصيل", callback_data: `admin_exam_details:${examId}` }]]}, 'Markdown');
    }
    const uniqueUserIds = new Set(scores.map(s => s.userId));
    const uniqueParticipants = uniqueUserIds.size;
    const totalScores = scores.reduce((sum, s) => sum + s.score, 0);
    const averageScore = (totalScores / scores.length).toFixed(2);
    const highestScore = Math.max(...scores.map(s => s.score));
    const lowestScore = Math.min(...scores.map(s => s.score));
    const totalQuestions = scores[0].totalQuestions;
    let text = `📊 *إحصائيات اختبار: ${examId}*\n\n`;
    text += `▫️ *عدد الطلاب المشاركين:* ${uniqueParticipants} طالب\n`;
    text += `▫️ *إجمالي عدد المحاولات:* ${scores.length} محاولة\n`;
    text += `▫️ *أعلى درجة:* ${highestScore} / ${totalQuestions}\n`;
    text += `▫️ *أدنى درجة:* ${lowestScore} / ${totalQuestions}\n`;
    text += `▫️ *متوسط الدرجات:* ${averageScore} / ${totalQuestions}\n`;
    const keyboard = { inline_keyboard: [[{ text: "⬅️ رجوع للتفاصيل", callback_data: `admin_exam_details:${examId}` }]] };
    await editMessageText(chatId, messageId, text, keyboard, 'Markdown');
}
export async function sendEditExamMenu(chatId, examId, messageId) {
    const text = `⚙️ تعديل إعدادات اختبار: *${examId}*`;
    const keyboard = {
        inline_keyboard: [
            [{ text: "🗂️ تغيير الفئة", callback_data: `change_exam_category:${examId}` }],
            [{ text: "✅ السماح بالإعادة", callback_data: `edit_exam_retake:${examId}:true` }, { text: "❌ منع الإعادة", callback_data: `edit_exam_retake:${examId}:false` }],
            [{ text: "⏰ تعديل الوقت", callback_data: `edit_exam_time:${examId}` }],
            [{ text: "⬅️ رجوع للتفاصيل", callback_data: `admin_exam_details:${examId}` }]
        ]
    };
    await editMessageText(chatId, messageId, text, keyboard, 'Markdown');
}
export async function promptToChangeExamCategory(chatId, examId, messageId) {
    await promptForCategorySelection(chatId, messageId, 'existing', examId);
}
export async function handleCategorySelectionForExistingExam(chatId, examId, categoryName, messageId) {
    if (!categoryName) { return await editMessageText(chatId, messageId, "⚠️ حدث خطأ. يرجى المحاولة مرة أخرى."); }
    await firestore.collection('exams').doc(examId).update({ categoryName });
    await editMessageText(chatId, messageId, `✅ تم تغيير فئة الاختبار *${examId}* إلى *${categoryName}*.`, null, "Markdown");
    await showExamDetails(chatId, examId, messageId);
}
export async function handleEditExamRetake(callbackQuery) {
    const chatId = callbackQuery.from.id.toString();
    const messageId = callbackQuery.message.message_id;
    const [, examId, allowRetake] = callbackQuery.data.split(':');
    const allow = (allowRetake === 'true');
    await firestore.collection('exams').doc(examId).update({ allowRetake: allow });
    await answerCallbackQuery(callbackQuery.id, `✅ تم تحديث سياسة الإعادة.`, false);
    await sendEditExamMenu(chatId, examId, messageId);
}
export async function promptForNewExamTime(chatId, examId, messageId) {
    const text = `⏰ تعديل الوقت لاختبار *${examId}*`;
    const keyboard = {
        inline_keyboard: [
        [{ text: "⏱️ حدد وقت بالثواني", callback_data: `set_new_time:${examId}:true` }],
        [{ text: "♾️ اجعله وقت مفتوح", callback_data: `set_new_time:${examId}:false` }]
        ]
    };
    await editMessageText(chatId, messageId, text, keyboard, "Markdown");
}
export async function handleSetNewExamTime(chatId, examId, wantsTime, messageId) {
    if (wantsTime === 'true') {
        await setUserState(chatId, 'editing_exam_time_value', { examId });
        await editMessageText(chatId, messageId, `⏱️ الرجاء إرسال عدد الثواني الجديد لكل سؤال في اختبار *${examId}*`, null, "Markdown");
    } else {
        await firestore.collection('exams').doc(examId).update({ timePerQuestion: 0 });
        await editMessageText(chatId, messageId, `✅ تم تحديث الوقت إلى مفتوح.`);
        await sendEditExamMenu(chatId, examId, messageId);
    }
}
export async function handleEditExamTime(chatId, text, userState) {
    const { examId } = userState.data;
    const timeValue = parseInt(text, 10);
    if (isNaN(timeValue) || timeValue < 5 || timeValue > 600) {
        return await sendMessage(chatId, "⚠️ الرجاء إدخال رقم صحيح للوقت (بين 5 و 600 ثانية).");
    }
    await firestore.collection('exams').doc(examId).update({ timePerQuestion: timeValue });
    await clearUserState(chatId);
    await sendMessage(chatId, `✅ تم تحديث الوقت إلى *${timeValue}* ثانية لاختبار *${examId}*.`, null, "Markdown");
    await sendAdminMenu(chatId);
}
export async function listQuestionsForEditing(chatId, examId, messageId) {
    await editMessageText(chatId, messageId, `جاري تحميل أسئلة اختبار *${examId}*...`, null, 'Markdown');
    const questions = await getExamQuestions(examId);
    if (questions.length === 0) {
        const keyboard = { inline_keyboard: [[{ text: "➕ إضافة أسئلة جديدة", callback_data: `q_add_next:${examId}` }], [{ text: "⬅️ رجوع للتفاصيل", callback_data: `admin_exam_details:${examId}` }]]};
        return await editMessageText(chatId, messageId, `لا توجد أسئلة في اختبار *${examId}* حاليًا.`, keyboard, 'Markdown');
    }
    await editMessageText(chatId, messageId, `*${questions.length}* سؤال في اختبار *${examId}*. سيتم عرضها الآن...`, null, 'Markdown');
    for (const [index, q] of questions.entries()) {
        let questionText = `*السؤال ${index + 1}:*\n${q.questionText}\n\n`;
        q.options.forEach((opt, i) => { questionText += `${i + 1}. ${opt} ${i == q.correctOptionIndex ? '✅' : ''}\n`; });
        const qKeyboard = { 
            inline_keyboard: [[
                { text: "✏️ استبدال", callback_data: `q_replace:${examId}:${q.id}` }, 
                { text: "➕ إضافة تالي", callback_data: `q_add_after:${examId}:${q.order}` },
                { text: "🗑️ حذف", callback_data: `q_delete:${examId}:${q.id}` }
            ]] 
        };
        await sendMessage(chatId, questionText, qKeyboard, 'Markdown');
    }
    const finalKeyboard = { inline_keyboard: [[{ text: "➕ إضافة أسئلة جديدة (بشكل جماعي)", callback_data: `q_add_next:${examId}` }], [{ text: "⬅️ رجوع للتفاصيل", callback_data: `admin_exam_details:${examId}` }]]};
    await sendMessage(chatId, "يمكنك أيضًا إضافة مجموعة أسئلة جديدة دفعة واحدة من هنا:", finalKeyboard);
}
export async function promptForReplacementQuestion(chatId, examId, docId, messageId) {
    await setUserState(chatId, 'awaiting_replacement_question', { examId, docId });
    await editMessageText(chatId, messageId, `*استبدال السؤال*\n\nأرسل الآن السؤال الجديد في سطر واحد بصيغة:\n` + '`السؤال,الخيار1,الخيار2,رقم_الإجابة`', null, "Markdown");
}
export async function handleReplaceQuestion(chatId, text, userState) {
    const { docId } = userState.data;
    const parsedQuestion = parseSingleQuestion(text);
    if (!parsedQuestion) {
        return await sendMessage(chatId, "⚠️ صيغة خاطئة.");
    }
    const questionData = {
        questionText: parsedQuestion.questionText,
        options: parsedQuestion.options,
        correctOptionIndex: parsedQuestion.correctOptionIndex
    };
    await firestore.collection('questions').doc(docId).update(questionData);
    await clearUserState(chatId);
    await sendMessage(chatId, `✅ تم استبدال السؤال بنجاح.`);
}
export async function promptForNextQuestion(chatId, examId) {
    await setUserState(chatId, 'awaiting_next_question', { examId });
    const text = `*إضافة أسئلة جديدة لاختبار ${examId}*\n\nأرسل الآن الأسئلة الجديدة (كل سؤال في سطر) بصيغة:\n` + '`السؤال,الخيار1,الخيار2,رقم_الإجابة`';
    await sendMessage(chatId, text, null, "Markdown");
}
export async function handleAddNewQuestion(chatId, text, userState) {
    const { examId } = userState.data;
    const lines = text.trim().split('\n');
    let successCount = 0;
    let failCount = 0;
    await firestore.runTransaction(async (transaction) => {
        const examRef = firestore.collection('exams').doc(examId);
        const examDoc = await transaction.get(examRef);
        if (!examDoc.exists) throw new Error("Exam not found.");
        let currentOrder = examDoc.data().questionCount || 0;
        for (const line of lines) {
            if (line.trim() === '') continue;
            const parsedQuestion = parseSingleQuestion(line);
            if (parsedQuestion) {
                currentOrder++;
                const questionRef = firestore.collection('questions').doc();
                const questionData = { examId, questionText: parsedQuestion.questionText, options: parsedQuestion.options, correctOptionIndex: parsedQuestion.correctOptionIndex, order: currentOrder };
                transaction.set(questionRef, questionData);
                successCount++;
            } else {
                failCount++;
            }
        }
        transaction.update(examRef, { questionCount: currentOrder });
    });
    await clearUserState(chatId);
    let summaryMessage = `تمت معالجة الإضافة:\n`;
    if (successCount > 0) summaryMessage += `✅ نجح إضافة: ${successCount} سؤال.\n`;
    if (failCount > 0) summaryMessage += `⚠️ فشل إضافة: ${failCount} سؤال.\n`;
    await sendMessage(chatId, summaryMessage);
    await sendAdminMenu(chatId);
}
export async function promptForQuestionAfter(chatId, examId, afterOrderStr) {
    const afterOrder = parseInt(afterOrderStr, 10);
    await setUserState(chatId, 'awaiting_question_after', { examId, afterOrder });
    const text = `*إضافة سؤال بعد السؤال رقم ${afterOrder}*\n\nأرسل الآن السؤال الجديد بصيغة:\n` + '`السؤال,الخيار1,الخيار2,رقم_الإجابة`';
    await sendMessage(chatId, text, null, "Markdown");
}
export async function handleAddNewQuestionAfter(chatId, text, userState) {
    const { examId, afterOrder } = userState.data;
    const parsedQuestion = parseSingleQuestion(text);
    if (!parsedQuestion) {
        return await sendMessage(chatId, "⚠️ صيغة خاطئة.");
    }
    await firestore.runTransaction(async (transaction) => {
        const examRef = firestore.collection('exams').doc(examId);
        const subsequentQuestionsQuery = firestore.collection('questions').where('examId', '==', examId).where('order', '>', afterOrder);
        const subsequentQuestions = await transaction.get(subsequentQuestionsQuery);
        subsequentQuestions.forEach(doc => {
            transaction.update(doc.ref, { order: doc.data().order + 1 });
        });
        const newQuestionRef = firestore.collection('questions').doc();
        const newQuestionData = { ...parsedQuestion, examId, order: afterOrder + 1, };
        transaction.set(newQuestionRef, newQuestionData);
        transaction.update(examRef, { questionCount: FieldValue.increment(1) });
    });
    await clearUserState(chatId);
    await sendMessage(chatId, `✅ تم إضافة السؤال بنجاح بعد السؤال رقم ${afterOrder}.`);
    await sendAdminMenu(chatId);
}
export async function deleteQuestion(chatId, examId, docId, messageId) {
    try {
        await firestore.runTransaction(async (transaction) => {
            const questionRef = firestore.collection('questions').doc(docId);
            const examRef = firestore.collection('exams').doc(examId);

            // === ALL READS FIRST ===
            const questionDoc = await transaction.get(questionRef);
            if (!questionDoc.exists) { throw new Error(`Question with ID ${docId} not found.`); }
            
            const deletedOrder = questionDoc.data().order;
            const subsequentQuestionsQuery = firestore.collection('questions')
                .where('examId', '==', examId)
                .where('order', '>', deletedOrder);
            const subsequentQuestionsSnapshot = await transaction.get(subsequentQuestionsQuery);

            // === ALL WRITES SECOND ===
            transaction.delete(questionRef); 
            
            subsequentQuestionsSnapshot.forEach(doc => {
                const docRef = firestore.collection('questions').doc(doc.id);
                transaction.update(docRef, { order: doc.data().order - 1 });
            });
            
            transaction.update(examRef, { questionCount: FieldValue.increment(-1) });
        });
        await editMessageText(chatId, messageId, `✅ تم حذف السؤال بنجاح.`);
    } catch (error) {
        console.error("Error deleting question:", error);
        await sendMessage(chatId, "🚨 حدث خطأ أثناء حذف السؤال. يرجى مراجعة سجلات الخادم.");
    }
}
export async function confirmDeleteExam(chatId, examId, messageId) {
    const text = `🚨 *تحذير!* هل أنت متأكد من حذف الاختبار "*${examId}*؟"\n\nسيتم حذف جميع أسئلته بشكل نهائي. هذا الإجراء لا يمكن التراجع عنه.`;
    const keyboard = { inline_keyboard: [[{ text: "🗑️ نعم، احذف الاختبار", callback_data: `admin_delete_exam_confirm:${examId}` }], [{ text: "❌ تراجع", callback_data: `admin_exam_details:${examId}` }]]};
    await editMessageText(chatId, messageId, text, keyboard, "Markdown");
}
export async function deleteExam(chatId, examId, messageId) {
    const questions = await getExamQuestions(examId);
    const batch = firestore.batch();
    questions.forEach(q => {
        const questionRef = firestore.collection('questions').doc(q.id);
        batch.delete(questionRef);
    });
    const examRef = firestore.collection('exams').doc(examId);
    batch.delete(examRef);
    await batch.commit();
    await editMessageText(chatId, messageId, `✅ تم حذف الاختبار "*${examId}*" وجميع أسئلته بنجاح.`, { inline_keyboard: [[{ text: "🔙 رجوع لقائمة الاختبارات", callback_data: "admin_list_exams:1" }]] }, "Markdown");
}

// =============================================================================
//                             STUDENT QUIZ LOGIC
// =============================================================================
export async function getScoresForUser(userId) {
    const snapshot = await firestore.collection('studentScores').where('userId', '==', userId.toString()).get();
    const userScores = snapshot.docs.map(doc => doc.data());
    return userScores.sort((a,b) => b.timestamp - a.timestamp);
}
export function formatUserScores(scores) {
    if (!scores || scores.length === 0) { return "لا توجد نتائج مسجلة لهذا الطالب."; }
    let text = "📊 **النتائج السابقة:**\n\n";
    const groupedScores = {};
    scores.forEach(s => {
        if (!groupedScores[s.examId]) { groupedScores[s.examId] = []; }
        groupedScores[s.examId].push(s);
    });
    for (const examId in groupedScores) {
        text += `*الاختبار: ${examId}*\n`;
        groupedScores[examId].sort((a, b) => b.timestamp - a.timestamp).forEach(attempt => {
            let dateStr;
            if (attempt.timestamp && typeof attempt.timestamp === 'number') {
                dateStr = new Date(attempt.timestamp).toLocaleString("ar-EG");
            } else if (attempt.timestamp && attempt.timestamp.seconds) {
                dateStr = new Date(attempt.timestamp.seconds * 1000).toLocaleString("ar-EG");
            } else {
                dateStr = "تاريخ غير محدد";
            }
            text += `  - النتيجة: ${attempt.score}/${attempt.totalQuestions}  —  _${dateStr}_\n`;
        });
        text += `\n`;
    }
    return text;
}
export async function getScoresForExam(examId) {
    const snapshot = await firestore.collection('studentScores').where('examId', '==', examId).get();
    return snapshot.docs.map(doc => doc.data());
}
export async function checkUserHistory(userId, examId) {
    const snapshot = await firestore.collection('studentScores').where('userId', '==', userId.toString()).where('examId', '==', examId).limit(1).get();
    return !snapshot.empty;
}
export async function saveScore(userId, userName, examId, score, totalQuestions) {
    const scoreData = { userId: userId.toString(), userName, examId, score, totalQuestions, timestamp: Date.now() };
    await firestore.collection('studentScores').add(scoreData);
}
export async function listExamsForStudent(chatId, messageId) {
    const categories = await getAllCategories();
    if (categories.length === 0) {
        return await editMessageText(chatId, messageId, "لا توجد أي فئات اختبارات متاحة حاليًا.", { inline_keyboard: [[{text: "⬅️ رجوع", callback_data: "student_panel"}]]});
    }
    const text = "🗂️ يرجى اختيار فئة الاختبارات التي تريد عرضها:";
    const keyboard = { inline_keyboard: categories.map(cat => ([{ text: cat.name, callback_data: `list_exams_in_category:${cat.name}:1` }])) };
    keyboard.inline_keyboard.push([{ text: "⬅️ رجوع", callback_data: "student_panel" }]);
    await editMessageText(chatId, messageId, text, keyboard);
}
export async function listExamsInCategory(chatId, categoryName, messageId, page = 1) {
    const allExams = await getAllExams();
    const allExamsInCategory = allExams.filter(exam => exam.categoryName === categoryName);
    if (allExamsInCategory.length === 0) {
        return await editMessageText(chatId, messageId, `لا توجد اختبارات في فئة *${categoryName}* حاليًا.`, { inline_keyboard: [[{ text: "⬅️ رجوع للفئات", callback_data: "student_list_exams" }]]}, "Markdown");
    }
    const totalPages = Math.ceil(allExamsInCategory.length / PAGE_SIZE);
    const examsToShow = allExamsInCategory.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const text = `📝 اختر الاختبار الذي تريد عرضه من فئة *${categoryName}*:`;
    const keyboard = { inline_keyboard: examsToShow.map(exam => ([{ text: exam.examId, callback_data: `show_exam_confirm:${exam.examId}` }]))};
    const navRow = [];
    if (page > 1) navRow.push({ text: "◀️ السابق", callback_data: `list_exams_in_category:${categoryName}:${page - 1}` });
    navRow.push({ text: `صفحة ${page}/${totalPages}`, callback_data: "noop" });
    if (page < totalPages) navRow.push({ text: "التالي ▶️", callback_data: `list_exams_in_category:${categoryName}:${page + 1}` });
    if (navRow.length > 0) keyboard.inline_keyboard.push(navRow);
    keyboard.inline_keyboard.push([{ text: "⬅️ رجوع للفئات", callback_data: "student_list_exams" }]);
    await editMessageText(chatId, messageId, text, keyboard, "Markdown");
}
export async function showExamConfirmation(chatId, examId, messageId) {
    const exam = await getExam(examId);
    if (!exam) return;
    let text = `*تفاصيل الاختبار: ${examId}*\n\n`;
    text += `*عدد الأسئلة:* ${exam.questionCount || 0}\n`;
    text += `*السماح بالإعادة:* ${exam.allowRetake ? '✅ نعم' : '❌ لا'}\n`;
    text += `*الوقت لكل سؤال:* ${exam.timePerQuestion > 0 ? `${exam.timePerQuestion} ثانية` : '♾️ وقت مفتوح'}\n\n`;
    text += `هل أنت مستعد للبدء؟`;
    const keyboard = { inline_keyboard: [[{ text: "🚀 بدء الاختبار الآن", callback_data: `confirm_start_exam:${examId}` }], [{ text: "⬅️ رجوع", callback_data: `list_exams_in_category:${exam.categoryName}:1` }]]};
    await editMessageText(chatId, messageId, text, keyboard, "Markdown");
}
export async function startQuiz(callbackQuery) {
    const chatId = callbackQuery.from.id.toString();
    const messageId = callbackQuery.message ? callbackQuery.message.message_id : null;
    const [, examId] = callbackQuery.data.split(':');
    const userName = callbackQuery.from.username || callbackQuery.from.first_name;
    const exam = await getExam(examId);
    if (!exam) return;
    if (!exam.allowRetake && await checkUserHistory(chatId, examId)) {
        return await answerCallbackQuery(callbackQuery.id, "🚫 عذراً، لقد قمت بأداء هذا الاختبار من قبل والإعادة غير مسموحة.", true);
    }
    const questionsRaw = await getExamQuestions(examId);
    if (!questionsRaw || questionsRaw.length === 0) {
        return await answerCallbackQuery(callbackQuery.id, "⚠️ عذراً، هذا الاختبار لا يحتوي على أسئلة حاليًا.", true);
    }
    if (messageId) await editMessageText(chatId, messageId, `🚀 سيبدأ اختبار **${examId}** الآن. استعد!`, null, 'Markdown');
    else await sendMessage(chatId, `🚀 سيبدأ اختبار **${examId}** الآن. استعد!`, null, 'Markdown');
    const prepared = questionsRaw.map((q) => ({ ...q, questionText: escapeMarkdown(q.questionText || "") }));
    const quizData = {
        examId, userName, currentQuestionIndex: 0, score: 0, questions: prepared,
        timePerQuestion: exam.timePerQuestion || 0,
    };
    await setUserState(chatId, 'taking_exam', quizData);
    await sendQuestion(chatId, { state: 'taking_exam', data: quizData });
}
export async function sendQuestion(userId, userState) {
    const { currentQuestionIndex, questions, timePerQuestion } = userState.data;
    const question = questions[currentQuestionIndex];
    const sentPoll = await sendPoll(userId, question.questionText, question.options, 'quiz', question.correctOptionIndex, timePerQuestion);
    if (sentPoll && sentPoll.poll) {
        await setUserState(userId, 'taking_exam', { 
            ...userState.data,
            lastPollId: sentPoll.poll.id,
            lastMessageId: sentPoll.message_id,
            lastQuestionTimestamp: Date.now(),
        });
    }
}
export async function handlePollAnswer(pollAnswer) {
    const userId = pollAnswer.user.id.toString();
    const userState = await getUserState(userId);
    if (!userState || userState.state !== 'taking_exam' || pollAnswer.poll_id !== userState.data.lastPollId) {
        return;
    }
    await stopPoll(userId, userState.data.lastMessageId);
    const selectedOption = pollAnswer.option_ids[0];
    const qIndex = userState.data.currentQuestionIndex;
    const correctOption = userState.data.questions[qIndex].correctOptionIndex;
    if (selectedOption === correctOption) {
        userState.data.score++;
    }
    userState.data.currentQuestionIndex++;
    if (userState.data.currentQuestionIndex >= userState.data.questions.length) {
        await finishQuiz(userId, userState.data);
    } else {
        await setUserState(userId, 'taking_exam', userState.data);
        await sendQuestion(userId, userState);
    }
}
export async function finishQuiz(userId, userData) {
    const { userName, examId, score, questions } = userData;
    await saveScore(userId, userName, examId, score, questions.length);
    await clearUserState(userId);
    const text = `🎉 **انتهى الاختبار!** 🎉\n\nنتيجتك هي: *${score}* من *${questions.length}*`;
    const keyboard = { inline_keyboard: [[{ text: "🔄 إعادة الاختبار", callback_data: `show_exam_confirm:${examId}` }], [{ text: "🏠 القائمة الرئيسية", callback_data: 'student_panel' }]] };
    await sendMessage(userId, text, keyboard, 'Markdown');
}
export async function showStudentStats(chatId, messageId) {
    const allScores = await getScoresForUser(chatId);
    if (!allScores || allScores.length === 0) {
        return await editMessageText(chatId, messageId, "لم تقم بأداء أي اختبارات بعد.", { inline_keyboard: [[{text: "رجوع", callback_data: "student_panel"}]]});
    }
    const text = formatUserScores(allScores);
    const keyboard = { inline_keyboard: [[{text: "⬅️ رجوع", callback_data: "student_panel"}]] };
    await editMessageText(chatId, messageId, text, keyboard, 'Markdown');
}
export async function showStudentRanking(chatId, examId, userId, messageId) {
    const scores = await getScoresForExam(examId);
    if (!scores || scores.length === 0) {
        return await editMessageText(chatId, messageId, "لا توجد نتائج مسجلة لهذا الاختبار بعد.", { inline_keyboard: [[{text: "⬅️ رجوع", callback_data: "student_panel"}]]});
    }
    scores.sort((a, b) => b.score - a.score);
    const userRank = scores.findIndex(s => s.userId.toString() === userId.toString()) + 1;
    const userScore = scores.find(s => s.userId.toString() === userId.toString());
    if (!userScore) {
        return await editMessageText(chatId, messageId, "لم يتم العثور على نتيجتك في هذا الاختبار.", { inline_keyboard: [[{text: "⬅️ رجوع", callback_data: "student_panel"}]]});
    }
    let text = `📜 **ترتيبك في اختبار: ${examId}**\n\n`;
    text += `🏅 ترتيبك هو: *${userRank}* من أصل *${scores.length}* طالب.\n`;
    text += `🎯 درجتك: *${userScore.score}/${userScore.totalQuestions}*\n`;
    const keyboard = { inline_keyboard: [[{text: "⬅️ رجوع", callback_data: "student_panel"}]] };
    await editMessageText(chatId, messageId, text, keyboard, 'Markdown');
}

// =============================================================================
//                             CRON JOB / TIMEOUT LOGIC
// =============================================================================
export async function checkTimedOutQuizzes() {
  const now = Date.now();
  const statesSnapshot = await firestore.collection('userStates').where('state', '==', 'taking_exam').get();
  for (const doc of statesSnapshot.docs) {
    const userId = doc.id;
    const state = doc.data();
    const data = state.data;
    if (data && data.lastQuestionTimestamp && data.timePerQuestion > 0) {
      const timeElapsed = (now - data.lastQuestionTimestamp) / 1000;
      if (timeElapsed > data.timePerQuestion + 2) {
        console.log(`User ${userId} timed out. Advancing quiz.`);
        try {
            const userState = await getUserState(userId);
            if (userState && userState.state === 'taking_exam' && userState.data.lastQuestionTimestamp === data.lastQuestionTimestamp) {
                await stopPoll(userId, userState.data.lastMessageId);
                userState.data.currentQuestionIndex++;
                if (userState.data.currentQuestionIndex >= userState.data.questions.length) {
                    await finishQuiz(userId, userState.data);
                } else {
                    await setUserState(userId, 'taking_exam', userState.data);
                    await sendQuestion(userId, userState);
                }
            }
        } catch (e) {
          console.error(`Timeout processing failed for user ${userId}:`, e);
        }
      }
    }
  }
}
