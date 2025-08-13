import { Firestore, FieldValue } from '@google-cloud/firestore';
import { sendMessage, editMessageText, sendPoll, answerCallbackQuery, stopPoll, deleteMessage } from './telegram-api.js';

const firestore = new Firestore({
  projectId: process.env.GCP_PROJECT_ID,
  credentials: {
    client_email: process.env.GCP_CLIENT_EMAIL,
    private_key: process.env.GCP_PRIVATE_KEY.replace(/@@/g, '\n'),
  },
});

const PRIMARY_ADMIN_ID = "6659806372";
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE, 10) || 10;

function parseSingleQuestionCSV(line) { try { const parts = line.split(',').map(p => p.trim()); if (parts.length < 4) return null; const questionText = parts[0]; const answerNumber = parseInt(parts[parts.length - 1], 10); const options = parts.slice(1, -1); if (!questionText || options.some(opt => !opt) || isNaN(answerNumber) || answerNumber < 1 || answerNumber > options.length) return null; const correctOptionIndex = answerNumber - 1; return { questionText, options, correctOptionIndex }; } catch (e) { console.error("Error parsing line:", line, e); return null; } }
function escapeMarkdown(text) { if (!text) return ""; return text.replace(/_/g, "\\_").replace(/\*/g, "\\*").replace(/\[/g, "\\[").replace(/`/g, "\\`"); }
function buildCategoryTreeList(allCategories, parentId = null, prefix = '') { let result = []; const children = allCategories.filter(cat => (cat.parentId || null) === parentId).sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99)); for (const category of children) { result.push({ ...category, indentedName: `${prefix}${category.name}` }); result = result.concat(buildCategoryTreeList(allCategories, category.name, `${prefix}    `)); } return result; }

export async function getUserState(userId) { const doc = await firestore.collection('userStates').doc(userId.toString()).get(); return doc.exists ? doc.data() : null; }
export async function setUserState(userId, state, data = {}) { await firestore.collection('userStates').doc(userId.toString()).set({ state, data }, { merge: true }); }
export async function clearUserState(chatId, messageId) { const userState = await getUserState(chatId); if (userState && userState.data.promptMessageId) { messageId = userState.data.promptMessageId; } await firestore.collection('userStates').doc(chatId.toString()).delete(); const text = "👍 تم إلغاء العملية."; try { if (messageId) { await editMessageText(chatId, messageId, text, null); } else { await sendMessage(chatId, text); } } catch(e) { await sendMessage(chatId, text); } await sendAdminMenu(chatId); }
export async function isNewUser(userId) { const userDoc = await firestore.collection('users').doc(userId.toString()).get(); return !userDoc.exists; }
export async function addNewUser(user) { const userData = { userId: user.id.toString(), username: user.username || '', firstName: user.first_name, joinTimestamp: new Date() }; await firestore.collection('users').doc(user.id.toString()).set(userData); }
export async function checkAndNotifyNewUser(user) { if (await isNewUser(user.id)) { await addNewUser(user); const totalUsers = await getUserCount(); let notification = `👤 مستخدم جديد انضم!\n\n` + `الاسم: ${user.first_name}\n` + `المعرف: ${user.username ? `@${user.username}` : '(لا يوجد)'}\n` + `الأي دي: \`${user.id}\`\n\n` + `*العدد الكلي للمستخدمين الآن: ${totalUsers}*`; if (PRIMARY_ADMIN_ID) await sendMessage(PRIMARY_ADMIN_ID, notification, null, 'Markdown'); } }
export async function getUserCount() { const snapshot = await firestore.collection('users').get(); return snapshot.size; }
export async function isAdmin(userId) { if (userId.toString() === PRIMARY_ADMIN_ID) return true; const adminDoc = await firestore.collection('botAdmins').doc(userId.toString()).get(); return adminDoc.exists; }
export async function addAdmin(targetId) { await firestore.collection('botAdmins').doc(targetId.toString()).set({ addedAt: new Date() }); }
export async function deleteAdmin(targetId) { await firestore.collection('botAdmins').doc(targetId.toString()).delete(); }

export async function sendMainMenu(chatId, messageId = null) { const text = "👋 أهلاً بك في بوت الاختبارات!\n\nاختر الواجهة المناسبة لك:"; let keyboard; if (await isAdmin(chatId)) { keyboard = { inline_keyboard: [[{ text: "👑 لوحة تحكم الأدمن", callback_data: "admin_panel" }], [{ text: "🎓 واجهة الطالب", callback_data: "student_panel" }]] }; } else { keyboard = { inline_keyboard: [[{ text: "🎓 الدخول للاختبارات", callback_data: "student_panel" }]] }; } if (messageId) await editMessageText(chatId, messageId, text, keyboard); else await sendMessage(chatId, text, keyboard); }
export async function sendAdminMenu(chatId, messageId = null) { const text = "👑 لوحة تحكم الأدمن\n\nاختر الإجراء الذي تريد القيام به:"; const keyboard = { inline_keyboard: [ [{ text: "➕ إضافة اختبار جديد", callback_data: "admin_add_exam" }], [{ text: "📋 عرض وتعديل الاختبارات", callback_data: "admin_browse_exams" }], [{ text: "🗂️ إدارة الفئات", callback_data: "manage_categories" }], [{ text: "⬅️ العودة للقائمة الرئيسية", callback_data: "back_to_main" }] ] }; if (messageId) await editMessageText(chatId, messageId, text, keyboard); else await sendMessage(chatId, text, keyboard); }
export async function sendStudentMenu(chatId, messageId = null) { const text = "🎓 واجهة الطالب\n\nمرحباً بك!"; const keyboard = { inline_keyboard: [ [{ text: "📝 بدء اختبار", callback_data: "student_browse_categories" }], [{ text: "📊 عرض نتائجي السابقة", callback_data: "student_stats" }], [{ text: "🏠 القائمة الرئيسية", callback_data: "back_to_main" }] ] }; if (messageId) await editMessageText(chatId, messageId, text, keyboard); else await sendMessage(chatId, text, keyboard); }
export async function getAllCategories() { const snapshot = await firestore.collection('categories').get(); return snapshot.docs.map(doc => doc.data()); }

export async function sendCategoryManagementMenu(chatId, messageId) {
    const text = "🗂️ إدارة الفئات\n\nاختر الإجراء المطلوب:";
    const keyboard = { inline_keyboard: [
        [{ text: "➕ إضافة فئة رئيسية", callback_data: "category_add_toplevel" }], 
        [{ text: "➕ إضافة فئة فرعية", callback_data: "category_add_subcategory" }], 
        [{ text: "✏️ تعديل / عرض الفئات", callback_data: "category_edit_list" }], 
        [{ text: "🔄 تغيير ترتيب الفئات الرئيسية", callback_data: "category_reorder" }], 
        [{ text: "🔙 رجوع للوحة التحكم", callback_data: "admin_panel" }]] 
    };
    await editMessageText(chatId, messageId, text, keyboard);
}

export async function promptForNewCategoryName(chatId, messageId, isSubcategory = false, parentId = null) {
    const state = isSubcategory ? 'awaiting_subcategory_name' : 'awaiting_toplevel_category_name';
    await setUserState(chatId, state, { parentId });
    await editMessageText(chatId, messageId, "📝 يرجى إرسال اسم الفئة الجديدة.", { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "cancel_operation" }]] });
}

