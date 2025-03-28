/**
 * Open Wegram Bot - Cloudflare Worker
 * A two-way private messaging Telegram bot
 *
 * GitHub Repository: https://github.com/wozulong/open-wegram-bot
 *
 * Deploy options:
 * 1. GitHub integration (recommended): Connect this repository to Cloudflare
 * 2. Wrangler CLI: Use 'npx wrangler deploy'
 */

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        const PREFIX = env.PREFIX || 'public';
        const SECRET_TOKEN = env.SECRET_TOKEN || '';

        const INSTALL_PATTERN = new RegExp(`^/${PREFIX}/install/([^/]+)/([^/]+)$`);
        const UNINSTALL_PATTERN = new RegExp(`^/${PREFIX}/uninstall/([^/]+)$`);
        const WEBHOOK_PATTERN = new RegExp(`^/${PREFIX}/webhook/([^/]+)/([^/]+)$`);

        let match;
        if (match = path.match(INSTALL_PATTERN)) {
            return handleInstall(request, match[1], match[2], PREFIX, SECRET_TOKEN);
        }

        if (match = path.match(UNINSTALL_PATTERN)) {
            return handleUninstall(match[1], SECRET_TOKEN);
        }

        if (match = path.match(WEBHOOK_PATTERN)) {
            return handleWebhook(request, match[1], match[2], SECRET_TOKEN);
        }

        return new Response('Not Found', {status: 404});
    }
};

function validateSecretToken(token) {
    return token.length > 15 && /[A-Z]/.test(token) && /[a-z]/.test(token) && /[0-9]/.test(token);
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
}

async function postToTelegramApi(token, method, body) {
    return fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
}

async function handleInstall(request, ownerUid, botToken, prefix, secretToken) {
    if (!validateSecretToken(secretToken)) {
        return jsonResponse({
            success: false,
            message: 'Secret token must be at least 16 characters and contain uppercase letters, lowercase letters, and numbers.'
        }, 400);
    }

    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.hostname}`;
    const webhookUrl = `${baseUrl}/${prefix}/webhook/${ownerUid}/${botToken}`;

    try {
        const response = await postToTelegramApi(botToken, 'setWebhook', {
            url: webhookUrl,
            allowed_updates: ['message'],
            secret_token: secretToken
        });

        const result = await response.json();
        if (result.ok) {
            return jsonResponse({success: true, message: 'Webhook successfully installed.'});
        }

        return jsonResponse({success: false, message: `Failed to install webhook: ${result.description}`}, 400);
    } catch (error) {
        return jsonResponse({success: false, message: `Error installing webhook: ${error.message}`}, 500);
    }
}

async function handleUninstall(botToken, secretToken) {
    if (!validateSecretToken(secretToken)) {
        return jsonResponse({
            success: false,
            message: 'Secret token must be at least 16 characters and contain uppercase letters, lowercase letters, and numbers.'
        }, 400);
    }

    try {
        const response = await postToTelegramApi(botToken, 'deleteWebhook', {})

        const result = await response.json();
        if (result.ok) {
            return jsonResponse({success: true, message: 'Webhook successfully uninstalled.'});
        }

        return jsonResponse({success: false, message: `Failed to uninstall webhook: ${result.description}`}, 400);
    } catch (error) {
        return jsonResponse({success: false, message: `Error uninstalling webhook: ${error.message}`}, 500);
    }
}

async function handleWebhook(request, ownerUid, botToken, secretToken) {
    if (secretToken !== request.headers.get('X-Telegram-Bot-Api-Secret-Token')) {
        return new Response('Unauthorized', {status: 401});
    }

    const update = await request.json();
    if (!update.message) {
        return new Response('OK');
    }

    const message = update.message;
    const reply = message.reply_to_message;
    try {
        if (reply && message.from.id.toString() === ownerUid) {
            const rm = reply.reply_markup;
            if (rm && rm.inline_keyboard && rm.inline_keyboard.length > 0) {
                await postToTelegramApi(botToken, 'copyMessage', {
                    chat_id: rm.inline_keyboard[0][0].callback_data,
                    from_chat_id: message.chat.id,
                    message_id: message.message_id
                });
            }

            return new Response('OK');
        }

        if ("/start" === message.text) {
            return new Response('OK');
        }

        const sender = message.from;
        const senderUid = sender.id.toString();
        const senderName = sender.username ? `@${sender.username}` : [sender.first_name, sender.last_name].filter(Boolean).join(' ');

        const copyMessage = async function (withUrl = false) {
            const ik = [[{
                text: `🔏 From: ${senderName} (${senderUid})`,
                callback_data: senderUid,
            }]];

            if (withUrl) {
                ik[0][0].text = `🔓 From: ${senderName} (${senderUid})`
                ik[0][0].url = `tg://user?id=${senderUid}`;
            }

            return await postToTelegramApi(botToken, 'copyMessage', {
                chat_id: ownerUid,
                from_chat_id: message.chat.id,
                message_id: message.message_id,
                reply_markup: {inline_keyboard: ik}
            });
        }

        const response = await copyMessage(true);
        if (!response.ok) {
            await copyMessage();
        }

        return new Response('OK');
    } catch (error) {
        console.error('Error handling webhook:', error);
        return new Response('Internal Server Error', {status: 500});
    }
}