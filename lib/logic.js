import firestore from './firebase.js';
import { sendMessage, editMessageText, sendPoll, answerCallbackQuery } from './telegram-api.js';

// Environment Variables
const ADMIN_ID = process.env.ADMIN_ID;
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE, 10) || 10;

// =============================================================================
//                             INTERNAL HELPER FUNCTIONS
// =============================================================================

function parseSingleQuestion(text) {
    const lines = text.trim().split('\n').filter(line => line.trim() !== '');
    if (lines.length < 3) return null;
    const questionText = lines[0].trim();
    const correctOptionNumber = parseInt(lines[lines.length - 1], 10);
    const options = lines.slice(1, -1).map(opt => opt.trim());
    if (isNaN(correctOptionNumber) || correctOptionNumber < 1 || correctOptionNumber > options.length || options.length < 2 || options.length > 10) return null;
    const correctOptionIndex = correctOptionNumber - 1;
    return { questionText, options, correctOptionIndex };
}

function escapeMarkdown(text) {
  if (!text) return "";
  return text.replace(/_/g, "\\_").replace(/\*/g, "\\*").replace(/\[/g, "\\[").replace(/`/g, "\\`");
}

async function promptForRetake(chatId, messageId = null) {
  const text = "🔁 هل تسمح للطلاب بإعادة هذا الاختبار؟";
  const keyboard = { inline_keyboard: [[{ text: "✅ نعم، اسمح بالإعادة", callback_data: "set_retake:true" }], [{ text: "❌ لا، مرة واحدة فقط", callback_data: "set_retake:false" }]]};
  if (messageId) await editMessageText(chatId, messageId, text, keyboard); else await sendMessage(chatId, text, keyboard);
}

async function promptForTime(chatId, messageId = null) {
    const text = "⏰ هل تريد تحديد وقت لكل سؤال؟";
    const keyboard = { inline_keyboard: [[{ text: "⏱️ نعم، حدد وقت", callback_data: "set_time:true" }], [{ text: "♾️ لا، وقت مفتوح", callback_data: "set_time:false" }]]};
    if (messageId) await editMessageText(chatId, messageId, text, keyboard); else await sendMessage(catId, text, keyboard);
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
  const text = `👍 تم حفظ إعدادات الاختبار: **${examId}**.\n\nالآن قم بإضافة الأسئلة. يمكنك لصق **مجموعة أسئلة** في رسالة واحدة.\n\nاستخدم الصيغة التالية وافصل بين كل سؤال وآخر بثلاث شرطات ` + "`---`\n\n" + "*مثال:*\n`السؤال الأول؟\nالخيار أ\nالخيار ب\n1\n---\nالسؤال الثاني؟\nخيار 1\nخيار 2\nخيار 3\n3`\n\n" + "**ملاحظات:**\n- السطر الأخير في كل جزء هو **رقم الإجابة الصحيحة**.\n\n" + "عندما تنتهي، اضغط على الزر أدناه.";
  const keyboard = { inline_keyboard: [[{ text: "✅ تم، إنهاء إضافة الأسئلة", callback_data: "finish_adding_questions" }]] };
  if (messageId) await editMessageText(chatId, messageId, text, keyboard, 'Markdown'); else await sendMessage(chatId, text, keyboard, 'Markdown');
}

// =============================================================================
//                             STATE & USER MANAGEMENT
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
    const userData = {
        userId: user.id.toString(),
        username: user.username || '',
        firstName: user.first_name,
        joinTimestamp: new Date()
    };
    await firestore.collection('users').doc(user.id.toString()).set(userData);
}

export async function checkAndNotifyNewUser(user) {
    if (await isNewUser(user.id)) {
        await addNewUser(user);
        const totalUsers = await getUserCount();
        let notification = `👤 مستخدم جديد انضم!\n\n` + `الاسم: ${user.first_name}\n`;
        if (user.username) notification += `المعرف: @${user.username}\n`;
        notification += `الأي دي: \`${user.id}\`\n\n` + `*العدد الكلي للمستخدمين الآن: ${totalUsers}*`;
        if (ADMIN_ID) await sendMessage(ADMIN_ID, notification, null, 'Markdown');
    }
}

export async function getUserCount() {
    const snapshot = await firestore.collection('users').get();
    return snapshot.size;
}

// =============================================================================
//                             MENU FUNCTIONS
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
    if (!newNameTrimmed) return;

    const oldDocRef = firestore.collection('categories').doc(oldName);
    const newDocRef = firestore.collection('categories').doc(newNameTrimmed);

    await firestore.runTransaction(async (transaction) => {
        const oldDoc = await transaction.get(oldDocRef);
        if (!oldDoc.exists) throw new Error("الفئة القديمة غير موجودة.");
        
        const newDoc = await transaction.get(newDocRef);
        if (newDoc.exists) throw new Error("الاسم الجديد مستخدم بالفعل.");
        
        const oldData = oldDoc.data();
        transaction.set(newDocRef, { ...oldData, name: newNameTrimmed });
        transaction.delete(oldDocRef);
    });

    await clearUserState(chatId);
    await sendMessage(chatId, `✅ تم تغيير اسم الفئة من "${oldName}" إلى "${newNameTrimmed}".`);
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

// =============================================================================
//                             EXAM & QUESTION MANAGEMENT
// =============================================================================

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

export async function handleNewExamName(chatId, text, userState) {
    const examId = text.trim();
    if (!examId) return;
    if (await getExam(examId)) {
        return await sendMessage(chatId, "⚠️ اسم الاختبار هذا مستخدم بالفعل. الرجاء اختيار اسم آخر.");
    }
    await setUserState(chatId, 'awaiting_retake_choice', { examId });
    await promptForRetake(chatId);
}

export async function handleSetRetake(chatId, allowRetake, messageId) {
    let userState = await getUserState(chatId);
    if (!userState || userState.state !== 'awaiting_retake_choice') return;
    userState.data.allowRetake = (allowRetake === 'true');
    await setUserState(chatId, 'awaiting_time_choice', userState.data);
    await promptForTime(chatId, messageId);
}

export async function handleSetTime(chatId, wantsTime, messageId) {
    let userState = await getUserState(chatId);
    if (!userState || userState.state !== 'awaiting_time_choice') return;
    if (wantsTime === 'true') {
        await setUserState(chatId, 'awaiting_time_per_question', userState.data);
        await editMessageText(chatId, messageId, "⏱️ ممتاز. الرجاء إرسال عدد الثواني المخصصة لكل سؤال (مثال: 30).");
    } else {
        userState.data.time = 0;
        await setUserState(chatId, 'selecting_category', userState.data);
        await promptForCategorySelection(chatId, messageId, 'new');
    }
}

export async function handleNewExamTime(chatId, text, userState) {
    const time = parseInt(text, 10);
    if (isNaN(time) || time < 5 || time > 600) {
        return await sendMessage(chatId, "⚠️ الرجاء إدخال رقم صحيح للوقت (بين 5 و 600 ثانية).");
    }
    userState.data.time = time;
    await setUserState(chatId, 'selecting_category', userState.data);
    await promptForCategorySelection(chatId, null, 'new');
}

export async function handleCategorySelectionForNewExam(chatId, categoryName, messageId) {
    const userState = await getUserState(chatId);
    if (!userState || userState.state !== 'selecting_category') return;
    userState.data.categoryName = categoryName;
    await setUserState(chatId, 'awaiting_questions', userState.data);
    await promptForQuestions(chatId, userState.data.examId, messageId);
}

export async function addBulkQuestionsFromText(chatId, text, userState) {
    const questionBlocks = text.trim().split('---');
    let successCount = 0;
    let failCount = 0;
    if (!userState.data.questions) userState.data.questions = [];

    for (const block of questionBlocks) {
        if (block.trim() === '') continue;
        const parsedQuestion = parseSingleQuestion(block);
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
    if (failCount > 0) summaryMessage += `⚠️ فشل إضافة: ${failCount} سؤال.\n`;
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
    const { examId, allowRetake, time, categoryName, questions } = userState.data;
    const examData = { examId, allowRetake, timePerQuestion: time, categoryName, questionCount: questions.length };

    const batch = firestore.batch();
    const examRef = firestore.collection('exams').doc(examId);
    batch.set(examRef, examData);

    questions.forEach((q, index) => {
        const questionRef = firestore.collection('questions').doc(); // Auto-generate ID
        const questionData = { 
            examId, 
            questionText: q.questionText, 
            options: q.options, 
            correctOptionIndex: q.correctOptionIndex, 
            order: index + 1 
        };
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
    if (!exam) {
        return await editMessageText(chatId, messageId, "⚠️ لم يتم العثور على الاختبار.");
    }
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
    if (!categoryName) {
        return await editMessageText(chatId, messageId, "⚠️ حدث خطأ. يرجى المحاولة مرة أخرى.");
    }
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
                { text: "➕ إضافة تالي", callback_data: `q_add_next:${examId}` }, 
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
    await editMessageText(chatId, messageId, `*استبدال السؤال*\n\nأرسل الآن السؤال الجديد بنفس الصيغة المعتادة.`, null, "Markdown");
}

export async function handleReplaceQuestion(chatId, text, userState) {
    const { examId, docId } = userState.data;
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

export async function promptForNextQuestion(chatId, examId, messageId) {
    await setUserState(chatId, 'awaiting_next_question', { examId });
    const text = `*إضافة أسئلة جديدة لاختبار ${examId}*\n\nأرسل الآن الأسئلة الجديدة. يمكنك إرسال سؤال واحد أو مجموعة أسئلة في رسالة واحدة بنفس الصيغة المعتادة (افصل بينها بـ \`---\`).`;
    await sendMessage(chatId, text, null, "Markdown");
}

export async function handleAddNewQuestion(chatId, text, userState) {
    const { examId } = userState.data;
    const questionBlocks = text.trim().split('---');
    let successCount = 0;
    let failCount = 0;
    
    await firestore.runTransaction(async (transaction) => {
        const examRef = firestore.collection('exams').doc(examId);
        const examDoc = await transaction.get(examRef);
        if (!examDoc.exists) throw new Error("Exam not found.");

        let currentOrder = examDoc.data().questionCount || 0;
        
        for (const block of questionBlocks) {
            if (block.trim() === '') continue;
            const parsedQuestion = parseSingleQuestion(block);
            if (parsedQuestion) {
                currentOrder++;
                const questionRef = firestore.collection('questions').doc();
                const questionData = { 
                    examId: examId, 
                    questionText: parsedQuestion.questionText, 
                    options: parsedQuestion.options, 
                    correctOptionIndex: parsedQuestion.correctOptionIndex, 
                    order: currentOrder 
                };
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

export async function deleteQuestion(chatId, examId, docId, messageId) {
    // This requires a transaction to re-order subsequent questions and update count
    await firestore.collection('questions').doc(docId).delete();
    const examRef = firestore.collection('exams').doc(examId);
    await examRef.update({ questionCount: firestore.FieldValue.increment(-1) });
    await editMessageText(chatId, messageId, `✅ تم حذف السؤال بنجاح.`);
    // A full implementation should re-order remaining questions.
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

export async function getAllScores() {
  const snapshot = await firestore.collection('studentScores').get();
  return snapshot.docs.map(doc => doc.data());
}

export async function getScoresForExam(examId) {
    const allScores = await getAllScores();
    return allScores.filter(score => score.examId === examId);
}

export async function checkUserHistory(userId, examId) {
    const snapshot = await firestore.collection('studentScores')
        .where('userId', '==', userId.toString())
        .where('examId', '==', examId)
        .limit(1)
        .get();
    return !snapshot.empty;
}

export async function saveScore(userId, userName, examId, score, totalQuestions) {
    const scoreData = {
        userId: userId.toString(),
        userName,
        examId,
        score,
        totalQuestions,
        timestamp: Date.now()
    };
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
    let text = `*تفاصيل الاختبار: ${exam.examId}*\n\n`;
    text += `*عدد الأسئلة:* ${exam.questionCount || 0}\n`;
    text += `*السماح بالإعادة:* ${exam.allowRetake ? '✅ نعم' : '❌ لا'}\n`;
    text += `*الوقت لكل سؤال:* ${exam.timePerQuestion > 0 ? `${exam.timePerQuestion} ثانية` : '♾️ وقت مفتوح'}\n\n`;
    if (exam.timePerQuestion > 0) { text += `⚠️ *تنبيه مهم:*\nهذا الاختبار محدد بوقت. إذا انتهى الوقت ولم ينتقل البوت للسؤال التالي تلقائيًا، *الرجاء الانتظار لمدة تصل إلى دقيقة واحدة* حتى يتم نقلك للسؤال التالي.\n\n`; }
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

    const prepared = questionsRaw.map((q, idx) => ({
        originalIndex: idx,
        questionText: escapeMarkdown(q.questionText || ""),
        options: q.options || [],
        correctOptionIndex: q.correctOptionIndex
    }));
    
    // Timed quiz
    if (exam.timePerQuestion > 0) {
        await setUserState(chatId, 'taking_exam', {
            examId,
            userName,
            currentQuestionIndex: 0,
            score: 0,
            questions: prepared,
            timePerQuestion: exam.timePerQuestion,
            quizFinished: false
        });
        await sendQuestion(chatId, await getUserState(chatId));
    } 
    // Untimed quiz
    else {
        const quizData = {
            examId,
            userName,
            answers: {},
            questions: prepared,
            timePerQuestion: 0,
            pollMap: {},
            questionsSent: 0,
            batchSize: 10,
            controlMessageId: null,
            quizFinished: false
        };
        const userState = { state: 'taking_exam', data: quizData };
        await setUserState(chatId, 'taking_exam', quizData);
        await sendQuestionsBatch(chatId, userState);
    }
}

export async function sendQuestionsBatch(userId, userState) {
    try {
        let data = userState.data;
        const questions = data.questions || [];
        const total = questions.length;
        const batchSize = data.batchSize || 10;
        const startIndex = data.questionsSent || 0;

        if (startIndex >= total) return;
        const endIndex = Math.min(startIndex + batchSize, total);

        data.pollMap = data.pollMap || {};

        for (let i = startIndex; i < endIndex; i++) {
            const q = questions[i];
            const sent = await sendPoll(userId, q.questionText, q.options, 'quiz', q.correctOptionIndex, 0);
            if (sent && sent.poll && sent.poll.id) {
                data.pollMap[sent.poll.id] = i;
            }
        }
        
        data.questionsSent = endIndex;
        let res;
        if (data.questionsSent < total) {
            const keyboard = { inline_keyboard: [[{ text: "إرسال المجموعة التالية", callback_data: "next_batch" }]] };
            res = await sendMessage(userId, `📦 تم إرسال أسئلة من ${startIndex + 1} إلى ${endIndex}.\nاضغط لإرسال المجموعة التالية.`, keyboard);
        } else {
            const keyboard = { inline_keyboard: [[{ text: "إنهاء الامتحان وعرض النتيجة", callback_data: "finish_exam" }]] };
            res = await sendMessage(userId, `✅ تم إرسال جميع الأسئلة (${total}).\nاضغط "إنهاء الامتحان" لعرض النتيجة.`, keyboard);
        }

        if (res && res.message_id) {
            data.controlMessageId = res.message_id;
        }
        await setUserState(userId, 'taking_exam', data);
    } catch (e) {
        console.error(`Critical error in sendQuestionsBatch: ${e}`);
    }
}

export async function handleNextBatch(callbackQuery) {
    const userId = callbackQuery.from.id.toString();
    const messageId = callbackQuery.message ? callbackQuery.message.message_id : null;
    const userState = await getUserState(userId);
    if (!userState || userState.state !== 'taking_exam') {
        return await answerCallbackQuery(callbackQuery.id, "⚠️ لا يوجد اختبار جارٍ.", true);
    }
    if (messageId) {
        await editMessageText(userId, messageId, "⏳ جاري إرسال المجموعة التالية...", null);
    }
    await sendQuestionsBatch(userId, userState);
}

export async function handleFinishExam(callbackQuery) {
    const userId = callbackQuery.from.id.toString();
    const messageId = callbackQuery.message ? callbackQuery.message.message_id : null;
    let score = 0;
    let userState = await getUserState(userId);

    await firestore.runTransaction(async (transaction) => {
        const userStateRef = firestore.collection('userStates').doc(userId);
        const userStateDoc = await transaction.get(userStateRef);
        if (!userStateDoc.exists || userStateDoc.data().state !== 'taking_exam') {
            throw new Error("No active exam found.");
        }
        userState = userStateDoc.data();
        const data = userState.data;
        const questions = data.questions || [];
        const answers = data.answers || {};

        for (let i = 0; i < questions.length; i++) {
            if (answers[i] !== undefined && answers[i] == questions[i].correctOptionIndex) {
                score++;
            }
        }
        transaction.delete(userStateRef);
    });

    await saveScore(userId, userState.data.userName || callbackQuery.from.first_name, userState.data.examId, score, userState.data.questions.length);

    if (messageId) {
        await editMessageText(userId, messageId, "✅ تم إنهاء الامتحان.", null);
    }

    await sendMessage(userId, `🎉 انتهى الامتحان!\n\nالنتيجة: *${score}* من *${userState.data.questions.length}*`, {
      inline_keyboard: [
        [{ text: "🔄 إعادة الاختبار", callback_data: `show_exam_confirm:${userState.data.examId}` }],
        [{ text: "🏠 القائمة الرئيسية", callback_data: "student_panel" }]
      ]
    }, 'Markdown');
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


// Functions for timed quizzes
export async function sendQuestion(userId, userState) {
    const { currentQuestionIndex, questions, timePerQuestion, examId } = userState.data;

    if (currentQuestionIndex >= questions.length) {
        return await finishQuiz(userId, userState);
    }
    const question = questions[currentQuestionIndex];
    const sentMessage = await sendPoll(userId, question.questionText, question.options, 'quiz', question.correctOptionIndex, timePerQuestion);
    
    if (sentMessage && sentMessage.poll) {
        const pollId = sentMessage.poll.id;
        await firestore.collection('botData').doc(pollId).set({
            pollId: pollId,
            userId,
            examId,
            correctOptionIndex: question.correctOptionIndex
        });
        userState.data.lastQuestionTimestamp = Date.now();
        await setUserState(userId, 'taking_exam', userState.data);
    }
}

export async function advanceQuiz(userId, userState) {
  userState.data.currentQuestionIndex++;
  await setUserState(userId, 'taking_exam', userState.data);
  await sendQuestion(userId, userState);
}

export async function finishQuiz(userId, userState) {
    const { examId, score, userName, questions } = userState.data;
    await saveScore(userId, userName, examId, score, questions.length);
    await clearUserState(userId);
    const text = `🎉 **انتهى الاختبار!** 🎉\n\nنتيجتك هي: *${score}* من *${questions.length}*`;
    const keyboard = { inline_keyboard: [[{ text: "🔄 إعادة الاختبار", callback_data: `show_exam_confirm:${examId}` }], [{ text: "العودة للقائمة", callback_data: 'student_panel' }]] };
    await sendMessage(userId, text, keyboard, 'Markdown');
}

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
          await firestore.runTransaction(async (transaction) => {
            const currentStateDoc = await transaction.get(firestore.collection('userStates').doc(userId));
            if (!currentStateDoc.exists) return;
            const currentState = currentStateDoc.data();
            if (currentState.state === 'taking_exam' && currentState.data.lastQuestionTimestamp === data.lastQuestionTimestamp) {
                currentState.data.currentQuestionIndex++;
                transaction.set(firestore.collection('userStates').doc(userId), currentState);
                await sendQuestion(userId, currentState);
            }
          });
        } catch (e) {
          console.error(`Timeout transaction failed for user ${userId}:`, e);
        }
      }
    }
  }
}