export async function adminBrowseCategoriesForParentSelection(chatId, messageId, parentId = null) {
    const allCategories = await getAllCategories();
    const childCategories = allCategories
        .filter(cat => (cat.parentId || null) === parentId)
        .sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99));

    const text = parentId ? `اختر فئة فرعية لتكون الأب، أو اختر الفئة الحالية "${parentId}"`: "اختر الفئة الرئيسية التي ستكون الأب:";
    const keyboardRows = [];

    if (parentId) {
        keyboardRows.push([{ text: `✅ اختيار "${parentId}" كأب`, callback_data: `category_select_parent:${parentId}` }]);
    }

    childCategories.forEach(cat => {
        keyboardRows.push([
            { text: `✅ اختيار "${cat.name}"`, callback_data: `category_select_parent:${cat.name}` },
            { text: `📁 عرض الفئات الفرعية`, callback_data: `admin_browse_for_parent:${cat.name}` }
        ]);
    });
    
    let backCallback = 'manage_categories';
    if (parentId) {
        const currentCategory = allCategories.find(c => c.name === parentId);
        backCallback = currentCategory?.parentId 
            ? `admin_browse_for_parent:${currentCategory.parentId}`
            : 'category_add_subcategory';
    }
    keyboardRows.push([{ text: "🔙 رجوع", callback_data: backCallback }]);
    
    await editMessageText(chatId, messageId, text, { inline_keyboard: keyboardRows });
}

export async function handleNewCategory(chatId, text, userState) {
    // ... (This function remains the same as the previous version)
    const categoryName = text.trim(); if (!categoryName) return; const { parentId } = userState.data; const categories = await getAllCategories(); if (categories.some(c => c.name === categoryName)) { return await sendMessage(chatId, "⚠️ هذه الفئة موجودة بالفعل. يرجى اختيار اسم آخر."); } const siblingCategories = categories.filter(c => (c.parentId || null) === (parentId || null)); const newOrder = siblingCategories.length > 0 ? Math.max(...siblingCategories.map(c => c.displayOrder || 0)) + 1 : 1; const categoryData = { name: categoryName, displayOrder: newOrder, parentId: parentId || null }; await firestore.collection('categories').doc(categoryName).set(categoryData); await firestore.collection('userStates').doc(chatId).delete(); await sendMessage(chatId, `✅ تم إضافة الفئة "${categoryName}" بنجاح.`); await sendAdminMenu(chatId);
}

export async function listCategoriesForEditing(chatId, messageId, categoryId = null) {
    // ... (This function remains the same as the previous version)
    const allCategories = await getAllCategories(); const childCategories = allCategories.filter(cat => (cat.parentId || null) === categoryId).sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99)); if (allCategories.length === 0 && !categoryId) { return await editMessageText(chatId, messageId, "لا توجد فئات لعرضها.", { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "manage_categories" }]] }); } const text = categoryId ? `أنت في فئة: *${categoryId}*` : "اختر فئة لعرض محتواها أو تعديلها:"; const keyboardRows = []; for (const cat of childCategories) { keyboardRows.push([ { text: `📁 عرض محتوى "${cat.name}"`, callback_data: `admin_browse_categories:${cat.name}` }, { text: `✏️ تعديل`, callback_data: `category_edit:${cat.name}` } ]); } let backCallback = 'manage_categories'; if (categoryId) { const currentCategory = allCategories.find(c => c.name === categoryId); backCallback = currentCategory?.parentId ? `admin_browse_categories:${currentCategory.parentId}` : 'category_edit_list'; } keyboardRows.push([{ text: "🔙 رجوع", callback_data: backCallback }]); const keyboard = { inline_keyboard: keyboardRows }; await editMessageText(chatId, messageId, text, keyboard, "Markdown");
}

export async function sendSingleCategoryEditMenu(chatId, categoryName, messageId) {
    // ... (This function remains the same as the previous version)
    const text = `ماذا تريد أن تفعل بالفئة: *${categoryName}*؟`; let parentId = (await firestore.collection('categories').doc(categoryName).get()).data()?.parentId; const backCallback = parentId ? `admin_browse_categories:${parentId}` : 'category_edit_list'; const keyboard = { inline_keyboard: [ [{ text: "📝 إعادة تسمية", callback_data: `category_rename:${categoryName}` }], [{ text: "🗑️ حذف", callback_data: `category_delete_confirm:${categoryName}` }], [{ text: "🔙 رجوع", callback_data: backCallback }] ]}; await editMessageText(chatId, messageId, text, keyboard, "Markdown");
}

export async function promptForCategoryRename(chatId, oldName, messageId) {
    // ... (This function remains the same as the previous version)
    await setUserState(chatId, 'awaiting_category_rename', { oldName }); await editMessageText(chatId, messageId, `أرسل الاسم الجديد للفئة "${oldName}":`, { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "cancel_operation" }]] });
}

