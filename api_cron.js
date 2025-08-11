import { checkTimedOutQuizzes } from '../lib/logic.js'; // نفترض أن الدالة موجودة في logic.js

export default async function handler(request, response) {
try {
console.log("Running cron job: checkTimedOutQuizzes");
await checkTimedOutQuizzes();
response.status(200).json({ status: "OK", message: "Cron job executed successfully." });
} catch (error) {
console.error("Error in cron job:", error);
response.status(500).json({ status: "Error", message: error.message });
}
}