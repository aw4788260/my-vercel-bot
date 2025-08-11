import firestore from './firebase.js';
import { sendMessage, editMessageText, sendPoll, answerCallbackQuery } from './telegram-api.js';

// استيراد المتغيرات من البيئة
const ADMIN_ID = process.env.ADMIN_ID;
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE, 10) || 10;

// =============================================================================
//                 6. دوال المستخدمين والحالة والإحصائيات
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
            text += `  - النتيجة: ${attempt.score}/${attempt.totalQuestions}  —  _${date}_\n`;
        });
        text += `\n`;
    }
    return text;
}

export async function getScoresForUser(userId) {
    try {
        const snapshot = await firestore.collection('studentScores').where('userId', '==', userId.toString()).get();
        const userScores = snapshot.docs.map(doc => doc.data());
        return userScores.sort((a,b) => b.timestamp - a.timestamp);
    } catch (e) {
        console.error("Error in getScoresForUser:", e);
        return [];
    }
}

// =============================================================================
//                             7. دوال القوائم
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
//                             8. إدارة الفئات
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

export async function listCategoriesForEditing(chatId, messageId) {
    const categories = await getAllCategories();
    if (categories.length === 0) { 
        await editMessageText(chatId, messageId, "لا توجد فئات لعرضها.", { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "manage_categories" }]] }); 
        return; 
    }
    const text = "اختر الفئة التي تريد تعديلها أو حذفها:";
    const keyboard = { inline_keyboard: categories.map(cat => ([{ text: cat.name, callback_data: `category_edit:${cat.name}` }]))};
    keyboard.inline_keyboard.push([{ text: "🔙 رجوع", callback_data: "manage_categories" }]);
    await editMessageText(chatId, messageId, text, keyboard);
}

export async function promptForCategoryReorder(chatId, messageId) {
    const categories = (await getAllCategories()).map(c => c.name).join("\n");
    const text = "🔄 *تغيير ترتيب الفئات*\n\nالترتيب الحالي هو:\n" + categories + "\n\nللتغيير، أرسل قائمة بالأسماء مفصولة بفاصلة (,) بالترتيب الجديد الذي تريده.\n\n*مثال:*\n`فئة ب,فئة أ,فئة ج`";
    await setUserState(chatId, 'awaiting_category_order', {});
    await editMessageText(chatId, messageId, text, { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "manage_categories" }]] }, "Markdown");
}

// =============================================================================
//                             9. إدارة الاختبارات والأسئلة
// =============================================================================

export async function listExamsForAdmin(chatId, messageId, page = 1) {
    const allExams = await getAllExams();
    if (allExams.length === 0) {
      await editMessageText(chatId, messageId, "لا توجد أي اختبارات حاليًا.", { inline_keyboard: [[{ text: "⬅️ رجوع", callback_data: "admin_panel" }]]});
      return;
    }
    const totalPages = Math.ceil(allExams.length / PAGE_SIZE);
    const examsToShow = allExams.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const text = "📋 اختر اختبارًا لعرض تفاصيله وتعديله:";
    const keyboard = { inline_keyboard: examsToShow.map(exam => ([{ text: `${exam.examId} (${exam.questionCount} سؤال)`, callback_data: `admin_exam_details:${exam.examId}` }]))};

    const navRow = [];
    if (page > 1) { navRow.push({ text: "◀️ السابق", callback_data: `admin_list_exams:${page - 1}` }); }
    navRow.push({ text: `صفحة ${page}/${totalPages}`, callback_data: "noop" });
    if (page < totalPages) { navRow.push({ text: "التالي ▶️", callback_data: `admin_list_exams:${page + 1}` }); }

    if (navRow.length > 0) { keyboard.inline_keyboard.push(navRow); }
    keyboard.inline_keyboard.push([{ text: "⬅️ رجوع للقائمة", callback_data: "admin_panel" }]);
    await editMessageText(chatId, messageId, text, keyboard, 'Markdown');
}

// =============================================================================
//                             10. منطق الطالب والاختبار
// =============================================================================

export async function listExamsForStudent(chatId, messageId) {
    const categories = await getAllCategories();
    if (categories.length === 0) {
        await editMessageText(chatId, messageId, "لا توجد أي فئات اختبارات متاحة حاليًا.", { inline_keyboard: [[{text: "⬅️ رجوع", callback_data: "student_panel"}]]});
        return;
    }
    const text = "🗂️ يرجى اختيار فئة الاختبارات التي تريد عرضها:";
    const keyboard = { inline_keyboard: categories.map(cat => ([{ text: cat.name, callback_data: `list_exams_in_category:${cat.name}:1` }])) };
    keyboard.inline_keyboard.push([{ text: "⬅️ رجوع", callback_data: "student_panel" }]);
    await editMessageText(chatId, messageId, text, keyboard);
}

export async function showStudentStats(chatId, messageId) {
    const allScores = await getScoresForUser(chatId);
    if (!allScores || allScores.length === 0) {
        await editMessageText(chatId, messageId, "لم تقم بأداء أي اختبارات بعد.", { inline_keyboard: [[{text: "رجوع", callback_data: "student_panel"}]]});
        return;
    }
    const text = formatUserScores(allScores);
    const keyboard = { inline_keyboard: [[{text: "⬅️ رجوع", callback_data: "student_panel"}]] };
    await editMessageText(chatId, messageId, text, keyboard, 'Markdown');
}

// ... The rest of your logic functions would go here, ALL with 'export'
// For brevity, I've added the missing exports for the functions you listed
// and a few others that were likely missing. You should ensure all functions
// called from handlers.js have the 'export' keyword.

async function getAllExams() {
    try {
        const snapshot = await firestore.collection('exams').get();
        return snapshot.docs.map(doc => doc.data());
    } catch (e) {
        console.error("Error in getAllExams:", e);
        return [];
    }
}