export async function handleCategoryRename(chatId, newName, userState) {
    // ... (This function remains the same as the previous version)
    const { oldName } = userState.data; const newNameTrimmed = newName.trim(); if (!newNameTrimmed || oldName === newNameTrimmed) { await firestore.collection('userStates').doc(chatId).delete(); return await sendMessage(chatId, "تم إلغاء العملية."); } const batch = firestore.batch(); const oldDocRef = firestore.collection('categories').doc(oldName); const newDocRef = firestore.collection('categories').doc(newNameTrimmed); const examsToUpdateQuery = firestore.collection('exams').where('categoryName', '==', oldName); const childCategoriesToUpdateQuery = firestore.collection('categories').where('parentId', '==', oldName); const [examsSnapshot, childCategoriesSnapshot, oldDoc] = await Promise.all([ examsToUpdateQuery.get(), childCategoriesToUpdateQuery.get(), oldDocRef.get() ]); examsSnapshot.forEach(doc => { batch.update(doc.ref, { categoryName: newNameTrimmed }); }); childCategoriesSnapshot.forEach(doc => { batch.update(doc.ref, { parentId: newNameTrimmed }); }); if (oldDoc.exists) { batch.set(newDocRef, { ...oldDoc.data(), name: newNameTrimmed }); batch.delete(oldDocRef); } await batch.commit(); await firestore.collection('userStates').doc(chatId).delete(); await sendMessage(chatId, `✅ تم تغيير اسم الفئة وتحديث ${examsSnapshot.size} اختبار و ${childCategoriesSnapshot.size} فئة فرعية.`); await sendAdminMenu(chatId);
}

export async function confirmCategoryDelete(chatId, categoryName, messageId) {
    // ... (This function remains the same as the previous version)
    const text = `🚨 *تحذير!* هل أنت متأكد من حذف الفئة "*${categoryName}*؟ سيتم حذف كل الفئات الفرعية والاختبارات بداخلها.`; const keyboard = { inline_keyboard: [[{ text: "🗑️ نعم، احذف الفئة", callback_data: `category_delete_execute:${categoryName}` }], [{ text: "❌ تراجع", callback_data: `category_edit:${categoryName}` }]] }; await editMessageText(chatId, messageId, text, keyboard, "Markdown");
}

export async function handleCategoryDelete(chatId, categoryName, messageId) {
    // ... (This function remains the same as the previous version)
    await firestore.collection('categories').doc(categoryName).delete(); await editMessageText(chatId, messageId, `✅ تم حذف الفئة "*${categoryName}*" بنجاح.`, { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "manage_categories" }]] }, "Markdown");
}

export async function promptForCategoryReorder(chatId, messageId) {
    // NEW: Updated to only reorder top-level categories
    const allCategories = await getAllCategories();
    const topLevelCategories = allCategories.filter(c => !c.parentId);
    const categoryNames = topLevelCategories.map(c => c.name).join("\n");
    const text = "🔄 *تغيير ترتيب الفئات الرئيسية*\n\nالترتيب الحالي هو:\n" + categoryNames + "\n\nللتغيير، أرسل قائمة بالأسماء مفصولة بفاصلة (,) بالترتيب الجديد الذي تريده.";
    await setUserState(chatId, 'awaiting_category_order');
    await editMessageText(chatId, messageId, text, { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "manage_categories" }]] }, "Markdown");
}

export async function handleCategoryReorder(chatId, text) {
    // ... (This function remains the same as the previous version)
    const newOrderNames = text.split(',').map(name => name.trim()); const batch = firestore.batch(); newOrderNames.forEach((name, index) => { if (name) { const docRef = firestore.collection('categories').doc(name); batch.update(docRef, { displayOrder: index + 1 }); } }); await batch.commit(); await firestore.collection('userStates').doc(chatId).delete(); await sendMessage(chatId, "✅ تم تحديث ترتيب الفئات الرئيسية بنجاح."); await sendAdminMenu(chatId);
}

