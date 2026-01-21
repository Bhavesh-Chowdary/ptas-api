import OneSignal from "onesignal-node";
import dotenv from "dotenv";
dotenv.config();

const client = new OneSignal.Client(
    process.env.ONESIGNAL_APP_ID,
    process.env.ONESIGNAL_REST_API_KEY
);

console.log('[OneSignal Service] Initialized with App ID:', process.env.ONESIGNAL_APP_ID ? 'YES' : 'MISSING');
console.log('[OneSignal Service] REST API Key present:', process.env.ONESIGNAL_REST_API_KEY ? 'YES' : 'MISSING');

export const sendPushNotification = async ({
    playerIds,
    title,
    message,
    data = {}
}) => {
    if (!playerIds || playerIds.length === 0) return;

    try {
        console.log(`[OneSignal] Attempting to send push to ${playerIds.length} players. Title: "${title}"`);
        const response = await client.createNotification({
            include_player_ids: playerIds,
            headings: { en: title },
            contents: { en: message },
            data
        });
        console.log('[OneSignal] Push Success Response:', response.body);
    } catch (error) {
        console.error("OneSignal Push Error:", error);
        if (error.response) console.error("OneSignal Error Body:", error.response.body);
    }
};
