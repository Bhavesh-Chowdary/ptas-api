import OneSignal from "onesignal-node";

const client = new OneSignal.Client(
    process.env.ONESIGNAL_APP_ID,
    process.env.ONESIGNAL_REST_API_KEY
);

export const sendPushNotification = async ({
    playerIds,
    title,
    message,
    data = {}
}) => {
    if (!playerIds || playerIds.length === 0) return;

    try {
        await client.createNotification({
            include_player_ids: playerIds,
            headings: { en: title },
            contents: { en: message },
            data
        });
    } catch (error) {
        console.error("OneSignal Push Error:", error);
    }
};