// =============================================================================
//                             EXAM & QUESTION MANAGEMENT
// =============================================================================
// The rest of the file from here on is the same as the last version.
// I am including it in full to ensure you have a complete, working file.
export async function adminBrowseCategoriesForSelection(chatId, messageId, parentId = null, mode = 'new', examId = '') { const allCategories = await getAllCategories(); const childCategories = allCategories.filter(cat => (cat.parentId || null) === parentId).sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99)); const text = parentId ? `اختر فئة فرعية أو اختر الفئة الحالية "${parentId}"`: "اختر فئة رئيسية للاختبار:"; const keyboardRows = []; const callbackPrefix = mode === 'new' ? `category_select_new` : `category_select_existing:${examId}`; if (parentId) { keyboardRows.push([{ text: `✅ اختيار "${parentId}"`, callback_data: `${callbackPrefix}:${parentId}` }]); } childCategories.forEach(cat => { keyboardRows.push([ { text: `✅ اختيار "${cat.name}"`, callback_data: `${callbackPrefix}:${cat.name}` }, { text: `📁 عرض الفئات الفرعية`, callback_data: `admin_browse_cat_for_select:${cat.name}:${mode}:${examId}` } ]); }); let backCallback = (mode === 'new') ? 'cancel_operation' : `admin_edit_exam:${examId}`; if (parentId) { const currentCategory = allCategories.find(c => c.name === parentId); backCallback = currentCategory?.parentId ? `admin_browse_cat_for_select:${currentCategory.parentId}:${mode}:${examId}` : `admin_select_exam_category:${mode}:${examId}`; } keyboardRows.push([{ text: "❌ إلغاء", callback_data: "cancel_operation" }]); if (messageId) { await editMessageText(chatId, messageId, text, { inline_keyboard: keyboardRows }); } else { await sendMessage(chatId, text, { inline_keyboard: keyboardRows }); } }
export async function getExam(examId) { const doc = await firestore.collection('exams').doc(examId).get(); return doc.exists ? doc.data() : null; }
export async function getAllExams() { const snapshot = await firestore.collection('exams').get(); return snapshot.docs.map(doc => doc.data()); }
export async function getExamQuestions(examId) { const snapshot = await firestore.collection('questions').where('examId', '==', examId).orderBy('order').get(); return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })); }
export async function startAddExamFlow(chatId, messageId) { await setUserState(chatId, 'awaiting_exam_name'); const text = "📝 لنبدأ بإضافة اختبار جديد.\n\nالرجاء إرسال **اسم الاختبار**."; const keyboard = { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "cancel_operation" }]] }; if (messageId) await editMessageText(chatId, messageId, text, keyboard, "Markdown"); else await sendMessage(chatId, text, keyboard, "Markdown"); }
export async function handleNewExamName(chatId, text) { const examId = text.trim(); if (!examId) return; if (await getExam(examId)) { return await sendMessage(chatId, "⚠️ اسم الاختبار هذا مستخدم بالفعل. الرجاء اختيار اسم آخر."); } const examData = { examId, allowRetake: true, timePerQuestion: 0 }; await setUserState(chatId, 'selecting_category', examData); await adminBrowseCategoriesForSelection(chatId, null, null, 'new', examId); }
export async function handleCategorySelectionForNewExam(chatId, categoryName, messageId) { const userState = await getUserState(chatId); if (!userState || userState.state !== 'selecting_category') return; userState.data.categoryName = categoryName; const promptMessage = await promptForQuestions(chatId, userState.data.examId, messageId); await setUserState(chatId, 'awaiting_questions', { ...userState.data, tempQuestions: [], promptMessageId: promptMessage.message_id }); }
export async function handleQuestionInput(chatId, message, userState) {
    let parsedQuestions = [];
    let failCount = 0;
    if (message.poll && message.poll.type === 'quiz') {
        const poll = message.poll;
        if (typeof poll.correct_option_id === 'undefined') {
            await sendMessage(chatId, `⚠️ **فشل إضافة السؤال:**\n"${poll.question}"\n\n**السبب:** لا يمكن إضافة اختبار مجهول المصدر (Anonymous Poll).`);
            return;
        } else {
            parsedQuestions.push({ questionText: poll.question, options: poll.options.map(o => o.text), correctOptionIndex: poll.correct_option_id });
        }
    } else if (message.text) {
        const lines = message.text.trim().split('\n');
        for (const line of lines) {
            if (line.trim() === '') continue;
            const parsed = parseSingleQuestionCSV(line);
            if (parsed) {
                parsedQuestions.push(parsed);
            } else {
                failCount++;
            }
        }
    }

    if (parsedQuestions.length === 0) {
        if (failCount > 0) await sendMessage(chatId, `⚠️ فشلت إضافة ${failCount} سؤال. يرجى التأكد من الصيغة الصحيحة.`);
        return;
    }

    if (!userState.data.tempQuestions) userState.data.tempQuestions = [];
    userState.data.tempQuestions.push(...parsedQuestions);
    
    if (userState.data.promptMessageId) {
        try { await deleteMessage(chatId, userState.data.promptMessageId); } catch (e) { console.log("Old prompt message not found, could be deleted already."); }
    }

    const summaryText = `✅ تم استلام ${parsedQuestions.length} سؤال. الإجمالي المجمّع الآن: ${userState.data.tempQuestions.length}.\n\nأرسل المزيد، أو اضغط "إنهاء".`;
    const keyboard = { inline_keyboard: [[{ text: "✅ إنهاء وإضافة الأسئلة", callback_data: "finish_adding_questions" }], [{ text: "❌ إلغاء", callback_data: "cancel_operation" }]] };
    const newPromptMessage = await sendMessage(chatId, summaryText, keyboard);
    
    userState.data.promptMessageId = newPromptMessage.message_id;
    await setUserState(chatId, userState.state, userState.data);
}
export async function finishAddingQuestions(chatId, messageId) {
    const userState = await getUserState(chatId);
    if (!userState || !userState.data.tempQuestions || userState.data.tempQuestions.length === 0) {
        await firestore.collection('userStates').doc(chatId).delete();
        await editMessageText(chatId, messageId, "⚠️ لم تقم بإضافة أي أسئلة! تم إلغاء العملية.");
        return await sendAdminMenu(chatId);
    }
    const { examId, categoryName, allowRetake, timePerQuestion } = userState.data;
    const questions = userState.data.tempQuestions;
    const state = userState.state;
    if (state === 'awaiting_questions') {
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
        await firestore.collection('userStates').doc(chatId).delete();
        await editMessageText(chatId, messageId, `🎉 تم إنشاء الاختبار **${examId}** بنجاح مع ${questions.length} سؤال في فئة *${categoryName}*.`, null, "Markdown");
        await sendAdminMenu(chatId);
    } else {
        const { afterOrder } = userState.data;
        await firestore.runTransaction(async (transaction) => {
            const examRef = firestore.collection('exams').doc(examId);
            if (state === 'awaiting_question_after') {
                const subsequentQuery = firestore.collection('questions').where('examId', '==', examId).where('order', '>', afterOrder);
                const subsequentDocs = await transaction.get(subsequentQuery);
                subsequentDocs.forEach(doc => transaction.update(doc.ref, { order: doc.data().order + questions.length }));
            }
            const examDoc = await transaction.get(examRef);
            let currentOrder = state === 'awaiting_question_after' ? afterOrder : (examDoc.data().questionCount || 0);
            questions.forEach((q, index) => {
                const newRef = firestore.collection('questions').doc();
                const order = state === 'awaiting_question_after' ? currentOrder + 1 + index : ++currentOrder;
                transaction.set(newRef, { ...q, examId, order });
            });
            transaction.update(examRef, { questionCount: FieldValue.increment(questions.length) });
        });
        await firestore.collection('userStates').doc(chatId).delete();
        await editMessageText(chatId, messageId, `✅ تمت إضافة ${questions.length} سؤال بنجاح للاختبار.`);
        await sendAdminMenu(chatId);
    }
}
export async function adminBrowseCategoriesForExams(chatId, messageId, categoryId = null) { const allCategories = await getAllCategories(); const subCategories = allCategories.filter(cat => (cat.parentId || null) === categoryId).sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99)); const examsSnapshot = await firestore.collection('exams').where('categoryName', '==', categoryId).get(); const exams = examsSnapshot.docs.map(doc => doc.data()); const text = categoryId ? `أنت في فئة: *${categoryId}*` : "تصفح الفئات لعرض الاختبارات:"; const keyboardRows = []; subCategories.forEach(cat => { keyboardRows.push([{ text: `📁 ${cat.name}`, callback_data: `admin_browse_exams:${cat.name}` }]); }); exams.forEach(exam => { keyboardRows.push([{ text: `📝 ${exam.examId}`, callback_data: `admin_exam_details:${exam.examId}` }]); }); let backCallback = 'admin_panel'; if (categoryId) { const currentCategory = allCategories.find(c => c.name === categoryId); backCallback = currentCategory?.parentId ? `admin_browse_exams:${currentCategory.parentId}` : 'admin_browse_exams'; } keyboardRows.push([{ text: "🔙 رجوع", callback_data: backCallback }]); await editMessageText(chatId, messageId, text, { inline_keyboard: keyboardRows }, "Markdown"); }
export async function showExamDetails(chatId, examId, messageId) { const exam = await getExam(examId); if (!exam) { return await editMessageText(chatId, messageId, "⚠️ لم يتم العثور على الاختبار."); } let text = `*تفاصيل اختبار: ${exam.examId}*\n\n`; text += `*الفئة:* ${exam.categoryName || 'غير محدد'}\n`; text += `*السماح بالإعادة:* ${exam.allowRetake ? '✅ نعم' : '❌ لا'}\n`; text += `*الوقت لكل سؤال:* ${exam.timePerQuestion > 0 ? exam.timePerQuestion + ' ثانية' : '♾️ مفتوح'}\n`; text += `*عدد الأسئلة:* ${exam.questionCount || 0}\n`; const keyboard = { inline_keyboard: [ [{ text: "📊 عرض الإحصائيات", callback_data: `admin_exam_stats:${examId}` }], [{ text: "⚙️ تعديل الإعدادات", callback_data: `admin_edit_exam:${examId}` }], [{ text: "✏️ عرض وتعديل الأسئلة", callback_data: `list_questions_edit:${examId}` }], [{ text: "🗑️ حذف الاختبار", callback_data: `admin_delete_exam:${examId}` }], [{ text: "⬅️ رجوع", callback_data: `admin_browse_exams:${exam.categoryName}` }] ] }; await editMessageText(chatId, messageId, text, keyboard, 'Markdown'); }
export async function showExamStats(chatId, examId, messageId) { const scores = await getScoresForExam(examId); if (scores.length === 0) { return await editMessageText(chatId, messageId, `📊 لا توجد إحصائيات متاحة لاختبار *${examId}* لأنه لم يقم بأدائه أي طالب بعد.`, { inline_keyboard: [[{ text: "⬅️ رجوع للتفاصيل", callback_data: `admin_exam_details:${examId}` }]]}, 'Markdown'); } const uniqueUserIds = new Set(scores.map(s => s.userId)); const uniqueParticipants = uniqueUserIds.size; const totalScores = scores.reduce((sum, s) => sum + s.score, 0); const averageScore = (totalScores / scores.length).toFixed(2); const highestScore = Math.max(...scores.map(s => s.score)); const lowestScore = Math.min(...scores.map(s => s.score)); const totalQuestions = scores[0].totalQuestions; let text = `📊 *إحصائيات اختبار: ${examId}*\n\n`; text += `▫️ *عدد الطلاب المشاركين:* ${uniqueParticipants} طالب\n`; text += `▫️ *إجمالي عدد المحاولات:* ${scores.length} محاولة\n`; text += `▫️ *أعلى درجة:* ${highestScore} / ${totalQuestions}\n`; text += `▫️ *أدنى درجة:* ${lowestScore} / ${totalQuestions}\n`; text += `▫️ *متوسط الدرجات:* ${averageScore} / ${totalQuestions}\n`; const keyboard = { inline_keyboard: [[{ text: "⬅️ رجوع للتفاصيل", callback_data: `admin_exam_details:${examId}` }]] }; await editMessageText(chatId, messageId, text, keyboard, 'Markdown'); }
export async function sendEditExamMenu(chatId, examId, messageId) { const text = `⚙️ تعديل إعدادات اختبار: *${examId}*`; const keyboard = { inline_keyboard: [ [{ text: "🗂️ تغيير الفئة", callback_data: `change_exam_category:${examId}` }], [{ text: "✅ السماح بالإعادة", callback_data: `edit_exam_retake:${examId}:true` }, { text: "❌ منع الإعادة", callback_data: `edit_exam_retake:${examId}:false` }], [{ text: "⏰ تعديل الوقت", callback_data: `edit_exam_time:${examId}` }], [{ text: "⬅️ رجوع للتفاصيل", callback_data: `admin_exam_details:${examId}` }] ] }; await editMessageText(chatId, messageId, text, keyboard, 'Markdown'); }
export async function promptToChangeExamCategory(chatId, examId, messageId) { await adminBrowseCategoriesForSelection(chatId, messageId, null, 'existing', examId); }
export async function handleCategorySelectionForExistingExam(chatId, examId, categoryName, messageId) { if (!categoryName) { return await editMessageText(chatId, messageId, "⚠️ حدث خطأ. يرجى المحاولة مرة أخرى."); } await firestore.collection('exams').doc(examId).update({ categoryName }); await editMessageText(chatId, messageId, `✅ تم تغيير فئة الاختبار *${examId}* إلى *${categoryName}*.`, null, "Markdown"); await showExamDetails(chatId, examId, messageId); }
export async function handleEditExamRetake(callbackQuery) { const chatId = callbackQuery.from.id.toString(); const messageId = callbackQuery.message.message_id; const [, examId, allowRetake] = callbackQuery.data.split(':'); const allow = (allowRetake === 'true'); await firestore.collection('exams').doc(examId).update({ allowRetake: allow }); await answerCallbackQuery(callbackQuery.id, `✅ تم تحديث سياسة الإعادة.`, false); await sendEditExamMenu(chatId, examId, messageId); }
export async function promptForNewExamTime(chatId, examId, messageId) { const text = `⏰ تعديل الوقت لاختبار *${examId}*`; const keyboard = { inline_keyboard: [ [{ text: "⏱️ حدد وقت بالثواني", callback_data: `set_new_time:${examId}:true` }], [{ text: "♾️ اجعله وقت مفتوح", callback_data: `set_new_time:${examId}:false` }] ] }; await editMessageText(chatId, messageId, text, keyboard, "Markdown"); }
export async function handleSetNewExamTime(chatId, examId, wantsTime, messageId) { if (wantsTime === 'true') { await setUserState(chatId, 'editing_exam_time_value', { examId }); await editMessageText(chatId, messageId, `⏱️ الرجاء إرسال عدد الثواني الجديد لكل سؤال في اختبار *${examId}*`, { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "cancel_operation" }]] }, "Markdown"); } else { await firestore.collection('exams').doc(examId).update({ timePerQuestion: 0 }); await editMessageText(chatId, messageId, `✅ تم تحديث الوقت إلى مفتوح.`); await sendEditExamMenu(chatId, examId, messageId); } }
export async function handleEditExamTime(chatId, text, userState) { const { examId } = userState.data; const timeValue = parseInt(text, 10); if (isNaN(timeValue) || timeValue < 5 || timeValue > 600) { return await sendMessage(chatId, "⚠️ الرجاء إدخال رقم صحيح للوقت (بين 5 و 600 ثانية)."); } await firestore.collection('exams').doc(examId).update({ timePerQuestion: timeValue }); await firestore.collection('userStates').doc(chatId).delete(); await sendMessage(chatId, `✅ تم تحديث الوقت إلى *${timeValue}* ثانية لاختبار *${examId}*.`, null, "Markdown"); await sendAdminMenu(chatId); }
export async function listQuestionsForEditing(chatId, examId, messageId) { await editMessageText(chatId, messageId, `جاري تحميل أسئلة اختبار *${examId}*...`, null, 'Markdown'); const questions = await getExamQuestions(examId); if (questions.length === 0) { const keyboard = { inline_keyboard: [[{ text: "➕ إضافة أسئلة جديدة", callback_data: `q_add_next:${examId}` }], [{ text: "⬅️ رجوع للتفاصيل", callback_data: `admin_exam_details:${examId}` }]]}; return await editMessageText(chatId, messageId, `لا توجد أسئلة في اختبار *${examId}* حاليًا.`, keyboard, 'Markdown'); } await editMessageText(chatId, messageId, `*${questions.length}* سؤال في اختبار *${examId}*. سيتم عرضها الآن...`, null, 'Markdown'); for (const [index, q] of questions.entries()) { let questionText = `*السؤال ${index + 1}:*\n${q.questionText}\n\n`; q.options.forEach((opt, i) => { questionText += `${i + 1}. ${opt} ${i == q.correctOptionIndex ? '✅' : ''}\n`; }); const qKeyboard = { inline_keyboard: [[ { text: "✏️ استبدال", callback_data: `q_replace:${examId}:${q.id}` }, { text: "➕ إضافة تالي", callback_data: `q_add_after:${examId}:${q.order}` }, { text: "🗑️ حذف", callback_data: `q_delete:${examId}:${q.id}` } ]] }; await sendMessage(chatId, questionText, qKeyboard, 'Markdown'); } const finalKeyboard = { inline_keyboard: [[{ text: "➕ إضافة أسئلة جديدة (بشكل جماعي)", callback_data: `q_add_next:${examId}` }], [{ text: "⬅️ رجوع للتفاصيل", callback_data: `admin_exam_details:${examId}` }]]}; await sendMessage(chatId, "يمكنك أيضًا إضافة مجموعة أسئلة جديدة دفعة واحدة من هنا:", finalKeyboard); }
export async function promptForReplacementQuestion(chatId, examId, docId, messageId) { await setUserState(chatId, 'awaiting_replacement_question', { examId, docId }); await editMessageText(chatId, messageId, `*استبدال السؤال*\n\nأرسل الآن السؤال الجديد في سطر واحد بصيغة CSV أو قم بتحويل استطلاع.`, { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "cancel_operation" }]] }, "Markdown"); }
export async function handleReplaceQuestion(chatId, message, userState) {
    const { docId } = userState.data;
    let parsedQuestion;
    if (message.poll && message.poll.type === 'quiz') {
        const poll = message.poll;
        if (typeof poll.correct_option_id === 'undefined') { return await sendMessage(chatId, `⚠️ **فشل الاستبدال:** لا يمكن استخدام اختبار مجهول المصدر.`); }
        parsedQuestion = { questionText: poll.question, options: poll.options.map(o => o.text), correctOptionIndex: poll.correct_option_id };
    } else if (message.text) {
        parsedQuestion = parseSingleQuestionCSV(message.text);
    }
    if (!parsedQuestion) { return await sendMessage(chatId, "⚠️ صيغة خاطئة."); }
    const questionData = { questionText: parsedQuestion.questionText, options: parsedQuestion.options, correctOptionIndex: parsedQuestion.correctOptionIndex };
    await firestore.collection('questions').doc(docId).update(questionData);
    await firestore.collection('userStates').doc(chatId).delete();
    await sendMessage(chatId, `✅ تم استبدال السؤال بنجاح.`);
    await sendAdminMenu(chatId);
}
export async function promptForNextQuestion(chatId, examId, messageId) { const promptMessage = await (messageId ? editMessageText(chatId, messageId, `...`, {}) : sendMessage(chatId, `...`, {})); promptMessage = await sendMessage(chatId, `*إضافة أسئلة لنهاية اختبار ${examId}*\n\nأرسل الأسئلة بصيغة CSV أو قم بتحويل استطلاعات جاهزة. اضغط 'إنهاء' عند الانتهاء.`, { inline_keyboard: [[{ text: "✅ إنهاء وإضافة الأسئلة", callback_data: "finish_adding_questions" }], [{ text: "❌ إلغاء", callback_data: "cancel_operation" }]] }, "Markdown"); await setUserState(chatId, 'awaiting_next_question', { examId, tempQuestions: [], promptMessageId: promptMessage.message_id }); }
export async function promptForQuestionAfter(chatId, examId, afterOrderStr, messageId) { const afterOrder = parseInt(afterOrderStr, 10); const promptMessage = await sendMessage(chatId, `*إضافة سؤال بعد السؤال رقم ${afterOrder}*\n\nأرسل السؤال الجديد بصيغة CSV أو قم بتحويل استطلاع. اضغط 'إنهاء' عند الانتهاء.`, { inline_keyboard: [[{ text: "✅ إنهاء وإضافة الأسئلة", callback_data: "finish_adding_questions" }], [{ text: "❌ إلغاء", callback_data: "cancel_operation" }]] }, "Markdown"); await setUserState(chatId, 'awaiting_question_after', { examId, afterOrder, tempQuestions: [], promptMessageId: promptMessage.message_id }); }
export async function deleteQuestion(chatId, examId, docId, messageId) { try { await firestore.runTransaction(async (transaction) => { const questionRef = firestore.collection('questions').doc(docId); const examRef = firestore.collection('exams').doc(examId); const questionDoc = await transaction.get(questionRef); if (!questionDoc.exists) { throw new Error(`Question with ID ${docId} not found.`); } const deletedOrder = questionDoc.data().order; const subsequentQuestionsQuery = firestore.collection('questions').where('examId', '==', examId).where('order', '>', deletedOrder); const subsequentQuestionsSnapshot = await transaction.get(subsequentQuestionsQuery); transaction.delete(questionRef); subsequentQuestionsSnapshot.forEach(doc => { const docRef = firestore.collection('questions').doc(doc.id); transaction.update(docRef, { order: doc.data().order - 1 }); }); transaction.update(examRef, { questionCount: FieldValue.increment(-1) }); }); await editMessageText(chatId, messageId, `✅ تم حذف السؤال بنجاح.`); } catch (error) { console.error("Error deleting question:", error); await sendMessage(chatId, "🚨 حدث خطأ أثناء حذف السؤال. يرجى مراجعة سجلات الخادم."); } }
export async function confirmDeleteExam(chatId, examId, messageId) { const text = `🚨 *تحذير!* هل أنت متأكد من حذف الاختبار "*${examId}*؟"\n\nسيتم حذف جميع أسئلته بشكل نهائي. هذا الإجراء لا يمكن التراجع عنه.`; const keyboard = { inline_keyboard: [[{ text: "🗑️ نعم، احذف الاختبار", callback_data: `admin_delete_exam_confirm:${examId}` }], [{ text: "❌ تراجع", callback_data: `admin_exam_details:${examId}` }]]}; await editMessageText(chatId, messageId, text, keyboard, "Markdown"); }
export async function deleteExam(chatId, examId, messageId) { const questions = await getExamQuestions(examId); const batch = firestore.batch(); questions.forEach(q => { const questionRef = firestore.collection('questions').doc(q.id); batch.delete(questionRef); }); const examRef = firestore.collection('exams').doc(examId); batch.delete(examRef); await batch.commit(); await editMessageText(chatId, messageId, `✅ تم حذف الاختبار "*${examId}*" وجميع أسئلته بنجاح.`, { inline_keyboard: [[{ text: "🔙 رجوع لقائمة الاختبارات", callback_data: "admin_browse_exams" }]] }, "Markdown"); }
export async function getScoresForUser(userId) { const snapshot = await firestore.collection('studentScores').where('userId', '==', userId.toString()).get(); return snapshot.docs.map(doc => doc.data()).sort((a,b) => b.timestamp - a.timestamp); }
export function formatUserScores(scores) { if (!scores || scores.length === 0) { return "لا توجد نتائج مسجلة لهذا الطالب."; } let text = "📊 **النتائج السابقة:**\n\n"; const groupedScores = {}; scores.forEach(s => { if (!groupedScores[s.examId]) { groupedScores[s.examId] = []; } groupedScores[s.examId].push(s); }); for (const examId in groupedScores) { text += `*الاختبار: ${examId}*\n`; groupedScores[examId].sort((a, b) => b.timestamp - a.timestamp).forEach(attempt => { let dateStr; if (attempt.timestamp && typeof attempt.timestamp === 'number') { dateStr = new Date(attempt.timestamp).toLocaleString("ar-EG"); } else if (attempt.timestamp && attempt.timestamp.seconds) { dateStr = new Date(attempt.timestamp.seconds * 1000).toLocaleString("ar-EG"); } else { dateStr = "تاريخ غير محدد"; } text += `  - النتيجة: ${attempt.score}/${attempt.totalQuestions}  —  _${dateStr}_\n`; }); text += `\n`; } return text; }
export async function getScoresForExam(examId) { const snapshot = await firestore.collection('studentScores').where('examId', '==', examId).get(); return snapshot.docs.map(doc => doc.data()); }
export async function checkUserHistory(userId, examId) { const snapshot = await firestore.collection('studentScores').where('userId', '==', userId.toString()).where('examId', '==', examId).limit(1).get(); return !snapshot.empty; }
export async function saveScore(userId, userName, examId, score, totalQuestions) { const scoreData = { userId: userId.toString(), userName, examId, score, totalQuestions, timestamp: Date.now() }; await firestore.collection('studentScores').add(scoreData); }
export async function studentBrowseCategories(chatId, messageId, categoryId = null) { const allCategories = await getAllCategories(); const subCategories = allCategories .filter(cat => (cat.parentId || null) === categoryId) .sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99)); let exams = []; if (categoryId) { const examsSnapshot = await firestore.collection('exams').where('categoryName', '==', categoryId).get(); exams = examsSnapshot.docs.map(doc => doc.data()); } const keyboardRows = []; subCategories.forEach(cat => { keyboardRows.push([{ text: `📁 ${cat.name}`, callback_data: `student_browse_categories:${cat.name}` }]); }); exams.forEach(exam => { keyboardRows.push([{ text: `📝 ${exam.examId}`, callback_data: `show_exam_confirm:${exam.examId}` }]); }); let text; if (subCategories.length === 0 && exams.length === 0) { if (categoryId) { text = `لا توجد فئات فرعية أو اختبارات في فئة *${categoryId}*.`; } else { text = "لا توجد أي فئات اختبارات متاحة حاليًا."; } } else { text = categoryId ? `أنت في فئة: *${categoryId}*` : "🗂️ يرجى اختيار فئة الاختبارات:"; } let parentCategory = null; if (categoryId) { parentCategory = allCategories.find(cat => cat.name === categoryId); } const backCallback = parentCategory?.parentId ? `student_browse_categories:${parentCategory.parentId}` : 'student_panel'; keyboardRows.push([{ text: "🔙 رجوع", callback_data: backCallback }]); const keyboard = { inline_keyboard: keyboardRows }; await editMessageText(chatId, messageId, text, keyboard, "Markdown"); }
export async function showExamConfirmation(chatId, examId, messageId) { const exam = await getExam(examId); if (!exam) return; let text = `*تفاصيل الاختبار: ${examId}*\n\n`; text += `*عدد الأسئلة:* ${exam.questionCount || 0}\n`; text += `*السماح بالإعادة:* ${exam.allowRetake ? '✅ نعم' : '❌ لا'}\n`; text += `*الوقت لكل سؤال:* ${exam.timePerQuestion > 0 ? `${exam.timePerQuestion} ثانية` : '♾️ وقت مفتوح'}\n\n`; text += `هل أنت مستعد للبدء؟`; const keyboard = { inline_keyboard: [[{ text: "🚀 بدء الاختبار الآن", callback_data: `confirm_start_exam:${examId}` }], [{ text: "⬅️ رجوع", callback_data: `student_browse_categories:${exam.categoryName}` }]]}; await editMessageText(chatId, messageId, text, keyboard, "Markdown"); }
export async function startQuiz(callbackQuery) { const chatId = callbackQuery.from.id.toString(); const messageId = callbackQuery.message ? callbackQuery.message.message_id : null; const [, examId] = callbackQuery.data.split(':'); const userName = callbackQuery.from.username || callbackQuery.from.first_name; const exam = await getExam(examId); if (!exam) return; if (!exam.allowRetake && await checkUserHistory(chatId, examId)) { return await answerCallbackQuery(callbackQuery.id, "🚫 عذراً، لقد قمت بأداء هذا الاختبار من قبل والإعادة غير مسموحة.", true); } const questionsRaw = await getExamQuestions(examId); if (!questionsRaw || questionsRaw.length === 0) { return await answerCallbackQuery(callbackQuery.id, "⚠️ عذراً، هذا الاختبار لا يحتوي على أسئلة حاليًا.", true); } if (messageId) await editMessageText(chatId, messageId, `🚀 سيبدأ اختبار **${examId}** الآن. استعد!`, null, 'Markdown'); else await sendMessage(chatId, `🚀 سيبدأ اختبار **${examId}** الآن. استعد!`, null, 'Markdown'); const prepared = questionsRaw.map((q) => ({ ...q, questionText: escapeMarkdown(q.questionText || "") })); const quizData = { examId, userName, currentQuestionIndex: 0, score: 0, questions: prepared, timePerQuestion: exam.timePerQuestion || 0, }; await setUserState(chatId, 'taking_exam', quizData); await sendQuestion(chatId, { state: 'taking_exam', data: quizData }); }
export async function sendQuestion(userId, userState) { const { currentQuestionIndex, questions, timePerQuestion } = userState.data; const question = questions[currentQuestionIndex]; const sentPoll = await sendPoll(userId, question.questionText, question.options, 'quiz', question.correctOptionIndex, timePerQuestion); if (sentPoll && sentPoll.poll) { await setUserState(userId, 'taking_exam', { ...userState.data, lastPollId: sentPoll.poll.id, lastMessageId: sentPoll.message_id, lastQuestionTimestamp: Date.now(), }); } }
export async function handlePollAnswer(pollAnswer) { const userId = pollAnswer.user.id.toString(); const userState = await getUserState(userId); if (!userState || userState.state !== 'taking_exam' || pollAnswer.poll_id !== userState.data.lastPollId) { return; } await stopPoll(userId, userState.data.lastMessageId); const selectedOption = pollAnswer.option_ids[0]; const qIndex = userState.data.currentQuestionIndex; const correctOption = userState.data.questions[qIndex].correctOptionIndex; if (selectedOption === correctOption) { userState.data.score++; } userState.data.currentQuestionIndex++; if (userState.data.currentQuestionIndex >= userState.data.questions.length) { await finishQuiz(userId, userState.data); } else { await setUserState(userId, 'taking_exam', userState.data); await sendQuestion(userId, userState); } }
export async function finishQuiz(userId, userData) { const { userName, examId, score, questions } = userData; await saveScore(userId, userName, examId, score, questions.length); await firestore.collection('userStates').doc(userId).delete(); const text = `🎉 **انتهى الاختبار!** 🎉\n\nنتيجتك هي: *${score}* من *${questions.length}*`; const keyboard = { inline_keyboard: [[{ text: "🔄 إعادة الاختبار", callback_data: `show_exam_confirm:${examId}` }], [{ text: "🏠 القائمة الرئيسية", callback_data: 'student_panel' }]] }; await sendMessage(userId, text, keyboard, 'Markdown'); }
export async function showStudentStats(chatId, messageId) { const allScores = await getScoresForUser(chatId); if (!allScores || allScores.length === 0) { return await editMessageText(chatId, messageId, "لم تقم بأداء أي اختبارات بعد.", { inline_keyboard: [[{text: "رجوع", callback_data: "student_panel"}]]}); } const text = formatUserScores(allScores); const keyboard = { inline_keyboard: [[{text: "⬅️ رجوع", callback_data: "student_panel"}]] }; await editMessageText(chatId, messageId, text, keyboard, 'Markdown'); }
export async function showStudentRanking(chatId, examId, userId, messageId) { const scores = await getScoresForExam(examId); if (!scores || scores.length === 0) { return await editMessageText(chatId, messageId, "لا توجد نتائج مسجلة لهذا الاختبار بعد.", { inline_keyboard: [[{text: "⬅️ رجوع", callback_data: "student_panel"}]]}); } scores.sort((a, b) => b.score - a.score); const userRank = scores.findIndex(s => s.userId.toString() === userId.toString()) + 1; const userScore = scores.find(s => s.userId.toString() === userId.toString()); if (!userScore) { return await editMessageText(chatId, messageId, "لم يتم العثور على نتيجتك في هذا الاختبار.", { inline_keyboard: [[{text: "⬅️ رجوع", callback_data: "student_panel"}]]}); } let text = `📜 **ترتيبك في اختبار: ${examId}**\n\n`; text += `🏅 ترتيبك هو: *${userRank}* من أصل *${scores.length}* طالب.\n`; text += `🎯 درجتك: *${userScore.score}/${userScore.totalQuestions}*\n`; const keyboard = { inline_keyboard: [[{text: "⬅️ رجوع", callback_data: "student_panel"}]] }; await editMessageText(chatId, messageId, text, keyboard, 'Markdown'); }
export async function checkTimedOutQuizzes() { const now = Date.now(); const statesSnapshot = await firestore.collection('userStates').where('state', '==', 'taking_exam').get(); for (const doc of statesSnapshot.docs) { const userId = doc.id; const state = doc.data(); const data = state.data; if (data && data.lastQuestionTimestamp && data.timePerQuestion > 0) { const timeElapsed = (now - data.lastQuestionTimestamp) / 1000; if (timeElapsed > data.timePerQuestion + 2) { console.log(`User ${userId} timed out. Advancing quiz.`); try { const userState = await getUserState(userId); if (userState && userState.state === 'taking_exam' && userState.data.lastQuestionTimestamp === data.lastQuestionTimestamp) { await stopPoll(userId, userState.data.lastMessageId); userState.data.currentQuestionIndex++; if (userState.data.currentQuestionIndex >= userState.data.questions.length) { await finishQuiz(userId, userState.data); } else { await setUserState(userId, 'taking_exam', userState.data); await sendQuestion(userId, userState); } } } catch (e) { console.error(`Timeout processing failed for user ${userId}:`, e); } } } } }
